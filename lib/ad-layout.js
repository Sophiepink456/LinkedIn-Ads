import React from "react";

// ---------------------------------------------------------------------------
// The advert layout, as one element tree.
//
// Lives here rather than inside the route so it can be rendered two ways: the
// route hands it to next/og in production, and the local satori harness hands
// the identical tree to satori to diff against the Figma frames. Duplicating
// the markup in a test is what lets a layout drift from the design unnoticed.
//
// Every number is taken from Brand System > "Job Advert | Single page 1-3"
// (file dQpO0rDkzxM9bmGr0aDWqR, nodes 303:237 / 303:264 / 303:289), read out
// of the file itself rather than measured off a screenshot:
//
//   Image            0,   0  1080 x 647    the photograph
//   Texture        0, 647  1080 x 703      the panel artwork, 1 of 3
//   Content       100, 610   880           pill pinned at the top, then 125px
//                                          of padding, the title, a 35px gap
//                                          and the salary line
//   Footer        112,1169   logo 390x81, then 195px, then the link group
// ---------------------------------------------------------------------------

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;
export const PHOTO_H = 647;

export const LIME = "#BAE400";
export const INK = "#161616";

// ---- Type ------------------------------------------------------------------
// Google Sans Flex, Medium (500) throughout — not bold. The brand file sets
// GRAD 0, ROND 0, wdth 100 on every text layer, which are the font's defaults.
//
// It also carries an OPTICAL SIZE axis, which Figma drives from the font size
// automatically. That is not cosmetic: instanced at the font's default opsz of
// 18, the 100px title renders 6% wider than the brand file and "Interim M&A
// Project" no longer holds its line. So the font ships as three instances cut
// at the sizes actually used, and each piece of text asks for its own.
export const FONT_DISPLAY = "GSF Display";   // opsz 100 — the title
export const FONT_META = "GSF Meta";         // opsz  35 — the salary line
export const FONT_SMALL = "GSF Small";       // opsz  25 — the pill and the URL
export const FONT_WEIGHT = 500;

const CONTENT_X = 100, CONTENT_W = 880;

const PILL_Y = 610, PILL_H = 74, PILL_PAD_X = 30, PILL_RADIUS = 40;
const PILL_SIZE = 25, PILL_LH = 1.25;

const TITLE_Y = 735;
const TITLE_BASE = 100;
const TITLE_LH = 1.2;
// The title is one text run in Figma, so words are separated by the font's own
// space advance at opsz 100, not an invented margin.
const WORD_GAP = 0.199;

const META_GAP = 35, META_SIZE = 35, META_LH = 1.25;

// The salary line follows the title rather than sitting at a fixed height, as
// in the brand file's flex column. It must still clear the logo, which starts
// at 1169; this is the lowest the salary line may end.
const CONTENT_LIMIT = 1140;

const LOGO_X = 112, LOGO_Y = 1169, LOGO_W = 390, LOGO_H = 81;
const ICON_X = 697, ICON_Y = 1194, ICON_W = 30, ICON_H = 30.5;
const URL_X = 737, URL_SIZE = 25, URL_TRACK = -1.25;
const SITE_URL = "www.elevationrg.com";

