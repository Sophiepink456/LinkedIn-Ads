// ---- Brand + content configuration ----
// Edit these to change sectors, the brand green, or where the background photos live.

export const GREEN = "#93BF20";

// Where the background photos are served from.
// Default: a /backgrounds/ folder inside /public (drop your DSC*.jpg files there).
// Or set to a full CDN URL, e.g. "https://cdn.elevationrg.com/ad-backgrounds/"
export const PHOTO_BASE_URL =
  process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "/backgrounds/";

export const SECTORS = [
  "ACCOUNTANCY & FINANCE",
  "BUSINESS SUPPORT",
  "ENGINEERING",
  "HSEQ",
  "LEADERSHIP & EXECUTIVE",
  "MAINTENANCE",
  "MANUFACTURING",
  "MARKETING",
  "PEOPLE & HR",
  "PROCUREMENT & SUPPLY CHAIN",
  "SALES",
  "SKILLED SHOP FLOOR",
  "TECHNOLOGY & TRANSFORMATION",
];

// The pool of background filenames (relative to PHOTO_BASE_URL).
// When image=auto (or blank), one of these is picked at random.
export const BACKGROUNDS = [
  "bg-01.jpg","bg-02.jpg","bg-03.jpg","bg-04.jpg","bg-05.jpg","bg-06.jpg",
  "bg-07.jpg","bg-08.jpg","bg-09.jpg","bg-10.jpg","bg-11.jpg","bg-12.jpg",
  "bg-13.jpg","bg-14.jpg","bg-15.jpg","bg-16.jpg","bg-17.jpg","bg-18.jpg",
  "bg-19.jpg","bg-20.jpg","bg-21.jpg","bg-22.jpg","bg-23.jpg","bg-24.jpg",
  "bg-25.jpg","bg-26.jpg","bg-27.jpg","bg-28.jpg","bg-29.jpg","bg-30.jpg",
  "bg-31.jpg",
];

// ---- Broadcast area / consultant -> division shown on the ad ----

// These consultants ALWAYS show the listed division, whatever broadcast area
// they picked. Names are matched case-insensitively, and the "(12345 - 67890)"
// suffix from Tracker/LogicMelon is stripped automatically.
export const CONSULTANT_DIVISION = {
  "Carl Walker": "LEADERSHIP & EXECUTIVE",
  "Frankie Parker": "MANUFACTURING",
  "Jonny Powell": "MANUFACTURING",
  "Emma Bartholomew": "MANUFACTURING",
  "Cameron Davies": "MANUFACTURING",
  "Ian Bruce": "LEADERSHIP & EXECUTIVE",
  "Kerry Hill": "MAINTENANCE",
  "Jake Shaw": "MAINTENANCE",
  "Beth Roberts": "MAINTENANCE",
  "Eleanor Crummey": "MAINTENANCE",
  "Anna Morgan": "MAINTENANCE",
  "John Bohan": "LEADERSHIP & EXECUTIVE",
  "Ellie Danson": "HSE & QUALITY",
  "Chris Savage": "HSE & QUALITY",
  "Jack Heffren": "ENGINEERING",
  "Steve Barnett": "ENGINEERING",
  "Katy Emmott": "ENGINEERING",
  "Lauren Marsh": "ENGINEERING",
  "Tim Rudkin": "ENGINEERING",
  "Nicola Jackson": "SKILLED SHOP FLOOR",
  "Amy Scrafield": "SKILLED SHOP FLOOR",
  "Lauren Gormanly": "SKILLED SHOP FLOOR",
};

// Shorthand broadcast-area codes that expand to a full division name.
export const DIVISION_ALIASES = {
  "HR": "PEOPLE & HR",
  "IT": "TECHNOLOGY & TRANSFORMATION",
  "SF": "ACCOUNTANCY & FINANCE",
  "TF": "ACCOUNTANCY & FINANCE",
};

function cleanName(name) {
  return (name || "").split("(")[0].trim(); // drop the "(56847 - 138454)" bit
}

export function resolveDivision(division, consultant) {
  // 1) Consultant override wins, regardless of what division they selected.
  const name = cleanName(consultant).toLowerCase();
  if (name) {
    for (const k in CONSULTANT_DIVISION) {
      if (k.toLowerCase() === name) return CONSULTANT_DIVISION[k];
    }
  }
  // 2) Shorthand code -> full name.
  const d = (division || "").trim();
  const alias = DIVISION_ALIASES[d.toUpperCase()];
  if (alias) return alias;
  // 3) Otherwise use the selected division as-is.
  return d;
}

// Third segment after Location | Salary — only for Contract / Temporary / Part-time.
export function resolveType(employmentType, workingPattern) {
  const t = (employmentType || "").toLowerCase();
  const p = (workingPattern || "").toLowerCase();
  if (t.startsWith("contract")) return "Contract";
  if (t.startsWith("temp")) return "Temporary";
  if (p.startsWith("part")) return "Part-time";
  return null;
}
