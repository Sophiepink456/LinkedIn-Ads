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
  "HSE & QUALITY",
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

// ---- Tracker department -> division shown on the ad -----------------------
export const DEPARTMENT_DIVISION = {
  "ACCOUNTANCY & FINANCE": "ACCOUNTANCY & FINANCE",
  "BUSINESS SUPPORT": "BUSINESS SUPPORT",
  "HR": "PEOPLE & HR",
  "IT": "TECHNOLOGY & TRANSFORMATION",
  "MARKETING": "MARKETING",
  "PROCUREMENT & SUPPLY CHAIN": "PROCUREMENT & SUPPLY CHAIN",
  "SALES": "SALES",
  "SF": "ACCOUNTANCY & FINANCE",
  "TF": "ACCOUNTANCY & FINANCE",
  "INTERNAL OFFICE": "",   // deliberately blank — no division line
};

// Parkinson Lee is a separate company — no ads are generated for its jobs.
export const EXCLUDED_DEPARTMENTS = ["PARKINSON LEE"];

// Departments covering several divisions, where the consultant decides.
export const CONSULTANT_LED_DEPARTMENTS = ["ENGINEERING & MANUFACTURING"];

// Departments that always show no division, whoever the consultant is.
export const NO_DIVISION_DEPARTMENTS = ["INTERNAL OFFICE"];

export function isExcludedDepartment(department) {
  return EXCLUDED_DEPARTMENTS.includes(String(department || "").trim().toUpperCase());
}

// ---- Consultant -> division -----------------------------------------------
// The consultant name is NEVER printed on the ad. It decides the division, and
// travels through the feed so the notification email can say who it is for.
//
// These are the Engineering & Manufacturing consultants. That department spans
// several divisions, so the consultant is the ONLY way to tell them apart, and
// their entry takes priority over the department.
export const CONSULTANT_DIVISION = {
  "Carl Walker": "LEADERSHIP & EXECUTIVE",
  "Ian Bruce": "LEADERSHIP & EXECUTIVE",
  "John Bohan": "LEADERSHIP & EXECUTIVE",

  "Frankie Parker": "MANUFACTURING",
  "Jonny Powell": "MANUFACTURING",
  "Emma Bartholomew": "MANUFACTURING",
  "Cameron Davies": "MANUFACTURING",

  "Kerry Hill": "MAINTENANCE",
  "Jake Shaw": "MAINTENANCE",
  "Beth Roberts": "MAINTENANCE",
  "Eleanor Crummey": "MAINTENANCE",
  "Anna Morgan": "MAINTENANCE",

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

// Consultants outside Engineering & Manufacturing. Their department already
// gives the right answer, so these are only a FALLBACK for when a department
// is blank or unrecognised — they do not override a known department. That
// matters: it means an Internal Office job still shows no division, whoever
// happens to be running it.
//
// Sarah-Lee Neesam is deliberately absent — her division varies by department,
// so the department must decide.
export const CONSULTANT_FALLBACK = {
  "Kelly West": "BUSINESS SUPPORT",
  "Helenna Bell": "TECHNOLOGY & TRANSFORMATION",
  "Sarah Mahon": "SALES",
  "Matt Goddard": "ACCOUNTANCY & FINANCE",
  "Demi Fearn": "PEOPLE & HR",
};

function cleanName(name) {
  // Drops the "(56847 - 138454)" suffix Tracker sometimes appends.
  return (name || "").split("(")[0].trim();
}

function lookupConsultant(map, consultant) {
  const name = cleanName(consultant).toLowerCase();
  if (!name) return null;
  for (const k in map) {
    if (k.toLowerCase() === name) return map[k];
  }
  return null;
}

// Resolution order, deliberately layered:
//   1. Departments that never show a division
//   2. Engineering & Manufacturing -> consultant decides
//   3. A known department
//   4. Unknown department -> any consultant we recognise
//   5. Otherwise print the department as Tracker has it
export function resolveDivision(department, consultant) {
  const dept = String(department || "").trim();
  const deptKey = dept.toUpperCase();

  if (NO_DIVISION_DEPARTMENTS.includes(deptKey)) return "";

  if (CONSULTANT_LED_DEPARTMENTS.includes(deptKey)) {
    const byConsultant = lookupConsultant(CONSULTANT_DIVISION, consultant);
    if (byConsultant) return byConsultant;
    // Consultant not on the list: show nothing rather than the department
    // name, which is not one of the divisions. Flagged in the feed.
    return "";
  }

  if (Object.prototype.hasOwnProperty.call(DEPARTMENT_DIVISION, deptKey)) {
    return DEPARTMENT_DIVISION[deptKey];
  }

  const fallback =
    lookupConsultant(CONSULTANT_DIVISION, consultant) ||
    lookupConsultant(CONSULTANT_FALLBACK, consultant);
  if (fallback) return fallback;

  return dept;
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
