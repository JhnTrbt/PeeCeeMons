// overlay.js — the roaming pet.
//
// Owns the render loop, the active creature, the particle system, and the
// move auto-timer. It reacts to config changes and hotkeys purely through
// events (§2) — it never re-reads the config file.

import { startLoop, fitCanvas } from "./engine/loop.js";
import { Particles } from "./engine/particles.js";
import { Creature } from "./engine/creature.js";
import { loadCreature } from "./engine/sprites.js";
import {
  getConfig, listen, loadRoster, setHitRect, inTauri, emit, setConfig,
} from "./engine/bridge.js";

// Wild encounters. Rather than picking a fight from a menu, one turns up on
// its own: grass rustles around the pet and an alert pops over its head.
// The average gap comes from config.encounterMinutes (default 40, so one or
// two an hour); 0 switches them off. It is randomised +/-40% so it never
// feels scheduled. You have ENCOUNTER_LIFE seconds to click before it goes.
const ENCOUNTER_LIFE = 25;
let encounter = null;          // { foe, t }
let encounterTimer = 0;

const canvas = document.getElementById("stage");
const particles = new Particles();

let roster = [];
let config = null;
let pet = null;
let cursor = null;
let cursorSeenAt = 0;

// Only tell Rust about the hit box when it has actually shifted; this runs at
// 60fps and each call is an IPC round trip.
let lastRect = { x: -1, y: -1, w: -1, h: -1 };

// Auto-timer state (§5): randomised ±30% so it never feels metronomic.
let moveTimer = 0;

function specFor(name) {
  return roster.find((c) => c.name === name) || roster[0];
}

function scheduleNextMove() {
  const base = Math.max(5, config?.moveTimerSeconds ?? 25);
  moveTimer = base * (0.7 + Math.random() * 0.6);
}

async function setActiveCreature(name) {
  const spec = specFor(name);
  if (!spec) return;
  if (pet && pet.spec.name === spec.name) return;

  const sheets = await loadCreature(spec);
  const groundY = canvas.clientHeight - 6;
  const keepX = pet ? pet.x : canvas.clientWidth * 0.25;
  const keepFacing = pet ? pet.facing : 1;

  pet = new Creature(spec, sheets, {
    x: keepX,
    groundY,
    scale: config?.spriteScale ?? 3,
  });
  pet.facing = keepFacing;
  particles.clear();
}

function update(dt) {
  if (!pet) return;

  // Track the floor every frame rather than once at startup: at init the
  // canvas may not have been laid out yet (clientHeight 0), which would
  // strand the pet above the top edge, and the strip can be resized by a
  // resolution or DPI change at any time.
  const ground = canvas.clientHeight - 6;
  if (ground > 0) pet.groundY = ground;

  // The cursor report is throttled to 10Hz; forget it if it goes quiet so the
  // pet does not keep staring at a stale position.
  if (cursor && performance.now() - cursorSeenAt > 1500) cursor = null;

  // A pet that has noticed something stands its ground until you deal with it.
  pet.update(dt, {
    width: canvas.clientWidth,
    roaming: !!config?.roaming && !encounter,
    reduced: !!config?.reducedMotion,
    cursor,
    particles,
  });
  particles.update(dt);
  updateEncounter(dt);

  // Moves fire on the timer whether or not the pet is roaming — a stationary
  // creature still shows off.
  moveTimer -= dt;
  if (moveTimer <= 0) {
    fireMove();
    scheduleNextMove();
  }

  publishHitRect();
}

/**
 * Play the move. The sound is emitted for the widget to make, not played
 * here: the overlay is click-through, so it never receives the user gesture
 * a browser requires before it will let a page produce audio.
 */
function fireMove() {
  if (!pet.triggerMove()) return;
  emit("move-fired", { creature: pet.spec.name, move: pet.move.name });
}

/* ------------------------- wild encounters ------------------------- */

function scheduleEncounter() {
  const minutes = config?.encounterMinutes ?? 40;
  if (!minutes) {
    encounterTimer = Infinity;   // switched off
    return;
  }
  encounterTimer = minutes * 60 * (0.6 + Math.random() * 0.8);
}

function updateEncounter(dt) {
  if (!config) return;
  if (!config.encounterMinutes && !encounter) return;

  if (encounter) {
    encounter.t += dt;
    // Rustle a few leaves out of the grass while it lasts.
    if (!config.reducedMotion && Math.random() < dt * 6) {
      const b = pet.bounds;
      particles.emit({
        x: b.x + Math.random() * b.w,
        y: pet.groundY - Math.random() * 10,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 25,
        gravity: 40,
        life: 0.5 + Math.random() * 0.4,
        size: 2,
        colour: Math.random() < 0.5 ? "#8CC63F" : "#5A9227",
        shape: "line",
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 8,
      });
    }
    if (encounter.t > ENCOUNTER_LIFE) {
      encounter = null;              // it got away
      scheduleEncounter();
    }
    return;
  }

  encounterTimer -= dt;
  if (encounterTimer > 0) return;

  // Evolved forms are earned by battling with their base creature, never
  // found in the grass, so they are not encounter candidates.
  const locked = roster.filter(
    (c) => c.tier !== "evolved" && !config.unlocked.includes(c.name)
  );
  if (!locked.length) {
    scheduleEncounter();             // nothing left to find
    return;
  }
  encounter = { foe: locked[Math.floor(Math.random() * locked.length)], t: 0 };
  pet.wake();
  emit("encounter-started", { name: encounter.foe.name });
}

