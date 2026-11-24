// Upstash Redis over its REST API — the de-duplication memory.
//
// Replaces Storage by Zapier, which capped at 500 entries, silently dropped
// writes once full (returning 201 while discarding them), and had no delete
// that worked. On 13 October that combination had the live Zap treating every
// Tracker ping as a brand new advert, so consultants got an ad every time
// anyone touched a job.
//
// Keys expire on their own after TTL_DAYS, so nothing has to be pruned and
// the store cannot fill. A job genuinely re-advertised after that long gets a
// fresh ad, which is the right outcome anyway.

const BASE = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PREFIX = "ad:";
const TTL_DAYS = 90;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

export function kvConfigured() {
  return !!(BASE && TOKEN);
}

async function cmd(args) {
  if (!kvConfigured()) throw new Error("UPSTASH_REDIS_REST_URL / _TOKEN not set");
  const res = await fetch(BASE, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Upstash " + res.status + ": " + text.slice(0, 200));
  try { return JSON.parse(text); } catch { return {}; }
}

// Reserve a key. Returns true only if it was NOT already there, so the check
// and the record happen in one atomic step — two webhooks arriving together
// cannot both decide they are first.
export async function claim(key) {
  const r = await cmd(["SET", PREFIX + key, "1", "NX", "EX", String(TTL_SECONDS)]);
  return r.result === "OK";
}

// Hand a reservation back when the send failed, so the ad is retried rather
// than silently lost. This is the half of the old Zapier setup that could not
// be done: there, a job was marked as sent before the email went out, so an
// interrupted run silenced that job permanently.
export async function release(key) {
  await cmd(["DEL", PREFIX + key]);
}

export async function markSeen(key) {
  await cmd(["SET", PREFIX + key, "1", "EX", String(TTL_SECONDS)]);
}

export async function seen(key) {
  const r = await cmd(["GET", PREFIX + key]);
  return r.result != null;
}

// DBSIZE reports 1 on this Upstash tier no matter how many keys exist, which
// made the seeding look like it was failing when it was working perfectly.
// SCAN walks the keyspace for real.
export async function stored() {
  let cursor = "0";
  let n = 0;
  let guard = 0;
  do {
    const r = await cmd(["SCAN", cursor, "MATCH", PREFIX + "*", "COUNT", "500"]);
    const [next, keys] = r.result || ["0", []];
    cursor = String(next);
    n += (keys || []).length;
  } while (cursor !== "0" && ++guard < 40);
  return n;
}

// A number that goes up by one each time an advert is sent. The renderer uses
// it to step through the three panel styles and the photo pool, so consecutive
// adverts alternate instead of repeating at random.
export async function nextSequence() {
  const r = await cmd(["INCR", PREFIX + "seq"]);
  const n = Number(r.result);
  return Number.isFinite(n) ? n : 0;
}

export async function ping() {
  const r = await cmd(["PING"]);
  return r.result;
}

// ---- Raw helpers -----------------------------------------------------------
// Used by lib/tracker.js to share one Tracker token across every serverless
// instance. Each instance exchanging its own token is what was killing them:
// Tracker invalidates the previous token on every exchange.

export async function kvGet(key) {
  const r = await cmd(["GET", PREFIX + key]);
  return r.result == null ? null : String(r.result);
}

// Several keys in ONE request. The sweep reads a record per job, and at ~110
// jobs a GET each would mean 110 more round trips from an edge function that
// is already making one per job for the de-duplication check.
export async function kvMGet(keys) {
  if (!keys.length) return [];
  const r = await cmd(["MGET", ...keys.map((k) => PREFIX + k)]);
  const out = Array.isArray(r.result) ? r.result : [];
  return keys.map((_, i) => (out[i] == null ? null : String(out[i])));
}

export async function kvSet(key, value, ttlSeconds) {
  await cmd(["SET", PREFIX + key, String(value), "EX", String(Math.max(1, Math.round(ttlSeconds)))]);
}

// Returns true only if the key was not already there — used as a short lock so
// one instance exchanges and the rest wait for the result.
export async function kvSetNx(key, value, ttlSeconds) {
  const r = await cmd(["SET", PREFIX + key, String(value), "NX", "EX", String(Math.max(1, Math.round(ttlSeconds)))]);
  return r.result === "OK";
}

export async function kvDel(key) {
  await cmd(["DEL", PREFIX + key]);
}

export { TTL_DAYS };
