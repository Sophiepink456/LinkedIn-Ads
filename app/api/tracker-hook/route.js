import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision, recipientsFor, dedupeKeyFor } from "../../../lib/config";
import { getOpportunity } from "../../../lib/tracker";

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

function buildPayload(f, origin, token, force) {
  const division = resolveDivision(f.department, f.consultant);

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

  let opp;
  try {
    opp = await getOpportunity(recordId);
  } catch (e) {
    return ok({ ok: false, id: recordId, error: String((e && e.message) || e) });
  }

  if (!opp) return ok({ ok: true, id: recordId, skipped: "record not found" });

  const f = mapOpportunity(opp);

  const reasons = [];
  if (!f.advertised) reasons.push("advertStatus is not A — job is not advertised");
  if (f.filled) reasons.push("job is filled");
  if (f.closed) reasons.push("job is closed");
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

  const payload = buildPayload(f, url.origin, token, force);
  if (dryRun) return ok({ ok: true, dryRun: true, wouldSend: payload });

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

  return ok({ ok: true, id: recordId, title: f.title, sent: true, forwarded });
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
