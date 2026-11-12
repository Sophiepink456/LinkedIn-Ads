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
const TITLE_TRACKING = -2;   // px of letter-spacing, applied after each glyph
const WORD_GAP = 0.26;       // em of margin after each word

const META_X = 100, META_Y = 1010, META_H = 44, META_SIZE = 32;

const LOGO_X = 113, LOGO_Y = 1169, LOGO_W = 390, LOGO_H = 81;
const ICON_X = 698, ICON_Y = 1194, ICON_W = 30, ICON_H = 31;
const URL_X = 738, URL_Y = 1194, URL_SIZE = 24;
const SITE_URL = "www.elevationrg.com";

// ---- Measuring the title ---------------------------------------------------
// Google Sans Flex Bold's real advance widths, in em, taken from the font file
// itself (scripts/font-widths.py regenerates this if the font ever changes).
//
// This replaces an average-character-width guess. That guess assumed a word
// could break anywhere, so "Multi-Skilled Maintenance Engineer" measured as
// two lines and rendered as three, and on 12 November a live advert had its
// third line sitting on the salary.
const GLYPH_WIDTHS = [
  [0.22, " "],
  [0.257, "'"],
  [0.278, "l"],
  [0.281, ",.:;’"],
  [0.285, "ij"],
  [0.307, "I"],
  [0.313, "|"],
  [0.33, "-"],
  [0.362, "!"],
  [0.366, "()"],
  [0.388, "/"],
  [0.39, "f"],
  [0.404, "{}"],
  [0.412, "\\"],
  [0.414, "[]"],
  [0.415, "t"],
  [0.424, "1"],
  [0.429, "\""],
  [0.436, "r"],
  [0.44, "`"],
  [0.467, "*"],
  [0.51, "z"],
  [0.514, "^s"],
  [0.524, "7"],
  [0.547, "x"],
  [0.55, "_–"],
  [0.557, "L"],
  [0.558, "?"],
  [0.561, "F"],
  [0.563, "y"],
  [0.568, "J"],
  [0.569, "2"],
  [0.57, "v"],
  [0.571, "3"],
  [0.572, "cç"],
  [0.584, "èé"],
  [0.585, "Tàáä"],
  [0.588, "5"],
  [0.589, "e"],
  [0.591, "8"],
  [0.593, "Sk"],
  [0.594, "+<=>~"],
  [0.595, "69"],
  [0.596, "E"],
  [0.597, "a"],
  [0.6, "Z"],
  [0.607, "£"],
  [0.615, "4"],
  [0.62, "$"],
  [0.621, "oö"],
  [0.623, "hnuñü"],
  [0.633, "P"],
  [0.643, "g"],
  [0.646, "dq"],
  [0.648, "Bbp"],
  [0.658, "R"],
  [0.661, "0"],
  [0.67, "Y"],
  [0.677, "#"],
  [0.688, "V"],
  [0.69, "U"],
  [0.693, "K"],
  [0.7, "X"],
  [0.702, "&"],
  [0.704, "A"],
  [0.712, "C"],
  [0.725, "D"],
  [0.744, "N"],
  [0.749, "H"],
  [0.792, "G"],
  [0.814, "OQ"],
  [0.817, "w"],
  [0.865, "%"],
  [0.88, "—"],
  [0.892, "@"],
  [0.949, "M"],
  [0.953, "m"],
  [1.006, "W"],
];

const CHAR_W = {};
for (const [w, chars] of GLYPH_WIDTHS) {
  for (const c of chars) CHAR_W[c] = w;
}
const FALLBACK_W = 0.62;   // an unmapped glyph is assumed wide, never narrow

// The title block is a fixed 240px — the meta line sits immediately under it —
// so a long title has to come down in size rather than run into it. Each step
// is the largest size at which the real number of lines still fits.
const TITLE_STEPS = [TITLE_BASE, 72, 62, 54, 46, 40, 34];

// Width of one word as the renderer lays it out: every glyph's advance, plus
// the title's letter-spacing after each one, plus the margin that separates it
// from the next word. Satori counts that trailing margin against the column
// even on the last word of a line, which is why it is included here.
function wordWidth(word, size) {
  let w = 0;
  for (const c of word) w += (CHAR_W[c] === undefined ? FALLBACK_W : CHAR_W[c]) * size + TITLE_TRACKING;
  return w + WORD_GAP * size;
}

function lineCountAt(words, size) {
  let lines = 1;
  let used = 0;
  for (let i = 0; i < words.length; i++) {
    // The last word carries the brand's full stop.
    const w = wordWidth(i === words.length - 1 ? words[i] + "." : words[i], size);
    if (used && used + w > TITLE_W) { lines++; used = w; } else { used += w; }
  }
  return lines;
}

export function titleSizeFor(title) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return TITLE_BASE;
  for (const size of TITLE_STEPS) {
    if (lineCountAt(words, size) * size * TITLE_LH <= TITLE_BLOCK_H) return size;
  }
  return TITLE_STEPS[TITLE_STEPS.length - 1];
}

const h = React.createElement;

export function buildAd({ photo, texture, logo, linkIcon, division, title, meta, focus, scrim }) {
  const words = String(title || "Job Title").trim().split(/\s+/);
  const lastWord = words.pop();
  const titleSize = titleSizeFor(title);

  const children = [
    // The photograph, cropped to the top 647px.
    //
    // Anchored to the TOP of the source, not the middle. The library was
    // prepared for the previous design, where the title sat across the whole
    // image, so each photo carries a dark gradient that deepens towards the
    // bottom — bg-01 averages 73 at the top, 45 in the middle and 29 at the
    // foot. Taking the middle band was pulling in that baked-in shading on
    // top of the scrim below and leaving the photo muddy.
    //
    // ?focus= overrides it for any single image that crops badly this way.
    h("img", {
      key: "photo", src: photo, width: CANVAS_W, height: PHOTO_H,
      style: { position: "absolute", top: 0, left: 0, width: CANVAS_W + "px",
        height: PHOTO_H + "px", objectFit: "cover", objectPosition: focus || "50% 31%" },
    }),

    // The scrim over the photograph: a flat 20% black, plus a 20% gradient
    // running from black at the bottom to clear at the top. The brand file
    // sets these to multiply, which for pure black is arithmetically the same
    // as ordinary compositing (both leave 0.8 x the original), so no blend
    // mode is needed here and none is available in this renderer anyway.
    scrim === false ? null : h("div", {
      key: "scrim",
      style: {
        position: "absolute", top: 0, left: 0, display: "flex",
        width: CANVAS_W + "px", height: PHOTO_H + "px",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        backgroundImage: "linear-gradient(to top, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0) 100%)",
      },
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
      fontWeight: 700, lineHeight: TITLE_LH, letterSpacing: TITLE_TRACKING + "px",
    },
  }, [
    ...words.map((w, i) => h("span", { key: "w" + i, style: { marginRight: WORD_GAP + "em" } }, w)),
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
      display: "flex", backgroundColor: "#161616", fontFamily: "Google Sans Flex",
    },
  }, children);
}
