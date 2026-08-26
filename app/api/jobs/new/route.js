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

// Confirmed by probing: PagedSearch honours publishOnline and wraps its
// results in an "opportunities" key, with paging metadata alongside.
const LIVE_QUERY = { publishOnline: true, pageNumber: 1, pageSize: 100 };

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

// PagedSearch nests results under "opportunities". Plain Search returns a bare
// array. Handle both.
function asList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.opportunities || data.data || data.results || data.items || data.records)) || [];
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

function shallowDate(o) {
  return String(o.publishDate || o.lastUpdatedDateTime || o.creationDate || "");
}

// Focused probe: now that PagedSearch is understood, work out how many live
// jobs there are and whether sorting is honoured.
const PROBE_BODIES = [
  { label: "paged: publishOnline true", body: { publishOnline: true, pageNumber: 1, pageSize: 100 } },
  { label: "paged: publishOnline + state open", body: { publishOnline: true, state: "open", pageNumber: 1, pageSize: 100 } },
  { label: "paged: sort publishDate desc", body: { publishOnline: true, sortField: "publishDate", sortDir: "desc", pageNumber: 1, pageSize: 100 } },
  { label: "paged: sort lastUpdated desc", body: { publishOnline: true, sortField: "lastUpdatedDateTime", sortDir: "desc", pageNumber: 1, pageSize: 100 } },
  { label: "paged: updatedAfter 2026-08-01", body: { publishOnline: true, updatedAfter: "2026-08-01", pageNumber: 1, pageSize: 100 } },
  { label: "paged: pageSize 5 (is it honoured?)", body: { publishOnline: true, pageNumber: 1, pageSize: 5 } },
];

async function runProbe(jwt) {
  const results = [];
  for (const p of PROBE_BODIES) {
    const r = await postJson(jwt, PAGED_SEARCH_PATH, p.body);
    if (!r.ok) {
      results.push({ tried: p.label, status: r.status, error: r.text.slice(0, 200) });
      continue;
    }
    const list = asList(r.data);
    results.push({
      tried: p.label,
      returned: list.length,
      totalCount: r.data && r.data.totalCount,
      totalPages: r.data && r.data.totalPages,
      pageSizeEcho: r.data && r.data.pageSize,
      first: list[0] ? { title: list[0].publishTitle || list[0].opportunityName || list[0].name, date: shallowDate(list[0]), online: list[0].publishOnline } : null,
      last: list.length > 1 ? { title: list[list.length - 1].publishTitle || list[list.length - 1].opportunityName || list[list.length - 1].name, date: shallowDate(list[list.length - 1]) } : null,
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
  const wantList = url.searchParams.get("list") === "1";

  let jwt;
  try {
    jwt = await getJwt();
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

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

  if (wantProbe) {
    const results = await runProbe(jwt);
    return new Response(JSON.stringify({ results }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- Fetch the live jobs -------------------------------------------------
  let search = await postJson(jwt, PAGED_SEARCH_PATH, LIVE_QUERY);
  let usedEndpoint = "PagedSearch";

  // Fall back to plain Search if PagedSearch ever misbehaves.
  if (!search.ok || asList(search.data).length === 0) {
    search = await postJson(jwt, SEARCH_PATH, { publishOnline: true });
    usedEndpoint = "Search (fallback)";
  }

  if (!search.ok) {
    return new Response(JSON.stringify({ error: "Search failed (" + search.status + "): " + search.text.slice(0, 300) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  const shallow = asList(search.data);

  // ?list=1 — the shallow list before any detail fetching, for checking what
  // the search actually returned.
  if (wantList) {
    return new Response(JSON.stringify({
      endpoint: usedEndpoint,
      returned: shallow.length,
      totalCount: search.data && search.data.totalCount,
      rows: shallow.map((o) => ({
        id: o.opportunityId || o.id,
        title: o.publishTitle || o.opportunityName || o.name,
        online: o.publishOnline,
        status: o.opportunityStatusDesc,
        publishDate: o.publishDate,
      })),
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

  // Newest first, then fetch the full record for each — the search results are
  // too thin to build an ad from.
  const ids = shallow
    .slice()
    .sort((a, b) => shallowDate(b).localeCompare(shallowDate(a)))
    .map((o) => o.opportunityId || o.id)
    .filter(Boolean)
    .slice(0, MAX_DETAIL_FETCHES);

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
