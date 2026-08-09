// creature.js — one pet: where it is, what it is doing, and how it draws.
//
// States: WALK, IDLE, TURN, HOP, SLEEP, MOVE.
// Everything is driven from update(dt, env); nothing here touches the DOM or
// Tauri, so the same class runs unchanged in the overlay, the widget's LCD
// preview, and the dev test page.

import { drawFrame } from "./sprites.js";
import { moveFor } from "./moves/index.js";

const WALK_SPEED = 34;      // CSS px per second
const TURN_TIME = 0.22;
const HOP_TIME = 0.45;
const HOP_HEIGHT = 26;
const BLINK_TIME = 0.11;
const SLEEP_AFTER = 24;     // seconds idle before dozing off
const GLANCE_RANGE = 220;   // how near the cursor has to be to be noticed
const EDGE_MARGIN = 24;

const rand = (a, b) => a + Math.random() * (b - a);

export class Creature {
  constructor(spec, sheets, opts = {}) {
    this.spec = spec;
    this.sheets = sheets;
    this.move = moveFor(spec.type);
    this.scale = opts.scale || 3;

    this.x = opts.x ?? 120;
    this.groundY = opts.groundY ?? 0;
    this.facing = 1;

    this.state = "IDLE";
    this.stateT = 0;
    this.nextDecision = rand(2, 5);

    this.animT = 0;
    this.blinkIn = rand(2, 6);
    this.blinking = 0;
    this.idleFor = 0;

    this.moveT = 0;
    this.cooldown = 0;
    this.pendingState = "IDLE";

    // Reset every frame and handed to the active move module.
    this.fx = this._blankFx();
    this.shake = 0;

    this._flashCanvas = null;
  }

  _blankFx() {
    return { alpha: 1, offsetX: 0, offsetY: 0, squashX: 1, squashY: 1, flash: 0, shake: 0 };
  }

  get width() {
    return this.sheets.idle.fw * this.scale;
  }
  get height() {
    return this.sheets.idle.fh * this.scale;
  }

  /** Bounding box in overlay CSS pixels — what the click-through test uses. */
  get bounds() {
    const w = this.width;
    const h = this.height;
    return {
      x: this.x + this.fx.offsetX - w / 2,
      y: this.groundY + this.fx.offsetY - h,
      w,
      h,
    };
  }

  contains(px, py) {
    const b = this.bounds;
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  /* ---------------- actions ---------------- */

  /** Fire the type's signature move. Returns false if busy or cooling down. */
  triggerMove() {
    if (this.state === "MOVE" || this.cooldown > 0) return false;
    this.pendingState = this.state === "SLEEP" ? "IDLE" : this.state;
    this.state = "MOVE";
    this.stateT = 0;
    this.moveT = 0;
    this.idleFor = 0;
    return true;
  }

  hop() {
    if (this.state === "MOVE" || this.state === "HOP") return false;
    this.pendingState = this.state === "SLEEP" ? "IDLE" : this.state;
    this.state = "HOP";
    this.stateT = 0;
    this.idleFor = 0;
    return true;
  }

  wake() {
    if (this.state === "SLEEP") {
      this.state = "IDLE";
      this.stateT = 0;
      this.idleFor = 0;
      this.nextDecision = rand(1, 3);
    }
  }

  /* ---------------- simulation ---------------- */

  update(dt, env) {
    this.fx = this._blankFx();
    if (this.cooldown > 0) this.cooldown -= dt;
    this.stateT += dt;
    this.animT += dt;

    if (this.state === "MOVE") {
      this._updateMove(dt, env);
    } else {
      this._updateBehaviour(dt, env);
    }

    this._updateBlink(dt);
    this.shake = this.fx.shake;
    this._clampToBounds(env);
  }

  _updateMove(dt, env) {
    this.moveT += dt;
    const t = Math.min(1, this.moveT / this.move.duration);

    const b = this.bounds;
    const api = {
      x: this.x,
      y: this.groundY,
      cx: this.x,
      cy: this.groundY - this.height / 2,
      w: this.width,
      h: this.height,
      facing: this.facing,
      palette: this.spec.palette,
      reduced: !!env.reduced,
      rnd: Math.random,
      fx: this.fx,
      emit: (o) => env.particles && env.particles.emit(o),
      burst: (n, fn) => env.particles && env.particles.burst(n, fn),
    };

    this.move.run(t, api);

    if (t >= 1) {
      this.state = this.pendingState === "MOVE" ? "IDLE" : this.pendingState;
      this.stateT = 0;
      // Short lockout so hammering the hotkey cannot stack effects (§9).
      this.cooldown = 0.6;
    }
  }

  _updateBehaviour(dt, env) {
    switch (this.state) {
      case "WALK": {
        if (!env.roaming) {
          this.state = "IDLE";
          this.stateT = 0;
          this.nextDecision = rand(2, 5);
          break;
        }
        this.x += this.facing * WALK_SPEED * dt;
        this.idleFor = 0;

        const min = EDGE_MARGIN + this.width / 2;
        const max = env.width - EDGE_MARGIN - this.width / 2;
        if ((this.facing > 0 && this.x >= max) || (this.facing < 0 && this.x <= min)) {
          this.x = Math.max(min, Math.min(max, this.x));
          this.state = "TURN";
          this.stateT = 0;
        } else if (this.stateT > this.nextDecision) {
          this.state = "IDLE";
          this.stateT = 0;
          this.nextDecision = rand(1.5, 4.5);
        }
        break;
      }

      case "TURN": {
        // A brief pause reads as deliberate rather than a snap flip.
        if (this.stateT >= TURN_TIME) {
          this.facing *= -1;
          this.state = env.roaming ? "WALK" : "IDLE";
          this.stateT = 0;
          this.nextDecision = rand(3, 8);
        }
        break;
      }

      case "HOP": {
        if (this.stateT >= HOP_TIME) {
          this.state = this.pendingState === "HOP" ? "IDLE" : this.pendingState;
          this.stateT = 0;
        } else {
          // Simple parabola, peaking mid-hop.
          const k = this.stateT / HOP_TIME;
          this.fx.offsetY = -Math.sin(k * Math.PI) * HOP_HEIGHT;
          this.fx.squashY = 1 + Math.sin(k * Math.PI) * 0.08;
        }
        break;
      }

      case "SLEEP": {
        // Slow breathing bob; anything interesting wakes it.
        this.fx.offsetY = Math.sin(this.stateT * 1.6) * 1.5;
        this.fx.squashY = 1 + Math.sin(this.stateT * 1.6) * 0.03;
        if (env.roaming && this.stateT > rand(6, 10) && Math.random() < dt * 0.15) this.wake();
        break;
      }

      default: {
        // IDLE
        this.idleFor += dt;
        if (this.idleFor > SLEEP_AFTER) {
          this.state = "SLEEP";
          this.stateT = 0;
          break;
        }
        // Glance towards the pointer if it comes close (§5, §11.1).
        if (env.cursor && Math.abs(env.cursor.x - this.x) < GLANCE_RANGE) {
          const want = env.cursor.x >= this.x ? 1 : -1;
          if (want !== this.facing && this.stateT > 0.4) {
            this.facing = want;
            this.stateT = 0;
          }
        }
        if (env.roaming && this.stateT > this.nextDecision) {
          this.state = "WALK";
          this.stateT = 0;
          this.nextDecision = rand(3, 8);
        }
      }
    }
  }

  _updateBlink(dt) {
    if (this.state === "SLEEP") return;
    if (this.blinking > 0) {
      this.blinking -= dt;
    } else {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinking = BLINK_TIME;
        this.blinkIn = rand(2.2, 7);
      }
    }
  }

