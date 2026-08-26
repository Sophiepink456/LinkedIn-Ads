import { mapOpportunity } from "../../../../lib/mapping";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// --- Tracker REST API (UK / "global" region) ------------------------------
const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const SEARCH_PATH = "/api/v1/Opportunity/Search";
const MAX_JOBS = 25;

// Pull a JWT out of whatever shape Tracker hands back.
function extractJwt(data) {
  if (!data) return null;
  if (typeof data === "string") return data.trim() || null;
  return (
    data.token ||
    data.jwt ||
    data.accessToken ||
    data.access_token ||
    data.Token ||
    data.JWT ||
    (data.data && (data.data.token || data.data.jwt || data.data.accessToken)) ||
    null
  );
}

// Tracker's docs are thin on the exact ExchangeToken payload, so we try the
// realistic variants in order and keep the first one that works. Whatever
// succeeds, note it here so this can be trimmed back to a single call later.
function authAttempts(bearer) {
  const json = { "Content-Type": "application/json" };
  const auth = { Authorization: "Bearer " + bearer };
  return [
    { label: "header + empty body", url: AUTH_PATH, method: "POST", headers: { ...auth, ...json }, body: "{}" },
    { label: "header, no body", url: AUTH_PATH, method: "POST", headers: { ...auth } },
    { label: "body: token", url: AUTH_PATH, method: "POST", headers: json, body: JSON.stringify({ token: bearer }) },
    { label: "body: apiKey", url: AUTH_PATH, method: "POST", headers: json, body: JSON.stringify({ apiKey: bearer }) },
    { label: "body: bearerToken", url: AUTH_PATH, method: "POST", headers: json, body: JSON.stringify({ bearerToken: bearer }) },
    { label: "raw string body", url: AUTH_PATH, method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(bearer) },
    { label: "query param", url: AUTH_PATH + "?token=" + encodeURIComponent(bearer), method: "POST", headers: { ...auth, ...json }, body: "{}" },
    { label: "GET + header", url: AUTH_PATH, method: "GET", headers: { ...auth } },
  ];
}

async function getJwt(debug) {
  const bearer = process.env.TRACKER_BEARER_TOKEN;
  if (!bearer) throw new Error("TRACKER_BEARER_TOKEN env var is not set");

  const failures = [];

  for (const a of authAttempts(bearer)) {
    let res, text;
    try {
      res = await fetch(TRACKER_BASE + a.url, { method: a.method, headers: a.headers, body: a.body });
      text = await res.text();
    } catch (e) {
      failures.push(a.label + " -> network error: " + String((e && e.message) || e));
      continue;
    }

    if (!res.ok) {
      failures.push(a.label + " -> " + res.status + ": " + text.slice(0, 300));
      continue;
    }

    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    const jwt = extractJwt(data);
    if (jwt) {
      if (debug) debug.authVariant = a.label;
      return jwt;
    }
    failures.push(a.label + " -> 200 but no JWT found in: " + text.slice(0, 300));
  }

  const err = new Error("Token exchange failed. Attempts:\n" + failures.join("\n"));
  err.failures = failures;
  throw err;
}

async function searchOpportunities(jwt) {
  const res = await fetch(TRACKER_BASE + SEARCH_PATH, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Opportunity search failed (" + res.status + "): " + text.slice(0, 500));
  }
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (Array.isArray(data)) return data;
  return (data && (data.data || data.results || data.items)) || [];
}

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const debug = {};
  const wantDebug = url.searchParams.get("debug") === "1";

  let list;
  try {
    const jwt = await getJwt(debug);
    list = await searchOpportunities(jwt);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e && e.message) || e), attempts: (e && e.failures) || undefined }, null, 2),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (wantDebug) {
    return new Response(
      JSON.stringify({ authVariant: debug.authVariant, count: list.length, sample: list.slice(0, 2) }, null, 2),
      { headers: { "content-type": "application/json" } }
    );
  }

  const origin = url.origin;
  const jobs = list
    .map((opp) => ({ opp, f: mapOpportunity(opp) }))
    .filter((x) => x.f.advertised && x.f.title)
    .slice(0, MAX_JOBS)
    .map(({ opp, f }) => {
      const p = new URLSearchParams();
      if (f.division) p.set("division", f.division);
      if (f.consultant) p.set("consultant", f.consultant);
      if (f.title) p.set("title", f.title);
      if (f.location) p.set("location", f.location);
      if (f.salaryFrom != null && f.salaryFrom !== "") p.set("salary_from", String(f.salaryFrom));
      if (f.salaryTo != null && f.salaryTo !== "") p.set("salary_to", String(f.salaryTo));
      if (f.salaryPeriod) p.set("salary_period", f.salaryPeriod);
      if (f.hideSalary) p.set("hide_salary", f.hideSalary);
      if (f.employmentType) p.set("employment_type", f.employmentType);
      if (f.workingPattern) p.set("working_pattern", f.workingPattern);
      p.set("image", "auto");
      if (token) p.set("token", token);
      return {
        id: String(opp.advertId || opp.opportunityId || ""),
        title: f.title,
        consultant: f.consultant,
        division: f.division,
        location: f.location,
        imageUrl: origin + "/api/og?" + p.toString(),
      };
    });

  return new Response(JSON.stringify(jobs), {
    headers: { "content-type": "application/json" },
  });
}
