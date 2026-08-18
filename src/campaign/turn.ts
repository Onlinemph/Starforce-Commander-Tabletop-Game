/**
 * The phase resolver (design doc 0.3.2, Part 5).
 *
 * `resolvePhase(ctx, state, move)` is the campaign's only state transition —
 * pure in the same sense the tactical engine's `applyAction` is: it returns a
 * new state, consults no clock, and draws all randomness from the seeded
 * stream carried in the state. A campaign replays by folding the journal over
 * the initial state, and the replay test holds that fold equal to the stored
 * cache forever.
 *
 * Everything a player may do arrives here as an intervention, and everything
 * an intervention may not do is refused HERE, not in a UI: both consoles and
 * any future campaign AI run this same resolver, so an order the rules
 * forbid — cloaking a hull with no cloak, steering by a contact the side does
 * not hold, ordering the other side's ships — fails identically for everyone.
 */

import {
  contactCollapsed,
  decayContacts,
  reckonedHex,
  runDetection,
  unitProfile,
  type DetectionContext,
} from './detection'
import { checkEngagements } from './engagement'
import { entryCost, hexDistance, hexEquals, hexNeighbors, hexStepToward, inBounds, terrainAt } from './hexmap'
import { repairTick } from './logistics'
import {
  DEFAULT_REPAIR_QUEUE,
  sideToMove,
  type BattleRecord,
  type CampaignState,
  type Hex,
  type Intervention,
  type PhaseMove,
  type Side,
  type StandingOrder,
  type Unit,
} from './types'

export type { DetectionContext } from './detection'

export class PhaseError extends Error {}

/**
 * Why a standing order is illegal for this unit, or null. One validator for
 * every path an order can arrive by — scenario setup, intervention, future
 * AI — because a rule enforced in one door and not another is a leak.
 */
export function orderRefusal(state: CampaignState, unit: Unit, order: StandingOrder): string | null {
  if (order.cloaked && !unitProfile(unit).cloakCapable) {
    return `${unit.id} cannot cloak — not every hull aboard carries a cloak.`
  }
  if (order.mission) {
    const contact = state.contacts.find(
      (c) => c.id === order.mission!.contactId && c.side === unit.side,
    )
    if (!contact) {
      return `${unit.id}: no such contact ${order.mission.contactId} — missions steer by what this side has seen.`
    }
  }
  if (order.repairPriority) {
    for (const category of order.repairPriority) {
      if (!DEFAULT_REPAIR_QUEUE.includes(category)) {
        return `${unit.id}: unknown repair category ${String(category)}.`
      }
    }
  }
  return null
}

function applyIntervention(state: CampaignState, intervention: Intervention, side: string): void {
  const unit = state.units.find((u) => u.id === intervention.unitId)
  if (!unit) throw new PhaseError(`No such unit: ${intervention.unitId}`)
  if (unit.side !== side) throw new PhaseError(`${unit.id} is not ${side}'s unit to order.`)
  switch (intervention.type) {
    case 'set-order': {
      const order = structuredClone(intervention.order)
      const refusal = orderRefusal(state, unit, order)
      if (refusal) throw new PhaseError(refusal)
      unit.order = order
      break
    }
    case 'set-waypoints':
      unit.order = { ...unit.order, waypoints: structuredClone(intervention.waypoints) }
      break
    case 'set-repair-priority': {
      const order = { ...unit.order, repairPriority: structuredClone(intervention.queue) }
      const refusal = orderRefusal(state, unit, order)
      if (refusal) throw new PhaseError(refusal)
      unit.order = order
      break
    }
  }
}

/**
 * Land a battle's result (7.4): scars onto ship records, the dead off the
 * board, the ledger paid, and disengagers separated a hex toward home so a
 * withdrawal actually ends the fight. Contacts shadowing a unit that no
 * longer exists are dropped — a dossier on a cloud of debris is a marker the
 * battle itself replaced.
 */
function applyBattleResult(state: CampaignState, record: BattleRecord): void {
  const pendingIndex = state.pendingBattles.findIndex((p) => p.id === record.engagementId)
  if (pendingIndex === -1) throw new PhaseError(`No pending battle ${record.engagementId}.`)
  state.pendingBattles.splice(pendingIndex, 1)

  const retreatDir: Record<Side, number> = { A: -1, B: 1 }
  for (const [key, outcome] of Object.entries(record.result.ships)) {
    const [unitId, shipId] = key.split('/')
    const unit = state.units.find((u) => u.id === unitId)
    if (!unit) throw new PhaseError(`Battle result names unknown unit ${unitId}.`)
    const ship = unit.ships.find((s) => s.id === shipId)
    if (!ship) throw new PhaseError(`Battle result names unknown ship ${key}.`)
    if (outcome.destroyed) {
      unit.ships = unit.ships.filter((s) => s.id !== shipId)
    } else if (outcome.scars) {
      ship.scars = structuredClone(outcome.scars)
    } else {
      delete ship.scars
    }
    if (!outcome.destroyed && outcome.disengaged) {
      const step = { q: unit.hex.q + retreatDir[unit.side], r: unit.hex.r }
      if (hexEquals(unit.hex, step) === false) unit.hex = step
    }
  }
  const dead = state.units.filter((u) => u.ships.length === 0).map((u) => u.id)
  state.units = state.units.filter((u) => u.ships.length > 0)
  state.contacts = state.contacts.filter((c) => !dead.includes(c.targetUnitId))
  state.vp.A += record.result.vp.A
  state.vp.B += record.result.vp.B
}

