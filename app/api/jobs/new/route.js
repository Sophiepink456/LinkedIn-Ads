import { mapOpportunity } from "../../../../lib/mapping";
import { COMPETITIVE_LABEL } from "../../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const SEARCH_PATH = "/api/v1/Opportunity/Search";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";
const MAX_JOBS = 25;
const MAX_DETAIL_FETCHES = 30;

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

async function postJson(jwt, path, body) {
  const res = await fetch(TRACKER_BASE + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }
  return { ok: res.ok, status: res.status, text, data };
}

function asList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.data || data.results || data.items || data.records)) || [];
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

// The search endpoint's parameters are undocumented. This tries the realistic
// shapes and reports what each returns, so we can see which ones the API
// actually honours instead of guessing.
const PROBE_BODIES = [
  { label: "empty", path: SEARCH_PATH, body: {} },
  { label: "pageNumber/pageSize", path: SEARCH_PATH, body: { pageNumber: 1, pageSize: 100 } },
  { label: "pageNum/numRecords", path: SEARCH_PATH, body: { pageNum: 0, numRecords: 100 } },
  { label: "page/pageSize", path: SEARCH_PATH, body: { page: 1, pageSize: 100 } },
  { label: "sort publishDate desc", path: SEARCH_PATH, body: { sortField: "publishDate", sortDir: "desc" } },
  { label: "sort lastUpdated desc", path: SEARCH_PATH, body: { sortField: "lastUpdatedDateTime", sortDir: "desc" } },
  { label: "publishOnline true", path: SEARCH_PATH, body: { publishOnline: true } },
  { label: "state open", path: SEARCH_PATH, body: { state: "open" } },
  { label: "status open", path: SEARCH_PATH, body: { status: "Open" } },
  { label: "includeCustomFields", path: SEARCH_PATH, body: { includeCustomFields: true } },
  { label: "updatedAfter 2026-08-01", path: SEARCH_PATH, body: { updatedAfter: "2026-08-01" } },
  { label: "searchText blank", path: SEARCH_PATH, body: { searchText: "" } },
  { label: "PagedSearch empty", path: PAGED_SEARCH_PATH, body: {} },
  { label: "PagedSearch page 1 size 100", path: PAGED_SEARCH_PATH, body: { pageNumber: 1, pageSize: 100 } },
  { label: "PagedSearch pageNum 0", path: PAGED_SEARCH_PATH, body: { pageNum: 0, numRecords: 100 } },
];

async function runProbe(jwt) {
  const results = [];
  for (const p of PROBE_BODIES) {
    const r = await postJson(jwt, p.path, p.body);
    if (!r.ok) {
      results.push({ tried: p.label, status: r.status, error: r.text.slice(0, 200) });
      continue;
    }
    const list = asList(r.data);
    results.push({
      tried: p.label,
      status: r.status,
      count: list.length,
      firstTitle: list[0] ? (list[0].publishTitle || list[0].opportunityName || list[0].name || "?") : null,
      lastTitle: list.length > 1 ? (list[list.length - 1].publishTitle || list[list.length - 1].opportunityName || list[list.length - 1].name || "?") : null,
      keys: r.data && !Array.isArray(r.data) ? Object.keys(r.data).slice(0, 12) : undefined,
    });
  }
  return results;
}

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobId = url.searchParams.get("job");
  const wantProbe = url.searchParams.get("probe") === "1";

  let jwt;
  try {
    jwt = await getJwt();
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  // ?job=44469 — dump one opportunity in full.
  if (jobId) {
    const opp = await getOpportunity(jwt, jobId);
    if (!opp) {
      return new Response(JSON.stringify({ error: "No record found for id " + jobId }, null, 2), {
        status: 404, headers: { "content-type": "application/json" },
      });
    }
    if (url.searchParams.get("mapped") === "1") {
      return new Response(JSON.stringify(mapOpportunity(opp), null, 2), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(opp, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // ?probe=1 — work out which search parameters the API honours.
  if (wantProbe) {
    const results = await runProbe(jwt);
    return new Response(JSON.stringify({ results }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- Normal feed ---------------------------------------------------------
  const search = await postJson(jwt, SEARCH_PATH, {});
  if (!search.ok) {
    return new Response(JSON.stringify({ error: "Search failed (" + search.status + "): " + search.text.slice(0, 300) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  const shallow = asList(search.data);

  // The search results are too thin to judge, so fetch each record in full.
  const ids = shallow.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAIL_FETCHES);
  const details = await Promise.all(ids.map((id) => getOpportunity(jwt, id)));

  const origin = url.origin;

  const jobs = details
    .filter(Boolean)
    .map((opp) => mapOpportunity(opp))
    .filter((f) => f.advertised && !f.filled && !f.closed && f.title)
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
    .slice(0, MAX_JOBS)
    .map((f) => {
      const base = new URLSearchParams();
      if (f.division) base.set("division", f.division);
      if (f.consultant) base.set("consultant", f.consultant);
      if (f.title) base.set("title", f.title);
      if (f.location) base.set("location", f.location);
      if (f.employmentType) base.set("employment_type", f.employmentType);
      base.set("image", "auto");
      if (token) base.set("token", token);

      // Version A — the salary as Tracker holds it.
      const withSalary = new URLSearchParams(base);
      if (f.salaryFrom != null && f.salaryFrom !== "") withSalary.set("salary_from", String(f.salaryFrom));
      if (f.salaryTo != null && f.salaryTo !== "") withSalary.set("salary_to", String(f.salaryTo));
      if (f.salaryPeriod) withSalary.set("salary_period", f.salaryPeriod);

      // Version B — "Competitive" in place of the figures, for jobs where the
      // salary is being withheld. Tracker's API does not expose the hide-salary
      // tickbox, so both are sent and a human picks.
      const competitive = new URLSearchParams(base);
      competitive.set("salary_text", COMPETITIVE_LABEL);

      return {
        id: f.id,
        title: f.title,
        consultant: f.consultant,
        consultantSource: f.consultantSource,
        division: f.division,
        location: f.location,
        client: f.client,
        reference: f.reference,
        publishDate: f.publishDate,
        status: f.status,
        imageUrl: origin + "/api/og?" + withSalary.toString(),
        imageUrlCompetitive: origin + "/api/og?" + competitive.toString(),
      };
    });

  return new Response(JSON.stringify(jobs), {
    headers: { "content-type": "application/json" },
  });
}
