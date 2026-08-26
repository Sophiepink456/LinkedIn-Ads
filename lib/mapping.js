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
    if (match && match.name) return { name: clean(match.name), source: "publishContact" };
  }

  const primary = owners.find((o) => o.rank === 1) || owners[0];
  if (primary && primary.name) {
    return {
      name: clean(primary.name),
      source: publishId ? "fallback: publish contact not in owners" : "fallback: primary owner",
    };
  }
  return { name: "", source: "none found" };
}

export function mapOpportunity(opp) {
  const ad = opp.advertDetails || {};

  const location = firstPart(ad.location) || opp.locationCity || firstPart(opp.location);
  const consultant = resolveConsultant(opp);

  // DIVISION — department first, deliberately.
  //
  // advertDetails.sector is the JOB BOARD category, which reflects the client's
  // industry rather than which Elevation team is running the role. It gave
  // "Retail" for a Marketing Director at a furniture company, and "Transport
  // and Rail" for an IT Portfolio Manager at a train operator.
  //
  // opp.department is the internal division, which is what the ad should show.
  // The advert sector stays as a backstop for records with no department, and
  // a consultant override in config.js beats both.
  const department = clean(opp.department && opp.department.name);
  const division = department || clean(ad.sector) || "";

  return {
    id: String(opp.id || ""),
    title: clean(ad.title || opp.name),
    location,

    salaryFrom: ad.salaryFrom,
    salaryTo: ad.salaryTo,
    salaryPeriod: ad.salaryPer,

    division,
    department,
    advertSector: clean(ad.sector), // kept visible in the feed for comparison

    consultant: consultant.name,
    consultantSource: consultant.source,

    employmentType: clean(ad.workType) || clean(opp.workType && opp.workType.name) || "",

    client: clean(opp.client && opp.client.name),
    reference: clean(ad.reference),
    publishDate: ad.publishDate || "",
    status: clean(opp.status && opp.status.name),

    advertised: ad.publishOnline === true || String(ad.publishOnline).toLowerCase() === "y",
    filled: !!(opp.history && opp.history.filled),
    closed: !!(opp.history && opp.history.closed),
  };
}
