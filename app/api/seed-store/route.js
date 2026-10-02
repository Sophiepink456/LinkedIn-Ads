import { mapOpportunity } from "../../../lib/mapping";
import { isExcludedDepartment, isTestRecord, resolveDivision, dedupeKeyFor } from "../../../lib/config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// ONE-OFF: pre-loads Zapier's Storage with the de-duplication key of every
// advert that is currently live in Tracker, so that switching the Zap over to
// the new key does not make hundreds of existing adverts look brand new.
//
// Run order — do NOT skip straight to write:
//
//   ?mode=peek                     what is in the store right now
//   ?mode=plan                     what WOULD be written (no writes)
//   ?mode=write&confirm=yes        actually write it
//
// Both plan and write work in slices. Start at offset=0 and follow the
// nextOffset in each response until it comes back null.
//
// Storage by Zapier's documented limits, which shape all of this:
//   * 500 values per secret   <- the binding constraint; peek reports headroom
//   * 32 characters per key   <- our keys are ~13
//   * 2500 bytes per value    <- we store a short marker
//   * values untouched for 2 months are pruned
//
// The secret never passes through a URL or a log. It is read from the
// ZAPIER_STORE_SECRET environment variable and sent to Zapier in a header.
// ---------------------------------------------------------------------------

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";
const PAGED_SEARCH_PATH = "/api/v1/Opportunity/PagedSearch";
const STORE_URL = "https://store.zapier.com/api/records";

const STORE_MAX_VALUES = 500;
const DEFAULT_LIMIT = 40;      // detail fetches per slice — keeps us inside the
                               // edge runtime's time budget
const DEFAULT_DAYS = 400;      // wide enough to mean "everything still open"
const MAX_PAGES = 120;         // PagedSearch always returns 10 per page

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

// Walks every page of the open-opportunity search and keeps the rows that are
// actually advertised. advertStatus is the signal, not publishOnline — see the
// note in lib/mapping.js.
async function candidateIds(jwt, days) {
  const all = [];
  let page = 1;
  let totalCount = null;
  let truncated = false;

  while (page <= MAX_PAGES) {
    const res = await fetch(TRACKER_BASE + PAGED_SEARCH_PATH, {
      method: "POST",
      headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "open", updatedAfter: daysAgoISO(days), pageNumber: page }),
    });
    if (!res.ok) break;
    let data = null;
    try { data = JSON.parse(await res.text()); } catch { break; }

    const rows = asList(data);
    if (totalCount == null) totalCount = data && data.totalCount;
    all.push(...rows);

    if (!(data && data.hasNextPage) || rows.length === 0) break;
    page += 1;
    if (page > MAX_PAGES) truncated = true;
  }

  const advertised = all.filter((o) => String(o.advertStatus || "").trim().toUpperCase() === "A");

  return {
    ids: advertised.map((o) => o.opportunityId || o.id).filter(Boolean).map(String),
    meta: { totalCount, pagesFetched: page, truncated, seen: all.length, advertised: advertised.length },
  };
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

async function storeGet() {
  const res = await fetch(STORE_URL, { headers: { "X-Secret": storeSecret() } });
  const text = await res.text();
  if (!res.ok) throw new Error("Store read failed (" + res.status + "): " + text.slice(0, 300));
  try { return JSON.parse(text); } catch { return {}; }
}

// POST merges the keys given into whatever is already there — it does not
// replace the store. Confirmed against Zapier's own API documentation before
// this was written, because a replace would have wiped the live de-duplication
// state.
async function storePut(pairs) {
  const res = await fetch(STORE_URL, {
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
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
  const limit = parseInt(url.searchParams.get("limit") || "", 10) || DEFAULT_LIMIT;
  const days = parseInt(url.searchParams.get("days") || "", 10) || DEFAULT_DAYS;

  // ---- peek: read-only look at the store ----------------------------------
  if (mode === "peek") {
    let store;
    try { store = await storeGet(); }
    catch (e) { return json({ error: String((e && e.message) || e) }, 502); }

    const keys = Object.keys(store);
    const sample = {};
    for (const k of keys.slice(0, 15)) sample[k] = store[k];

    return json({
      mode: "peek",
      valuesStored: keys.length,
      limit: STORE_MAX_VALUES,
      headroom: STORE_MAX_VALUES - keys.length,
      longestKey: keys.reduce((m, k) => Math.max(m, k.length), 0),
      // Tells us which scheme the live Zap is using right now.
      keysLookLikeNewScheme: keys.filter((k) => /^\d+-[0-9a-z]{4,8}$/.test(k)).length,
      keysLookLikeBareId: keys.filter((k) => /^\d+$/.test(k)).length,
      sample,
    });
  }

  if (mode !== "plan" && mode !== "write") {
    return json({ error: 'mode must be peek, plan or write' }, 400);
  }
  if (mode === "write" && url.searchParams.get("confirm") !== "yes") {
    return json({ error: 'write requires &confirm=yes' }, 400);
  }

  let jwt;
  try { jwt = await getJwt(); }
  catch (e) { return json({ error: String((e && e.message) || e) }, 502); }

  const { ids, meta } = await candidateIds(jwt, days);
  const slice = ids.slice(offset, offset + limit);

  const details = await Promise.all(slice.map((id) => getOpportunity(jwt, id)));

  const pairs = {};
  const rows = [];
  const skipped = [];

  for (const opp of details) {
    if (!opp) continue;
    const f = mapOpportunity(opp);

    // Mirror the webhook's own filters exactly. Anything the webhook would
    // never send must NOT be seeded, or a genuinely new advert could be
    // silenced later by a key we pre-loaded for no reason.
    if (!f.advertised || f.filled || f.closed || !f.title) { skipped.push({ id: f.id, why: "not a live advert" }); continue; }
    if (isExcludedDepartment(f.department)) { skipped.push({ id: f.id, why: "excluded department" }); continue; }
    if (isTestRecord(f.title, f.client)) { skipped.push({ id: f.id, why: "test record" }); continue; }

    const division = resolveDivision(f.department, f.consultant);
    const key = dedupeKeyFor(f, division);
    pairs[key] = "seeded-" + new Date().toISOString().slice(0, 10);
    rows.push({ id: f.id, title: f.title, key });
  }

  const nextOffset = offset + limit < ids.length ? offset + limit : null;

  const out = {
    mode,
    tracker: meta,
    candidates: ids.length,
    sliceRange: offset + "-" + Math.min(offset + limit, ids.length),
    wouldWrite: Object.keys(pairs).length,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 10),
    rows,
    nextOffset,
  };

  if (mode === "plan") return json(out);

  // Guard against blowing the 500-value ceiling half way through.
  let existing = 0;
  try { existing = Object.keys(await storeGet()).length; }
  catch (e) { return json({ error: "could not read store before writing: " + String((e && e.message) || e) }, 502); }

  if (existing + Object.keys(pairs).length > STORE_MAX_VALUES) {
    return json({
      ...out,
      aborted: true,
      reason: "would exceed Storage by Zapier's " + STORE_MAX_VALUES + "-value limit",
      valuesStored: existing,
      headroom: STORE_MAX_VALUES - existing,
    }, 409);
  }

  const written = Object.keys(pairs).length ? await storePut(pairs) : { ok: true, status: 204, body: "nothing to write" };

  return json({ ...out, written, valuesStoredBefore: existing });
}
