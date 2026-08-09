// widget.js — the Game Boy clamshell control (§4).
//
// Drawn entirely on one canvas rather than as DOM elements. That keeps the
// pixel aesthetic exact (bitmap font, no antialiasing anywhere), and makes
// the physical controls simple rectangles to hit-test, so a click and the
// matching key press can run through the identical handler.
//
// Screens: BOOT -> SELECT -> ACTIVE, plus a SETTINGS panel behind the gear.

import { startLoop, fitCanvas } from "./engine/loop.js";
import { loadCreature, silhouette, drawFrame } from "./engine/sprites.js";
import { moveFor } from "./engine/moves/index.js";
import { Particles } from "./engine/particles.js";
import { drawText, drawTextShadow, measureText } from "./engine/bitmapfont.js";
import {
  Battle, loadTypeChart, effectiveness, matchups, winsNeeded, evolveAt,
} from "./engine/battle.js";
import { sfx, setSoundEnabled } from "./engine/audio.js";
import {
  getConfig, setConfig, resetConfig, listen, loadRoster, invoke, currentWindow, inTauri,
} from "./engine/bridge.js";

/* ----------------------------- palette ----------------------------- */

const C = {
  shell: "#8BA87A",
  shellLit: "#A6C293",
  shellDark: "#5E7650",
  shellEdge: "#3C4D33",
  ink: "#1B2414",
  bezel: "#4A5C3E",
  bezelLit: "#6B8059",
  lcd: "#C6E08A",
  lcdDim: "#A8C471",
  lcdInk: "#39492B",
  lcdInkSoft: "#6C8154",
  btn: "#B4443C",
  btnDark: "#7C2A24",
  grey: "#6E7A62",
  greyDark: "#48513F",
};

/* ----------------------------- layout ------------------------------ */

const W = 420;
const H = 600;
const HINGE = 296;

const LCD = { x: 56, y: 62, w: 308, h: 190 };
const BEZEL = { x: 36, y: 42, w: 348, h: 230 };
const GEAR = { x: 356, y: 22, w: 22, h: 22 };

const DPAD = { cx: 96, cy: 404, arm: 34, t: 26 };
const BTN_A = { cx: 336, cy: 384, r: 25 };
const BTN_B = { cx: 274, cy: 414, r: 25 };
const START = { x: 148, y: 508, w: 62, h: 16 };
const SELECT = { x: 226, y: 508, w: 62, h: 16 };

// Click targets, resolved to the same actions as the keyboard.
const HITS = [
  { id: "left", x: DPAD.cx - DPAD.arm - 13, y: DPAD.cy - 13, w: DPAD.arm, h: DPAD.t },
  { id: "right", x: DPAD.cx + 13, y: DPAD.cy - 13, w: DPAD.arm, h: DPAD.t },
  { id: "up", x: DPAD.cx - 13, y: DPAD.cy - DPAD.arm - 13, w: DPAD.t, h: DPAD.arm },
  { id: "down", x: DPAD.cx - 13, y: DPAD.cy + 13, w: DPAD.t, h: DPAD.arm },
  { id: "a", x: BTN_A.cx - BTN_A.r, y: BTN_A.cy - BTN_A.r, w: BTN_A.r * 2, h: BTN_A.r * 2 },
  { id: "b", x: BTN_B.cx - BTN_B.r, y: BTN_B.cy - BTN_B.r, w: BTN_B.r * 2, h: BTN_B.r * 2 },
  { id: "start", x: START.x, y: START.y, w: START.w, h: START.h },
  { id: "select", x: SELECT.x, y: SELECT.y, w: SELECT.w, h: SELECT.h },
  { id: "gear", x: GEAR.x - 6, y: GEAR.y - 6, w: GEAR.w + 12, h: GEAR.h + 12 },
];

const TIERS = ["all", "starter", "evolved", "wild", "legendary"];
const TIER_LABEL = {
  all: "ALL", starter: "STARTER", evolved: "EVOLVED",
  wild: "WILD", legendary: "LEGENDARY",
};

// Device size options, as a percentage of the 420x600 design size.
const SCALE_STEPS = [50, 75, 100, 125, 150, 175, 200];

/* ----------------------------- state ------------------------------- */

const canvas = document.getElementById("device");

let roster = [];
let config = null;
let sheets = new Map();      // name -> {idle,walk,move}
let sils = new Map();        // name -> silhouette of idle

let screen = "BOOT";
let bootT = 0;
let openT = 0;               // 0 = shut, 1 = fully open
let wantOpen = true;
let flash = null;            // transient toast on the LCD
let flashT = 0;
let anim = 0;                // free-running animation clock
let pressed = new Map();     // control id -> seconds left of "pushed in" look

let cursorIdx = 0;           // index into the filtered list
let tierIdx = 0;
let settingsIdx = 0;
let hotkeyWarning = null;

let battle = null;           // active Battle, or null
let battleTimer = 0;         // delay before the opponent replies
let battleAwarded = false;   // progress banked exactly once per win

// Damage feedback. `shown` HP lags the real value so the bar visibly drains,
// `ghost` lags further behind to leave the classic "chunk you just lost"
// trail, and `hit` drives the flash, knockback and floating number.
const bfx = {
  shownPlayer: 0, shownFoe: 0,
  ghostPlayer: 0, ghostFoe: 0,
  hit: null,      // { who, dmg, mult, t }
  shake: 0,
};

// Where each fighter stands on the LCD. Shared by the drawing code and the
// attack effects so particles land on the right sprite.
const FOE_AT = { x: 240, y: 74 };
const ME_AT = { x: 68, y: 132 };

const battleParticles = new Particles(120);
let atkFx = null;    // { move, t, side, applied, tx, ty, palette, facing }
let faintFx = null;  // { who, t }
let evolveFx = null; // { from, to, t } — the evolution sequence
const scratchFx = { alpha: 1, offsetX: 0, offsetY: 0, squashX: 1, squashY: 1, flash: 0, shake: 0 };

/**
 * Start an attack. The visual is the attacker's own signature move (§6) —
 * a Fire creature really does throw an Ember Burst — played at the
 * defender's position. Damage lands partway through, on impact, rather than
 * the instant the button goes down.
 */
function startAttack(side) {
  const attacker = side === "player" ? battle.player : battle.foe;
  const target = side === "player" ? FOE_AT : ME_AT;
  atkFx = {
    move: moveFor(attacker.type),
    t: 0,
    side,
    applied: false,
    tx: LCD.x + target.x,
    ty: LCD.y + target.y,
    palette: attacker.palette,
    facing: side === "player" ? 1 : -1,
  };
}

function startFaint(who) {
  faintFx = { who, t: 0 };
}

function resetBattleFx() {
  if (!battle) return;
  bfx.shownPlayer = bfx.ghostPlayer = battle.playerHp;
  bfx.shownFoe = bfx.ghostFoe = battle.foeHp;
  bfx.hit = null;
  bfx.shake = 0;
}

function registerHit(who) {
  bfx.hit = {
    who,
    dmg: battle.lastDamage,
    mult: battle.lastMultiplier,
    missed: battle.lastMissed,
    t: 0,
  };
  // Only a super-effective blow is worth shaking the screen for.
  if (!config.reducedMotion && !battle.lastMissed && battle.lastMultiplier > 1) bfx.shake = 5;
}

