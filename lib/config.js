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
  // Added 2 October 2026
  "bg-32.jpg","bg-33.jpg","bg-34.jpg","bg-35.jpg",
];

// ---- Division-specific background pools -----------------------------------
// Some divisions have their own set of photos rather than drawing from the
// general pool above. A division listed here uses ONLY its own list; every
// other division uses BACKGROUNDS.
//
// Keys must match the RESOLVED division — the wording that appears on the ad —
// not the Tracker department. So "LEADERSHIP & EXECUTIVE", not
// "Engineering & Manufacturing".
//
// To give another division its own set: add the files to public/backgrounds/
// and add an entry here. Nothing else needs changing.
export const DIVISION_BACKGROUNDS = {
  "LEADERSHIP & EXECUTIVE": [
    "exec-01.jpg","exec-02.jpg","exec-03.jpg","exec-04.jpg","exec-05.jpg",
    "exec-06.jpg","exec-07.jpg","exec-08.jpg","exec-09.jpg",
  ],
};

// Which pool should this division draw from? Falls back to the general set.
export function backgroundsFor(division) {
  const pool = DIVISION_BACKGROUNDS[String(division || "").trim().toUpperCase()];
  return (pool && pool.length) ? pool : BACKGROUNDS;
}

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

// Parkinson Lee is a separate company — no ads for its jobs.
export const EXCLUDED_DEPARTMENTS = ["PARKINSON LEE"];

// Departments covering several divisions, where the consultant decides.
export const CONSULTANT_LED_DEPARTMENTS = ["ENGINEERING & MANUFACTURING"];

// Departments that always show no division, whoever the consultant is.
export const NO_DIVISION_DEPARTMENTS = ["INTERNAL OFFICE"];

// ---- Test and training records --------------------------------------------
// Internal test jobs sit in Tracker alongside real ones and carry advertStatus
// "A" like everything else, so they have to be excluded by name.
//
// These match the WHOLE title only — "Test Engineer", "Test Technician" and
// "Software Tester" are real vacancies and must not be caught. "Test Job" and
// "Test Job 2" are.
export const EXCLUDED_TITLE_PATTERNS = [
  /^test(\s+job)?\s*\d*$/i,      // "Test", "Test Job", "Test Job 2"
  /^dummy(\s+job)?\s*\d*$/i,     // "Dummy", "Dummy Job 3"
  /^(please\s+)?ignore\b/i,      // "Ignore", "Please ignore this"
  /\bdo not use\b/i,
  /\btraining\s+(record|example)\b/i,
];

// Clients used only for training or testing.
export const EXCLUDED_CLIENT_PATTERNS = [
  /charlotte training/i,
];

export function isExcludedDepartment(department) {
  return EXCLUDED_DEPARTMENTS.includes(String(department || "").trim().toUpperCase());
}

export function isTestRecord(title, client) {
  const t = String(title || "").trim();
  const c = String(client || "").trim();
  return (
    EXCLUDED_TITLE_PATTERNS.some((re) => re.test(t)) ||
    EXCLUDED_CLIENT_PATTERNS.some((re) => re.test(c))
  );
}

// ---- Consultant -> division -----------------------------------------------
// The consultant name is NEVER printed on the ad. It decides the division, and
// travels through the feed so the notification email can say who it is for.
//
// These are the Engineering & Manufacturing consultants. That department spans
// several divisions, so the consultant is the only way to tell them apart, and
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
// gives the right answer, so these are only a FALLBACK for a blank or
// unrecognised department — they do not override a known one.
//
// Sarah-Lee Neesam is deliberately absent: her division varies by department.
export const CONSULTANT_FALLBACK = {
  "Kelly West": "BUSINESS SUPPORT",
  "Helenna Bell": "TECHNOLOGY & TRANSFORMATION",
  "Sarah Mahon": "SALES",
  "Matt Goddard": "ACCOUNTANCY & FINANCE",
  "Demi Fearn": "PEOPLE & HR",
};


// ===========================================================================
// EMAIL RECIPIENTS
// ---------------------------------------------------------------------------
// Who gets each advert. The app works the full list out and hands Zapier two
// ready-made fields, emailTo and emailCc, so the rules live here rather than
// being spread across Zapier steps.
//
// The PUBLISHING consultant's own address comes from Tracker on the job
// record, so it never needs to be listed below. EMAILS is only for people who
// are NOT on the job — desk partners and resourcers.
// ===========================================================================

// Copied in on every advert.
export const ALWAYS_CC = ["sophiep@elevationrecruitment.com"];

// Resourcers go in CC. Change to true to put them on the To line instead.
export const RESOURCERS_IN_TO = false;

