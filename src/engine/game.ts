import {
  applyVolley,
  currentChoices,
  drawAndResolve,
  newDeck,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageChoice,
  type DamageContext,
  type DeckState,
  type DestructionOptions,
  type VolleyDamage,
  type VolleyOutcome,
} from './damage'
// Type-only, and deliberately so: actions.ts imports this module at runtime,
// and a value import back the other way would be a genuine cycle.
import type { GameAction } from './actions'
import { applyHeldVolley, type HeldVolley } from './combat'
import {
  commandSystemBoxes,
  hasCommandSystems,
  lentTacticalScan,
  newCommandState,
  type CommandState,
} from './command'
import {
  bestDetection,
  bonusSearch,
  cloakEffects,
  cloakFullyPowered,
  cutCloakPower,
  detectionBy,
  underCloakRestrictions,
  damageSearchDice,
  firingPermission,
  isCloaked,
  disengageCloak,
  freePlacementLegal,
  maneuverAllowedWhileCloaked,
  newCloakState,
  positionIsHidden,
  speedSearchDice,
  DETECTION_LABELS,
  type CloakEffects,
  type CloakState,
} from './cloaking'
import {
  checkOneAttackPerPhase,
  attackKey,
  validateCoordinatedFire,
  FIRING_STEPS,
  type FiringStep,
} from './coordinatedFire'
import { FACE_DAMAGE, rollDice, rollDie, Rng } from './dice'
import { commitAllocation, forfeitUnspentArming } from './engineering'
import {
  alignToLead,
  formationOf,
  pruneFormations,
  type Formation,
} from './formation'
import {
  actualRange,
  arcTo,
  canBearOn,
  distance,
  distanceToSegment,
  hasLineOfSight,
  shieldsFacing,
  type CircleObstacle,
} from './geometry'
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
import {
  boardersAboard,
  boardingSides,
  capturedFtlAvailable,
  capturedRefusal,
  resolveBoarding,
  type BoardingOutcome,
} from './boarding'
import { hasCloak } from './cloaking'
import {
  applyDefensiveFire,
  endurance,
  impactShield,
  isHeadOn,
  overflies,
  overflightShield,
  isHoming,
  isMissile as isMissileWeapon,
  tractorHomingWeapon,
  jammingPenalty,
  launchHomingWeapon,
  moveHomingWeapon,
  resolveHomingVolley,
  type HomingWeapon,
} from './homing'
import {
  addInfoPoints,
  OPERATIONS_STEPS,
  scanRefusal,
  scanYield,
  systemPower,
  transport,
  transportRefusal,
  transporterRange,
  type InfoLedger,
  type OperationsStep,
  type ScanTarget,
} from './operations'
import { scanCapability, scoutSupportFor, type ScoutSupport } from './scouting'
import {
  crewVictoryPoints,
  evacRefusal,
  evacuateByTransporter,
  podMayLand,
  podPosition,
  podRefusal,
  type EscapePod,
} from './abandonShip'
import {
  craftOf,
  dockingRefusal,
  isDestroyed as craftDestroyed,
  jammingFromShuttles,
  launchPosition,
  launchRefusal,
  captureRefusal,
  jammingLaunchRefusal,
  moveProbe,
  moveRefusal,
  isProbeCapableLauncher,
  probeLaunchRefusal,
  probeStillWorks,
  torpedoProbeRefusal,
  PROBE_INFO_PER_PHASE,
  recoveryAllowance,
  recoveryRefusal,
  smallTargetDamage,
  HELD_TARGET_FACE,
  type SmallTargetVolley,
  scuttledJammers,
  type SmallCraft,
  type SmallCraftKind,
} from './smallCraft'
import {
  airframeJamming,
  airframeSpeed,
  CONFIG_LABELS,
  currentConfig,
  currentLoadout,
  dogfight,
  flightCasualties,
  flightDestroyed,
  flightLaunchRefusal,
  flightMoveRefusal,
  flightRecoveryRefusal,
  hangarCapacity,
  launchPositionFor,
  loadoutOf,
  MAX_FLIGHT_SIZE,
  strike,
  strikeExpendsLoad,
  type FighterConfigKind,
  type Flight,
} from './fighters'
import { fighterCard, FIGHTER_CARDS } from '../data/fighters'
import {
  adjustedSpeed,
  beamsAvailable,
  contestLink,
  isLinked,
  ftlBlockedBy,
  linkBetween,
  lockOnSmall,
  lockOnStarship,
  lockRefusal,
  displaceRefusal,
  displacedPosition,
  pruneLinks,
  tractorPower,
  type TractorLink,
} from './tractor'
import {
  disengagementOptions,
  executeMovement,
  resolveStressCheck,
  type MapBounds,
} from './navigation'
import {
  newMissionStates,
  missionPoints,
  runRescueMissions,
  scoreHoldMissions,
  updateCargoMissions,
  type MissionDef,
  type MissionState,
} from './missions'
import {
  beginRound,
  clampSensors,
  crewIsArmed,
  damageLevelAt,
  mountIsReady,
  structureRemaining,
  structureTotal,
  undamagedSystemBoxes,
  VICTORY_FRACTION,
  type ShipState,
} from './shipState'
import type {
  CommandCard,
  Phase,
  Placement,
  Point,
  Segment,
  ShieldSide,
  SystemKind,
  WeaponSystemDef,
} from './types'

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
  /** Asteroid fields only: printed density, which colours the counter (K2.1.2). */
  density?: 'light' | 'medium' | 'high' | 'extreme'
  /** Gas clouds only: information points needed to find a hidden unit (K5.2.3). */
  scan?: number
}

/**
 * "Whenever any part of a unit's base overlaps the counter" (K2.1.4): the
 * designer's note says to treat the terrain counter as 3/4 inch larger all
 * round, which is exactly half a 1.5-inch ship base.
 */
export const BASE_OVERLAP = 0.75

/** Asteroid fields whose counter this ship's base overlaps (K2.1.4). */
export function asteroidFieldsAt(terrain: Terrain[], position: { x: number; y: number }): Terrain[] {
  return terrain.filter(
    (t) =>
      t.kind === 'asteroid-field' &&
      Math.hypot(position.x - t.center.x, position.y - t.center.y) <= t.radius + BASE_OVERLAP,
  )
}

/**
 * Defender rerolls from asteroid cover (K2.1.8): each field whose counter the
 * line of sight crosses, or that either ship overlaps, adds its printed cover
 * diamonds. Cumulative across every field involved.
 */
