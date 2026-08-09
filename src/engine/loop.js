// loop.js — the animation clock.
//
// A fixed-timestep accumulator, not a raw requestAnimationFrame delta. On a
// 144Hz monitor a naive loop would make the pet walk more than twice as fast
// as it does at 60Hz; here the simulation always advances in 1/60s steps and
// only the render rate follows the display.

const STEP = 1 / 60;
const MAX_CATCHUP = 0.25; // never simulate more than a quarter second at once

export function startLoop(update, render) {
  let last = performance.now() / 1000;
  let accumulator = 0;
  let raf = 0;
  let running = true;

  function frame(nowMs) {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    const now = nowMs / 1000;
    let elapsed = now - last;
    last = now;

    // A backgrounded window can produce an enormous gap. Clamp it so the
    // pet does not teleport across the screen when you come back to it.
    if (elapsed > MAX_CATCHUP) elapsed = MAX_CATCHUP;
    accumulator += elapsed;

    while (accumulator >= STEP) {
      update(STEP);
      accumulator -= STEP;
    }

    render(accumulator / STEP);
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

/** Sizes a canvas to its CSS box at device resolution, with smoothing off. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
