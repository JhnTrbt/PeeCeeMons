// bridge.js — the only file that knows Tauri exists.
//
// Two reasons for the indirection:
//   1. There is no bundler, so we cannot `import` @tauri-apps/api. Everything
//      goes through the `withGlobalTauri` object instead.
//   2. Outside Tauri (devtest.html in a plain browser) these all degrade to
//      in-memory no-ops, so the engine runs anywhere.

const T = typeof window !== "undefined" ? window.__TAURI__ : undefined;

export const inTauri = !!T;

/** Mirrors the Rust Config defaults, for when we are running in a browser. */
const FALLBACK_CONFIG = {
  activeCreature: "Flarepup",
  roaming: true,
  moveTimerSeconds: 25,
  moveHotkey: "Ctrl+Alt+M",
  widgetHotkey: "Ctrl+Alt+P",
  roamToggleHotkey: "Ctrl+Alt+O",
  quitHotkey: "Ctrl+Alt+Q",
  soundOn: false,
  reducedMotion: false,
  launchOnStartup: false,
  widgetPosition: { x: 40, y: 40 },
  unlocked: [
    "Flarepup", "Dripling", "Sproutle", "Voltnip", "Frostkit",
    "Pebblump", "Mystmind", "Shadeling", "Nibblet",
  ],
  overlayMonitor: "primary",
  spriteScale: 3,
  progress: {},
  winsToUnlock: 5,
  encounterMinutes: 40,
  battlesWon: 0,
};

let localConfig = { ...FALLBACK_CONFIG };
const localListeners = new Map();

export async function invoke(cmd, args) {
  if (!T) return null;
  return T.core.invoke(cmd, args);
}

/** Subscribe to an app event. Returns an unlisten function. */
export async function listen(event, handler) {
  if (!T) {
    const set = localListeners.get(event) || new Set();
    set.add(handler);
    localListeners.set(event, set);
    return () => set.delete(handler);
  }
  return T.event.listen(event, handler);
}

/** Emit an app-wide event to the other window. */
export async function emit(event, payload) {
  if (!T) {
    emitLocal(event, payload);
    return;
  }
  try {
    await T.event.emit(event, payload);
  } catch (e) {
    console.error("[peeceemons] emit failed", event, e);
  }
}

/** Only used by the browser fallback, to fake events in devtest. */
export function emitLocal(event, payload) {
  const set = localListeners.get(event);
  if (set) for (const h of set) h({ payload });
}

export async function getConfig() {
  if (!T) return { ...localConfig };
  try {
    return await T.core.invoke("get_config");
  } catch (e) {
    console.error("[peeceemons] get_config failed", e);
    return { ...FALLBACK_CONFIG };
  }
}

/** Partial update. Returns the full, validated config the backend settled on. */
export async function setConfig(patch) {
  if (!T) {
    localConfig = { ...localConfig, ...patch };
    emitLocal("config-changed", { ...localConfig });
    return { ...localConfig };
  }
  try {
    return await T.core.invoke("set_config", { patch });
  } catch (e) {
    console.error("[peeceemons] set_config failed", e);
    return await getConfig();
  }
}

export async function resetConfig() {
  if (!T) {
    localConfig = { ...FALLBACK_CONFIG };
    emitLocal("config-changed", { ...localConfig });
    return { ...localConfig };
  }
  return T.core.invoke("reset_config");
}

/** Tell Rust where the sprite is, so it can open a click-through hole. */
export async function setHitRect(x, y, w, h) {
  if (!T) return;
  try {
    await T.core.invoke("set_hit_rect", { x, y, w, h });
  } catch {
    /* overlay may be mid-teardown; nothing useful to do */
  }
}

export function currentWindow() {
  return T ? T.window.getCurrentWindow() : null;
}

/** Load the roster. Shared by the overlay, the widget and the dev page. */
export async function loadRoster() {
  const res = await fetch("data/creatures.json");
  if (!res.ok) throw new Error(`creatures.json: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.creatures) || data.creatures.length === 0) {
    throw new Error("creatures.json has no creatures");
  }
  return data.creatures;
}