export function asteroidCoverRerolls(game: GameState, attacker: ShipState, target: ShipState): number {
  const a = attacker.placement.position
  const b = target.placement.position
  let total = 0
  for (const feature of game.scenario.terrain) {
    if (feature.kind !== 'asteroid-field' || !feature.cover) continue
    const involved =
      Math.hypot(a.x - feature.center.x, a.y - feature.center.y) <= feature.radius + BASE_OVERLAP ||
      Math.hypot(b.x - feature.center.x, b.y - feature.center.y) <= feature.radius + BASE_OVERLAP ||
      distanceToSegment(feature.center, a, b) < feature.radius
    if (involved) total += feature.cover
  }
  return total
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
  /**
   * A side held to a speed for the opening round — the ambushed ship that has
   * not realised yet (S3.3, S3.4). Its plot is capped rather than refused, so
   * the player is told the ship will not go faster, not told off.
   */
  speedLimit?: { side: string; round: number; speed: number }
  /**
   * Information points a side must gather on a scanned object before it may
   * call the mission a success, and the object it must gather them from
   * (S3.2). The threshold is worked out from the recon force's own SCNC boxes.
   */
  recon?: { side: string; targetId: string }
  /** Terrain the scenario rolls for itself when the player picks none (S3.5). */
  defaultTerrain?: 'roll' | number
  /** Objectives other than killing: hills to hold, flags to run, souls to lift. */
  missions?: MissionDef[]
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

/**
 * Everything the Operations Segment tracks (Section J). Grouped rather than
 * spread across GameState because it all resets together on the same clocks:
 * some per phase, some per round.
 */
export interface OperationsState {
  /** Where in Steps A–E the segment currently is (J1.2.1). */
  step: OperationsStep
  /** The one system each ship runs at maximum this phase (J1.1.2). */
  maxSystem: Record<string, SystemKind | null>
  /** Tractor beam links in force (J3). */
  links: TractorLink[]
  /** Information points gathered, by side and object (J4.2.3). */
  info: InfoLedger
  /** `shipId:objectId` pairs already scanned this phase (J4.1.4). */
  scannedThisPhase: Set<string>
  /** Marine squads beamed this phase, per ship (J5.2.2). */
  transportedThisPhase: Record<string, number>
  /** Ships that launched a shuttle this phase (J8.1.2). */
  launchedThisPhase: Set<string>
  /** Fighter flights launched this phase, per ship — one per LNCH box. */
  flightsLaunchedThisPhase: Record<string, number>
  /** Fighter flights recovered this phase, per ship — one per LNDG box. */
  flightsRecoveredThisPhase: Record<string, number>
  /** Shuttles recovered this phase, per ship (J8.1.2, J8.1.3). */
  recoveredThisPhase: Record<string, number>
  /** Shuttles that docked onto each ship this phase (J8.2.6). */
  dockedThisPhase: Record<string, number>
  /** Probes launched this round, per ship (J7.2.1). */
  probesThisRound: Record<string, number>
  /** `shipId:side` → squads attacking the ship instead of its marines (J6.2.4). */
  sabotage: Record<string, number>
  /**
   * Beams each ship has already committed to a lock-on attempt this segment
   * (J3.3.1). A beam gets one try, hit or miss, and releasing a target spends
   * that beam's try too (J3.2.3, J3.3.2) — without this a captain could roll
   * the same beam until the dice agreed.
   */
  lockAttemptsThisPhase: Record<string, number>
  /**
   * `sourceId->targetId` for links broken this phase. J3.6 will not have them
   * reestablished until the following one.
   */
  brokenThisPhase: Set<string>
  /** Ships that have already made the beam prove itself this phase (J3.6.1). */
  contestedThisPhase: Set<string>
  /**
   * `shipId:side` boarding actions already fought this Boarding Combat Segment
   * (J6.2.1). One round of combat a round: without this, a captain who pressed
   * the attack deliberately had it resolved a second time when the segment
   * closed, and took two rounds of casualties for one.
   */
  boardingFought: Set<string>
}

export function newOperationsState(): OperationsState {
  return {
    step: OPERATIONS_STEPS[0],
    maxSystem: {},
    links: [],
    info: {},
    scannedThisPhase: new Set(),
    transportedThisPhase: {},
    launchedThisPhase: new Set(),
    flightsLaunchedThisPhase: {},
    flightsRecoveredThisPhase: {},
    recoveredThisPhase: {},
    dockedThisPhase: {},
    probesThisRound: {},
    sabotage: {},
    lockAttemptsThisPhase: {},
    brokenThisPhase: new Set(),
    contestedThisPhase: new Set(),
    boardingFought: new Set(),
  }
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
  /**
   * Volleys rolled but not yet landed: ships with tied Tactical Scans fire
   * simultaneously and their damage takes effect simultaneously (H2.4.2), so
   * a tie group's damage is held here until the whole group has fired or
   * passed.
   */
  pendingVolleys: HeldVolley[]
  /**
   * Damage-card choices a player has already made, waiting to be consumed by
   * the action that draws those cards (E8.4.1). Written by
   * `queue-damage-choices` and emptied as the cards resolve, so a battle file
   * replays the captain's decisions instead of re-deciding them.
   */
  damageScript: DamageChoice[]
  /**
   * A damaging action held in mid-air while another console answers its
   * damage-card choices (online matches).
   *
   * The cards hand their choices to the *defender* (E8.4.1), but the console
   * that resolves a volley is the attacker's — it cannot stop mid-resolution
   * to ask a browser on the other side of the wire. So instead of resolving,
   * it journals the action here with the choices answered so far, and the
   * battle holds: every other action is refused until the console commanding
   * `awaiting` extends the script with its player's answers and, once the
   * script is complete, lands the action with `resolve-staged-action`. Being
   * journalled like everything else, the hold survives refreshes and replays
   * identically on every console.
   */
  stagedAction: StagedAction | null
  /**
   * The table's public record of shield punishment: every volley resolves in
   * the open — the struck side is declared and the absorption narrated — so
   * both players can tally what each facing has soaked. Keyed by ship id,
   * then shield side; counts shield boxes seen absorbed. Repairs happen in
   * secret and are NOT reflected, which is exactly a human's uncertainty.
   */
  shieldHitsSeen: Record<string, Partial<Record<ShieldSide, number>>>
  /** Ships that have raised or lowered a shield this phase (G1.1.5). */
  shieldChangedThisPhase: Set<string>
  /** Command ship and lent tactical scan, per side, for this round (H5.2). */
  command: Record<string, CommandState>
  /** H4 Coordinated Fire is optional (H4.1) and off unless switched on. */
  coordinatedFire: boolean
  /**
   * Optional batteries (B2.5): stored power may be spent during a combat
   * phase's Command Segment, not only at Resource Allocation. Chosen before
   * the game, and carried in the setup so a replay plays the same game.
   */
  optionalBatteries: boolean
  /**
   * Both sides must signal ready before a segment closes (online matches).
   * The printed game plots in secret and reveals together (B1.9.1), which a
   * shared table enforces by itself and two browsers do not: without this,
   * either player can close the Command Segment while the other is still
   * writing, and the half-written card is what moves.
   */
  readyGate: boolean
  /** Sides that have signalled ready for the segment in progress. */
  readySides: string[]
  /** Position in the ten-step firing sequence while H4 is in force (H4.2.3). */
  firingStepIndex: number
  /** `faction->targetId` pairs already attacked this phase (H4.3.1). */
  attackedThisPhase: Set<string>
  /** The coordinated attack declared on the current step, if any (H4.5). */
  coordinatedGroup: CoordinatedGroup | null
  /** Ships flying as one counter (C5). */
  formations: Formation[]
  /** Cloak state per ship, for ships that carry one (H6). */
  cloaks: Record<string, CloakState>
  /** Homing weapons in flight (E5). */
  homing: HomingWeapon[]

  /** Live objective state, one entry per scenario mission, in order. */
  missions: MissionState[]
  /** E5.10 jamming against homing weapons is optional; off by default. */
  jammingVsHoming: boolean
  /** Section J operations: tractor beams, scans, transporters, flight ops. */
  ops: OperationsState
  /** Shuttles and probes on the map (E12, J7, J8). */
  smallCraft: SmallCraft[]
  /** Fighter flights on the map. Package A of the Apr 2026 outline. */
  flights: Flight[]
  /**
   * Serial numbers for the counters this battle puts on the map.
   *
   * They live on the game rather than in a module counter because a journal
   * names craft and flights by id: a module counter keeps climbing across
   * battles, so replaying an old journal in a tab that has since played
   * another game hands the same launch a different id, and every `move-craft`
   * after it addresses a counter that does not exist. Counting per game makes
   * (setup + journal) reproduce the same ids every time, which is the whole
   * contract replay, undo and online sync are built on.
   */
  counters: { craft: number; flight: number }
  /** Escape pods adrift, waiting for somebody to pick them up (E11.6). */
  escapePods: EscapePod[]
  /** Crew units in safe hands, credited to the side holding them (E11.4.2). */
  crewRescued: Record<string, number>
  options: DestructionOptions
}

/** A damaging action mid-relay: what will land, and whose answers it waits on. */
export interface StagedAction {
  /** The action to apply once every damage-card choice has an answer. */
  action: GameAction
  /** The answers gathered so far, in the order the resolution asks. */
  choices: DamageChoice[]
  /** The side whose console must answer the next unanswered choice. */
  awaiting: string
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
  optionalBatteries?: boolean
  readyGate?: boolean
  /** Play with the optional jamming-versus-homing rules (E5.10). */
  jammingVsHoming?: boolean
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
  // Every ship that carries a cloak gets a hidden track, disengaged (H6.1).
  const cloaks: Record<string, CloakState> = {}
  for (const ship of args.ships) {
    if (hasCloak(ship)) cloaks[ship.id] = newCloakState(ship.placement)
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
    pendingVolleys: [],
    damageScript: [],
    stagedAction: null,
    shieldHitsSeen: {},
    shieldChangedThisPhase: new Set(),
    command,
    coordinatedFire: args.coordinatedFire ?? false,
    optionalBatteries: args.optionalBatteries ?? false,
    readyGate: args.readyGate ?? false,
    readySides: [],
    firingStepIndex: 0,
    attackedThisPhase: new Set(),
    coordinatedGroup: null,
    formations: [],
    cloaks,
    homing: [],
    missions: newMissionStates(args.scenario.missions ?? []),
    jammingVsHoming: args.jammingVsHoming ?? false,
    ops: newOperationsState(),
    smallCraft: [],
    flights: [],
    counters: { craft: 0, flight: 0 },
    escapePods: [],
    crewRescued: {},
    options,
  }
  for (const ship of game.ships) beginRound(ship)
  pushLog(game, `Round 1 — ${args.scenario.name}`)
  return game
}

export function pushLog(game: GameState, message: string): void {
  game.log.push({ round: game.round, phase: game.phase, segment: game.segment, message })
}

/**
 * A throwaway copy of the whole battle.
 *
 * Used to ask a resolution what it will do before letting it do it — the
 * engine is deterministic, so a copy taken now draws exactly the cards the
 * original is about to. `structuredClone` handles the state, including its
 * Sets; only the RNG needs its prototype back, being the one class instance in
 * here rather than plain data.
 */
export function cloneGame(game: GameState): GameState {
  const copy = structuredClone(game)
  Object.setPrototypeOf(copy.rng, Rng.prototype)
  return copy
}

/**
 * The sides that have to agree before a segment closes: everyone still in the
 * battle. A side whose last hull is gone or gone home has nothing left to
 * plot and cannot be waited for.
 */
export function sidesAwaited(game: GameState): string[] {
  const sides = new Set(activeShips(game).map((ship) => ship.side))
  return [...sides].sort()
}

/** Whether every side has signalled ready for the segment in progress. */
export function everyoneReady(game: GameState): boolean {
  const awaited = sidesAwaited(game)
  return awaited.length > 0 && awaited.every((side) => game.readySides.includes(side))
}

export function damageContext(game: GameState): DamageContext {
  return {
    deck: game.deck,
    rng: game.rng,
    // The probe's provider if one is installed, otherwise the queued script,
    // otherwise the doctrine (B: nobody is at the console).
    choices: currentChoices(game.damageScript),
    log: (message) => pushLog(game, message),
    // Explosions reach neighbours, and everyone sharing a formation's counter
    // takes the blast on the aft shield (E11.3.2, E11.3.4, C5).
    ships: game.ships,
    formations: game.formations,
    // A cloaked ship has no shields at all: they drop the moment the cloak
    // engages, and anything that reaches the hull goes straight inside
    // (H6.4.1). Weapon fire says so through the volley as well; this catches
    // terrain, exploding neighbours, and every other source.
    shieldsBypassed: (ship) => shipUnderCloakRestrictions(game, ship),
  }
}

/** Note publicly-observed shield absorption on a facing — the whole table saw it. */
export function recordShieldHit(
  game: GameState,
  targetId: string,
  side: ShieldSide,
  absorbed: number,
): void {
  if (absorbed <= 0) return
  const record = (game.shieldHitsSeen[targetId] ??= {})
  record[side] = (record[side] ?? 0) + absorbed
}

/** One held volley, landed: what the flush applied and what it did. */
export interface FlushedVolley {
  attackerId: string
  attackerName: string
  targetId: string
  damage: VolleyDamage
  outcome: VolleyOutcome
}

/**
 * Land every held volley, in firing order (H2.4.2). Called when a Tactical
 * Scan tie group has completely fired or passed — and defensively when the
 * Combat Segment closes, so held damage can never leak past its phase.
 */
export function flushPendingVolleys(game: GameState): FlushedVolley[] {
  if (game.pendingVolleys.length === 0) return []
  const flushed: FlushedVolley[] = []
  for (const held of game.pendingVolleys) {
    const target = game.ships.find((s) => s.id === held.targetId)
    // A tie-mate's held volley may already have finished the target; the
    // remaining damage is simultaneous overkill and changes nothing.
    if (!target || target.destroyed || target.disengaged) continue
    const outcome = applyHeldVolley(target, held, damageContext(game))
    recordShieldHit(game, target.id, held.damage.side, outcome.greenAbsorbed + outcome.blueAbsorbed)
    pushLog(
      game,
      `${held.attackerName}'s held volley lands on ${target.name}: ` +
        `${outcome.greenAbsorbed + outcome.blueAbsorbed} absorbed by shields, ` +
        `${outcome.armorAbsorbed} by armor, ${outcome.internal} internal (H2.4.2).`,
    )
    flushed.push({
      attackerId: held.attackerId,
      attackerName: held.attackerName,
      targetId: held.targetId,
      damage: held.damage,
      outcome,
    })
  }
  game.pendingVolleys = []
  return flushed
}

/**
 * Cloaking restrictions on one volley (H6.4.2, H6.4.11, H6.14), ready to spread
 * into a `VolleyRequest` alongside `cloudModifiers`.
 */
export function cloakModifiers(
  game: GameState,
  attacker: ShipState,
  target: ShipState,
): { attackerCloaked: boolean; targetCloaked: boolean; targetUnshootable?: string } {
  // Aiming a ship at itself is how the UI asks "may I fire at all?" before a
  // target is chosen; its own cloak still answers.
  const targetCloak = target.id === attacker.id ? undefined : game.cloaks[target.id]
  const cloaked = isCloaked(targetCloak)
  const permission = cloaked
    ? firingPermission(targetCloak!, attacker.id)
    : { mayFire: true, degraded: false, reason: undefined }
  return {
    attackerCloaked: shipUnderCloakRestrictions(game, attacker),
    targetCloaked: cloaked,
    ...(permission.mayFire ? {} : { targetUnshootable: permission.reason }),
  }
}

/**
 * Scout targeting and area jamming applying to one volley (H3.4, H3.5), plus
 * the single point a jamming shuttle lends the ship that launched it (J8.4.1).
 */
export function scoutSupport(game: GameState, attacker: ShipState, target: ShipState): ScoutSupport {
  const support = scoutSupportFor(attacker, target, game.ships)
  const fromShuttle = jammingFromShuttles(game.smallCraft, target)
  if (fromShuttle > 0) {
    support.jamming += fromShuttle
    support.jammingFrom = support.jammingFrom
      ? `${support.jammingFrom} + jamming shuttle`
      : 'jamming shuttle'
  }
  return support
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
  const cloak = game.cloaks[target.id]
  const cloaked = isCloaked(cloak)
  return {
    // A Track is enough to shoot at a cloaked ship, but only through degraded
    // fire control (H6.14.3).
    degradedFireControl:
      degradedByClouds(conditions, attacker, target) ||
      (cloaked && bestDetection(cloak!) === 2),
    lowSpeedNegated: lowSpeedPenaltyNegated(conditions, target),
    // A cloaked ship's shields are down whatever the terrain (H6.4.1).
    targetShieldsInoperative:
      shieldsInoperative(conditions, target) || shipUnderCloakRestrictions(game, target),
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
// Cloaking (H6)
// ---------------------------------------------------------------------------

export function cloakOf(game: GameState, ship: ShipState): CloakState | undefined {
  return game.cloaks[ship.id]
}

export function shipIsCloaked(game: GameState, ship: ShipState): boolean {
  return isCloaked(game.cloaks[ship.id])
}

/**
 * Whether the ship is living under the cloak's restrictions (H6.4) — which is
 * not the same question as whether it is hidden.
 *
 * A cloak torn down for want of power keeps every one of its costs for the
 * rest of Phase 1 and gives back none of its concealment (H6.6.8): the ship is
 * in plain sight and can be shot at normally, but its shields are still down,
 * its guns still cold, its scans, tractors, transporters and command link all
 * still dead. Use this wherever the question is what the *ship* can do, and
 * `shipIsCloaked` wherever it is what others can see or do to it.
 */
export function shipUnderCloakRestrictions(game: GameState, ship: ShipState): boolean {
  return underCloakRestrictions(game.cloaks[ship.id], game.round, game.phase)
}

/** What the cloak is currently costing this ship (H6.4). */
export function cloakEffectsOn(game: GameState, ship: ShipState): CloakEffects {
  return cloakEffects(game.cloaks[ship.id])
}

/**
 * Where a ship is drawn. An undetected cloaked ship shows only its datum — the
 * spot it was last seen (H6.2.2) — while a detected one is back on the map.
 */
export function displayPlacement(game: GameState, ship: ShipState) {
  const cloak = game.cloaks[ship.id]
  return cloak && positionIsHidden(cloak) ? cloak.datum : ship.placement
}

/** Detection level the enemy as a whole has on a cloaked ship (H6.2). */
export function detectionLevelOf(game: GameState, ship: ShipState): number {
  const cloak = game.cloaks[ship.id]
  return cloak && cloak.engaged ? bestDetection(cloak) : 3
}

/**
 * Bonus search rolls a cloaked ship hands its hunters this segment (H6.15).
 * Speed above 2 and every four points of damage each grant dice.
 */
export function bonusSearchDice(game: GameState, ship: ShipState, damageTaken = 0): number {
  const cloak = game.cloaks[ship.id]
  if (!cloak?.engaged) return 0
  return speedSearchDice(ship.speed) + damageSearchDice(damageTaken)
}

/**
 * The events that hand a cloaked ship's hunters a free roll (H6.15).
 *
 * This is what gives the speed-2 restriction its teeth: a cloak is not a
 * cloaking *field* that fails above speed two, it is a ship that starts making
 * noise. Every enemy in search range rolls, one die per point of speed over
 * two, or one per four points of damage the hull just took, or one per small
 * craft it just let out of the bay. Any `H` moves that searcher one rung up
 * the ladder — and still only one rung per segment (H6.15.1).
 */
function extraSearches(game: GameState, ship: ShipState, dice: number, why: string): void {
  const cloak = game.cloaks[ship.id]
  if (!cloak?.engaged || dice <= 0) return
  for (const hunter of activeShips(game)) {
    if (hunter.side === ship.side || hunter.derelict) continue
    // H6.9.5: a ship running its own cloak is not hunting anyone.
    if (shipIsCloaked(game, hunter)) continue
    const out = bonusSearch(hunter, ship, cloak, dice, game.rng)
    if (out.faces.length === 0) continue
    pushLog(
      game,
      `${hunter.name} searches for ${ship.name} — ${why}: ${out.faces.join(' ')} — ` +
        (out.detected ? `${DETECTION_LABELS[out.to]} (H6.15).` : 'nothing (H6.15).'),
    )
  }
}

/**
 * H6.15.2 — a cloaked ship above speed two is heard. Rolled when the command
 * cards turn over, which is when the table learns its speed (H6.5.4).
 */
function speedSearches(game: GameState): void {
  for (const ship of activeShips(game)) {
    const dice = speedSearchDice(ship.speed)
    if (dice > 0) extraSearches(game, ship, dice, `speed ${Math.abs(ship.speed)}`)
  }
}

/**
 * H6.15.3 — every four points of damage a cloaked hull takes is a flare in the
 * dark. Called wherever damage lands on a ship, with the total after any
 * reduction has already been applied.
 */
export function damageRevealsCloak(game: GameState, ship: ShipState, damage: number): void {
  const dice = damageSearchDice(damage)
  if (dice > 0) extraSearches(game, ship, dice, `${damage} damage taken`)
}

/** H6.15.4 — a small craft leaving the bay gives the ship's position away. */
export function launchRevealsCloak(game: GameState, ship: ShipState, craft = 1): void {
  extraSearches(game, ship, craft, 'small craft launched')
}

/**
 * The long-approach escape hatch (H6.8.7).
 *
 * A ship that has run silent for six full rounds has had time to be anywhere
 * within eighteen inches of its datum, so rather than replay eighteen phases of
 * hidden movement it simply says where it ended up: any point in that circle,
 * any heading, at a speed the cloak could have held. It decloaks in the act —
 * the whole point is to arrive.
 */
export function repositionCloaked(
  game: GameState,
  ship: ShipState,
  to: Placement,
  speed: number,
): string | null {
  const cloak = game.cloaks[ship.id]
  if (!cloak?.engaged) return `${ship.name} is not cloaked.`
  if (!positionIsHidden(cloak)) {
    return `${ship.name} has been found; it moves from where it is (H6.8.2).`
  }
  const illegal = freePlacementLegal(cloak, to, speed)
  if (illegal) return illegal
  ship.placement = { position: { ...to.position }, heading: to.heading }
  ship.speed = speed
  pushLog(
    game,
    `${ship.name} reappears ${actualRange(cloak.datum.position, to.position)}" from its datum ` +
      `after ${cloak.speedLog.length} phases cloaked, at speed ${speed} (H6.8.7).`,
  )
  disengageCloak(cloak)
  return null
}

/**
 * A cloak whose power was not renewed (H6.3.2, H6.6.8).
 *
 * Allocation has just been committed, so this is the moment the ship finds out
 * it cannot keep the cloak up. It must come off during the Operations Segment
 * of Phase 1 — the captain does not get to choose. And if the power went
 * before the cloak had served its minimum phase, the drop is violent enough to
 * damage the system, which then stays dead until damage control repairs it,
 * while the ship spends the rest of Phase 1 with every cloaking restriction
 * still on it and none of the concealment.
 */
function cutUnpoweredCloaks(game: GameState): void {
  for (const ship of activeShips(game)) {
    const cloak = game.cloaks[ship.id]
    if (!cloak?.engaged || cloakFullyPowered(ship)) continue
    const { damaged } = cutCloakPower(cloak, game.round)
    if (damaged) {
      ship.systemDamage['CLOAK'] = (ship.systemDamage['CLOAK'] ?? 0) + 1
      pushLog(
        game,
        `${ship.name} loses power to its cloak before it had run a full phase: the system is ` +
          `damaged and the ship stays under cloaking restrictions through Phase 1 (H6.6.8).`,
      )
    } else {
      pushLog(game, `${ship.name} has stopped powering its cloak; it decloaks in Phase 1 (H6.3.2).`)
    }
  }
}

/**
 * The forced decloak itself, at Operations step A of Phase 1 (H6.3.2).
 */
function resolveForcedDecloaks(game: GameState): void {
  if (game.phase !== 'combat-1') return
  for (const ship of activeShips(game)) {
    const cloak = game.cloaks[ship.id]
    if (!cloak?.engaged || !cloak.powerCut) continue
    disengageCloak(cloak)
    pushLog(game, `${ship.name} decloaks: there is no power for it (H6.3.2).`)
  }
}

/** Nebulae blind cloaks: all the restrictions, none of the benefit (H6.8.11). */
export function cloakSuppressedByTerrain(game: GameState, ship: ShipState): boolean {
  return underCloudEffects(cloudConditions(game.scenario), ship)
}

/**
 * A cloak inside a nebula hides nothing (H6.8.11(2)): "Cloaking systems don't
 * prevent detection in a nebula, and cloaked ships suffer all restrictions of
 * being cloaked without any benefits."
 *
 * Modelled by handing every enemy a Target Lock rather than by carving an
 * exception into concealment. It comes to the same thing — position known,
 * normal weapon fire, no degraded control — and it keeps the ship's own
 * restrictions running off `engaged`, which is exactly what the rule asks for.
 * A lock granted this way then decays like any other if the ship gets out and
 * shakes its pursuers (H6.13).
 */
function nebulaRevealsCloaks(game: GameState): void {
  for (const ship of activeShips(game)) {
    const cloak = game.cloaks[ship.id]
    if (!cloak?.engaged || !cloakSuppressedByTerrain(game, ship)) continue
    const hunters = activeShips(game).filter((s) => s.side !== ship.side && !s.derelict)
    const newly = hunters.filter((h) => detectionBy(cloak, h.id) < 3)
    if (newly.length === 0) continue
    for (const hunter of newly) cloak.detection[hunter.id] = 3
    pushLog(
      game,
      `${ship.name}'s cloak gives it nothing in the cloud: it is fully tracked while keeping ` +
        `every cloaking restriction (H6.8.11).`,
    )
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * A scenario's opening-round speed limit, where one binds this ship (S3.3,
 * S3.4). The ambushed captain has not realised yet: the ship holds station
 * for the round no matter what the helm plots.
 */
export function speedLimitFor(game: GameState, ship: ShipState): number | undefined {
  const limit = game.scenario.speedLimit
  if (!limit || limit.side !== ship.side || game.round > limit.round) return undefined
  return limit.speed
}

export function activeShips(game: GameState): ShipState[] {
  return game.ships.filter((s) => !s.destroyed && !s.disengaged && s.arrivesRound <= game.round)
}

/**
 * How the recon mission stands (S3.2).
 *
 * The raider's requirement is set by the sciences it brought: twenty points
 * for one SCNC box and ten more for every box after that. Damage is beside
 * the point — the information only counts if the ship leaves with it, so the
 * mission is only *done* once the hull has disengaged.
 */
export interface ReconProgress {
  side: string
  target: string
  gathered: number
  required: number
  away: boolean
  succeeded: boolean
}

export function reconProgress(game: GameState): ReconProgress | null {
  const recon = game.scenario.recon
  if (!recon) return null
  const force = game.ships.filter((s) => s.side === recon.side)
  const boxes = force.reduce(
    (sum, ship) => sum + ship.form.systems.filter((g) => g.kind === 'SCNC').reduce((n, g) => n + g.boxes, 0),
    0,
  )
  const gathered = game.ops.info[recon.side]?.[recon.targetId] ?? 0
  const required = boxes > 0 ? 10 * (boxes + 1) : 0
  // Destroyed hulls take the survey with them; only a ship that left counts.
  const away = force.some((ship) => ship.disengaged && !ship.destroyed)
  return {
    side: recon.side,
    target: recon.targetId,
    gathered,
    required,
    away,
    succeeded: gathered >= required && away,
  }
}

/** Reinforcements still on their way (S3.2), in arrival order. */
export function pendingArrivals(game: GameState): ShipState[] {
  return game.ships
    .filter((s) => !s.destroyed && s.arrivesRound > game.round)
    .sort((a, b) => a.arrivesRound - b.arrivesRound)
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
  // A ship fought by its own crew fires last, whatever its scan says (J6.3.4).
  if (crewIsArmed(ship)) return -1
  return ship.sensors.tacticalScan + (lentScanPoints(game)[ship.id] ?? 0)
}

/**
 * Arm the general crew to repel boarders (J6.3): two extra squads per size
 * class, and the ship stops being a warship for twenty rounds after the
 * fighting ends — no damage control, two points less power, and it fires
 * last. Returns a refusal, or null when the order stands.
 */
export function armCrew(game: GameState, ship: ShipState): string | null {
  if (crewIsArmed(ship)) return `${ship.name}'s crew is already under arms.`
  if (ship.capturedBy) return 'Too late — the ship is already taken (J6.3.1).'
  const raised = 2 * ship.form.sizeClass
  ship.marineSquads += raised
  // "In effect for 20 rounds after the attacking marine squads are defeated"
  // (J6.3.2); while any are still aboard the clock keeps being pushed back.
  ship.crewArmedUntil = game.round + 20
  pushLog(
    game,
    `${ship.name}: the crew is armed — ${raised} improvised squads, and a ship that can no ` +
      `longer repair, spare the power, or fire on time (J6.3.4).`,
  )
  return null
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
  // J6.2.5 — a captured ship ceases to perform any actions or functions.
  const captured = capturedRefusal(attacker, 'fire')
  if (captured) return captured
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
  const total = structureTotal(ship)
  const table = ship.form.victoryTable
  /**
   * What the table (or the S2.8.4 fractions) awards for a given box count.
   * Written as a function of the count so it can be read twice: once at the
   * ship's current damage, once at the damage it *arrived* with.
   */
  /**
   * The hull's worth is the ship's, not the form's: a scenario may have
   * priced this hull up or down (a freighter worth the raid, a monitor worth
   * nothing). The printed victory table is a table of absolute point awards
   * keyed to the book value, so it only applies while the book value stands —
   * a re-priced hull falls back to the S2.8.4 fractions of its new worth.
   */
  const value = ship.pointValue ?? ship.form.pointValue
  const printed = value === ship.form.pointValue
  const earnedAt = (damaged: number): number => {
    if (total > 0 && damaged >= total) return value
    if (printed && table && table.length > 0) {
      // Highest band whose damage threshold has been reached; levels are not
      // cumulative (S2.8.2).
      return table.reduce((best, row) => (damaged >= row.damage ? row.points : best), 0)
    }
    return value * VICTORY_FRACTION[damageLevelAt(damaged, total)]
  }

  const damaged = total - structureRemaining(ship)
  let earned = ship.destroyed ? value : earnedAt(damaged)
  if (ship.disengaged) {
    earned = Math.max(earned, value * VICTORY_FRACTION.moderate)
  }
  /**
   * A ship fielded already hurt (a cripple under rescue, a campaign hull with
   * last week's scars) concedes points only for what this battle adds. The
   * printed rule assumes every hull starts whole, so the baseline is
   * subtracted rather than woven in: destroy the wreck and you earn the gap
   * between its full value and what its wounds were already worth, not the
   * whole prize.
   */
  return Math.max(0, earned - earnedAt(ship.preDamaged ?? 0))
}

/** Victory points earned by each side (S2.8.2 – S2.8.4). */
/** The shared context every mission hook reads the battle through. */
function missionHooks(game: GameState) {
  return {
    ships: game.ships,
    round: game.round,
    log: (message: string) => pushLog(game, message),
    hidden: (ship: ShipState) => shipIsCloaked(game, ship),
    reach: (ship: ShipState) => transporterRange(ship, maxSystemOf(game, ship)),
    capacity: (ship: ShipState) => undamagedSystemBoxes(ship, 'TRAN'),
  }
}

/**
 * Bank any cargo delivery the board already shows — called from the disengage
 * action as well as the sequence hooks, because a voluntary departure can end
 * the battle before any sweep would run.
 */
export function settleCargoDeliveries(game: GameState): void {
  updateCargoMissions(game.scenario.missions ?? [], game.missions, missionHooks(game))
}

export function victoryPoints(game: GameState): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const side of sides(game)) totals[side] = 0
  // Objectives pay into the same ledger the guns do (S2.8), which is the whole
  // trick: posture, retreat and the battle's verdict follow them unmodified.
  for (const side of Object.keys(totals)) totals[side] += missionPoints(game.missions, side)
  for (const ship of game.ships) {
    // The flagship is worth double to whoever hurts it (S3.6): the scenario
    // is about command and control, so the scoring says so.
    const earned = pointsAgainst(ship) * (ship.flagship ? 2 : 1)
    for (const side of sides(game)) {
      if (side !== ship.side) totals[side] += earned
    }
  }
  // Crews saved or captured, two points each (E11.4.2). Pods still adrift go
  // to whoever is left holding the field.
  if (game.options.abandonShip) {
    const present = [...new Set(activeShips(game).map((s) => s.side))]
    const crew = crewVictoryPoints(game.crewRescued, game.escapePods, present)
    for (const [side, points] of Object.entries(crew)) {
      if (side in totals) totals[side] += points
    }
  }
  for (const side of Object.keys(totals)) totals[side] = Math.round(totals[side] * 10) / 10
  return totals
}

// ---------------------------------------------------------------------------
// Homing weapons (E5)
// ---------------------------------------------------------------------------

/**
 * Launch a homing weapon during the Offensive Fire step (E5.2). Returns an
 * error message when the launch is illegal, in which case nothing is launched.
 */
export function launchHoming(
  game: GameState,
  launcher: ShipState,
  weapon: WeaponSystemDef,
  mountIndex: number,
  target: ShipState,
  maxSpeed?: number,
): string | null {
  if (!isHoming(weapon)) return `${weapon.name} is not a homing weapon (F1.10).`
  // H6.4.2: a cloaked ship may not launch.
  if (shipUnderCloakRestrictions(game, launcher)) {
    return `${launcher.name} is cloaked and may not launch homing weapons (H6.4.2).`
  }
  // E5.2.3: a ship weaving cannot hold a launcher steady enough to use it.
  if (launcher.evasive > 0) {
    return `${launcher.name} is using evasive maneuvers and may not launch (E5.2.3).`
  }
  // H6.2 / E5.2.2: you need at least a Track on a cloaked target.
  const targetCloak = game.cloaks[target.id]
  if (isCloaked(targetCloak) && bestDetection(targetCloak!) < 2) {
    return `${launcher.name} has no Track or Lock on ${target.name} (E5.2.2).`
  }
  const state = launcher.mounts[weapon.id]?.[mountIndex]
  const mount = weapon.mounts[mountIndex]
  if (!state || !mount) return 'Unknown weapon mount.'
  if (!mountIsReady(weapon, mountIndex, state)) return `${weapon.name} is not fully armed (E4.2.3).`

  // E5.2.1: planets block a launch, but clouds and asteroids do not.
  const blockers = terrainObstacles(game.scenario.terrain.filter((t) => t.kind === 'planet' || t.kind === 'moon'))
  if (!hasLineOfSight(launcher.placement.position, target.placement.position, blockers)) {
    return 'A planet blocks the line of sight to the target (E5.2.1, K3.1.3).'
  }

  /*
   * A launcher is a weapon mount and obeys its firing arcs like any other
   * (E2.2; E6.2 Step 3 has the attacker determine the arc before choosing
   * weapons). Nothing here used to check it, so a torpedo would launch at a
   * target dead astern of a forward tube — reported from a live game, and
   * the reason the check reads exactly like direct fire's refusal.
   */
  const firingArcs = arcTo(launcher.placement.position, launcher.placement.heading, target.placement.position)
  if (!canBearOn(mount.arcs, firingArcs)) {
    return `${weapon.name} mount ${mountIndex + 1} cannot bear on the target.`
  }

  /*
   * The counter is placed against the side of the ship the firing arc covers
   * (E5.2.8), so the arc it launches through is the one the target is
   * actually in — not simply the first the mount lists. A broadside tube
   * covering SF and SA put every counter on the same side whichever way it
   * shot; where the arcs cover more than one side and the target is on the
   * boundary, the captain's choice is the first that bears (E5.2.8).
   */
  const arc = mount.arcs.find((a) => firingArcs.includes(a)) ?? mount.arcs[0]
  game.homing.push(launchHomingWeapon({ launcher, weapon, target, arc, maxSpeed }))
  state.armed = Math.max(0, state.armed - mount.armingCircles)
  if (mount.ammo !== undefined) state.ammoUsed += 1
  pushLog(game, `${launcher.name} launches ${weapon.name} at ${target.name} (E5.2).`)
  return null
}

/** Homing weapons that have reached a given ship and are waiting to resolve. */
export function impactingHoming(game: GameState, target: ShipState): HomingWeapon[] {
  return game.homing.filter((hw) => hw.targetId === target.id && hw.impacted && !hw.destroyed)
}

/**
 * Resolve every homing weapon that has reached its target (E5.4). Each shield
 * struck is a separate volley (E5.4 Step 3), and point defense damage assigned
 * to a volley is passed in per shield.
 */
export function resolveHomingImpacts(
  game: GameState,
  target: ShipState,
  pointDefenseBySide: Partial<Record<ShieldSide, number>> = {},
): void {
  const arrived = impactingHoming(game, target)
  if (arrived.length === 0) return

  const bySide = new Map<ShieldSide, HomingWeapon[]>()
  for (const hw of arrived) {
    // E5.9.1 / E5.9.2 name the facing outright; otherwise it comes off the
    // counter's bearing (E5.4 Step 2).
    const side = hw.forcedShield ?? impactShield(hw, target)
    if (!bySide.has(side)) bySide.set(side, [])
    bySide.get(side)!.push(hw)
  }

  const conditions = cloudConditions(game.scenario)
  for (const [side, group] of bySide) {
    const owner = shipById(game, group[0].ownerId)
    const def = owner?.form.weapons.find((w) => w.id === group[0].weaponId)
    if (!def) continue

    // Step 4: point defense fire, then Step 5 assigns it to the weapons.
    const defensive = pointDefenseBySide[side] ?? 0
    if (defensive > 0) {
      const { destroyed } = applyDefensiveFire(group, def, defensive)
      if (destroyed.length > 0) {
        pushLog(game, `${target.name}'s point defense destroys ${destroyed.length} incoming weapon(s) (E5.4 Step 5).`)
      }
    }

    const survivors = group.filter((hw) => !hw.destroyed && !hw.tractored)
    if (survivors.length === 0) continue

    const range = Math.floor(distance(survivors[0].position, target.placement.position))
    const volley = resolveHomingVolley(survivors, def, side, survivors[0].phasesFlown, range, game.rng)
    if (volley.standard === 0 && volley.leak === 0 && volley.structure === 0) {
      pushLog(game, `${def.name} is worn down to nothing before it strikes (F1.16.2).`)
      continue
    }

    pushLog(
      game,
      `${def.name} strikes ${target.name}'s ${side} shield for ${volley.standard} damage` +
        (volley.leak ? `, ${volley.leak} leak` : '') +
        (volley.absorbed ? ` (reduced by ${volley.absorbed} points of defensive fire)` : ''),
    )
    const outcome = applyVolley(
      target,
      {
        standard: volley.standard,
        leak: volley.leak,
        structurePenetration: volley.structure,
        side,
        shieldsInoperative:
          shieldsInoperative(conditions, target) || shipIsCloaked(game, target),
      },
      damageContext(game),
    )
    // The strike is as public as any volley: the side was declared by the
    // counter's approach and the absorption narrated — the table's shield
    // record keeps it, same as direct fire.
    recordShieldHit(game, target.id, side, outcome.greenAbsorbed + outcome.blueAbsorbed)
    damageRevealsCloak(game, target, volley.standard)
  }

  game.homing = game.homing.filter((hw) => !hw.impacted && !hw.destroyed)
}

/**
 * Impacted homing weapons nobody answered: the warheads go off anyway.
 *
 * Point defense is the defender's decision and the Resolve Impacts button is
 * where they make it — but the impact itself is not optional, and a player
 * who advanced past the Combat Segment without pressing it used to leave the
 * torpedoes frozen on the map, warheads unspent, forever (playtest report:
 * four plasma torpedoes parked against the Yorktown doing nothing). Run at
 * the moments the question expires: the Combat Segment closing, and the
 * round turning over.
 *
 * Whatever defensive fire the ship actually got off is already on the
 * counters — each shot is resolved when it is declared — so this adds none
 * and takes none away. The log distinguishes the two cases, because "the
 * warhead got through untouched" and "the gunners hit it and it came on
 * anyway" are different stories.
 */
export function resolveUnansweredImpacts(game: GameState): void {
  for (const ship of game.ships) {
    const arrived = impactingHoming(game, ship)
    if (arrived.length === 0) continue
    if (ship.destroyed || ship.disengaged) {
      // Nothing left to strike: the counters go with their target.
      game.homing = game.homing.filter((hw) => !arrived.includes(hw))
      continue
    }
    const count = `${arrived.length} unanswered impact${arrived.length === 1 ? '' : 's'}`
    const verb = arrived.length === 1 ? 'resolves' : 'resolve'
    pushLog(
      game,
      arrived.some((hw) => hw.damage > 0)
        ? `${ship.name}: ${count} ${verb} with the defensive fire already put into ${arrived.length === 1 ? 'it' : 'them'} (E5.4).`
        : `${ship.name} offers no point defense — ${count} ${verb} (E5.4).`,
    )
    resolveHomingImpacts(game, ship)
  }
}

// ---------------------------------------------------------------------------
// Segment transitions (A3)
// ---------------------------------------------------------------------------

/** Run automatic effects on entering a segment, then advance the pointer. */
export function advanceSegment(game: GameState): void {
  runSegmentExit(game)
  // E11.6.1: a hull that came apart under fire took its crew with it. Swept
  // here rather than at each place damage lands, because the only thing that
  // could have saved them — an evacuation order — is refused the moment the
  // ship is destroyed, so there is no window in between to get wrong.
  for (const ship of game.ships) {
    if (ship.destroyed) crewLostWithShip(game, ship)
  }
  // A new segment is a new question; nobody is ready for it yet.
  game.readySides = []

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
        forfeitUnspentArming(ship)
      }
      cutUnpoweredCloaks(game)
      break
    }

    case 'command': {
      // Command cards are revealed at the start of the Navigation Segment
      // (B1.9.1) — copy the plotted sensor split onto the ships now.
      for (const ship of activeShips(game)) {
        const card = game.orders[ship.id]
        if (!card) continue
        // Trimmed on the way across: the card was written a segment ago and
        // the sensors may have been shot since (H2.2.2, H2.2.3).
        ship.sensors = clampSensors(ship, card.sensors)
      }
      // A formation plots one set of movement orders (C5.1.3). Sensors, weapons
      // and everything else stay independent (C5.2).
      applyFormationOrders(game)
      // Operations step A is next, and that is where a cloak with no power to
      // hold it up comes off (H6.3.2, H6.6.2).
      resolveForcedDecloaks(game)
      break
    }

    case 'navigation': {
      // H6.15.2: the cards turn face up at the head of this segment, and a
      // cloaked ship running above speed two has just told everyone in range
      // roughly where it is — measured from where the hunters are now, before
      // anyone moves.
      speedSearches(game)
      // E5.9.1 resolves before anything moves, by definition.
      resolveHeadOnHoming(game)
      // A cloak is no help in a nebula (H6.8.11).
      nebulaRevealsCloaks(game)
      for (const ship of activeShips(game)) {
        const card = game.orders[ship.id]
        if (!card || ship.derelict) continue
        // H6.8.5(3): the cloak engages in Operations, after the card was
        // written, so a hard turn plotted in the clear has to be given up when
        // the ship slips into the dark.
        const hidden = game.cloaks[ship.id]
        if (hidden && positionIsHidden(hidden) && !maneuverAllowedWhileCloaked(card.maneuver)) {
          pushLog(
            game,
            `${ship.name} holds its course: a cloaked ship may not make that turn (H6.8.5).`,
          )
          card.maneuver = 'straight'
          card.direction = null
        }
        // A ship in a tractor link still plots its true speed but travels at
        // the adjusted one, and the difference costs no acceleration and
        // causes no stress (J3.3.4, J3.4.5).
        const towed = isLinked(ship.id, game.ops.links)
        const result = executeMovement(
          ship,
          card,
          towed ? adjustedSpeed(ship, game.ops.links, game.ships, card.speed) : undefined,
          speedLimitFor(game, ship),
        )
        if (result.illegal) pushLog(game, `${ship.name}: illegal plot — ${result.illegal}`)
        if (result.stress > 0) pushLog(game, `${ship.name}: +${result.stress} stress from maneuver.`)
        applyTerrainDamage(game, ship, result.path)
        // E5.9.2: the ship has just driven over its own incoming torpedo.
        resolveOverflownHoming(game, ship, result.path)
      }
      // Only the lead ship's counter is on the map, so the rest of a formation
      // finish the move sharing its position exactly (C5.1.3).
      pruneFormations(game.formations, game.ships)
      for (const formation of game.formations) alignToLead(formation, game.ships)
      applyTurbulence(game)
      logCloakedSpeeds(game)
      moveHomingWeapons(game)
      expireHeldMissiles(game)
      moveProbes(game)
      scuttleJammers(game)
      // J3.6.2 — a link that has been stretched past its range is broken once
      // both ships have moved.
      {
        const report = pruneLinks(game.ops.links, game.ships, (id) => positionOfObject(game, id))
        for (const [i, link] of report.broken.entries()) {
          const source = shipById(game, link.sourceId)
          pushLog(game, `Tractor lock ${source?.name ?? link.sourceId} → ${link.targetId} broken: ${report.reasons[i]}.`)
        }
        releaseHeldMissiles(game, report.broken)
      }
      // The flag is picked up where the movement left everyone (missions.ts).
      if (game.missions.length > 0) {
        updateCargoMissions(game.scenario.missions ?? [], game.missions, missionHooks(game))
      }
      break
    }

    case 'combat': {
      // Any damage still held for a tie group lands before the segment closes
      // (H2.4.2) — nothing may carry a rolled-but-unapplied volley forward.
      flushPendingVolleys(game)
      // Nor may an impacted homing weapon: the segment where the defender
      // could answer with point defense is over, so the warheads go off.
      resolveUnansweredImpacts(game)
      // J3.6.4 — a lock whose last tractor beam has been shot away lets go at
      // once, as does one whose ship has just been destroyed.
      const report = pruneLinks(game.ops.links, game.ships, (id) => positionOfObject(game, id))
      for (const [i, link] of report.broken.entries()) {
        pushLog(game, `Tractor lock on ${link.targetId} broken: ${report.reasons[i]}.`)
      }
      releaseHeldMissiles(game, report.broken)
      game.firedThisSegment.clear()
      // Attack markers are removed once all firing is complete (H4.3.1), and
      // the next phase starts the firing sequence again at step 1.
      game.attackedThisPhase.clear()
      game.firingStepIndex = 0
      game.coordinatedGroup = null
      break
    }

    case 'operations':
      // Souls come up with the segment that owns the transporters (J5).
      if (game.missions.length > 0) {
        runRescueMissions(game.scenario.missions ?? [], game.missions, missionHooks(game))
      }
      // Transmitting probes report in during Step E (J7.3.3), and Steps A-E
      // start again from the top next phase (J1.2.1).
      gatherProbeInfo(game)
      game.ops.step = OPERATIONS_STEPS[0]
      break

    case 'flight-operations':
      // Activation markers come off once every craft has had its turn (J8.2.2).
      for (const craft of game.smallCraft) craft.activated = false
      for (const flight of game.flights) {
        flight.activated = false
        flight.attacked = false
      }
      break

    case 'delayed-action':
      game.shieldChangedThisPhase.clear()
      game.ops.scannedThisPhase.clear()
      game.ops.transportedThisPhase = {}
      game.ops.launchedThisPhase.clear()
      game.ops.flightsLaunchedThisPhase = {}
      game.ops.flightsRecoveredThisPhase = {}
      game.ops.recoveredThisPhase = {}
      game.ops.dockedThisPhase = {}
      game.ops.maxSystem = {}
      resetTractorPhase(game)
      advanceCloakPhases(game)
      break

    case 'boarding-combat':
      resolveAllBoarding(game)
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
          // K4.2.7 shuts FTL down inside a cloud; J3.4.4 does the same to a
          // ship held in someone else's tractor beam; and a captured ship must
          // wait ten rounds before its captors can jump it out (J6.2.5).
          !cloudStatus(game, ship).ftlBlocked &&
            !ftlBlockedBy(ship.id, game.ops.links) &&
            capturedFtlAvailable(ship, game.round),
        )
        // Leaving a fixed map is automatic (J9.2.4); the rest are voluntary and
        // are triggered from the UI before this segment ends.
        if (options.some((o) => o.startsWith('Left the map'))) {
          ship.disengaged = true
          pushLog(game, `${ship.name} has left the map and is disengaged.`)
        }
      }
      // A departure can end the battle before the round turns over, so cargo
      // deliveries are banked here as well as at the round-end sweep — a flag
      // that left the map must be worth its points the moment it did.
      if (game.missions.length > 0) {
        updateCargoMissions(game.scenario.missions ?? [], game.missions, missionHooks(game))
      }
      break
    }

    case 'hangar-bay':
      // A3.4.4 is printed "TBD"; this is what the outline puts in it.
      runHangarBay(game)
      break

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

