// battle.js — the turn-based fight that unlocks new creatures.
//
// Pure logic: no canvas, no Tauri, no timers. The widget drives it by calling
// playerAttack() and reading `log` / `state`, which keeps the rules testable
// on their own and keeps the drawing code free of game maths.
//
// You cannot select a creature you have not found. You CAN fight it, and
// winning enough times earns it — that is the whole progression loop (§11.4).

let CHART = null;

export async function loadTypeChart() {
  if (CHART) return CHART;
  const res = await fetch("data/typechart.json");
  if (!res.ok) throw new Error(`typechart.json: HTTP ${res.status}`);
  CHART = await res.json();
  return CHART;
}

/** 2.0 super effective, 0.5 resisted, 1.0 otherwise. */
export function effectiveness(attackType, defenceType) {
  if (!CHART) return 1;
  const m = CHART.multipliers;
  const strongList = CHART.strong[attackType] || [];
  if (strongList.includes(defenceType)) return m.strong;
  // Resisted when the defender's own type beats the attacker's.
  const counter = CHART.strong[defenceType] || [];
  if (counter.includes(attackType)) return m.weak;
  return m.neutral;
}

export function effectivenessLabel(mult) {
  if (mult > 1) return "SUPER EFFECTIVE!";
  if (mult < 1) return "NOT VERY EFFECTIVE";
  return "";
}

/** What a type is strong and weak against — used by the widget's info panel. */
export function matchups(type) {
  if (!CHART) return { strong: [], weak: [] };
  return {
    strong: CHART.strong[type] || [],
    weak: Object.keys(CHART.strong).filter((t) => (CHART.strong[t] || []).includes(type)),
  };
}

