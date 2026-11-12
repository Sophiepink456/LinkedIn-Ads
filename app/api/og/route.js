import { ImageResponse } from "next/og";
import { PHOTO_BASE_URL, PHOTO_SCRIM, backgroundsFor, resolveDivision, resolveType } from "../../../lib/config";
import { formatSalary, parseRange } from "../../../lib/salary";
import { buildAd, CANVAS_W, CANVAS_H, FONT_DISPLAY, FONT_META, FONT_SMALL, FONT_WEIGHT } from "../../../lib/ad-layout";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// The three panel treatments from the brand file, exported from Figma. Which
// one an advert gets is decided by ?seq, which the webhook increments, so
// consecutive adverts cycle 1, 2, 3 rather than repeating at random.
const TEXTURES = ["/frames/texture-1.png", "/frames/texture-2.png", "/frames/texture-3.png"];
const LOGO = "/frames/logo.png";
const LINK_ICON = "/frames/link-icon.png";

function resolveImage(origin, file) {
  if (file.startsWith("http")) return file;
  const base = PHOTO_BASE_URL.startsWith("http") ? PHOTO_BASE_URL : origin + PHOTO_BASE_URL;
  return base + file;
}

// A number that advances by one per advert sent. Falls back to a hash of the
// advert's own wording when it is missing — the preview links and the manual
// generator have no counter, and two different jobs should still not look
// identical side by side.
function sequenceFor(param, seed) {
  const n = parseInt(param || "", 10);
  if (Number.isFinite(n) && n >= 0) return n;
  let hsh = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) >>> 0;
  return hsh;
}

// Backgrounds step through the pool in order rather than being drawn at random,
// so a run of adverts does not repeat the same photograph.
function pickBackground(origin, param, division, seq) {
  if (param && param !== "auto") return resolveImage(origin, param);
  const pool = backgroundsFor(division);
  return resolveImage(origin, pool[seq % pool.length]);
}

// The URL ends "/api/og?..." with no extension, so anything downloading it has
// nothing to go on and labels the result a generic file. This builds a proper
// name from the job title, e.g. "senior-design-engineer-competitive.png".
function buildFilename(title, isCompetitive) {
  const base = String(title || "vacancy")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "vacancy";
  return base + (isCompetitive ? "-competitive" : "") + ".png";
}

export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);

  const required = process.env.SHARE_TOKEN;
  if (required && searchParams.get("token") !== required) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rawDivision = searchParams.get("division") || searchParams.get("sector") || "";
  const consultant = searchParams.get("consultant") || "";
  const division = resolveDivision(rawDivision, consultant).toUpperCase();
  const title = (searchParams.get("title") || "Job Title").trim();
  const location = (searchParams.get("location") || "").trim();

  let sFrom = searchParams.get("salary_from");
  let sTo = searchParams.get("salary_to");
  const salaryRaw = searchParams.get("salary");
  if (!sFrom && !sTo && salaryRaw) {
    const r = parseRange(salaryRaw);
    sFrom = r.from; sTo = r.to;
  }

  // salary_text overrides everything — used for the "Competitive" version.
  const salaryText = (searchParams.get("salary_text") || "").trim();
  const salary = salaryText || formatSalary({
    from: sFrom,
    to: sTo,
    period: searchParams.get("salary_period") || salaryRaw,
    hide: searchParams.get("hide_salary"),
  });

  // resolveType returns null for Permanent and Full-time, so an ordinary
  // permanent role simply reads "£90,000 - £95,000 | Sheffield".
  const typeLabel = resolveType(
    searchParams.get("employment_type"),
    searchParams.get("working_pattern")
  );
  const meta = [salary, typeLabel, location].filter(Boolean).join(" | ");

  const seq = sequenceFor(searchParams.get("seq"), title + "|" + location + "|" + division);
  const styleParam = parseInt(searchParams.get("style") || "", 10);
  const styleIndex = Number.isFinite(styleParam) && styleParam >= 1 && styleParam <= 3
    ? styleParam - 1
    : seq % TEXTURES.length;

  const photo = pickBackground(origin, searchParams.get("image"), division, seq);

  // Three cuts of Google Sans Flex Medium, one per optical size used. See the
  // note in lib/ad-layout.js: the font's optical-size axis is what keeps the
  // title matching the brand file.
  const [display, metaFont, small] = await Promise.all([
    fetch(new URL("../../fonts/GSF-display.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../../fonts/GSF-meta.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../../fonts/GSF-small.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    buildAd({
      photo,
      texture: origin + TEXTURES[styleIndex],
      logo: origin + LOGO,
      linkIcon: origin + LINK_ICON,
      division,
      title,
      meta,
      focus: searchParams.get("focus") || "center",
      scrim: searchParams.get("scrim") === "1" ? true
        : searchParams.get("scrim") === "0" ? false
        : PHOTO_SCRIM,
    }),
    {
      width: CANVAS_W,
      height: CANVAS_H,
      fonts: [
        { name: FONT_DISPLAY, data: display, weight: FONT_WEIGHT, style: "normal" },
        { name: FONT_META, data: metaFont, weight: FONT_WEIGHT, style: "normal" },
        { name: FONT_SMALL, data: small, weight: FONT_WEIGHT, style: "normal" },
      ],
      headers: {
        "Content-Type": "image/png",
        // "inline" keeps it viewable in a browser tab while still supplying the
        // name that download tools and Zapier use for the attachment.
        "Content-Disposition": 'inline; filename="' + buildFilename(title, !!salaryText) + '"',
      },
    }
  );
}
