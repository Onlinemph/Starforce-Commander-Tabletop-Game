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
 *
 * SCOPE: this is a BASE-GAME scale. Every game behind it was played under the
 * base firing sequence (H2.4), and the optional Coordinated Fire rules change
 * the answer, because H4.3.1 bars a faction from attacking the same hull twice
 * in a combat phase — which is to say it bars massed fire, which is the whole
 * of what numbers buy. Measured over the same panel at printed prices, the
 * swarm's win rate falls from 80.6% to 60.9% with H4 switched on (340 games
 * each, z = 5.6); at two-to-one hulls, from 88% to 62%. That is close to what
 * this scale achieves at base-game rules, so a table playing H4 with printed
 * points is already near where a table playing the base game with these points
 * lands — and using both together would over-correct at moderate mismatches.
 *
 * H4 is not a substitute at the extremes, though. Titrated break-even worth
 * with H4 on rises only 8-37% per hull (median +22%): a UNION III measures 105
 * where it measures 95 in the base game, against a printed 158.5. The rule
 * moderates fights near parity; it does not make a dreadnought worth its price
 * against a swarm five times its number.
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
  /**
   * A hangar means part of the price is a fighter wing, and a wing is
   * already a swarm — it is owed none of the concentration discount the
   * curve applies to gunships. An unmeasured carrier therefore keeps its
   * printed price; the ARK ROYAL, titrated directly, carries its own entry
   * (61 — the wing that fights dead even with a lone heavy cruiser melts
   * against the massed point defense of a cruiser screen, and both formats
   * land on the same worth).
   */
  if (form.systems.some((group) => group.kind === 'HNGR' && group.boxes > 0)) {
    return printed
  }
  return Math.round(NORM * CURVE_SCALE * printed ** CURVE_EXPONENT * 10) / 10
}
