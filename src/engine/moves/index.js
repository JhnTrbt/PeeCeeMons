// index.js — the move registry (§6).
//
// One entry per type, mapping a creature's `type` to its signature move.
// To add a type: write the module, import it, add it to the table. Nothing
// else in the engine needs to change.

import fire from "./fire.js";
import water from "./water.js";
import grass from "./grass.js";
import electric from "./electric.js";
import ice from "./ice.js";
import rock from "./rock.js";
import psychic from "./psychic.js";
import shadow from "./shadow.js";
import dragon from "./dragon.js";
import normal from "./normal.js";

export const MOVES = {
  fire,
  water,
  grass,
  electric,
  ice,
  rock,
  psychic,
  shadow,
  dragon,
  normal,
};

/** The move for a type, falling back to Quick Dash for anything unknown. */
export function moveFor(type) {
  return MOVES[type] || normal;
}

export const TYPES = Object.keys(MOVES);