/** Run the in-flight attack animation and apply its damage on impact. */
function updateAttack(dt) {
  if (!atkFx) return;
  atkFx.t += dt;
  const k = Math.min(1, atkFx.t / atkFx.move.duration);

  // Reset the throwaway transform each frame, exactly as the overlay does.
  scratchFx.alpha = 1; scratchFx.offsetX = 0; scratchFx.offsetY = 0;
  scratchFx.squashX = 1; scratchFx.squashY = 1; scratchFx.flash = 0; scratchFx.shake = 0;

  atkFx.move.run(k, {
    x: atkFx.tx, y: atkFx.ty + 16,
    cx: atkFx.tx, cy: atkFx.ty,
    w: 52, h: 52,
    facing: atkFx.facing,
    palette: atkFx.palette,
    reduced: !!config.reducedMotion,
    rnd: Math.random,
    fx: scratchFx,
    emit: (o) => battleParticles.emit(o),
    burst: (n, fn) => battleParticles.burst(n, fn),
  });
  if (scratchFx.shake > bfx.shake) bfx.shake = scratchFx.shake;

  if (!atkFx.applied && k >= 0.45) {
    atkFx.applied = true;
    if (atkFx.side === "player") {
      battle.playerAttack();
      registerHit("foe");
    } else {
      battle.foeAttack();
      registerHit("player");
    }
    sfx.attack();
    if (battle.state === "WON") startFaint("foe");
    else if (battle.state === "LOST") startFaint("player");
  }

  if (k >= 1) {
    const side = atkFx.side;
    atkFx = null;
    // Hand the turn over once the animation has finished playing out.
    if (!battle.over && side === "player" && battle.state === "FOE") battleTimer = 0.45;
  }
}

function updateBattleFx(dt) {
  if (!battle) return;
  battleParticles.update(dt);
  updateAttack(dt);
  if (faintFx) faintFx.t += dt;
  // Bars chase the true value; ghost trails behind it.
  const chase = (cur, target, rate) => cur + (target - cur) * Math.min(1, dt * rate);
  bfx.shownPlayer = chase(bfx.shownPlayer, battle.playerHp, 8);
  bfx.shownFoe = chase(bfx.shownFoe, battle.foeHp, 8);
  bfx.ghostPlayer = chase(bfx.ghostPlayer, bfx.shownPlayer, 2.2);
  bfx.ghostFoe = chase(bfx.ghostFoe, bfx.shownFoe, 2.2);

  if (bfx.hit) {
    bfx.hit.t += dt;
    if (bfx.hit.t > 1.1) bfx.hit = null;
  }
  if (bfx.shake > 0) bfx.shake = Math.max(0, bfx.shake - dt * 14);
}

const HOTKEY_CHOICES = ["Ctrl+Alt+M", "Ctrl+Shift+M", "Alt+M", "Ctrl+Alt+Space"];

/* ----------------------------- helpers ----------------------------- */

const isUnlocked = (name) => !config || config.unlocked.includes(name);

function filtered() {
  const tier = TIERS[tierIdx];
  return tier === "all" ? roster : roster.filter((c) => c.tier === tier);
}

function currentSpec() {
  const list = filtered();
  if (!list.length) return roster[0];
  return list[((cursorIdx % list.length) + list.length) % list.length];
}

function toast(msg) {
  flash = msg;
  flashT = 1.6;
}

function press(id) {
  pressed.set(id, 0.12);
}

async function ensureSheets(spec) {
  if (sheets.has(spec.name)) return sheets.get(spec.name);
  const s = await loadCreature(spec);
  sheets.set(spec.name, s);
  sils.set(spec.name, silhouette(s.idle));
  return s;
}

/* ----------------------------- actions ----------------------------- */

async function action(id) {
  press(id);

  if (screen === "BOOT") {
    // Any button skips the intro.
    bootT = 99;
    return;
  }

  if (screen === "EVOLVE") {
    // Not skippable until the reveal has landed — it is the payoff.
    if (evolveFx && evolveFx.t > 5.0 && (id === "a" || id === "b")) {
      evolveFx = null;
      battle = null;
      screen = "ACTIVE";
      sfx.confirm();
    }
    return;
  }
  if (screen === "SETTINGS") return settingsAction(id);
  if (screen === "BATTLE") return battleAction(id);
  if (screen === "INFO_TYPES" || screen === "INFO_KEYS") {
    // Reference pages: anything backs out to the options list.
    if (id === "b" || id === "a" || id === "gear") {
      screen = "SETTINGS";
      sfx.back();
    }
    return;
  }

  switch (id) {
    case "left":
    case "right": {
      const list = filtered();
      cursorIdx = (cursorIdx + (id === "right" ? 1 : -1) + list.length) % list.length;
      sfx.select();
      ensureSheets(currentSpec());
      if (screen !== "SELECT") screen = "SELECT";
      break;
    }
    case "up":
    case "down": {
      tierIdx = (tierIdx + (id === "down" ? 1 : -1) + TIERS.length) % TIERS.length;
      cursorIdx = 0;
      sfx.select();
      ensureSheets(currentSpec());
      screen = "SELECT";
      toast(TIER_LABEL[TIERS[tierIdx]]);
      break;
    }
    case "a": {
      if (screen === "ACTIVE") {
        // Nothing to choose on this screen, so A spars instead.
        await startPractice();
        break;
      }
      const spec = currentSpec();
      if (!isUnlocked(spec.name)) {
        // Battles are not started from a menu — one has to find you.
        sfx.deny();
        toast("FIND IT IN THE WILD");
        break;
      }
      sfx.confirm();
      config = await setConfig({ activeCreature: spec.name });
      screen = "ACTIVE";
      toast(spec.name.toUpperCase() + " IS OUT");
      break;
    }
    case "b":
      sfx.back();
      screen = screen === "ACTIVE" ? "SELECT" : "ACTIVE";
      break;
    case "start":
      config = await setConfig({ roaming: !config.roaming });
      sfx.confirm();
      toast(config.roaming ? "ROAMING ON" : "ROAMING OFF");
      break;
    case "select":
      // On the carousel, SELECT spars with whoever is highlighted — locked
      // ones included, since practice is how you learn a matchup before you
      // meet it for real. Everywhere else it fires the pet's move.
      if (screen === "SELECT") {
        const target = currentSpec();
        if (target.name === config.activeCreature) {
          sfx.deny();
          toast("PICK SOMEONE ELSE");
        } else {
          await startPractice(target);
        }
        break;
      }
      sfx.attack();
      await invoke("trigger_move_now");
      toast(moveFor(currentActiveSpec().type).name.toUpperCase());
      break;
    case "gear":
      sfx.open();
      screen = "SETTINGS";
      settingsIdx = 0;
      break;
  }
}

function currentActiveSpec() {
  return roster.find((c) => c.name === config.activeCreature) || roster[0];
}

/* ----------------------------- battles ----------------------------- */

function winsAgainst(name) {
  return (config && config.progress && config.progress[name]) || 0;
}

/**
 * A no-stakes sparring match against a random other creature. Nothing is
 * won or lost, so you can try out matchups and learn the type chart without
 * waiting for something to turn up in the grass.
 */
async function startPractice(foeSpec = null) {
  const others = roster.filter((c) => c.name !== config.activeCreature);
  if (!others.length) return;
  const foe = foeSpec && foeSpec.name !== config.activeCreature
    ? foeSpec
    : others[Math.floor(Math.random() * others.length)];
  await startBattle(foe, { practice: true });
  toast("PRACTICE - NOTHING AT STAKE");
}

