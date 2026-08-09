// Electric — Static Jolt: lightning flash + radial sparks.
import { pulse } from "./_shape.js";

export default {
  id: "electric",
  name: "Static Jolt",
  duration: 0.7,

  run(t, api) {
    const { fx } = api;

    // Stuttering strobe rather than a smooth fade — reads as electricity.
    const strobe = t < 0.45 && Math.floor(t * 40) % 2 === 0;
    fx.flash = strobe ? 0.9 : 0;
    if (!api.reduced) {
      fx.offsetX = strobe ? (api.rnd() - 0.5) * 4 : 0;
      fx.shake = t < 0.3 ? 2 : 0;
    }

    // One big radial spray at the start, then a trickle.
    if (t < 0.05) {
      api.burst(api.reduced ? 6 : 14, (i, n) => {
        const angle = (i / n) * Math.PI * 2;
        const speed = 110 + api.rnd() * 90;
        return {
          x: api.cx,
          y: api.cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: 0,
          drag: 0.9,
          life: 0.25 + api.rnd() * 0.2,
          size: 2,
          colour: api.rnd() < 0.6 ? api.palette[2] : "#ffffff",
          shape: "line",
          angle,
        };
      });
    } else if (t < 0.5 && !api.reduced) {
      api.burst(1, () => ({
        x: api.cx + (api.rnd() - 0.5) * api.w * 0.7,
        y: api.cy + (api.rnd() - 0.5) * api.h * 0.6,
        vx: (api.rnd() - 0.5) * 60,
        vy: (api.rnd() - 0.5) * 60,
        life: 0.15,
        size: 2,
        colour: "#ffffff",
        shape: "square",
      }));
    }
  },
};
