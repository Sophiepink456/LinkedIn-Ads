// Shared Tracker API client.
//
// WHY THIS EXISTS: every route used to exchange a fresh JWT on every request.
// Once the webhook went live that meant dozens of exchanges a minute, and
// Tracker appears to invalidate the previous token each time a new one is
// issued — so requests started failing with 401 even though the token had
// just been created.
//
// This caches the token and reuses it, cutting exchanges from dozens a minute
// to a handful an hour, and retries once with a fresh token if a call is
// rejected anyway.

import { kvGet, kvSet, kvSetNx, kvDel, kvConfigured } from "./kv";

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";

// Tokens are reused for this long before being exchanged again. Kept well
// under any plausible expiry.
const TOKEN_TTL_MS = 10 * 60 * 1000;

// ---- Why the token is shared ----------------------------------------------
// Tracker invalidates the previous token every time a new one is issued, and
// this runs on serverless instances that do not share memory. Every cold
// start exchanged its own token and killed whatever the other instances were
// holding. With the webhook firing on every edit a consultant makes, tokens
// were dying within seconds of being issued: look-ups came back 401, and the
// webhook reported "record not found" and dropped the advert without trace.
//
// So the token lives in Redis, shared by every instance, and only one
// instance exchanges at a time. SHARED_TTL is deliberately shorter than the
// in-memory TTL so a stored token is replaced before it is near expiry.
const SHARED_KEY = "tracker:jwt";
const LOCK_KEY = "tracker:jwt:lock";
const SHARED_TTL_S = 30 * 60;
const LOCK_TTL_S = 20;

let cachedJwt = null;
let cachedAt = 0;
let inFlight = null;
// Bumped every time a new token is cached. A call that is rejected while a
// refresh has ALREADY happened must not force another one: see getJwt.
let tokenGen = 0;

function extractJwt(data) {
  if (!data) return null;
  if (typeof data === "string") return data.trim() || null;
  return (
    data.token || data.jwt || data.accessToken || data.access_token ||
    data.Token || data.JWT ||
    (data.data && (data.data.token || data.data.jwt || data.data.accessToken)) || null
  );
}

async function exchangeToken() {
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

export function currentTokenGen() {
  return tokenGen;
}

// `seenGen` is the generation the caller's token came from. If the cached
// token has moved on since, somebody else has already refreshed and this
// caller simply missed it — hand back the current one instead of exchanging
// again. Without this, several parallel calls rejected at the same moment
// each force their own exchange, and because Tracker invalidates the previous
// token on every exchange, they knock each other out in turn: the first
// request succeeds and the rest come back 401. That is what made four job
// look-ups on one page report "not found in Tracker" while the same job
// looked up on its own was found.
function remember(jwt) {
  cachedJwt = jwt;
  cachedAt = Date.now();
  tokenGen += 1;
  return jwt;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exchange a token and publish it for every other instance to use. Only the
// holder of the lock does this; everybody else waits and reads the result.
async function exchangeShared() {
  const got = await kvSetNx(LOCK_KEY, "1", LOCK_TTL_S);
  if (!got) {
    // Someone else is exchanging. Wait for their token rather than issuing
    // one of our own, which would invalidate theirs the moment it appeared.
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      const shared = await kvGet(SHARED_KEY);
      if (shared) return remember(shared);
    }
    // They never published one. Fall through and exchange anyway.
  }
  try {
    const jwt = await exchangeToken();
    await kvSet(SHARED_KEY, jwt, SHARED_TTL_S);
    return remember(jwt);
  } finally {
    try { await kvDel(LOCK_KEY); } catch { /* it expires on its own */ }
  }
}

export async function getJwt(force, seenGen) {
  if (force && cachedJwt && seenGen !== undefined && seenGen !== tokenGen) {
    return cachedJwt;
  }

  const fresh = cachedJwt && !force && (Date.now() - cachedAt) < TOKEN_TTL_MS;
  if (fresh) return cachedJwt;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!kvConfigured()) return remember(await exchangeToken());

    // A token another instance has already published beats minting one here.
    if (!force) {
      const shared = await kvGet(SHARED_KEY);
      if (shared) return remember(shared);
    } else {
      // Forced: the token we were using is dead, so clear it for everyone
      // before exchanging, or the others keep presenting the same dead one.
      try { await kvDel(SHARED_KEY); } catch { /* best effort */ }
    }
    return exchangeShared();
  })()
    .then((jwt) => { inFlight = null; return jwt; })
    .catch((e) => { inFlight = null; throw e; });

  return inFlight;
}

// Any Tracker call. Retries once with a brand new token if rejected, which
// covers a cached token having been invalidated by something else.
export async function trackerFetch(path, options) {
  const opts = options || {};
  const doCall = async (jwt) => {
    const headers = { Authorization: "Bearer " + jwt };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(TRACKER_BASE + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  };

  const gen = tokenGen;
  let jwt = await getJwt();
  let res = await doCall(jwt);

  // Two attempts at a refresh: the first may hand back a token another caller
  // had already fetched, which could itself since have been invalidated.
  for (let attempt = 0; attempt < 2 && res.status === 401; attempt++) {
    jwt = await getJwt(true, attempt === 0 ? gen : undefined);
    res = await doCall(jwt);
  }

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 300) };
}

// The full result, so a caller can tell "this job does not exist" apart from
// "Tracker would not answer". getOpportunity collapses both to null, which
// had the preview page telling Sophie four real jobs were not in Tracker when
// the look-ups had actually been rejected.
export async function getOpportunityResult(id) {
  const r = await trackerFetch("/api/v1/Opportunity/" + encodeURIComponent(id));
  return {
    ok: r.ok,
    status: r.status,
    data: r.ok ? r.data : null,
    reason: r.ok ? null
      : r.status === 404 ? "no job with this id in Tracker"
      : r.status === 401 || r.status === 403 ? "Tracker rejected the look-up (" + r.status + ") — not an authorisation the job controls"
      : "Tracker returned " + r.status + (r.raw ? ": " + r.raw.slice(0, 120) : ""),
  };
}

export async function getOpportunity(id) {
  const r = await getOpportunityResult(id);
  return r.data;
}

export async function pagedSearch(body) {
  return trackerFetch("/api/v1/Opportunity/PagedSearch", { method: "POST", body: body || {} });
}

export { TRACKER_BASE };
