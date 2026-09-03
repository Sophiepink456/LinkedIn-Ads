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

const TRACKER_BASE = process.env.TRACKER_BASE || "https://evoglapi.tracker-rms.com";
const AUTH_PATH = "/api/Auth/ExchangeToken";

// Tokens are reused for this long before being exchanged again. Kept well
// under any plausible expiry.
const TOKEN_TTL_MS = 10 * 60 * 1000;

let cachedJwt = null;
let cachedAt = 0;
let inFlight = null;

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
  const fresh = cachedJwt && !force && (Date.now() - cachedAt) < TOKEN_TTL_MS;
  if (fresh) return cachedJwt;

  // If an exchange is already running, wait for it rather than starting a
  // second one — two simultaneous exchanges would invalidate each other.
  if (inFlight) return inFlight;

  inFlight = exchangeToken()
    .then((jwt) => {
      cachedJwt = jwt;
      cachedAt = Date.now();
      inFlight = null;
      return jwt;
    })
    .catch((e) => {
      inFlight = null;
      throw e;
    });

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

  let jwt = await getJwt();
  let res = await doCall(jwt);

  if (res.status === 401) {
    jwt = await getJwt(true);   // force a fresh one
    res = await doCall(jwt);
  }

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 300) };
}

export async function getOpportunity(id) {
  const r = await trackerFetch("/api/v1/Opportunity/" + encodeURIComponent(id));
  return r.ok ? r.data : null;
}

export async function pagedSearch(body) {
  return trackerFetch("/api/v1/Opportunity/PagedSearch", { method: "POST", body: body || {} });
}

export { TRACKER_BASE };
