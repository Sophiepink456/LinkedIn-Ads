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
        body: text.slice(0, 500),
        wwwAuthenticate: res.headers.get("www-authenticate"),
      };
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
