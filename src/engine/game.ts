import {
  applyVolley,
  autoChoices,
  newDeck,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageContext,
  type DeckState,
  type DestructionOptions,
} from './damage'
import {
  commandSystemBoxes,
  hasCommandSystems,
  lentTacticalScan,
  newCommandState,
  type CommandState,
} from './command'
import {
  checkOneAttackPerPhase,
  attackKey,
  validateCoordinatedFire,
  FIRING_STEPS,
  type FiringStep,
} from './coordinatedFire'
import { FACE_DAMAGE, rollDie, Rng } from './dice'
import { commitAllocation } from './engineering'
import {
  alignToLead,
  formationOf,
  pruneFormations,
  type Formation,
} from './formation'
import type { CircleObstacle } from './geometry'
import {
  cloudAt,
  degradedByClouds,
  HAMPERED_SYSTEMS,
  ftlBlocked,
  lowSpeedPenaltyNegated,
  overspeedDice,
  safeSpeed,
  shieldsInoperative,
  STANDARD_NEBULA_EFFECTS,
  systemIsHampered,
  turbulenceTurn,
  underCloudEffects,
  type CloudConditions,
  type CloudFeature,
  type NebulaEffects,
} from './nebula'
import { scoutSupportFor, type ScoutSupport } from './scouting'
import {
  disengagementOptions,
  executeMovement,
  resolveStressCheck,
  type MapBounds,
} from './navigation'
import {
  beginRound,
  damageLevel,
  structureRemaining,
  structureTotal,
  undamagedSystemBoxes,
  VICTORY_FRACTION,
  type ShipState,
} from './shipState'
import type { CommandCard, Phase, Segment, ShieldSide, SystemKind } from './types'

/**
 * Game orchestration: the Sequence of Play (A3) and everything that hangs off
 * the round structure.
 */

// ---------------------------------------------------------------------------
// Terrain (K)
// ---------------------------------------------------------------------------

export type TerrainKind = 'planet' | 'moon' | 'asteroid-field' | 'gas-cloud'

export interface Terrain {
  id: string
  kind: TerrainKind
  name: string
  center: { x: number; y: number }
  radius: number
  /** Asteroid fields only: highest speed that avoids damage (K2.1.5). */
  safeSpeed?: number
  /** Asteroid fields only: damage die rolled per point of speed over safe (K2.1.6). */
  damageDie?: 'blue' | 'green' | 'yellow' | 'red'
  /** Asteroid fields only: defender rerolls granted as cover (K2.1.8). */
  cover?: number
  /** Gas clouds only: information points needed to find a hidden unit (K5.2.3). */
  scan?: number
}

export function terrainObstacles(terrain: Terrain[]): CircleObstacle[] {
  return terrain.map((t) => ({
    center: t.center,
    radius: t.radius,
    // Planets and moons block line of sight; asteroids and gas clouds merely
    // obstruct — a cloud degrades fire control instead (K3.1.3, K5.2.5).
    blocksLos: t.kind === 'planet' || t.kind === 'moon',
  }))
}

/** Gas cloud counters on the map (K5.1). */
export function gasClouds(scenario: Scenario): CloudFeature[] {
  return scenario.terrain
    .filter((t) => t.kind === 'gas-cloud')
    .map((t) => ({ id: t.id, name: t.name, center: t.center, radius: t.radius, scan: t.scan }))
}

/**
 * The nebula and gas cloud conditions in force (K4, K5). A scenario declares
 * whether the whole play area is a nebula (K4.1.1) and may tune which Common
 * Nebula Effects apply (K4.2, K5.2.4).
 */
export function cloudConditions(scenario: Scenario): CloudConditions {
  return {
    nebula: scenario.nebula ?? false,
    clouds: gasClouds(scenario),
    effects: { ...STANDARD_NEBULA_EFFECTS, ...scenario.nebulaEffects },
  }
}

