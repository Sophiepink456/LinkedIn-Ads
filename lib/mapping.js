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
  // publishOnline is the "Publish On My Website?" toggle and it does track the
  // website: jobs set to "n" (including internal test records) do not appear.
  //
  // advertStatus is NOT a substitute — it reads "A" on virtually everything,
  // including test jobs, so it cannot decide this on its own. It is kept as a
  // secondary guard only: "C" means the advert has been closed.
  //
  // Boolean in the detail record, "y"/"n" in search results, so handle both.
  const publishOnline =
    ad.publishOnline === true || String(ad.publishOnline).toLowerCase() === "y";
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

    publishOnline,
    advertStatus,
    advertised: publishOnline && advertStatus !== "C",
    filled: !!(opp.history && opp.history.filled),
    closed: !!(opp.history && opp.history.closed),
  };
}
