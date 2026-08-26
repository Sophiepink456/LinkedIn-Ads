import { mapOpportunity } from "../../../lib/mapping";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Receives a whole Tracker "Opportunity" (job) as JSON, maps it, and returns the
// finished ad PNG. Skips jobs that haven't actually been advertised (unless ?force=1).
// A poller (Zapier, or the app's own checker) POSTs each new job here.
export async function POST(req) {
  const url = new URL(req.url);
  const token = process.env.SHARE_TOKEN;
  if (token && url.searchParams.get("token") !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let opp;
  try {
    opp = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const f = mapOpportunity(opp);

  if (!f.advertised && url.searchParams.get("force") !== "1") {
    return new Response(
      JSON.stringify({ skipped: true, reason: "job not advertised yet" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // Reuse the existing image renderer (/api/og) so there's one source of truth.
  const p = new URLSearchParams();
  if (f.division) p.set("division", f.division);
  if (f.consultant) p.set("consultant", f.consultant);
  if (f.title) p.set("title", f.title);
  if (f.location) p.set("location", f.location);
  if (f.salaryFrom != null && f.salaryFrom !== "") p.set("salary_from", String(f.salaryFrom));
  if (f.salaryTo != null && f.salaryTo !== "") p.set("salary_to", String(f.salaryTo));
  if (f.salaryPeriod) p.set("salary_period", f.salaryPeriod);
  if (f.hideSalary) p.set("hide_salary", f.hideSalary);
  if (f.employmentType) p.set("employment_type", f.employmentType);
  if (f.workingPattern) p.set("working_pattern", f.workingPattern);
  p.set("image", url.searchParams.get("image") || "auto");
  if (token) p.set("token", token);

  const ogUrl = url.origin + "/api/og?" + p.toString();
  const res = await fetch(ogUrl);
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "image/png" },
  });
}
