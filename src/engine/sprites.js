// sprites.js — sprite sourcing for Peeceemons.
//
// Two sources, one interface:
//   1. Drop-in real art:  assets/sprites/<Name>/{idle,walk,move}.png
//   2. Procedural placeholder generated from the creature's palette + seed.
//
// loadSheet() tries (1) and silently falls back to (2), so the app is fully
// playable before any art exists and upgrades itself the moment a PNG appears.
// Both paths return the identical { canvas, frames, fw, fh } shape, so nothing
// downstream ever needs to know which one it got.
//
// Frame contract (also documented in SPRITES.md):
//   32x32 px frames, transparent PNG, horizontal strip, origin bottom-centre.
//   idle = 2 frames (idle, blink) | walk = 2 frames | move = up to 4 frames.

export const FRAME = 32;

const PAL_TRANSPARENT = 0;
const PAL_BASE = 1;
const PAL_SHADE = 2;
const PAL_HIGH = 3;
const PAL_OUTLINE = 4;

/* ------------------------------------------------------------------ *
 * Deterministic RNG — same seed always yields the same creature.
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Grid — a 32x32 buffer of palette indices, painted then converted.
 * ------------------------------------------------------------------ */

class Grid {
  constructor(w = FRAME, h = FRAME) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return PAL_TRANSPARENT;
    return this.d[y * this.w + x];
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = v;
  }
  clone() {
    const g = new Grid(this.w, this.h);
    g.d.set(this.d);
    return g;
  }
}

function fillRect(g, x, y, w, h, v) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g.set(i, j, v);
}

function fillEllipse(g, cx, cy, rx, ry, v) {
  if (rx <= 0 || ry <= 0) return;
  for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
    for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
      const dx = (i - cx) / rx;
      const dy = (j - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) g.set(i, j, v);
    }
  }
}

function fillCircle(g, cx, cy, r, v) {
  fillEllipse(g, cx, cy, r, r, v);
}

// A tapering horn/ear/antler stroke, walked pixel by pixel. The nib is
// centred on the path — off-centre nibs made every appendage read as a
// 1px antenna instead of a limb.
function stroke(g, x0, y0, x1, y1, v, thickness = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const th = Math.max(1, Math.round(thickness * (1 - t * 0.4)));
    fillRect(g, x - (th >> 1), y - (th >> 1), th, th, v);
  }
}

// A solid triangle — crests, fins and leaves need mass, not a line.
function fillTriangle(g, ax, ay, bx, by, cx2, cy2, v) {
  const minX = Math.floor(Math.min(ax, bx, cx2));
  const maxX = Math.ceil(Math.max(ax, bx, cx2));
  const minY = Math.floor(Math.min(ay, by, cy2));
  const maxY = Math.ceil(Math.max(ay, by, cy2));
  const area = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const w1 = ((cx2 - bx) * (y - by) - (cy2 - by) * (x - bx)) / area;
      const w2 = ((ax - cx2) * (y - cy2) - (ay - cy2) * (x - cx2)) / area;
      if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) g.set(x, y, v);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Passes applied after the silhouette is laid down.
 * ------------------------------------------------------------------ */

// How deep each body pixel sits inside the silhouette (1 = on the edge,
// 9 = interior). Shading keys off this so highlight and shade stay as
// narrow rims rather than flooding half the creature.
function depthMap(g) {
  const { w, h } = g;
  const d = new Uint8Array(w * h);
  for (let pass = 1; pass <= 3; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (g.d[i] === PAL_TRANSPARENT || d[i]) continue;
        if (pass === 1) {
          if (
            g.get(x - 1, y) === PAL_TRANSPARENT || g.get(x + 1, y) === PAL_TRANSPARENT ||
            g.get(x, y - 1) === PAL_TRANSPARENT || g.get(x, y + 1) === PAL_TRANSPARENT
          ) d[i] = 1;
        } else {
          if (
            d[i - 1] === pass - 1 || d[i + 1] === pass - 1 ||
            (y > 0 && d[i - w] === pass - 1) || (y < h - 1 && d[i + w] === pass - 1)
          ) d[i] = pass;
        }
      }
    }
  }
  for (let i = 0; i < d.length; i++) if (g.d[i] !== PAL_TRANSPARENT && d[i] === 0) d[i] = 9;
  return d;
}