/**
 * Per-phase cloak bookkeeping (H6.6.7, H6.7.7): a cloak must stay on for a full
 * phase once engaged and off for one before it may be re-engaged, so both
 * counters tick at the end of every combat phase.
 */
function advanceCloakPhases(game: GameState): void {
  for (const cloak of Object.values(game.cloaks)) {
    if (cloak.engaged) cloak.phasesCloaked += 1
    else if (cloak.phasesUncloaked !== Infinity) cloak.phasesUncloaked += 1
    // A searcher may climb one level per segment, so the marker clears with the
    // phase (H6.15.1).
    cloak.raisedThisSegment = []
    cloak.evadedThisSegment = false
  }
}

/**
 * A cloaked, undetected ship records its speed for each phase instead of
 * moving on the map; that log is what it replays from its datum when it is
 * finally found (H6.5.4, H6.8.4).
 */
function logCloakedSpeeds(game: GameState): void {
  for (const ship of activeShips(game)) {
    const cloak = game.cloaks[ship.id]
    if (cloak && positionIsHidden(cloak)) cloak.speedLog.push(ship.speed)
  }
}

/**
 * Homing weapons move immediately after their target does (E5.3.1, E5.3.3).
 * Impacts are held over to the Combat Segment, where the target may answer with
 * point defense first (E5.1.7).
 */
