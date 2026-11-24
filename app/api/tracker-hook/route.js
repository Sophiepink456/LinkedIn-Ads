import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision, recipientsFor,
  dedupeKeyFor, lastSentKeyFor, LAST_SENT_TTL_S } from "../../../lib/config";
import { getOpportunityResult } from "../../../lib/tracker";
import { claim, release, seen, kvConfigured, nextSequence, kvSet, kvGet } from "../../../lib/kv";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Receives Tracker's webhook ping, fetches the job LIVE, checks whether it is
// genuinely a NEW advert, and forwards it to Zapier if so.
//
// Uses the shared client in lib/tracker.js, which caches the JWT. Exchanging a
// token on every ping caused Tracker to reject requests with 401 — each new
// token appeared to invalidate the last.
// ---------------------------------------------------------------------------

const ZAPIER_HOOK =
  process.env.ZAPIER_HOOK_URL || "https://hooks.zapier.com/hooks/catch/20911531/4hr9bki/";

// ---------------------------------------------------------------------------
// Tracker fires a webhook on EVERY change to an opportunity, including changes
// to jobs that were advertised long before this automation existed. Those jobs
// are still open and still advertStatus "A", so without a floor, touching a
// job from February would email an ad nobody is waiting for.
//
// This was a rolling 3-day window, which blocked late corrections — a salary
// fixed a month after advertising never reached anyone.
//
// Be clear about how much this gate is worth now: because Tracker bumps
// publishDate when a live record is saved, an advert from March jumps to
// today the moment anyone touches it and sails past any cut-off. The gate
// only catches adverts whose publishDate has NOT been bumped. The real
// protection against repeat ads is the fingerprint key above.
//
// It is kept as a cheap backstop, set loose enough not to block corrections:
// 1 September 2026 is when this automation's webhook was registered, so
// everything it has ever handled stays eligible. Override per-request with
// ?from= or set ADVERTS_PUBLISHED_FROM in Vercel.
// ---------------------------------------------------------------------------
const ADVERTS_PUBLISHED_FROM = process.env.ADVERTS_PUBLISHED_FROM || "2026-09-01";

function findRecordId(body, url) {
  const fromQuery =
    url.searchParams.get("id") ||
    url.searchParams.get("recordId") ||
    url.searchParams.get("RecordId");
  if (fromQuery) return String(fromQuery);

  if (!body || typeof body !== "object") return null;
  const candidates = [
    "recordId", "RecordId", "id", "Id",
    "opportunityId", "OpportunityId",
    "recordID", "entityId",
  ];
  for (const k of candidates) {
    if (body[k] != null && body[k] !== "") return String(body[k]);
  }
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (v && typeof v === "object") {
      for (const c of candidates) {
        if (v[c] != null && v[c] !== "") return String(v[c]);
      }
    }
  }
  return null;
}


// Tracker publish dates arrive as "2026-10-01T09:14:00". Comparing the first
// ten characters as strings is enough for an ISO date and avoids timezone
// drift around midnight. A blank publish date sorts below any floor, so a
// record with no publish date is treated as not advertised — which is right,
// because we cannot tell when it went out.
function publishedOnOrAfter(publishDate, floor) {
  return String(publishDate || "").slice(0, 10) >= floor;
}

function buildPayload(f, origin, token, force, seq) {
  const division = resolveDivision(f.department, f.consultant);

  const base = new URLSearchParams();
  if (f.department) base.set("division", f.department);
  if (f.consultant) base.set("consultant", f.consultant);
  if (f.title) base.set("title", f.title);
  if (f.location) base.set("location", f.location);
  if (f.employmentType) base.set("employment_type", f.employmentType);
  base.set("image", "auto");
  // Decides which of the three panel styles and which photo this advert gets.
  if (seq != null) base.set("seq", String(seq));
  if (token) base.set("token", token);

  const withSalary = new URLSearchParams(base);
  if (f.salaryFrom != null && f.salaryFrom !== "") withSalary.set("salary_from", String(f.salaryFrom));
  if (f.salaryTo != null && f.salaryTo !== "") withSalary.set("salary_to", String(f.salaryTo));
  if (f.salaryPeriod) withSalary.set("salary_period", f.salaryPeriod);

  const competitive = new URLSearchParams(base);
  competitive.set("salary_text", COMPETITIVE_LABEL);

  // Everyone who should receive this advert: the consultant, their desk
  // partner, the resourcers covering the area, and Sophie on CC.
  const recipients = recipientsFor({
    consultant: f.consultant,
    consultantEmail: f.consultantEmail,
    department: f.department,
    division,
  });

  return {
    id: f.id,
    // Use THIS as the de-duplication key in Zapier, not id.
    dedupeKey: dedupeKeyFor(f, division, force),
    title: f.title,
    consultant: f.consultant,
    consultantEmail: f.consultantEmail,
    // Map these straight into the Gmail step's To and CC fields.
    emailTo: recipients.to.join(", "),
    emailCc: recipients.cc.join(", "),
    // Names with no address on file — nobody is silently dropped.
    emailMissing: recipients.missing.join(", "),
    consultantSource: f.consultantSource,
    department: f.department,
    division,
    needsReview: !division && String(f.department || "").toUpperCase() !== "INTERNAL OFFICE",
    location: f.location,
    client: f.client,
    reference: f.reference,
    publishDate: f.publishDate,
    status: f.status,
    imageUrl: origin + "/api/og?" + withSalary.toString(),
    imageUrlCompetitive: origin + "/api/og?" + competitive.toString(),
  };
}