// ---- Desk partners --------------------------------------------------------
// People who work the same jobs. If either one advertises, BOTH are emailed.
// Names must match how Tracker reports the consultant.
export const CONSULTANT_PAIRS = [
  ["Rob Simpson",    "Matt Goddard"],
  ["Beth Batty",     "Megana Juceviciute"],
  ["Beth Roberts",   "Jake Shaw"],
  ["Chris Savage",   "Ellie Danson"],
  ["Frankie Parker", "Jonny Powell"],
  ["Steve Barnett",  "Jack Heffren"],
  ["Simon Ensor",    "Steve Bruce"],
  ["Katy Emmott",    "Tim Rudkin"],
];

// ---- Resourcers by the area they support ----------------------------------
// Matched against BOTH the Tracker department and the resolved division, so
// either wording works. This matters for finance: Senior Finance (SF) and
// Transactional Finance (TF) are separate departments but BOTH resolve to
// "ACCOUNTANCY & FINANCE" on the advert, so they can only be told apart by the
// department — which is why SF and TF appear here rather than the division.
export const RESOURCER_AREAS = {
  "Bethany Vaines": [
    "SF", "Senior Finance",
    "TF", "Transactional Finance",
    "Business Support",
    "Procurement & Supply Chain",
    "IT", "Technology & Transformation",
  ],
  "Gemma Chapman": ["HR", "People & HR"],
  "Ella Beaumont": ["TF", "Transactional Finance", "Business Support"],
  "Charlotte Bates": ["Sales", "Marketing"],
  "Amber Davies": [
    "Engineering", "Manufacturing",
    "HSEQ", "HSE & Quality",
    "Skilled Shop Floor", "Maintenance",
  ],
  "Chris Ridgway": ["SF", "Senior Finance"],
};

// ---- Address book ---------------------------------------------------------
// Only needed for people who are not the publishing consultant.
//
// Addresses do NOT follow a reliable pattern — Jack Heffren is "Jackheffren",
// Sarah Mahon is "sarahmahon", Sophie Hodgson is capitalised. Guessing is also
// unsafe: the obvious guess for Steve Bruce collides with Steve Barnett's real
// address. So every entry here is confirmed, and a blank one is reported in the
// feed as emailMissing rather than being invented.
export const EMAILS = {
  // --- confirmed from Tracker job records ---
  "Matt Goddard":   "mattg@elevationrecruitment.com",
  "Beth Roberts":   "bethr@elevationrecruitment.com",
  "Jake Shaw":      "jakes@elevationrecruitment.com",
  "Chris Savage":   "chriss@elevationrecruitment.com",
  "Frankie Parker": "frankiep@elevationrecruitment.com",
  "Jonny Powell":   "jonnyp@elevationrecruitment.com",
  "Steve Barnett":  "steveb@elevationrecruitment.com",
  "Jack Heffren":   "Jackheffren@elevationrecruitment.com",
  "Simon Ensor":    "simone@elevationrecruitment.com",
  "Tim Rudkin":     "timr@elevationrecruitment.com",
  "Ella Beaumont":  "ellab@elevationrecruitment.com",
  "Chris Ridgway":  "chrisr@elevationrecruitment.com",

  // --- confirmed 2 October 2026 ---
  // Note Steve Bruce is "stevebruce", NOT "steveb" — that is Steve Barnett.
  "Rob Simpson":        "RobS@elevationrecruitment.com",
  "Beth Batty":         "bethb@elevationrecruitment.com",
  "Megana Juceviciute": "meganaj@elevationrecruitment.com",
  "Ellie Danson":       "ellied@elevationrecruitment.com",
  "Steve Bruce":        "stevebruce@elevationrecruitment.com",
  "Katy Emmott":        "katye@elevationrecruitment.com",

  // --- resourcers ---
  "Bethany Vaines":     "bethanyv@elevationrecruitment.com",
  "Gemma Chapman":      "gemmac@elevationrecruitment.com",
  "Charlotte Bates":    "charlotteb@elevationrecruitment.com",
  "Amber Davies":       "amberd@elevationrecruitment.com",
};

function normName(s) {
  return String(s || "").split("(")[0].trim().toUpperCase();
}

// area -> [resourcer names], built once from RESOURCER_AREAS above
const AREA_TO_RESOURCERS = (() => {
  const m = {};
  for (const person of Object.keys(RESOURCER_AREAS)) {
    for (const area of RESOURCER_AREAS[person]) {
      const k = normName(area);
      if (!m[k]) m[k] = [];
      if (!m[k].includes(person)) m[k].push(person);
    }
  }
  return m;
})();

export function partnerFor(name) {
  const n = normName(name);
  if (!n) return null;
  for (const [a, b] of CONSULTANT_PAIRS) {
    if (normName(a) === n) return b;
    if (normName(b) === n) return a;
  }
  return null;
}

export function emailFor(name) {
  const n = normName(name);
  if (!n) return "";
  for (const k in EMAILS) {
    if (normName(k) === n) return String(EMAILS[k] || "").trim();
  }
  return "";
}