// Light comes from the upper-left. Depth 1 is about to become outline, so
// the visible shading band is depths 2-3: a two-pixel shade rim on the
// lower-right, a highlight rim on the upper-left, base colour in between.
function applyShading(g, cx, cy) {
  const d = depthMap(g);
  const src = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (src.get(x, y) !== PAL_BASE) continue;
      const depth = d[y * g.w + x];
      if (depth < 2 || depth > 3) continue;
      const diag = (x - cx) * 0.7 + (y - cy) * 1.0;
      if (diag > 1.5) g.set(x, y, PAL_SHADE);
      else if (diag < -2.5) g.set(x, y, PAL_HIGH);
    }
  }
}

// Bold black outline (§3): any body pixel touching empty space or the frame
// edge becomes the outline colour. Computed against a snapshot so the outline
// does not eat inward.
function applyOutline(g) {
  const src = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = src.get(x, y);
      if (v === PAL_TRANSPARENT || v === PAL_OUTLINE) continue;
      if (
        src.get(x - 1, y) === PAL_TRANSPARENT ||
        src.get(x + 1, y) === PAL_TRANSPARENT ||
        src.get(x, y - 1) === PAL_TRANSPARENT ||
        src.get(x, y + 1) === PAL_TRANSPARENT
      ) {
        g.set(x, y, PAL_OUTLINE);
      }
    }
  }
}

// Normalise the area around an eye back to base colour. Without this the
// pupil can land on the shade rim (dark on dark) and the face disappears.
function eyeSocket(g, ex, ey) {
  for (let j = ey - 1; j <= ey + 2; j++) {
    for (let i = ex - 1; i <= ex + 2; i++) {
      const v = g.get(i, j);
      if (v === PAL_SHADE || v === PAL_HIGH) g.set(i, j, PAL_BASE);
    }
  }
}

// Eyes go on last so the outline pass never swallows them.
function drawEyes(g, eyes, pose, opts = {}) {
  const glow = opts.glow ? PAL_HIGH : PAL_OUTLINE;
  for (const [ex, ey] of eyes) {
    eyeSocket(g, ex, ey);
    if (pose.blink) {
      // A single dark lid line, 1px, matching §8.3's blink derivation.
      fillRect(g, ex, ey + 1, 2, 1, PAL_OUTLINE);
    } else if (opts.sleepy) {
      fillRect(g, ex, ey + 1, 2, 1, PAL_OUTLINE);
      g.set(ex, ey, glow);
    } else {
      fillRect(g, ex, ey, 2, 2, glow);
      if (!opts.glow) g.set(ex + 1, ey, PAL_HIGH); // catchlight
    }
  }
}

/* ------------------------------------------------------------------ *
 * Body templates. Each paints a silhouette in PAL_BASE and returns the
 * eye positions + the shading centre. `pose` supplies animation state.
 * ------------------------------------------------------------------ */

const GROUND = 31;