/**
 * Head-on interceptions (E5.9.1), checked before anybody moves.
 *
 * Without this the ship simply flies past the torpedo and the torpedo, chasing
 * from behind, hits it in the back — which is the exact outcome the designer's
 * note calls unrealistic and the rule exists to prevent. If the weapon lies in
 * the arc the target is travelling into and is no further off than the target's
 * speed, it strikes the leading shield now.
 */
function resolveHeadOnHoming(game: GameState): void {
  for (const hw of game.homing) {
    if (hw.destroyed || hw.impacted || hw.tractored) continue
    const target = shipById(game, hw.targetId)
    if (!target || target.destroyed || target.disengaged) continue
    if (!isHeadOn(hw, target)) continue
    hw.impacted = true
    hw.forcedShield = overflightShield(target)
    hw.position = { ...target.placement.position }
    pushLog(
      game,
      `${hw.weaponName} intercepts ${target.name} head-on and strikes its ${hw.forcedShield} ` +
        `shield before the ship can move (E5.9.1).`,
    )
  }
}

/**
 * A ship that runs over a homing weapon aimed at it is hit as it passes
 * (E5.9.2), on the leading shield — front going forward, aft in reverse.
 */
function resolveOverflownHoming(game: GameState, ship: ShipState, path: readonly Point[]): void {
  for (const hw of game.homing) {
    if (hw.destroyed || hw.impacted || hw.tractored) continue
    if (hw.targetId !== ship.id) continue
    if (!overflies(path, hw)) continue
    hw.impacted = true
    hw.forcedShield = overflightShield(ship)
    hw.position = { ...ship.placement.position }
    pushLog(
      game,
      `${ship.name} overflies ${hw.weaponName}, which impacts its ${hw.forcedShield} shield (E5.9.2).`,
    )
  }
}

function moveHomingWeapons(game: GameState): void {
  for (const hw of game.homing) {
    if (hw.destroyed || hw.impacted) continue
    const target = shipById(game, hw.targetId)
    const owner = shipById(game, hw.ownerId)
    if (!target || target.destroyed || target.disengaged) {
      hw.destroyed = true
      continue
    }
    const def = owner?.form.weapons.find((w) => w.id === hw.weaponId)
    if (!def) {
      hw.destroyed = true
      continue
    }
    const penalty = game.jammingVsHoming && owner ? jammingPenalty(target, owner) : 0
    const result = moveHomingWeapon(hw, def, target, penalty)
    if (result.expired) {
      hw.destroyed = true
      pushLog(game, `${hw.weaponName} runs out of endurance and is removed (E5.1.6).`)
    } else if (result.impact) {
      pushLog(game, `${hw.weaponName} closes on ${target.name}'s ${result.side} shield (E5.4).`)
    }
  }
  game.homing = game.homing.filter((hw) => !hw.destroyed)
}

function runSegmentEnter(game: GameState): void {
  if (game.segment === 'command') {
    // Fresh command cards each combat phase (C1.1.1).
    game.orders = {}
    for (const ship of activeShips(game)) game.orders[ship.id] = defaultCommandCard(ship)
  }
}

function startNewRound(game: GameState): void {
  // The catch-all half of the combat-exit sweep: nothing impacted may cross
  // a round boundary unresolved, whatever segment it arrived in.
  resolveUnansweredImpacts(game)
  if (game.missions.length > 0) {
    const hooks = missionHooks(game)
    // A carrier that died or left this round settles its cargo first, so the
    // hill is judged on the board as the round actually ended.
    updateCargoMissions(game.scenario.missions ?? [], game.missions, hooks)
    scoreHoldMissions(game.scenario.missions ?? [], game.missions, hooks)
  }
  game.round += 1
  game.phase = 'engineering'
  game.segment = 'resource-allocation'
  // Lent tactical scan lasts one round and is re-assigned during the coming
  // Resource Allocation Segment (H5.2.1). The command ship itself is also
  // re-designated each round (H5.1.6); the previous choice is left in place as
  // a default the player may change.
  for (const state of Object.values(game.command)) state.assignments = []
  // One probe per launcher per round (J7.2.1).
  game.ops.probesThisRound = {}
  pruneFormations(game.formations, game.ships)
  for (const ship of activeShips(game)) beginRound(ship)
  /**
   * The twenty rounds only start once the boarders are beaten (J6.3.2), and
   * the state clears itself when they run out — so nothing else has to know
   * what round it is to ask whether a crew is still under arms.
   */
  for (const ship of activeShips(game)) {
    if (ship.crewArmedUntil === 0) continue
    if (Object.values(ship.boarders).some((n) => n > 0)) ship.crewArmedUntil = game.round + 20
    else if (game.round > ship.crewArmedUntil) {
      ship.crewArmedUntil = 0
      pushLog(game, `${ship.name}: the crew stands down and returns to stations (J6.3.2).`)
    }
  }
  pushLog(game, `— Round ${game.round} —`)
  // Reinforcements make the board (S3.2). Announced, because a squadron
  // appearing across the exit is the whole point of the clock.
  const arrived = game.ships.filter((s) => s.arrivesRound === game.round && !s.destroyed)
  for (const ship of arrived) pushLog(game, `${ship.name} arrives (${ship.side}).`)
}

