/**
 * Border Command — campaign state schema (design doc Part 0.3, Part 9).
 *
 * The operational layer above the tactical engine: a campaign is
 * `(setup + move journal)` exactly as a battle is `(setup + action journal)`,
 * and everything here obeys the same discipline as `src/engine/` — pure data,
 * no UI dependencies, all randomness drawn from a seeded stream whose position
 * lives in the state it randomizes.
 *
 * Three views exist over this state: the umpire's truth and one filtered view
 * per side. This module holds only truth; `views.ts` (Phase 2) derives the
 * rest and player-facing code may never import truth directly.
 */

// ---------------------------------------------------------------------------
// Hexes and the map (Part 2)
// ---------------------------------------------------------------------------

/** Flat-top axial coordinates. All hex math lives in hexmap.ts — never inline. */
export interface Hex {
  q: number
  r: number
}

export type TerrainKind = 'deep' | 'system' | 'nebula' | 'dust'

/**
 * The generated map, stored whole in the campaign file and never regenerated
 * at load (2.2): a seed plus a generator version is a promise the generator
 * cannot keep across releases, and the map is small.
 */
export interface CampaignMap {
  width: number
  height: number
  /** Sparse: hexes absent from the list are deep space. Keys `q,r`. */
  terrain: Array<{ q: number; r: number; kind: Exclude<TerrainKind, 'deep'> }>
  /** The contested border, a jagged line of hexes A-side of which is A's (2.3). */
  border: Hex[]
}

// ---------------------------------------------------------------------------
// Units and orders (Parts 3, 5, 6)
// ---------------------------------------------------------------------------

export type Side = 'A' | 'B'

/** One ship aboard a unit. Damage state rides along whole from Phase 3 on. */
export interface ShipRecord {
  id: string
  /** Canon or embedded custom form id. */
  formId: string
  name: string
  /**
   * The tactical engine's serialized ship state between battles — exact marked
   * boxes, not a percentage (3.2). Absent until the ship has scars.
   */
  damage?: unknown
}

export type Formation = 'close' | 'standard' | 'wide'

/**
 * A unit's standing orders (5.2): the waypoint list and posture flags that let
 * a phase resolve with zero decisions. Changing any of this is an intervention
 * — a journal entry; the auto-steps the orders produce are derived.
 */
export interface StandingOrder {
  /** Ordered path; the unit steps one hex toward waypoints[0] each own phase. */
  waypoints: Hex[]
  speed: 'cruise' | 'hold'
  /** Passive-scan power setting: 0 quiet, 1 normal, 2 loud-and-sharp (4.3). */
  sensorPower: 0 | 1 | 2
  cloaked: boolean
  formation: Formation
  /**
   * Intercept or Shadow (5.3) — aimed at a CONTACT of the ordering side,
   * never at an enemy unit directly. That indirection is the anti-leak
   * guarantee: the resolver steers toward the contact's estimated position,
   * the same estimate the side's view shows, so no order — a player's or a
   * future AI's — can act on information the side does not hold.
   */
  mission?: { type: 'intercept' | 'shadow'; contactId: string }
}

export type UnitKind = 'ship' | 'group' | 'starwing' | 'convoy'

export interface Unit {
  id: string
  side: Side
  kind: UnitKind
  /** 1 for a lone ship; 2–8 for a group (6.1). */
  ships: ShipRecord[]
  hex: Hex
  order: StandingOrder
  /**
   * Phases still owed to the hex being entered: nebula and dust cost two
   * phases per hex (2.2), so entering one sets this to 1 and the next own
   * phase is spent clearing it.
   */
  moveDebt: number
  /** Endurance points remaining (6.4). Ticked at round end from Phase 4 on. */
  endurance: number
  /**
   * Whether the unit changed hex (or paid slow-terrain debt) in its most
   * recent own phase — the "held still" input to the detection bands (4.3),
   * public in the physical sense a drive plume is public.
   */
  movedLastOwnPhase: boolean
  /** Last step direction, for dead-reckoning a contact's course (4.4). */
  course: Hex | null
}

// ---------------------------------------------------------------------------
// Infrastructure (3.4)
// ---------------------------------------------------------------------------

export type InfrastructureKind = 'fleet-base' | 'outpost' | 'colony' | 'listening-post' | 'jump-beacon'

export interface Infrastructure {
  id: string
  side: Side
  kind: InfrastructureKind
  hex: Hex
  destroyed: boolean
}

// ---------------------------------------------------------------------------
// Contacts (Part 4) — schema now, mechanics in Phase 2
// ---------------------------------------------------------------------------

/** The graded attribute ladder, ordered roughly by how early each resolves (4.4). */
export const CONTACT_ATTRIBUTES = [
  'exists',
  'bearingClass',
  'sizeClass',
  'speed',
  'count',
  'faction',
  'damage',
  'shipClass',
  'shipName',
] as const

export type ContactAttribute = (typeof CONTACT_ATTRIBUTES)[number]