async function startBattle(foeSpec, { practice = false } = {}) {
  await ensureSheets(foeSpec);
  const mine = currentActiveSpec();
  await ensureSheets(mine);
  battle = new Battle(mine, foeSpec);
  battle.practice = practice;
  battleAwarded = false;
  battleTimer = 0;
  atkFx = null;
  faintFx = null;
  battleParticles.clear();
  resetBattleFx();
  screen = "BATTLE";
  wantOpen = true;
  sfx.open();
}

/** Bank a win: one step towards owning that creature, or the catch itself. */
/**
 * Count a win towards the creature that earned it, and evolve it if that
 * takes it over the line. Only creatures with an `evolvesInto` can evolve,
 * which today means the nine starters.
 */
async function creditWinner(extraPatch = {}) {
  const mine = currentActiveSpec();
  const wins = (config.winsWith?.[mine.name] || 0) + 1;
  const patch = {
    ...extraPatch,
    winsWith: { ...(config.winsWith || {}), [mine.name]: wins },
    battlesWon: (config.battlesWon || 0) + 1,
  };

  const evoName = mine.evolvesInto;
  const ready = evoName && wins >= evolveAt() && !config.unlocked.includes(evoName);
  if (ready) {
    patch.unlocked = [...(patch.unlocked || config.unlocked), evoName];
    patch.activeCreature = evoName;
  }

  config = await setConfig(patch);

  if (ready) {
    const evo = roster.find((c) => c.name === evoName);
    await ensureSheets(evo);
    evolveFx = { from: mine, to: evo, t: 0 };
    screen = "EVOLVE";
    sfx.boot();
  }
  return ready;
}

async function awardWin() {
  battleAwarded = true;

  if (battle.practice) {
    // Sparring cannot catch anything — but it does train the creature doing
    // the sparring, so it still counts towards evolving. Without this,
    // evolution would need ten wild encounters at one or two an hour, which
    // is most of a day per starter.
    const evolved = await creditWinner();
    if (!evolved) battle.log = "GOOD PRACTICE!";
    return;
  }

  const foe = battle.foe.name;
  const wins = winsAgainst(foe) + 1;
  const target = winsNeeded(battle.foe);

  // Catching the opponent and evolving your own creature are separate
  // rewards from the same win, so both go through one config write.
  let caught = false;
  let patch;
  if (wins >= target) {
    const progress = { ...(config.progress || {}) };
    delete progress[foe];
    patch = { unlocked: [...config.unlocked, foe], progress };
    caught = true;
  } else {
    patch = { progress: { ...(config.progress || {}), [foe]: wins } };
  }

  const evolved = await creditWinner(patch);

  if (evolved) return;            // the evolution screen has taken over
  if (caught) {
    sfx.confirm();
    battle.log = `${foe.toUpperCase()} JOINED YOU!`;
  } else {
    battle.log = `${wins}/${target} BATTLES WON`;
  }
}

async function battleAction(id) {
  if (!battle) { screen = "SELECT"; return; }

  if (battle.over) {
    // Let the faint animation finish before the card can be dismissed.
    if (faintFx && faintFx.t < 1.1) return;
    if (id === "a" || id === "b" || id === "start") {
      battle = null;
      screen = "SELECT";
      sfx.back();
    }
    return;
  }

  if (id === "b") {
    battle.flee();
    sfx.back();
    return;
  }
  if (id === "a" && battle.state === "READY" && !atkFx) {
    startAttack("player");
  }
}

/* ----------------------------- settings ---------------------------- */

function settingsRows() {
  return [
    { label: "MOVE TIMER", value: `${config.moveTimerSeconds}S`,
      step: (d) => ({ moveTimerSeconds: Math.min(300, Math.max(5, config.moveTimerSeconds + d * 5)) }) },
    { label: "MOVE HOTKEY", value: config.moveHotkey.toUpperCase().replace("CTRL", "CTL"),
      step: (d) => {
        const i = Math.max(0, HOTKEY_CHOICES.indexOf(config.moveHotkey));
        return { moveHotkey: HOTKEY_CHOICES[(i + d + HOTKEY_CHOICES.length) % HOTKEY_CHOICES.length] };
      } },
    { label: "SOUND", value: config.soundOn ? "ON" : "OFF",
      step: () => ({ soundOn: !config.soundOn }) },
    { label: "REDUCED MOTION", value: config.reducedMotion ? "ON" : "OFF",
      step: () => ({ reducedMotion: !config.reducedMotion }) },
    { label: "START WITH PC", value: config.launchOnStartup ? "ON" : "OFF",
      step: () => ({ launchOnStartup: !config.launchOnStartup }) },
    { label: "PET SIZE", value: `${config.spriteScale}X`,
      step: (d) => ({ spriteScale: Math.min(6, Math.max(1, config.spriteScale + d)) }) },
    { label: "DEVICE SIZE", value: `${config.widgetScale || 100}%`,
      step: (d) => {
        const i = Math.max(0, SCALE_STEPS.indexOf(config.widgetScale || 100));
        return { widgetScale: SCALE_STEPS[Math.min(SCALE_STEPS.length - 1, Math.max(0, i + d))] };
      } },
    { label: "WILD ENCOUNTERS",
      value: config.encounterMinutes ? `EVERY ~${config.encounterMinutes}M` : "OFF",
      step: (d) => {
        // 0 = off, then 10..120 in ten-minute steps.
        const steps = [0, 10, 15, 20, 30, 40, 60, 90, 120];
        const i = Math.max(0, steps.indexOf(config.encounterMinutes));
        return { encounterMinutes: steps[Math.min(steps.length - 1, Math.max(0, i + d))] };
      } },
    { label: "PRACTICE BATTLE", value: "PRESS A", practice: true },
    { label: "TYPE CHART", value: "PRESS A", info: "INFO_TYPES" },
    { label: "HOTKEY LIST", value: "PRESS A", info: "INFO_KEYS" },
    { label: "RESET ALL", value: "PRESS A", reset: true },
  ];
}

/**
 * Resize the window to match the chosen device size. The canvas already fits
 * the 420x600 design space to whatever the window is, so nothing in the
 * drawing code has to know this happened.
 */
async function applyWidgetScale() {
  const win = currentWindow();
  if (!win) return;
  const k = (config.widgetScale || 100) / 100;
  try {
    const { LogicalSize } = window.__TAURI__.window;
    await win.setSize(new LogicalSize(Math.round(W * k), Math.round(H * k)));
  } catch (e) {
    console.error("[peeceemons] could not resize the widget", e);
  }
}

async function settingsAction(id) {
  const rows = settingsRows();
  if (id === "up" || id === "down") {
    settingsIdx = (settingsIdx + (id === "down" ? 1 : -1) + rows.length) % rows.length;
    sfx.select();
    return;
  }
  if (id === "b" || id === "gear") {
    sfx.back();
    screen = "ACTIVE";
    return;
  }
  const row = rows[settingsIdx];
  if (row.practice) {
    if (id === "a") await startPractice();
    return;
  }
  if (row.info) {
    if (id === "a") {
      screen = row.info;
      sfx.open();
    }
    return;
  }
  if (row.reset) {
    if (id === "a") {
      config = await resetConfig();
      setSoundEnabled(config.soundOn);
      sfx.confirm();
      toast("RESET DONE");
    }
    return;
  }
  if (id === "left" || id === "right") {
    const patch = row.step(id === "right" ? 1 : -1);
    config = await setConfig(patch);
    setSoundEnabled(config.soundOn);
    if ("widgetScale" in patch) await applyWidgetScale();
    if ("launchOnStartup" in patch) {
      try {
        await invoke("set_autostart", { enabled: config.launchOnStartup });
      } catch (e) {
        toast("STARTUP FAILED");
      }
    }
    sfx.select();
  }
}

