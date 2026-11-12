"""
Crops the original photographs in public/photos-src into the advert's picture
slot (1080x647) and writes them to public/photos.

This replaces scripts/lift-photos.py, which tried to recover photographs out of
the PREVIOUS design's finished adverts — those had the dark overlay, the "New
Vacancy" pill, the old logo and the "e" line-art burnt into the pixels, and no
amount of processing fully undid that. These are the originals from the shoot,
so nothing needs undoing: they are only cropped.

The slot is a letterbox (1.67:1) and most of the originals are portrait, so the
crop is the whole job. Taking the middle of a portrait photograph usually cuts
the head off, so faces are detected and the window is placed to sit the highest
face a short way down from the top edge, which is where a head wants to be.

Per-photo overrides live in FRAMING below, for the ones the detector gets wrong
or that simply look better framed differently.

Run with: python3 scripts/crop-photos.py
Needs:    pip install opencv-python pillow
"""
import os
import glob

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "..", "public", "photos-src")
DST = os.path.join(HERE, "..", "public", "photos")

OUT_W, OUT_H = 1080, 647

# Where the top of the highest face should sit, as a fraction of the window
# height. A face hard against the top edge reads as a mistake; a third of the
# way down wastes the slot on ceiling.
FACE_TOP = 0.22

# Per-photo framing overrides, applied after the automatic placement.
#   "y": nudge the window up (negative) or down (positive), in output pixels
#   "x": nudge it left or right
#   "zoom": >1 crops in tighter, <1 pulls back (clamped to what the file allows)
# Add a name here when the automatic crop frames something badly.
FRAMING = {
    # The detector locked onto the wall panel behind him and framed his head
    # out of the bottom of the shot.
    "photo-14": {"y": 440},
}

# Photos withdrawn from the rotation. Keep the file in photos-src so the
# decision is visible rather than lost.
DROP = set()

# OpenCV 5 no longer ships the cascade files inside the wheel, so they live
# beside this script. They are the stock OpenCV ones, BSD licensed.
CASCADES = [
    "haarcascade_frontalface_alt2.xml",
    "haarcascade_frontalface_default.xml",
    "haarcascade_profileface.xml",
]
CASCADE_DIR = os.path.join(HERE, "cascades")


def detectors():
    found = []
    for name in CASCADES:
        path = os.path.join(CASCADE_DIR, name)
        if not os.path.exists(path):
            path = os.path.join(getattr(cv2, "data", None).haarcascades, name) \
                if hasattr(cv2, "data") else ""
        if path and os.path.exists(path):
            c = cv2.CascadeClassifier(path)
            if not c.empty():
                found.append(c)
    return found


def find_faces(bgr, cascades):
    """Faces as (x, y, w, h), including mirrored profiles for right-facing heads."""
    grey = cv2.equalizeHist(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    h = grey.shape[0]
    boxes = []
    for c in cascades:
        for g, flip in ((grey, False), (cv2.flip(grey, 1), True)):
            hits = c.detectMultiScale(g, scaleFactor=1.08, minNeighbors=6,
                                      minSize=(int(h * 0.05), int(h * 0.05)))
            for (x, y, w, hh) in hits:
                if flip:
                    x = g.shape[1] - x - w
                boxes.append((int(x), int(y), int(w), int(hh)))
    return boxes


def window_for(img_w, img_h, faces, over):
    """The source rectangle to take, as (x, y, w, h) at the slot's 1.67:1."""
    zoom = float(over.get("zoom", 1.0))
    # Largest window of the right shape that fits, then zoomed in if asked.
    w = min(img_w, img_h * OUT_W / OUT_H) / max(zoom, 0.2)
    h = w * OUT_H / OUT_W
    w, h = min(w, img_w), min(h, img_h)
    scale = OUT_W / w            # source pixels -> output pixels

    if faces:
        # Anchor on the subject, not on everything the detector fired at. Haar
        # finds plenty of faces in a patterned chair or a bright window, and
        # they are always small, so keep only those a reasonable fraction of
        # the biggest — the real subject is the biggest face in the frame.
        biggest = max(f[2] for f in faces)
        faces = [f for f in faces if f[2] >= 0.55 * biggest]
        top = min(f[1] for f in faces)
        cx = sum(f[0] + f[2] / 2.0 for f in faces) / len(faces)
        y = top - FACE_TOP * h
        x = cx - w / 2.0
    else:
        # Nothing found: portraits read better from the upper third, and a
        # landscape frame is already close to the slot's shape.
        x = (img_w - w) / 2.0
        y = (img_h - h) * (0.30 if img_h > img_w else 0.5)

    x += over.get("x", 0) / scale
    y += over.get("y", 0) / scale
    x = max(0.0, min(img_w - w, x))
    y = max(0.0, min(img_h - h, y))
    return int(round(x)), int(round(y)), int(round(w)), int(round(h))


def main():
    os.makedirs(DST, exist_ok=True)
    cascades = detectors()
    if not cascades:
        print("warning: no face cascades available, falling back to centre crops")

    for old in glob.glob(os.path.join(DST, "*.jpg")):
        os.remove(old)

    written = 0
    for path in sorted(glob.glob(os.path.join(SRC, "*.jpg"))):
        name = os.path.splitext(os.path.basename(path))[0]
        if name in DROP:
            print("  %-10s dropped" % name)
            continue
        bgr = cv2.imread(path)
        if bgr is None:
            print("  %-10s unreadable, skipped" % name)
            continue
        faces = find_faces(bgr, cascades) if cascades else []
        x, y, w, h = window_for(bgr.shape[1], bgr.shape[0], faces, FRAMING.get(name, {}))
        crop = Image.open(path).convert("RGB").crop((x, y, x + w, y + h))
        crop = crop.resize((OUT_W, OUT_H), Image.LANCZOS)
        crop.save(os.path.join(DST, name + ".jpg"), quality=88, subsampling=0,
                  optimize=True, progressive=True)
        written += 1
        print("  %-10s %d face(s), window %dx%d at %d,%d" % (name, len(faces), w, h, x, y))

    print("wrote %d photographs to public/photos" % written)


if __name__ == "__main__":
    main()
