// particles.js — the shared effect system every move draws through.
//
// Fixed-size object pool. The overlay is always-on-top and always running, so
// it must never allocate per frame or let an enthusiastic move flood the
// screen. MAX is a hard ceiling: past it, new emissions are simply dropped
// (§11's "flag any feature that risks overlay performance and cap it").

export const MAX_PARTICLES = 200;

const SHAPES = ["square", "circle", "line", "ring", "flake"];

function blank() {
  return {
    alive: false,
    x: 0, y: 0, vx: 0, vy: 0,
    gravity: 0, drag: 1,
    life: 0, maxLife: 1,
    size: 2, endSize: null,
    colour: "#fff", fade: true,
    shape: "square", spin: 0, angle: 0,
  };
}

export class Particles {
  constructor(max = MAX_PARTICLES) {
    this.max = max;
    this.pool = Array.from({ length: max }, blank);
    this.live = 0;
    this.cursor = 0;
  }

  get count() {
    return this.live;
  }

  /** Grab a dead slot, or nothing if we are at the ceiling. */
  _take() {
    if (this.live >= this.max) return null;
    for (let i = 0; i < this.max; i++) {
      const idx = (this.cursor + i) % this.max;
      if (!this.pool[idx].alive) {
        this.cursor = (idx + 1) % this.max;
        this.live++;
        return this.pool[idx];
      }
    }
    return null;
  }

  emit(opts) {
    const p = this._take();
    if (!p) return null;
    p.alive = true;
    p.x = opts.x || 0;
    p.y = opts.y || 0;
    p.vx = opts.vx || 0;
    p.vy = opts.vy || 0;
    p.gravity = opts.gravity || 0;
    p.drag = opts.drag === undefined ? 1 : opts.drag;
    p.maxLife = opts.life || 0.6;
    p.life = p.maxLife;
    p.size = opts.size || 2;
    p.endSize = opts.endSize === undefined ? null : opts.endSize;
    p.colour = opts.colour || "#ffffff";
    p.fade = opts.fade !== false;
    p.shape = SHAPES.includes(opts.shape) ? opts.shape : "square";
    p.spin = opts.spin || 0;
    p.angle = opts.angle || 0;
    return p;
  }

  /** Emit `n` particles, calling `fn(i, n)` for each one's options. */
  burst(n, fn) {
    for (let i = 0; i < n; i++) {
      if (this.live >= this.max) return;
      this.emit(fn(i, n));
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.live--;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d;
        p.vy *= d;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
  }

  draw(ctx) {
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      const t = p.life / p.maxLife; // 1 -> 0 over the lifetime
      const size = p.endSize === null ? p.size : p.size * t + p.endSize * (1 - t);

      ctx.save();
      ctx.globalAlpha = p.fade ? Math.max(0, Math.min(1, t)) : 1;
      ctx.fillStyle = p.colour;
      ctx.strokeStyle = p.colour;

      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const s = Math.max(1, Math.round(size));

      switch (p.shape) {
        case "circle":
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "ring":
          ctx.lineWidth = Math.max(1, Math.round(s / 3));
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case "line": {
          const len = s * 3;
          ctx.lineWidth = Math.max(1, Math.round(s / 2));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(p.angle) * len, y + Math.sin(p.angle) * len);
          ctx.stroke();
          break;
        }
        case "flake":
          // A 3-spoke asterisk reads as a snowflake at these sizes.
          ctx.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            const a = p.angle + (k * Math.PI) / 3;
            ctx.beginPath();
            ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s);
            ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
            ctx.stroke();
          }
          break;
        default:
          ctx.fillRect(x - (s >> 1), y - (s >> 1), s, s);
      }
      ctx.restore();
    }
  }

  clear() {
    for (const p of this.pool) p.alive = false;
    this.live = 0;
  }
}