// ---------------------------------------------------------------------------
// Scenario (S2)
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string
  name: string
  background: string
  bounds: MapBounds
  terrain: Terrain[]
  /** Objective text per side, keyed by side id (S2.8.1). */
  objectives: Record<string, string>
  specialRules?: string[]
  victory: string
  /** The whole play area is inside a nebula (K4.1.1). */
  nebula?: boolean
  /** Scenario-specific tuning of the Common Nebula Effects (K4.2, K5.2.4). */
  nebulaEffects?: Partial<NebulaEffects>
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export const PHASE_SEGMENTS: Record<Phase, Segment[]> = {
  engineering: ['resource-allocation', 'damage-control'],
  'combat-1': ['command', 'operations', 'navigation', 'combat', 'flight-operations', 'delayed-action'],
  'combat-2': ['command', 'operations', 'navigation', 'combat', 'flight-operations', 'delayed-action'],
  'combat-3': ['command', 'operations', 'navigation', 'combat', 'flight-operations', 'delayed-action'],
  final: ['stress-check', 'boarding-combat', 'disengagement', 'hangar-bay', 'final-activity'],
}

export const PHASE_ORDER: Phase[] = ['engineering', 'combat-1', 'combat-2', 'combat-3', 'final']

export const SEGMENT_LABELS: Record<Segment, string> = {
  'resource-allocation': 'Resource Allocation',
  'damage-control': 'Damage Control',
  command: 'Command',
  operations: 'Operations',
  navigation: 'Navigation',
  combat: 'Combat',
  'flight-operations': 'Flight Operations',
  'delayed-action': 'Delayed Action',
  'stress-check': 'Stress Check',
  'boarding-combat': 'Boarding Combat',
  disengagement: 'Disengagement',
  'hangar-bay': 'Hangar Bay',
  'final-activity': 'Final Activity',
}

export const PHASE_LABELS: Record<Phase, string> = {
  engineering: 'Engineering Phase',
  'combat-1': 'Combat Phase 1',
  'combat-2': 'Combat Phase 2',
  'combat-3': 'Combat Phase 3',
  final: 'Final Phase',
}

export interface LogEntry {
  round: number
  phase: Phase
  segment: Segment
  message: string
}

export interface GameState {
  scenario: Scenario
  round: number
  phase: Phase
  segment: Segment
  ships: ShipState[]
  /** Command cards for the current combat phase, keyed by ship id. */
  orders: Record<string, CommandCard>
  deck: DeckState
  rng: Rng
  log: LogEntry[]
  /**
   * Ships that have already fired this Combat Segment (E6.2 Step 1). There is
   * one Combat Segment per combat phase, so this is also the "one opportunity
   * to fire per phase" of H4.1.1.
   */
  firedThisSegment: Set<string>
  /** Ships that have raised or lowered a shield this phase (G1.1.5). */
  shieldChangedThisPhase: Set<string>
  /** Command ship and lent tactical scan, per side, for this round (H5.2). */
  command: Record<string, CommandState>
  /** H4 Coordinated Fire is optional (H4.1) and off unless switched on. */
  coordinatedFire: boolean
  /** Position in the ten-step firing sequence while H4 is in force (H4.2.3). */
  firingStepIndex: number
  /** `faction->targetId` pairs already attacked this phase (H4.3.1). */
  attackedThisPhase: Set<string>
  /** The coordinated attack declared on the current step, if any (H4.5). */
  coordinatedGroup: CoordinatedGroup | null
  /** Ships flying as one counter (C5). */
  formations: Formation[]
  options: DestructionOptions
}

/** Ships of one faction attacking a single target together (H4.5). */
export interface CoordinatedGroup {
  /** The firing step the group fires on. */
  step: number
  side: string
  shipIds: string[]
  targetId: string
}

export function defaultCommandCard(ship: ShipState): CommandCard {
  return {
    maneuver: 'straight',
    direction: null,
    accel: 0,
    speed: ship.speed,
    sensors: { ...ship.sensors },
    shieldsDown: [],
  }
}

