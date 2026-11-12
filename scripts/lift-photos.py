"""
Turns the old advert artwork in public/backgrounds into usable photographs in
public/photos.

Those files are finished adverts from the previous design, not photographs.
Each carries three things that have to come off: the thin "e" line-art that
sweeps across the whole frame, the old branding top and bottom, and a dark
overlay burnt into the picture.

Run with: python3 scripts/lift-photos.py
"""
import numpy as np, glob, os
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "..", "public", "backgrounds")
DST = os.path.join(os.path.dirname(__file__), "..", "public", "photos")
TOP, BOT = 220, 867     # the band between the old pill and the old logo
TARGET = 86.0           # brightness the brand frames sit at, un-overlaid
BLUR = 18               # separates the thin line-art from the photography

# ---- How far each picture can be shifted ----------------------------------
# The old advert's "New Vacancy" pill sat at y 89-174 and its "i" icon at
# y 989-1069. The pill's fill is all but opaque — the photograph behind it is
# not recoverable — so the window can never start above y=175, and must end
# before y=989. Against the standard 220-867 window that leaves 45px of room
# upwards and 122px downwards.
CLEAN_TOP, CLEAN_BOT = 175, 985

# Per-photo framing, in pixels. NEGATIVE moves the window up the source, which
# makes the subject sit LOWER in the advert ("move the picture down"); POSITIVE
# does the reverse. Out-of-range values are clamped, and the run reports it.
OFFSETS = {
    # move the picture down — more room above the head
    "bg-04": -45, "bg-05": -45, "bg-09": -140, "bg-10": -45,
    "bg-15": -45, "bg-16": -45, "bg-28": -45, "exec-05": -95,
    # move the picture up
    "bg-11": 90, "bg-17": 90, "bg-19": 90, "bg-20": 90, "bg-22": 90,
    "bg-23": 90, "bg-29": 90, "bg-32": 90, "exec-02": 90, "exec-08": 90,
}

# Photos withdrawn from the rotation. Also remove the filename from
# BACKGROUNDS (or the division's pool) in lib/config.js.
DROP = {"bg-25"}

# Photos allowed to shift further up than CLEAN_TOP by patching over where the
# pill was with a mirror of the band directly below it. Only safe where that
# corner is texture — foliage, a blurred wall — and never where it holds a face,
# a straight edge or lettering: check the result before adding a name here.
PILL_BOX = (80, 78, 384, 186)
PILL_FILL = {"bg-09", "exec-05"}

os.makedirs(DST, exist_ok=True)


def highpass(path):
    im = Image.open(path).convert("L")
    a = np.asarray(im, dtype=np.float32)
    return a - np.asarray(im.filter(ImageFilter.GaussianBlur(BLUR)), dtype=np.float32)


def common_overlay(paths):
    """What every image in a group shares is the template, not the photography.

    Thirty-five different photographs have nothing fine-grained in common, so
    the per-pixel median of their high-pass is the line-art and nothing else.
    """
    return np.median(np.stack([highpass(p) for p in paths]), axis=0)


def window_for(name):
    """The source rows this photo is cropped from, and whether it was clamped."""
    want = OFFSETS.get(name, 0)
    low = (0 if name in PILL_FILL else CLEAN_TOP) - TOP
    high = CLEAN_BOT - (BOT - TOP) - TOP
    got = max(low, min(high, want))
    return TOP + got, BOT + got, got, (got != want)


def patch_pill(a):
    """Cover the old pill with a mirror of the band immediately below it.

    The pill's fill is all but opaque — measured across the 35 adverts, what is
    behind it only moves the pixel by a quarter of its value — so there is no
    photograph to recover, only somewhere plausible to borrow from.
    """
    x0, y0, x1, y1 = PILL_BOX
    h = y1 - y0
    donor = a[y1:y1 + h, x0:x1, :][::-1]
    mask = np.zeros((h, x1 - x0), np.float32)
    mask[8:-8, 8:-8] = 1.0
    mask = np.asarray(
        Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7)),
        np.float32) / 255.0
    a[y0:y1, x0:x1, :] = (a[y0:y1, x0:x1, :] * (1 - mask[:, :, None])
                          + donor * mask[:, :, None])
    return a


def process(path, overlay, name):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)

    # 1. Subtract the shared line-art, on every channel since it is neutral.
    a -= overlay[:, :, None]

    # 2. Keep only the band that is photograph, shifted by this photo's framing.
    top, bot, _, _ = window_for(name)
    if name in PILL_FILL and top < CLEAN_TOP:
        a = patch_pill(a)
    a = a[top:bot, :, :]

    # 3. Flatten the vertical gradient the old overlay left behind, damped so
    #    a genuinely dark scene is not forced to match a bright one.
    rows = a.mean(axis=(1, 2))
    k = np.ones(81) / 81.0
    smooth = np.convolve(np.pad(rows, 40, mode="edge"), k, mode="valid")[:len(rows)]
    ref = np.percentile(smooth, 85)
    a *= np.clip((ref / np.maximum(smooth, 1.0)) ** 0.6, 1.0, 1.9)[:, None, None]

    # 4. Lift to the target brightness.
    gain = float(np.clip((TARGET / max(a.mean(), 1.0)) ** 0.75, 1.0, 2.3))
    a *= gain

    # 5. Roll the highlights off instead of clipping them flat, so faces and
    #    windows keep their detail.
    a = np.where(a > 200, 200 + (a - 200) * (55.0 / max(a.max() - 200, 55.0)), a)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


total = 0
# bg-* and exec-* were laid out from different templates, so each group needs
# its own estimate of the shared artwork.
for prefix in ("bg-", "exec-"):
    paths = sorted(glob.glob(os.path.join(SRC, prefix + "*.jpg")))
    if not paths:
        continue
    overlay = common_overlay(paths)
    print("%-6s %2d images, line-art range %.1f..%.1f" % (prefix, len(paths), overlay.min(), overlay.max()))
    for p in paths:
        name = os.path.basename(p)[:-4]
        out = os.path.join(DST, name + ".jpg")
        if name in DROP:
            if os.path.exists(out):
                os.remove(out)
            print("       %s dropped" % name)
            continue
        _, _, got, clamped = window_for(name)
        if got:
            print("       %s shifted %+d%s" % (name, got, " (clamped)" if clamped else ""))
        process(p, overlay, name).save(out, quality=90, subsampling=0)
        total += 1
print("wrote %d photographs to public/photos" % total)
