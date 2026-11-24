import { TRACKER_BASE } from "../../../lib/tracker";
import { kvConfigured, ping } from "../../../lib/kv";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// What is Tracker ACTUALLY saying?
//
// Every Tracker look-up started failing with 401 on 23 November. Two fixes
// were deployed on reasoning alone — first the look-ups were assumed to be
// rejecting each other, then every instance was assumed to be minting its own
// token — and neither helped, because both were guesses about a response
// nobody had read.
//
// This performs the two steps by hand and reports exactly what comes back:
// the token exchange, then one Opportunity look-up with the token it issued.
//
// Deliberately leaks nothing: the bearer token and the JWT are reported only
// by length, shape and a few characters at each end, which is enough to tell
// an empty value from a truncated one from a well-formed token.
//
//   /api/health?token=...&id=45223
// ---------------------------------------------------------------------------

const AUTH_PATH = "/api/Auth/ExchangeToken";

// A JWT's payload is base64url, not encrypted, so the token can say for itself
// when it was issued and when it expires. Tracker reported a freshly issued
// token as "expired at 19/11/2026 15:56", which only its own claims can
// settle: either it is handing back a stale token, or it is issuing one dated
// in the past. No signature check here — this is a report, not a gate.
function jwtClaims(jwt) {
  try {
    const part = String(jwt).split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const c = JSON.parse(json);
    const when = (v) => (typeof v === "number" ? new Date(v * 1000).toISOString() : undefined);
    const now = Date.now() / 1000;
    return {
      issuedAt: when(c.iat),
      notBefore: when(c.nbf),
      expiresAt: when(c.exp),
      alreadyExpired: typeof c.exp === "number" ? c.exp < now : undefined,
      secondsOfLifeLeft: typeof c.exp === "number" ? Math.round(c.exp - now) : undefined,
      issuer: c.iss,
      audience: c.aud,
    };
  } catch (e) {
    return { couldNotDecode: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// Does Tracker carry a field that marks the ADVERT being refreshed, as
// opposed to the record being saved?
//
// This matters because advertDetails.publishDate does not. Tracker bumps it
// whenever a record with advertStatus "A" is saved — 55 of 291 updated
// records across a two-day sample — so keying adverts on it would email about
// 27 a day for jobs nobody re-advertised. But without SOME signal, a job
// re-advertised with identical details produces an identical de-duplication
// key and is skipped in silence, which is what happened to job 45223.
//
// So: list every date-ish field on the record, by path, and let a human look.
// Deliberately narrow — field names and date-shaped values only, never
// arbitrary values, because the record also holds client contact details.
const DATEISH_NAME = /date|publish|advert|modif|updat|creat|refresh|renew|post|live|expir/i;
const DATEISH_VALUE = /^\d{4}-\d{2}-\d{2}([T ]|$)|^\d{1,2}\/\d{1,2}\/\d{4}/;

function dateFields(obj, prefix, out, depth) {
  if (!obj || typeof obj !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        // Arrays of objects (history rows, advert postings) are where a real
        // "advertised on" event would hide, so look at the first entry.
        if (v.length && typeof v[0] === "object") dateFields(v[0], path + "[0]", out, depth + 1);
        else out[path] = "(array of " + v.length + ")";
      } else {
        dateFields(v, path, out, depth + 1);
      }
      continue;
    }
    const looksDate = typeof v === "string" && DATEISH_VALUE.test(v);
    if (looksDate) { out[path] = v; continue; }
    // A named-but-empty date field still tells us the field EXISTS, which is
    // the whole question. Non-date values are reported as a type only.
    if (DATEISH_NAME.test(k)) {
      out[path] = v == null || v === "" ? "(empty)"
        : typeof v === "string" && v.length <= 24 ? v
        : "(" + typeof v + ")";
    }
  }
  return out;
}

function describe(secret) {
  const s = String(secret == null ? "" : secret);
  if (!s) return { present: false };
  return {
    present: true,
    length: s.length,
    starts: s.slice(0, 6),
    ends: s.slice(-4),
    looksLikeJwt: s.split(".").length === 3,
    hasWhitespace: /\s/.test(s),
  };
}

export async function GET(req) {
  const url = new URL(req.url);
  const share = process.env.SHARE_TOKEN;
  if (share && url.searchParams.get("token") !== share) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = url.searchParams.get("id") || "45223";

  const out = {
    checkedAt: new Date().toISOString(),
    trackerBase: TRACKER_BASE,
    bearerTokenEnvVar: describe(process.env.TRACKER_BEARER_TOKEN),
    memory: { configured: kvConfigured() },
  };

  if (kvConfigured()) {
    try { out.memory.ping = await ping(); }
    catch (e) { out.memory.error = String((e && e.message) || e); }
  }

  // ---- Step 1: exchange the bearer token for a JWT ----
  let jwt = null;
  try {
    const res = await fetch(TRACKER_BASE + AUTH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bearerToken: (process.env.TRACKER_BEARER_TOKEN || "").trim() }),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }

    out.exchange = {
      httpStatus: res.status,
      ok: res.ok,
      // The SHAPE of the reply is the point: if Tracker has changed the field
      // the token arrives in, the old reader would pick up the wrong value
      // and everything after would be rejected while looking healthy here.
      responseIsJson: data != null,
      topLevelKeys: data && typeof data === "object" ? Object.keys(data) : null,
      bodyIfNotJson: data == null ? text.slice(0, 300) : undefined,
    };

    if (data && typeof data === "object") {
      out.exchange.fieldsThatLookLikeTokens = Object.entries(data)
        .filter(([, v]) => typeof v === "string" && v.length > 20)
        .map(([k, v]) => ({ field: k, ...describe(v) }));
      jwt = data.token || data.jwt || data.accessToken || data.access_token ||
            data.Token || data.JWT ||
            (data.data && (data.data.token || data.data.jwt || data.data.accessToken)) || null;
    } else if (typeof data === "string") {
      jwt = data;
    } else if (text && text.length > 20 && !text.startsWith("<")) {
      jwt = text.trim();
    }
    out.exchange.tokenTheCodePicksUp = describe(jwt);
    if (jwt) out.exchange.whatTheTokenSaysAboutItself = jwtClaims(jwt);
  } catch (e) {
    out.exchange = { threw: String((e && e.message) || e) };
  }

  // ---- Step 2: use it on a real look-up, and report what Tracker says ----
  if (jwt) {
    try {
      const res = await fetch(TRACKER_BASE + "/api/v1/Opportunity/" + encodeURIComponent(id), {
        headers: { Authorization: "Bearer " + jwt },
      });
      const text = await res.text();
      out.lookup = {
        id,
        httpStatus: res.status,
        ok: res.ok,
        // The body of a 401 usually says WHY — expired, wrong audience,
        // subscription lapsed, IP not allowed. That is the missing piece.
        body: res.ok ? "(suppressed — ?fields=1 for the date fields)" : text.slice(0, 500),
        wwwAuthenticate: res.headers.get("www-authenticate"),
      };

      // ?fields=1 — which date fields does this record actually carry?
      if (res.ok && url.searchParams.get("fields") === "1") {
        try {
          const rec = JSON.parse(text);
          const body = (rec && (rec.data || rec.opportunity)) || rec;
          out.dateFieldsOnThisRecord = dateFields(body, "", {}, 0);
          out.topLevelKeys = body && typeof body === "object" ? Object.keys(body) : null;
          out.readThisAboutFields =
            "Looking for a field that moves when a consultant RE-ADVERTISES, and does not move" +
            " when the record is merely saved. advertDetails.publishDate is known to move on" +
            " every save, so it cannot be used. If nothing else here fits, the sweep's" +
            " re-advertised report is the answer rather than an automatic send.";
        } catch (e) {
          out.dateFieldsOnThisRecord = { error: String((e && e.message) || e) };
        }
      }
    } catch (e) {
      out.lookup = { id, threw: String((e && e.message) || e) };
    }

    // Does the token work anywhere, or nowhere? If a search succeeds while a
    // single look-up fails, the problem is that record, not the credentials.
    try {
      const res = await fetch(TRACKER_BASE + "/api/v1/Opportunity/PagedSearch", {
        method: "POST",
        headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumber: 1, pageSize: 1 }),
      });
      const text = await res.text();
      out.searchInstead = {
        httpStatus: res.status,
        ok: res.ok,
        body: text.slice(0, 300),
      };
    } catch (e) {
      out.searchInstead = { threw: String((e && e.message) || e) };
    }
  }

  const claims = out.exchange && out.exchange.whatTheTokenSaysAboutItself;
  if (claims && claims.alreadyExpired) {
    out.readThis = "Tracker issued a token that was ALREADY EXPIRED when it handed it over" +
      (claims.expiresAt ? " (expired " + claims.expiresAt + ")" : "") +
      ". Nothing in this code can work around that: the API credential needs reissuing in Tracker.";
    return new Response(JSON.stringify(out, null, 2), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  out.readThis =
    out.exchange && out.exchange.ok === false
      ? "The credentials themselves are being refused — the bearer token in Vercel needs replacing."
      : out.lookup && out.lookup.ok
        ? "Tracker is answering. The look-up worked."
        : out.searchInstead && out.searchInstead.ok
          ? "The token works for searching but not for this record: a permissions or record problem, not the credentials."
          : "A token is issued but Tracker refuses to use it. The body above should say why.";

  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