export function createGame(args: {
  scenario: Scenario
  ships: ShipState[]
  seed?: number
  options?: DestructionOptions
  /** Play with the optional Coordinated Fire rules (H4.1). */
  coordinatedFire?: boolean
}): GameState {
  const rng = new Rng(args.seed ?? 0x5f04ce)
  const options = args.options ?? STANDARD_DESTRUCTION
  setDestructionOptions(options)
  // One command ship per side (H5.1.6). The side's largest command ship is the
  // obvious flagship, so pre-designate it; the player may change the choice in
  // any Resource Allocation Segment.
  const command: Record<string, CommandState> = {}
  for (const side of new Set(args.ships.map((s) => s.side))) {
    const state = newCommandState()
    const flagship = args.ships
      .filter((s) => s.side === side && hasCommandSystems(s))
      .sort((a, b) => commandSystemBoxes(b) - commandSystemBoxes(a))[0]
    state.commandShipId = flagship?.id ?? null
    command[side] = state
  }
  const game: GameState = {
    scenario: args.scenario,
    round: 1,
    phase: 'engineering',
    segment: 'resource-allocation',
    ships: args.ships,
    orders: {},
    deck: newDeck(rng),
    rng,
    log: [],
    firedThisSegment: new Set(),
    shieldChangedThisPhase: new Set(),
    command,
    coordinatedFire: args.coordinatedFire ?? false,
    firingStepIndex: 0,
    attackedThisPhase: new Set(),
    coordinatedGroup: null,
    formations: [],
    options,
  }
  for (const ship of game.ships) beginRound(ship)
  pushLog(game, `Round 1 — ${args.scenario.name}`)
  return game
}

export function pushLog(game: GameState, message: string): void {
  game.log.push({ round: game.round, phase: game.phase, segment: game.segment, message })
}

export function damageContext(game: GameState): DamageContext {
  return {
    deck: game.deck,
    rng: game.rng,
    choices: autoChoices,
    log: (message) => pushLog(game, message),
    // Explosions reach neighbours, and everyone sharing a formation's counter
    // takes the blast on the aft shield (E11.3.2, E11.3.4, C5).
    ships: game.ships,
    formations: game.formations,
  }
}

/** Scout targeting and area jamming applying to one volley (H3.4, H3.5). */
export function scoutSupport(game: GameState, attacker: ShipState, target: ShipState): ScoutSupport {
  return scoutSupportFor(attacker, target, game.ships)
}

/** The formation a ship is flying in, if any (C5). */
export function formationFor(game: GameState, ship: ShipState): Formation | null {
  return formationOf(game.formations, ship.id)
}

// ---------------------------------------------------------------------------
// Nebulae and gas clouds (K4, K5)
// ---------------------------------------------------------------------------

/** Cloud effects biting on one ship right now, for the UI and the log. */
export interface CloudStatus {
  /** Inside a nebula or a gas cloud. */
  inside: boolean
  /** The gas cloud the ship is in, if any (K5.1.2). */
  cloud: CloudFeature | null
  /** Highest speed that costs nothing here (K4.2.2, K5.2.1). */
  safeSpeed: number
  /** Blue dice the ship will roll for its current speed. */
  overspeedDice: number
  shieldsInoperative: boolean
  /** Systems switched off unless GEN SYS is at MAX (K4.2.4). */
  hamperedSystems: SystemKind[]
  ftlBlocked: boolean
}

export function cloudStatus(game: GameState, ship: ShipState): CloudStatus {
  const conditions = cloudConditions(game.scenario)
  const cloud = cloudAt(conditions.clouds, ship.placement.position)
  const inside = underCloudEffects(conditions, ship)
  return {
    inside,
    cloud,
    safeSpeed: safeSpeed(conditions, ship.placement.position),
    overspeedDice: overspeedDice(conditions, ship),
    shieldsInoperative: shieldsInoperative(conditions, ship),
    hamperedSystems: HAMPERED_SYSTEMS.filter((kind) => systemIsHampered(conditions, ship, kind)),
    ftlBlocked: ftlBlocked(conditions, ship),
  }
}

/**
 * Terrain modifiers for one volley (K4.2.1, K4.2.3, K4.2.6, K5.2.5), ready to
 * spread into a `VolleyRequest`.
 */
