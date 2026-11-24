import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision,
  recipientsFor, dedupeKeyFor, lastSentKeyFor } from "../../../lib/config";
import { seen, kvConfigured, kvMGet } from "../../../lib/kv";
import { getOpportunityResult, pagedSearch, getJwt, tokenLife } from "../../../lib/tracker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Daily safety net.
//
// The webhook occasionally misses a job — a ping arriving during a deploy, or
// an advert that never fired an Opportunity event. Those misses are silent:
// nothing errors, the ad simply never arrives, and you only find out when a
// consultant asks.
//
// This lists every advert published in the last couple of days, so anything
// missed is still visible. It does NOT talk to the ads Zap and cannot cause a
// duplicate — it is a report, not a sender.
//
// Each job carries a verdict, so "why did this one not arrive?" is answerable
// without guessing. It applies the SAME checks as the webhook and, crucially,
// asks the de-duplication store whether the advert has already been recorded
// as sent: that is the one failure mode with no trace anywhere else. If a key
// was claimed and then the email never went out, the job looks perfectly
// healthy from every other angle and will never be sent again on its own.
//
// ?verdict=blocked  lists only the jobs that would NOT produce an advert.
//
// Intended use: a Schedule by Zapier trigger each morning -> Webhooks GET this
// URL -> Gmail the summary to Sophie.
// ---------------------------------------------------------------------------

// Must match the webhook's own floor, which is where it is defined.
const ADVERTS_PUBLISHED_FROM = process.env.ADVERTS_PUBLISHED_FROM || "2026-09-01";

const LOOKBACK_DAYS = 2;      // adverts published within this window
const TRAWL_DAYS = 7;         // minimum window to search for candidates
const MAX_TRAWL_DAYS = 45;    // a ceiling, so one link cannot trawl the year
const MAX_PAGES = 40;
const MAX_DETAILS = 120;
// Tracker invalidates the previous token every time a new one is issued, so
// look-ups running side by side can reject each other. lib/tracker.js now
// stops a rejected call from forcing a needless re-exchange, but a smaller
// batch keeps the blast radius down.
const CONCURRENCY = 4;

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function asList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.opportunities || data.data || data.results || data.items)) || [];
}

async function fetchAllPages(baseBody) {
  const all = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const r = await pagedSearch({ ...baseBody, pageNumber: page });
    if (!r.ok) break;
    const list = asList(r.data);
    all.push(...list);
    if (!(r.data && r.data.hasNextPage) || list.length === 0) break;
    page += 1;
  }
  return all;
}