/**
 * Where this unit is trying to go right now: its mission's contact, reckoned
 * from what its side knows (never from truth — that indirection is the
 * anti-leak guarantee, see StandingOrder.mission), or its next waypoint.
 */
function currentDestination(state: CampaignState, unit: Unit): Hex | null {
  const mission = unit.order.mission
  if (mission) {
    const contact = state.contacts.find((c) => c.id === mission.contactId && c.side === unit.side)
    if (!contact || contactCollapsed(contact)) return null // hold until told otherwise
    const believed = reckonedHex(contact, state)
    if (mission.type === 'intercept') return believed
    // Shadow (5.3): keep the trail at distance three to four.
    const range = hexDistance(unit.hex, believed)
    if (range > 4) return believed
    if (range < 3) {
      // Open the range: step to the neighbor that increases distance most.
      let best: Hex | null = null
      let bestDist = range
      for (const n of [unit.hex, ...hexNeighbors(unit.hex)]) {
        const d = hexDistance(n, believed)
        if (d > bestDist) {
          best = n
          bestDist = d
        }
      }
      return best
    }
    return null // in the pocket: hold and listen
  }
  while (unit.order.waypoints.length > 0 && hexEquals(unit.order.waypoints[0], unit.hex)) {
    unit.order.waypoints.shift()
  }
  return unit.order.waypoints[0] ?? null
}

/**
 * One unit's auto-step (5.2): a hex toward its destination, unless holding or
 * paying off slow terrain. `movedLastOwnPhase` and `course` are recorded here
 * because the detection bands and dead-reckoning read them (4.3, 4.4).
 */
function stepUnit(ctx: DetectionContext, state: CampaignState, unit: Unit): void {
  if (unit.order.speed === 'hold') {
    unit.movedLastOwnPhase = false
    unit.course = null
    return
  }
  if (unit.moveDebt > 0) {
    unit.moveDebt -= 1
    unit.movedLastOwnPhase = true // the drive is hot mid-transit
    return
  }
  const target = currentDestination(state, unit)
  if (!target) {
    unit.movedLastOwnPhase = false
    unit.course = null
    return
  }
  const next = hexStepToward(unit.hex, target)
  // The map edge is a wall, not a suggestion: a waypoint (or a reckoned
  // contact position) beyond it holds the unit at the border rather than
  // walking it off the board.
  if (hexEquals(next, unit.hex) || !inBounds(next, ctx.map.width, ctx.map.height)) {
    unit.movedLastOwnPhase = false
    unit.course = null
    return
  }
  unit.course = { q: next.q - unit.hex.q, r: next.r - unit.hex.r }
  unit.hex = next
  unit.movedLastOwnPhase = true
  // Nebula and dust cost two phases per hex (2.2): the second is owed.
  unit.moveDebt = entryCost(terrainAt(ctx.map, next)) - 1
}

/**
 * Resolve one side's phase: interventions first (they are the journal entry),
 * then that side's auto-steps, then EVERYONE's passive scans (4.1) — twelve
 * detection sweeps a round is the design's heartbeat. Phase 12 additionally
 * runs the round tick (5.1).
 */
export function resolvePhase(ctx: DetectionContext, state: CampaignState, move: PhaseMove): CampaignState {
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

  /*
   * Battles first (7.4): a campaign with a battle on the table is a campaign
   * holding its breath. Every pending engagement must come back resolved on
   * this move — from the played battle, the headless one, or the physical
   * table's hand entry — before anyone moves a counter.
   */
  for (const record of move.battles ?? []) applyBattleResult(next, record)
  if (next.pendingBattles.length > 0) {
    throw new PhaseError(
      `Battles unresolved: ${next.pendingBattles.map((p) => p.id).join(', ')} — fight them before moving.`,
    )
  }

  for (const intervention of move.interventions) applyIntervention(next, intervention, move.side)
  for (const unit of next.units) {
    if (unit.side === move.side) stepUnit(ctx, next, unit)
  }

  runDetection(ctx, next)
  checkEngagements(ctx, next)

  if (next.phase === 12) {
    // The round tick (5.1): decay, then the repair crews. Endurance, rearm,
    // convoys and reinforcements land in build Phase 4.
    decayContacts(next)
    repairTick(next)
    next.phase = 1
    next.round += 1
    if (next.round > next.roundLimit) next.finished = true
  } else {
    next.phase += 1
  }
  return next
}