/** Stable 0..1 value from a creature's seed — same mon, same roll, always. */
function hash01(n, salt) {
  let x = (n ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Rarity sets the band, the creature's own seed places it within that band.
 * So legendaries are always tougher than starters, but two starters are not
 * identical, and a given creature's stats never change between sessions.
 */
export function stats(spec) {
  const t = (CHART && CHART.tiers[spec.tier]) || { hp: 45, attack: 10 };
  return {
    hp: Math.round(t.hp * (0.85 + hash01(spec.seed, 0x9e37) * 0.3)),
    attack: Math.round(t.attack * (0.9 + hash01(spec.seed, 0x5f1d) * 0.25)),
  };
}

/**
 * How many wins this particular creature costs. Same idea as stats: rarity
 * picks the band (wilds 3-5, legendaries 7-10), the creature's seed fixes its
 * place inside it — so a legendary is always a slog, but no two are alike,
 * and a given creature's price never changes between sessions.
 */
export function winsNeeded(spec) {
  const t = (CHART && CHART.tiers[spec.tier]) || {};
  const [lo, hi] = t.wins || [3, 5];
  return lo + Math.floor(hash01(spec.seed, 0x2c17) * (hi - lo + 1));
}

export class Battle {
  constructor(playerSpec, foeSpec) {
    this.player = playerSpec;
    this.foe = foeSpec;

    const ps = stats(playerSpec);
    const fs = stats(foeSpec);
    this.playerMaxHp = ps.hp;
    this.foeMaxHp = fs.hp;
    this.playerHp = ps.hp;
    this.foeHp = fs.hp;
    this.playerAtk = ps.attack;
    this.foeAtk = fs.attack;

    this.state = "READY";   // READY | PLAYER | FOE | WON | LOST | FLED
    this.log = `A WILD ${foeSpec.name.toUpperCase()} APPEARED!`;
    this.turn = 0;
    // Set by the widget to animate whoever is currently swinging.
    this.attacker = null;
    this.lastMultiplier = 1;
    this.lastDamage = 0;
    this.lastMissed = false;

    // Active status effects, or null. Shape comes from typechart.json plus a
    // `turns` counter that ticks down on the afflicted creature's own turn.
    this.playerStatus = null;
    this.foeStatus = null;
  }

  statusOf(side) {
    return side === "player" ? this.playerStatus : this.foeStatus;
  }

  /** Try to inflict the attacker's type status on the defender. */
  _tryInflict(attackType, defenderSide) {
    if (!CHART) return null;
    const def = CHART.status[attackType];
    if (!def) return null;                             // Normal inflicts nothing
    if (this.statusOf(defenderSide)) return null;      // one at a time
    if (Math.random() > (CHART.battle?.statusChance ?? 0.22)) return null;

    const applied = { ...def, turns: def.turns };
    if (defenderSide === "player") this.playerStatus = applied;
    else this.foeStatus = applied;
    return applied;
  }

  /**
   * End-of-turn tick for whoever just acted: burn/curse damage, seeded drain,
   * and counting the status down. Returns a message, or "".
   */
  _tickStatus(side) {
    const st = this.statusOf(side);
    if (!st) return "";
    let msg = "";

    if (st.dot) {
      const who = side === "player" ? "player" : "foe";
      if (who === "player") this.playerHp = Math.max(0, this.playerHp - st.dot);
      else this.foeHp = Math.max(0, this.foeHp - st.dot);

      if (st.drain) {
        // Seeded feeds the other side.
        if (who === "player") this.foeHp = Math.min(this.foeMaxHp, this.foeHp + st.dot);
        else this.playerHp = Math.min(this.playerMaxHp, this.playerHp + st.dot);
      }
      const name = (side === "player" ? this.player.name : this.foe.name).toUpperCase();
      msg = `${name} TAKES ${st.dot} FROM ${st.label}`;
    }

    st.turns -= 1;
    if (st.turns <= 0) {
      if (side === "player") this.playerStatus = null;
      else this.foeStatus = null;
      const name = (side === "player" ? this.player.name : this.foe.name).toUpperCase();
      if (!msg) msg = `${name} SHOOK OFF ${st.label}`;
    }

    // A status can be the thing that finishes a fight.
    if (this.playerHp <= 0) { this.state = "LOST"; msg = `${this.player.name.toUpperCase()} FAINTED...`; }
    else if (this.foeHp <= 0) { this.state = "WON"; msg = `${this.foe.name.toUpperCase()} FAINTED!`; }
    return msg;
  }

  get over() {
    return this.state === "WON" || this.state === "LOST" || this.state === "FLED";
  }

  _damage(atk, attackType, defenceType, attackerSide) {
    const mult = effectiveness(attackType, defenceType);
    const roll = 0.85 + Math.random() * 0.3;
    // A status that saps attack applies here, not at the point it was inflicted.
    const st = this.statusOf(attackerSide);
    const sap = st && st.atkMul ? st.atkMul : 1;
    return { dmg: Math.max(1, Math.round(atk * mult * roll * sap)), mult };
  }

  /**
   * One creature's turn. Shared by both sides so a miss, a skipped turn and
   * a status tick behave identically whoever is swinging.
   */
  _takeTurn(side) {
    const isPlayer = side === "player";
    const me = isPlayer ? this.player : this.foe;
    const them = isPlayer ? this.foe : this.player;
    const otherSide = isPlayer ? "foe" : "player";

    this.attacker = side;
    this.lastMissed = false;
    this.lastDamage = 0;

    const myStatus = this.statusOf(side);
    let msg;

    // Paralysis / confusion can cost the turn outright.
    if (myStatus && myStatus.skipChance && Math.random() < myStatus.skipChance) {
      this.lastMissed = true;
      msg = `${me.name.toUpperCase()} IS ${myStatus.label}!`;
    } else if (Math.random() < (CHART?.battle?.missChance ?? 0.1)) {
      this.lastMissed = true;
      this.lastMultiplier = 1;
      msg = `${me.name.toUpperCase()} MISSED!`;
    } else {
      const { dmg, mult } = this._damage(
        isPlayer ? this.playerAtk : this.foeAtk, me.type, them.type, side
      );
      if (isPlayer) this.foeHp = Math.max(0, this.foeHp - dmg);
      else this.playerHp = Math.max(0, this.playerHp - dmg);

      this.lastMultiplier = mult;
      this.lastDamage = dmg;

      const inflicted = (isPlayer ? this.foeHp : this.playerHp) > 0
        ? this._tryInflict(me.type, otherSide)
        : null;

      msg = inflicted
        ? `${them.name.toUpperCase()} IS ${inflicted.label}!`
        : effectivenessLabel(mult) || `${me.name.toUpperCase()} HITS FOR ${dmg}`;
    }

    // Did that finish it?
    if (this.foeHp <= 0) {
      this.state = "WON";
      this.log = `${this.foe.name.toUpperCase()} FAINTED!`;
      return this.log;
    }
    if (this.playerHp <= 0) {
      this.state = "LOST";
      this.log = `${this.player.name.toUpperCase()} FAINTED...`;
      return this.log;
    }

    // Burn, curse and seeded bite at the end of the afflicted one's turn.
    const tick = this._tickStatus(side);
    if (this.over) {
      this.log = tick;
      return this.log;
    }

    this.state = isPlayer ? "FOE" : "READY";
    this.log = tick || msg;
    return this.log;
  }

  /** Player swings. Returns the message to show. */
  playerAttack() {
    if (this.over || this.state === "FOE") return this.log;
    this.turn++;
    return this._takeTurn("player");
  }

  /** The opponent's reply. The widget calls this on a short delay. */
  foeAttack() {
    if (this.over || this.state !== "FOE") return this.log;
    return this._takeTurn("foe");
  }

  flee() {
    if (this.over) return;
    this.state = "FLED";
    this.log = "GOT AWAY SAFELY";
  }
}

/** Wins needed with a creature before it evolves. */
export function evolveAt() {
  return (CHART && CHART.battle && CHART.battle.evolveAt) || 10;
}

/** Pick someone still locked to fight. Null when the roster is complete. */
export function randomOpponent(roster, unlocked) {
  const locked = roster.filter((c) => !unlocked.includes(c.name));
  if (!locked.length) return null;
  return locked[Math.floor(Math.random() * locked.length)];
}
