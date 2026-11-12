import React from "react";

// ---------------------------------------------------------------------------
// The advert layout, as one element tree.
//
// Lives here rather than inside the route so it can be rendered two ways: the
// route hands it to next/og in production, and scripts/render-preview.mjs
// hands the identical tree to satori locally to diff against the Figma frames.
// Duplicating the markup in a test is what lets a layout drift away from the
// design without anyone noticing.
//
// Every number is taken from Brand System > "Job Advert | Single page 1-3"
// (file dQpO0rDkzxM9bmGr0aDWqR, nodes 303:237 / 303:264 / 303:289), which all
// share one structure and differ only in the texture behind the panel:
//
//   Image            0,   0  1080 x 647     the photograph
//   Texture        0, 647  1080 x 703       the dark panel artwork
//   Content       100, 610   880 x 444
//     pill            +0,   +0   380 x 74   division, straddles the photo edge
//     title           +0, +125   880 x 240
//     meta            +0, +400   880 x  44
//   Footer        113,1169   854 x  81      logo and web address
// ---------------------------------------------------------------------------

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;
export const PHOTO_H = 647;

export const LIME = "#BAE400";        // the pill, and the full stop after the title
export const PILL_INK = "#161616";    // division text on the pill

const PILL_X = 100, PILL_Y = 610, PILL_H = 74, PILL_PAD_X = 30;
const PILL_TEXT_SIZE = 22;

const TITLE_X = 100, TITLE_Y = 735, TITLE_W = 880, TITLE_BLOCK_H = 240;
// 120px between baselines at the full title size, as in the brand file.
const TITLE_BASE = 84;
const TITLE_LH = 120 / TITLE_BASE;

const META_X = 100, META_Y = 1010, META_H = 44, META_SIZE = 32;

const LOGO_X = 113, LOGO_Y = 1169, LOGO_W = 390, LOGO_H = 81;
const ICON_X = 698, ICON_Y = 1194, ICON_W = 30, ICON_H = 31;
const URL_X = 738, URL_Y = 1194, URL_SIZE = 24;
const SITE_URL = "www.elevationrg.com";

// Area Bold advances about 0.54em per character averaged over mixed-case text,
// measured off the brand file: "Interim M&A Project" is 869px wide at 84px.
// Enough to choose a size that fits; satori does the real line breaking.
const CHAR_W = 0.54;

// The title block is a fixed 240px — the meta line sits immediately under it —
// so a long title has to come down in size rather than run into it. Each step
// is the largest size at which the estimated number of lines still fits.
const TITLE_STEPS = [TITLE_BASE, 72, 62, 54, 46];

export function titleSizeFor(title) {
  const n = String(title || "").trim().length;
  for (const size of TITLE_STEPS) {
    const lines = Math.max(1, Math.ceil((n * CHAR_W * size) / TITLE_W));
    if (lines * size * TITLE_LH <= TITLE_BLOCK_H) return size;
  }
  return TITLE_STEPS[TITLE_STEPS.length - 1];
}

const h = React.createElement;

export function buildAd({ photo, texture, logo, linkIcon, division, title, meta }) {
  const words = String(title || "Job Title").trim().split(/\s+/);
  const lastWord = words.pop();
  const titleSize = titleSizeFor(title);

  const children = [
    // The photograph. Cropped to the top 647px, centred, so a portrait-shaped
    // source keeps its middle rather than its sky.
    h("img", {
      key: "photo", src: photo, width: CANVAS_W, height: PHOTO_H,
      style: { position: "absolute", top: 0, left: 0, width: CANVAS_W + "px",
        height: PHOTO_H + "px", objectFit: "cover", objectPosition: "center" },
    }),

    // The dark panel. One of three textures, alternating.
    h("img", {
      key: "texture", src: texture, width: CANVAS_W, height: CANVAS_H - PHOTO_H,
      style: { position: "absolute", top: PHOTO_H + "px", left: 0,
        width: CANVAS_W + "px", height: (CANVAS_H - PHOTO_H) + "px" },
    }),
  ];

  // The division pill. Width grows with the wording — the Figma frame is 380px
  // for "Accountancy & Finance", but "Procurement & Supply Chain" needs more —
  // so only the padding and height are fixed.
  if (division) {
    children.push(h("div", {
      key: "pill",
      style: {
        position: "absolute", left: PILL_X + "px", top: PILL_Y + "px",
        height: PILL_H + "px", display: "flex", alignItems: "center",
        padding: "0 " + PILL_PAD_X + "px", backgroundColor: LIME,
        borderRadius: (PILL_H / 2) + "px",
      },
    }, h("div", {
      style: { display: "flex", color: PILL_INK, fontSize: PILL_TEXT_SIZE + "px",
        fontWeight: 600, letterSpacing: "0.5px", lineHeight: 1 },
    }, division)));
  }

  // The job title, with the brand's full stop in lime after the last word.
  children.push(h("div", {
    key: "title",
    style: {
      position: "absolute", left: TITLE_X + "px", top: TITLE_Y + "px",
      width: TITLE_W + "px", display: "flex", flexWrap: "wrap",
      alignItems: "flex-start", color: "#ffffff", fontSize: titleSize + "px",
      fontWeight: 700, lineHeight: TITLE_LH, letterSpacing: "-2px",
    },
  }, [
    ...words.map((w, i) => h("span", { key: "w" + i, style: { marginRight: "0.26em" } }, w)),
    h("span", { key: "last", style: { display: "flex" } }, [
      lastWord,
      h("span", { key: "dot", style: { color: LIME } }, "."),
    ]),
  ]));

  // salary | contract type | location
  if (meta) {
    children.push(h("div", {
      key: "meta",
      style: {
        position: "absolute", left: META_X + "px", top: META_Y + "px",
        width: TITLE_W + "px", height: META_H + "px", display: "flex",
        alignItems: "center", color: "#ffffff", fontSize: META_SIZE + "px",
        fontWeight: 600,
      },
    }, meta));
  }

  // Logo, link icon and web address. Assembled from the two vector assets
  // rather than one flat export: exporting the footer as a single image gave
  // a picture with a white background baked in, which hid the white wordmark
  // completely. Both SVGs also arrived with that backdrop and had it stripped.
  children.push(h("img", {
    key: "logo", src: logo, width: LOGO_W, height: LOGO_H,
    style: { position: "absolute", left: LOGO_X + "px", top: LOGO_Y + "px",
      width: LOGO_W + "px", height: LOGO_H + "px" },
  }));
  children.push(h("img", {
    key: "icon", src: linkIcon, width: ICON_W, height: ICON_H,
    style: { position: "absolute", left: ICON_X + "px", top: ICON_Y + "px",
      width: ICON_W + "px", height: ICON_H + "px" },
  }));
  children.push(h("div", {
    key: "url",
    style: { position: "absolute", left: URL_X + "px", top: URL_Y + "px",
      height: ICON_H + "px", display: "flex", alignItems: "center",
      color: "#ffffff", fontSize: URL_SIZE + "px", fontWeight: 600 },
  }, SITE_URL));

  return h("div", {
    style: {
      position: "relative", width: CANVAS_W + "px", height: CANVAS_H + "px",
      display: "flex", backgroundColor: "#161616", fontFamily: "Area",
    },
  }, children);
}
