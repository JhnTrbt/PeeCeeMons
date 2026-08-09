// audio.js — retro blips, synthesised rather than shipped as files.
//
// The brief asked for bundled audio so nothing is fetched from a CDN. Square
// and noise waves generated on the fly satisfy that better than .wav files
// would: no binary assets, nothing to load, no chance of a missing file, and
// the waveform is genuinely the one the old handhelds used.
//
// Off by default (§9 soundOn), and the AudioContext is not even created until
// the first sound is actually requested.

let ctx = null;
let enabled = false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  // Browsers suspend contexts created before a gesture.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setSoundEnabled(on) {
  enabled = !!on;
}

export function soundEnabled() {
  return enabled;
}

/** One square-wave blip. freq in Hz, dur in seconds. */
function blip(freq, dur, { type = "square", gain = 0.05, sweep = 0 } = {}) {
  if (!enabled) return;
  const a = ac();
  if (!a) return;

  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (sweep) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, freq + sweep),
      a.currentTime + dur
    );
  }
  // Quick attack, exponential release — a soft envelope sounds wrong here.
  amp.gain.setValueAtTime(0.0001, a.currentTime);
  amp.gain.exponentialRampToValueAtTime(gain, a.currentTime + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);

  osc.connect(amp).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + dur + 0.02);
}

/** Short burst of filtered noise, for thuds and whooshes. */
function noise(dur, { gain = 0.04, freq = 900 } = {}) {
  if (!enabled) return;
  const a = ac();
  if (!a) return;

  const frames = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, frames, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const amp = a.createGain();
  amp.gain.value = gain;

  src.connect(filter).connect(amp).connect(a.destination);
  src.start();
}

export const sfx = {
  move: () => blip(220, 0.05, { sweep: 260 }),
  select: () => blip(660, 0.05),
  confirm: () => {
    blip(660, 0.06);
    setTimeout(() => blip(990, 0.09), 60);
  },
  back: () => blip(300, 0.07, { sweep: -110 }),
  open: () => {
    blip(400, 0.05);
    setTimeout(() => blip(600, 0.05), 50);
  },
  boot: () => {
    // Four rising notes — the "device turning on" flourish.
    [392, 523, 659, 784].forEach((f, i) =>
      setTimeout(() => blip(f, 0.13, { gain: 0.045 }), i * 110)
    );
  },
  attack: () => {
    blip(160, 0.12, { sweep: 420, gain: 0.05 });
    noise(0.18, { freq: 1400 });
  },
  deny: () => blip(140, 0.12, { type: "sawtooth", gain: 0.035 }),
};