export function cloudModifiers(
  game: GameState,
  attacker: ShipState,
  target: ShipState,
): { degradedFireControl: boolean; lowSpeedNegated: boolean; targetShieldsInoperative: boolean } {
  const conditions = cloudConditions(game.scenario)
  return {
    degradedFireControl: degradedByClouds(conditions, attacker, target),
    lowSpeedNegated: lowSpeedPenaltyNegated(conditions, target),
    targetShieldsInoperative: shieldsInoperative(conditions, target),
  }
}

/**
 * Undamaged boxes of a system, after a nebula switches it off (K4.2.4). Use
 * this rather than `undamagedSystemBoxes` wherever a system's *capability* is
 * being read, so SCNC, TRAN and TRAC go dark below GEN SYS MAX.
 */
export function workingSystemBoxes(game: GameState, ship: ShipState, kind: SystemKind): number {
  if (systemIsHampered(cloudConditions(game.scenario), ship, kind)) return 0
  return undamagedSystemBoxes(ship, kind)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function activeShips(game: GameState): ShipState[] {
  return game.ships.filter((s) => !s.destroyed && !s.disengaged)
}

export function shipById(game: GameState, id: string): ShipState | undefined {
  return game.ships.find((s) => s.id === id)
}

export function enemiesOf(game: GameState, ship: ShipState): ShipState[] {
  return activeShips(game).filter((s) => s.side !== ship.side)
}

export function sides(game: GameState): string[] {
  return [...new Set(game.ships.map((s) => s.side))]
}

export function isCombatPhase(phase: Phase): boolean {
  return phase === 'combat-1' || phase === 'combat-2' || phase === 'combat-3'
}

// ---------------------------------------------------------------------------
// Command Systems (H5)
// ---------------------------------------------------------------------------

export function commandStateFor(game: GameState, side: string): CommandState {
  if (!game.command[side]) game.command[side] = newCommandState()
  return game.command[side]
}

/** Tactical scan points every ship currently holds on loan (H5.2.1). */
export function lentScanPoints(game: GameState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const side of sides(game)) {
    Object.assign(out, lentTacticalScan(commandStateFor(game, side), game.ships))
  }
  return out
}

/**
 * A ship's Tactical Scan level for the firing sequence: the points it plotted
 * from its own sensors plus any lent by its faction's command ship. Lent points
 * may push a ship past the cap its own sensor rating imposes (H5.2.2).
 */
export function tacticalScanOf(game: GameState, ship: ShipState): number {
  return ship.sensors.tacticalScan + (lentScanPoints(game)[ship.id] ?? 0)
}

// ---------------------------------------------------------------------------
// Coordinated Fire (H4)
// ---------------------------------------------------------------------------

export function currentFiringStep(game: GameState): FiringStep {
  return FIRING_STEPS[Math.min(game.firingStepIndex, FIRING_STEPS.length - 1)]
}

/** Move to the next of the ten firing steps (H4.2.3). */
export function advanceFiringStep(game: GameState): void {
  if (game.firingStepIndex >= FIRING_STEPS.length - 1) return
  game.firingStepIndex += 1
  // A declared group belongs to the step it was declared on (H4.5.4).
  game.coordinatedGroup = null
  pushLog(game, `Firing step ${currentFiringStep(game).index}: ${currentFiringStep(game).label}.`)
}

/**
 * Declare a coordinated attack on the current step (H4.5). Returns an error
 * message when the group is illegal, in which case nothing is declared.
 */
export function declareCoordinatedFire(
  game: GameState,
  ships: ShipState[],
  target: ShipState,
): string | null {
  const step = currentFiringStep(game)
  const entries = ships.map((ship) => ({ ship, scan: tacticalScanOf(game, ship) }))
  const problem = validateCoordinatedFire(entries, step)
  if (problem) return problem
  if (ships.some((s) => game.firedThisSegment.has(s.id))) {
    return 'A ship may only fire once per combat phase (H4.1.1).'
  }
  const blocked = attackAllowed(game, ships[0], target)
  if (blocked) return blocked

  game.coordinatedGroup = {
    step: step.index,
    side: ships[0].side,
    shipIds: ships.map((s) => s.id),
    targetId: target.id,
  }
  // The whole group counts as the faction's one attack on this target (H4.3.1).
  recordAttack(game, ships[0], target)
  pushLog(
    game,
    `${ships.map((s) => s.name).join(', ')} coordinate fire on ${target.name} at step ${step.index} (H4.5).`,
  )
  return null
}

