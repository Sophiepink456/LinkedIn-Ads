import { mapOpportunity } from "../../../../lib/mapping";
import { COMPETITIVE_LABEL } from "../../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";

// ---------------------------------------------------------------------------
// Tracker's PagedSearch, as established by probing:
//   - honours publishOnline, state and updatedAfter
//   - IGNORES pageSize (always 10) and any sort parameters
//   - wraps results in "opportunities" with totalCount / hasNextPage alongside
//
// We ask for open, published jobs touched recently, then narrow to the ones
// actually PUBLISHED recently. Those are two different things: a job published
// in July can be updated today, and that is not a new advert.
// ---------------------------------------------------------------------------
const UPDATED_WITHIN_DAYS = 14;   // how far back to trawl; ?days=N
const PUBLISHED_WITHIN_DAYS = 3;  // what counts as a new advert; ?pubdays=N
const MAX_PAGES = 15;
const MAX_JOBS = 25;
const MAX_DETAIL_FETCHES = 30;

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
  while (page <= MAX_PAGES) {
    const r = await postJson(jwt, PAGED_SEARCH_PATH, { ...baseBody, pageNumber: page });
    if (!r.ok) break;
    const list = asList(r.data);
    all.push(...list);
    meta = { totalCount: r.data && r.data.totalCount, pagesFetched: page };
    if (!(r.data && r.data.hasNextPage) || list.length === 0) break;
    page += 1;
  }
  return { list: all, meta };
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
    publishOnline: true,
    state: "open",
    updatedAfter: daysAgoISO(days),
  };

  const { list: shallow, meta } = await fetchAllPages(jwt, query);

  // Narrow to jobs actually published recently. A job updated today but
  // published in July is not a new advert.
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
        publishDate: o.publishDate,
        updated: o.lastUpdatedDateTime,
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

      // Version A: the salary as Tracker holds it.
      const withSalary = new URLSearchParams(base);
      if (f.salaryFrom != null && f.salaryFrom !== "") withSalary.set("salary_from", String(f.salaryFrom));
      if (f.salaryTo != null && f.salaryTo !== "") withSalary.set("salary_to", String(f.salaryTo));
      if (f.salaryPeriod) withSalary.set("salary_period", f.salaryPeriod);

      // Version B: "Competitive" instead, for jobs where the salary is withheld.
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
