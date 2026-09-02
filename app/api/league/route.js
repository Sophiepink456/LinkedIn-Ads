export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Dropdown league table.
//
// A "dropdown" is recorded on an opportunity as two custom fields:
//   "Drop down by"         -> consultant name
//   "Drop down percentage" -> e.g. "100%", "50%"
//
// Value = job value x percentage. Counted for the month the job was AWARDED,
// regardless of what stage it has since reached.
//
// NOTE: Tracker's search does not return custom fields, so every candidate job
// has to be fetched individually. That is slow, which is why this endpoint
// reports its own timing — see ?debug=1.
// ---------------------------------------------------------------------------

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";

const MAX_PAGES = 80;
const CONCURRENCY = 12;      // parallel detail fetches
const MAX_DETAILS = 600;

const CF_DROPDOWN_BY = "Drop down by";
const CF_DROPDOWN_PCT = "Drop down percentage";

function monthStartISO(offsetMonths) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (offsetMonths || 0), 1));
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr) {
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
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
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + ")");
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const jwt = extractJwt(data);
  if (!jwt) throw new Error("No JWT returned");
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
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 300) };
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
    if (!r.ok) { meta.failedStatus = r.status; meta.failedBody = r.raw; break; }
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

// Fetch in batches rather than all at once — hundreds of simultaneous requests
// will be throttled or time out.
async function fetchDetails(jwt, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => getOpportunity(jwt, id)));
    out.push(...results.filter(Boolean));
  }
  return out;
}

function customField(opp, name) {
  const cf = Array.isArray(opp.customFields) ? opp.customFields : [];
  const hit = cf.find((f) => String(f.name || "").trim().toLowerCase() === name.toLowerCase());
  return hit ? String(hit.value == null ? "" : hit.value).trim() : "";
}

function parsePercent(raw) {
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  if (isNaN(n)) return null;
  return n / 100;
}

function cleanName(name) {
  return String(name || "").split("(")[0].trim();
}

export async function GET(req) {
  const started = Date.now();
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const debug = url.searchParams.get("debug") === "1";
  // ?month=-1 for last month, useful for checking against a finished period.
  const monthOffset = parseInt(url.searchParams.get("month") || "0", 10) || 0;
  const periodStart = monthStartISO(monthOffset);
  const wantMonth = monthKey(periodStart);

  let jwt;
  try {
    jwt = await getJwt();
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }, null, 2), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  // Trawl from the start of the period. A job awarded this month will have been
  // touched this month, so updatedAfter is a safe net to cast.
  //
  // NOTE: PagedSearch returns nothing for updatedAfter on its own — every call
  // that has worked also carried a state. "open" alone would miss jobs awarded
  // this month that have since been filled or lost, so each state is queried
  // and the results combined.
  const states = (url.searchParams.get("states") || "open,won,closed").split(",").map((s) => s.trim()).filter(Boolean);

  const seen = new Set();
  const shallow = [];
  const meta = { perState: {} };

  // First, a single unpaged call so the raw response can be inspected — the
  // paging loop hides why a query came back empty.
  const probe = await postJson(jwt, PAGED_SEARCH_PATH, {
    state: states[0], updatedAfter: periodStart, pageNumber: 1,
  });
  meta.probe = {
    sent: { state: states[0], updatedAfter: periodStart, pageNumber: 1 },
    status: probe.status,
    ok: probe.ok,
    keys: probe.data && !Array.isArray(probe.data) ? Object.keys(probe.data) : undefined,
    totalCount: probe.data && probe.data.totalCount,
    returned: asList(probe.data).length,
    raw: probe.ok ? undefined : probe.raw,
  };

  for (const state of states) {
    const r = await fetchAllPages(jwt, { state, updatedAfter: periodStart });
    meta.perState[state] = {
      returned: r.list.length,
      totalCount: r.meta.totalCount,
      failedStatus: r.meta.failedStatus,
      failedBody: r.meta.failedBody,
    };
    for (const o of r.list) {
      const id = o.opportunityId || o.id;
      if (id && !seen.has(id)) { seen.add(id); shallow.push(o); }
    }
  }
  meta.totalCount = shallow.length;

  const ids = shallow.map((o) => o.opportunityId || o.id).filter(Boolean).slice(0, MAX_DETAILS);
  const details = await fetchDetails(jwt, ids);

  const rows = [];
  const skipped = { noDropdown: 0, wrongMonth: 0, noValue: 0 };

  for (const opp of details) {
    const by = cleanName(customField(opp, CF_DROPDOWN_BY));
    const pctRaw = customField(opp, CF_DROPDOWN_PCT);
    if (!by) { skipped.noDropdown += 1; continue; }

    const awarded = opp.history && opp.history.awarded;
    if (monthKey(awarded) !== wantMonth) { skipped.wrongMonth += 1; continue; }

    const pct = parsePercent(pctRaw);
    const jobValue = Number(opp.estimatedValue);

    if (!pct || !jobValue) { skipped.noValue += 1; }

    rows.push({
      id: opp.id,
      title: (opp.advertDetails && opp.advertDetails.title) || opp.name,
      client: opp.client && opp.client.name,
      consultant: by,
      percentRaw: pctRaw,
      percent: pct,
      awarded,
      // Several candidates so the right "Job Value" field can be identified by
      // comparing these against what Tracker shows on screen.
      candidateValues: {
        estimatedValue: opp.estimatedValue,
        factoredValue: opp.factoredValue,
        payRate: opp.payRate,
        chargeRate: opp.chargeRate,
        probability: opp.probabiity,
      },
      // Working assumption: estimatedValue is Job Value.
      jobValue,
      dropdownValue: pct && jobValue ? Math.round(pct * jobValue) : 0,
    });
  }

  const totals = {};
  for (const r of rows) {
    if (!totals[r.consultant]) totals[r.consultant] = { consultant: r.consultant, total: 0, count: 0 };
    totals[r.consultant].total += r.dropdownValue;
    totals[r.consultant].count += 1;
  }

  const table = Object.values(totals)
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((t, i) => ({ position: i + 1, ...t }));

  const payload = {
    period: wantMonth,
    periodStart,
    generatedAt: new Date().toISOString(),
    table,
  };

  if (debug) {
    payload.debug = {
      elapsedMs: Date.now() - started,
      searchTotal: meta.totalCount,
      probe: meta.probe,
      perState: meta.perState,
      detailsFetched: details.length,
      dropdownsFound: rows.length,
      skipped,
      rows,
    };
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
