/**
 * Victory and the campaign's end (design doc 10.1).
 *
 * The ledger accumulates from three places: battle readback (S2.8.4 through
 * the tactical engine — dead ships concede everything, departed ones their
 * damage level, exactly as the tabletop already scores), convoys delivered
 * (here), and infrastructure destroyed (3.4's table, when infrastructure
 * assault lands). The campaign ends at the round limit or, if the scenario
 * names one, the moment a ledger crosses the threshold.
 */

import { hexEquals } from './hexmap'
import type { CampaignScenario, CampaignState, Side } from './types'

/**
 * Convoy deliveries at the round tick (6.3, 10.1): a convoy standing on its
 * delivery hex has arrived — it leaves the map and its side banks the points.
 * The dossiers shadowing it collapse with it; the freighters are gone.
 */
export function deliveryTick(scenario: CampaignScenario, state: CampaignState): void {
  const delivered: string[] = []
  for (const unit of state.units) {
    if (unit.kind !== 'convoy') continue
    const spec = scenario.forces[unit.side].find((f) => f.id === unit.id)
    if (!spec?.deliverHex) continue
    if (!hexEquals(unit.hex, spec.deliverHex)) continue
    state.vp[unit.side] += spec.deliveryVp ?? 5
    delivered.push(unit.id)
  }
  if (delivered.length > 0) {
    state.units = state.units.filter((u) => !delivered.includes(u.id))
    state.contacts = state.contacts.filter((c) => !delivered.includes(c.targetUnitId))
  }
}

/**
 * Is it over, and who won? Round limit or threshold; the higher ledger takes
 * it, level ledgers draw. Called by the round tick after every other pass has
 * had its say, so a delivery on the final round still counts.
 */
export function settleWinner(scenario: CampaignScenario, state: CampaignState): void {
  const threshold = scenario.vpThreshold
  const crossed =
    threshold !== undefined && (state.vp.A >= threshold || state.vp.B >= threshold)
  if (!state.finished && !crossed) return
  state.finished = true
  state.winner = state.vp.A > state.vp.B ? 'A' : state.vp.B > state.vp.A ? 'B' : 'draw'
}

/** The 3.4 table, for when infrastructure can be attacked. */
export const INFRASTRUCTURE_VP: Record<string, number> = {
  'fleet-base': 8,
  colony: 5,
  outpost: 3,
  'listening-post': 2,
  'jump-beacon': 1,
}

export type { Side }
