function toNum(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}
function abbrK(n) {
  const k = n / 1000;
  if (Number.isInteger(k)) return "£" + k + "k";
  return "£" + Math.round(k * 10) / 10 + "k"; // 92500 -> £92.5k
}

// from/to are the salary range; period is annum/hour; hide=yes -> £Competitive
export function formatSalary({ from, to, period, hide }) {
  const h = String(hide == null ? "" : hide).toLowerCase();
  if (h === "yes" || h === "true" || h === "1") return "£Competitive";

  const f = toNum(from), t = toNum(to);
  if (!f && !t) return "£Competitive";

  const per = (period || "").toLowerCase();
  if (per.includes("hour") || per.includes("hr")) {
    if (f && t && f !== t) return "£" + f + " - £" + t + " per hour";
    return "£" + (t || f) + " per hour";
  }
  if (f && t && f !== t) return abbrK(f) + " - " + abbrK(t);
  return abbrK(t || f);
}
