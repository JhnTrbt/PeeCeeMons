"""make_icon.py -- generates the Peeceemons app icon.

Draws the clamshell at 64x64 and upscales with nearest-neighbour, so the
result is genuinely pixel-art rather than a smooth graphic shrunk down.

    python sprite-pipeline/make_icon.py

Writes sprite-pipeline/_preview/icon-source.png (1024x1024). Feed that to
`cargo tauri icon` to produce the .ico and PNG set in src-tauri/icons/.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "sprite-pipeline" / "_preview" / "icon-source.png"

SHELL = (0x8B, 0xA8, 0x7A)
SHELL_DARK = (0x5E, 0x76, 0x50)
SHELL_LIGHT = (0xB4, 0xCB, 0x9E)
LCD = (0xC6, 0xE0, 0x8A)
LCD_DARK = (0x39, 0x4A, 0x2B)
INK = (0x1B, 0x24, 0x14)
FIRE = (0xF8, 0x78, 0x38)
FIRE_DARK = (0xC0, 0x38, 0x10)
FIRE_LIGHT = (0xFF, 0xD0, 0x60)


def main() -> None:
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Device body
    d.rounded_rectangle([4, 2, 59, 61], radius=6, fill=SHELL, outline=INK, width=2)
    d.rounded_rectangle([6, 4, 57, 30], radius=3, fill=SHELL_LIGHT)

    # LCD
    d.rectangle([11, 8, 52, 33], fill=LCD_DARK)
    d.rectangle([13, 10, 50, 31], fill=LCD)

    # A little fire-pup on the screen: body, head, ear, legs, eye.
    d.ellipse([20, 19, 34, 28], fill=FIRE)
    d.ellipse([30, 15, 40, 25], fill=FIRE)
    d.polygon([(31, 16), (35, 16), (33, 11)], fill=FIRE)
    d.rectangle([22, 26, 24, 30], fill=FIRE_DARK)
    d.rectangle([30, 26, 32, 30], fill=FIRE_DARK)
    d.ellipse([19, 20, 23, 25], fill=FIRE_DARK)
    d.rectangle([35, 18, 37, 20], fill=INK)
    d.polygon([(36, 12), (38, 8), (40, 12)], fill=FIRE_LIGHT)

    # D-pad
    d.rectangle([11, 40, 23, 45], fill=SHELL_DARK)
    d.rectangle([14, 37, 20, 48], fill=SHELL_DARK)

    # A / B buttons
    d.ellipse([44, 42, 52, 50], fill=FIRE_DARK)
    d.ellipse([35, 46, 43, 54], fill=FIRE_DARK)

    # Start / select
    d.rounded_rectangle([22, 53, 30, 56], radius=1, fill=SHELL_DARK)
    d.rounded_rectangle([32, 53, 40, 56], radius=1, fill=SHELL_DARK)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.resize((1024, 1024), Image.NEAREST).save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