/**
 * Whether this faction may still attack `target` during the current combat
 * phase. Only meaningful under the optional H4 rules; without them the base
 * game places no such limit.
 */
export function attackAllowed(game: GameState, attacker: ShipState, target: ShipState): string | null {
  if (!game.coordinatedFire) return null
  return checkOneAttackPerPhase(attacker.side, target, game.attackedThisPhase)
}

/** Mark a target as attacked by a faction this phase (H4.3.1). */
export function recordAttack(game: GameState, attacker: ShipState, target: ShipState): void {
  game.attackedThisPhase.add(attackKey(attacker.side, target.id))
}

/**
 * Points an opponent earns for the state of one ship (S2.8.2 – S2.8.4).
 *
 * The Master Ship List prints an exact damage/points table per ship, so use it
 * when present and fall back to the S2.8.4 percentages otherwise. A ship that
 * disengages is worth the moderate-damage value, or its actual damage level if
 * that is higher (S2.8.4 item 4).
 */
export function pointsAgainst(ship: ShipState): number {
  const damaged = structureTotal(ship) - structureRemaining(ship)
  const table = ship.form.victoryTable

  let earned: number
  if (ship.destroyed || (structureTotal(ship) > 0 && damaged >= structureTotal(ship))) {
    earned = ship.form.pointValue
  } else if (table && table.length > 0) {
    // Highest band whose damage threshold has been reached; levels are not
    // cumulative (S2.8.2).
    earned = table.reduce((best, row) => (damaged >= row.damage ? row.points : best), 0)
  } else {
    earned = ship.form.pointValue * VICTORY_FRACTION[damageLevel(ship)]
  }

  if (ship.disengaged) {
    earned = Math.max(earned, ship.form.pointValue * VICTORY_FRACTION.moderate)
  }
  return earned
}

/** Victory points earned by each side (S2.8.2 – S2.8.4). */
export function victoryPoints(game: GameState): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const side of sides(game)) totals[side] = 0
  for (const ship of game.ships) {
    const earned = pointsAgainst(ship)
    for (const side of sides(game)) {
      if (side !== ship.side) totals[side] += earned
    }
  }
  for (const side of Object.keys(totals)) totals[side] = Math.round(totals[side] * 10) / 10
  return totals
}

// ---------------------------------------------------------------------------
// Segment transitions (A3)
// ---------------------------------------------------------------------------

/** Run automatic effects on entering a segment, then advance the pointer. */
export function advanceSegment(game: GameState): void {
  runSegmentExit(game)

  const segments = PHASE_SEGMENTS[game.phase]
  const index = segments.indexOf(game.segment)
  if (index < segments.length - 1) {
    game.segment = segments[index + 1]
  } else {
    const phaseIndex = PHASE_ORDER.indexOf(game.phase)
    if (phaseIndex < PHASE_ORDER.length - 1) {
      game.phase = PHASE_ORDER[phaseIndex + 1]
      game.segment = PHASE_SEGMENTS[game.phase][0]
    } else {
      startNewRound(game)
      return
    }
  }
  runSegmentEnter(game)
}