// ---------------------------------------------------------------------------
// Operations Segment helpers (A3.3.2, G1.1.5)
// ---------------------------------------------------------------------------

/**
 * Raise or lower a shield. A shield may change state once per phase, but not
 * both up and down in the same phase (G1.1.5).
 */
export function setShieldDown(game: GameState, ship: ShipState, side: ShieldSide, down: boolean): string | null {
  // H6.4.1: the shields went down with the cloak and stay down until it does.
  if (!down && shipUnderCloakRestrictions(game, ship)) {
    return `${ship.name} cannot raise shields while under cloaking restrictions (H6.4.1).`
  }
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
// Section J — Operations
// ---------------------------------------------------------------------------

/** Advance Steps A–E of the Operations Segment (J1.2.1). */
export function advanceOperationsStep(game: GameState): boolean {
  const index = OPERATIONS_STEPS.indexOf(game.ops.step)
  if (index >= OPERATIONS_STEPS.length - 1) return false
  game.ops.step = OPERATIONS_STEPS[index + 1]
  return true
}

/** The one system this ship is running at MAX power this phase (J1.1.2). */
export function maxSystemOf(game: GameState, ship: ShipState): SystemKind | null {
  return game.ops.maxSystem[ship.id] ?? null
}

export function setMaxSystem(game: GameState, ship: ShipState, kind: SystemKind | null): void {
  game.ops.maxSystem[ship.id] = kind
  pushLog(game, kind ? `${ship.name}: ${kind} at MAX power this phase.` : `${ship.name}: no system at MAX.`)
}

export function powerOf(game: GameState, ship: ShipState, kind: SystemKind) {
  return systemPower(ship, kind, maxSystemOf(game, ship))
}

// ── J3 Tractor beams ──────────────────────────────────────────────────────

/**
 * Everything a tractor beam may reach for: ships, small craft, and missiles in
 * flight (J3.2.2). Particle weapons cannot be caught (E5.4 Step 6).
 */
export function tractorTargets(game: GameState, source: ShipState): Array<ScanTarget & { kind: 'ship' | 'small' }> {
  const targets: Array<ScanTarget & { kind: 'ship' | 'small' }> = []
  for (const ship of activeShips(game)) {
    if (ship.id === source.id) continue
    targets.push({ id: ship.id, name: ship.name, position: ship.placement.position, kind: 'ship' })
  }
  for (const craft of game.smallCraft) {
    if (craftDestroyed(craft)) continue
    targets.push({ id: craft.id, name: craftName(craft), position: craft.position, kind: 'small' })
  }
  for (const hw of game.homing) {
    if (hw.destroyed || hw.impacted || hw.tractored) continue
    if (!homingIsMissile(game, hw)) continue
    targets.push({ id: hw.id, name: hw.weaponName, position: hw.position, kind: 'small' })
  }
  return targets
}

/** The weapon definition behind a homing counter, if its launcher survives. */
export function homingWeaponDef(game: GameState, hw: HomingWeapon): WeaponSystemDef | undefined {
  return shipById(game, hw.ownerId)?.form.weapons.find((w) => w.id === hw.weaponId)
}

/** Only missiles can be held; particle weapons pass straight through (E5.4 Step 6). */
function homingIsMissile(game: GameState, hw: HomingWeapon): boolean {
  const def = homingWeaponDef(game, hw)
  return def ? isMissileWeapon(def) : false
}

/**
 * Missiles bearing down on a ship that its tractor beams could catch during
 * Step 4A of the Combat Segment (J3.2.2). Defensive fire happens first.
 */
export function tractorableHoming(game: GameState, defender: ShipState): HomingWeapon[] {
  return impactingHoming(game, defender).filter(
    (hw) => !hw.tractored && homingIsMissile(game, hw),
  )
}

/**
 * Catch an incoming missile in a tractor beam (J3.2.2). It stops where it is
 * and goes nowhere until released, shot away, or out of endurance.
 */
export function tractorIncomingHoming(
  game: GameState,
  defender: ShipState,
  homingId: string,
  beams = 1,
): TractorAttempt {
  const hw = game.homing.find((h) => h.id === homingId)
  if (!hw) return { refusal: 'No such weapon in flight.' }
  const def = homingWeaponDef(game, hw)
  if (!def) return { refusal: 'That weapon has no launcher left.' }

  const power = tractorPower(defender, maxSystemOf(game, defender))
  const refusal = lockRefusal(defender, hw.position, game.ops.links, power, beams)
  if (refusal) return { refusal }
  if (beams > tractorBeamsReady(game, defender)) {
    return { refusal: `${defender.name}'s beams have already been used this phase (J3.2.1).` }
  }
  spendLockAttempts(game, defender, beams)

  const result = lockOnSmall(game.rng, beams)
  if (!result.locked) {
    pushLog(game, `${defender.name}: tractor beam misses ${hw.weaponName} (${result.faces.join('')}).`)
    return { refusal: null, faces: result.faces, locked: false }
  }
  const held = tractorHomingWeapon(hw, def)
  if (held) return { refusal: held }
  // It was caught on the way in, so it never struck: clear the impact flag or
  // the Combat Segment would still resolve it this phase (E5.4 Step 6).
  hw.impacted = false

  game.ops.links.push({
    id: `${defender.id}->${hw.id}`,
    sourceId: defender.id,
    targetId: hw.id,
    targetKind: 'small',
    beams,
    power,
  })
  pushLog(game, `${defender.name}: holds ${hw.weaponName} in a tractor beam (J3.2.2).`)
  return { refusal: null, faces: result.faces, locked: true }
}

/**
 * A missile let go of — deliberately or because the beam was shot away —
 * strikes at once, and the ship gets no defensive fire against it (J3.2.2).
 */
function releaseHeldMissiles(game: GameState, links: TractorLink[]): void {
  const struck: HomingWeapon[] = []
  for (const link of links) {
    const hw = game.homing.find((h) => h.id === link.targetId)
    // Only a weapon this link was actually holding is let go of.
    if (!hw || hw.destroyed || !hw.tractored) continue
    hw.tractored = false
    const target = shipById(game, hw.targetId)
    const def = homingWeaponDef(game, hw)
    if (!target || !def) {
      hw.destroyed = true
      struck.push(hw)
      continue
    }
    hw.position = { ...target.placement.position }
    const side = impactShield(hw, target)
    const volley = resolveHomingVolley([hw], def, side, hw.phasesFlown, 0, game.rng)
    hw.impacted = true
    struck.push(hw)
    pushLog(
      game,
      `${hw.weaponName} is released and strikes ${target.name} at once, with no defensive fire (J3.2.2).`,
    )
    applyVolley(
      target,
      {
        standard: volley.standard,
        leak: volley.leak,
        structurePenetration: volley.structure,
        side,
        shieldsInoperative: shipIsCloaked(game, target),
      },
      damageContext(game),
    )
  }
  if (struck.length > 0) game.homing = game.homing.filter((hw) => !struck.includes(hw))
}

/**
 * A beam may hold a missile only until its endurance runs out, at which point
 * it is simply removed (J3.2.2).
 */
function expireHeldMissiles(game: GameState): void {
  const expired: HomingWeapon[] = []
  for (const hw of game.homing) {
    if (!hw.tractored || hw.destroyed) continue
    const def = homingWeaponDef(game, hw)
    if (!def) continue
    // A held missile burns endurance sitting still, just as it would flying.
    hw.phasesFlown += 1
    if (hw.phasesFlown >= endurance(def)) {
      hw.destroyed = true
      expired.push(hw)
      const link = game.ops.links.find((l) => l.targetId === hw.id)
      if (link) game.ops.links.splice(game.ops.links.indexOf(link), 1)
      pushLog(game, `${hw.weaponName} reaches the end of its endurance in the tractor beam (J3.2.2).`)
    }
  }
  // Only the ones that just expired come off the map; everything else is left
  // for the Combat Segment to clear as usual.
  if (expired.length > 0) game.homing = game.homing.filter((hw) => !expired.includes(hw))
}

export function craftName(craft: SmallCraft): string {
  const label = craft.kind === 'probe' ? 'Probe' : craft.kind === 'jamming-shuttle' ? 'Jammer' : 'Shuttle'
  return `${label} ${craft.id.split('-').pop()}`
}

export interface TractorAttempt {
  refusal: string | null
  faces?: string[]
  total?: number
  required?: number
  locked?: boolean
}

/**
 * Attempt a tractor lock during Step C (J3.2.1, J3.3.1). A starship needs the
 * summed damage result to beat its size class; a small target needs any one die
 * to come up L or M.
 */
export function attemptTractorLock(
  game: GameState,
  source: ShipState,
  targetId: string,
  beams: number,
): TractorAttempt {
  const target = tractorTargets(game, source).find((t) => t.id === targetId)
  if (!target) return { refusal: 'No such target.' }
  // H6.4.7: a cloak bars tractor beams in both directions, and a cloaked ship
  // may not be gripped at any detection level.
  if (shipUnderCloakRestrictions(game, source)) {
    return { refusal: `${source.name} cannot use tractor beams while cloaked (H6.4.7).` }
  }
  {
    const other = shipById(game, targetId)
    if (other && shipIsCloaked(game, other)) {
      return { refusal: `No tractor beam may lock onto a cloaked ship (H6.4.7).` }
    }
  }
  if (game.ops.brokenThisPhase.has(`${source.id}->${targetId}`)) {
    return { refusal: `That lock was broken this phase; it may not be reestablished until the next (J3.6).` }
  }
  const power = tractorPower(source, maxSystemOf(game, source))
  const refusal = lockRefusal(source, target.position, game.ops.links, power, beams)
  if (refusal) return { refusal }
  if (beams > tractorBeamsReady(game, source)) {
    return {
      refusal: `${source.name}'s beams have already made their lock-on attempt this segment (J3.3.1).`,
    }
  }
  spendLockAttempts(game, source, beams)

  const result =
    target.kind === 'ship'
      ? lockOnStarship(game.rng, beams, power, shipById(game, targetId)!.form.sizeClass)
      : lockOnSmall(game.rng, beams)

  const detail =
    target.kind === 'ship'
      ? `${result.total} against size class ${result.required}`
      : result.faces.join('')
  if (result.locked) {
    game.ops.links.push({
      id: `${source.id}->${targetId}`,
      sourceId: source.id,
      targetId,
      targetKind: target.kind,
      beams,
      power,
    })
    pushLog(game, `${source.name}: tractor lock on ${target.name} (${detail}).`)
  } else {
    pushLog(game, `${source.name}: tractor lock on ${target.name} failed (${detail}).`)
  }
  return { refusal: null, faces: result.faces, total: result.total, required: result.required, locked: result.locked }
}

/** Release a lock during Step C (J3.6.3). */
/**
 * Shove a tractored ship one inch (J3.5).
 *
 * The tactical point is not the inch itself: it is that the towing ship can
 * push its captive out of the beam's own reach and break the lock, or nudge it
 * into a friend's reach to gain a second one. Both fall out of moving the ship
 * and re-checking the links, so neither is special-cased here.
 */
export function displaceTractored(
  game: GameState,
  source: ShipState,
  targetId: string,
  direction: 'F' | 'A' | 'P' | 'S',
): string | null {
  const target = shipById(game, targetId)
  if (!target) return 'No such ship.'
  if (game.segment !== 'navigation' && game.segment !== 'delayed-action') {
    return 'A tractored ship is displaced after both ships have moved (J3.5.2).'
  }
  const power = tractorPower(source, maxSystemOf(game, source))
  const refusal = displaceRefusal(source, target, game.ops.links, power)
  if (refusal) return refusal

  const to = displacedPosition(target, direction)
  // J3.5.3: a gravity well will not have it. Terrain otherwise is allowed, and
  // costs nothing now — the bill comes when the ship next flies through it.
  const world = game.scenario.terrain.find(
    (t) => (t.kind === 'planet' || t.kind === 'moon') &&
      distance(to, t.center) <= t.radius,
  )
  if (world) {
    return `${target.name} cannot be displaced into ${world.name}'s gravity well (J3.5.3).`
  }

  target.placement.position = to
  pushLog(game, `${source.name} displaces ${target.name} one inch ${direction} (J3.5.2).`)

  // The shove may have pushed it out of the beam that did the shoving.
  const report = pruneLinks(game.ops.links, game.ships, (id) => positionOfObject(game, id))
  for (const [i, link] of report.broken.entries()) {
    const owner = shipById(game, link.sourceId)
    pushLog(game, `Tractor lock ${owner?.name ?? link.sourceId} → ${link.targetId} broken: ${report.reasons[i]}.`)
  }
  return null
}

export function releaseTractor(game: GameState, sourceId: string, targetId: string): void {
  const link = linkBetween(game.ops.links, sourceId, targetId)
  if (!link) return
  game.ops.links.splice(game.ops.links.indexOf(link), 1)
  // J3.2.3 / J3.3.2: the beam that let go may not try again until the next
  // Operations Segment, so letting go costs it its attempt.
  const source = shipById(game, sourceId)
  if (source) spendLockAttempts(game, source, link.beams)
  game.ops.brokenThisPhase.add(`${sourceId}->${targetId}`)
  pushLog(game, `${source?.name ?? sourceId}: tractor beam released.`)
  releaseHeldMissiles(game, [link])
}

/**
 * The held ship makes the beam prove itself again (J3.6.1). A failed roll
 * breaks the link there and then.
 */
export function contestTractor(game: GameState, targetId: string): TractorAttempt {
  const target = shipById(game, targetId)
  const link = game.ops.links.find((l) => l.targetId === targetId && l.targetKind === 'ship')
  if (!target || !link) return { refusal: 'Nothing is holding that ship.' }
  // J3.6: one attempt a phase. Left unbounded, a defender could simply ask
  // again until the dice let go, and no lock would ever hold.
  if (game.ops.contestedThisPhase.has(targetId)) {
    return { refusal: `${target.name} has already tried the beam this phase (J3.6.1).` }
  }
  game.ops.contestedThisPhase.add(targetId)
  const result = contestLink(game.rng, link, target)
  if (!result.locked) {
    game.ops.links.splice(game.ops.links.indexOf(link), 1)
    game.ops.brokenThisPhase.add(`${link.sourceId}->${link.targetId}`)
    pushLog(game, `${target.name} breaks free of the tractor beam (${result.total} v ${result.required}).`)
  } else {
    pushLog(game, `${target.name} fails to break the tractor beam (${result.total} v ${result.required}).`)
  }
  return { refusal: null, faces: result.faces, total: result.total, required: result.required, locked: result.locked }
}

/** Speed a ship actually travels at, after any tractor links (J3.3.4). */
export function effectiveSpeed(game: GameState, ship: ShipState): number {
  return adjustedSpeed(ship, game.ops.links, game.ships)
}

export function tractorBeamsFree(game: GameState, ship: ShipState): number {
  return beamsAvailable(ship, game.ops.links)
}

/**
 * Beams the ship may still throw at a lock-on this segment: the free ones,
 * less those that have already had their one attempt (J3.3.1). Releasing a
 * target spends the attempt as well (J3.2.3, J3.3.2), so a captain cannot let
 * go and immediately grab again.
 */
export function tractorBeamsReady(game: GameState, ship: ShipState): number {
  return Math.max(0, tractorBeamsFree(game, ship) - (game.ops.lockAttemptsThisPhase[ship.id] ?? 0))
}

/**
 * The tractor clock, wound back at the end of every combat phase: beams get
 * their lock-on attempt again (J3.3.1), a defender may try the beam again
 * (J3.6.1), a lock broken last phase may be reestablished (J3.6) — and a link
 * gives back the beams it no longer needs.
 */
export function resetTractorPhase(game: GameState): void {
  game.ops.lockAttemptsThisPhase = {}
  game.ops.brokenThisPhase.clear()
  game.ops.contestedThisPhase.clear()
  // J3.3.3: once a lock is made only one beam is needed to hold it, and "any
  // excess tractor beams may be used for different tasks during subsequent
  // phases". Without this a four-beam ship that grabbed a dreadnought with all
  // four had no beams left for anything, ever.
  for (const link of game.ops.links) link.beams = 1
}

function spendLockAttempts(game: GameState, ship: ShipState, beams: number): void {
  game.ops.lockAttemptsThisPhase[ship.id] = (game.ops.lockAttemptsThisPhase[ship.id] ?? 0) + beams
}

// ── J4 Informational scans ────────────────────────────────────────────────

/** Everything a ship may gather information on (J4.2). */
export function scanTargets(game: GameState, ship: ShipState): ScanTarget[] {
  const targets: ScanTarget[] = []
  for (const other of activeShips(game)) {
    if (other.id === ship.id) continue
    targets.push({ id: other.id, name: other.name, position: other.placement.position })
  }
  for (const feature of game.scenario.terrain) {
    targets.push({ id: feature.id, name: feature.name, position: feature.center })
  }
  return targets
}

export interface ScanOutcome {
  refusal: string | null
  gained?: number
  total?: number
}

/** Gather information on an object during Step E (J4.2.2). */
export function performScan(game: GameState, ship: ShipState, targetId: string): ScanOutcome {
  const captured = capturedRefusal(ship, 'scan')
  if (captured) return { refusal: captured }
  // H6.4.3: a cloaked ship is listening, not looking.
  if (shipUnderCloakRestrictions(game, ship)) {
    return { refusal: `${ship.name} cannot perform information scans while cloaked (H6.4.3).` }
  }
  const target = scanTargets(game, ship).find((t) => t.id === targetId)
  if (!target) return { refusal: 'No such object.' }
  const key = `${ship.id}:${targetId}`
  if (game.ops.scannedThisPhase.has(key)) {
    return { refusal: `${ship.name} has already scanned ${target.name} this phase (J1.1.1).` }
  }

  // Targeting support may pull a distant object into scanning range (J4.2.1).
  const other = shipById(game, targetId)
  const range = other
    ? effectiveRangeTo(game, ship, other)
    : distance(ship.placement.position, target.position)
  // A scout with sensors turned to the scan reaches further and brings back
  // more (H3.6.1, H3.6.2). Its own sciences still count: the scout adds to the
  // scan rather than standing in for it.
  const scout = scanCapability(ship)
  const refusal = scanRefusal(
    ship,
    target,
    Math.floor(range),
    terrainObstacles(game.scenario.terrain),
    maxSystemOf(game, ship),
    scout?.range ?? 0,
  )
  if (refusal) return { refusal }

  const yielded = scanYield(
    ship,
    maxSystemOf(game, ship),
    ship.sensors.tacticalScan,
    scout?.bonusPoints ?? 0,
  )
  addInfoPoints(game.ops.info, ship.side, targetId, yielded.total)
  game.ops.scannedThisPhase.add(key)
  pushLog(
    game,
    `${ship.name}: scans ${target.name} for ${yielded.total} info point(s) ` +
      `(${yielded.fromSciences} sciences at ${yielded.power.toUpperCase()}, ${yielded.fromSensors} sensors` +
      (yielded.fromScout > 0 ? `, ${yielded.fromScout} scout` : '') +
      ').',
  )
  return { refusal: null, gained: yielded.total, total: game.ops.info[ship.side][targetId] }
}

/** Effective range for scanning: actual range less any targeting support (H2.3.3). */
function effectiveRangeTo(game: GameState, ship: ShipState, target: ShipState): number {
  const support = scoutSupport(game, ship, target)
  const actual = distance(ship.placement.position, target.placement.position)
  return Math.max(0, actual - (ship.sensors.targeting + support.targeting))
}

// ── J5 Transporters ───────────────────────────────────────────────────────

export interface TransportOutcome {
  refusal: string | null
  squads?: number
}

/** Beam marine squads during Step D (J5.2). */
export function performTransport(
  game: GameState,
  from: ShipState,
  to: ShipState,
  squads: number,
): TransportOutcome {
  // H6.4.8: nothing beams off a cloaked ship, and nothing beams onto one.
  if (shipUnderCloakRestrictions(game, from)) {
    return { refusal: `${from.name} cannot use transporters while cloaked (H6.4.8).` }
  }
  if (shipIsCloaked(game, to)) {
    return { refusal: `Nothing may be transported to a cloaked ship (H6.4.8).` }
  }
  const used = game.ops.transportedThisPhase[from.id] ?? 0
  const refusal = transportRefusal({
    from,
    to,
    squads,
    usedThisPhase: used,
    maxSystem: maxSystemOf(game, from),
  })
  if (refusal) return { refusal }
  transport(from, to, squads)
  game.ops.transportedThisPhase[from.id] = used + squads
  pushLog(
    game,
    from.side === to.side
      ? `${from.name}: beams ${squads} marine squad(s) to ${to.name}.`
      : `${from.name}: beams ${squads} marine squad(s) aboard ${to.name} (J6).`,
  )
  return { refusal: null, squads }
}

// ── J7/J8 Small craft ─────────────────────────────────────────────────────

let podCounter = 0

/** Test hook: pod ids restart, so a fixture reads the same twice. */
export function resetPodIds(): void {
  podCounter = 0
}

// ---------------------------------------------------------------------------
// Section E11.4–E11.6 — abandoning ship
// ---------------------------------------------------------------------------

/** Crew credited to a side, and the running total (E11.4.2). */
function creditCrew(game: GameState, side: string, units: number): void {
  if (units <= 0) return
  game.crewRescued[side] = (game.crewRescued[side] ?? 0) + units
}

/**
 * Emergency transporter evacuation (E11.5). The crew goes to `to`, and every
 * unit that survives the trip is credited to whoever owns that ship — which is
 * how a captured crew scores for its captors.
 */
export function evacuateCrew(game: GameState, from: ShipState, to: ShipState): string | null {
  if (!game.options.abandonShip) return 'Abandon-ship rules are not in play (E11.4).'
  const refusal = evacRefusal(
    from,
    to,
    // E11.5.1 measures against the MAX range, whatever is set this phase.
    Math.max(transporterRange(from, 'TRAN'), transporterRange(to, 'TRAN')),
    workingSystemBoxes(game, from, 'TRAN'),
    workingSystemBoxes(game, to, 'TRAN'),
  )
  if (refusal) return refusal

  const outcome = evacuateByTransporter(from, game.rng)
  creditCrew(game, to.side, outcome.saved)
  pushLog(
    game,
    `${from.name} evacuates by emergency transport to ${to.name}: ${outcome.faces.join(' ')} — ` +
      `${outcome.saved} crew unit(s) across, ${outcome.lost} lost (E11.5.4).`,
  )
  return null
}

/**
 * Take to the pods (E11.6). Everyone still aboard goes into one counter two
 * inches off the hull, and the captain may scuttle the ship on the way out
 * (E11.6.3) — the pods are clear of that blast.
 */
export function abandonToPods(game: GameState, ship: ShipState, selfDestruct: boolean): string | null {
  if (!game.options.abandonShip) return 'Abandon-ship rules are not in play (E11.4).'
  const refusal = podRefusal(ship)
  if (refusal) return refusal

  podCounter += 1
  const crew = ship.crewUnits
  game.escapePods.push({
    id: `pod-${podCounter}`,
    side: ship.side,
    fromShipId: ship.id,
    fromShipName: ship.name,
    position: podPosition(ship),
    crew,
  })
  ship.crewUnits = 0
  pushLog(game, `${ship.name} abandons ship: ${crew} crew unit(s) away in escape pods (E11.6.4).`)

  if (selfDestruct) {
    ship.destroyed = true
    pushLog(game, `${ship.name} self-destructs; the pods are clear of it (E11.6.3, E11.6.4).`)
  }
  return null
}

/**
 * Pick a pod up (E11.6.5): landed aboard a stopped ship within range 1, or
 * beamed across a transporter. The crew is credited to the ship that takes
 * them, friend or enemy.
 */
export function recoverPod(
  game: GameState,
  podId: string,
  ship: ShipState,
  method: 'land' | 'beam',
): string | null {
  const pod = game.escapePods.find((p) => p.id === podId)
  if (!pod) return 'No such escape pod.'

  if (method === 'land') {
    const refusal = podMayLand(pod, ship)
    if (refusal) return refusal
    creditCrew(game, ship.side, pod.crew)
    pushLog(
      game,
      `${ship.name} takes ${pod.fromShipName}'s escape pod aboard — ${pod.crew} crew unit(s) ` +
        `${pod.side === ship.side ? 'rescued' : 'captured'} (E11.6.5).`,
    )
    game.escapePods = game.escapePods.filter((p) => p.id !== podId)
    return null
  }

  // E11.6.5: one transporter beams one crew unit aboard per phase.
  const boxes = workingSystemBoxes(game, ship, 'TRAN')
  if (boxes === 0) return `${ship.name} has no undamaged transporter (E11.6.5).`
  const used = game.ops.transportedThisPhase[ship.id] ?? 0
  if (used >= boxes) {
    return `${ship.name}'s transporters have already run this phase (E11.6.5).`
  }
  const reach = transporterRange(ship, maxSystemOf(game, ship))
  const range = actualRange(ship.placement.position, pod.position)
  if (range > reach) return `The pod is ${range}" away; the transporter reaches ${reach}".`

  pod.crew -= 1
  game.ops.transportedThisPhase[ship.id] = used + 1
  creditCrew(game, ship.side, 1)
  pushLog(
    game,
    `${ship.name} beams a crew unit off ${pod.fromShipName}'s escape pod ` +
      `(${pod.side === ship.side ? 'rescued' : 'captured'}, E11.6.5).`,
  )
  if (pod.crew <= 0) game.escapePods = game.escapePods.filter((p) => p.id !== podId)
  return null
}

/**
 * A ship blown apart by weapon fire takes its crew with it (E11.6.1): there is
 * no time for the pods. Called wherever a hull is removed from play.
 */
export function crewLostWithShip(game: GameState, ship: ShipState): void {
  if (!game.options.abandonShip || ship.crewUnits <= 0) return
  pushLog(
    game,
    `${ship.name} goes up with ${ship.crewUnits} crew unit(s) still aboard — ` +
      `no time for the pods (E11.6.1).`,
  )
  ship.crewUnits = 0
}

/** Launch a shuttle during Step A of Flight Operations (J8.2.1). */
export function launchShuttle(
  game: GameState,
  ship: ShipState,
  kind: SmallCraftKind = 'shuttle',
  marines = 0,
): string | null {
  const refusal =
    launchRefusal(ship, game.smallCraft, game.ops.launchedThisPhase.has(ship.id)) ??
    (kind === 'jamming-shuttle' ? jammingLaunchRefusal(ship) : null)
  if (refusal) return refusal
  if (marines > ship.marineSquads) return `${ship.name} has only ${ship.marineSquads} marine squad(s).`

  game.counters.craft += 1
  ship.shuttlesAboard -= 1
  ship.marineSquads -= marines
  game.smallCraft.push({
    id: `craft-${game.counters.craft}`,
    kind,
    side: ship.side,
    motherId: ship.id,
    position: launchPosition(ship),
    damage: 0,
    // A launched shuttle counts as having activated for the phase (J8.2.1).
    activated: true,
    marines: marines || undefined,
  })
  game.ops.launchedThisPhase.add(ship.id)
  pushLog(game, `${ship.name}: launches a ${kind === 'jamming-shuttle' ? 'jamming shuttle' : 'shuttle'}.`)
  // H6.15.4: a craft leaving the bay of a cloaked ship is seen the instant it
  // clears the hull, and everyone in range gets a look.
  launchRevealsCloak(game, ship)
  return null
}

/** Move an activated shuttle (J8.2.3). Movement is free-form, not plotted. */
export function moveSmallCraft(game: GameState, craftId: string, to: { x: number; y: number }): string | null {
  const craft = game.smallCraft.find((c) => c.id === craftId)
  if (!craft) return 'No such craft.'
  const refusal = moveRefusal(craft, to)
  if (refusal) return refusal
  craft.position = to
  craft.activated = true
  return null
}

/** Land a shuttle back aboard a friendly ship (J8.2.4). */
/**
 * Bring a tractored craft aboard (J3.2.6), during Flight Operations step 5.B.
 *
 * Distinct from recovering your own shuttle: this is what you do with
 * something you have caught. A friendly craft is simply recovered; an enemy's
 * is a prize, and its crew goes into the bag with it.
 */
export function captureCraft(game: GameState, craftId: string, ship: ShipState): string | null {
  const craft = game.smallCraft.find((c) => c.id === craftId)
  if (!craft) return 'No such craft.'
  if (game.segment !== 'flight-operations') {
    return 'A tractored craft is brought aboard during Flight Operations (J3.2.6).'
  }
  const held = game.ops.links.some((l) => l.sourceId === ship.id && l.targetId === craftId)
  const refusal = captureRefusal(craft, ship, held)
  if (refusal) return refusal

  game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
  game.ops.links = game.ops.links.filter((l) => l.targetId !== craftId)
  if (craft.side === ship.side) {
    ship.shuttlesAboard += 1
    ship.marineSquads += craft.marines ?? 0
    pushLog(game, `${ship.name}: brings its own shuttle aboard from the beam (J3.2.6).`)
  } else {
    // A captured hull is a prize, not a shuttle this ship can fly out again.
    pushLog(game, `${ship.name}: takes ${craft.side}'s shuttle aboard as a prize (J3.2.6).`)
  }
  return null
}

export function recoverShuttle(game: GameState, craftId: string, ship: ShipState): string | null {
  const craft = game.smallCraft.find((c) => c.id === craftId)
  if (!craft) return 'No such craft.'
  const card = game.orders[ship.id]
  const speedChanged = card ? card.accel !== 0 : false
  const refusal = recoveryRefusal(craft, ship, speedChanged)
  if (refusal) return refusal
  const done = game.ops.recoveredThisPhase[ship.id] ?? 0
  const allowance = recoveryAllowance(ship, maxSystemOf(game, ship), tractorBeamsFree(game, ship))
  if (done >= allowance) {
    return `${ship.name} may recover ${allowance} shuttle(s) this phase (J8.1.2, J8.1.3).`
  }
  game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
  ship.shuttlesAboard += 1
  ship.marineSquads += craft.marines ?? 0
  game.ops.recoveredThisPhase[ship.id] = done + 1
  pushLog(game, `${ship.name}: recovers a shuttle.`)
  return null
}

/** Land or dock a shuttle on an enemy ship to deliver marines (J8.2.6). */
export function dockShuttle(game: GameState, craftId: string, ship: ShipState): string | null {
  const craft = game.smallCraft.find((c) => c.id === craftId)
  if (!craft) return 'No such craft.'
  const docked = game.ops.dockedThisPhase[ship.id] ?? 0
  const refusal = dockingRefusal(craft, ship, docked, effectiveSpeed(game, ship))
  if (refusal) return refusal
  craft.dockedTo = ship.id
  craft.position = ship.placement.position
  game.ops.dockedThisPhase[ship.id] = docked + 1
  if (craft.marines) {
    ship.boarders[craft.side] = (ship.boarders[craft.side] ?? 0) + craft.marines
    craft.marines = undefined
  }
  pushLog(game, `${craftName(craft)} docks with ${ship.name} (J8.2.6).`)
  return null
}

/** Torpedo and missile mounts that are armed and could carry a probe (J7.1.3). */
export function probeLaunchers(
  ship: ShipState,
): Array<{ weaponId: string; mountIndex: number; label: string }> {
  const out: Array<{ weaponId: string; mountIndex: number; label: string }> = []
  for (const weapon of ship.form.weapons) {
    if (!isProbeCapableLauncher(weapon.weaponClass)) continue
    weapon.mounts.forEach((_, index) => {
      const state = ship.mounts[weapon.id]?.[index]
      if (state && mountIsReady(weapon, index, state)) {
        out.push({ weaponId: weapon.id, mountIndex: index, label: `${weapon.name} #${index + 1}` })
      }
    })
  }
  return out
}

/**
 * Launch a probe during the Offensive Fire step (J7.2.3).
 *
 * With no `launcher` this uses a dedicated PROB launcher at MAX power (J7.2.1).
 * Given a torpedo mount it loads a probe there instead, which costs the tube
 * its full arming cycle (J7.2.2) — the path every printed ship must use, since
 * none of them carries a dedicated launcher.
 */
export function launchProbe(
  game: GameState,
  ship: ShipState,
  targetId: string,
  launcher?: { weaponId: string; mountIndex: number },
): string | null {
  const launched = game.ops.probesThisRound[ship.id] ?? 0
  let refusal: string | null
  if (launcher) {
    const weapon = ship.form.weapons.find((w) => w.id === launcher.weaponId)
    const state = weapon ? ship.mounts[weapon.id]?.[launcher.mountIndex] : undefined
    refusal = !weapon || !state
      ? 'No such launcher.'
      : torpedoProbeRefusal(
          ship,
          weapon.weaponClass,
          mountIsReady(weapon, launcher.mountIndex, state),
          launched,
        )
    if (!refusal && state) state.armed = 0
  } else {
    refusal = probeLaunchRefusal(ship, launched, maxSystemOf(game, ship))
  }
  if (refusal) return refusal
  const target = scanTargets(game, ship).find((t) => t.id === targetId)
  if (!target) return 'No such object to probe.'

  game.counters.craft += 1
  game.smallCraft.push({
    id: `craft-${game.counters.craft}`,
    kind: 'probe',
    side: ship.side,
    motherId: ship.id,
    position: launchPosition(ship),
    damage: 0,
    activated: true,
    targetId,
    transmitting: false,
  })
  game.ops.probesThisRound[ship.id] = launched + 1
  pushLog(game, `${ship.name}: launches a probe at ${target.name}.`)
  return null
}

/** Every small target a ship's weapons could fire at this phase (E12.4.1). */
export interface SmallTarget {
  id: string
  name: string
  position: Point
  kind: 'craft' | 'homing' | 'flight'
  /** Held in the attacker's own tractor beam, so its dice are automatic (J3.2.5). */
  held: boolean
  /**
   * Jamming this target adds to the actual range of non-point-defense fire
   * (E10.2.2). Fighters carry 5 to 8 of it; nothing else on this list carries
   * any.
   */
  jamming?: number
}

export function smallTargetsFor(game: GameState, attacker: ShipState): SmallTarget[] {
  const heldByMe = (id: string) =>
    game.ops.links.some((l) => l.sourceId === attacker.id && l.targetId === id)

  const targets: SmallTarget[] = game.smallCraft
    .filter((c) => !craftDestroyed(c))
    .map((c) => ({
      id: c.id,
      name: craftName(c),
      position: c.position,
      kind: 'craft' as const,
      held: heldByMe(c.id),
    }))

  // E12.3.2 — a homing weapon may not be fired upon during the phase it was
  // launched, so only counters that have already flown are targets.
  for (const hw of game.homing) {
    if (hw.destroyed || hw.phasesFlown < 1) continue
    /*
     * A counter that has arrived is still a target, but only for the ship it
     * has arrived at: E5.4 Step 4 is that ship's point defense fire, taken
     * with the warhead on the doorstep. Everyone else may only engage a
     * counter still in flight.
     *
     * This is what lets the defender answer an impact by declaring mounts and
     * rolling, the same as any other shot, instead of totting up point
     * defense damage by hand and typing in the number.
     */
    if (hw.impacted && hw.targetId !== attacker.id) continue
    targets.push({
      id: hw.id,
      name: hw.weaponName,
      position: hw.position,
      kind: 'homing' as const,
      held: heldByMe(hw.id),
    })
  }

  /*
   * E12.4.2 — a flight is one small target. "The firing player is not required
   * to assign specific weapon mounts to a single small target; only the volley
   * or flight is required." Fighters in the hangar are aboard, not on the
   * board, and J3.2.1 already keeps tractor beams off them entirely, so a
   * flight is never `held`.
   */
  for (const flight of game.flights) {
    if (flightDestroyed(flight) || flight.dockedTo) continue
    const card = fighterCard(flight.cardId)
    if (!card) continue
    targets.push({
      id: flight.id,
      name: flightName(game, flight),
      position: flight.position,
      kind: 'flight' as const,
      held: false,
      jamming: airframeJamming(card, currentLoadout(flight, card)),
    })
  }
  return targets
}

export interface SmallTargetResult {
  refusal: string | null
  volley?: SmallTargetVolley
  destroyed?: boolean
  remaining?: number
}

/**
 * Fire one weapon mount at a small target during Offensive Fire (E12.4).
 *
 * Point defense weapons fire normally; everything else goes through Degraded
 * Fire Control (E12.4.3, E12.4.4). A target held in the firer's own tractor
 * beam needs no roll at all — it is shifted into a convenient arc and every die
 * does its maximum (J3.2.5).
 */
export function fireAtSmallTarget(
  game: GameState,
  attacker: ShipState,
  targetId: string,
  weaponId: string,
  mountIndex: number,
): SmallTargetResult {
  const target = smallTargetsFor(game, attacker).find((t) => t.id === targetId)
  if (!target) return { refusal: 'No such small target.' }
  const weapon = attacker.form.weapons.find((w) => w.id === weaponId)
  const state = weapon ? attacker.mounts[weapon.id]?.[mountIndex] : undefined
  if (!weapon || !state) return { refusal: 'No such weapon mount.' }
  if (!mountIsReady(weapon, mountIndex, state)) return { refusal: `${weapon.name} is not armed.` }

  const pointDefense = weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
  const actual = Math.floor(distance(attacker.placement.position, target.position))
  /*
   * E10.2.2 — the target's jamming is added to the actual range. It is a
   * bracket shift, not a to-hit modifier, so a Nial at jamming 8 pushes a main
   * battery's volley two or three brackets out or off the chart entirely.
   * E12.4.3 exempts point defense, which is what makes PD mounts the
   * anti-fighter answer rather than the guns (F1.20).
   */
  const jamming = pointDefense ? 0 : (target.jamming ?? 0)
  const range = actual + jamming
  const bracket = weapon.brackets.find((b) => range >= b.min && range <= b.max)
  if (!bracket) {
    return {
      refusal:
        jamming > 0
          ? `${target.name} is at ${actual}" +${jamming} jamming = ${range}", off ${weapon.name}'s chart (E10.2.2).`
          : `${target.name} is at ${range}", outside ${weapon.name}'s chart.`,
    }
  }
  // A target held in your own beam is simply shifted into a convenient arc, so
  // only a free-flying one has to be borne on (J3.2.5, E2.2.2).
  if (
    !target.held &&
    !canBearOn(
      weapon.mounts[mountIndex].arcs,
      arcTo(attacker.placement.position, attacker.placement.heading, target.position),
    )
  ) {
    return { refusal: `${target.name} is not in an arc ${weapon.name} can bear on (E2.2.2).` }
  }

  const faces = target.held
    ? bracket.dice.map((die) => HELD_TARGET_FACE[die])
    : rollDice(bracket.dice, game.rng).map((r) => r.face)

  state.armed = 0
  state.ammoUsed += 1

  /*
   * COA 1 (E12.4.2) — the volley is pooled against the flight and divided by
   * one fighter's Structure. That division is the whole casualty model: six
   * Frazis at Structure 5 soak thirty points, six Sentris at 3 soak eighteen.
   */
  if (target.kind === 'flight') {
    const flight = game.flights.find((f) => f.id === targetId)!
    const card = fighterCard(flight.cardId)!
    const result = flightCasualties(
      faces,
      weapon.special?.damage ?? 0,
      pointDefense,
      flight,
      card,
    )
    flight.members -= result.killed
    flight.damage = flightDestroyed(flight) ? 0 : result.carried
    const dead = flightDestroyed(flight)
    pushLog(
      game,
      `${attacker.name}: ${weapon.name} puts ${result.volley.damage} into ${target.name}` +
        (jamming > 0 ? ` at ${actual}"+${jamming} jamming` : '') +
        (result.volley.degraded
          ? ` (halved by degraded fire control, ${result.volley.raw} raw)`
          : '') +
        ` — ${result.killed} fighter(s) down` +
        (dead ? ', the flight is wiped out' : `, ${flight.members} left`),
    )
    if (dead) game.flights = game.flights.filter((f) => f.id !== flight.id)
    return {
      refusal: null,
      volley: result.volley,
      destroyed: dead,
      remaining: dead ? 0 : flight.members,
    }
  }

  const volley = smallTargetDamage(
    faces,
    weapon.special?.damage ?? 0,
    pointDefense,
    target.held,
  )

  if (target.kind === 'craft') {
    const craft = game.smallCraft.find((c) => c.id === targetId)!
    craft.damage += volley.damage
    const dead = craftDestroyed(craft)
    if (dead) game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
    pushLog(
      game,
      `${attacker.name}: ${weapon.name} hits ${target.name} for ${volley.damage}` +
        (volley.automatic ? ' (held in its own tractor beam, J3.2.5)' : '') +
        (volley.degraded ? ` (halved by degraded fire control, ${volley.raw} raw)` : '') +
        (dead ? ' — destroyed' : ''),
    )
    return { refusal: null, volley, destroyed: dead, remaining: dead ? 0 : craft.damage }
  }

  const hw = game.homing.find((h) => h.id === targetId)!
  const def = homingWeaponDef(game, hw)
  const { destroyed } = applyDefensiveFire([hw], def ?? weapon, volley.damage)
  const dead = destroyed.length > 0
  if (dead) {
    const link = game.ops.links.find((l) => l.targetId === hw.id)
    if (link) game.ops.links.splice(game.ops.links.indexOf(link), 1)
    game.homing = game.homing.filter((h) => h.id !== hw.id)
  }
  pushLog(
    game,
    `${attacker.name}: ${weapon.name} puts ${volley.damage} into ${target.name}` +
      (volley.degraded ? ` (halved by degraded fire control, ${volley.raw} raw)` : '') +
      (dead ? ' — destroyed' : ''),
  )
  return { refusal: null, volley, destroyed: dead }
}

/** Damage a shuttle or probe (E12.4.3, J7.3.3). */
export function damageSmallCraft(game: GameState, craftId: string, points: number): void {
  const craft = game.smallCraft.find((c) => c.id === craftId)
  if (!craft) return
  craft.damage += points
  if (craftDestroyed(craft)) {
    game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
    pushLog(game, `${craftName(craft)} destroyed.`)
  }
}

/** Total jamming a ship gets from its own jamming shuttles (J8.4.1). */
export function shuttleJamming(game: GameState, ship: ShipState): number {
  return jammingFromShuttles(game.smallCraft, ship)
}

/** Shuttles and probes belonging to a ship that are still flying. */
export function craftLaunchedBy(game: GameState, ship: ShipState): SmallCraft[] {
  return craftOf(game.smallCraft, ship.id)
}

// ---------------------------------------------------------------------------
// Fighter flights (Apr 2026 outline, Package A)
// ---------------------------------------------------------------------------

/** What the log and the pickers call a flight. */
export function flightName(game: GameState, flight: Flight): string {
  const card = fighterCard(flight.cardId)
  const mother = game.ships.find((s) => s.id === flight.motherId)
  const tail = mother ? ` (${mother.name.split(' ').pop()})` : ''
  return `${card?.name ?? flight.cardId} flight${tail}`
}

export function flightsOf(game: GameState, ship: ShipState): Flight[] {
  return game.flights.filter((f) => f.motherId === ship.id && !flightDestroyed(f))
}

/** Flights this ship has out on the board — the ones that count against its four. */
export function flightsAirborne(game: GameState, ship: ShipState): Flight[] {
  return flightsOf(game, ship).filter((f) => !f.dockedTo)
}

/**
 * Flights that have come home and are sitting on the deck, fullest first.
 *
 * These are counters with a history — casualties taken, ordnance spent — and
 * they are what a carrier launches next, in preference to breaking out a fresh
 * flight. Skipping that step was a real bug: a landed flight stayed in
 * `game.flights` while the landing *also* credited a slot back to
 * `flightsAboard`, so a four-box hangar put eight flights into the air over
 * six rounds and each landing quietly conjured six new fighters.
 */
export function flightsDocked(game: GameState, ship: ShipState): Flight[] {
  return flightsOf(game, ship)
    .filter((f) => f.dockedTo === ship.id)
    .sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : 1))
}

