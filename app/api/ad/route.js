import { mapOpportunity } from "../../../lib/mapping";
import { COMPETITIVE_LABEL } from "../../../lib/config";
import { getOpportunity } from "../../../lib/tracker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Look at the advert for a job without sending anything.
//
//   /api/ad?id=45620&token=...            the PNG for one job
//   /api/ad?ids=45620,45612,...&token=... a page showing all of them
//
// Nothing is emailed and nothing is written to the de-duplication store, so
// this cannot stop the real advert going out later. /api/tracker-hook with
// ?dry=1 answers the same question in JSON, with the recipients and the
// reasons a job was skipped; this is for when you just want to see the image.
//
// ?hide_salary=1 renders the "Competitive" version instead.
// ---------------------------------------------------------------------------

const MAX_IDS = 24;

function ogParams(f, token, hideSalary, seq) {
  const p = new URLSearchParams();
  // The renderer resolves the division from the Tracker department, exactly as
  // the webhook hands it over, so a preview cannot disagree with the real ad.
  if (f.department) p.set("division", f.department);
  if (f.consultant) p.set("consultant", f.consultant);
  if (f.title) p.set("title", f.title);
  if (f.location) p.set("location", f.location);
  if (f.employmentType) p.set("employment_type", f.employmentType);
  p.set("image", "auto");
  p.set("seq", String(seq));
  if (hideSalary) {
    p.set("salary_text", COMPETITIVE_LABEL);
  } else {
    if (f.salaryFrom != null && f.salaryFrom !== "") p.set("salary_from", String(f.salaryFrom));
    if (f.salaryTo != null && f.salaryTo !== "") p.set("salary_to", String(f.salaryTo));
    if (f.salaryPeriod) p.set("salary_period", f.salaryPeriod);
  }
  if (token) p.set("token", token);
  return p.toString();
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function page(cards) {
  const body = cards.map((c) => (
    c.error
      ? '<figure class="card bad"><div class="err">' + escapeHtml(c.id) + " &mdash; " +
        escapeHtml(c.error) + "</div></figure>"
      : '<figure class="card"><a href="' + escapeHtml(c.src) + '" download><img src="' +
        escapeHtml(c.src) + '" alt="' + escapeHtml(c.title) + '" loading="lazy"></a>' +
        "<figcaption><b>" + escapeHtml(c.id) + "</b> " + escapeHtml(c.title) +
        '<span class="sub">' + escapeHtml(c.sub) + "</span></figcaption></figure>"
  )).join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Adverts</title><style>" +
    ":root{color-scheme:dark}" +
    "body{margin:0;padding:32px;background:#161616;color:#fff;" +
    "font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}" +
    "h1{font-size:20px;font-weight:600;margin:0 0 4px}" +
    "p.lead{margin:0 0 28px;color:#9a9a9a;font-size:14px}" +
    ".grid{display:grid;gap:28px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}" +
    ".card{margin:0}" +
    ".card img{width:100%;height:auto;display:block;border-radius:8px;background:#222}" +
    "figcaption{margin-top:10px;font-size:14px}" +
    ".sub{display:block;color:#9a9a9a;font-size:13px}" +
    ".bad .err{padding:24px;border:1px solid #4a3030;border-radius:8px;color:#ff9b9b;font-size:14px}" +
    "a{color:inherit;text-decoration:none}" +
    "</style></head><body><h1>Adverts</h1>" +
    '<p class="lead">Click an advert to download it. Nothing here has been emailed.</p>' +
    '<div class="grid">' + body + "</div></body></html>";
}

export async function GET(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const raw = url.searchParams.get("ids") || url.searchParams.get("id") || "";
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS);
  if (!ids.length) {
    return new Response("Pass ?id=45620 or ?ids=45620,45612", { status: 400 });
  }

  const hideSalary = url.searchParams.get("hide_salary") === "1";

  const cards = await Promise.all(ids.map(async (id, i) => {
    try {
      const opp = await getOpportunity(id);
      if (!opp) return { id, error: "not found in Tracker" };
      const f = mapOpportunity(opp);
      if (!f.title) return { id, error: "no advert title on this record" };
      return {
        id,
        title: f.title,
        // Say what the real send would have made of it, without acting on it.
        sub: [f.client, f.consultant, f.status, f.advertised ? null : "not advertised"]
          .filter(Boolean).join(" · "),
        src: url.origin + "/api/og?" + ogParams(f, token, hideSalary, i),
      };
    } catch (e) {
      return { id, error: String((e && e.message) || e) };
    }
  }));

  // One id: hand back the image itself, so the link can be shared or saved
  // directly rather than going through a page.
  if (ids.length === 1 && !cards[0].error) {
    return Response.redirect(cards[0].src, 302);
  }

  return new Response(page(cards), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
