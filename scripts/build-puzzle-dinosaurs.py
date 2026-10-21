#!/usr/bin/env python3
"""Make the square puzzle pictures for the dinosaurs.

The illustrations are wide and most sit on white. For each dinosaur this
removes the white connected to the image's border (soft shadows become
translucent shade), trims the margins, and places the animal on a transparent
square: as wide as the frame allows, centered just below the middle so its
feet stand on the puzzle's ground. A painted scene ("fill" below) is cropped
to a square instead. Writes images/dinosaurs/puzzle/<name>.webp and records
each path as "puzzleImage" in dinosaurs.json.

Needs Pillow (with WebP), NumPy and SciPy:
    python scripts/build-puzzle-dinosaurs.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "dinosaurs" / "puzzle"
SIZE = 960
# Picture units: the puzzle picture is 300 units square.
MARGIN = 10 / 300
CENTER_Y = 175 / 300
TOP = 12 / 300
BOTTOM = 268 / 300
# A backdrop pixel is at most this far from white (255 minus its darkest channel).
BACKDROP = 40
# White fenced in by legs and ground shadows is backdrop too when it is this
# close to pure white and covers this share of the image. Painted white
# details, such as teeth and eyes, are smaller or textured.
HOLE = 14
HOLE_AREA = 0.0015
# Antialiased edges within this many pixels of the backdrop fade out with it.
FRINGE = 2
# Paintings with their own scenery are cropped to a square, not cut out.
FILL = {"Brontosaurus"}


def slug(name):
    return "-".join(name.lower().split())


def cut_out(image):
    rgba = np.asarray(image.convert("RGBA")).astype(np.float32)
    rgb, alpha = rgba[..., :3], rgba[..., 3] / 255
    border = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    if (border < 0.5).mean() > 0.5:
        return rgba  # Already transparent.
    distance = 255 - rgb.min(axis=2)
    labels, _ = ndimage.label(distance < BACKDROP)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    backdrop = np.isin(labels, edge_labels[edge_labels > 0])
    holes, count = ndimage.label((distance < HOLE) & ~backdrop)
    sizes = ndimage.sum(np.ones_like(distance), holes, range(1, count + 1))
    backdrop |= np.isin(holes, np.flatnonzero(sizes >= HOLE_AREA * distance.size) + 1)
    soft = ndimage.binary_dilation(backdrop, iterations=FRINGE)
    # Color to alpha against white: over white, each pixel looks as before.
    fade = np.clip(distance / 255, 1e-3, 1)
    unmixed = np.clip((rgb - 255 * (1 - fade[..., None])) / fade[..., None], 0, 255)
    out = rgba.copy()
    out[..., :3] = np.where(soft[..., None], unmixed, rgb)
    out[..., 3] = np.where(soft, fade * 255, 255)
    return out


def trimmed(rgba):
    ys, xs = np.nonzero(rgba[..., 3] > 25)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def placed(rgba):
    height, width = rgba.shape[:2]
    scale = min((1 - 2 * MARGIN) * SIZE / width, (BOTTOM - TOP) * SIZE / height)
    art = Image.fromarray(rgba.astype(np.uint8), "RGBA").resize(
        (round(width * scale), round(height * scale)), Image.LANCZOS)
    top = min(max(CENTER_Y * SIZE - art.height / 2, TOP * SIZE), BOTTOM * SIZE - art.height)
    square = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    square.alpha_composite(art, ((SIZE - art.width) // 2, round(top)))
    return square


def filled(image):
    side = min(image.size)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    return image.convert("RGBA").crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = ROOT / "dinosaurs.json"
    dinosaurs = json.loads(path.read_text())
    for dinosaur in dinosaurs:
        source = Image.open(ROOT / dinosaur["image"])
        square = filled(source) if dinosaur["name"] in FILL else placed(trimmed(cut_out(source)))
        target = OUT / f"{slug(dinosaur['name'])}.webp"
        square.save(target, "WEBP", quality=86, method=6, alpha_quality=90)
        dinosaur["puzzleImage"] = target.relative_to(ROOT).as_posix()
        print(f"{target.relative_to(ROOT)}  {target.stat().st_size // 1024} KB")
    path.write_text(json.dumps(dinosaurs, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