/**
 * Everything in the hangar: flights that have landed, plus the ones that have
 * never been broken out. Both take up a bay, so both count against HNGR.
 */
export function flightsInHangar(game: GameState, ship: ShipState): number {
  return ship.flightsAboard + flightsDocked(game, ship).length
}

/**
 * The card a carrier flies. A scenario may name one; otherwise the launching
 * player picks, and the first card is what the AI and the default button take.
 */
export function wingCardFor(ship: ShipState): string {
  return ship.wingCardId ?? FIGHTER_CARDS[0].id
}

/**
 * Put a flight on the board during Flight Operations.
 *
 * One flight per undamaged LNCH box per phase (Q5), and **one cloak-detection
 * roll however many fighters go out** (Q12‑A): H6.15.4 gives every searching
 * ship "+1 Roll per Small Craft Launched", and counting a six-fighter flight as
 * six launches would forbid a cloaked carrier to operate at all.
 */
export function launchFlight(
  game: GameState,
  ship: ShipState,
  cardId: string = wingCardFor(ship),
  config: FighterConfigKind = 'space-superiority',
  members = MAX_FLIGHT_SIZE,
): string | null {
  const card = fighterCard(cardId)
  if (!card) return `No such fighter card: ${cardId}.`
  if (!loadoutOf(card, config)) return `The ${card.name} has no ${config} loadout.`
  if (members < 1 || members > MAX_FLIGHT_SIZE) {
    return `A flight is 1 to ${MAX_FLIGHT_SIZE} fighters.`
  }
  const refusal = flightLaunchRefusal(
    ship,
    flightsAirborne(game, ship).length,
    game.ops.flightsLaunchedThisPhase[ship.id] ?? 0,
    flightsInHangar(game, ship),
  )
  if (refusal) return refusal

  /*
   * A flight already on the deck goes back up before a fresh one is broken
   * out, and it goes up as it came down — the fighters it has left, and the
   * load the Hangar Bay Segment gave it back. The wing is a fixed number of
   * flights taking losses over a battle, not an infinite supply of six-packs.
   */
  const docked = flightsDocked(game, ship)[0]
  if (docked) {
    delete docked.dockedTo
    docked.position = launchPositionFor(ship)
    docked.activated = true
    docked.attacked = false
    game.ops.flightsLaunchedThisPhase[ship.id] =
      (game.ops.flightsLaunchedThisPhase[ship.id] ?? 0) + 1
    pushLog(
      game,
      `${ship.name}: puts ${flightName(game, docked)} back up — ${docked.members} aboard, ` +
        `${CONFIG_LABELS[currentConfig(docked)]}.`,
    )
    launchRevealsCloak(game, ship, 1)
    return null
  }

  game.counters.flight += 1
  ship.flightsAboard -= 1
  game.flights.push({
    id: `flight-${game.counters.flight}`,
    side: ship.side,
    motherId: ship.id,
    cardId,
    config,
    spent: false,
    members,
    position: launchPositionFor(ship),
    damage: 0,
    // Forming up is this phase's activation, as a launched shuttle's is (J8.2.1).
    activated: true,
    attacked: false,
  })
  game.ops.flightsLaunchedThisPhase[ship.id] =
    (game.ops.flightsLaunchedThisPhase[ship.id] ?? 0) + 1
  pushLog(game, `${ship.name}: launches ${members} ${card.name} in ${config} configuration.`)
  // One launch, however many fighters are in it (Q12-A).
  launchRevealsCloak(game, ship, 1)
  return null
}

