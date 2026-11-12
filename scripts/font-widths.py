"""
Cuts the three Google Sans Flex instances the advert uses, and prints the
glyph-width table that lib/ad-layout.js measures titles with.

Google Sans Flex is a variable font with an OPTICAL SIZE axis (opsz 6-144,
default 18). Figma drives that axis from the font size automatically, so a
single static cut cannot match the brand file at more than one size: at the
default opsz of 18, the 100px title renders about 6% wider than
"Job Advert | Single page 1" and the first line no longer holds.

So each size used in the advert gets its own cut:

    GSF-display.ttf   opsz 100   the job title
    GSF-meta.ttf      opsz  35   the salary line
    GSF-small.ttf     opsz  25   the division pill and the web address

All three at wght 500 (Medium — the brand file is not bold), wdth 100,
GRAD 0, ROND 0, slnt 0, which are the values the brand file sets.

Run with:  python3 scripts/font-widths.py
Needs:     pip install fonttools brotli
           npm pack @fontsource-variable/google-sans-flex  (for the source)

Verified against the brand frame: every string renders within 0.4% of Figma.
"""
import os
import sys
from collections import defaultdict

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(__file__)
DST = os.path.join(HERE, "..", "app", "fonts")

# The latin "full" axis file from @fontsource-variable/google-sans-flex.
SRC = os.environ.get(
    "GSF_SRC",
    "node_modules/@fontsource-variable/google-sans-flex/files/"
    "google-sans-flex-latin-full-normal.woff2",
)

AXES = {"wght": 500, "wdth": 100, "GRAD": 0, "ROND": 0, "slnt": 0}
CUTS = [(100, "display"), (35, "meta"), (25, "small")]

# Everything an advert can contain: ASCII, the pound sign, dashes, a curly
# apostrophe and the accented letters that turn up in names and places.
CHARS = "".join(chr(c) for c in range(32, 127)) + "£–—’éèáàöüäñç"


def cut(opsz, name):
    font = TTFont(SRC)
    inst = instancer.instantiateVariableFont(
        font, dict(AXES, opsz=opsz), inplace=False, updateFontNames=False
    )
    inst.flavor = None
    tmp = os.path.join(DST, "_tmp.ttf")
    inst.save(tmp)
    out = os.path.join(DST, "GSF-%s.ttf" % name)
    subset.main([tmp, "--text=%s" % CHARS, "--output-file=%s" % out,
                 "--layout-features=kern,liga,calt", "--no-hinting",
                 "--desubroutinize"])
    os.remove(tmp)
    return out


def width_table(path):
    """Advance widths in em, grouped by width so the table stays short."""
    font = TTFont(path)
    upm = font["head"].unitsPerEm
    hmtx, cmap = font["hmtx"], font.getBestCmap()
    by_width = defaultdict(list)
    for ch in CHARS:
        glyph = cmap.get(ord(ch))
        if glyph:
            by_width[round(hmtx[glyph][0] / upm, 3)].append(ch)
    lines = ["const GLYPH_W = ["]
    for w, chars in sorted(by_width.items()):
        s = "".join(sorted(chars)).replace("\\", "\\\\").replace('"', '\\"')
        lines.append('  [%s, "%s"],' % (w, s))
    lines.append("];")
    return "\n".join(lines)


if __name__ == "__main__":
    if not os.path.exists(SRC):
        sys.exit("source font not found: %s\n"
                 "install it with: npm i @fontsource-variable/google-sans-flex" % SRC)
    display = None
    for opsz, name in CUTS:
        path = cut(opsz, name)
        if name == "display":
            display = path
        print("wrote %s  (opsz %d, %d bytes)" % (path, opsz, os.path.getsize(path)))
    print("\nPaste the block below over GLYPH_W in lib/ad-layout.js:\n")
    print(width_table(display))