function bodyQuadruped(g, rnd, pose, spec) {
  const big = spec.size === "large";
  const b = pose.bob;
  const legPhase = pose.legPhase;
  const bodyCY = (big ? 20 : 22) - b;
  const bodyRX = big ? 9 : 7;
  const bodyRY = big ? 6 : 5;
  const bodyCX = big ? 13 : 14;
  const headCX = big ? 23 : 22;
  const headCY = (big ? 13 : 16) - b;
  const headR = big ? 6 : 5;

  // Legs — two pairs, offset in opposite directions by walk phase.
  const legTop = bodyCY + bodyRY - 1;
  const legH = GROUND - legTop + 1;
  const front = legPhase ? 1 : -1;
  fillRect(g, bodyCX + 4 + front, legTop, 2, legH, PAL_BASE);
  fillRect(g, bodyCX + 1 + front, legTop, 2, legH, PAL_BASE);
  fillRect(g, bodyCX - 4 - front, legTop, 2, legH, PAL_BASE);
  fillRect(g, bodyCX - 7 - front, legTop, 2, legH, PAL_BASE);

  fillEllipse(g, bodyCX, bodyCY, bodyRX, bodyRY, PAL_BASE);
  fillCircle(g, headCX, headCY, headR, PAL_BASE);

  // Ears — length is a data-driven feature so a rabbit reads differently
  // from a fox without a second template.
  const earLen = has(spec, "thornEars") ? 8 : has(spec, "bigEars") ? 6 : 4;
  const earTop = headCY - headR - earLen;
  fillTriangle(g, headCX - 5, headCY - headR + 2, headCX - 1, headCY - headR + 2, headCX - 4, earTop, PAL_BASE);
  fillTriangle(g, headCX + 1, headCY - headR + 2, headCX + 5, headCY - headR + 2, headCX + 4, earTop, PAL_BASE);

  // Tail
  if (has(spec, "boltTail")) {
    stroke(g, bodyCX - bodyRX, bodyCY, bodyCX - bodyRX - 3, bodyCY - 4, PAL_BASE, 2);
    stroke(g, bodyCX - bodyRX - 3, bodyCY - 4, bodyCX - bodyRX, bodyCY - 7, PAL_BASE, 2);
  } else {
    fillEllipse(g, bodyCX - bodyRX - 1, bodyCY - 2, 3, 4, PAL_BASE);
  }

  return { eyes: [[headCX - 1, headCY - 1], [headCX + 3, headCY - 1]], cx: bodyCX + 3, cy: bodyCY };
}

function bodyBlob(g, rnd, pose, spec) {
  const b = pose.bob;
  const squash = pose.squash || 0;
  const cy = 21 - b + squash;
  const rx = 9 + squash;
  const ry = 9 - squash;
  fillEllipse(g, 16, cy, rx, ry, PAL_BASE);
  // Little feet nubs so it still reads as walking.
  const p = pose.legPhase ? 1 : -1;
  fillRect(g, 11 + p, GROUND - 2, 4, 3, PAL_BASE);
  fillRect(g, 17 - p, GROUND - 2, 4, 3, PAL_BASE);

  if (has(spec, "finCrest")) fillTriangle(g, 12, cy - ry + 2, 20, cy - ry + 2, 17, cy - ry - 6, PAL_BASE);
  if (has(spec, "bigEars")) {
    fillEllipse(g, 10, cy - ry - 1, 3, 4, PAL_BASE);
    fillEllipse(g, 22, cy - ry - 1, 3, 4, PAL_BASE);
  }
  if (has(spec, "frostCrown")) {
    stroke(g, 12, cy - ry + 1, 11, cy - ry - 4, PAL_HIGH, 2);
    stroke(g, 16, cy - ry, 16, cy - ry - 6, PAL_HIGH, 2);
    stroke(g, 20, cy - ry + 1, 21, cy - ry - 4, PAL_HIGH, 2);
  }

  const eyes = has(spec, "dropletEye")
    ? [[15, cy - 3]]
    : [[12, cy - 3], [19, cy - 3]];
  return { eyes, cx: 16, cy };
}

function bodySprite(g, rnd, pose, spec) {
  const b = pose.bob;
  const cy = 23 - b;
  fillEllipse(g, 16, cy, 7, 7, PAL_BASE);
  const p = pose.legPhase ? 1 : -1;
  fillRect(g, 13 + p, GROUND - 2, 3, 3, PAL_BASE);
  fillRect(g, 17 - p, GROUND - 2, 3, 3, PAL_BASE);
  // Leaf sprouting up, the whole point of this one.
  stroke(g, 16, cy - 6, 16, cy - 12, PAL_SHADE, 2);
  fillTriangle(g, 17, cy - 13, 24, cy - 15, 17, cy - 9, PAL_BASE);
  fillTriangle(g, 15, cy - 11, 8, cy - 13, 15, cy - 7, PAL_BASE);
  return { eyes: [[12, cy - 2], [19, cy - 2]], cx: 16, cy };
}

