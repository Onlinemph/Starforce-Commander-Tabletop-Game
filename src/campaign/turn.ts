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
  logSensor,
  reckonedHex,
  runDetection,
  unitIsCloaked,
  unitProfile,
  pruneOrphanTracks,
  type DetectionContext,
} from './detection'
import { resolveSensorModel } from './sensorModel'
import { checkEngagements } from './engagement'
import { entryCost, hexDistance, hexEquals, hexKey, hexNeighbors, hexStepToward, inBounds, terrainAt } from './hexmap'
import {
  effectiveSpeedTier,
  enduranceMaxOf,
  enduranceTick,
  orderSpeedCap,
  orderedSpeed,
  repairTick,
  resolveEndurance,
  wingTick,
} from './logistics'
import { objectiveTick } from './objectives'
import { pirateRaidTick } from './pirates'
import { hexesThisPhase, ROUND_PHASES } from './schedule'
import { shipFormById } from '../data/ships'
import type { ShipScars } from '../engine/shipState'
import { deliveryTick, raidTick, settleWinner } from './scoring'
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
  if (order.exactSpeed != null) {
    if (!Number.isFinite(order.exactSpeed) || order.exactSpeed < 0) {
      return `${unit.id}: exact speed must be a number of hexes a round, 0 or more.`
    }
    const cap = orderSpeedCap(unit, order)
    if (Math.round(order.exactSpeed) > cap) {
      return `${unit.id}: exact speed ${order.exactSpeed} exceeds ${order.speed} (${cap})${
        unit.kind === 'convoy' ? ' — civilian hulls run 1–3' : ' — raise the tier or lower the number'
      }.`
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
  const mission = order.mission
  if (!mission) return
  switch (mission.type) {
    case 'intercept':
    case 'shadow': {
      const held = state.contacts.some((c) => c.id === mission.contactId && c.side === unit.side)
      if (!held) delete order.mission
      return
    }
    case 'attack-nearest':
      return // a standing posture: valid with an empty scope
    case 'raid':
    case 'assault': {
      // Only KNOWN enemy infrastructure may be struck: a station of the
      // enemy's that the charts show (3.4) — never a listening post, which
      // exists for a side only as a contact.
      const station = state.infrastructure.find((i) => i.id === mission.stationId)
      const legal =
        station && !station.destroyed && station.side !== unit.side && station.kind !== 'listening-post'
      if (!legal) delete order.mission
      return
    }
  }
}

function applyIntervention(
  state: CampaignState,
  intervention: Intervention,
  side: string,
  tankMultiplier: number,
): void {
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
    case 'merge-units':
      mergeUnits(state, unit, intervention.intoId, side, tankMultiplier)
      break
    case 'split-unit':
      splitUnit(state, unit, intervention.shipIds, intervention.newUnitId, tankMultiplier)
      break
  }
}

/**
 * Task forces (the designer's orders list): fold one unit into another,
 * co-located command. The flagship's standing orders carry; the absorbed
 * unit's identity dissolves — the enemy's dossiers on it follow the hulls
 * into the new command (they are the same ships), and the intelligence its
 * scans gathered transfers with it, so nothing a side knew is forgotten by
 * an org-chart change on either side of the fog.
 */
function mergeUnits(state: CampaignState, unit: Unit, intoId: string, side: string, tank: number): void {
  const into = state.units.find((u) => u.id === intoId)
  // Like orders to the dead: a merge target lost in this move's battle drops.
  if (!into) return
  if (into.side !== side) throw new PhaseError(`${into.id} is not ${side}'s unit to merge into.`)
  if (into.id === unit.id) throw new PhaseError(`${unit.id} cannot merge into itself.`)
  if (!hexEquals(unit.hex, into.hex)) {
    throw new PhaseError(`${unit.id} and ${into.id} must share a hex to form a task force.`)
  }
  for (const u of [unit, into]) {
    if (u.kind !== 'ship' && u.kind !== 'group') {
      throw new PhaseError(`${u.id} is a ${u.kind} — only ships and groups form task forces.`)
    }
  }
  if (unit.ships.length + into.ships.length > 8) {
    throw new PhaseError(`A group is 2–8 ships (6.1): ${unit.id} + ${into.id} would be ${unit.ships.length + into.ships.length}.`)
  }
  into.ships.push(...unit.ships)
  into.kind = 'group'
  // The smallest tank aboard sets the merged legs (3.1); nobody gains fuel
  // by re-flagging, so the pool is the smaller of the two.
  into.enduranceMax = enduranceMaxOf(into, tank)
  into.endurance = Math.min(into.endurance, unit.endurance, into.enduranceMax)
  into.moveDebt = Math.max(into.moveDebt, unit.moveDebt)
  into.cloakedThisRound = into.cloakedThisRound || unit.cloakedThisRound
  state.units = state.units.filter((u) => u.id !== unit.id)
  // Orders the merged hulls can no longer honor are trimmed, not refused —
  // the merge is the player's intent; the flags follow the new envelope.
  if (into.order.cloaked && !unitProfile(into).cloakCapable) into.order.cloaked = false
  if (into.order.exactSpeed != null) {
    into.order.exactSpeed = Math.min(into.order.exactSpeed, orderSpeedCap(into))
  }
  for (const contact of state.contacts) {
    // Spotter credit rides with the hulls into their new command.
    if (contact.spotters) {
      contact.spotters = [...new Set(contact.spotters.map((s) => (s === unit.id ? into.id : s)))]
    }
  }
  // The enemy's picture: a dossier on the absorbed unit now shadows the
  // merged one — unless that side already holds one on the target, in which
  // case the older of the pair simply dissolves (one unit, one record).
  const sidesHoldingInto = new Set(
    state.contacts.filter((c) => c.targetUnitId === into.id).map((c) => c.side),
  )
  state.contacts = state.contacts.filter(
    (c) => !(c.targetUnitId === unit.id && sidesHoldingInto.has(c.side)),
  )
  for (const contact of state.contacts) {
    if (contact.targetUnitId === unit.id) contact.targetUnitId = into.id
  }
}