async function handle(req, body) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;

  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dryRun = url.searchParams.get("dry") === "1";
  const floor = url.searchParams.get("from") || ADVERTS_PUBLISHED_FROM;
  // ?force=1 — send this ad even if Zapier has already seen it. Skips the
  // publish-date gate too, so an old advert can be re-sent on request.
  const force = url.searchParams.get("force") === "1";
  const recordId = findRecordId(body, url);

  // Always answer 200 so Tracker does not retry or disable the webhook.
  const ok = (obj, status) => new Response(JSON.stringify(obj, null, 2), {
    status: status || 200, headers: { "content-type": "application/json" },
  });

  if (!recordId) {
    return ok({ ok: true, skipped: "no record id found in payload", received: body });
  }

  // A rejected look-up used to be reported as "record not found", which is
  // the same lie the preview page told: the advert was dropped silently and
  // the job looked like it simply did not exist. Tracker invalidates the
  // previous token on every exchange, so a burst of pings can leave one
  // instance holding a dead token — worth retrying before giving up.
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await getOpportunityResult(recordId);
    } catch (e) {
      result = { ok: false, status: 0, data: null, reason: String((e && e.message) || e) };
    }
    if (result.ok || result.status === 404) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }

  if (!result.ok && result.status !== 404) {
    // ok:false so this shows as a failure rather than a quiet skip. Nothing
    // has been claimed, so the next ping on this job will try again.
    return ok({
      ok: false,
      id: recordId,
      error: "could not read the job from Tracker: " + result.reason,
      note: "No advert was sent and nothing was recorded, so this job is not marked as done.",
    }, 200);
  }

  const opp = result.data;
  if (!opp) return ok({ ok: true, id: recordId, skipped: "record not found" });

  const f = mapOpportunity(opp);

  const reasons = [];
  if (!f.advertised) reasons.push("advertStatus is not A — job is not advertised");
  // Current pipeline status, not the historical filled date — a job filled in
  // July and re-advertised in October must still get an ad.
  if (f.dead) reasons.push("status is " + (f.status || "(none)") + " — not advertising");
  if (!f.title) reasons.push("no advert title");
  if (isExcludedDepartment(f.department)) reasons.push("excluded department");
  if (isTestRecord(f.title, f.client)) reasons.push("test or training record");

  if (!force && !publishedOnOrAfter(f.publishDate, floor)) {
    reasons.push(
      "advert published " + (String(f.publishDate || "").slice(0, 10) || "(no date)") +
      ", before the " + floor + " cut-off — this advert predates the automation"
    );
  }

  if (reasons.length) {
    return ok({ ok: true, id: recordId, title: f.title, skipped: reasons });
  }

  // One counter shared by every advert, so the styles rotate 1, 2, 3 rather
  // than each advert picking at random and repeating. A failure here must not
  // stop the advert — it only costs the rotation.
  let seq = null;
  if (kvConfigured()) {
    try { seq = await nextSequence(); } catch { seq = null; }
  }

  const payload = buildPayload(f, url.origin, token, force, seq);

  if (dryRun) {
    // The dry run used to stop here, which made it answer "why did this job
    // not produce an advert?" while skipping the likeliest reason: the advert
    // was recorded as sent and the email then never arrived. That leaves no
    // trace anywhere else, and the job looks perfectly healthy.
    //
    // Read-only — seen() never claims a key, so a dry run still cannot stop a
    // real advert later. ?force=1 makes the key deliberately unique, so the
    // check uses the plain key the webhook would actually have claimed.
    let alreadySent = null;
    let lastSent = null;
    if (kvConfigured()) {
      const division = resolveDivision(f.department, f.consultant);
      try { alreadySent = await seen(dedupeKeyFor(f, division)); } catch { alreadySent = null; }
      // What did the last advert for this job actually go out for? A publish
      // date older than the job's current one means it has been re-advertised
      // since, and if nothing on the advert changed the de-duplication key is
      // identical, so the webhook skipped it without a word. That is what
      // happened to job 45223 and it is the question this endpoint gets asked.
      try {
        const raw = await kvGet(lastSentKeyFor(f.id));
        if (raw) { try { lastSent = JSON.parse(raw); } catch { lastSent = null; } }
      } catch { lastSent = null; }
    }

    const publishDate = String(f.publishDate || "").slice(0, 10);
    const lastFor = lastSent ? String(lastSent.publishDate || "").slice(0, 10) : "";
    const reAdvertised = !!(alreadySent === true && lastFor && publishDate > lastFor);

    return ok({
      ok: true,
      dryRun: true,
      alreadySent,
      reAdvertised,
      lastAdvertSentFor: lastFor || null,
      lastAdvertSentAt: lastSent ? String(lastSent.sentAt || "").slice(0, 10) || null : null,
      verdict: reAdvertised
        ? "RE-ADVERTISED AND SKIPPED. The last advert went out on " +
          (String((lastSent && lastSent.sentAt) || "").slice(0, 10) || "an unknown date") +
          " for publish date " + lastFor + ", and this job now shows " + publishDate +
          ". Nothing on the advert itself changed, so it produced the same de-duplication key" +
          " and the webhook treated it as a repeat. Use the link below to send it."
        : alreadySent === true
          ? "already recorded as sent — the webhook would skip this." +
            (lastFor
              ? " The last advert went out for publish date " + lastFor + ", which matches this one."
              : " There is no record of WHICH advert went out (it predates that being kept), so a" +
                " re-advertise cannot be ruled out here — check the Sent folder.") +
            " If the email never arrived, re-send with the link below."
        : alreadySent === false
          ? "not in the memory — the webhook would send this advert"
          : "memory not checked (not configured, or unreachable)",
      resend: url.origin + "/api/tracker-hook?id=" + recordId + "&force=1" + (token ? "&token=" + token : ""),
      wouldSend: payload,
    });
  }

  // --- Has this exact advert already gone out? ---
  // Decided here rather than in Zapier. Zapier's storage capped at 500
  // entries and, once full, accepted writes and discarded them, so every
  // ping looked like a new advert and consultants were emailed on every
  // Tracker edit. claim() is atomic: it returns true only if this key was
  // not already present, and reserves it in the same step.
  if (!force && kvConfigured()) {
    let fresh;
    try {
      fresh = await claim(payload.dedupeKey);
    } catch (e) {
      // Never let a memory failure silence an advert. Better a duplicate
      // than a job that never reaches its consultant.
      return ok({ ok: true, id: recordId, title: f.title, sent: false, error: "memory unavailable: " + String((e && e.message) || e) });
    }
    if (!fresh) {
      return ok({ ok: true, id: recordId, title: f.title, skipped: ["already sent — nothing on the advert has changed"] });
    }
  }

  let forwarded = { ok: false };
  try {
    const r = await fetch(ZAPIER_HOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    forwarded = { ok: r.ok, status: r.status };
  } catch (e) {
    forwarded = { ok: false, error: String((e && e.message) || e) };
  }

  // Hand the reservation back if the send failed, so the next ping retries
  // instead of the job being marked done and going quiet for good.
  if (!forwarded.ok && !force && kvConfigured()) {
    try { await release(payload.dedupeKey); } catch { /* nothing useful to do */ }
  }

  // Record WHAT was advertised, not just that something was. The dedupe key
  // cannot tell a job re-advertised unchanged from one nobody has touched, so
  // the publish date this advert went out for is kept separately and the sweep
  // compares it against the job's current one. Written after the send, so a
  // failed send leaves no trace claiming otherwise. Reporting only — a failure
  // here must never cost an advert that has already gone out.
  if (forwarded.ok && kvConfigured()) {
    try {
      await kvSet(lastSentKeyFor(f.id), JSON.stringify({
        publishDate: String(f.publishDate || "").slice(0, 10),
        sentAt: new Date().toISOString(),
        title: f.title,
        forced: !!force,
      }), LAST_SENT_TTL_S);
    } catch { /* the advert is out; this is only the record of it */ }
  }

  return ok({ ok: true, id: recordId, title: f.title, sent: forwarded.ok, forwarded });
}

export async function POST(req) {
  let body = null;
  try {
    const text = await req.text();
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text }; } }
  } catch { body = null; }
  return handle(req, body);
}

export async function GET(req) {
  return handle(req, null);
}
