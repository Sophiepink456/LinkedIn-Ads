// Maps a Tracker opportunity record to the fields the ad needs.
//
// Expects the RICH shape from GET /api/v1/Opportunity/{Id}.

function firstPart(loc) {
  return (loc || "").split(",")[0].trim();
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function resolveConsultant(opp) {
  const owners = Array.isArray(opp.owners) ? opp.owners.filter((o) => o && o.ownerId) : [];
  const publishId = opp.publishContact && opp.publishContact.id;

  if (publishId) {
    const match = owners.find((o) => o.ownerId === publishId);
    if (match && match.name) {
      return { name: clean(match.name), email: clean(match.email), source: "publishContact" };
    }
  }

  const primary = owners.find((o) => o.rank === 1) || owners[0];
  if (primary && primary.name) {
    return {
      name: clean(primary.name),
      email: clean(primary.email),
      source: publishId ? "fallback: publish contact not in owners" : "fallback: primary owner",
    };
  }
  return { name: "", email: "", source: "none found" };
}

export function mapOpportunity(opp) {
  const ad = opp.advertDetails || {};

  const location = firstPart(ad.location) || opp.locationCity || firstPart(opp.location);
  const consultant = resolveConsultant(opp);

  // DIVISION — department first. advertDetails.sector is the JOB BOARD
  // category and reflects the client's industry, not which Elevation team runs
  // the role ("Retail" for a Marketing Director at a furniture company).
  const department = clean(opp.department && opp.department.name);
  const division = department || clean(ad.sector) || "";

  // --- Is this job live? ---
  // NOT publishOnline. Despite being labelled "Publish On My Website?", jobs
  // reach the Elevation website with it set to false — confirmed on 44693,
  // 43414 and 44750. Jobs that looked like counter-examples turned out simply
  // not to have reached the site yet.
  //
  // advertStatus is what tracks the advert: "A" while active, "C" once closed,
  // blank on records never advertised. It does not distinguish internal test
  // records, so those are excluded separately (see isTestRecord in config.js).
  const advertStatus = String(ad.advertStatus || "").trim().toUpperCase();

  return {
    id: String(opp.id || ""),
    title: clean(ad.title || opp.name),
    location,

    salaryFrom: ad.salaryFrom,
    salaryTo: ad.salaryTo,
    salaryPeriod: ad.salaryPer,

    division,
    department,
    advertSector: clean(ad.sector),

    consultant: consultant.name,
    consultantEmail: consultant.email,
    consultantSource: consultant.source,

    employmentType: clean(ad.workType) || clean(opp.workType && opp.workType.name) || "",

    client: clean(opp.client && opp.client.name),
    reference: clean(ad.reference),
    publishDate: ad.publishDate || "",
    status: clean(opp.status && opp.status.name),

    advertStatus,
    advertised: advertStatus === "A",
    publishOnline: ad.publishOnline === true || String(ad.publishOnline).toLowerCase() === "y",
    filled: !!(opp.history && opp.history.filled),
    closed: !!(opp.history && opp.history.closed),
  };
}
