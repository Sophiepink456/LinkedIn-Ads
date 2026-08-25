import { ImageResponse } from "next/og";
import { GREEN, PHOTO_BASE_URL, BACKGROUNDS, resolveDivision, resolveType } from "../../../lib/config";
import { formatSalary, parseRange } from "../../../lib/salary";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---- Layout ---------------------------------------------------------------
// Your photos have all the branding baked in. This route draws only the three
// things that change. Vertical values are px from the canvas edges as noted.
const TEXT_LEFT = 100;           // left edge of sector + title
const TITLE_SIZE = 92;           // job title font size
const TITLE_BLOCK_BOTTOM = 396;  // title bottom edge, px from BOTTOM (grows up)
const SECTOR_SIZE = 34;
const SECTOR_GAP = 23;            // gap between sector line and title
const RIGHT_MARGIN = 90;
const LOCATION_LEFT = 164;       // left edge of location|salary (right of the (i))
const LOCATION_CENTER_Y = 1026;  // tuned so the text optically centres on the (i)
const LOCATION_BOX_H = 60;
const LOCATION_SIZE = 38;
// ---------------------------------------------------------------------------

function resolveImage(origin, file) {
  if (file.startsWith("http")) return file;
  const base = PHOTO_BASE_URL.startsWith("http")
    ? PHOTO_BASE_URL
    : origin + PHOTO_BASE_URL;
  return base + file;
}
function pickBackground(origin, param) {
  if (param && param !== "auto") return resolveImage(origin, param);
  const f = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
  return resolveImage(origin, f);
}

export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);

  const required = process.env.SHARE_TOKEN;
  if (required && searchParams.get("token") !== required) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rawDivision = searchParams.get("division") || searchParams.get("sector") || "";
  const consultant = searchParams.get("consultant") || "";
  const sector = resolveDivision(rawDivision, consultant).toUpperCase();
  const title = (searchParams.get("title") || "Job Title").trim();
  const location = (searchParams.get("location") || "").trim();
  let sFrom = searchParams.get("salary_from");
  let sTo = searchParams.get("salary_to");
  const salaryRaw = searchParams.get("salary");
  if (!sFrom && !sTo && salaryRaw) {
    const r = parseRange(salaryRaw);
    sFrom = r.from; sTo = r.to;
  }
  const salary = formatSalary({
    from: sFrom,
    to: sTo,
    period: searchParams.get("salary_period") || salaryRaw,
    hide: searchParams.get("hide_salary"),
  });
  const typeLabel = resolveType(
    searchParams.get("employment_type"),
    searchParams.get("working_pattern")
  );
  const bg = pickBackground(origin, searchParams.get("image"));
  const locSalary = [location, salary, typeLabel].filter(Boolean).join(" | ");

  const [bold, semiBold] = await Promise.all([
    fetch(new URL("../../fonts/Area-Bold.otf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../../fonts/Area-SemiBold.otf", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

  const words = title.split(" ");
  const lastWord = words.pop();

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "1080px", height: "1350px", display: "flex", fontFamily: "Area" }}>
        <img src={bg} width={1080} height={1350}
          style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1350px", objectFit: "cover" }} />

        {/* Sector + title: bottom-anchored, grows upward together */}
        <div style={{ position: "absolute", left: TEXT_LEFT, bottom: TITLE_BLOCK_BOTTOM,
          width: 1080 - TEXT_LEFT - RIGHT_MARGIN, display: "flex", flexDirection: "column" }}>
          {sector ? (
            <div style={{ display: "flex", color: GREEN, fontSize: SECTOR_SIZE, fontWeight: 600,
              letterSpacing: "2px", marginBottom: SECTOR_GAP }}>{sector}</div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", color: "#ffffff",
            fontSize: TITLE_SIZE, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-1px" }}>
            {words.map((w, i) => (<span key={i} style={{ marginRight: "0.28em" }}>{w}</span>))}
            <span style={{ display: "flex" }}>{lastWord}<span style={{ color: GREEN }}>.</span></span>
          </div>
        </div>

        {/* Location | Salary: vertically centred on the (i) */}
        <div style={{ position: "absolute", left: LOCATION_LEFT, top: LOCATION_CENTER_Y - LOCATION_BOX_H / 2,
          height: LOCATION_BOX_H, display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", color: "#ffffff", fontSize: LOCATION_SIZE, fontWeight: 600 }}>{locSalary}</div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [
        { name: "Area", data: bold, weight: 700, style: "normal" },
        { name: "Area", data: semiBold, weight: 600, style: "normal" },
      ],
    }
  );
}
