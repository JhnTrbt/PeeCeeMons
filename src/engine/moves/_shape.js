// _shape.js — the contract every move module implements.
//
// Adding a new type is: drop a file next to this one exporting this shape,
// then add one line to index.js. No engine changes (§6).
//
//   export default {
//     id:       matches the creature's `type` in creatures.json
//     name:     display name, shown on the widget
//     duration: seconds the move lasts
//     shake:    0..1 baseline screen-shake, scaled by the module
//     run(t, api)
//   }
//
// `t` runs 0 -> 1 across the move. `api` gives you:
//
//   api.x, api.y      creature's feet, in overlay CSS pixels
//   api.cx, api.cy    creature's centre
//   api.w, api.h      drawn sprite size
//   api.facing        1 = facing right, -1 = facing left
//   api.palette       the creature's 4 colours [base, shade, high, outline]
//   api.reduced       true when reduced-motion is on: skip shake, thin out
//                     particle counts, but still play something
//   api.rnd()         0..1
//   api.emit(opts)    one particle   (see particles.js)
//   api.burst(n, fn)  n particles, fn(i, n) returns the options
//
//   api.fx            per-frame transform the creature applies to itself.
//                     Reset before every run() call, so just assign:
//                       fx.alpha      0..1 opacity
//                       fx.offsetX/Y  pixel offset from its walking position
//                       fx.squashX/Y  scale multipliers (1 = normal)
//                       fx.flash      0..1 white-out over the sprite
//                       fx.shake      pixels of screen shake this frame
//
// Nothing here is enforced at runtime; this file is the documentation.

export const MOVE_KEYS = ["id", "name", "duration", "run"];

/** Small helper: ease a 0..1 value out. */
export const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** Small helper: 0 -> 1 -> 0 over the move. */
export const pulse = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
