// Rock — Boulder Roll: dust cloud + horizontal shake.
import { pulse } from "./_shape.js";

export default {
  id: "rock",
  name: "Boulder Roll",
  duration: 1.0,

  run(t, api) {
    const { fx } = api;

    // Heavy, low-frequency rumble along the ground plane.
    if (!api.reduced) {
      fx.offsetX = Math.sin(t * Math.PI * 10) * 3 * (1 - t);
      fx.shake = t < 0.6 ? 3 * (1 - t / 0.6) : 0;
    }
    fx.squashY = 1 - pulse(t) * 0.08;
    fx.squashX = 1 + pulse(t) * 0.08;

    if (t < 0.7) {
      const n = api.reduced ? 1 : 3;
      api.burst(n, () => ({
        // Dust kicks up from the feet, trailing behind the direction of roll.
        x: api.x + (api.rnd() - 0.5) * api.w * 0.8,
        y: api.y - api.rnd() * 6,
        vx: -api.facing * (30 + api.rnd() * 70),
        vy: -10 - api.rnd() * 45,
        gravity: 55,
        drag: 0.94,
        life: 0.5 + api.rnd() * 0.5,
        size: 3 + api.rnd() * 4,
        endSize: 7,
        colour: api.rnd() < 0.5 ? api.palette[1] : api.palette[0],
        shape: "circle",
      }));
    }
  },
};
