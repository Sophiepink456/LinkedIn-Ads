import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL, isExcludedDepartment, isTestRecord, resolveDivision } from "../../../lib/config";
import { getOpportunity, pagedSearch } from "../../../lib/tracker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Daily safety net.
//
// The webhook occasionally misses a job — a ping arriving during a deploy, or
// an advert that never fired an Opportunity event. Those misses are silent:
// nothing errors, the ad simply never arrives, and you only find out when a
// consultant asks.
//
// This lists every advert published in the last couple of days, so anything
// missed is still visible. It does NOT talk to the ads Zap and cannot cause a
// duplicate — it is a report, not a sender.
//
// Intended use: a Schedule by Zapier trigger each morning -> Webhooks GET this
// URL -> Gmail the summary to Sophie.
// ---------------------------------------------------------------------------

const LOOKBACK_DAYS = 2;      // adverts published within this window
const TRAWL_DAYS = 7;         // how far back to search for candidates
const MAX_PAGES = 40;
const MAX_DETAILS = 120;
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
  while (page <= MAX_PAGES) {
    const r = await pagedSearch({ ...baseBody, pageNumber: page });
    if (!r.ok) break;
    const list = asList(r.data);
    all.push(...list);
    if (!(r.data && r.data.hasNextPage) || list.length === 0) break;
    page += 1;
  }
  return all;
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

  const days = parseInt(url.searchParams.get("days") || "", 10) || LOOKBACK_DAYS;
  const cutoff = daysAgoISO(days);

  let shallow;
  try {
    shallow = await fetchAllPages({ state: "open", updatedAfter: daysAgoISO(TRAWL_DAYS) });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  const recent = shallow
    .filter((o) => String(o.publishDate || "") >= cutoff)
    .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  const ids = recent.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAILS);
  const details = await fetchDetails(ids);

  const origin = url.origin;

  const jobs = details
    .map((opp) => mapOpportunity(opp))
    .filter((f) => f.advertised && !f.filled && !f.closed && f.title)
    .filter((f) => !isExcludedDepartment(f.department))
    .filter((f) => !isTestRecord(f.title, f.client))
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
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
        division,
        location: f.location,
        client: f.client,
        publishDate: String(f.publishDate).slice(0, 10),
        imageUrl: origin + "/api/og?" + withSalary.toString(),
        imageUrlCompetitive: origin + "/api/og?" + competitive.toString(),
      };
    });

  // A ready-made email body, so the Zap can just drop it into Gmail.
  const lines = jobs.map((j) =>
    j.publishDate + "  —  " + j.title + "  —  " + j.consultant + " (" + (j.division || "no division") + ")\n" +
    "    With salary:  " + j.imageUrl + "\n" +
    "    Competitive:  " + j.imageUrlCompetitive
  );

  const summary =
    jobs.length === 0
      ? "No adverts published in the last " + days + " days."
      : jobs.length + " advert(s) published in the last " + days + " days:\n\n" + lines.join("\n\n") +
        "\n\nIf any of these did not arrive as an ad, the links above will render them.";

  return new Response(JSON.stringify({
    generatedAt: new Date().toISOString(),
    publishedOnOrAfter: cutoff,
    count: jobs.length,
    summary,
    jobs,
  }, null, 2), { headers: { "content-type": "application/json" } });
}
