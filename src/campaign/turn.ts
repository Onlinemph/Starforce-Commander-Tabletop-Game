/**
 * The phase resolver (design doc 0.3.2, Part 5).
 *
 * `resolvePhase(map, state, move)` is the campaign's only state transition —
 * pure in the same sense the tactical engine's `applyAction` is: it returns a
 * new state, consults no clock, and draws all randomness from the seeded
 * stream carried in the state. A campaign replays by folding the journal over
 * the initial state, and the replay test holds that fold equal to the stored
 * cache forever.
 *
 * Phase 1 of the build resolves movement mechanics only as far as the journal
 * needs them — interventions, the waypoint auto-step, terrain move debt, the
 * twelve-phase clock and the round tick. Detection (Part 4) and engagements
 * (Part 7) land in later phases and slot in after the movement block here.
 */

import { entryCost, hexEquals, hexStepToward, terrainAt } from './hexmap'
import {
  sideToMove,
  type CampaignMap,
  type CampaignState,
  type Intervention,
  type PhaseMove,
  type Unit,
} from './types'

export class PhaseError extends Error {}

function applyIntervention(state: CampaignState, intervention: Intervention, side: string): void {
  const unit = state.units.find((u) => u.id === intervention.unitId)
  if (!unit) throw new PhaseError(`No such unit: ${intervention.unitId}`)
  if (unit.side !== side) throw new PhaseError(`${unit.id} is not ${side}'s unit to order.`)
  switch (intervention.type) {
    case 'set-order':
      unit.order = structuredClone(intervention.order)
      break
    case 'set-waypoints':
      unit.order = { ...unit.order, waypoints: structuredClone(intervention.waypoints) }
      break
  }
}

/**
 * One unit's auto-step (5.2): a hex toward the next waypoint, unless holding,
 * out of path, or paying off slow terrain. Waypoints reached are consumed.
 * Deterministic throughout — the step choice's tie-break lives in hexmap.
 */
function stepUnit(map: CampaignMap, unit: Unit): void {
  if (unit.order.speed === 'hold') return
  if (unit.moveDebt > 0) {
    unit.moveDebt -= 1
    return
  }
  while (unit.order.waypoints.length > 0 && hexEquals(unit.order.waypoints[0], unit.hex)) {
    unit.order.waypoints.shift()
  }
  const target = unit.order.waypoints[0]
  if (!target) return
  const next = hexStepToward(unit.hex, target)
  if (hexEquals(next, unit.hex)) return
  unit.hex = next
  // Nebula and dust cost two phases per hex (2.2): the second is owed.
  unit.moveDebt = entryCost(terrainAt(map, next)) - 1
}

/**
 * Resolve one side's phase: interventions first (they are the journal entry),
 * then that side's auto-steps, then — in build Phase 2 — everyone's passive
 * scans. Phase 12 additionally runs the round tick (5.1).
 */
export function resolvePhase(map: CampaignMap, state: CampaignState, move: PhaseMove): CampaignState {
  if (state.finished) throw new PhaseError('The campaign is over.')
  if (move.round !== state.round || move.phase !== state.phase) {
    throw new PhaseError(
      `Expected round ${state.round} phase ${state.phase}, got round ${move.round} phase ${move.phase}.`,
    )
  }
  const mover = sideToMove(state.phase)
  if (move.side !== mover) {
    throw new PhaseError(`Phase ${state.phase} is ${mover}'s to move, not ${move.side}'s.`)
  }

  const next = structuredClone(state)
  for (const intervention of move.interventions) applyIntervention(next, intervention, move.side)
  for (const unit of next.units) {
    if (unit.side === move.side) stepUnit(map, unit)
  }

  // Detection sweeps (4.1) run here for BOTH sides every phase — Phase 2.

  if (next.phase === 12) {
    // The round tick (5.1): endurance, repair queues, rearm, convoys,
    // reinforcements, VP — build Phases 3–4. The clock alone turns for now.
    next.phase = 1
    next.round += 1
    // Scoring picks the winner in build Phase 4; the clock already knows
    // when to stop, and a finished campaign refuses further moves.
    if (next.round > next.roundLimit) next.finished = true
  } else {
    next.phase += 1
  }
  return next
}
