import numpy as np, glob, os, sys
from PIL import Image

SRC = "/home/claude/linkedin-ads/public/backgrounds"
DST = "/home/claude/linkedin-ads/public/photos"
TOP, BOT = 220, 867          # the band that is photograph, not old branding
TARGET = 86.0                # mean the brand frames sit at once un-overlaid
os.makedirs(DST, exist_ok=True)

def lift(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im.crop((0, TOP, im.width, BOT)), dtype=np.float32)

    # 1. Undo the vertical darkening. The old overlay was a gradient, so each
    #    row was multiplied by a different amount. Flatten by dividing each row
    #    by its own level relative to the brightest part of the band, damped so
    #    genuinely dark scenery is not forced to match a bright window.
    rows = a.mean(axis=(1, 2))
    k = np.ones(81) / 81.0
    smooth = np.convolve(np.pad(rows, 40, mode="edge"), k, mode="valid")[:len(rows)]
    ref = np.percentile(smooth, 85)
    factor = np.clip((ref / np.maximum(smooth, 1.0)) ** 0.6, 1.0, 1.9)
    a *= factor[:, None, None]

    # 2. Bring the whole band up to the target, with the same damping so an
    #    already-bright photo is barely touched.
    gain = float(np.clip((TARGET / max(a.mean(), 1.0)) ** 0.75, 1.0, 2.3))
    a *= gain

    # 3. Roll the highlights off rather than clipping them flat, so faces and
    #    windows keep their detail instead of turning into white shapes.
    a = np.where(a > 200, 200 + (a - 200) * (55.0 / np.maximum(a.max() - 200, 55.0)), a)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), gain

files = sorted(glob.glob(SRC + "/*.jpg"))
report = []
for f in files:
    out, gain = lift(f)
    name = os.path.basename(f)
    out.save(os.path.join(DST, name), quality=90, subsampling=0)
    report.append((name, gain, float(np.asarray(out.convert("L")).mean())))
print("processed %d images -> public/photos" % len(report))
for n, g, m in report[:10]:
    print("   %-14s gain %.2f  mean %5.1f" % (n, g, m))
print("   ...")
means = [m for _, _, m in report]
print("mean brightness across all: %.1f  (min %.1f, max %.1f)" % (sum(means)/len(means), min(means), max(means)))