/** Fly a flight. No facing, no plot — a bearing and a distance (J8.2.3). */
export function moveFlight(game: GameState, flightId: string, to: Point): string | null {
  const flight = game.flights.find((f) => f.id === flightId)
  if (!flight) return 'No such flight.'
  const card = fighterCard(flight.cardId)
  if (!card) return 'No such fighter card.'
  const refusal = flightMoveRefusal(flight, card, to)
  if (refusal) return refusal
  flight.position = to
  flight.activated = true
  return null
}

/** Land a flight back aboard — one per undamaged LNDG box per phase (Q5). */
export function recoverFlight(game: GameState, flightId: string, ship: ShipState): string | null {
  const flight = game.flights.find((f) => f.id === flightId)
  if (!flight) return 'No such flight.'
  if (flight.dockedTo) return 'That flight is already aboard.'
  const refusal = flightRecoveryRefusal(
    flight,
    ship,
    game.ops.flightsRecoveredThisPhase[ship.id] ?? 0,
    flightsInHangar(game, ship),
  )
  if (refusal) return refusal

  game.ops.flightsRecoveredThisPhase[ship.id] =
    (game.ops.flightsRecoveredThisPhase[ship.id] ?? 0) + 1
  // The flight itself takes the bay. `flightsAboard` counts only the ones
  // never broken out, so crediting it here would double the wing.
  flight.dockedTo = ship.id
  flight.activated = true
  pushLog(game, `${ship.name}: recovers ${flightName(game, flight)} — ${flight.members} back aboard.`)
  return null
}

