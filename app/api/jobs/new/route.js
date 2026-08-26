import { mapOpportunity } from "../../../../lib/mapping";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// --- Tracker REST API (UK / "global" region) ------------------------------
// If you're ever on the US/CA region, change the base. These two paths follow
// Tracker's REST API docs; if a call returns 401/404 when you test with your
// token, THIS is the first place to adjust.
const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const SEARCH_PATH = "/api/v1/Opportunity/Search";
const MAX_JOBS = 25;

async function getJwt() {
  const bearer = process.env.TRACKER_BEARER_TOKEN;
  if (!bearer) throw new Error("TRACKER_BEARER_TOKEN env var is not set");
  const res = await fetch(TRACKER_BASE + AUTH_PATH, {
    method: "POST",
    headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + ")");
  const data = await res.json().catch(() => null);
  if (typeof data === "string") return data;
  return (data && (data.token || data.jwt || data.accessToken || data.access_token)) || null;
}

async function searchOpportunities(jwt) {
  const res = await fetch(TRACKER_BASE + SEARCH_PATH, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify({}), // return recent jobs; refine the filter once live
  });
  if (!res.ok) throw new Error("Opportunity search failed (" + res.status + ")");
  const data = await res.json();
  if (Array.isArray(data)) return data;
  return (data && (data.data || data.results || data.items)) || [];
}

// Zapier's "Retrieve Poll" trigger calls this on a schedule and de-duplicates
// by the `id` field, so we just return the current advertised jobs — no state
// needed here. Each job includes a ready-to-use imageUrl.
export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let list;
  try {
    const jwt = await getJwt();
    if (!jwt) throw new Error("No JWT returned from token exchange");
    list = await searchOpportunities(jwt);
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
      status: 502, headers: { "content-type": "application/json" },
    });
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