/* ----------------------------- drawing ----------------------------- */

function roundRect(ctx, x, y, w, h, r, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function drawBase(ctx) {
  roundRect(ctx, 8, HINGE - 30, W - 16, H - HINGE + 22, 16, C.shell, C.shellEdge, 3);

  // d-pad
  ctx.fillStyle = C.greyDark;
  ctx.fillRect(DPAD.cx - DPAD.arm - 14, DPAD.cy - 14, (DPAD.arm + 14) * 2, 28);
  ctx.fillRect(DPAD.cx - 14, DPAD.cy - DPAD.arm - 14, 28, (DPAD.arm + 14) * 2);
  ctx.fillStyle = C.grey;
  const pd = (id) => (pressed.has(id) ? 2 : 0);
  ctx.fillRect(DPAD.cx - DPAD.arm - 12 + pd("left"), DPAD.cy - 12, DPAD.arm + 10, 24);
  ctx.fillRect(DPAD.cx + 2 + pd("right"), DPAD.cy - 12, DPAD.arm + 10, 24);
  ctx.fillRect(DPAD.cx - 12, DPAD.cy - DPAD.arm - 12 + pd("up"), 24, DPAD.arm + 10);
  ctx.fillRect(DPAD.cx - 12, DPAD.cy + 2 + pd("down"), 24, DPAD.arm + 10);
  ctx.fillStyle = C.greyDark;
  ctx.fillRect(DPAD.cx - 5, DPAD.cy - 5, 10, 10);

  // A / B
  for (const [b, label, id] of [[BTN_A, "A", "a"], [BTN_B, "B", "b"]]) {
    const off = pressed.has(id) ? 2 : 0;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy + 3, b.r, 0, Math.PI * 2);
    ctx.fillStyle = C.btnDark;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.cx, b.cy + off, b.r, 0, Math.PI * 2);
    ctx.fillStyle = C.btn;
    ctx.fill();
    drawText(ctx, label, b.cx, b.cy + b.r + 10, 2, C.shellEdge, "center");
  }

  // START / SELECT
  for (const [r, label, id] of [[START, "START", "start"], [SELECT, "SELECT", "select"]]) {
    const off = pressed.has(id) ? 1 : 0;
    roundRect(ctx, r.x, r.y + 3, r.w, r.h, 8, C.greyDark);
    roundRect(ctx, r.x, r.y + off, r.w, r.h, 8, C.grey);
    drawText(ctx, label, r.x + r.w / 2, r.y + r.h + 8, 1, C.shellEdge, "center");
  }

  // speaker grille
  ctx.fillStyle = C.shellDark;
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(300 + i * 12, 500 + i * 4, 8, 44 - i * 4);
  }

  drawText(ctx, "PEECEEMONS", 30, H - 40, 2, C.shellDark);
}

// Drawn after the lid so the barrel sits in front of both halves, the way a
// real clamshell hinge does.
function drawHinge(ctx) {
  ctx.fillStyle = C.shellDark;
  ctx.fillRect(16, HINGE - 22, W - 32, 16);
  ctx.fillStyle = C.shellEdge;
  ctx.fillRect(16, HINGE - 22, W - 32, 2);
  for (let x = 24; x < W - 24; x += 20) ctx.fillRect(x, HINGE - 20, 10, 12);
  ctx.fillStyle = C.shellLit;
  ctx.fillRect(16, HINGE - 8, W - 32, 2);
}

function drawLid(ctx) {
  // The lid is drawn above the hinge, then flipped about it for the animation.
  roundRect(ctx, 8, 10, W - 16, HINGE - 20, 16, C.shell, C.shellEdge, 3);
  roundRect(ctx, BEZEL.x, BEZEL.y, BEZEL.w, BEZEL.h, 10, C.bezel, C.shellEdge, 2);
  ctx.fillStyle = C.bezelLit;
  ctx.fillRect(BEZEL.x + 6, BEZEL.y + 6, BEZEL.w - 12, 3);

  drawText(ctx, "PEECEEMONS", BEZEL.x + 4, 26, 1, C.shellDark);
  drawGear(ctx);

  ctx.save();
  ctx.beginPath();
  ctx.rect(LCD.x, LCD.y, LCD.w, LCD.h);
  ctx.clip();
  ctx.fillStyle = C.lcd;
  ctx.fillRect(LCD.x, LCD.y, LCD.w, LCD.h);

  if (screen === "BOOT") drawBoot(ctx);
  else if (screen === "SELECT") drawSelect(ctx);
  else if (screen === "SETTINGS") drawSettings(ctx);
  else if (screen === "BATTLE") drawBattle(ctx);
  else if (screen === "INFO_TYPES") drawInfoTypes(ctx);
  else if (screen === "INFO_KEYS") drawInfoKeys(ctx);
  else if (screen === "EVOLVE") drawEvolve(ctx);
  else drawActive(ctx);

  drawScanlines(ctx);
  drawToast(ctx);
  ctx.restore();
}

