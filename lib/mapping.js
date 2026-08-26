// Maps a Tracker opportunity record to the fields the ad needs.
//
// IMPORTANT: this expects the RICH shape returned by GET /api/v1/Opportunity/{Id},
// which nests the advertised values under `advertDetails` and includes the
// owners list and custom fields. The flat shape returned by Opportunity/Search
// is missing most of what we need, so the route fetches each job individually.

function firstPart(loc) {
  return (loc || "").split(",")[0].trim();
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Who should be credited? Tracker's "publish contact" is the consultant shown
// publicly on the website, which is exactly who the ad is for. Match that id
// against the owners list to get the name; fall back to the primary owner.
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
      // Flagged so an odd case is visible in the feed rather than silent.
      source: publishId ? "fallback: publish contact not in owners" : "fallback: primary owner",
    };
  }
  return { name: "", source: "none found" };
}

export function mapOpportunity(opp) {
  const ad = opp.advertDetails || {};

  // The advert's own location is what the public sees, and it can differ from
  // the client's address on the record.
  const location = firstPart(ad.location) || opp.locationCity || firstPart(opp.location);

  const consultant = resolveConsultant(opp);

  return {
    id: String(opp.id || ""),
    title: clean(ad.title || opp.name),
    location,

    salaryFrom: ad.salaryFrom,
    salaryTo: ad.salaryTo,
    salaryPeriod: ad.salaryPer,

    // The advert's sector first, then the department. Both get run through the
    // aliases in config.js, and a consultant override beats both.
    division: clean(ad.sector) || clean(opp.department && opp.department.name) || "",

    consultant: consultant.name,
    consultantSource: consultant.source,

    employmentType: clean(ad.workType) || clean(opp.workType && opp.workType.name) || "",

    client: clean(opp.client && opp.client.name),
    reference: clean(ad.reference),
    publishDate: ad.publishDate || "",
    status: clean(opp.status && opp.status.name),

    // --- Is this job live? ---
    // publishOnline is the "Publish On My Website?" toggle. A filled job is
    // never advertised, whatever the toggle says.
    advertised: ad.publishOnline === true || String(ad.publishOnline).toLowerCase() === "y",
    filled: !!(opp.history && opp.history.filled),
    closed: !!(opp.history && opp.history.closed),
  };
}