async function fetchDetails(ids) {
  const out = [];
  const failed = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => getOpportunityResult(id)));
    results.forEach((r, n) => {
      // Previously these were dropped with .filter(Boolean), so a job Tracker
      // would not return simply vanished from the report — the safety net
      // quietly had holes in it.
      if (r.ok && r.data) out.push(r.data);
      else failed.push({ id: batch[n], reason: r.reason || "no record returned" });
    });
  }
  return { records: out, failed };
}

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const days = parseInt(url.searchParams.get("days") || "", 10) || LOOKBACK_DAYS;
  const cutoff = daysAgoISO(days);

  let shallow;
  try {
    // The candidate search has to reach at least as far back as the report
    // does, or ?days=10 quietly reports on a 7-day trawl and the older jobs
    // it is being asked about are never even looked at.
    const trawl = Math.min(MAX_TRAWL_DAYS, Math.max(TRAWL_DAYS, days + 1));
    shallow = await fetchAllPages({ state: "open", updatedAfter: daysAgoISO(trawl) });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  const recent = shallow
    .filter((o) => String(o.publishDate || "") >= cutoff)
    .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  const ids = recent.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAILS);
  const { records: details, failed } = await fetchDetails(ids);

  const origin = url.origin;

  // Why would this job NOT produce an advert? Mirrors the webhook's checks.
  const blockers = (f) => {
    const out = [];
    if (!f.advertised) out.push("advertStatus is not A — not advertised");
    if (f.dead) out.push("status is " + (f.status || "(none)") + " — not advertising");
    if (!f.title) out.push("no advert title");
    if (isExcludedDepartment(f.department)) out.push("excluded department: " + f.department);
    if (isTestRecord(f.title, f.client)) out.push("test or training record");
    if (String(f.publishDate || "").slice(0, 10) < ADVERTS_PUBLISHED_FROM) {
      out.push("published before the " + ADVERTS_PUBLISHED_FROM + " cut-off");
    }
    return out;
  };

  const mapped = details
    .map((opp) => mapOpportunity(opp))
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));

  // ---- What did we last advertise for each of these jobs? ----
  // One request for the lot. A job whose publish date has moved on since the
  // advert we sent has been re-advertised, and if its details did not change
  // the de-duplication key is identical and the webhook skipped it in silence
  // — job 45223, advertised 6 October and re-published 24 November, is the
  // case that found this. No record exists for adverts sent before this was
  // added, so those read as "unknown" rather than as a clean bill of health.
  const lastSentFor = {};
  if (kvConfigured() && mapped.length) {
    try {
      const values = await kvMGet(mapped.map((f) => lastSentKeyFor(f.id)));
      mapped.forEach((f, i) => {
        if (!values[i]) return;
        try { lastSentFor[f.id] = JSON.parse(values[i]); } catch { /* unreadable */ }
      });
    } catch { /* reporting only — the sweep still works without it */ }
  }

  const jobs = await Promise.all(mapped
    .map(async (f) => {
      const division = resolveDivision(f.department, f.consultant);
      const skipped = blockers(f);

      // Already recorded as sent? The ONLY way an otherwise healthy advert
      // silently never arrives. Never written to here, only read.
      let alreadySent = null;
      if (!skipped.length && kvConfigured()) {
        try { alreadySent = await seen(dedupeKeyFor(f, division)); } catch { alreadySent = null; }
      }

      // Re-advertised since the advert we sent? Only meaningful for a job the
      // store says is already done — that is precisely the case where nothing
      // else would ever mention it again.
      const publishDate = String(f.publishDate).slice(0, 10);
      const lastSent = lastSentFor[f.id] || null;
      const reAdvertised = !!(
        alreadySent === true && lastSent && lastSent.publishDate &&
        publishDate > String(lastSent.publishDate).slice(0, 10)
      );

      const recipients = recipientsFor({ ...f, division });

      const base = new URLSearchParams();
      if (f.department) base.set("division", f.department);
      if (f.consultant) base.set("consultant", f.consultant);
      if (f.title) base.set("title", f.title);
      if (f.location) base.set("location", f.location);
      if (f.employmentType) base.set("employment_type", f.employmentType);
      base.set("image", "auto");
      if (token) base.set("token", token);

      const withSalary = new URLSearchParams(base);
      if (f.salaryFrom != null && f.salaryFrom !== "") withSalary.set("salary_from", String(f.salaryFrom));
      if (f.salaryTo != null && f.salaryTo !== "") withSalary.set("salary_to", String(f.salaryTo));
      if (f.salaryPeriod) withSalary.set("salary_period", f.salaryPeriod);

      const competitive = new URLSearchParams(base);
      competitive.set("salary_text", COMPETITIVE_LABEL);

      return {
        id: f.id,
        title: f.title,
        consultant: f.consultant,
        division,
        location: f.location,
        client: f.client,
        status: f.status,
        department: f.department,
        publishDate,
        verdict: skipped.length ? "blocked"
          : reAdvertised ? "re-advertised since the last advert"
          : alreadySent === true ? "already recorded as sent"
          : "would send",
        skipped,
        alreadySent,
        reAdvertised,
        // Null for anything advertised before this record was kept, which is
        // honest: it means we cannot tell, not that nothing has changed.
        lastAdvertSentFor: lastSent ? String(lastSent.publishDate || "") || null : null,
        lastAdvertSentAt: lastSent ? String(lastSent.sentAt || "").slice(0, 10) || null : null,
        emailTo: recipients.to.join(", "),
        emailCc: recipients.cc.join(", "),
        noAddressOnFile: recipients.missing.join(", "),
        resend: origin + "/api/tracker-hook?id=" + f.id + "&force=1" + (token ? "&token=" + token : ""),
        imageUrl: origin + "/api/og?" + withSalary.toString(),
        imageUrlCompetitive: origin + "/api/og?" + competitive.toString(),
      };
    }));

  // ?verdict= narrows the report. "blocked" used to mean "everything except
  // would send", which hid the one category that actually needs acting on:
  // a job published days ago that has never been sent at all. Sophie ran it
  // during the outage and the ten missing adverts were filtered out of her
  // own report.
  const only = (url.searchParams.get("verdict") || "").toLowerCase();
  const shown =
    only === "missing" ? jobs.filter((j) => j.verdict !== "already recorded as sent")
    : only === "blocked" ? jobs.filter((j) => j.verdict === "blocked")
    : only === "unsent" || only === "would-send" ? jobs.filter((j) => j.verdict === "would send")
    : only === "sent" ? jobs.filter((j) => j.verdict === "already recorded as sent")
    : only === "readvertised" || only === "re-advertised" ? jobs.filter((j) => j.reAdvertised)
    : jobs;

  // The two categories with work attached come first: an advert that has
  // never gone out, then one for a job that has been re-advertised since.
  const rank = (v) => (v === "would send" ? 0
    : v === "re-advertised since the last advert" ? 1
    : v === "blocked" ? 2 : 3);
  shown.sort((a, b) => rank(a.verdict) - rank(b.verdict) ||
    String(b.publishDate).localeCompare(String(a.publishDate)));

  // A ready-made email body, so the Zap can just drop it into Gmail.
  const lines = shown.map((j) => {
    const head = j.publishDate + "  —  " + j.title + "  —  " + j.consultant +
      " (" + (j.division || "no division") + ")  [" + j.verdict + "]";
    if (j.verdict === "blocked") return head + "\n    " + j.skipped.join("\n    ");
    if (j.verdict === "would send") {
      return head + "\n    NO ADVERT HAS BEEN SENT FOR THIS JOB. Send it: " + j.resend +
        "\n    To: " + (j.emailTo || "(nobody)") +
        "\n    With salary:  " + j.imageUrl;
    }
    if (j.verdict === "re-advertised since the last advert") {
      return head +
        "\n    RE-ADVERTISED AND SKIPPED. The last advert went out " +
        (j.lastAdvertSentAt || "(unknown)") + " for publish date " +
        (j.lastAdvertSentFor || "(unknown)") + "; this job now shows " + j.publishDate +
        ", and nothing on the advert itself changed, so the webhook treated it as a" +
        " repeat and said nothing. Send it: " + j.resend +
        "\n    To: " + (j.emailTo || "(nobody)") +
        "\n    With salary:  " + j.imageUrl;
    }
    const bits = [head, "    To: " + (j.emailTo || "(nobody)")];
    if (j.noAddressOnFile) bits.push("    NO ADDRESS ON FILE: " + j.noAddressOnFile);
    if (j.alreadySent) bits.push("    Already recorded as sent. If it never arrived, re-send: " + j.resend);
    bits.push("    With salary:  " + j.imageUrl);
    bits.push("    Competitive:  " + j.imageUrlCompetitive);
    return bits.join("\n");
  });

  const counts = {
    wouldSend: jobs.filter((j) => j.verdict === "would send").length,
    reAdvertised: jobs.filter((j) => j.reAdvertised).length,
    alreadySent: jobs.filter((j) => j.verdict === "already recorded as sent").length,
    blocked: jobs.filter((j) => j.verdict === "blocked").length,
    noAddressOnFile: jobs.filter((j) => j.noAddressOnFile).length,
    // Adverts that went out before this record was kept. Not a problem, but
    // they cannot be checked for re-advertising, so the number matters when
    // reading reAdvertised as "the full list".
    noLastAdvertRecord: jobs.filter((j) => j.alreadySent === true && !j.lastAdvertSentFor).length,
  };

  // ---- How long has the Tracker token got? ----
  // Tracker issues a token with a SEVEN DAY life and then keeps handing back
  // that same token. It does not mint a new one when it expires: on 24
  // November it was still returning one that had died on the 19th, and the
  // only way out was to regenerate the API key. So the expiry date is a
  // deadline, and it belongs somewhere Sophie sees it every day rather than
  // being discovered when adverts stop.
  const tracker = {};
  try {
    const life = tokenLife(await getJwt());
    if (life) {
      const days = life.secondsLeft / 86400;
      tracker.tokenExpiresAt = life.expiresAt;
      tracker.daysLeft = Math.round(days * 10) / 10;
      if (days < 3) {
        tracker.warning =
          "The Tracker token expires " + life.expiresAt + " (" + tracker.daysLeft + " days). " +
          "Tracker does not issue a new one on its own — regenerate the API key in Tracker and " +
          "update TRACKER_BEARER_TOKEN in Vercel, or adverts will stop.";
      }
    }
  } catch (e) {
    tracker.error = String((e && e.message) || e);
  }

  const alert = tracker.warning ? "** " + tracker.warning + " **\n\n"
    : tracker.error ? "** Tracker is not answering: " + tracker.error + " **\n\n" : "";

  const summary = alert +
    (shown.length === 0
      ? "Nothing to report in the last " + days + " days."
      : shown.length + " advert(s) published in the last " + days + " days  (" +
        counts.wouldSend + " would send, " + counts.reAdvertised + " re-advertised and skipped, " +
        counts.alreadySent + " already recorded as sent, " +
        counts.blocked + " blocked):\n\n" + lines.join("\n\n"));

  return new Response(JSON.stringify({
    generatedAt: new Date().toISOString(),
    publishedOnOrAfter: cutoff,
    searchedBackTo: daysAgoISO(Math.min(MAX_TRAWL_DAYS, Math.max(TRAWL_DAYS, days + 1))),
    couldNotRead: failed,
    memory: kvConfigured() ? "connected" : "NOT CONFIGURED — nothing is being de-duplicated",
    tracker,
    counts,
    count: shown.length,
    summary,
    jobs: shown,
  }, null, 2), { headers: { "content-type": "application/json" } });
}
