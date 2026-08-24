"use client";

import { useState } from "react";
import { SECTORS, BACKGROUNDS } from "../lib/config";

const GREEN = "#93BF20";

export default function Home() {
  const [sector, setSector] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [image, setImage] = useState("auto");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function buildUrl() {
    const p = new URLSearchParams();
    if (sector) p.set("sector", sector);
    if (title) p.set("title", title);
    if (location) p.set("location", location);
    if (salary) p.set("salary", salary);
    p.set("image", image || "auto");
    return "/api/og?" + p.toString();
  }

  function handlePreview() {
    // cache-bust so "auto" re-rolls the background each click
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
      const safe = (title || "vacancy").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.download = safe + "-ad.png";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    border: "1px solid #d5dae0",
    borderRadius: "10px",
    boxSizing: "border-box",
    background: "#fff",
  };
  const label = { fontSize: "13px", fontWeight: 600, margin: "0 0 6px", display: "block" };
  const row = { marginBottom: "16px" };

  return (
    <main
      style={{
        maxWidth: "980px",
        margin: "0 auto",
        padding: "40px 24px 80px",
      }}
    >
      <h1 style={{ fontSize: "28px", margin: "0 0 4px" }}>
        Elevation Ad Generator
      </h1>
      <p style={{ margin: "0 0 28px", color: "#5a636c" }}>
        Fill this in, click <strong>Generate preview</strong>, then download.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1fr) minmax(300px, 420px)",
          gap: "36px",
          alignItems: "start",
        }}
      >
        {/* Form */}
        <div>
          <div style={row}>
            <label style={label}>Sector</label>
            <select style={field} value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Select a sector</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div style={row}>
            <label style={label}>Job title</label>
            <input
              style={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Interim Financial Planning & Analysis Manager"
            />
          </div>

          <div style={row}>
            <label style={label}>Location</label>
            <input
              style={field}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sheffield"
            />
          </div>

          <div style={row}>
            <label style={label}>Salary</label>
            <input
              style={field}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="35  →  £35k   ·   blank  →  Competitive"
            />
            <p style={{ fontSize: "12px", color: "#7a828b", margin: "6px 0 0" }}>
              "£" is added automatically. A plain number gets "k" (35 → £35k). A
              word is left as-is (Competitive). Blank becomes "Competitive".
            </p>
          </div>

          <div style={row}>
            <label style={label}>Background photo</label>
            <select style={field} value={image} onChange={(e) => setImage(e.target.value)}>
              <option value="auto">Auto (random)</option>
              {BACKGROUNDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <button
              onClick={handlePreview}
              style={{
                flex: 1,
                padding: "14px",
                fontSize: "15px",
                fontWeight: 600,
                color: "#fff",
                background: GREEN,
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              Generate preview
            </button>
            <button
              onClick={handleDownload}
              disabled={busy}
              style={{
                flex: 1,
                padding: "14px",
                fontSize: "15px",
                fontWeight: 600,
                color: "#1b1f24",
                background: "#fff",
                border: "1px solid #cfd5db",
                borderRadius: "10px",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Preparing…" : "Download PNG"}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div
          style={{
            border: "1px solid #e2e6ea",
            borderRadius: "14px",
            overflow: "hidden",
            background: "#fff",
            aspectRatio: "1080 / 1350",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9aa2ab",
            fontSize: "14px",
          }}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Ad preview"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span>Preview appears here</span>
          )}
        </div>
      </div>
    </main>
  );
}