function drawGear(ctx) {
  const cx = GEAR.x + GEAR.w / 2;
  const cy = GEAR.y + GEAR.h / 2;
  ctx.fillStyle = screen === "SETTINGS" ? C.lcd : C.shellDark;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + anim * 0.4;
    ctx.fillRect(Math.round(cx + Math.cos(a) * 8) - 2, Math.round(cy + Math.sin(a) * 8) - 2, 4, 4);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.shell;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawScanlines(ctx) {
  ctx.fillStyle = "rgba(40,60,25,0.10)";
  for (let y = LCD.y; y < LCD.y + LCD.h; y += 3) ctx.fillRect(LCD.x, y, LCD.w, 1);
}

function drawToast(ctx) {
  if (!flash || flashT <= 0) return;
  const a = Math.min(1, flashT * 2);
  ctx.save();
  ctx.globalAlpha = a;
  const w = measureText(flash, 1) + 12;
  ctx.fillStyle = C.lcdInk;
  ctx.fillRect(LCD.x + LCD.w / 2 - w / 2, LCD.y + LCD.h - 24, w, 14);
  drawText(ctx, flash, LCD.x + LCD.w / 2, LCD.y + LCD.h - 21, 1, C.lcd, "center");
  ctx.restore();
}

function drawBoot(ctx) {
  const t = Math.min(1, bootT / 1.5);
  const drop = t < 0.45 ? (1 - t / 0.45) ** 2 : 0;
  const y = LCD.y + 70 - drop * 90;
  drawTextShadow(ctx, "PEECEEMONS", LCD.x + LCD.w / 2, y, 3, C.lcdInk, C.lcdDim, "center");

  if (t > 0.4) {
    drawText(ctx, "ORIGINAL CRITTERS", LCD.x + LCD.w / 2, LCD.y + 120, 1, C.lcdInkSoft, "center");
  }
  // Scanline sweep across the screen once.
  if (t < 0.9) {
    const sy = LCD.y + ((t / 0.9) * LCD.h * 1.2 - LCD.h * 0.1);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(LCD.x, sy, LCD.w, 3);
  }
  if (t >= 1) {
    drawText(ctx, "PRESS ANY BUTTON", LCD.x + LCD.w / 2, LCD.y + 160, 1,
      Math.floor(anim * 2) % 2 ? C.lcdInk : C.lcdInkSoft, "center");
  }
}

function drawCreatureAt(ctx, spec, x, y, scale, asSilhouette, frame = 0) {
  const s = sheets.get(spec.name);
  if (!s) return;
  const sheet = asSilhouette ? sils.get(spec.name) : s.idle;
  if (!sheet) return;
  drawFrame(ctx, sheet, frame, x, y, scale, false);
}

function drawSelect(ctx) {
  const list = filtered();
  if (!list.length) return;
  const spec = currentSpec();
  const midX = LCD.x + LCD.w / 2;

  drawText(ctx, TIER_LABEL[TIERS[tierIdx]], LCD.x + 6, LCD.y + 6, 1, C.lcdInkSoft);
  drawText(ctx, `${((cursorIdx % list.length) + list.length) % list.length + 1}/${list.length}`,
    LCD.x + LCD.w - 6, LCD.y + 6, 1, C.lcdInkSoft, "right");

  // Neighbours as silhouettes, the centred one in full colour (§4).
  for (let off = -2; off <= 2; off++) {
    const i = ((cursorIdx + off) % list.length + list.length) % list.length;
    const s = list[i];
    if (!sheets.has(s.name)) { ensureSheets(s); continue; }
    const centre = off === 0;
    const scale = centre ? 3 : 2;
    const x = midX + off * 66;
    const y = LCD.y + 120 + (centre ? 0 : -6);
    if (centre) {
      ctx.fillStyle = C.lcdDim;
      ctx.fillRect(x - 34, LCD.y + 26, 68, 98);
    }
    drawCreatureAt(ctx, s, x, y, scale, !centre || !isUnlocked(s.name),
      centre && Math.floor(anim * 3) % 8 === 0 ? 1 : 0);

    // Progress sits under every locked creature in the row, not just the
    // selected one, so you can see at a glance who you have chipped away at.
    if (!isUnlocked(s.name)) drawProgressPips(ctx, s.name, x, LCD.y + 124, centre);
  }

  const locked = !isUnlocked(spec.name);
  drawText(ctx, locked ? "???" : spec.name.toUpperCase(), midX, LCD.y + 134, 2, C.lcdInk, "center");

  if (locked) {
    const wins = winsAgainst(spec.name);
    const target = winsNeeded(spec);
    drawText(ctx, `${wins}/${target} BATTLES WON`, midX, LCD.y + 154, 1, C.lcdInk, "center");
    drawText(ctx, `${spec.tier.toUpperCase()} - BEAT IT IN THE WILD`,
      midX, LCD.y + 166, 1, C.lcdInkSoft, "center");
  } else {
    drawText(ctx, `${spec.type.toUpperCase()}  ${spec.tier.toUpperCase()}`,
      midX, LCD.y + 154, 1, C.lcdInkSoft, "center");
    drawText(ctx, moveFor(spec.type).name.toUpperCase(),
      midX, LCD.y + 166, 1, C.lcdInkSoft, "center");
  }
  drawText(ctx, spec.name === config.activeCreature ? "YOUR CURRENT PET"
                                                    : "A: CHOOSE   SELECT: SPAR",
    midX, LCD.y + 178, 1, C.lcdInkSoft, "center");
}

/**
 * One pip per battle this creature costs — filled for the ones you have won.
 * The row length itself tells you how rare it is: a wild shows three to five
 * pips, a legendary seven to ten.
 */
function drawProgressPips(ctx, name, cx, y, big = false) {
  const spec = roster.find((c) => c.name === name);
  if (!spec) return;
  const target = winsNeeded(spec);
  const wins = winsAgainst(name);
  const size = big ? 6 : 4;
  const gap = big ? 3 : 2;
  const total = target * size + (target - 1) * gap;
  let x = Math.round(cx - total / 2);
  for (let i = 0; i < target; i++) {
    ctx.fillStyle = i < wins ? C.lcdInk : C.lcdDim;
    ctx.fillRect(x, y, size, size);
    if (i >= wins) {
      ctx.strokeStyle = C.lcdInkSoft;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }
    x += size + gap;
  }
}

/**
 * HP bar with a damage trail: the solid part is current health, the hatched
 * part behind it is what was just knocked off and is still catching up.
 * Low health also switches to a dashed fill, because a single-colour LCD
 * cannot signal danger with red.
 */
function hpBar(ctx, x, y, w, hp, ghost, max) {
  const frac = Math.max(0, Math.min(1, hp / max));
  const gfrac = Math.max(frac, Math.min(1, ghost / max));

  ctx.fillStyle = C.lcdInk;
  ctx.fillRect(x - 1, y - 1, w + 2, 7);
  ctx.fillStyle = C.lcd;
  ctx.fillRect(x, y, w, 5);

  // Trail of freshly lost health.
  const gw = Math.round(w * gfrac);
  const fw = Math.round(w * frac);
  ctx.fillStyle = C.lcdInkSoft;
  for (let i = fw; i < gw; i += 2) ctx.fillRect(x + i, y, 1, 5);

  ctx.fillStyle = C.lcdInk;
  if (frac <= 0.25) {
    // Blink when nearly out.
    if (Math.floor(anim * 6) % 2) for (let i = 0; i < fw; i += 2) ctx.fillRect(x + i, y, 1, 5);
    else ctx.fillRect(x, y, fw, 5);
  } else {
    ctx.fillRect(x, y, fw, 5);
  }

  drawText(ctx, `${Math.max(0, Math.ceil(hp))}/${max}`, x + w, y + 8, 1, C.lcdInkSoft, "right");
}

/** Sprite plus the reaction to being hit: knockback, then a flicker. */
function drawFighter(ctx, spec, cx, cy, scale, flip, side) {
  const s = sheets.get(spec.name);
  if (!s) { ensureSheets(spec); return; }

  // Fainting: sinks below the baseline and fades out, the way a beaten
  // creature always has.
  if (faintFx && faintFx.who === side) {
    const k = Math.min(1, faintFx.t / 0.9);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.rect(LCD.x, LCD.y, LCD.w, LCD.h);
    ctx.clip();
    // Squashes down as it drops, so it reads as collapsing not sliding.
    ctx.translate(cx, cy + k * 26);
    ctx.scale(1, Math.max(0.15, 1 - k * 0.7));
    ctx.translate(-cx, -cy);
    drawFrame(ctx, s.idle, 1, cx, cy, scale, flip);
    ctx.restore();
    return;
  }

  let dx = 0;
  let flicker = false;
  const hit = bfx.hit;
  if (hit && hit.who === side && hit.t < 0.5) {
    // Shoved back, then springing home — damped so bigger hits move further.
    const k = hit.t / 0.5;
    const push = (flip ? 1 : -1) * (6 + hit.mult * 3);
    dx = push * (1 - k) * Math.cos(k * Math.PI * 3);
    flicker = hit.t < 0.32 && Math.floor(hit.t * 40) % 2 === 0;
  }

  ctx.save();
  if (flicker) ctx.globalAlpha = 0.2;
  drawFrame(ctx, s.idle, 0, cx + dx, cy, scale, flip);
  ctx.restore();
}

/** The damage number that floats up off whoever just took the hit. */
function drawDamageNumber(ctx, side, cx, cy) {
  const hit = bfx.hit;
  if (!hit || hit.who !== side) return;
  const k = Math.min(1, hit.t / 1.0);
  ctx.save();
  ctx.globalAlpha = 1 - k * k;
  const y = cy - 34 - k * 22;

  // A whiff gets its own callout instead of a damage number.
  if (hit.missed) {
    drawText(ctx, "MISS", cx, y, 2, C.lcdInkSoft, "center");
    ctx.restore();
    return;
  }

  const big = hit.mult > 1 ? 2 : 1;
  // Label sits above the number, so neither lands on top of the sprite.
  if (hit.t < 0.7) {
    if (hit.mult > 1) drawText(ctx, "SUPER!", cx, y - 10, 1, C.lcdInk, "center");
    else if (hit.mult < 1) drawText(ctx, "RESISTED", cx, y - 10, 1, C.lcdInkSoft, "center");
  }
  drawTextShadow(ctx, `-${hit.dmg}`, cx, y, big, C.lcdInk, C.lcd, "center");
  ctx.restore();
}

/** Inverted chip showing an active status, with turns remaining. */
function statusBadge(ctx, status, x, y, align = "left") {
  if (!status) return;
  const text = `${status.label} ${status.turns}`;
  const w = measureText(text, 1) + 6;
  const bx = align === "right" ? x - w : x;
  ctx.fillStyle = C.lcdInk;
  ctx.fillRect(bx, y - 2, w, 11);
  drawText(ctx, text, bx + 3, y, 1, C.lcd);
}

function drawBattle(ctx) {
  if (!battle) return;
  const L = LCD;
  const mine = battle.player;
  const foe = battle.foe;

  ctx.save();
  if (bfx.shake > 0) {
    ctx.translate((Math.random() - 0.5) * bfx.shake, (Math.random() - 0.5) * bfx.shake);
  }

  // Opponent: info top-left, sprite top-right.
  drawText(ctx, foe.name.toUpperCase(), L.x + 10, L.y + 10, 1, C.lcdInk);
  drawText(ctx, foe.type.toUpperCase(), L.x + 10, L.y + 22, 1, C.lcdInkSoft);
  statusBadge(ctx, battle.foeStatus, L.x + 62, L.y + 21);
  hpBar(ctx, L.x + 10, L.y + 34, 110, bfx.shownFoe, bfx.ghostFoe, battle.foeMaxHp);
  drawFighter(ctx, foe, L.x + FOE_AT.x, L.y + FOE_AT.y, 2, true, "foe");

  // You: sprite bottom-left, info bottom-right.
  drawFighter(ctx, mine, L.x + ME_AT.x, L.y + ME_AT.y, 2, false, "player");
  drawText(ctx, mine.name.toUpperCase(), L.x + L.w - 10, L.y + 84, 1, C.lcdInk, "right");
  drawText(ctx, mine.type.toUpperCase(), L.x + L.w - 10, L.y + 96, 1, C.lcdInkSoft, "right");
  statusBadge(ctx, battle.playerStatus, L.x + L.w - 62, L.y + 95, "right");
  hpBar(ctx, L.x + L.w - 120, L.y + 108, 110, bfx.shownPlayer, bfx.ghostPlayer, battle.playerMaxHp);

  // Attack effects sit above the fighters but inside the screen bezel.
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.x, L.y, L.w, L.h);
  ctx.clip();
  battleParticles.draw(ctx);
  ctx.restore();

  drawDamageNumber(ctx, "foe", L.x + FOE_AT.x, L.y + FOE_AT.y);
  drawDamageNumber(ctx, "player", L.x + ME_AT.x, L.y + ME_AT.y);
  ctx.restore();

  // Matchup hint, so the type chart is discoverable rather than hidden maths.
  const mult = effectiveness(mine.type, foe.type);
  const hint = mult > 1 ? "YOU HAVE THE ADVANTAGE"
    : mult < 1 ? "THEY RESIST YOU" : "EVEN MATCH";
  drawText(ctx, hint, L.x + L.w - 10, L.y + 126, 1, C.lcdInkSoft, "right");

  // Message strip.
  ctx.fillStyle = C.lcdInk;
  ctx.fillRect(L.x + 6, L.y + L.h - 40, L.w - 12, 34);
  ctx.fillStyle = C.lcd;
  ctx.fillRect(L.x + 8, L.y + L.h - 38, L.w - 16, 30);
  drawText(ctx, battle.log, L.x + L.w / 2, L.y + L.h - 32, 1, C.lcdInk, "center");

  let prompt;
  if (battle.over) {
    prompt = "PRESS A";
  } else if (battle.state === "READY") {
    prompt = Math.floor(anim * 2) % 2 ? "A: ATTACK   B: FLEE" : "";
  } else {
    prompt = "...";
  }
  drawText(ctx, prompt, L.x + L.w / 2, L.y + L.h - 20, 1, C.lcdInkSoft, "center");

  // Show the tally you are working towards — but only when it is a real
  // encounter, since practice never moves it.
  if (battle.practice) {
    drawText(ctx, "PRACTICE", L.x + 130, L.y + 10, 1, C.lcdInkSoft);
  } else if (!isUnlocked(foe.name)) {
    drawProgressPips(ctx, foe.name, L.x + 65, L.y + 46);
  }
}

