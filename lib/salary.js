function toNum(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}
function commas(s) {
  return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 90000 -> £90,000. The adverts used to abbreviate to £90k; the new brand
// design spells the figure out in full.
function money0(n) {
  return "£" + commas(Math.round(n));
}
function money(n) {
  const r = Math.round(n * 100) / 100;
  return "£" + (Number.isInteger(r) ? commas(r) : commas(Math.floor(r)) + r.toFixed(2).slice(-3));
}

// Pull two numbers out of a display string like "£50000 - 55000 per year".
export function parseRange(str) {
  const s = String(str == null ? "" : str).replace(/,/g, "");
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums) return { from: 0, to: 0 };
  return { from: nums[0], to: nums[1] || nums[0] };
}

export function formatSalary({ from, to, period, hide }) {
  const h = String(hide == null ? "" : hide).toLowerCase();
  if (h === "yes" || h === "true" || h === "1") return "£Competitive";

  const f = toNum(from), t = toNum(to);
  if (!f && !t) return "£Competitive";

  const per = (period || "").toLowerCase();
  const range = f && t && f !== t;

  // Hourly -> £15ph - £18ph
  if (per.includes("hour") || per.includes("ph") || per.includes("hr")) {
    return range ? money(f) + "ph - " + money(t) + "ph" : money(t || f) + "ph";
  }
  // Day rate -> £450 per day  /  £450 - £550 per day
  if (per.includes("day")) {
    return (range ? money(f) + " - " + money(t) : money(t || f)) + " per day";
  }
  // Annual (default) -> £90,000 - £95,000
  return range ? money0(f) + " - " + money0(t) : money0(t || f);
}
