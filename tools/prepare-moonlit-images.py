"""Regenerate lightweight WebP copies; the original illustrations stay untouched.

Run tools/prepare-moonlit-images.py with Python and Pillow from the repository root.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "source/img/moonlit"
TARGET.mkdir(parents=True, exist_ok=True)
ASSETS = [
    ("mifeng.jpg", "hero.webp", (1920, 1152), 85),
    ("merry.jpg", "notes.webp", (760, 540), 83),
    ("gu.jpg", "sunset.webp", (900, 750), 82),
    ("k1.jpg", "avatar.webp", (200, 200), 85),
]
for original, output, size, quality in ASSETS:
    with Image.open(ROOT / "source/img" / original) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
        image.save(TARGET / output, "WEBP", quality=quality, method=6)
        print(f"{output}: {(TARGET / output).stat().st_size:,} bytes")
