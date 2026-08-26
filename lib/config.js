// ---- Brand + content configuration ----
export const GREEN = "#93BF20";

export const PHOTO_BASE_URL =
  process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "/backgrounds/";

// Text used on the second version of each ad, where the salary is withheld.
export const COMPETITIVE_LABEL = "Competitive";

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

export const BACKGROUNDS = [
  "bg-01.jpg","bg-02.jpg","bg-03.jpg","bg-04.jpg","bg-05.jpg","bg-06.jpg",
  "bg-07.jpg","bg-08.jpg","bg-09.jpg","bg-10.jpg","bg-11.jpg","bg-12.jpg",
  "bg-13.jpg","bg-14.jpg","bg-15.jpg","bg-16.jpg","bg-17.jpg","bg-18.jpg",
  "bg-19.jpg","bg-20.jpg","bg-21.jpg","bg-22.jpg","bg-23.jpg","bg-24.jpg",
  "bg-25.jpg","bg-26.jpg","bg-27.jpg","bg-28.jpg","bg-29.jpg","bg-30.jpg",
  "bg-31.jpg",
];

// ---- Consultant -> division shown on the ad ----
// The consultant name is NEVER printed on the ad. It decides the division, and
// travels through the feed so the notification email can say who it is for.
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

// Sector and department names as they actually appear in Tracker, mapped to
// the division wording used on the ads. Add to this as new ones turn up — a
// sector with no alias is printed exactly as Tracker has it.
export const DIVISION_ALIASES = {
  // Short department codes
  "HR": "PEOPLE & HR",
  "IT": "TECHNOLOGY & TRANSFORMATION",
  "SF": "ACCOUNTANCY & FINANCE",
  "TF": "ACCOUNTANCY & FINANCE",

  // Advert sector names seen in live records
  "ACCOUNTANCY": "ACCOUNTANCY & FINANCE",
  "ACCOUNTANCY AND FINANCE": "ACCOUNTANCY & FINANCE",
  "FINANCE": "ACCOUNTANCY & FINANCE",
  "LOGISTICS DISTRIBUTION AND SUPPLY CHAIN": "PROCUREMENT & SUPPLY CHAIN",
  "PROCUREMENT": "PROCUREMENT & SUPPLY CHAIN",
  "SUPPLY CHAIN": "PROCUREMENT & SUPPLY CHAIN",
  "HUMAN RESOURCES": "PEOPLE & HR",
  "PEOPLE": "PEOPLE & HR",
  "TECHNOLOGY": "TECHNOLOGY & TRANSFORMATION",
  "INFORMATION TECHNOLOGY": "TECHNOLOGY & TRANSFORMATION",
  "HSE": "HSEQ",
  "HSE & QUALITY": "HSEQ",
  "HEALTH AND SAFETY": "HSEQ",
  "EXECUTIVE": "LEADERSHIP & EXECUTIVE",
  "LEADERSHIP": "LEADERSHIP & EXECUTIVE",
  "BUSINESS SUPPORT": "BUSINESS SUPPORT",
  "ENGINEERING": "ENGINEERING",
  "ENGINEERING & MANUFACTURING": "ENGINEERING",
  "MANUFACTURING": "MANUFACTURING",
  "MARKETING": "MARKETING",
  "SALES": "SALES",
};

function cleanName(name) {
  return (name || "").split("(")[0].trim();
}

export function resolveDivision(division, consultant) {
  // 1) Consultant override wins.
  const name = cleanName(consultant).toLowerCase();
  if (name) {
    for (const k in CONSULTANT_DIVISION) {
      if (k.toLowerCase() === name) return CONSULTANT_DIVISION[k];
    }
  }
  // 2) Alias lookup.
  const d = (division || "").trim();
  const alias = DIVISION_ALIASES[d.toUpperCase()];
  if (alias) return alias;
  // 3) Otherwise print it as Tracker has it.
  return d;
}

// ---- Work Type -> third segment after Location | Salary -------------------
// ORDER MATTERS: "Temp to Perm" and "Fixed Term Contract" contain words caught
// by the broader rules below them, so they are checked first.
export function resolveType(employmentType, workingPattern) {
  const t = (employmentType || "").toLowerCase().trim();
  const p = (workingPattern || "").toLowerCase().trim();

  if (t.includes("temp to perm") || t.includes("temp-to-perm")) return "Temp to Perm";
  if (t.includes("fixed term") || t.includes("fixed-term") || t.includes("ftc")) return "FTC";
  if (t.includes("part")) return "Part-time";
  if (t.includes("apprentice")) return "Apprenticeship";
  if (t.includes("intern")) return "Internship";
  if (t.includes("volunteer")) return "Volunteer";
  if (t.includes("commission")) return "Commission";
  if (t.includes("contract")) return "Contract";
  if (t.includes("temp")) return "Temporary";

  // Permanent and Full-time deliberately show nothing.
  if (t.includes("permanent") || t.includes("full")) return null;

  if (p.includes("part")) return "Part-time";
  return null;
}
