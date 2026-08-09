// Grass — Leaf Spin: leaves spiral out and drift down.
import { pulse } from "./_shape.js";

export default {
  id: "grass",
  name: "Leaf Spin",
  duration: 1.1,

  run(t, api) {
    // The creature itself spins up a little then settles.
    api.fx.squashY = 1 + pulse(t) * 0.1;
    api.fx.offsetY = -pulse(t) * api.h * 0.08;

    if (t < 0.5) {
      const n = api.reduced ? 1 : 2;
      api.burst(n, () => {
        // Launch along an outward spiral rather than a plain circle.
        const angle = t * Math.PI * 6 + api.rnd() * 0.6;
        const speed = 50 + api.rnd() * 50;
        return {
          x: api.cx,
          y: api.cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 30,
          gravity: 45,
          drag: 0.96,
          life: 0.9 + api.rnd() * 0.6,
          size: 2 + Math.round(api.rnd() * 2),
          colour: api.rnd() < 0.4 ? api.palette[2] : api.palette[0],
          shape: "line",
          angle: api.rnd() * Math.PI,
          spin: (api.rnd() - 0.5) * 10,
        };
      });
    }
  },
};
