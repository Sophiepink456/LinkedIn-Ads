import { mapOpportunity } from "../../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision } from "../../../../lib/config";
import { getOpportunity, pagedSearch, trackerFetch } from "../../../../lib/tracker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The polling feed.
//
// IMPORTANT: this now uses the shared client in lib/tracker.js. It used to
// exchange its own JWT on every call, which invalidated the token the webhook
// endpoint was using — and vice versa. The two fought each other, producing
// intermittent 401s and silently empty results.
//
// Every route must use the shared client. Do not reintroduce a local
// getJwt() here.
// ---------------------------------------------------------------------------

const UPDATED_WITHIN_DAYS = 14;
const PUBLISHED_WITHIN_DAYS = 3;
const MAX_PAGES = 60;
const MAX_JOBS = 80;
const MAX_DETAIL_FETCHES = 80;
const CONCURRENCY = 10;

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function asList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.opportunities || data.data || data.results || data.items)) || [];
}

async function fetchAllPages(baseBody) {
  const all = [];
  let page = 1;
  const meta = { pagesFetched: 0, truncated: false };

  while (page <= MAX_PAGES) {
    const r = await pagedSearch({ ...baseBody, pageNumber: page });
    if (!r.ok) {
      // Surfaced rather than swallowed — an empty list and a failed call used
      // to look identical, which cost a lot of time.
      meta.failed = { status: r.status, body: r.raw };
      break;
    }
    const list = asList(r.data);
    all.push(...list);
    meta.pagesFetched = page;
    meta.totalCount = r.data && r.data.totalCount;
    if (!(r.data && r.data.hasNextPage) || list.length === 0) break;
    page += 1;
    if (page > MAX_PAGES) meta.truncated = true;
  }
  return { list: all, meta };
}

async function fetchDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => getOpportunity(id)));
    out.push(...results.filter(Boolean));
  }
  return out;
}

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const json = (obj, status) => new Response(JSON.stringify(obj, null, 2), {
    status: status || 200, headers: { "content-type": "application/json" },
  });

  const jobId = url.searchParams.get("job");
  const wantList = url.searchParams.get("list") === "1";
  const wantMeta = url.searchParams.get("meta") === "1";
  const days = parseInt(url.searchParams.get("days") || "", 10) || UPDATED_WITHIN_DAYS;
  const pubDays = parseInt(url.searchParams.get("pubdays") || "", 10) || PUBLISHED_WITHIN_DAYS;

  // ?meta=1 — webhook actions and the registered webhook list.
  if (wantMeta) {
    const out = {};
    for (const path of ["/api/v1/Webhook/Meta/Actions", "/api/v1/Webhook/List"]) {
      const r = await trackerFetch(path);
      out[path] = { status: r.status, body: r.ok ? r.data : r.raw };
    }
    return json(out);
  }

  // ?register=1 — (re)create the Tracker webhooks pointing at /api/tracker-hook.
  if (url.searchParams.get("register") === "1") {
    const hookUrl = url.origin + "/api/tracker-hook?token=" + encodeURIComponent(token || "");
    const results = [];
    for (const action of ["Created", "Updated"]) {
      const r = await trackerFetch("/api/v1/Webhook", {
        method: "POST",
        body: { url: hookUrl, action, recordType: "Opportunity" },
      });
      results.push({ action, status: r.status, ok: r.ok, body: r.ok ? r.data : r.raw });
    }
    return json({ hookUrl, results });
  }

  if (jobId) {
    const opp = await getOpportunity(jobId);
    if (!opp) return json({ error: "No record found for id " + jobId }, 404);
    if (url.searchParams.get("mapped") === "1") return json(mapOpportunity(opp));
    return json(opp);
  }

  const query = { state: "open", updatedAfter: daysAgoISO(days) };
  const { list: shallow, meta } = await fetchAllPages(query);

  // If the search itself failed, say so loudly rather than returning [].
  if (meta.failed) {
    return json({ error: "Tracker search failed", query, ...meta }, 502);
  }

  const publishedCutoff = daysAgoISO(pubDays);
  const recent = shallow
    .filter((o) => String(o.publishDate || "") >= publishedCutoff)
    .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  if (wantList) {
    return json({
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
        publishDate: o.publishDate,
      })),
    });
  }

  const ids = recent.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAIL_FETCHES);
  const details = await fetchDetails(ids);

  const origin = url.origin;

  const jobs = details
    .map((opp) => mapOpportunity(opp))
    .filter((f) => f.advertised && !f.filled && !f.closed && f.title)
    .filter((f) => !isExcludedDepartment(f.department))
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

  return json(jobs);
}