export interface ContactEntry {
  /** What the player was told. */
  value: string
  /**
   * Whether it happens to be true — umpire-only (4.5). Falsehood is never
   * flagged in a player view; finding out is the game.
   */
  truthful: boolean
  /** Range band the attribute resolved at; closer scans may re-roll lies. */
  resolvedAtRange: number
  /** Unscanned for a full round: greyed in the view (4.4). */
  stale: boolean
}

export interface ContactRecord {
  /** Opaque (`ct-<side>-<seq>`): a contact id that named its target unit
   *  would hand the enemy's order of battle to any client that read it. */
  id: string
  /** The side doing the seeing. */
  side: Side
  /** True unit this record shadows — umpire-only. */
  targetUnitId: string
  attributes: Partial<Record<ContactAttribute, ContactEntry>>
  /** Where the viewer believes it is; exact when scanned this phase. */
  estimatedHex: Hex
  positionEstimated: boolean
  lastScan: { round: number; phase: number }
  /** Rounds with no successful scan; 3 collapses to a last-known marker (4.4). */
  unscannedRounds: number
  /** Last observed course (truth's step direction at scan time), for reckoning. */
  course: Hex | null
  /** Last observed speed band, for reckoning: a holder is not extrapolated. */
  observedMoving: boolean
}

// ---------------------------------------------------------------------------
// The seeded stream (0.3.2)
// ---------------------------------------------------------------------------

/**
 * Randomness as state: the value of draw N from seed S is a pure function of
 * (S, N), so a replay that makes the same draws in the same order gets the
 * same campaign — and the call count in a stored state must match the count a
 * replay arrives at, which the replay test asserts.
 */
export interface CampaignRng {
  seed: number
  calls: number
}

/** Next value in [0, 1), advancing the stream. splitmix64-flavoured, 32-bit. */
export function nextRandom(rng: CampaignRng): number {
  rng.calls += 1
  let x = (rng.seed ^ Math.imul(rng.calls, 0x9e3779b9)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  return x / 0x100000000
}

/** An integer in [0, n), advancing the stream. */
export function nextInt(rng: CampaignRng, n: number): number {
  return Math.floor(nextRandom(rng) * n)
}

// ---------------------------------------------------------------------------
// Scenario, moves, state, file (Parts 5, 9)
// ---------------------------------------------------------------------------

/**
 * Doyle's ballpark per-scan detection curve (4.2), by range 0..5. Stored in
 * the scenario as data, not code: the curve's feel depends on scan frequency
 * (twelve scans a round), and tuning it must not be a source change.
 */
export const DETECTION_CURVE: readonly number[] = [0.95, 0.85, 0.75, 0.45, 0.25, 0.02]

export interface ScenarioForceUnit {
  id: string
  kind: UnitKind
  name?: string
  /** Form ids, one per ship. */
  ships: string[]
  hex: Hex
  order?: Partial<StandingOrder>
}

export interface CampaignScenario {
  name: string
  /** Campaign length in rounds (1.2: 20–40). */
  rounds: number
  /** Map generation inputs; the generated map itself is stored beside this. */
  mapSeed: number
  mapWidth: number
  mapHeight: number
  forces: Record<Side, ScenarioForceUnit[]>
  infrastructure: Array<Omit<Infrastructure, 'destroyed'>>
  /** Balance dials (10.3), detection curve first among them. */
  tuning: {
    detectionCurve: readonly number[]
    misinformationBase: number
    falseContacts: boolean
  }
}

/** A standing-order change — the only thing a player actually journals (5.2). */
export type Intervention =
  | { type: 'set-order'; unitId: string; order: StandingOrder }
  | { type: 'set-waypoints'; unitId: string; waypoints: Hex[] }

/**
 * One journal entry: one side's phase (5.1). A moves in odd phases, B in even.
 * Auto-steps are derived from standing orders and are NOT journalled.
 */
export interface PhaseMove {
  round: number
  /** 1–12. */
  phase: number
  side: Side
  interventions: Intervention[]
}

export interface CampaignState {
  round: number
  /** The phase about to be resolved, 1–12. */
  phase: number
  /** Copied from the scenario at creation so the resolver can end the clock. */
  roundLimit: number
  /** Next contact sequence number, so contact ids stay opaque and stable. */
  contactSeq: number
  rng: CampaignRng
  units: Unit[]
  infrastructure: Infrastructure[]
  contacts: ContactRecord[]
  vp: Record<Side, number>
  finished: boolean
}

/** The one JSON document (Part 9). Unknown fields round-trip via `extra`. */
export interface CampaignFile {
  formatVersion: 1
  campaignId: string
  scenario: CampaignScenario
  map: CampaignMap
  journal: PhaseMove[]
  /** Derived cache — recomputable from scenario + journal; loaders verify. */
  state: CampaignState
}

/** Whose phase this is: A moves the odd phases, B the even (5.1). */
export function sideToMove(phase: number): Side {
  return phase % 2 === 1 ? 'A' : 'B'
}
