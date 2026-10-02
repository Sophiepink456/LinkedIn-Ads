import { mapOpportunity } from "../../../lib/mapping";
import { isExcludedDepartment, isTestRecord, resolveDivision, dedupeKeyFor } from "../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// ONE-OFF: pre-loads Zapier's Storage with the de-duplication key of every
// advert currently live in Tracker, so switching the Zap to the new key does
// not make hundreds of existing adverts look brand new.
//
// v2. The first version re-walked the whole opportunity search on every call
// and timed out. Tracker's PagedSearch ignores pageSize and always returns 10
// records a page, so a wide window is hundreds of requests. Everything is now
// bounded: listing pages and writing records are separate calls, and each one
// is told exactly how much to do.
//
//   ?mode=peek                          what is in the store
//   ?mode=ids&page=1&pages=25           list advertised ids, 25 pages at a time
//   ?mode=plan&ids=1,2,3                keys those ids would get (no writes)
//   ?mode=write&ids=1,2,3&confirm=yes   write them
//
// Storage by Zapier's limits, which shape all of this:
//   500 values per secret · 32 chars per key · 2500 bytes per value
//   values untouched for 2 months are pruned
//
// The secret is read from ZAPIER_STORE_SECRET and sent in a header, so it
// never appears in a URL or a log.
// ---------------------------------------------------------------------------

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";
const STORE_URL = "https://store.zapier.com/api/records";

const STORE_MAX_VALUES = 500;
const DEFAULT_DAYS = 400;
const DEFAULT_PAGES = 25;    // ~10 records a page; keeps one call well inside
                             // the edge runtime's time budget
const MAX_IDS_PER_CALL = 40;

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// --- Tracker ---------------------------------------------------------------

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
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + "): " + text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const jwt = extractJwt(data);
  if (!jwt) throw new Error("Exchange succeeded but no JWT found");
  return jwt;
}

function asList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.opportunities || data.data || data.results || data.items)) || [];
}

async function getOpportunity(jwt, id) {
  const res = await fetch(TRACKER_BASE + "/api/v1/Opportunity/" + encodeURIComponent(id), {
    method: "GET",
    headers: { Authorization: "Bearer " + jwt },
  });
  if (!res.ok) return null;
  try { return JSON.parse(await res.text()); } catch { return null; }
}

// --- Zapier Storage --------------------------------------------------------

function storeSecret() {
  const s = (process.env.ZAPIER_STORE_SECRET || "").trim();
  if (!s) throw new Error("ZAPIER_STORE_SECRET env var is not set");
  return s;
}

// Zapier accepts the secret as ?secret= or as an X-Secret header. Writes sent
// with the header alone came back 201, echoing the data, but every read then
// returned an empty store — so the two were not landing in the same place.
// Both forms are now sent on every request, which costs nothing and removes
// the ambiguity. ?mode=diag proves which combination actually round-trips.
function storeUrl() {
  return STORE_URL + "?secret=" + encodeURIComponent(storeSecret());
}

async function storeGet() {
  const res = await fetch(storeUrl(), { headers: { "X-Secret": storeSecret() } });
  const text = await res.text();
  if (!res.ok) throw new Error("Store read failed (" + res.status + "): " + text.slice(0, 300));
  try { return JSON.parse(text); } catch { return {}; }
}

// Writes a probe key four ways and reads it back after each, so we can see
// exactly which transport Zapier honours rather than inferring it from a
// status code that is 201 either way.
async function storeDiag() {
  const secret = storeSecret();
  const probe = "diag-" + Date.now().toString(36).slice(-5);
  const out = [];

  const attempts = [
    { name: "query param only", url: STORE_URL + "?secret=" + encodeURIComponent(secret), headers: {} },
    { name: "header only",      url: STORE_URL,                                            headers: { "X-Secret": secret } },
    { name: "both",             url: STORE_URL + "?secret=" + encodeURIComponent(secret), headers: { "X-Secret": secret } },
  ];

  for (const a of attempts) {
    const key = probe + "-" + a.name.replace(/[^a-z]/g, "").slice(0, 6);
    let put = {};
    try {
      const r = await fetch(a.url, {
        method: "POST",
        headers: { ...a.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: "probe" }),
      });
      put = { status: r.status, body: (await r.text()).slice(0, 160) };
    } catch (e) { put = { error: String((e && e.message) || e) }; }

    // read it back the same way it was written
    let readBack = {};
    try {
      const r = await fetch(a.url, { headers: a.headers });
      const text = await r.text();
      let obj = {};
      try { obj = JSON.parse(text); } catch { /* leave empty */ }
      readBack = { status: r.status, keyCount: Object.keys(obj).length, foundProbe: Object.prototype.hasOwnProperty.call(obj, key) };
    } catch (e) { readBack = { error: String((e && e.message) || e) }; }

    out.push({ transport: a.name, wrote: key, put, readBack });
  }

  return { probe, secretLength: secret.length, attempts: out };
}