function runSegmentExit(game: GameState): void {
  switch (game.segment) {
    case 'resource-allocation': {
      // Commit allocations: spend batteries, repair and reinforce shields, set
      // GEN SYS. Arming points left unspent are lost with the segment (E4.2.10).
      for (const ship of activeShips(game)) {
        if (ship.derelict) continue // E11.2.4
        const result = commitAllocation(ship)
        for (const line of result.log) pushLog(game, line)
      }
      break
    }

    case 'command': {
      // Command cards are revealed at the start of the Navigation Segment
      // (B1.9.1) — copy the plotted sensor split onto the ships now.
      for (const ship of activeShips(game)) {
        const card = game.orders[ship.id]
        if (!card) continue
        ship.sensors = { ...card.sensors }
      }
      // A formation plots one set of movement orders (C5.1.3). Sensors, weapons
      // and everything else stay independent (C5.2).
      applyFormationOrders(game)
      break
    }

    case 'navigation': {
      for (const ship of activeShips(game)) {
        const card = game.orders[ship.id]
        if (!card || ship.derelict) continue
        const result = executeMovement(ship, card)
        if (result.illegal) pushLog(game, `${ship.name}: illegal plot — ${result.illegal}`)
        if (result.stress > 0) pushLog(game, `${ship.name}: +${result.stress} stress from maneuver.`)
        applyTerrainDamage(game, ship, result.path)
      }
      // Only the lead ship's counter is on the map, so the rest of a formation
      // finish the move sharing its position exactly (C5.1.3).
      pruneFormations(game.formations, game.ships)
      for (const formation of game.formations) alignToLead(formation, game.ships)
      applyTurbulence(game)
      break
    }

    case 'combat':
      game.firedThisSegment.clear()
      // Attack markers are removed once all firing is complete (H4.3.1), and
      // the next phase starts the firing sequence again at step 1.
      game.attackedThisPhase.clear()
      game.firingStepIndex = 0
      game.coordinatedGroup = null
      break

    case 'delayed-action':
      game.shieldChangedThisPhase.clear()
      break

    case 'stress-check': {
      const ctx = damageContext(game)
      for (const ship of activeShips(game)) {
        if (ship.stressMarkers === 0 && ship.accelUsedThisRound <= ship.form.sublight.safeAccelPerRound) continue
        resolveStressCheck(ship, ctx)
      }
      break
    }

    case 'disengagement': {
      for (const ship of activeShips(game)) {
        const options = disengagementOptions(
          ship,
          enemiesOf(game, ship),
          game.scenario.bounds,
          !cloudStatus(game, ship).ftlBlocked, // K4.2.7
        )
        // Leaving a fixed map is automatic (J9.2.4); the rest are voluntary and
        // are triggered from the UI before this segment ends.
        if (options.some((o) => o.startsWith('Left the map'))) {
          ship.disengaged = true
          pushLog(game, `${ship.name} has left the map and is disengaged.`)
        }
      }
      break
    }

    default:
      break
  }
}

/**
 * Copy the lead ship's movement orders onto every other ship in its formation
 * (C5.1.3, C5.2). Only the helm order is shared — a formation never dictates a
 * ship's sensors, shields or weapons.
 */
function applyFormationOrders(game: GameState): void {
  pruneFormations(game.formations, game.ships)
  for (const formation of game.formations) {
    const lead = game.orders[formation.leadId]
    if (!lead) continue
    for (const id of formation.memberIds) {
      const card = game.orders[id]
      if (!card) continue
      card.maneuver = lead.maneuver
      card.direction = lead.direction
      card.halfSlide = lead.halfSlide
      card.accel = lead.accel
      card.speed = lead.speed
    }
  }
}

function runSegmentEnter(game: GameState): void {
  if (game.segment === 'command') {
    // Fresh command cards each combat phase (C1.1.1).
    game.orders = {}
    for (const ship of activeShips(game)) game.orders[ship.id] = defaultCommandCard(ship)
  }
}

function startNewRound(game: GameState): void {
  game.round += 1
  game.phase = 'engineering'
  game.segment = 'resource-allocation'
  // Lent tactical scan lasts one round and is re-assigned during the coming
  // Resource Allocation Segment (H5.2.1). The command ship itself is also
  // re-designated each round (H5.1.6); the previous choice is left in place as
  // a default the player may change.
  for (const state of Object.values(game.command)) state.assignments = []
  pruneFormations(game.formations, game.ships)
  for (const ship of activeShips(game)) beginRound(ship)
  pushLog(game, `— Round ${game.round} —`)
}

// ---------------------------------------------------------------------------
// Operations Segment helpers (A3.3.2, G1.1.5)
// ---------------------------------------------------------------------------

/**
 * Raise or lower a shield. A shield may change state once per phase, but not
 * both up and down in the same phase (G1.1.5).
 */
