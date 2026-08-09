// Ice — Frost Puff: snowflakes + a shiver squash-stretch.
export default {
  id: "ice",
  name: "Frost Puff",
  duration: 1.0,

  run(t, api) {
    const { fx } = api;

    // The shiver: a fast oscillation that damps out across the move.
    const damp = 1 - t;
    const shiver = Math.sin(t * Math.PI * 18) * damp;
    fx.squashX = 1 + shiver * 0.09;
    fx.squashY = 1 - shiver * 0.09;
    if (!api.reduced) fx.offsetX = shiver * 2;

    if (t < 0.6) {
      const n = api.reduced ? 1 : 2;
      api.burst(n, () => ({
        x: api.cx + (api.rnd() - 0.5) * api.w * 0.9,
        y: api.cy - api.h * 0.2 - api.rnd() * api.h * 0.3,
        vx: (api.rnd() - 0.5) * 50,
        vy: -20 - api.rnd() * 25,
        gravity: 26, // drifts back down rather than falling
        drag: 0.98,
        life: 1.0 + api.rnd() * 0.6,
        size: 2 + api.rnd() * 2,
        colour: api.rnd() < 0.5 ? "#ffffff" : api.palette[2],
        shape: "flake",
        spin: (api.rnd() - 0.5) * 4,
      }));
    }
  },
};