// Works out everyone who should receive this advert.
// Returns { to, cc, missing } — missing names anyone whose address is blank,
// so a gap shows up in the feed instead of silently dropping someone.
export function recipientsFor(job) {
  const to = [];
  const cc = [];
  const missing = [];

  const add = (list, email) => {
    const e = String(email || "").trim();
    if (!e) return;
    const low = e.toLowerCase();
    const seen = to.concat(cc).some((x) => x.toLowerCase() === low);
    if (!seen) list.push(e);
  };

  const note = (name) => {
    if (name && !missing.includes(name)) missing.push(name);
  };

  // 1) The consultant who advertised it. Address comes from the job record.
  if (job.consultantEmail) add(to, job.consultantEmail);
  else if (job.consultant) {
    const e = emailFor(job.consultant);
    if (e) add(to, e); else note(job.consultant);
  }

  // 2) Their desk partner.
  const partner = partnerFor(job.consultant);
  if (partner) {
    const e = emailFor(partner);
    if (e) add(to, e); else note(partner);
  }

  // 3) Resourcers covering this area — department or division, either spelling.
  const names = [];
  for (const key of [normName(job.department), normName(job.division)]) {
    for (const p of (AREA_TO_RESOURCERS[key] || [])) {
      if (!names.includes(p)) names.push(p);
    }
  }
  for (const p of names) {
    const e = emailFor(p);
    if (e) add(RESOURCERS_IN_TO ? to : cc, e); else note(p);
  }

  // 4) Always copied.
  for (const e of ALWAYS_CC) add(cc, e);

  return { to, cc, missing };
}

function cleanName(name) {
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

// Resolution order:
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

  if (t.includes("permanent") || t.includes("full")) return null;

  if (p.includes("part")) return "Part-time";
  return null;
}


// ===========================================================================
// AD FINGERPRINT + DE-DUPLICATION KEY
//
// Lives here, not in the routes, because three places must produce byte
// identical keys: the live webhook, the jobs feed, and the one-off store
// seeder. If they ever disagree the seeding is worthless and every advert
// floods back through as if it were new.
// ===========================================================================

// ---------------------------------------------------------------------------
// De-duplication key. Zapier stores this and blocks anything it has seen.
//
//   45175-k3f9c1
//   ^^^^^ ^^^^^^
//   job   what the ad actually says
//
// publishDate is deliberately NOT part of this, despite being the obvious
// candidate. Tracker bumps publishDate whenever a record with advertStatus
// "A" is saved, not when a consultant advertises a job — job 43414 was
// filled on 3 July 2026 and still carried a publishDate of 2 October after
// an unrelated edit. Across a two-day sample, 291 records were updated and
// 55 came back with a fresh publishDate, nearly all of them advertStatus
// "A". Keying on it would send a new ad roughly 27 times a day for jobs
// nobody had re-advertised, which is the September complaint.
//
// So the key answers one question only: would this advert LOOK different
// from the last one we sent for this job?
//
//   * salary, title, location, type,
//     division or consultant changed -> new key -> new ad
//   * anything else changed, however
//     many times Tracker pings us    -> same key -> silent
//
// The gap this leaves is a job re-advertised with identical details.
// Nothing in the API distinguishes that from an ordinary edit, so it stays
// silent — use ?force=1 to send one by hand when that happens.
//
// Kept short: Storage by Zapier limits keys to 32 characters; this is 13.
// ---------------------------------------------------------------------------
function normText(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();
}

// "80000", 80000 and "£80,000.00" all have to come out the same, or a
// harmless reformat in Tracker would read as a new advert.
function normNum(v) {
  if (v == null || v === "") return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? normText(v) : String(n);
}

export function adFingerprint(f, division) {
  // Only fields the ad actually renders. resolveType is used rather than the
  // raw work type because Permanent and Full-time both print nothing, so
  // switching between them must not count as a change.
  const s = [
    normText(f.title),
    normText(f.location),
    normNum(f.salaryFrom),
    normNum(f.salaryTo),
    normText(f.salaryPeriod),
    normText(resolveType(f.employmentType, "")),
    normText(division),
    // Not printed on the ad, but it decides who the email goes to — if a job
    // is reassigned, the new consultant has never had it.
    normText(f.consultant),
  ].join("|");

  // FNV-1a, 32-bit. Deterministic, no async, and short in base 36.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function dedupeKeyFor(f, division, force) {
  const base = String(f.id) + "-" + adFingerprint(f, division);
  // ?force=1 makes the key unique so Zapier cannot have seen it. For sending
  // an ad on demand — a consultant re-advertises an unchanged job, or one
  // needs re-sending after a Gmail failure.
  return force ? base + "-" + Date.now().toString(36).slice(-5) : base;
}