function drawActive(ctx) {
  const spec = currentActiveSpec();
  if (!sheets.has(spec.name)) { ensureSheets(spec); return; }
  const midX = LCD.x + LCD.w / 2;

  drawText(ctx, "ACTIVE", LCD.x + 6, LCD.y + 6, 1, C.lcdInkSoft);
  drawText(ctx, config.roaming ? "ROAMING" : "RESTING",
    LCD.x + LCD.w - 6, LCD.y + 6, 1, C.lcdInkSoft, "right");

  // Ground line + a gentle idle bob so the screen is never static.
  ctx.fillStyle = C.lcdDim;
  ctx.fillRect(LCD.x + 40, LCD.y + 122, LCD.w - 80, 2);
  const bob = Math.sin(anim * 2) > 0.9 ? 1 : 0;
  drawCreatureAt(ctx, spec, midX, LCD.y + 122 - bob, 3,
    false, Math.floor(anim * 2.5) % 9 === 0 ? 1 : 0);

  drawText(ctx, spec.name.toUpperCase(), midX, LCD.y + 130, 2, C.lcdInk, "center");
  drawText(ctx, `${spec.type.toUpperCase()}  ${spec.tier.toUpperCase()}`,
    midX, LCD.y + 148, 1, C.lcdInkSoft, "center");
  drawText(ctx, moveFor(spec.type).name.toUpperCase(), midX, LCD.y + 159, 1, C.lcdInk, "center");

  // Type matchups, so the battle chart is visible before you need it.
  const m = matchups(spec.type);
  if (m.strong.length) {
    drawText(ctx, `BEATS ${m.strong.join(" ").toUpperCase()}`, LCD.x + 8, LCD.y + 20, 1, C.lcdInkSoft);
  }
  if (m.weak.length) {
    drawText(ctx, `WEAK TO ${m.weak.join(" ").toUpperCase()}`,
      LCD.x + LCD.w - 8, LCD.y + 20, 1, C.lcdInkSoft, "right");
  }

  // Bottom two lines. A hotkey clash is more urgent than the tally, so it
  // takes that row when there is one. Keep everything above LCD.y + 183 or
  // it gets clipped by the screen bezel.
  const findable = roster.filter((c) => c.tier !== "evolved");
  const remaining = findable.filter((c) => !config.unlocked.includes(c.name)).length;
  if (hotkeyWarning) {
    drawText(ctx, hotkeyWarning, midX, LCD.y + 170, 1, "#8a2a20", "center");
  } else {
    drawText(ctx, remaining ? `${remaining} LEFT - CLICK PET WHEN GRASS RUSTLES`
                            : `ALL ${findable.length} FOUND`,
      midX, LCD.y + 170, 1, C.lcdInkSoft, "center");
  }
  drawText(ctx, "A: PRACTICE BATTLE", midX, LCD.y + 181, 1, C.lcdInkSoft, "center");
}

