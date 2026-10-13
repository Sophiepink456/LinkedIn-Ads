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

export async function stored() {
  const r = await cmd(["DBSIZE"]);
  return r.result;
}

export async function ping() {
  const r = await cmd(["PING"]);
  return r.result;
}

export { TTL_DAYS };
