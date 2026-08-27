import { mapOpportunity } from "../../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision } from "../../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";

// ---------------------------------------------------------------------------
// Tracker's PagedSearch honours state and updatedAfter, ignores pageSize
// (always 10) and all sort parameters, and nests results under "opportunities".
//
// publishOnline is deliberately NOT used. Despite its label it does not track
// the website: jobs appear there with it set to false. advertStatus "A" is the
// signal, with internal test records excluded by name and client instead.
//
// Without the publishOnline filter the query returns ~456 records, so the page
// cap matters — truncated:true in the ?list=1 output warns if it is ever hit.
// ---------------------------------------------------------------------------
const UPDATED_WITHIN_DAYS = 14;
const PUBLISHED_WITHIN_DAYS = 3;
const MAX_PAGES = 60;
const MAX_JOBS = 80;
const MAX_DETAIL_FETCHES = 80;

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

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
  return (data && (data.opportunities || data.data || data.results || data.items)) || [];
}

async function fetchAllPages(jwt, baseBody) {
  const all = [];
  let page = 1;
  let meta = {};
  let truncated = false;

  while (page <= MAX_PAGES) {
    const r = await postJson(jwt, PAGED_SEARCH_PATH, { ...baseBody, pageNumber: page });
    if (!r.ok) break;
    const list = asList(r.data);
    all.push(...list);
    meta = { totalCount: r.data && r.data.totalCount, pagesFetched: page };

    if (!(r.data && r.data.hasNextPage) || list.length === 0) break;
    page += 1;
    if (page > MAX_PAGES) truncated = true;
  }

  return { list: all, meta: { ...meta, truncated } };
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

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobId = url.searchParams.get("job");
  const wantList = url.searchParams.get("list") === "1";
  const days = parseInt(url.searchParams.get("days") || "", 10) || UPDATED_WITHIN_DAYS;
  const pubDays = parseInt(url.searchParams.get("pubdays") || "", 10) || PUBLISHED_WITHIN_DAYS;

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

  const query = {
    state: "open",
    updatedAfter: daysAgoISO(days),
  };

  const { list: shallow, meta } = await fetchAllPages(jwt, query);

  const publishedCutoff = daysAgoISO(pubDays);
  const recent = shallow
    .filter((o) => String(o.publishDate || "") >= publishedCutoff)
    .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  if (wantList) {
    return new Response(JSON.stringify({
      query,
      publishedOnOrAfter: publishedCutoff,
      ...meta,
      matchedUpdateWindow: shallow.length,
      matchedPublishWindow: recent.length,
      rows: recent.map((o) => ({
        id: o.opportunityId || o.id,
        title: o.publishTitle || o.opportunityName || o.name,
        status: o.opportunityStatusDesc,
        advertStatus: o.advertStatus,
        publishOnline: o.publishOnline,
        publishDate: o.publishDate,
      })),
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

  const ids = recent.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAIL_FETCHES);
  const details = await Promise.all(ids.map((id) => getOpportunity(jwt, id)));

  const origin = url.origin;

  const jobs = details
    .filter(Boolean)
    .map((opp) => mapOpportunity(opp))
    .filter((f) => f.advertised && !f.filled && !f.closed && f.title)
    .filter((f) => !isExcludedDepartment(f.department))
    // Internal test and training records — see config.js.
    .filter((f) => !isTestRecord(f.title, f.client))
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
    .slice(0, MAX_JOBS)
    .map((f) => {
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
        // Ready for when the emails go to consultants rather than to you.
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
    });

  return new Response(JSON.stringify(jobs), {
    headers: { "content-type": "application/json" },
  });
}