function drawSettings(ctx) {
  drawText(ctx, "OPTIONS", LCD.x + 6, LCD.y + 6, 1, C.lcdInkSoft);
  drawText(ctx, "B TO CLOSE", LCD.x + LCD.w - 6, LCD.y + 6, 1, C.lcdInkSoft, "right");

  // The list has to fit inside 190px of screen, so the spacing is derived
  // from how many rows there are rather than being a fixed constant — adding
  // another option should never silently push one off the bottom.
  const rows = settingsRows();
  const top = 22;
  const gap = Math.min(15, Math.floor((LCD.h - top - 10) / rows.length));
  rows.forEach((row, i) => {
    const y = LCD.y + top + i * gap;
    const on = i === settingsIdx;
    if (on) {
      ctx.fillStyle = C.lcdDim;
      ctx.fillRect(LCD.x + 4, y - 2, LCD.w - 8, gap - 1);
      drawText(ctx, ">", LCD.x + 8, y, 1, C.lcdInk);
    }
    drawText(ctx, row.label, LCD.x + 20, y, 1, C.lcdInk);
    drawText(ctx, row.value, LCD.x + LCD.w - 10, y, 1, on ? C.lcdInk : C.lcdInkSoft, "right");
  });
}

// Three letters is all that fits ten rows of matchups on a 308px LCD.
const ABBR = {
  fire: "FIR", water: "WAT", grass: "GRA", electric: "ELE", ice: "ICE",
  rock: "ROC", psychic: "PSY", shadow: "SHA", dragon: "DRA", normal: "NOR",
};

function drawInfoTypes(ctx) {
  drawText(ctx, "TYPE CHART", LCD.x + 6, LCD.y + 6, 1, C.lcdInk);
  drawText(ctx, "B TO CLOSE", LCD.x + LCD.w - 6, LCD.y + 6, 1, C.lcdInkSoft, "right");
  drawText(ctx, "x2 BEATS", LCD.x + 78, LCD.y + 20, 1, C.lcdInkSoft);
  drawText(ctx, "x0.5 WEAK TO", LCD.x + 176, LCD.y + 20, 1, C.lcdInkSoft);

  const types = Object.keys(ABBR);
  types.forEach((t, i) => {
    const y = LCD.y + 32 + i * 14;
    if (i % 2 === 0) {
      ctx.fillStyle = C.lcdDim;
      ctx.fillRect(LCD.x + 4, y - 3, LCD.w - 8, 13);
    }
    const m = matchups(t);
    drawText(ctx, ABBR[t], LCD.x + 8, y, 1, C.lcdInk);
    drawText(ctx, m.strong.map((x) => ABBR[x]).join(" ") || "-",
      LCD.x + 78, y, 1, C.lcdInk);
    drawText(ctx, m.weak.map((x) => ABBR[x]).join(" ") || "-",
      LCD.x + 176, y, 1, C.lcdInkSoft);
  });
}

function drawInfoKeys(ctx) {
  drawText(ctx, "HOTKEYS", LCD.x + 6, LCD.y + 6, 1, C.lcdInk);
  drawText(ctx, "B TO CLOSE", LCD.x + LCD.w - 6, LCD.y + 6, 1, C.lcdInkSoft, "right");

  const short = (s) => s.toUpperCase().replace("CTRL", "CTL").replace("SPACE", "SPC");
  const rows = [
    ["GLOBAL", ""],
    [short(config.widgetHotkey), "SHOW / HIDE DEVICE"],
    [short(config.moveHotkey), "DO THE MOVE"],
    [short(config.roamToggleHotkey), "ROAMING ON / OFF"],
    [short(config.quitHotkey), "QUIT PEECEEMONS"],
    ["ON THIS DEVICE", ""],
    ["ARROWS", "PICK / TIER / OPTIONS"],
    ["ENTER", "A  -  CONFIRM, BATTLE"],
    ["BKSP ESC", "B  -  BACK, FLEE"],
    ["S", "START - ROAMING"],
    ["TAB", "SELECT - MOVE / SPAR"],
  ];

  rows.forEach(([k, v], i) => {
    const y = LCD.y + 22 + i * 14;
    if (!v) {
      drawText(ctx, k, LCD.x + 8, y, 1, C.lcdInkSoft);
      ctx.fillStyle = C.lcdInkSoft;
      ctx.fillRect(LCD.x + 8, y + 9, LCD.w - 16, 1);
      return;
    }
    drawText(ctx, k, LCD.x + 10, y, 1, C.lcdInk);
    drawText(ctx, v, LCD.x + LCD.w - 10, y, 1, C.lcdInkSoft, "right");
  });
}

/**
 * The evolution sequence. Flickers between the old and new silhouettes at an
 * accelerating rate, whites out, then reveals the new creature in colour.
 */
function drawEvolve(ctx) {
  if (!evolveFx) return;
  const { from, to, t } = evolveFx;
  const midX = LCD.x + LCD.w / 2;
  const baseY = LCD.y + 118;

  const FLICKER_END = 3.4;
  const FLASH_END = 4.0;

  if (t < FLICKER_END) {
    // Alternation speeds up from ~3Hz to ~18Hz as it builds.
    const rate = 3 + (t / FLICKER_END) * 15;
    const showNew = Math.floor(t * rate) % 2 === 1;
    const spec = showNew ? to : from;
    const sheet = sils.get(spec.name) || (sheets.get(spec.name) || {}).idle;
    if (sheet) {
      const wobble = Math.sin(t * 18) * (t / FLICKER_END) * 2;
      drawFrame(ctx, sheet, 0, midX + wobble, baseY, 3, false);
    }
    drawText(ctx, `${from.name.toUpperCase()} IS EVOLVING!`,
      midX, LCD.y + 24, 1, C.lcdInk, "center");
    drawText(ctx, "...", midX, LCD.y + 150, 2, C.lcdInkSoft, "center");
  } else if (t < FLASH_END) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(LCD.x, LCD.y, LCD.w, LCD.h);
  } else {
    const k = Math.min(1, (t - FLASH_END) / 0.6);
    ctx.save();
    ctx.globalAlpha = k;
    const s = sheets.get(to.name);
    if (s) drawFrame(ctx, s.idle, 0, midX, baseY, 3, false);
    ctx.restore();

    drawText(ctx, "CONGRATULATIONS!", midX, LCD.y + 18, 1, C.lcdInkSoft, "center");
    drawTextShadow(ctx, to.name.toUpperCase(), midX, LCD.y + 132, 2,
      C.lcdInk, C.lcdDim, "center");
    drawText(ctx, `${to.type.toUpperCase()}  EVOLVED`,
      midX, LCD.y + 152, 1, C.lcdInkSoft, "center");
    if (t > FLASH_END + 1.0) {
      drawText(ctx, Math.floor(anim * 2) % 2 ? "PRESS A" : "",
        midX, LCD.y + 170, 1, C.lcdInkSoft, "center");
    }
  }
}