/**
 * One flight shoots at another, in Flight Operations.
 *
 * Fighter-versus-fighter is the d6 subsystem in full: DFR to hit, Dodge to
 * save, and every unsaved hit takes a fighter. Range is the attacker's own
 * movement allowance — a dogfight is a merge, not a gunnery duel — and jamming
 * does nothing here, since E10.2.2 is a range-bracket rule for *starship*
 * gunnery and a fighter has no brackets.
 */
export function flightDogfight(game: GameState, flightId: string, targetId: string): string | null {
  const flight = game.flights.find((f) => f.id === flightId)
  const target = game.flights.find((f) => f.id === targetId)
  if (!flight || !target) return 'No such flight.'
  if (flight.side === target.side) return 'That flight is friendly.'
  if (flight.dockedTo || target.dockedTo) return 'A flight in the hangar is out of the fight.'
  if (flight.attacked) return 'That flight has already attacked this phase.'
  const card = fighterCard(flight.cardId)
  const targetCard = fighterCard(target.cardId)
  if (!card || !targetCard) return 'No such fighter card.'
  const loadout = currentLoadout(flight, card)
  const targetLoadout = currentLoadout(target, targetCard)
  if (!loadout || !targetLoadout) return 'No such loadout.'

  const reach = airframeSpeed(card, loadout)
  const range = distance(flight.position, target.position)
  if (range > reach + 1e-9) {
    return `${flightName(game, target)} is ${range.toFixed(1)}" away; a ${card.name} reaches ${reach}".`
  }

  const result = dogfight(
    { members: flight.members, dfr: loadout.dfr },
    { members: target.members, dodge: targetLoadout.dodge },
    game.rng,
  )
  flight.attacked = true
  target.members -= result.kills
  pushLog(
    game,
    `${flightName(game, flight)} engages ${flightName(game, target)}: ` +
      `${result.hits} hit(s) on DFR 1‑${loadout.dfr}, ${result.dodged} dodged on 1‑${targetLoadout.dodge}, ` +
      `${result.kills} destroyed` +
      (flightDestroyed(target) ? ' — the flight is wiped out' : `, ${target.members} left`),
  )
  if (flightDestroyed(target)) game.flights = game.flights.filter((f) => f.id !== target.id)
  return null
}

/**
 * A flight strikes a starship, in Flight Operations.
 *
 * One d6 per fighter against the card's Strike range, each hit doing the card's
 * damage to the shield the flight is bearing on. The ship has already had its
 * point-defense answer: E12.3.4 gives it that shot before the small craft
 * attack, and the sequence of play gives it too — offensive fire is resolved in
 * the Combat Segment, which closes before flights act.
 *
 * The load is spent in the act, and the counter flips to its BASIC face (Q4‑A).
 */
export function flightStrike(game: GameState, flightId: string, shipId: string): string | null {
  const flight = game.flights.find((f) => f.id === flightId)
  const ship = game.ships.find((s) => s.id === shipId)
  if (!flight || !ship) return 'No such flight or ship.'
  if (flight.side === ship.side) return 'That ship is friendly.'
  if (flight.dockedTo) return 'That flight is in the hangar.'
  if (flight.attacked) return 'That flight has already attacked this phase.'
  if (ship.destroyed || ship.disengaged) return `${ship.name} is out of the battle.`
  const card = fighterCard(flight.cardId)
  if (!card) return 'No such fighter card.'
  const loadout = currentLoadout(flight, card)
  if (!loadout) return 'No such loadout.'
  if (loadout.strikeHit <= 0) return `${card.name} in this configuration is unarmed against ships.`

  const reach = airframeSpeed(card, loadout)
  const range = distance(flight.position, ship.placement.position)
  if (range > reach + 1e-9) {
    return `${ship.name} is ${range.toFixed(1)}" away; a ${card.name} reaches ${reach}".`
  }

  const result = strike(flight, loadout, game.rng)
  flight.attacked = true
  const config = currentConfig(flight)
  if (strikeExpendsLoad(config)) flight.spent = true

  if (result.damage === 0) {
    pushLog(
      game,
      `${flightName(game, flight)} runs in on ${ship.name} and scores nothing` +
        (flight.spent ? ' — ordnance expended, the counter flips to BASIC' : ''),
    )
    return null
  }

  const side = shieldsFacing(flight.position, ship.placement.position, ship.placement.heading)[0]
  const outcome = applyVolley(
    ship,
    {
      standard: result.damage,
      leak: 0,
      structurePenetration: 0,
      side,
      shieldsInoperative:
        shieldsInoperative(cloudConditions(game.scenario), ship) || shipIsCloaked(game, ship),
    },
    damageContext(game),
  )
  recordShieldHit(game, ship.id, side, outcome.greenAbsorbed + outcome.blueAbsorbed)
  damageRevealsCloak(game, ship, result.damage)
  pushLog(
    game,
    `${flightName(game, flight)} strikes ${ship.name}'s ${side} shield: ` +
      `${result.hits} hit(s) on 1‑${loadout.strikeHit} for ${result.damage} damage` +
      (flight.spent ? ' — ordnance expended, the counter flips to BASIC' : ''),
  )
  return null
}

/**
 * The Hangar Bay Segment (A3.4.4), which the published sequence of play prints
 * as "TBD".
 *
 * A flight that is aboard rearms: the counter comes back off its BASIC face
 * with a full load. That is the whole of "Repair and Rearm" as the outline has
 * it — fighters lost are lost, and nothing here replaces them.
 */
export function runHangarBay(game: GameState): void {
  for (const flight of game.flights) {
    if (!flight.dockedTo || !flight.spent) continue
    const ship = game.ships.find((s) => s.id === flight.dockedTo)
    if (!ship || ship.destroyed || ship.derelict) continue
    if (hangarCapacity(ship) === 0) continue
    flight.spent = false
    pushLog(game, `${ship.name}: rearms ${flightName(game, flight)} in the hangar.`)
  }
}

function positionOfObject(game: GameState, id: string): { x: number; y: number } | undefined {
  const ship = game.ships.find((s) => s.id === id && !s.destroyed && !s.disengaged)
  if (ship) return ship.placement.position
  const feature = game.scenario.terrain.find((t) => t.id === id)
  if (feature) return feature.center
  const craft = game.smallCraft.find((c) => c.id === id)
  if (craft) return craft.position
  return game.homing.find((h) => h.id === id && !h.destroyed && !h.impacted)?.position
}

/** Probes fly during the Navigation Segment (J7.3.2). */
function moveProbes(game: GameState): void {
  for (const craft of [...game.smallCraft]) {
    if (craft.kind !== 'probe') continue
    const target = craft.targetId ? positionOfObject(game, craft.targetId) : undefined
    if (!target) {
      game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
      pushLog(game, `${craftName(craft)} loses its target and is removed (J7.3.2).`)
      continue
    }
    if (craft.transmitting) {
      const mother = shipById(game, craft.motherId)
      if (!probeStillWorks(craft, target, mother)) {
        game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
        pushLog(game, `${craftName(craft)} loses contact and ceases to function (J7.3.2).`)
      }
      continue
    }
    const step = moveProbe(craft, target)
    craft.position = step.position
    if (step.arrived) {
      craft.transmitting = true
      pushLog(game, `${craftName(craft)} arrives on station and begins transmitting (J7.3.2).`)
    } else if (step.lost) {
      game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
      pushLog(game, `${craftName(craft)} cannot close on its target and is lost (J7.3.2).`)
    }
  }
}

/** Transmitting probes feed information back during Step E (J7.3.3). */
export function gatherProbeInfo(game: GameState): void {
  for (const craft of game.smallCraft) {
    if (craft.kind !== 'probe' || !craft.transmitting || !craft.targetId) continue
    const target = positionOfObject(game, craft.targetId)
    const mother = shipById(game, craft.motherId)
    if (!target || !probeStillWorks(craft, target, mother)) continue
    addInfoPoints(game.ops.info, craft.side, craft.targetId, PROBE_INFO_PER_PHASE)
    pushLog(game, `${craftName(craft)}: +${PROBE_INFO_PER_PHASE} info point (J7.3.3).`)
  }
}

/** Jamming shuttles that can no longer keep up scuttle themselves (J8.4.2). */
function scuttleJammers(game: GameState): void {
  for (const craft of scuttledJammers(game.smallCraft, game.ships)) {
    game.smallCraft.splice(game.smallCraft.indexOf(craft), 1)
    pushLog(game, `${craftName(craft)} self-destructs to avoid capture (J8.4.2).`)
  }
}

// ---------------------------------------------------------------------------
// J6 — Boarding combat
// ---------------------------------------------------------------------------

/** Ships with enemy marines aboard, awaiting the Boarding Combat Segment. */
export function shipsUnderBoarding(game: GameState): ShipState[] {
  return activeShips(game).filter((ship) => boardersAboard(ship) > 0)
}

/**
 * How many attacking squads are going after the ship rather than its defenders
 * this round (J6.2.4). Set during the Boarding Combat Segment; cleared with it.
 */
export function setSabotageSquads(game: GameState, ship: ShipState, side: string, squads: number): void {
  game.ops.sabotage[`${ship.id}:${side}`] = Math.max(0, squads)
}

export function sabotageSquads(game: GameState, ship: ShipState, side: string): number {
  return game.ops.sabotage[`${ship.id}:${side}`] ?? 0
}

/**
 * One round of boarding combat aboard a ship (J6.2.2), including any squads
 * that chose to wreck the ship instead of fighting its marines (J6.2.4).
 */
export function fightBoarders(game: GameState, ship: ShipState, side: string): BoardingOutcome {
  game.ops.boardingFought.add(`${ship.id}:${side}`)
  const outcome = resolveBoarding(ship, side, game.rng, sabotageSquads(game, ship, side))

  pushLog(
    game,
    `${ship.name}: boarding combat — ${outcome.attackers.dice} attacking die/dice ` +
      `(${outcome.attackers.faces.join('') || '—'}) kill ${outcome.attackers.kills}, ` +
      `${outcome.defenders.dice} defending (${outcome.defenders.faces.join('') || '—'}) kill ${outcome.defenders.kills}.`,
  )
  if (outcome.attackers.squads > outcome.attackers.dice || outcome.defenders.squads > outcome.defenders.dice) {
    pushLog(game, `${ship.name}: tight quarters cap the larger force's dice (J6.2.3).`)
  }

  // J6.2.4 — sabotage lands as ordinary damage cards, except that anything
  // reaching the structure track is simply lost.
  if (outcome.sabotage.damage > 0) {
    pushLog(
      game,
      `${ship.name}: ${outcome.sabotage.squads} squad(s) attack the ship for ${outcome.sabotage.damage} damage (J6.2.4).`,
    )
    drawAndResolve(ship, outcome.sabotage.damage, { ...damageContext(game), marineAttack: true })
  }

  if (outcome.captured) {
    ship.capturedBy = side
    ship.capturedRound = game.round
    pushLog(game, `${ship.name} is captured by ${side} (J6.2.5).`)
  } else if (outcome.repelled) {
    pushLog(game, `${ship.name}: the boarding action is repelled (J6.2.2 item 3).`)
  } else {
    pushLog(game, `${ship.name}: boarders hold on and the fight runs into the next round.`)
  }
  return outcome
}

/** Resolve every boarding action still running, in the Final Phase (J6.2.1). */
function resolveAllBoarding(game: GameState): void {
  for (const ship of shipsUnderBoarding(game)) {
    for (const side of boardingSides(ship)) {
      if (ship.destroyed || ship.capturedBy === side) continue
      // A captain who pressed the attack during the segment has already had
      // this round's combat; closing the segment does not give them another.
      if (game.ops.boardingFought.has(`${ship.id}:${side}`)) continue
      fightBoarders(game, ship, side)
    }
  }
  game.ops.sabotage = {}
  game.ops.boardingFought.clear()
}

// ---------------------------------------------------------------------------
// Terrain effects (K1.3, K2.1.6)
// ---------------------------------------------------------------------------

/** Asteroid fields damage ships that transit above the safe speed (K2.1.6). */
function applyTerrainDamage(game: GameState, ship: ShipState, path: Array<{ x: number; y: number }>): void {
  applyCloudDamage(game, ship)
  for (const feature of game.scenario.terrain) {
    if (feature.kind !== 'asteroid-field') continue
    // Any part of the 1.5-inch base overlapping counts, so the counter is
    // effectively 3/4 inch larger all round (K2.1.4).
    const entered = path.some(
      (p) => Math.hypot(p.x - feature.center.x, p.y - feature.center.y) <= feature.radius + BASE_OVERLAP,
    )
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
    // H6.15.3 / H6.8.11: rocks hit a cloaked hull as hard as anything else,
    // and the shudder is what gives it away.
    damageRevealsCloak(game, ship, total)
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
  damageRevealsCloak(game, ship, total)
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
