import fleetValues from '../data/fleetValues.json'
import type { ShipForm } from './types'

/**
 * The balanced point scale: what a hull is *worth in battle*, measured.
 *
 * The printed Master Ship List prices a ship by what it is made of, and that
 * curve turned out steeply convex — a point spent on frigates buys roughly
 * three times the boxes and twice the guns that the same point buys on a
 * dreadnought, before the swarm's structural advantages (more volleys per
 * phase, more shield facings, losing firepower a slice at a time) are even
 * counted. Roughly four thousand AI-versus-AI battles measured the result:
 * at equal printed points the bigger-count fleet wins 93% of games at two-
 * to-one hulls and 97% beyond four-to-one, and a 158-point dreadnought's
 * break-even against a cruiser swarm is about 97 points of cruisers.
 *
 * `src/data/fleetValues.json` carries the measured scale for every printed
 * hull: titrated break-even worth where a hull was measured directly, the
 * fitted curve — value = 2.04 x printed^0.745, anchored so the YORKTOWN I
 * keeps its 23 — everywhere else. Validated by re-running the equal-points
 * matchups at these prices: the swarm's edge collapses from near-certainty
 * to about 60/40, and the same scale predicts one-on-one duels slightly
 * better than the printed list does (rank correlation 0.90 vs 0.87).
 *
 * The printed values stay the default and stay authoritative — this scale
 * is an opt-in the fleet picker offers, and the setup records the choice so
 * saves, replays and remote peers rebuild the same battle.
 */

/** The fitted curve, for hulls the sweeps never measured (fan designs). */
const CURVE_SCALE = 2.04
const CURVE_EXPONENT = 0.745
/** Anchored so the YORKTOWN I — the game's yardstick hull — keeps its price. */
const ANCHOR_PRINTED = 23
const NORM = ANCHOR_PRINTED / (CURVE_SCALE * ANCHOR_PRINTED ** CURVE_EXPONENT)

const MEASURED = fleetValues as Record<string, number>

/** A form's balanced point value: measured where known, the curve otherwise. */
export function balancedPointValue(form: ShipForm): number {
  const measured = MEASURED[form.id]
  if (measured !== undefined) return measured
  const printed = form.pointValue
  if (!(printed > 0)) return printed
  return Math.round(NORM * CURVE_SCALE * printed ** CURVE_EXPONENT * 10) / 10
}
