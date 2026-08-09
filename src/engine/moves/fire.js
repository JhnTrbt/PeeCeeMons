// Fire — Ember Burst: rising ember particles + a brief body flash.
import { pulse } from "./_shape.js";

export default {
  id: "fire",
  name: "Ember Burst",
  duration: 0.9,

  run(t, api) {
    const { fx } = api;

    // Flash concentrated in the first third, then fade.
    fx.flash = t < 0.3 ? pulse(t / 0.3) * 0.8 : 0;
    fx.squashY = 1 + pulse(t) * 0.06;

    const rate = api.reduced ? 1 : 3;
    if (t < 0.75) {
      api.burst(rate, () => {
        const spread = api.w * 0.45;
        return {
          x: api.cx + (api.rnd() - 0.5) * spread,
          y: api.y - api.h * 0.25 - api.rnd() * api.h * 0.3,
          vx: (api.rnd() - 0.5) * 40,
          vy: -60 - api.rnd() * 70,
          gravity: 30,
          drag: 0.97,
          life: 0.45 + api.rnd() * 0.5,
          size: 2 + Math.round(api.rnd() * 2),
          endSize: 1,
          colour: api.rnd() < 0.45 ? api.palette[2] : api.palette[0],
          shape: "square",
        };
      });
    }
  },
};
