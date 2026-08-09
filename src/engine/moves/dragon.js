// Dragon — Sky Roar: wind lines + screen-shake. The legendary one, so it is
// allowed to be the loudest effect in the set.
import { pulse } from "./_shape.js";

export default {
  id: "dragon",
  name: "Sky Roar",
  duration: 1.3,

  run(t, api) {
    const { fx } = api;

    // Rear back, then the roar itself.
    if (t < 0.25) {
      const k = t / 0.25;
      fx.offsetX = -api.facing * k * 6;
      fx.squashY = 1 + k * 0.08;
    } else {
      const k = (t - 0.25) / 0.75;
      fx.offsetX = api.facing * (1 - k) * 5;
      fx.squashX = 1 + (1 - k) * 0.12;
      fx.squashY = 1 - (1 - k) * 0.08;
      fx.flash = t < 0.4 ? 0.5 : 0;
      // Reduced motion drops the shake entirely but keeps the wind lines.
      if (!api.reduced) fx.shake = 6 * (1 - k) * (1 - k);
    }

    // Horizontal wind lines streaming away from the mouth.
    if (t > 0.22 && t < 0.8) {
      const n = api.reduced ? 1 : 3;
      api.burst(n, () => ({
        x: api.cx + api.facing * api.w * 0.35,
        y: api.cy - api.h * 0.15 + (api.rnd() - 0.5) * api.h * 0.7,
        vx: api.facing * (200 + api.rnd() * 220),
        vy: (api.rnd() - 0.5) * 40,
        drag: 0.985,
        life: 0.35 + api.rnd() * 0.3,
        size: 2 + api.rnd() * 2,
        colour: api.rnd() < 0.5 ? api.palette[2] : "#ffffff",
        shape: "line",
        angle: api.facing > 0 ? 0 : Math.PI,
      }));
    }

    // A couple of shock rings at the peak.
    if (t > 0.26 && t < 0.29) {
      api.emit({
        x: api.cx + api.facing * api.w * 0.3,
        y: api.cy - api.h * 0.15,
        life: 0.5,
        size: 5,
        endSize: api.reduced ? 35 : 60,
        colour: api.palette[2],
        shape: "ring",
      });
    }
  },
};