// POST merges the given keys into whatever is already there; it does not
// replace the store. Checked against Zapier's API docs before writing this,
// because a replace would have wiped the live de-duplication state.
async function storePut(pairs) {
  const res = await fetch(storeUrl(), {
    method: "POST",
    headers: { "X-Secret": storeSecret(), "Content-Type": "application/json" },
    body: JSON.stringify(pairs),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

// --- route -----------------------------------------------------------------

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const mode = url.searchParams.get("mode") || "peek";

  // ---- diag: which transport actually round-trips? ----------------------
  if (mode === "diag") {
    try { return json(await storeDiag()); }
    catch (e) { return json({ error: String((e && e.message) || e) }); }
  }

  // ---- peek -----------------------------------------------------------
  if (mode === "peek") {
    let store;
    try { store = await storeGet(); }
    catch (e) { return json({ error: String((e && e.message) || e) }, 200); }

    const keys = Object.keys(store);
    const sample = {};
    for (const k of keys.slice(0, 10)) sample[k] = store[k];

    return json({
      mode: "peek",
      valuesStored: keys.length,
      limit: STORE_MAX_VALUES,
      headroom: STORE_MAX_VALUES - keys.length,
      longestKey: keys.reduce((m, k) => Math.max(m, k.length), 0),
      keysLookLikeNewScheme: keys.filter((k) => /^\d+-[0-9a-z]{4,8}$/.test(k)).length,
      keysLookLikeBareId: keys.filter((k) => /^\d+$/.test(k)).length,
      sample,
    });
  }

  let jwt;
  try { jwt = await getJwt(); }
  catch (e) { return json({ error: String((e && e.message) || e) }, 200); }

  // ---- ids: walk a bounded number of search pages ----------------------
  if (mode === "ids") {
    const startPage = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const pages = Math.min(parseInt(url.searchParams.get("pages") || "", 10) || DEFAULT_PAGES, 40);
    const days = parseInt(url.searchParams.get("days") || "", 10) || DEFAULT_DAYS;

    // &filter=1 asks Tracker to do the advertStatus filtering server-side.
    // Undocumented, so compare totalCount with and without before trusting it.
    const useFilter = url.searchParams.get("filter") === "1";
    const query = { state: "open", updatedAfter: daysAgoISO(days) };
    if (useFilter) query.advertStatus = "A";

    const advertised = [];
    let seen = 0;
    let totalCount = null;
    let page = startPage;
    let hasMore = false;
    let lastPage = startPage - 1;

    for (let n = 0; n < pages; n++) {
      const res = await fetch(TRACKER_BASE + PAGED_SEARCH_PATH, {
        method: "POST",
        headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
        body: JSON.stringify({ ...query, pageNumber: page }),
      });
      if (!res.ok) break;
      let data = null;
      try { data = JSON.parse(await res.text()); } catch { break; }

      const rows = asList(data);
      if (totalCount == null) totalCount = data && data.totalCount;
      seen += rows.length;
      lastPage = page;

      for (const o of rows) {
        if (String(o.advertStatus || "").trim().toUpperCase() === "A") {
          const id = o.opportunityId || o.id;
          if (id) advertised.push(String(id));
        }
      }

      hasMore = !!(data && data.hasNextPage) && rows.length > 0;
      if (!hasMore) break;
      page += 1;
    }

    return json({
      mode: "ids",
      query,
      totalCount,
      pagesWalked: lastPage - startPage + 1,
      fromPage: startPage,
      lastPage,
      seen,
      advertisedCount: advertised.length,
      hasMore,
      nextPage: hasMore ? lastPage + 1 : null,
      ids: advertised,
    });
  }

  // ---- plan / write: explicit id list ----------------------------------
  if (mode !== "plan" && mode !== "write") {
    return json({ error: "mode must be peek, ids, plan or write" }, 400);
  }
  if (mode === "write" && url.searchParams.get("confirm") !== "yes") {
    return json({ error: "write requires &confirm=yes" }, 400);
  }

  const ids = (url.searchParams.get("ids") || "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS_PER_CALL);

  if (!ids.length) return json({ error: "pass &ids=1,2,3 (max " + MAX_IDS_PER_CALL + ")" }, 400);

  const details = await Promise.all(ids.map((id) => getOpportunity(jwt, id)));

  const pairs = {};
  const rows = [];
  const skipped = [];

  for (const opp of details) {
    if (!opp) continue;
    const f = mapOpportunity(opp);

    // Mirror the webhook's filters exactly. Anything the webhook would never
    // send must NOT be seeded, or a genuinely new advert could later be
    // silenced by a key we pre-loaded for no reason.
    if (!f.advertised || f.filled || f.closed || !f.title) { skipped.push({ id: f.id, why: "not a live advert" }); continue; }
    if (isExcludedDepartment(f.department)) { skipped.push({ id: f.id, why: "excluded department" }); continue; }
    if (isTestRecord(f.title, f.client)) { skipped.push({ id: f.id, why: "test record" }); continue; }

    const division = resolveDivision(f.department, f.consultant);
    const key = dedupeKeyFor(f, division);
    pairs[key] = "seeded-" + new Date().toISOString().slice(0, 10);
    rows.push({ id: f.id, key, title: f.title });
  }

  const out = {
    mode,
    asked: ids.length,
    wouldWrite: Object.keys(pairs).length,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 10),
    rows,
  };

  if (mode === "plan") return json(out);

  let existing = 0;
  try { existing = Object.keys(await storeGet()).length; }
  catch (e) { return json({ error: "could not read store before writing: " + String((e && e.message) || e) }, 200); }

  if (existing + Object.keys(pairs).length > STORE_MAX_VALUES) {
    return json({
      ...out,
      aborted: true,
      reason: "would exceed Storage by Zapier's " + STORE_MAX_VALUES + "-value limit",
      valuesStored: existing,
      headroom: STORE_MAX_VALUES - existing,
    });
  }

  const written = Object.keys(pairs).length
    ? await storePut(pairs)
    : { ok: true, status: 204, body: "nothing to write" };

  return json({ ...out, written, valuesStoredBefore: existing, valuesStoredAfter: existing + Object.keys(pairs).length });
}
