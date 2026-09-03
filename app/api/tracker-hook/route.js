import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision } from "../../../lib/config";
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

// Only advertise jobs whose ADVERT is new. Tracker has no "advertised" event,
// so without this an edit to an old job produces a fresh ad.
const MAX_ADVERT_AGE_DAYS = 3;

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

function daysBetween(dateStr) {
  const t = Date.parse(dateStr);
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

function buildPayload(f, origin, token) {
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

  return {
    id: f.id,
    title: f.title,
    consultant: f.consultant,
    consultantEmail: f.consultantEmail,
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
  const maxAge = parseInt(url.searchParams.get("maxage") || "", 10) || MAX_ADVERT_AGE_DAYS;
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

  const advertAge = daysBetween(f.publishDate);
  if (advertAge > maxAge) {
    reasons.push(
      "advert published " + Math.round(advertAge) + " days ago (limit " + maxAge +
      ") — this is an edit to an existing advert, not a new one"
    );
  }

  if (reasons.length) {
    return ok({ ok: true, id: recordId, title: f.title, skipped: reasons });
  }

  const payload = buildPayload(f, url.origin, token);
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
