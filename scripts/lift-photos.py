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


def process(path, overlay):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)

    # 1. Subtract the shared line-art, on every channel since it is neutral.
    a -= overlay[:, :, None]

    # 2. Keep only the band that is photograph.
    a = a[TOP:BOT, :, :]

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
        process(p, overlay).save(os.path.join(DST, os.path.basename(p)), quality=90, subsampling=0)
        total += 1
print("wrote %d photographs to public/photos" % total)
