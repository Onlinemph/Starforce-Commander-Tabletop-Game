/**
 * Stations with hulls (the designer's Expansion 6 stations meeting the
 * campaign's abstract infrastructure).
 *
 * Campaign infrastructure began as a hex with a repair budget. A station
 * that names a `formId` is also a COMBATANT: on the table it is one ship at
 * speed 0 — the BASTION's guns, the SENTINEL's torpedo tubes, a GUARDIAN
 * satellite's free-running phaser — and it rides the engagement, handoff and
 * readback machinery as a one-ship unit that never moves. This module is
 * the translation: a station as a `Unit` for the code that fights, and the
 * bookkeeping that keeps its damage on the infrastructure record between
 * battles, box for box, exactly as a ship's scars.
 */

import { hexEquals } from './hexmap'
import type { CampaignState, Hex, Infrastructure, PendingEngagement, Side, Unit } from './types'

/** A station that fights: it has a hull and it is still standing. */
export function isHullStation(station: Infrastructure): boolean {
  return Boolean(station.formId) && !station.destroyed
}

/** The station's one ship record id — the readback key is `station.id/this`. */
export function stationShipId(station: Infrastructure): string {
  return `${station.id}-s1`
}

/**
 * The station as the fighting code sees it: a one-ship unit holding its
 * hex, postured to fight (a station cannot withdraw and never hides), with
 * the infrastructure's scars aboard. Derived on demand, never stored — the
 * infrastructure record stays the truth.
 */
export function stationUnit(station: Infrastructure): Unit {
  const label = station.kind.replace('-', ' ')
  return {
    id: station.id,
    side: station.side,
    kind: 'ship',
    ships: [
      {
        id: stationShipId(station),
        formId: station.formId!,
        name: `${label} ${station.id}`,
        ...(station.scars ? { scars: structuredClone(station.scars) } : {}),
      },
    ],
    hex: { ...station.hex },
    order: {
      waypoints: [],
      speed: 'hold',
      sensorPower: 1,
      cloaked: false,
      formation: 'standard',
      engagement: 'fight',
    },
    moveDebt: 0,
    endurance: 1,
    enduranceMax: 1,
    cloakedThisRound: false,
    movedLastOwnPhase: false,
    course: null,
  }
}

/** Hull stations standing on a hex. */
export function hullStationsAt(state: CampaignState, hex: Hex): Infrastructure[] {
  return state.infrastructure.filter((i) => isHullStation(i) && hexEquals(i.hex, hex))
}

/**
 * Everything one side brings to an engagement, in engagement order: its
 * units, and any hull station named among the ids. The station comes in
 * as a unit so handoff and readback need no second path; the id is the
 * infrastructure's, so a result keyed `station/station-s1` finds its way
 * home (turn.ts applyBattleResult).
 */
export function combatants(state: CampaignState, engagement: PendingEngagement, side: Side): Unit[] {
  const out: Unit[] = []
  for (const id of engagement.unitIds[side]) {
    const unit = state.units.find((u) => u.id === id)
    if (unit) {
      out.push(unit)
      continue
    }
    const station = state.infrastructure.find((i) => i.id === id && i.formId)
    if (station) out.push(stationUnit(station))
  }
  return out
}