/** Grass shaking at the pet's feet plus an alert bubble over its head. */
function drawEncounter(ctx) {
  if (!encounter || !pet) return;
  const b = pet.bounds;
  const midX = pet.x;
  const groundY = pet.groundY;
  const t = encounter.t;
  const fading = t > ENCOUNTER_LIFE - 2 ? (Math.floor(t * 4) % 2 ? 0.35 : 1) : 1;

  ctx.save();
  ctx.globalAlpha = fading;

  // Tufts of grass, each swaying on its own phase.
  for (let i = -4; i <= 4; i++) {
    const gx = midX + i * 11 + (i % 2 ? 3 : 0);
    const h = 12 + ((i * 7) % 9);
    const sway = Math.sin(t * 9 + i) * 3;
    ctx.strokeStyle = i % 2 ? "#5A9227" : "#8CC63F";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx, groundY);
    ctx.quadraticCurveTo(gx + sway, groundY - h * 0.6, gx + sway * 2, groundY - h);
    ctx.stroke();
  }

  // Alert bubble: bounces in, then hovers.
  const pop = Math.min(1, t * 5);
  const bob = Math.sin(t * 6) * 3;
  const bx = midX;
  const by = b.y - 26 + bob - (1 - pop) * 14;
  const r = 15 * pop;
  ctx.fillStyle = "#F8F4D8";
  ctx.strokeStyle = "#2A2418";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx - 5, by + r - 2);
  ctx.lineTo(bx + 1, by + r + 8);
  ctx.lineTo(bx + 6, by + r - 3);
  ctx.closePath();
  ctx.fillStyle = "#F8F4D8";
  ctx.fill();

  if (pop > 0.6) {
    ctx.fillStyle = "#C0392B";
    ctx.fillRect(bx - 2, by - 8, 4, 10);
    ctx.fillRect(bx - 2, by + 4, 4, 4);
  }

  ctx.restore();
}

function publishHitRect() {
  const b = pet.bounds;
  if (
    Math.abs(b.x - lastRect.x) > 2 ||
    Math.abs(b.y - lastRect.y) > 2 ||
    Math.abs(b.w - lastRect.w) > 1 ||
    Math.abs(b.h - lastRect.h) > 1
  ) {
    lastRect = { x: b.x, y: b.y, w: b.w, h: b.h };
    setHitRect(b.x, b.y, b.w, b.h);
  }
}

function render() {
  const ctx = fitCanvas(canvas);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!pet) return;

  const shake = config?.reducedMotion ? 0 : pet.shake;
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  particles.draw(ctx);
  pet.draw(ctx);
  drawEncounter(ctx);
  ctx.restore();
}

/* ------------------------------------------------------------------ */

async function main() {
  try {
    roster = await loadRoster();
    config = await getConfig();
    await setActiveCreature(config.activeCreature);
  } catch (e) {
    // A transparent window that fails silently looks identical to one that
    // never started, so make it say so on screen.
    console.error("[peeceemons] overlay failed to start", e);
    if (window.__peeceemonsReport) {
      window.__peeceemonsReport("STARTUP", e && e.message ? e.message : e, e && e.stack);
    }
    return;
  }
  scheduleNextMove();
  scheduleEncounter();

  // Clicking the pet makes it hop. This only ever fires when the cursor
  // watcher in overlay.rs has decided the pointer is over the sprite.
  // Clicking the pet normally makes it hop — but if something is rustling in
  // the grass, that same click is what starts the battle.
  canvas.addEventListener("mousedown", (e) => {
    if (!pet || !pet.contains(e.clientX, e.clientY)) return;
    pet.wake();
    if (encounter) {
      emit("battle-requested", { foe: encounter.foe.name });
      encounter = null;
      scheduleEncounter();
    }
    pet.hop();
  });

  await listen("config-changed", async (event) => {
    const next = event.payload;
    if (!next) return;
    const creatureChanged = next.activeCreature !== config.activeCreature;
    const scaleChanged = next.spriteScale !== config.spriteScale;
    const encounterChanged = next.encounterMinutes !== config.encounterMinutes;
    config = next;
    if (encounterChanged && !encounter) scheduleEncounter();
    if (creatureChanged || scaleChanged) {
      if (scaleChanged && pet) pet.scale = next.spriteScale;
      if (creatureChanged) await setActiveCreature(next.activeCreature);
    }
    scheduleNextMove();
  });

  await listen("trigger-move", () => {
    if (pet) {
      pet.wake();
      fireMove();
      scheduleNextMove();
    }
  });

  await listen("cursor-pos", (event) => {
    const [x, y] = event.payload || [];
    if (typeof x === "number") {
      cursor = { x, y };
      cursorSeenAt = performance.now();
    }
  });

  // Re-place the pet if the strip is resized (resolution or DPI change).
  window.addEventListener("resize", () => {
    if (pet) pet.groundY = canvas.clientHeight - 6;
  });

  startLoop(update, render);

  if (!inTauri) console.info("[peeceemons] overlay running outside Tauri");
}

main();