export function setShieldDown(game: GameState, ship: ShipState, side: ShieldSide, down: boolean): string | null {
  const key = `${ship.id}:${side}`
  if (game.shieldChangedThisPhase.has(key)) {
    return 'That shield has already changed state this phase (G1.1.5).'
  }
  if (ship.shieldsDown[side] === down) return null
  ship.shieldsDown[side] = down
  game.shieldChangedThisPhase.add(key)
  pushLog(game, `${ship.name}: ${side} shield ${down ? 'lowered' : 'raised'}.`)
  return null
}

// ---------------------------------------------------------------------------
// Terrain effects (K1.3, K2.1.6)
// ---------------------------------------------------------------------------

/** Asteroid fields damage ships that transit above the safe speed (K2.1.6). */
function applyTerrainDamage(game: GameState, ship: ShipState, path: Array<{ x: number; y: number }>): void {
  applyCloudDamage(game, ship)
  for (const feature of game.scenario.terrain) {
    if (feature.kind !== 'asteroid-field') continue
    const entered = path.some((p) => Math.hypot(p.x - feature.center.x, p.y - feature.center.y) <= feature.radius)
    if (!entered) continue

    const over = Math.abs(ship.speed) - (feature.safeSpeed ?? 0)
    if (over <= 0) continue

    // One die per point of speed over the safe speed (K2.1.6).
    const color = feature.damageDie ?? 'green'
    let total = 0
    for (let i = 0; i < over; i++) {
      const die = rollDie(color, game.rng)
      // Red `S` results count as a Heavy Hit for asteroid damage (K2.1.6).
      total += die.face === 'S' ? FACE_DAMAGE.H : FACE_DAMAGE[die.face]
    }
    if (total === 0) continue

    // Damage strikes the front shield moving forward, aft in reverse (K2.1.6).
    const side: ShieldSide = ship.speed < 0 ? 'A' : 'F'
    pushLog(game, `${ship.name} takes ${total} damage transiting ${feature.name}.`)
    applyVolley(ship, { standard: total, leak: 0, structurePenetration: 0, side }, damageContext(game))
  }
}

/**
 * Speed damage inside a nebula or gas cloud (K4.2.2, K5.2.2): one blue die per
 * point of speed above the local safe speed, rolled each Navigation Segment.
 */
function applyCloudDamage(game: GameState, ship: ShipState): void {
  const conditions = cloudConditions(game.scenario)
  const dice = overspeedDice(conditions, ship)
  if (dice === 0) return

  let total = 0
  for (let i = 0; i < dice; i++) {
    const die = rollDie('blue', game.rng)
    total += die.face === 'S' ? 0 : FACE_DAMAGE[die.face]
  }
  if (total === 0) return

  const where = cloudAt(conditions.clouds, ship.placement.position)
  const side: ShieldSide = ship.speed < 0 ? 'A' : 'F'
  pushLog(
    game,
    `${ship.name} takes ${total} damage running at speed ${Math.abs(ship.speed)} ` +
      `inside ${where ? where.name : 'the nebula'} (${where ? 'K5.2.2' : 'K4.2.2'}).`,
  )
  applyVolley(
    ship,
    {
      standard: total,
      leak: 0,
      structurePenetration: 0,
      side,
      shieldsInoperative: shieldsInoperative(conditions, ship),
    },
    damageContext(game),
  )
}

/**
 * Turbulence (K4.2.5, optional): after movement in Phase 3, each ship inside a
 * nebula or cloud may be pushed 30 degrees off course.
 */
function applyTurbulence(game: GameState): void {
  const conditions = cloudConditions(game.scenario)
  if (!conditions.effects.turbulence || game.phase !== 'combat-3') return

  for (const ship of activeShips(game)) {
    if (ship.derelict || !underCloudEffects(conditions, ship)) continue
    const turn = turbulenceTurn(game.rng)
    if (turn === 0) continue
    ship.placement.heading = (ship.placement.heading + turn + 360) % 360
    pushLog(game, `${ship.name} is pushed ${Math.abs(turn)}° ${turn > 0 ? 'right' : 'left'} by turbulence (K4.2.5).`)
  }
}