function bodyArmored(g, rnd, pose, spec) {
  const b = pose.bob;
  const big = spec.size === "large";
  const cy = (big ? 19 : 22) - b;
  const rx = big ? 11 : 9;
  const ry = big ? 10 : 8;
  // Chunky, faceted mass rather than a smooth ellipse.
  fillEllipse(g, 16, cy, rx, ry, PAL_BASE);
  fillRect(g, 16 - rx + 1, cy, rx * 2 - 2, ry, PAL_BASE);
  const p = pose.legPhase ? 1 : -1;
  fillRect(g, 11 + p, GROUND - 3, 4, 4, PAL_BASE);
  fillRect(g, 17 - p, GROUND - 3, 4, 4, PAL_BASE);
  if (has(spec, "stubbyArms")) {
    fillRect(g, 16 - rx - 2, cy - 1, 3, 4, PAL_BASE);
    fillRect(g, 16 + rx - 1, cy - 1, 3, 4, PAL_BASE);
  }
  if (has(spec, "shellPlates")) {
    for (let i = -1; i <= 1; i++) fillRect(g, 16 + i * 5 - 1, cy - ry + 2, 2, ry, PAL_SHADE);
  }
  return { eyes: [[12, cy - 3], [19, cy - 3]], cx: 16, cy };
}

function bodyFloating(g, rnd, pose, spec) {
  // Hovers: leaves a gap above GROUND, and the gap breathes with the bob.
  const cy = 17 - pose.bob;
  const r = spec.size === "large" ? 10 : 8;
  fillCircle(g, 16, cy, r, PAL_BASE);
  // Orbiting motes read as psychic energy.
  const a = pose.phase * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const t = a + (i * Math.PI * 2) / 3;
    fillRect(g, Math.round(16 + Math.cos(t) * (r + 3)), Math.round(cy + Math.sin(t) * (r + 3)), 2, 2, PAL_HIGH);
  }
  const eyes = has(spec, "singleEye") ? [[15, cy - 2]] : [[12, cy - 2], [19, cy - 2]];
  return { eyes, cx: 16, cy };
}

function bodyWisp(g, rnd, pose, spec) {
  const cy = 16 - pose.bob;
  const r = 8;
  fillCircle(g, 16, cy, r, PAL_BASE);
  fillRect(g, 16 - r, cy, r * 2, 6, PAL_BASE);
  // Ragged tail, waving with the animation phase.
  const wave = Math.sin(pose.phase * Math.PI * 2);
  for (let i = 0; i < 5; i++) {
    const x = 16 - r + i * 4;
    const h = 3 + Math.round(2 * Math.sin(pose.phase * Math.PI * 2 + i));
    fillRect(g, x, cy + 6, 3, h, PAL_BASE);
  }
  fillRect(g, 16 + Math.round(wave), cy + 6, 3, 5, PAL_BASE);
  return { eyes: [[12, cy - 2], [19, cy - 2]], cx: 16, cy };
}

function bodyWinged(g, rnd, pose, spec) {
  const cy = 19 - pose.bob;
  // Wings beat on the walk phase — for fliers this is the "walk" cycle.
  const flap = pose.legPhase ? 3 : 0;
  fillEllipse(g, 8, cy - 2 - flap, 6, 5 - flap * 0.5, PAL_BASE);
  fillEllipse(g, 24, cy - 2 - flap, 6, 5 - flap * 0.5, PAL_BASE);
  fillEllipse(g, 16, cy, 4, 7, PAL_BASE);
  fillCircle(g, 16, cy - 7, 3, PAL_BASE);
  // Antennae / crackling tips
  const tipCol = has(spec, "crackleTips") ? PAL_HIGH : PAL_SHADE;
  stroke(g, 14, cy - 10, 12, cy - 14, tipCol, 1);
  stroke(g, 18, cy - 10, 20, cy - 14, tipCol, 1);
  if (has(spec, "emberSpeckle")) {
    for (let i = 0; i < 6; i++) {
      g.set(4 + Math.floor(rnd() * 8), cy - 5 + Math.floor(rnd() * 8), PAL_HIGH);
      g.set(20 + Math.floor(rnd() * 8), cy - 5 + Math.floor(rnd() * 8), PAL_HIGH);
    }
  }
  return { eyes: [[14, cy - 8], [17, cy - 8]], cx: 16, cy };
}

