// Normal — Quick Dash: a fast dash out and back, leaving a dust puff.
import { easeOut } from "./_shape.js";

export default {
  id: "normal",
  name: "Quick Dash",
  duration: 0.8,

  run(t, api) {
    const { fx } = api;
    const DASH = api.w * 1.1;

    if (t < 0.15) {
      // Crouch.
      const k = t / 0.15;
      fx.squashY = 1 - k * 0.18;
      fx.squashX = 1 + k * 0.14;
      fx.offsetX = -api.facing * k * 5;
    } else if (t < 0.5) {
      // Out, stretched into the direction of travel.
      const k = easeOut((t - 0.15) / 0.35);
      fx.offsetX = api.facing * DASH * k;
      fx.squashX = 1 + 0.2 * (1 - k);
      fx.squashY = 1 - 0.12 * (1 - k);
    } else {
      // And back to the spot it started from (§6: "returns to spot").
      const k = easeOut((t - 0.5) / 0.5);
      fx.offsetX = api.facing * DASH * (1 - k);
      fx.squashX = 1 + 0.1 * (1 - k);
    }

    // Dust kicked up at launch and on the return.
    if ((t > 0.15 && t < 0.35) || (t > 0.55 && t < 0.75)) {
      const n = api.reduced ? 1 : 2;
      api.burst(n, () => ({
        x: api.x + fx.offsetX - api.facing * api.w * 0.25,
        y: api.y - api.rnd() * 5,
        vx: -api.facing * (40 + api.rnd() * 60),
        vy: -15 - api.rnd() * 30,
        gravity: 60,
        drag: 0.93,
        life: 0.35 + api.rnd() * 0.3,
        size: 3 + api.rnd() * 3,
        endSize: 6,
        colour: api.rnd() < 0.5 ? api.palette[1] : api.palette[2],
        shape: "circle",
      }));
    }
  },
};
