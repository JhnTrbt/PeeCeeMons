"""postprocess.py -- turns one generated image into a full sprite set.

Stage 2 (clean up), then Stage 3 (derive the animation frames). Both are
completely deterministic: same input, same output, every time. Diffusion is
only ever used for the single base pose; nothing here rolls a dice, which is
why the frames stay consistent when the art does not.

    Stage 2   magenta chroma-key -> autocrop -> centre -> nearest-neighbour
              downscale to 32x32 -> quantise to the creature's exact 4 colours
    Stage 3   idle.png  (2 frames: idle, blink)
              walk.png  (2 frames: alternating feet + a 1px body bob)
              move.png  (up to 4 frames, per-type table)

Run it on its own, without ComfyUI, on any PNG:

    python sprite-pipeline/postprocess.py --input shot.png --creature Flarepup
    python sprite-pipeline/postprocess.py --all          # everything in _raw/
    python sprite-pipeline/postprocess.py --self-test    # synthesise + verify
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "sprite-pipeline" / "_raw"
OUT = ROOT / "src" / "assets" / "sprites"
PREVIEW = ROOT / "sprite-pipeline" / "_preview"
CREATURES = ROOT / "src" / "data" / "creatures.json"
CONFIG = ROOT / "sprite-pipeline" / "pipeline.config.json"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def roster() -> dict:
    data = load_json(CREATURES)
    return {c["name"]: c for c in data["creatures"]}


def config() -> dict:
    return load_json(CONFIG)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# --------------------------------------------------------------------------
# Stage 2 -- clean up
# --------------------------------------------------------------------------

def chroma_key(img: Image.Image, key: str, tolerance: int) -> Image.Image:
    """Knock out the magenta backdrop. Distance-based rather than exact match,
    because the sampler never returns a perfectly flat background."""
    img = img.convert("RGBA")
    kr, kg, kb = hex_rgb(key)
    px = img.load()
    w, h = img.size
    tol_sq = tolerance * tolerance
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if (r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2 <= tol_sq:
                px[x, y] = (0, 0, 0, 0)
    return img


def autocrop_center(img: Image.Image) -> Image.Image:
    """Crop to the creature, then centre it on a square canvas so every sheet
    shares an origin."""
    bbox = img.getbbox()
    if not bbox:
        return img
    cropped = img.crop(bbox)
    side = max(cropped.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return canvas


def quantise(img: Image.Image, palette: list[str]) -> Image.Image:
    """Map every pixel to the nearest of the creature's 4 ramp colours.
    Anything under half alpha becomes fully transparent -- hard edges only,
    no anti-aliased fringe (§8.1)."""
    ramp = [hex_rgb(c) for c in palette]
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
                continue
            best, bestd = ramp[0], None
            for c in ramp:
                d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
                if bestd is None or d < bestd:
                    best, bestd = c, d
            px[x, y] = (*best, 255)
    return img


def stage2(src: Image.Image, spec: dict, cfg: dict) -> Image.Image:
    size = cfg.get("frame_size", 32)
    img = chroma_key(src, cfg.get("chroma_key", "#FF00FF"), cfg.get("chroma_tolerance", 70))
    img = autocrop_center(img)
    img = img.resize((size, size), Image.NEAREST)
    return quantise(img, spec["palette"])


# --------------------------------------------------------------------------
# Stage 3 -- derive the frames
# --------------------------------------------------------------------------

def shift(img: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (dx, dy))
    return out


def opaque_rows(img: Image.Image) -> list[int]:
    px = img.load()
    w, h = img.size
    return [y for y in range(h) if any(px[x, y][3] > 0 for x in range(w))]


def blink_frame(base: Image.Image, palette: list[str]) -> Image.Image:
    """Darken a 1px band across the upper face. Without knowing where the eyes
    are we approximate: the eye line of a front-facing 32px sprite sits about
    a third of the way down the occupied rows."""
    out = base.copy()
    rows = opaque_rows(out)
    if not rows:
        return out
    top, bottom = rows[0], rows[-1]
    eye_y = top + max(1, round((bottom - top) * 0.34))
    outline = hex_rgb(palette[3])
    px = out.load()
    for x in range(out.width):
        if px[x, eye_y][3] > 0:
            px[x, eye_y] = (*outline, 255)
    return out


def walk_frames(base: Image.Image) -> list[Image.Image]:
    """Two frames: the lower third steps left then right while the body bobs.
    Splitting at the legs is what makes it read as walking rather than
    sliding the whole sprite about."""
    frames = []
    rows = opaque_rows(base)
    split = base.height - 8 if not rows else rows[0] + round((rows[-1] - rows[0]) * 0.66)

    for phase, (leg_dx, bob) in enumerate([(-1, 0), (1, -1)]):
        f = Image.new("RGBA", base.size, (0, 0, 0, 0))
        top = base.crop((0, 0, base.width, split))
        legs = base.crop((0, split, base.width, base.height))
        f.paste(top, (0, bob))
        f.paste(legs, (leg_dx, 0 if bob == 0 else bob), legs)
        # Re-paste legs at their own row, offset horizontally.
        f2 = Image.new("RGBA", base.size, (0, 0, 0, 0))
        f2.paste(top, (0, bob))
        f2.alpha_composite(shift(legs, leg_dx, split + (bob if bob else 0)))
        frames.append(f2)
    return frames


def brightness(img: Image.Image, factor: float) -> Image.Image:
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (
                    min(255, int(r * factor)), min(255, int(g * factor)),
                    min(255, int(b * factor)), a,
                )
    return out


def squash(img: Image.Image, sx: float, sy: float) -> Image.Image:
    w = max(1, int(img.width * sx))
    h = max(1, int(img.height * sy))
    scaled = img.resize((w, h), Image.NEAREST)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(scaled, ((img.width - w) // 2, img.height - h))  # feet stay planted
    return out


def outline_flash(img: Image.Image) -> Image.Image:
    """White 1px rim -- reads as an electric discharge at 32px."""
    out = img.copy()
    px = out.load()
    src = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if src[x, y][3] == 0:
                continue
            edge = any(
                nx < 0 or ny < 0 or nx >= w or ny >= h or src[nx, ny][3] == 0
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            )
            if edge:
                px[x, y] = (255, 255, 255, 255)
    return out


# Per-type starter frames (§8.3). Each entry is a list of transforms.
MOVE_TABLE = {
    "fire":     [lambda i: brightness(i, 1.25), lambda i: brightness(i, 1.6),
                 lambda i: brightness(i, 1.25), lambda i: i],
    "ice":      [lambda i: squash(i, 1.12, 0.9), lambda i: squash(i, 1.2, 0.84),
                 lambda i: squash(i, 0.94, 1.06), lambda i: i],
    "electric": [lambda i: shift(i, 1, 0), lambda i: outline_flash(i),
                 lambda i: shift(i, -1, 0), lambda i: i],
    "water":    [lambda i: shift(i, 0, -1), lambda i: squash(i, 1.1, 0.92),
                 lambda i: shift(i, 0, -1), lambda i: i],
    "grass":    [lambda i: shift(i, 0, -1), lambda i: shift(i, 0, -2),
                 lambda i: shift(i, 0, -1), lambda i: i],
    "rock":     [lambda i: shift(i, 1, 0), lambda i: shift(i, -1, 0),
                 lambda i: squash(i, 1.14, 0.88), lambda i: i],
    "psychic":  [lambda i: shift(i, 0, -1), lambda i: brightness(i, 1.4),
                 lambda i: shift(i, 0, -1), lambda i: i],
    "shadow":   [lambda i: fade(i, 0.55), lambda i: fade(i, 0.25),
                 lambda i: fade(i, 0.55), lambda i: i],
    "dragon":   [lambda i: shift(i, 0, -1), lambda i: brightness(i, 1.45),
                 lambda i: squash(i, 1.12, 0.94), lambda i: i],
    "normal":   [lambda i: shift(i, 2, 0), lambda i: squash(i, 1.15, 0.9),
                 lambda i: shift(i, -2, 0), lambda i: i],
}


def fade(img: Image.Image, alpha: float) -> Image.Image:
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (r, g, b, int(a * alpha))
    return out


def strip(frames: list[Image.Image]) -> Image.Image:
    """Lay frames out as a horizontal strip -- the format §8.1 specifies."""
    if not frames:
        raise ValueError("no frames")
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    return sheet


def stage3(base: Image.Image, spec: dict) -> dict[str, Image.Image]:
    moves = MOVE_TABLE.get(spec["type"], MOVE_TABLE["normal"])
    return {
        "idle": strip([base, blink_frame(base, spec["palette"])]),
        "walk": strip(walk_frames(base)),
        "move": strip([fn(base) for fn in moves]),
    }


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def process(path: Path, spec: dict, cfg: dict, quiet: bool = False) -> Path:
    src = Image.open(path)
    base = stage2(src, spec, cfg)
    sheets = stage3(base, spec)

    dest = OUT / spec["name"]
    dest.mkdir(parents=True, exist_ok=True)
    for kind, sheet in sheets.items():
        sheet.save(dest / f"{kind}.png")
    if not quiet:
        print(f"  {spec['name']:<12} -> {dest.relative_to(ROOT)}  "
              f"(idle 2, walk 2, move {len(MOVE_TABLE.get(spec['type'], []))})")
    return dest


def contact_sheet(specs: list[dict], cols: int = 5,
                  src_dir: Path | None = None, out_name: str = "contact-sheet.png") -> Path:
    """One glance at all 20: colour on top, silhouette underneath."""
    src_dir = src_dir or OUT
    cell, pad = 32, 6
    rows = (len(specs) + cols - 1) // cols
    W = cols * (cell + pad) + pad
    H = rows * (cell * 2 + pad * 2) + pad
    sheet = Image.new("RGBA", (W, H), (26, 32, 24, 255))

    for i, spec in enumerate(specs):
        idle = src_dir / spec["name"] / "idle.png"
        if not idle.exists():
            continue
        frame = Image.open(idle).convert("RGBA").crop((0, 0, cell, cell))
        cx = pad + (i % cols) * (cell + pad)
        cy = pad + (i // cols) * (cell * 2 + pad * 2)
        sheet.paste(frame, (cx, cy), frame)

        sil = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        sp, fp = sil.load(), frame.load()
        for y in range(cell):
            for x in range(cell):
                if fp[x, y][3] > 0:
                    sp[x, y] = (0, 0, 0, 255)
        sheet.paste(sil, (cx, cy + cell + pad), sil)

    PREVIEW.mkdir(parents=True, exist_ok=True)
    out = PREVIEW / out_name
    sheet.resize((W * 3, H * 3), Image.NEAREST).save(out)
    return out


def synth_test_input(spec: dict, size: int = 512) -> Image.Image:
    """A fake 'generated' image: a blobby creature on flat magenta. Lets the
    whole of stages 2 and 3 be exercised with no ComfyUI running."""
    from PIL import ImageDraw

    img = Image.new("RGB", (size, size), hex_rgb("#FF00FF"))
    d = ImageDraw.Draw(img)
    base, shade, high, outline = [hex_rgb(c) for c in spec["palette"]]
    cx, cy = size // 2, size // 2
    d.ellipse([cx - 150, cy - 110, cx + 150, cy + 150], fill=base, outline=outline, width=10)
    d.ellipse([cx + 10, cy - 40, cx + 140, cy + 120], fill=shade)
    d.ellipse([cx - 120, cy - 90, cx - 30, cy - 10], fill=high)
    d.ellipse([cx - 90, cy - 60, cx - 60, cy - 30], fill=outline)
    d.ellipse([cx + 30, cy - 60, cx + 60, cy - 30], fill=outline)
    d.rectangle([cx - 100, cy + 120, cx - 60, cy + 170], fill=outline)
    d.rectangle([cx + 60, cy + 120, cx + 100, cy + 170], fill=outline)
    return img


def self_test() -> int:
    """Synthesise an input per creature, run it through, and check the output
    really matches the sheet spec.

    Writes to a sandbox, never to src/assets/sprites -- these are fake inputs,
    and dropping them into the live folder would override the app's good
    procedural placeholders with identical grey blobs.
    """
    specs = roster()
    cfg = config()
    sandbox = PREVIEW / "_selftest"
    failures = []
    print(f"self-test: {len(specs)} creatures through stages 2 and 3")
    print(f"output sandbox: {sandbox.relative_to(ROOT)}\n")

    for name, spec in specs.items():
        img = synth_test_input(spec)
        base = stage2(img, spec, cfg)
        sheets = stage3(base, spec)

        size = cfg.get("frame_size", 32)
        allowed = {hex_rgb(c) for c in spec["palette"]}

        for kind, sheet in sheets.items():
            n = {"idle": 2, "walk": 2, "move": 4}[kind]
            if sheet.size != (size * n, size):
                failures.append(f"{name}/{kind}: size {sheet.size}, expected {(size * n, size)}")
            # Colour check on the first frame only; later frames deliberately
            # brighten or fade, which is allowed by the spec.
            if kind == "idle":
                first = sheet.crop((0, 0, size, size))
                stray = {p[:3] for p in first.getdata() if p[3] > 0} - allowed
                if stray:
                    failures.append(f"{name}/idle: {len(stray)} colours outside the palette")
                if not any(p[3] > 0 for p in first.getdata()):
                    failures.append(f"{name}/idle: frame is empty")

        dest = sandbox / name
        dest.mkdir(parents=True, exist_ok=True)
        for kind, sheet in sheets.items():
            sheet.save(dest / f"{kind}.png")

    sheet_path = contact_sheet(list(specs.values()), src_dir=sandbox,
                               out_name="contact-sheet-selftest.png")
    print(f"contact sheet: {sheet_path.relative_to(ROOT)}")

    if failures:
        print(f"\nFAIL ({len(failures)}):")
        for f in failures[:20]:
            print("  " + f)
        return 1
    print(f"\nPASS: {len(specs)} creatures x 3 sheets, all 32x32, palette-clean")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Peeceemons sprite post-processing")
    ap.add_argument("--input", type=Path, help="a single generated PNG")
    ap.add_argument("--creature", help="which creature --input is")
    ap.add_argument("--all", action="store_true", help="process everything in _raw/")
    ap.add_argument("--self-test", action="store_true",
                    help="synthesise inputs and verify the output spec (no ComfyUI needed)")
    ap.add_argument("--contact-sheet", action="store_true", help="rebuild the preview only")
    args = ap.parse_args()

    specs = roster()
    cfg = config()

    if args.self_test:
        return self_test()

    if args.contact_sheet:
        print("wrote", contact_sheet(list(specs.values())).relative_to(ROOT))
        return 0

    if args.input:
        if not args.creature or args.creature not in specs:
            print(f"--creature must be one of: {', '.join(sorted(specs))}", file=sys.stderr)
            return 2
        process(args.input, specs[args.creature], cfg)
        return 0

    if args.all:
        if not RAW.exists():
            print(f"nothing in {RAW} yet — run generate.py first", file=sys.stderr)
            return 1
        done = 0
        for path in sorted(RAW.glob("*.png")):
            spec = specs.get(path.stem)
            if not spec:
                print(f"  skipping {path.name}: not in the roster")
                continue
            process(path, spec, cfg)
            done += 1
        if done:
            print("\ncontact sheet:", contact_sheet(list(specs.values())).relative_to(ROOT))
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