// ---- Measuring the title ---------------------------------------------------
// Google Sans Flex Medium at opsz 100, advance widths in em, read straight out
// of the font file (scripts/font-widths.py regenerates this).
//
// This replaces an average-character-width guess. That guess assumed a word
// could break anywhere, so "Multi-Skilled Maintenance Engineer" measured as
// two lines and rendered as three, and on 12 November a live advert had its
// third line sitting on the salary.
const GLYPH_W = [
  [0.195, "'"],
  [0.199, " "],
  [0.203, "l"],
  [0.224, "i"],
  [0.226, "j"],
  [0.235, "I"],
  [0.242, ",.:;’"],
  [0.263, "|"],
  [0.278, "!"],
  [0.297, "-"],
  [0.331, "f"],
  [0.332, "()"],
  [0.333, "/"],
  [0.336, "\\t"],
  [0.347, "\""],
  [0.35, "r"],
  [0.357, "[]"],
  [0.37, "{}"],
  [0.385, "1"],
  [0.397, "`"],
  [0.424, "*"],
  [0.456, "sz"],
  [0.467, "^"],
  [0.482, "7"],
  [0.487, "x"],
  [0.488, "L"],
  [0.496, "_–"],
  [0.497, "?"],
  [0.498, "vy"],
  [0.501, "F"],
  [0.507, "k"],
  [0.516, "J"],
  [0.52, "E"],
  [0.521, "T"],
  [0.526, "àáä"],
  [0.527, "a"],
  [0.532, "cç"],
  [0.533, "23"],
  [0.543, "£"],
  [0.546, "eèé"],
  [0.549, "uü"],
  [0.551, "S"],
  [0.552, "hnñ"],
  [0.556, "69"],
  [0.56, "5Z"],
  [0.562, "+<=>~"],
  [0.567, "4"],
  [0.57, "P"],
  [0.575, "8"],
  [0.583, "g"],
  [0.585, "bdopqö"],
  [0.588, "R"],
  [0.593, "B"],
  [0.605, "$"],
  [0.612, "0"],
  [0.62, "KY"],
  [0.626, "V"],
  [0.632, "&"],
  [0.635, "X"],
  [0.641, "#"],
  [0.649, "U"],
  [0.662, "A"],
  [0.68, "D"],
  [0.681, "H"],
  [0.682, "N"],
  [0.699, "C"],
  [0.769, "G"],
  [0.773, "w"],
  [0.793, "—"],
  [0.795, "OQ"],
  [0.831, "%"],
  [0.863, "M"],
  [0.866, "@"],
  [0.879, "m"],
  [0.96, "W"],
];

const CHAR_W = {};
for (const [w, chars] of GLYPH_W) {
  for (const c of chars) CHAR_W[c] = w;
}
const FALLBACK_W = 0.62;   // an unmapped glyph is assumed wide, never narrow

const TITLE_STEPS = [TITLE_BASE, 86, 76, 66, 58, 50];

function wordWidth(word, size) {
  let w = 0;
  for (const c of word) w += (CHAR_W[c] === undefined ? FALLBACK_W : CHAR_W[c]) * size;
  return w;
}

function lineCountAt(words, size) {
  const gap = WORD_GAP * size;
  let lines = 1;
  let used = 0;
  for (let i = 0; i < words.length; i++) {
    // The last word carries the brand's full stop.
    const w = wordWidth(i === words.length - 1 ? words[i] + "." : words[i], size);
    if (used && used + gap + w > CONTENT_W) { lines++; used = w; }
    else { used += (used ? gap : 0) + w; }
  }
  return lines;
}

// The largest size at which the title, the 35px gap and the salary line all
// finish above the logo.
export function titleLayout(title) {
  const words = String(title || "Job Title").trim().split(/\s+/).filter(Boolean);
  const fits = (size) => {
    const lines = lineCountAt(words, size);
    const bottom = TITLE_Y + lines * TITLE_LH * size + META_GAP + META_SIZE * META_LH;
    return bottom <= CONTENT_LIMIT ? lines : 0;
  };
  for (const size of TITLE_STEPS) {
    const lines = fits(size);
    if (lines) return { size, lines, words };
  }
  const size = TITLE_STEPS[TITLE_STEPS.length - 1];
  return { size, lines: lineCountAt(words, size), words };
}

export function titleSizeFor(title) {
  return titleLayout(title).size;
}

const h = React.createElement;