function bodyDrake(g, rnd, pose, spec) {
  const b = pose.bob;
  const bodyCY = 20 - b;
  fillEllipse(g, 14, bodyCY, 9, 7, PAL_BASE);
  // Wings
  const flap = pose.legPhase ? 2 : 0;
  stroke(g, 12, bodyCY - 5, 4, bodyCY - 13 + flap, PAL_SHADE, 3);
  stroke(g, 15, bodyCY - 6, 10, bodyCY - 15 + flap, PAL_SHADE, 3);
  fillEllipse(g, 8, bodyCY - 10 + flap, 5, 4, PAL_SHADE);
  // Neck + head
  stroke(g, 20, bodyCY - 4, 24, bodyCY - 10, PAL_BASE, 4);
  fillEllipse(g, 25, bodyCY - 11, 5, 4, PAL_BASE);
  // Crown / horns
  if (has(spec, "crown")) {
    for (let i = 0; i < 3; i++) stroke(g, 23 + i * 2, bodyCY - 14, 23 + i * 2, bodyCY - 17, PAL_HIGH, 1);
  } else {
    stroke(g, 24, bodyCY - 14, 22, bodyCY - 18, PAL_HIGH, 2);
  }
  // Legs + tail
  const p = pose.legPhase ? 1 : -1;
  fillRect(g, 12 + p, GROUND - 4, 3, 5, PAL_BASE);
  fillRect(g, 17 - p, GROUND - 4, 3, 5, PAL_BASE);
  stroke(g, 5, bodyCY + 1, 1, bodyCY - 4, PAL_BASE, 3);
  if (has(spec, "voidEdge")) applyRim(g, PAL_HIGH);
  return { eyes: [[25, bodyCY - 12]], cx: 16, cy: bodyCY, glow: has(spec, "voidEdge") };
}

function bodySerpentine(g, rnd, pose, spec) {
  // An S-curve of overlapping discs, undulating with the phase.
  const segs = 9;
  const ph = pose.phase * Math.PI * 2;
  let hx = 16, hy = 10;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const x = 16 + Math.sin(ph + t * Math.PI * 2) * 8 * t;
    const y = GROUND - 3 - t * 18;
    const r = 5 - t * 1.5;
    fillEllipse(g, x, y, r, r, PAL_BASE);
    if (i === segs - 1) { hx = x; hy = y; }
  }
  fillEllipse(g, hx + 2, hy - 3, 5, 4, PAL_BASE);
  if (has(spec, "waveCrest")) {
    stroke(g, hx, hy - 7, hx - 4, hy - 11, PAL_HIGH, 2);
    stroke(g, hx + 2, hy - 7, hx + 2, hy - 12, PAL_HIGH, 2);
  }
  return { eyes: [[Math.round(hx + 3), Math.round(hy - 4)]], cx: 16, cy: 20 };
}

function bodyStag(g, rnd, pose, spec) {
  const r = bodyQuadruped(g, rnd, pose, { ...spec, size: "large" });
  // Antlers on top of the quadruped base.
  const hx = 23, hy = 13 - pose.bob;
  stroke(g, hx - 2, hy - 6, hx - 6, hy - 14, PAL_HIGH, 2);
  stroke(g, hx + 2, hy - 6, hx + 6, hy - 14, PAL_HIGH, 2);
  stroke(g, hx - 4, hy - 10, hx - 8, hy - 12, PAL_HIGH, 1);
  stroke(g, hx + 4, hy - 10, hx + 8, hy - 12, PAL_HIGH, 1);
  return { ...r, glow: true };
}

