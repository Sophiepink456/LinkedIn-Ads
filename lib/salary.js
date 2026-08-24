// Formats the salary field for display.
//
//   ""                 -> "Competitive"        (blank = Competitive, no £)
//   "45"               -> "£45k"               (small number = thousands)
//   "45000"            -> "£45k"               (round thousands -> k)
//   "62500"            -> "£62,500"            (non-round -> comma format)
//   "15.41 per hour"   -> "£15.41 per hour"    (starts with a number -> £ prefixed)
//   "60k - 65k"        -> "£60k - 65k"         (£ prefixed once)
//   "Competitive"      -> "Competitive"        (a word is left as-is, no £)
//
// Tweak the rules here if your data comes through differently.
export function formatSalary(raw) {
  const s = (raw || "").trim();
  if (!s) return "Competitive";
  if (s.startsWith("£")) return s; // already formatted

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n < 1000) return "£" + n + "k";              // 45 -> £45k
    if (n % 1000 === 0) return "£" + n / 1000 + "k"; // 45000 -> £45k
    return "£" + n.toLocaleString("en-GB");          // 62500 -> £62,500
  }

  if (/^\d/.test(s)) return "£" + s; // "15.41 per hour" -> £15.41 per hour
  return s;                          // a word (Competitive, DOE...) -> as-is
}