export function buildAd({ photo, texture, logo, linkIcon, division, title, meta, focus, scrim }) {
  const { size: titleSize, lines, words: allWords } = titleLayout(title);
  const words = allWords.slice();
  const lastWord = words.pop();
  const metaY = TITLE_Y + lines * TITLE_LH * titleSize + META_GAP;

  const children = [
    // The photograph, cropped to 1080x647 by scripts/crop-photos.py, so this
    // is a straight fit. ?focus= is kept for any image that needs nudging.
    h("img", {
      key: "photo", src: photo, width: CANVAS_W, height: PHOTO_H,
      style: { position: "absolute", top: 0, left: 0, width: CANVAS_W + "px",
        height: PHOTO_H + "px", objectFit: "cover", objectPosition: focus || "center" },
    }),

    // The brand file darkens the photograph: a flat 20% black plus a gradient
    // to 20% black at the foot, set to multiply, which for black is the same
    // arithmetic as ordinary compositing. Off by default, at Sophie's request.
    scrim === false ? null : h("div", {
      key: "scrim",
      style: {
        position: "absolute", top: 0, left: 0, display: "flex",
        width: CANVAS_W + "px", height: PHOTO_H + "px",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        backgroundImage: "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.2) 100%)",
      },
    }),

    // The panel. One of three textures, alternating.
    h("img", {
      key: "texture", src: texture, width: CANVAS_W, height: CANVAS_H - PHOTO_H,
      style: { position: "absolute", top: PHOTO_H + "px", left: 0,
        width: CANVAS_W + "px", height: (CANVAS_H - PHOTO_H) + "px" },
    }),
  ];

  // The division pill, straddling the edge of the photograph. Width grows with
  // the wording — the brand frame is 378px for "Accountancy & Finance", but
  // "Procurement & Supply Chain" needs more — so only the height and the
  // padding are fixed.
  if (division) {
    children.push(h("div", {
      key: "pill",
      style: {
        position: "absolute", left: CONTENT_X + "px", top: PILL_Y + "px",
        height: PILL_H + "px", display: "flex", alignItems: "center",
        padding: "0 " + PILL_PAD_X + "px", backgroundColor: LIME,
        borderRadius: PILL_RADIUS + "px",
      },
    }, h("div", {
      style: { display: "flex", color: INK, fontFamily: FONT_SMALL,
        fontSize: PILL_SIZE + "px", fontWeight: FONT_WEIGHT, lineHeight: PILL_LH },
    }, String(division).toUpperCase())));
  }

  // The job title, with the brand's full stop in lime after the last word.
  children.push(h("div", {
    key: "title",
    style: {
      position: "absolute", left: CONTENT_X + "px", top: TITLE_Y + "px",
      // Each word carries a trailing margin, and satori counts that margin
      // against the line even when the word ends it — so "Interim M&A Project"
      // fills 880px and then wraps anyway. Figma, laying the title out as one
      // text run, drops the trailing space at a line end. Widening the box by
      // exactly one word gap restores that: the text still breaks at 880, and
      // a margin hanging past the edge draws nothing.
      width: (CONTENT_W + WORD_GAP * titleSize) + "px",
      display: "flex", flexWrap: "wrap",
      alignItems: "flex-start", color: "#ffffff", fontFamily: FONT_DISPLAY,
      fontSize: titleSize + "px", fontWeight: FONT_WEIGHT, lineHeight: TITLE_LH,
    },
  }, [
    ...words.map((w, i) => h("span", { key: "w" + i, style: { marginRight: WORD_GAP + "em" } }, w)),
    // The last word carries the same trailing margin as the others, so that
    // every line ends with one and the widened box above compensates exactly.
    h("span", { key: "last", style: { display: "flex", marginRight: WORD_GAP + "em" } }, [
      lastWord,
      h("span", { key: "dot", style: { color: LIME } }, "."),
    ]),
  ]));

  // salary | contract type | location
  if (meta) {
    children.push(h("div", {
      key: "meta",
      style: {
        position: "absolute", left: CONTENT_X + "px", top: metaY + "px",
        width: CONTENT_W + "px", height: (META_SIZE * META_LH) + "px",
        display: "flex", alignItems: "center", color: "#ffffff",
        fontFamily: FONT_META, fontSize: META_SIZE + "px", fontWeight: FONT_WEIGHT,
      },
    }, meta));
  }

  // Logo, link icon and web address. Assembled from the two vector assets
  // rather than one flat export: exporting the footer as a single image gave a
  // picture with a white background baked in, which hid the white wordmark
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
    style: { position: "absolute", left: URL_X + "px", top: ICON_Y + "px",
      height: ICON_H + "px", display: "flex", alignItems: "center",
      color: "#ffffff", fontFamily: FONT_SMALL, fontSize: URL_SIZE + "px",
      fontWeight: FONT_WEIGHT, letterSpacing: URL_TRACK + "px" },
  }, SITE_URL));

  return h("div", {
    style: {
      position: "relative", width: CANVAS_W + "px", height: CANVAS_H + "px",
      display: "flex", backgroundColor: INK, fontFamily: FONT_DISPLAY,
    },
  }, children);
}