// A 1px highlight rim — used for Umbraking's violet edge.
function applyRim(g, colour) {
  const src = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (src.get(x, y) === PAL_TRANSPARENT) continue;
      if (src.get(x - 1, y) === PAL_TRANSPARENT || src.get(x, y + 1) === PAL_TRANSPARENT) {
        g.set(x, y, colour);
      }
    }
  }
}

const BODIES = {
  quadruped: bodyQuadruped,
  blob: bodyBlob,
  sprite: bodySprite,
  armored: bodyArmored,
  floating: bodyFloating,
  wisp: bodyWisp,
  winged: bodyWinged,
  drake: bodyDrake,
  serpentine: bodySerpentine,
  stag: bodyStag,
};

function has(spec, feature) {
  return Array.isArray(spec.features) && spec.features.includes(feature);
}

/* ------------------------------------------------------------------ *
 * Frame rendering
 * ------------------------------------------------------------------ */

function renderPose(spec, pose) {
  const rnd = mulberry32(spec.seed + (pose.rndSalt || 0));
  const g = new Grid();
  const build = BODIES[spec.body] || bodyBlob;
  const info = build(g, rnd, pose, spec);

  applyShading(g, info.cx, info.cy);
  if (has(spec, "voidEdge")) applyRim(g, PAL_HIGH);
  applyOutline(g);
  drawEyes(g, info.eyes, pose, {
    glow: info.glow || has(spec, "glowEyes"),
    sleepy: has(spec, "sleepyEyes"),
  });

  // Type flourishes that sit above the body.
  if (has(spec, "flameTuft") && !pose.blink) {
    const fx = 22, fy = 11 - pose.bob - (pose.flicker ? 1 : 0);
    fillEllipse(g, fx, fy, 2, 3, PAL_HIGH);
    g.set(fx, fy - 3, PAL_HIGH);
  }
  if (has(spec, "icicleWhiskers")) {
    const wy = 17 - pose.bob;
    stroke(g, 26, wy, 30, wy + 2, PAL_HIGH, 1);
    stroke(g, 26, wy + 1, 30, wy + 4, PAL_HIGH, 1);
  }
  if (pose.flash) {
    for (let i = 0; i < g.d.length; i++) if (g.d[i] === PAL_BASE || g.d[i] === PAL_SHADE) g.d[i] = PAL_HIGH;
  }

  return g;
}