function drawClosed(ctx, k) {
  // Shut: the lid lies over the base, so we only see its outside.
  roundRect(ctx, 8, 10, W - 16, H - 20, 18, C.shell, C.shellEdge, 3);
  roundRect(ctx, 30, 40, W - 60, 150, 10, C.shellLit, C.shellDark, 2);
  drawTextShadow(ctx, "PEECEEMONS", W / 2, 96, 3, C.shellEdge, C.shellLit, "center");
  drawText(ctx, "CLICK TO OPEN", W / 2, 132, 1, C.shellDark, "center");
  ctx.fillStyle = C.shellDark;
  for (let i = 0; i < 5; i++) ctx.fillRect(W / 2 - 60 + i * 26, H - 90, 14, 5);
}

/* ----------------------------- loop -------------------------------- */

function update(dt) {
  anim += dt;
  if (flashT > 0) flashT -= dt;
  for (const [k, v] of pressed) {
    if (v - dt <= 0) pressed.delete(k);
    else pressed.set(k, v - dt);
  }

  // Clamshell easing.
  const target = wantOpen ? 1 : 0;
  openT += (target - openT) * Math.min(1, dt * 7);
  if (Math.abs(target - openT) < 0.005) openT = target;

  if (evolveFx) evolveFx.t += dt;

  if (battle && screen === "BATTLE") {
    updateBattleFx(dt);
    if (battleTimer > 0) {
      battleTimer -= dt;
      if (battleTimer <= 0 && battle.state === "FOE" && !atkFx) startAttack("foe");
    }
    // Bank the win only once the loser has finished fainting.
    if (battle.state === "WON" && !battleAwarded && faintFx && faintFx.t > 0.9) awardWin();
    if (battle.state === "LOST" && faintFx && faintFx.t > 0.9 && faintFx.t - dt <= 0.9) sfx.deny();
  }

  if (screen === "BOOT" && openT > 0.9) {
    bootT += dt;
    if (bootT > 2.6) {
      screen = "SELECT";
      const active = roster.findIndex((c) => c.name === config.activeCreature);
      cursorIdx = active >= 0 ? active : 0;
    }
  }
}

// The device is authored in a fixed 420x600 space and scaled to fit whatever
// the window actually is, so the layout never depends on the window size.
// view is kept in sync by render() and reused to un-project mouse clicks.
const view = { scale: 1, ox: 0, oy: 0 };

function applyView(ctx) {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  view.scale = Math.min(cw / W, ch / H);
  view.ox = (cw - W * view.scale) / 2;
  view.oy = (ch - H * view.scale) / 2;
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
}

/** Window CSS pixels -> device space. */
function toDevice(x, y) {
  return [(x - view.ox) / view.scale, (y - view.oy) / view.scale];
}

function render() {
  const ctx = fitCanvas(canvas);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  applyView(ctx);

  if (openT < 0.02) {
    drawClosed(ctx, openT);
    return;
  }

  drawBase(ctx);

  // Flip the lid about the hinge: -1 shut (folded over the base), 1 open.
  const scaleY = -Math.cos(openT * Math.PI);
  if (Math.abs(scaleY) >= 0.02) {
    ctx.save();
    ctx.translate(0, HINGE);
    ctx.scale(1, scaleY);
    ctx.translate(0, -HINGE);
    drawLid(ctx);
    ctx.restore();
  }
  drawHinge(ctx);
}

/* ----------------------------- input ------------------------------- */

const KEYS = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Enter: "a", Backspace: "b", Escape: "b", s: "start", S: "start", Tab: "select",
};

function hitAt(x, y) {
  for (const r of HITS) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
  }
  return null;
}

function wireInput() {
  canvas.addEventListener("mousedown", async (e) => {
    const [x, y] = toDevice(e.clientX, e.clientY);

    if (openT < 0.5) {
      wantOpen = true;
      sfx.open();
      return;
    }
    const id = hitAt(x, y);
    if (id) {
      await action(id);
      return;
    }
    // Anywhere else on the shell drags the window.
    const win = currentWindow();
    if (win) win.startDragging().catch(() => {});
  });

  window.addEventListener("keydown", async (e) => {
    const id = KEYS[e.key];
    if (!id) return;
    e.preventDefault();          // Tab must not move focus out of the device
    if (openT < 0.5) {
      wantOpen = true;
      sfx.open();
      return;
    }
    await action(id);
  });
}

/* ----------------------------- startup ----------------------------- */

async function main() {
  try {
    roster = await loadRoster();
    config = await getConfig();
    await loadTypeChart();
    setSoundEnabled(config.soundOn);

    // Load the active creature plus the first screenful; the rest stream in.
    await ensureSheets(currentActiveSpec());
    for (const s of roster.slice(0, 6)) ensureSheets(s);
  } catch (e) {
    if (window.__peeceemonsReport) {
      window.__peeceemonsReport("STARTUP", e && e.message ? e.message : e, e && e.stack);
    }
    console.error("[peeceemons] widget failed to start", e);
    return;
  }

  sfx.boot();
  wireInput();
  await applyWidgetScale();

  await listen("config-changed", (event) => {
    if (event.payload) {
      config = event.payload;
      setSoundEnabled(config.soundOn);
    }
  });

  // The overlay cannot make sound (it never receives a user gesture, so the
  // browser keeps its AudioContext suspended). It tells us instead.
  await listen("move-fired", () => sfx.attack());

  // A wild creature has appeared around the pet — pre-load its art so the
  // battle can open instantly when the pet is clicked.
  await listen("encounter-started", (event) => {
    const name = event.payload && event.payload.name;
    const spec = roster.find((c) => c.name === name);
    if (spec) ensureSheets(spec);
  });

  // The pet was clicked while something was rustling: fight.
  await listen("battle-requested", async (event) => {
    const name = event.payload && event.payload.foe;
    const spec = roster.find((c) => c.name === name);
    if (!spec || battle) return;
    const w = currentWindow();
    if (w) {
      await w.show().catch(() => {});
      await w.setFocus().catch(() => {});
    }
    await startBattle(spec);
  });

  await listen("hotkey-status", (event) => {
    const failed = event.payload && event.payload.failed;
    hotkeyWarning = failed && failed.length
      ? `HOTKEY IN USE: ${failed[0].accelerator.toUpperCase()}`
      : null;
  });

  // Remember where the user parks the device (§11.5).
  const win = currentWindow();
  if (win) {
    // Ignore the Moved events that the initial restore itself provokes —
    // saving those back caused the position to creep across restarts.
    let ready = false;
    setTimeout(() => { ready = true; }, 1500);

    let saveTimer = 0;
    win.onMoved(({ payload }) => {
      if (!ready) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        setConfig({ widgetPosition: { x: payload.x, y: payload.y } });
      }, 500);
    }).catch(() => {});
  }

  startLoop(update, render);
  if (!inTauri) console.info("[peeceemons] widget running outside Tauri");
}

main();
