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
  unitIsCloaked,
  unitProfile,
  type DetectionContext,
} from './detection'
import { resolveSensorModel } from './sensorModel'
import { checkEngagements } from './engagement'
import { entryCost, hexDistance, hexEquals, hexNeighbors, hexStepToward, inBounds, terrainAt } from './hexmap'
import { effectiveSpeedTier, enduranceTick, orderedSpeed, repairTick, wingTick } from './logistics'
import { hexesThisPhase, ROUND_PHASES } from './schedule'
import { shipFormById } from '../data/ships'
import type { ShipScars } from '../engine/shipState'
import { deliveryTick, settleWinner } from './scoring'
import {
  DEFAULT_REPAIR_QUEUE,
  nextInt,
  nextRandom,
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
export function orderRefusal(_state: CampaignState, unit: Unit, order: StandingOrder): string | null {
  if (order.cloaked && !unitProfile(unit).cloakCapable) {
    return `${unit.id} cannot cloak — not every hull aboard carries a cloak.`
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

/**
 * A mission may only steer by a contact its side holds. A mission whose
 * contact does not exist — mistyped, another side's id, or erased by a battle
 * result applied in this same move — is CLEARED rather than refused: the
 * order stands and falls back to its waypoints. Refusing used to bounce the
 * whole move, and the timing case is unavoidable — orders are staged before
 * battle results land, so a hunter whose quarry just died would crash the
 * campaign, human and solo alike. No information rides on the difference:
 * a foreign or bogus contact id steers nothing either way.
 */
function sanitizeMission(state: CampaignState, unit: Unit, order: StandingOrder): void {
  if (!order.mission) return
  const held = state.contacts.some(
    (c) => c.id === order.mission!.contactId && c.side === unit.side,
  )
  if (!held) delete order.mission
}

function applyIntervention(state: CampaignState, intervention: Intervention, side: string): void {
  const unit = state.units.find((u) => u.id === intervention.unitId)
  /*
   * Orders to the dead are dropped, not refused: a move's interventions are
   * staged before its battle results land, so a unit lost in this very
   * move's battle can legitimately still be named — by a human's console and
   * the solo doctrine alike. The ownership gate below still refuses orders
   * to a LIVING unit of the other side, which is the case that matters.
   */
  if (!unit) return
  if (unit.side !== side) throw new PhaseError(`${unit.id} is not ${side}'s unit to order.`)
  switch (intervention.type) {
    case 'set-order': {
      const order = structuredClone(intervention.order)
      const refusal = orderRefusal(state, unit, order)
      if (refusal) throw new PhaseError(refusal)
      sanitizeMission(state, unit, order)
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
function applyBattleResult(ctx: DetectionContext, state: CampaignState, record: BattleRecord): void {
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
    } else {
      if (outcome.scars) ship.scars = structuredClone(outcome.scars)
      else delete ship.scars
      if (outcome.wing) ship.wing = structuredClone(outcome.wing)
    }
    if (!outcome.destroyed && outcome.disengaged) {
      // A hex toward home — unless home is off the chart: the map edge walls
      // retreats exactly as it walls ordinary movement.
      const step = { q: unit.hex.q + retreatDir[unit.side], r: unit.hex.r }
      if (!hexEquals(unit.hex, step) && inBounds(step, ctx.map.width, ctx.map.height)) unit.hex = step
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
function currentDestination(ctx: DetectionContext, state: CampaignState, unit: Unit): Hex | null {
  const mission = unit.order.mission
  if (mission) {
    const contact = state.contacts.find((c) => c.id === mission.contactId && c.side === unit.side)
    if (!contact || contactCollapsed(contact)) return null // hold until told otherwise
    const believed = reckonedHex(ctx.map, contact, state)
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
 * One unit's auto-movement for one of its own phases (5.2): the 16-phase
 * schedule grants `credits` hexes this phase — usually zero or one, two for
 * very fast ships — and each credit either pays off slow terrain or steps a
 * hex toward the destination. `movedLastOwnPhase` and `course` are recorded
 * here because the detection bands and dead-reckoning read them (4.3, 4.4);
 * "moved" means the drive is hot — a ship in transit between its scheduled
 * phases is under way, not holding still, however many hexes this particular
 * phase granted it.
 */
function stepUnit(ctx: DetectionContext, state: CampaignState, unit: Unit, credits: number): void {
  if (orderedSpeed(unit) === 0) {
    unit.movedLastOwnPhase = false
    unit.course = null
    return
  }
  for (let i = 0; i < credits; i++) {
    if (unit.moveDebt > 0) {
      unit.moveDebt -= 1 // the second phase a nebula hex costs (2.2)
      continue
    }
    const target = currentDestination(ctx, state, unit)
    if (!target) break
    const next = hexStepToward(unit.hex, target)
    // The map edge is a wall, not a suggestion: a waypoint (or a reckoned
    // contact position) beyond it holds the unit at the border rather than
    // walking it off the board.
    if (hexEquals(next, unit.hex) || !inBounds(next, ctx.map.width, ctx.map.height)) break
    unit.course = { q: next.q - unit.hex.q, r: next.r - unit.hex.r }
    unit.hex = next
    // Nebula and dust cost two movement credits per hex (2.2): the second is owed.
    unit.moveDebt = entryCost(terrainAt(ctx.map, next)) - 1
  }
  const underway = unit.moveDebt > 0 || currentDestination(ctx, state, unit) !== null
  unit.movedLastOwnPhase = underway
  if (!underway) unit.course = null
}

/**
 * Resolve one side's phase: interventions first (they are the journal entry),
 * then that side's scheduled movement (schedule.ts — a unit's speed decides
 * which of its side's eight phases it steps in), then EVERYONE's passive
 * scans (4.1) — sixteen detection sweeps a round is the design's heartbeat.
 * The final phase additionally runs the round tick (5.1).
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
  for (const record of move.battles ?? []) applyBattleResult(ctx, next, record)
  if (next.pendingBattles.length > 0) {
    throw new PhaseError(
      `Battles unresolved: ${next.pendingBattles.map((p) => p.id).join(', ')} — fight them before moving.`,
    )
  }

  for (const intervention of move.interventions) applyIntervention(next, intervention, move.side)
  for (const unit of next.units) {
    if (unit.side !== move.side) continue
    stepUnit(ctx, next, unit, hexesThisPhase(orderedSpeed(unit), unit.side, next.phase))
  }
  closeFormationTick(ctx, next, move.side)

  runDetection(ctx, next)
  checkEngagements(ctx, next)

  // Cloaked running is an endurance cost at the tick (6.4): note anyone dark
  // during any phase, whichever side moved.
  for (const unit of next.units) {
    if (unitIsCloaked(unit)) unit.cloakedThisRound = true
  }

  if (next.phase === ROUND_PHASES) {
    /*
     * The round tick (5.1), in a fixed order the tests pin: the fog fades,
     * the crews work, the tanks drain and refill, the wings rearm, the
     * convoys ride their beacons, deliveries bank their points, the
     * reinforcements arrive — and only then does the clock decide whether
     * the campaign is over, so a final-round delivery still counts.
     */
    decayContacts(next)
    repairTick(next)
    emergencyWearTick(next)
    enduranceTick(next)
    wingTick(next)
    convoyBeaconStep(ctx, next)
    deliveryTick(ctx.scenario, next)
    next.phase = 1
    next.round += 1
    for (const r of [...next.reinforcements]) {
      if (r.arrivesRound <= next.round) {
        next.units.push(r.unit)
        next.reinforcements = next.reinforcements.filter((x) => x !== r)
      }
    }
    if (next.round > next.roundLimit) next.finished = true
    settleWinner(ctx.scenario, next)
  } else {
    next.phase += 1
  }
  return next
}

/**
 * Formation-keeping has teeth (the designer's close-formation redesign):
 * hulls flying tight enough to read as one target run a tiny risk of
 * touching — a quarter of one percent per own phase, configurable through
 * `tuning.sensorModel.closeFormationCollision`. A collision marks one
 * structure box on a random hull of the unit; the scar surfaces through the
 * ordinary damage bands and repair queue, like any other wound. Rolled only
 * on the unit's own side's phases, fixed iteration order, so the campaign
 * stream replays.
 */
function closeFormationTick(ctx: DetectionContext, state: CampaignState, side: Side): void {
  const cfg = resolveSensorModel(ctx.scenario.tuning.sensorModel)
  if (cfg.closeFormationCollision <= 0) return
  for (const unit of state.units) {
    if (unit.side !== side) continue
    if (unit.order.formation !== 'close' || unit.ships.length < 2) continue
    if (nextRandom(state.rng) >= cfg.closeFormationCollision) continue
    const ship = unit.ships[nextInt(state.rng, unit.ships.length)]
    const scars = (ship.scars ??= blankScars())
    scars.structure += 1
  }
}

/**
 * Emergency running wears the ship (the designer's note: ships can take
 * damage or break down at emergency speed). At the round tick, each hull in a
 * unit that spent the round at emergency rolls the campaign stream: a one in
 * six marks an FTL DRV box; with the FTL track full the sublight drive takes
 * it, and with both full the frame itself does. PROVISIONAL odds until his
 * FTL rules land. Fixed iteration order — units then ships, in state order —
 * so the stream replays.
 */
function emergencyWearTick(state: CampaignState): void {
  for (const unit of state.units) {
    if (effectiveSpeedTier(unit) !== 'emergency') continue
    for (const ship of unit.ships) {
      if (nextRandom(state.rng) >= 1 / 6) continue
      const form = shipFormById(ship.formId)
      if (!form) continue
      const scars = (ship.scars ??= blankScars())
      if (scars.ftl < form.ftlDriveBoxes) scars.ftl += 1
      else if ((scars.systems['__sublight'] ?? 0) < form.sublight.driveBoxes) {
        scars.systems['__sublight'] = (scars.systems['__sublight'] ?? 0) + 1
      } else scars.structure += 1
    }
  }
}

function blankScars(): ShipScars {
  return {
    structure: 0,
    reactors: {},
    batteries: [],
    ftl: 0,
    systems: {},
    scout: 0,
    shieldGenerator: 0,
    armor: { F: 0, S: 0, A: 0, P: 0 },
    mounts: {},
  }
}

/**
 * The beacon chains (6.3): a convoy that ends the round beside an intact
 * friendly jump beacon rides it one hex further along its route — the +1 hex
 * a round that makes scheduled shipping worth escorting and beacons worth
 * hunting.
 */
function convoyBeaconStep(ctx: DetectionContext, state: CampaignState): void {
  for (const unit of state.units) {
    if (unit.kind !== 'convoy') continue
    const chained = state.infrastructure.some(
      (i) =>
        !i.destroyed &&
        i.side === unit.side &&
        i.kind === 'jump-beacon' &&
        hexDistance(i.hex, unit.hex) <= 1,
    )
    if (chained) stepUnit(ctx, state, unit, 1)
  }
}
