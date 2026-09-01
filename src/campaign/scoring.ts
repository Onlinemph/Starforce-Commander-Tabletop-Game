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

import { logSensor } from './detection'
import { hexDistance, hexEquals } from './hexmap'
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
    // The hunter's log explains the vanished marker without telling it more
    // than the empty scope already would: the trail simply ends.
    for (const c of state.contacts) {
      if (!delivered.includes(c.targetUnitId)) continue
      logSensor(state, c.side, c.id, c.estimatedHex, 'Contact departed — the trail ends.')
    }
    state.contacts = state.contacts.filter((c) => !delivered.includes(c.targetUnitId))
  }
}

/**
 * Raid and Assault land at the round tick (the designer's orders list, priced
 * by the 3.4 table below): a unit whose mission has brought it ONTO a known
 * enemy station's hex strikes — unless a defender stands within a hex, in
 * which case the strike is called off and the mission ends (a raid under the
 * guns is a battle, and the engagement rules already provide those). A raid
 * is a hit-and-run for half the station's value, rounded up, leaving it
 * standing; an assault destroys the station for full value. Either way the
 * mission clears — a second strike is a second order. Public news both ways,
 * exactly like the pirates the mechanic mirrors.
 */
export function raidTick(state: CampaignState): void {
  for (const unit of state.units) {
    const mission = unit.order.mission
    if (!mission || (mission.type !== 'raid' && mission.type !== 'assault')) continue
    const station = state.infrastructure.find((i) => i.id === mission.stationId)
    if (!station || station.destroyed || station.side === unit.side) {
      delete unit.order.mission // the objective is gone (or was never legal)
      continue
    }
    if (!hexEquals(unit.hex, station.hex)) continue // still inbound
    const kind = station.kind.replace('-', ' ')
    const at = `${station.hex.q},${station.hex.r}`
    const defended = state.units.some(
      (u) => u.side === station.side && hexDistance(u.hex, station.hex) <= 1,
    )
    delete unit.order.mission
    if (defended) {
      pushEvent(state, station.side, station.hex, `Strike on the ${kind} at ${at} called off — defenders on station.`)
      continue
    }
    const value = INFRASTRUCTURE_VP[station.kind] ?? 2
    if (mission.type === 'raid') {
      const vp = Math.ceil(value / 2)
      state.vp[unit.side] += vp
      pushEvent(state, station.side, station.hex, `The ${kind} at ${at} raided — Commander ${unit.side} gains ${vp} VP.`)
    } else {
      station.destroyed = true
      state.vp[unit.side] += value
      pushEvent(state, station.side, station.hex, `The ${kind} at ${at} destroyed by assault — Commander ${unit.side} gains ${value} VP.`)
    }
  }
}

/** The events feed stays a feed, not an archive (pirates.ts uses the same cap). */
const EVENT_CAP = 60

/** One line of public news (types.ts CampaignEvent), capped. */
export function pushEvent(state: CampaignState, side: Side, hex: { q: number; r: number }, text: string): void {
  state.events.push({ round: state.round, side, hex: { ...hex }, text })
  if (state.events.length > EVENT_CAP) state.events.splice(0, state.events.length - EVENT_CAP)
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
