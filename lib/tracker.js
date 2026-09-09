// Shared Tracker API client.
//
// THE PROBLEM THIS SOLVES
//
// Tracker appears to allow only ONE valid JWT per API token at a time —
// exchanging a new one invalidates whatever was issued before. That is fine
// with a single caller, but this app runs across several Vercel instances,
// each with its own cache, and the webhook spawns new ones constantly. Every
// exchange kills the token another instance is about to use.
//
// The symptom was maddening: identical calls returning 401 and 200 alternately
// within the same run, with a token that was demonstrably valid.
//
// The fix is not to avoid the race — we cannot, without shared storage — but
// to survive it: take a fresh token and use it immediately, and if that one
// has already been killed, try again. A few attempts is enough in practice.
//
// A proper fix would be a shared token store (Vercel KV or Edge Config) so all
// instances use one token. Worth doing if the retries ever prove insufficient.

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";

const TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 250;

let cachedJwt = null;
let cachedAt = 0;
let inFlight = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

export async function getJwt(force) {
  if (cachedJwt && !force && (Date.now() - cachedAt) < TOKEN_TTL_MS) return cachedJwt;
  if (inFlight && !force) return inFlight;

  inFlight = exchangeToken()
    .then((jwt) => { cachedJwt = jwt; cachedAt = Date.now(); inFlight = null; return jwt; })
    .catch((e) => { inFlight = null; throw e; });

  return inFlight;
}

// Any Tracker call, retried through token invalidation.
export async function trackerFetch(path, options) {
  const opts = options || {};
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // First attempt uses the cache; every retry forces a brand new token,
    // because a 401 means the one we hold has already been killed.
    const jwt = await getJwt(attempt > 1);

    const headers = { Authorization: "Bearer " + jwt };
    if (opts.body) headers["Content-Type"] = "application/json";

    const res = await fetch(TRACKER_BASE + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    lastStatus = res.status;
    lastRaw = text.slice(0, 300);

    if (res.status !== 401) {
      let data = null;
      try { data = JSON.parse(text); } catch { /* leave null */ }
      return { ok: res.ok, status: res.status, data, raw: lastRaw, attempts: attempt };
    }

    // Killed again. Clear the cache and pause briefly so a competing exchange
    // has a moment to settle before we try once more.
    cachedJwt = null;
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }

  return { ok: false, status: lastStatus, data: null, raw: lastRaw, attempts: MAX_ATTEMPTS };
}

export async function getOpportunity(id) {
  const r = await trackerFetch("/api/v1/Opportunity/" + encodeURIComponent(id));
  return r.ok ? r.data : null;
}

export async function pagedSearch(body) {
  return trackerFetch("/api/v1/Opportunity/PagedSearch", { method: "POST", body: body || {} });
}

export { TRACKER_BASE };
