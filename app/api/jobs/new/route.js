import { mapOpportunity } from "../../../../lib/mapping";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const SEARCH_PATH = "/api/v1/Opportunity/Search";
const MAX_JOBS = 25;

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
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + "): " + text.slice(0, 400));
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const jwt = extractJwt(data);
  if (!jwt) throw new Error("Exchange succeeded but no JWT found in: " + text.slice(0, 400));
  return jwt;
}

// Fetch one opportunity in full. Single-record endpoints usually return more
// than search results do — custom fields in particular.
async function getOpportunity(jwt, id) {
  const res = await fetch(TRACKER_BASE + "/api/v1/Opportunity/" + encodeURIComponent(id), {
    method: "GET",
    headers: { Authorization: "Bearer " + jwt },
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Get opportunity " + id + " failed (" + res.status + "): " + text.slice(0, 400));
  try { return JSON.parse(text); } catch { return text; }
}

async function searchOpportunities(jwt) {
  const res = await fetch(TRACKER_BASE + SEARCH_PATH, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Opportunity search failed (" + res.status + "): " + text.slice(0, 500));
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

  const jobId = url.searchParams.get("job");
  const wantDebug = url.searchParams.get("debug") === "1";
  const wantFields = url.searchParams.get("fields") === "1";
  const showAll = url.searchParams.get("all") === "1";

  let jwt;
  try {
    jwt = await getJwt();
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  // ?job=51401 — dump one opportunity in full. This is how we find out what a
  // genuinely live, published job looks like, and whether custom fields come
  // back on the single-record endpoint.
  if (jobId) {
    try {
      const opp = await getOpportunity(jwt, jobId);
      return new Response(JSON.stringify(opp, null, 2), {
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
        status: 502, headers: { "content-type": "application/json" },
      });
    }
  }

  let list;
  try {
    list = await searchOpportunities(jwt);
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  if (wantDebug) {
    return new Response(JSON.stringify({ count: list.length, sample: list.slice(0, 2) }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  if (wantFields) {
    const rows = list.map((o) => ({
      id: o.opportunityId,
      ref: o.publishReference || "",
      title: (o.publishTitle || o.opportunityName || "").trim(),
      online: o.publishOnline,
      status: o.opportunityStatusDesc,
      salaryFrom: o.publishSalaryFrom,
      salaryTo: o.publishSalaryTo,
      salaryPer: o.publishSalaryPer,
      rate: o.opportunityRate,
      benefits: o.publishBenefits,
    }));
    return new Response(JSON.stringify({ count: rows.length, rows }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  const origin = url.origin;

  const jobs = list
    .map((opp) => ({ opp, f: mapOpportunity(opp) }))
    .filter((x) => showAll || (x.f.advertised && x.f.active && !x.f.dead && x.f.title))
    .sort((a, b) => String(b.f.publishDate).localeCompare(String(a.f.publishDate)))
    .slice(0, MAX_JOBS)
    .map(({ opp, f }) => {
      const p = new URLSearchParams();
      if (f.division) p.set("division", f.division);
      if (f.consultant) p.set("consultant", f.consultant);
      if (f.title) p.set("title", f.title);
      if (f.location) p.set("location", f.location);
      if (!f.hideSalary) {
        if (f.salaryFrom != null && f.salaryFrom !== "") p.set("salary_from", String(f.salaryFrom));
        if (f.salaryTo != null && f.salaryTo !== "") p.set("salary_to", String(f.salaryTo));
        if (f.salaryPeriod) p.set("salary_period", f.salaryPeriod);
      }
      if (f.employmentType) p.set("employment_type", f.employmentType);
      p.set("image", "auto");
      if (token) p.set("token", token);

      return {
        id: String(opp.opportunityId || ""),
        title: f.title,
        consultant: f.consultant,
        division: f.division,
        location: f.location,
        publishDate: f.publishDate,
        status: f.statusDesc,
        salaryShown: f.hideSalary ? "hidden" : "shown",
        salaryReason: f.hideSalaryReason,
        imageUrl: origin + "/api/og?" + p.toString(),
      };
    });

  return new Response(JSON.stringify(jobs), {
    headers: { "content-type": "application/json" },
  });
}
