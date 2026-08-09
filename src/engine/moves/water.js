// Water — Bubble Stream: bubbles arc outward and pop.
import { pulse } from "./_shape.js";

export default {
  id: "water",
  name: "Bubble Stream",
  duration: 1.0,

  run(t, api) {
    api.fx.squashX = 1 + pulse(t) * 0.08;
    api.fx.squashY = 1 - pulse(t) * 0.06;

    // Bubbles leave the mouth in a stream, arc, then pop at end of life.
    if (t < 0.7) {
      const n = api.reduced ? 1 : 2;
      api.burst(n, () => {
        const angle = -0.9 + (api.rnd() - 0.5) * 0.7;
        const speed = 70 + api.rnd() * 60;
        return {
          x: api.cx + api.facing * api.w * 0.3,
          y: api.cy - api.h * 0.1,
          vx: Math.cos(angle) * speed * api.facing,
          vy: Math.sin(angle) * speed,
          gravity: 90,
          drag: 0.99,
          life: 0.6 + api.rnd() * 0.5,
          size: 2 + api.rnd() * 3,
          endSize: 4,
          colour: api.rnd() < 0.5 ? api.palette[2] : api.palette[0],
          shape: "ring",
        };
      });
    }
  },
};
