// Maps a Tracker "Opportunity" (job) object to the fields the ad needs.
//
// The two Elevation-specific fields (hide salary, full/part-time) live inside
// the record's customFields. Set the two key names below once you can see them
// in a real API response — everything else is already mapped.
export const CF_HIDE_SALARY_KEY = "";      // e.g. "Hide salary"
export const CF_WORKING_PATTERN_KEY = "";  // e.g. "Full-time/Part-time"

function cf(opp, key) {
  if (!key) return "";
  const c = opp.customFields;
  if (Array.isArray(c)) {
    const f = c.find((x) => (x.name || x.label || x.fieldName) === key);
    return f ? (f.value ?? f.fieldValue ?? "") : "";
  }
  if (c && typeof c === "object") return c[key] ?? "";
  return "";
}

export function mapOpportunity(opp) {
  return {
    title: opp.publishTitle || opp.opportunityName || "",
    location: opp.publishLocation || opp.location || "",
    salaryFrom: opp.publishSalaryFrom,
    salaryTo: opp.publishSalaryTo,
    salaryPeriod: opp.publishSalaryPer,
    division: opp.publishSector || opp.publishCategory || "",
    consultant: opp.opportunityOwnerFullName || "",
    employmentType: opp.contractType || opp.workTypeName || "",
    hideSalary: cf(opp, CF_HIDE_SALARY_KEY),
    workingPattern: cf(opp, CF_WORKING_PATTERN_KEY),
    // "has it actually been advertised?" — lets us skip jobs that only exist as records
    advertised: opp.publishOnline === true || !!opp.publishDate || !!opp.advertId,
  };
}
