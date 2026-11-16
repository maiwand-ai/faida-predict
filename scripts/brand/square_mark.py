#!/usr/bin/env python3
"""Square-pad FAIDA logo mark so it renders distortion-free at w=h.

Next/Image warns when a non-square PNG is rendered with square width/height
attributes (Tailwind preflight makes height:auto). Padding the tight content
bbox to a square keeps the glyph centered and the aspect ratio exact.
Run after scripts/wireframes/brand_assets.py.
"""
from PIL import Image

TARGETS = [
    "/home/z/my-project/assets/brand/logo_mark.png",
    "/home/z/my-project/public/brand/logo_mark.png",
]

for path in TARGETS:
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    canvas.save(path)
    print(f"{path}: {im.size} -> {canvas.size}")