function gridToImageData(g, palette, ctx) {
  const img = ctx.createImageData(g.w, g.h);
  const rgba = [
    [0, 0, 0, 0],
    hexToRgb(palette[0]),
    hexToRgb(palette[1]),
    hexToRgb(palette[2]),
    hexToRgb(palette[3]),
  ];
  for (let i = 0; i < g.d.length; i++) {
    const c = rgba[g.d[i]] || rgba[0];
    img.data[i * 4 + 0] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = g.d[i] === PAL_TRANSPARENT ? 0 : 255;
  }
  return img;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

// Poses per sheet kind. `move` frames are type-driven, mirroring the
// derivation table the Python pipeline uses in Stage 3.
const MOVE_POSES = {
  fire:     [{ flicker: 1 }, { flash: 1 }, { flicker: 1, bob: 1 }, {}],
  ice:      [{ squash: 1 }, { squash: 2 }, { squash: 0, bob: 1 }, {}],
  electric: [{ jitter: 1 }, { flash: 1, jitter: -1 }, { jitter: 1 }, {}],
  water:    [{ bob: 1 }, { squash: 1 }, { bob: 1 }, {}],
  grass:    [{ bob: 1 }, { bob: 2 }, { bob: 1 }, {}],
  rock:     [{ jitter: 1 }, { jitter: -1 }, { squash: 1 }, {}],
  psychic:  [{ bob: 1 }, { flash: 1 }, { bob: 1 }, {}],
  shadow:   [{ bob: 1 }, { fade: 0.4 }, { fade: 0.15 }, { bob: 1 }],
  dragon:   [{ bob: 1 }, { flash: 1, bob: 2 }, { bob: 2 }, { bob: 1 }],
  normal:   [{ jitter: 2 }, { squash: 1 }, { jitter: -2 }, {}],
};

const SHEET_POSES = {
  idle: [{ blink: false }, { blink: true }],
  walk: [{ legPhase: 0, bob: 0 }, { legPhase: 1, bob: 1 }],
};

function posesFor(kind, spec) {
  if (kind === "move") return MOVE_POSES[spec.type] || MOVE_POSES.normal;
  return SHEET_POSES[kind] || SHEET_POSES.idle;
}

function normalisePose(p, i) {
  return {
    blink: !!p.blink,
    bob: p.bob || 0,
    legPhase: p.legPhase || 0,
    squash: p.squash || 0,
    jitter: p.jitter || 0,
    flash: !!p.flash,
    flicker: !!p.flicker,
    fade: p.fade === undefined ? 1 : p.fade,
    phase: i / 4,
    rndSalt: 0, // keep speckle patterns stable across frames
  };
}

function generateSheet(spec, kind) {
  const poses = posesFor(kind, spec).map(normalisePose);
  const { c, ctx } = makeCanvas(FRAME * poses.length, FRAME);
  const tmp = makeCanvas(FRAME, FRAME);
  poses.forEach((pose, i) => {
    const g = renderPose(spec, pose);
    tmp.ctx.clearRect(0, 0, FRAME, FRAME);
    tmp.ctx.putImageData(gridToImageData(g, spec.palette, tmp.ctx), 0, 0);
    ctx.save();
    ctx.globalAlpha = pose.fade;
    ctx.drawImage(tmp.c, i * FRAME + pose.jitter, 0);
    ctx.restore();
  });
  return { canvas: c, frames: poses.length, fw: FRAME, fh: FRAME, procedural: true };
}

/* ------------------------------------------------------------------ *
 * Drop-in loader
 * ------------------------------------------------------------------ */

const cache = new Map();

function tryLoadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Returns { canvas, frames, fw, fh, procedural }.
 * Real art wins; the placeholder covers everything else.
 */
export async function loadSheet(spec, kind) {
  const key = `${spec.name}:${kind}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    const img = await tryLoadImage(`assets/sprites/${spec.name}/${kind}.png`);
    if (img && img.width >= FRAME && img.height >= FRAME) {
      const { c, ctx } = makeCanvas(img.width, img.height);
      ctx.drawImage(img, 0, 0);
      return {
        canvas: c,
        frames: Math.max(1, Math.floor(img.width / img.height)),
        fw: img.height,
        fh: img.height,
        procedural: false,
      };
    }
    return generateSheet(spec, kind);
  })();

  cache.set(key, promise);
  return promise;
}

/** All three sheets for a creature, keyed by kind. */
export async function loadCreature(spec) {
  const [idle, walk, move] = await Promise.all([
    loadSheet(spec, "idle"),
    loadSheet(spec, "walk"),
    loadSheet(spec, "move"),
  ]);
  return { idle, walk, move };
}

/** Flat black version of a sheet — the widget carousel's silhouette state. */
export function silhouette(sheet) {
  const { c, ctx } = makeCanvas(sheet.canvas.width, sheet.canvas.height);
  ctx.drawImage(sheet.canvas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0) {
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { ...sheet, canvas: c };
}

/**
 * Draw one frame with bottom-centre origin, at an integer scale.
 * `flip` mirrors horizontally for left-facing movement.
 */
export function drawFrame(ctx, sheet, frame, x, y, scale, flip = false) {
  const f = ((frame % sheet.frames) + sheet.frames) % sheet.frames;
  const w = sheet.fw * scale;
  const h = sheet.fh * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sheet.canvas, f * sheet.fw, 0, sheet.fw, sheet.fh, -w / 2, -h, w, h);
  ctx.restore();
}

export function clearCache() {
  cache.clear();
}