  _clampToBounds(env) {
    if (!env.width) return;
    const half = this.width / 2;
    this.x = Math.max(half, Math.min(env.width - half, this.x));
  }

  /* ---------------- drawing ---------------- */

  _currentFrame() {
    switch (this.state) {
      case "MOVE": {
        const sheet = this.sheets.move;
        const k = Math.min(0.999, this.moveT / this.move.duration);
        return { sheet, frame: Math.floor(k * sheet.frames) };
      }
      case "WALK":
        return { sheet: this.sheets.walk, frame: Math.floor(this.animT / 0.18) };
      case "HOP":
        return { sheet: this.sheets.walk, frame: 1 };
      case "SLEEP":
        return { sheet: this.sheets.idle, frame: 1 };
      default:
        return { sheet: this.sheets.idle, frame: this.blinking > 0 ? 1 : 0 };
    }
  }

  draw(ctx) {
    const { sheet, frame } = this._currentFrame();
    const { fx } = this;
    const x = this.x + fx.offsetX;
    const y = this.groundY + fx.offsetY;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fx.alpha));

    // Squash and stretch anchored at the feet, so it never floats or sinks.
    if (fx.squashX !== 1 || fx.squashY !== 1) {
      ctx.translate(x, y);
      ctx.scale(fx.squashX, fx.squashY);
      ctx.translate(-x, -y);
    }

    if (fx.flash > 0) {
      ctx.drawImage(this._flashFrame(sheet, frame, fx.flash), Math.round(x - this.width / 2), Math.round(y - this.height));
    } else {
      drawFrame(ctx, sheet, frame, x, y, this.scale, this.facing < 0);
    }

    ctx.restore();
  }

  /**
   * A whitened copy of the current frame. Built on a scratch canvas with
   * source-atop so the flash respects the sprite's own transparency instead
   * of painting a rectangle over the screen.
   */
  _flashFrame(sheet, frame, amount) {
    const w = this.width;
    const h = this.height;
    if (!this._flashCanvas) {
      this._flashCanvas = document.createElement("canvas");
    }
    const c = this._flashCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const fctx = c.getContext("2d");
    fctx.clearRect(0, 0, w, h);
    fctx.imageSmoothingEnabled = false;
    drawFrame(fctx, sheet, frame, w / 2, h, this.scale, this.facing < 0);
    fctx.globalCompositeOperation = "source-atop";
    fctx.fillStyle = `rgba(255,255,255,${Math.min(1, amount)})`;
    fctx.fillRect(0, 0, w, h);
    fctx.globalCompositeOperation = "source-over";
    return c;
  }
}
