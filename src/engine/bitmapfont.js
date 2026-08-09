// bitmapfont.js — a hand-authored 5x7 pixel font.
//
// Every glyph is drawn as actual pixels at integer scales, so text stays
// exactly as crisp as the sprites at any size. A webfont cannot promise that:
// at 2x it would hint and antialias and look soft next to the creatures.
//
// Glyphs are written as '#'/'.' rows because that is the only format where a
// typo is obvious at a glance.

const G = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".####|#....|#....|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#..##|#...#|#...#|.###.",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: "#####|..#..|..#..|..#..|..#..|..#..|#####",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#...#|#.#.#|##.##|#...#",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  0: ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  1: "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  2: ".###.|#...#|....#|...#.|..#..|.#...|#####",
  3: "####.|....#|....#|.###.|....#|....#|####.",
  4: "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  5: "#####|#....|####.|....#|....#|#...#|.###.",
  6: "..##.|.#...|#....|####.|#...#|#...#|.###.",
  7: "#####|....#|...#.|..#..|.#...|.#...|.#...",
  8: ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  9: ".###.|#...#|#...#|.####|....#|...#.|.##..",
  " ": ".....|.....|.....|.....|.....|.....|.....",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ",": ".....|.....|.....|.....|.##..|.##..|.#...",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
  "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
  "?": ".###.|#...#|....#|..##.|..#..|.....|..#..",
  "-": ".....|.....|.....|#####|.....|.....|.....",
  "/": "....#|...#.|...#.|..#..|.#...|.#...|#....",
  "'": "..#..|..#..|.....|.....|.....|.....|.....",
  "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
  ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "<": "...#.|..#..|.#...|#....|.#...|..#..|...#.",
  ">": ".#...|..#..|...#.|....#|...#.|..#..|.#...",
  "*": ".....|#.#.#|.###.|#####|.###.|#.#.#|.....",
  "%": "##..#|##..#|...#.|..#..|.#...|#..##|#..##",
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const SPACING = 1;

// Parsed once into arrays of row bitmasks.
const CACHE = new Map();
function glyph(ch) {
  const key = ch.toUpperCase();
  if (CACHE.has(key)) return CACHE.get(key);
  const src = G[key];
  if (!src) {
    CACHE.set(key, null);
    return null;
  }
  const rows = src.split("|").map((r) => {
    let bits = 0;
    for (let i = 0; i < GLYPH_W; i++) if (r[i] === "#") bits |= 1 << i;
    return bits;
  });
  CACHE.set(key, rows);
  return rows;
}

/** Width in pixels that drawText would occupy. */
export function measureText(text, scale = 1) {
  if (!text.length) return 0;
  return (text.length * (GLYPH_W + SPACING) - SPACING) * scale;
}

/**
 * Draw pixel text. `x`,`y` is the top-left. Returns the width drawn.
 * align: "left" | "center" | "right".
 */
export function drawText(ctx, text, x, y, scale = 1, colour = "#000", align = "left") {
  const str = String(text);
  const w = measureText(str, scale);
  let ox = x;
  if (align === "center") ox = Math.round(x - w / 2);
  else if (align === "right") ox = Math.round(x - w);

  ctx.save();
  ctx.fillStyle = colour;
  for (let i = 0; i < str.length; i++) {
    const rows = glyph(str[i]);
    const gx = ox + i * (GLYPH_W + SPACING) * scale;
    if (!rows) continue;
    for (let r = 0; r < GLYPH_H; r++) {
      const bits = rows[r];
      if (!bits) continue;
      for (let c = 0; c < GLYPH_W; c++) {
        if (bits & (1 << c)) {
          ctx.fillRect(gx + c * scale, y + r * scale, scale, scale);
        }
      }
    }
  }
  ctx.restore();
  return w;
}

/** Same text drawn twice, offset — cheap drop shadow for LCD headings. */
export function drawTextShadow(ctx, text, x, y, scale, colour, shadow, align = "left") {
  drawText(ctx, text, x + scale, y + scale, scale, shadow, align);
  return drawText(ctx, text, x, y, scale, colour, align);
}
