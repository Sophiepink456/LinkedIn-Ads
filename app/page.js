"use client";

import { useState } from "react";
import { SECTORS, BACKGROUNDS, COMBINED_DIVISION } from "../lib/config";

const GREEN = "#93BF20";

export default function Home() {
  const [division, setDivision] = useState("");
  const [consultant, setConsultant] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [salaryFrom, setSalaryFrom] = useState("");
  const [salaryTo, setSalaryTo] = useState("");
  const [hideSalary, setHideSalary] = useState(false);
  const [empType, setEmpType] = useState("Permanent");
  const [pattern, setPattern] = useState("Full-time");
  const [image, setImage] = useState("auto");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function buildUrl() {
    const p = new URLSearchParams();
    if (division) p.set("division", division);
    if (consultant) p.set("consultant", consultant);
    if (title) p.set("title", title);
    if (location) p.set("location", location);
    if (salaryFrom) p.set("salary_from", salaryFrom);
    if (salaryTo) p.set("salary_to", salaryTo);
    if (hideSalary) p.set("hide_salary", "yes");
    if (empType) p.set("employment_type", empType);
    if (pattern) p.set("working_pattern", pattern);
    p.set("image", image || "auto");
    return "/api/og?" + p.toString();
  }

  function handlePreview() {
    setPreviewUrl(buildUrl() + "&t=" + Date.now());
  }
  async function handleDownload() {
    setBusy(true);
    try {
      const res = await fetch(buildUrl() + "&t=" + Date.now());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (title || "vacancy").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-ad.png";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const field = { width: "100%", padding: "11px 13px", fontSize: "15px", border: "1px solid #d5dae0", borderRadius: "10px", boxSizing: "border-box", background: "#fff" };
  const label = { fontSize: "13px", fontWeight: 600, margin: "0 0 6px", display: "block" };
  const row = { marginBottom: "14px" };
  const half = { display: "flex", gap: "10px" };

  const divisionOptions = Array.from(new Set([...SECTORS, COMBINED_DIVISION]));

  return (
    <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "28px", margin: "0 0 4px" }}>Elevation Ad Generator</h1>
      <p style={{ margin: "0 0 28px", color: "#5a636c" }}>Fill this in, click <strong>Generate preview</strong>, then download.</p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 1fr) minmax(300px, 420px)", gap: "36px", alignItems: "start" }}>
        <div>
          <div style={row}>
            <label style={label}>Division (Broadcast Area)</label>
            <select style={field} value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">Select a division</option>
              {divisionOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>

          {division.toUpperCase() === COMBINED_DIVISION && (
            <div style={row}>
              <label style={label}>Posting consultant (decides Engineering vs Manufacturing)</label>
              <input style={field} value={consultant} onChange={(e) => setConsultant(e.target.value)} placeholder="e.g. Chris Ridgway" />
            </div>
          )}

          <div style={row}>
            <label style={label}>Job title</label>
            <input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group Financial Accountant" />
          </div>

          <div style={row}>
            <label style={label}>Location</label>
            <input style={field} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="West Yorkshire" />
          </div>

          <div style={row}>
            <label style={label}>Salary range</label>
            <div style={half}>
              <input style={field} value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value)} placeholder="From e.g. 90000" disabled={hideSalary} />
              <input style={field} value={salaryTo} onChange={(e) => setSalaryTo(e.target.value)} placeholder="To e.g. 110000" disabled={hideSalary} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "14px" }}>
              <input type="checkbox" checked={hideSalary} onChange={(e) => setHideSalary(e.target.checked)} />
              Hide salary (shows £Competitive)
            </label>
          </div>

          <div style={half}>
            <div style={{ ...row, flex: 1 }}>
              <label style={label}>Type of employment</label>
              <select style={field} value={empType} onChange={(e) => setEmpType(e.target.value)}>
                <option>Permanent</option><option>Contract</option><option>Temporary</option>
              </select>
            </div>
            <div style={{ ...row, flex: 1 }}>
              <label style={label}>Full-time / Part-time</label>
              <select style={field} value={pattern} onChange={(e) => setPattern(e.target.value)}>
                <option>Full-time</option><option>Part-time</option>
              </select>
            </div>
          </div>

          <div style={row}>
            <label style={label}>Background photo</label>
            <select style={field} value={image} onChange={(e) => setImage(e.target.value)}>
              <option value="auto">Auto (random)</option>
              {BACKGROUNDS.map((b) => (<option key={b} value={b}>{b}</option>))}
            </select>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "6px" }}>
            <button onClick={handlePreview} style={{ flex: 1, padding: "14px", fontSize: "15px", fontWeight: 600, color: "#fff", background: GREEN, border: "none", borderRadius: "10px", cursor: "pointer" }}>Generate preview</button>
            <button onClick={handleDownload} disabled={busy} style={{ flex: 1, padding: "14px", fontSize: "15px", fontWeight: 600, color: "#1b1f24", background: "#fff", border: "1px solid #cfd5db", borderRadius: "10px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Preparing…" : "Download PNG"}</button>
          </div>
        </div>

        <div style={{ border: "1px solid #e2e6ea", borderRadius: "14px", overflow: "hidden", background: "#fff", aspectRatio: "1080 / 1350", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa2ab", fontSize: "14px" }}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Ad preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (<span>Preview appears here</span>)}
        </div>
      </div>
    </main>
  );
}