/**
 * Detach ships into a new unit of their own (the other half of task forces).
 * The new unit id is named by the intervention — journaled, so a replay
 * reproduces it byte for byte — and both halves inherit the standing order.
 * The enemy's dossier stays on the ORIGINAL unit id: the ships that slipped
 * away are simply not where the picture says the force is, and finding that
 * out is the game working as designed.
 */
function splitUnit(state: CampaignState, unit: Unit, shipIds: string[], newUnitId: string, tank: number): void {
  if (unit.kind !== 'ship' && unit.kind !== 'group') {
    throw new PhaseError(`${unit.id} is a ${unit.kind} — only ships and groups detach.`)
  }
  if (shipIds.length === 0) throw new PhaseError('Name at least one ship to detach.')
  const leaving = unit.ships.filter((s) => shipIds.includes(s.id))
  if (leaving.length !== shipIds.length) {
    throw new PhaseError(`Not every named ship is aboard ${unit.id}.`)
  }
  if (leaving.length === unit.ships.length) {
    throw new PhaseError(`A split must leave something behind aboard ${unit.id}.`)
  }
  if (
    !newUnitId ||
    state.units.some((u) => u.id === newUnitId) ||
    state.reinforcements.some((r) => r.unit.id === newUnitId)
  ) {
    throw new PhaseError(`Unit id ${newUnitId || '(empty)'} is taken.`)
  }
  unit.ships = unit.ships.filter((s) => !shipIds.includes(s.id))
  if (unit.ships.length === 1) unit.kind = 'ship'
  const detached: Unit = {
    id: newUnitId,
    side: unit.side,
    kind: leaving.length > 1 ? 'group' : 'ship',
    ships: leaving,
    hex: { ...unit.hex },
    order: structuredClone(unit.order),
    moveDebt: unit.moveDebt,
    endurance: 0,
    enduranceMax: 0,
    cloakedThisRound: unit.cloakedThisRound,
    movedLastOwnPhase: unit.movedLastOwnPhase,
    course: unit.course ? { ...unit.course } : null,
  }
  // Each half's legs are its own smallest tank; the shared pool does not
  // grow — both leave with what the force had.
  detached.enduranceMax = enduranceMaxOf(detached, tank)
  detached.endurance = Math.min(unit.endurance, detached.enduranceMax)
  unit.enduranceMax = enduranceMaxOf(unit, tank)
  unit.endurance = Math.min(unit.endurance, unit.enduranceMax)
  for (const half of [unit, detached]) {
    if (half.order.cloaked && !unitProfile(half).cloakCapable) half.order.cloaked = false
    if (half.order.exactSpeed != null) {
      half.order.exactSpeed = Math.min(half.order.exactSpeed, orderSpeedCap(half))
    }
  }
  state.units.push(detached)
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
      // The objectives' kill count (objectives.ts): hulls each side has lost.
      state.shipsLost ??= { A: 0, B: 0 }
      state.shipsLost[unit.side] += 1
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
  for (const c of state.contacts) {
    if (!dead.includes(c.targetUnitId)) continue
    logSensor(state, c.side, c.id, c.estimatedHex, 'Contact destroyed — confirmed in battle.')
  }
  state.contacts = state.contacts.filter((c) => !dead.includes(c.targetUnitId))
  // The dead take their pictures with them: a contact every one of whose
  // spotters just died goes dark THIS phase, not rounds later.
  pruneOrphanTracks(state)
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
  if (mission && (mission.type === 'intercept' || mission.type === 'shadow')) {
    const contact = state.contacts.find((c) => c.id === mission.contactId && c.side === unit.side)
    if (!contact || contactCollapsed(contact)) {
      /*
       * The trail went cold: the mission ends and the unit RESUMES ITS
       * WAYPOINTS. This used to hold the ship "until told otherwise", which
       * read as ships abandoning their plotted routes forever the moment a
       * contact faded — and under the sensor model contacts fade often. A
       * hunter with no quarry goes back to its patrol.
       */
      delete unit.order.mission
    } else {
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
  }
  if (mission?.type === 'attack-nearest') {
    // The standing hunt (designer's orders list): re-aim every step at the
    // nearest live contact the side holds; with an empty scope, fall through
    // to the waypoints. The posture itself never expires.
    let best: Hex | null = null
    let bestRange = Infinity
    for (const contact of state.contacts) {
      if (contact.side !== unit.side || contactCollapsed(contact)) continue
      const believed = reckonedHex(ctx.map, contact, state)
      const range = hexDistance(unit.hex, believed)
      if (range < bestRange) {
        best = believed
        bestRange = range
      }
    }
    if (best) return bestRange === 0 ? null : best
  }
  if (mission && (mission.type === 'raid' || mission.type === 'assault')) {
    const station = state.infrastructure.find((i) => i.id === mission.stationId)
    if (!station || station.destroyed || station.side === unit.side) {
      delete unit.order.mission // the objective is gone: back to the route
    } else {
      // Inbound to the strike; on the hex, hold for the round tick (raidTick).
      return hexEquals(unit.hex, station.hex) ? null : station.hex
    }
  }
  // Reached waypoints cross off — or, on a patrol loop, go to the back of
  // the list so the circuit repeats. The guard bounds the pathological loop
  // whose every waypoint is the hex the unit is standing on.
  let guard = unit.order.waypoints.length
  while (guard-- > 0 && unit.order.waypoints.length > 0 && hexEquals(unit.order.waypoints[0], unit.hex)) {
    const reached = unit.order.waypoints.shift()!
    if (unit.order.patrolLoop && unit.order.waypoints.length > 0) unit.order.waypoints.push(reached)
  }
  const target = unit.order.waypoints[0] ?? null
  return target && hexEquals(target, unit.hex) ? null : target
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
/** Avoid Contact's exclusion bubble: steer to keep every contact this far out. */
const AVOID_RANGE = 2

function stepUnit(ctx: DetectionContext, state: CampaignState, unit: Unit, credits: number): void {
  if (orderedSpeed(unit) === 0) {
    unit.movedLastOwnPhase = false
    unit.course = null
    return
  }
  // Avoid Contact (designer's orders list): the hexes this unit's own side
  // believes something hostile occupies. Steering, like missions, reads only
  // the side's picture — a ghost repels exactly like a real hull would.
  const threats: Hex[] = unit.order.avoidContact
    ? state.contacts
        .filter((c) => c.side === unit.side && !contactCollapsed(c))
        .map((c) => reckonedHex(ctx.map, c, state))
    : []
  const clearOf = (hex: Hex) => threats.every((t) => hexDistance(hex, t) > AVOID_RANGE)
  for (let i = 0; i < credits; i++) {
    if (unit.moveDebt > 0) {
      unit.moveDebt -= 1 // the second phase a nebula hex costs (2.2)
      continue
    }
    const target = currentDestination(ctx, state, unit)
    if (!target) break
    let next = hexStepToward(unit.hex, target)
    if (threats.length > 0 && !clearOf(next)) {
      // The straight line enters the bubble: detour through the clear
      // neighbor closest to the destination, or hold rather than close.
      let best: Hex | null = null
      let bestDist = Infinity
      for (const n of hexNeighbors(unit.hex)) {
        if (!inBounds(n, ctx.map.width, ctx.map.height) || !clearOf(n)) continue
        const d = hexDistance(n, target)
        if (d < bestDist) {
          best = n
          bestDist = d
        }
      }
      if (!best) break
      next = best
    }
    // The map edge is a wall, not a suggestion: a waypoint (or a reckoned
    // contact position) beyond it holds the unit at the border rather than
    // walking it off the board.
    if (hexEquals(next, unit.hex) || !inBounds(next, ctx.map.width, ctx.map.height)) break
    unit.course = { q: next.q - unit.hex.q, r: next.r - unit.hex.r }
    unit.hex = next
    const entered = terrainAt(ctx.map, next)
    // A star system entered is a star system scouted (objectives.ts).
    if (entered === 'system') {
      state.scouted ??= { A: [], B: [] }
      const key = hexKey(next)
      if (!state.scouted[unit.side].includes(key)) state.scouted[unit.side].push(key)
    }
    // Nebula and dust cost two movement credits per hex (2.2): the second is owed.
    unit.moveDebt = entryCost(entered) - 1
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

  const tank = resolveEndurance(ctx.scenario.tuning.endurance).tankMultiplier
  for (const intervention of move.interventions) applyIntervention(next, intervention, move.side, tank)
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
    enduranceTick(next, resolveEndurance(ctx.scenario.tuning.endurance))
    wingTick(next)
    convoyBeaconStep(ctx, next)
    deliveryTick(ctx.scenario, next)
    // Ordered strikes on enemy infrastructure land (scoring.ts raidTick),
    // then the clans work the unpatrolled systems (pirates.ts) — both before
    // the clock check, so a final-round strike still pays.
    raidTick(next)
    pirateRaidTick(ctx, next)
    // Objectives judge the round after every ledger movement above, so a
    // station killed or a hull lost THIS tick counts (objectives.ts).
    objectiveTick(ctx.scenario, next)
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
  // After everything that can remove a unit or a station this phase —
  // battles, deliveries, the tick — orphaned tracks go with their spotters.
  pruneOrphanTracks(next)
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
