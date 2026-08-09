// Shadow — Shade Step: fade out -> smoke puff -> fade back in, offset.
export default {
  id: "shadow",
  name: "Shade Step",
  duration: 1.0,

  run(t, api) {
    const { fx } = api;
    const STEP = api.w * 0.7; // how far it reappears from where it left

    if (t < 0.35) {
      // Dissolving.
      const k = t / 0.35;
      fx.alpha = 1 - k;
      fx.squashX = 1 - k * 0.25;
      fx.squashY = 1 + k * 0.15;
    } else if (t < 0.55) {
      // Gone. Smoke marks both the old and the new position.
      fx.alpha = 0;
      const n = api.reduced ? 1 : 3;
      api.burst(n, () => ({
        x: api.cx + (api.rnd() < 0.5 ? 0 : api.facing * STEP) + (api.rnd() - 0.5) * 14,
        y: api.cy + (api.rnd() - 0.5) * api.h * 0.5,
        vx: (api.rnd() - 0.5) * 30,
        vy: -20 - api.rnd() * 30,
        drag: 0.95,
        life: 0.5 + api.rnd() * 0.4,
        size: 4 + api.rnd() * 4,
        endSize: 9,
        colour: api.rnd() < 0.5 ? api.palette[1] : api.palette[0],
        shape: "circle",
      }));
    } else {
      // Reappearing at the offset spot, then sliding back to where it was.
      const k = (t - 0.55) / 0.45;
      fx.alpha = Math.min(1, k * 1.6);
      fx.offsetX = api.facing * STEP * (1 - k);
      fx.squashX = 1 - (1 - k) * 0.2;
    }
  },
};
