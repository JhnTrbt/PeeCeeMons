// Psychic — Mind Wave: expanding ripple rings + soft glow.
import { pulse } from "./_shape.js";

export default {
  id: "psychic",
  name: "Mind Wave",
  duration: 1.2,

  run(t, api) {
    const { fx } = api;

    fx.flash = pulse(t) * 0.3; // steady soft glow, not a strobe
    fx.offsetY = -pulse(t) * api.h * 0.12; // lifts as it concentrates
    fx.squashX = 1 - pulse(t) * 0.04;

    // Three rings, released in sequence.
    const ringAt = [0.02, 0.25, 0.48];
    for (const start of ringAt) {
      if (t >= start && t < start + 0.03) {
        api.emit({
          x: api.cx,
          y: api.cy,
          life: 0.9,
          size: 4,
          endSize: api.reduced ? 40 : 70,
          colour: api.palette[2],
          shape: "ring",
        });
      }
    }

    // Motes drawn inward, orbiting the creature.
    if (!api.reduced && t < 0.7) {
      api.burst(1, () => {
        const angle = api.rnd() * Math.PI * 2;
        const r = 40 + api.rnd() * 30;
        return {
          x: api.cx + Math.cos(angle) * r,
          y: api.cy + Math.sin(angle) * r,
          vx: -Math.cos(angle) * 55,
          vy: -Math.sin(angle) * 55,
          life: 0.7,
          size: 2,
          colour: api.palette[2],
          shape: "square",
        };
      });
    }
  },
};
