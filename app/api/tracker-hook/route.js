import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision } from "../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Receives Tracker's webhook ping, fetches the job LIVE (not via the search
// index, which lags by hours), checks whether it is genuinely advertised, and
// forwards it to Zapier if so.
//
// Tracker's payload only says "this record changed" — it carries no job data,
// so the callback to /Opportunity/{Id} is required.
//
// IMPORTANT: Tracker fires on every update, and a job is edited many times
// over its life. Zapier's Catch Hook does NOT de-duplicate, so the receiving
// Zap must use Storage by Zapier to check the job id before emailing, or the
// same ad will go out repeatedly.
// ---------------------------------------------------------------------------

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";

// Where qualifying jobs are sent. Override with a ZAPIER_HOOK_URL env var if
// the Zap is ever rebuilt.
const ZAPIER_HOOK =
  process.env.ZAPIER_HOOK_URL || "https://hooks.zapier.com/hooks/catch/20911531/4hr9bki/";

// Ignore adverts published longer ago than this. Stops an edit to an old job
// from generating a fresh ad months later.
const MAX_ADVERT_AGE_DAYS = 14;

function extractJwt(data) {
  if (!data) return null;
  if (typeof data === "string") return data.trim() || null;
  return (
    data.token || data.jwt || data.accessToken || data.access_token ||
    data.Token || data.JWT ||
    (data.data && (data.data.token || data.data.jwt || data.data.accessToken)) || null
  );
}

async function getJwt() {
  const bearer = (process.env.TRACKER_BEARER_TOKEN || "").trim();
  if (!bearer) throw new Error("TRACKER_BEARER_TOKEN env var is not set");
  const res = await fetch(TRACKER_BASE + AUTH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bearerToken: bearer }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + "): " + text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const jwt = extractJwt(data);
  if (!jwt) throw new Error("No JWT returned");
  return jwt;
}

async function getOpportunity(jwt, id) {
  const res = await fetch(TRACKER_BASE + "/api/v1/Opportunity/" + encodeURIComponent(id), {
    method: "GET",
    headers: { Authorization: "Bearer " + jwt },
  });
  if (!res.ok) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

// Tracker's payload shape is not documented, so look for an id under any of
// the names it might plausibly use.
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
  // Sometimes nested one level down.
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

  // The webhook URL registered with Tracker carries ?token=... so nobody else
  // can trigger this endpoint.
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dryRun = url.searchParams.get("dry") === "1";
  const recordId = findRecordId(body, url);

  if (!recordId) {
    // Always answer 200 so Tracker does not retry or disable the webhook.
    return new Response(JSON.stringify({
      ok: true,
      skipped: "no record id found in payload",
      received: body,
    }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
  }

  let jwt, opp;
  try {
    jwt = await getJwt();
    opp = await getOpportunity(jwt, recordId);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  if (!opp) {
    return new Response(JSON.stringify({ ok: true, id: recordId, skipped: "record not found" }, null, 2), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const f = mapOpportunity(opp);

  // Same checks as the polling feed, so behaviour does not change — only the
  // timing does.
  const reasons = [];
  if (!f.advertised) reasons.push("advertStatus is not A — job is not advertised");
  if (f.filled) reasons.push("job is filled");
  if (f.closed) reasons.push("job is closed");
  if (!f.title) reasons.push("no advert title");
  if (isExcludedDepartment(f.department)) reasons.push("excluded department");
  if (isTestRecord(f.title, f.client)) reasons.push("test or training record");
  if (daysBetween(f.publishDate) > MAX_ADVERT_AGE_DAYS) {
    reasons.push("advert published more than " + MAX_ADVERT_AGE_DAYS + " days ago");
  }

  if (reasons.length) {
    return new Response(JSON.stringify({ ok: true, id: recordId, title: f.title, skipped: reasons }, null, 2), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const payload = buildPayload(f, url.origin, token);

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dryRun: true, wouldSend: payload }, null, 2), {
      status: 200, headers: { "content-type": "application/json" },
    });
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

  return new Response(JSON.stringify({ ok: true, id: recordId, title: f.title, sent: true, forwarded }, null, 2), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export async function POST(req) {
  let body = null;
  try {
    const text = await req.text();
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text }; } }
  } catch { body = null; }
  return handle(req, body);
}

// GET so the endpoint can be tested from a browser:
//   /api/tracker-hook?token=...&id=44772&dry=1
export async function GET(req) {
  return handle(req, null);
}
