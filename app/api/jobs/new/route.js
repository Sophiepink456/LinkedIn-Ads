import { mapOpportunity } from "../../../../lib/mapping";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// --- Tracker REST API (UK / "global" region) ------------------------------
// Confirmed format: POST /api/Auth/ExchangeToken with { "bearerToken": "..." }
const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const SEARCH_PATH = "/api/v1/Opportunity/Search";
const MAX_JOBS = 25;

// Tracker sends "Sheffield, South Yorkshire" — the ad only wants the town.
// Takes everything before the first comma; single-word locations pass through
// unchanged.
function shortLocation(loc) {
  return (loc || "").split(",")[0].trim();
}

// Titles occasionally carry a trailing space from Tracker, which pushes the
// full stop away from the last letter on the ad.
function cleanTitle(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

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

async function getJwt() {
  const bearer = (process.env.TRACKER_BEARER_TOKEN || "").trim();
  if (!bearer) throw new Error("TRACKER_BEARER_TOKEN env var is not set");

  const res = await fetch(TRACKER_BASE + AUTH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bearerToken: bearer }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      "Token exchange failed (" + res.status + "): " + text.slice(0, 400) +
      " [token length seen: " + bearer.length + "]"
    );
  }

  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const jwt = extractJwt(data);
  if (!jwt) throw new Error("Exchange succeeded but no JWT found in: " + text.slice(0, 400));
  return jwt;
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

  const wantDebug = url.searchParams.get("debug") === "1";

  let list;
  try {
    const jwt = await getJwt();
    list = await searchOpportunities(jwt);
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  // ?debug=1 shows the raw Tracker records so we can confirm the exact field
  // names for salary-hide and full/part-time.
  if (wantDebug) {
    return new Response(JSON.stringify({ count: list.length, sample: list.slice(0, 2) }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  const origin = url.origin;
  const jobs = list
    .map((opp) => ({ opp, f: mapOpportunity(opp) }))
    .filter((x) => x.f.advertised && x.f.title)
    .slice(0, MAX_JOBS)
    .map(({ opp, f }) => {
      const title = cleanTitle(f.title);
      const location = shortLocation(f.location);

      const p = new URLSearchParams();
      if (f.division) p.set("division", f.division);
      if (f.consultant) p.set("consultant", f.consultant);
      if (title) p.set("title", title);
      if (location) p.set("location", location);
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
        title,
        consultant: f.consultant,
        division: f.division,
        location,
        imageUrl: origin + "/api/og?" + p.toString(),
      };
    });

  return new Response(JSON.stringify(jobs), {
    headers: { "content-type": "application/json" },
  });
}
