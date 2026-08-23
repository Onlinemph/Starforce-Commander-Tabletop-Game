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
/**
 * A carrier's wing between battles (3.3): the readiness ladder the round tick
 * climbs back up. Rearming takes two rounds anywhere; a depleted wing needs a
 * fleet base to rebuild before it can rearm at all.
 */
export interface WingRecord {
  cardId: string
  readiness: 'ready' | 'rearming' | 'depleted' | 'destroyed'
  /** Rounds of rearming left, while readiness is 'rearming'. */
  rearmRounds: number
}

export interface ShipRecord {
  id: string
  /** Canon or embedded custom form id. */
  formId: string
  name: string
  /** The fighter wing this hull carries, if any (3.3). */
  wing?: WingRecord
  /**
   * Exact marked boxes between battles (3.2) — the engine's own ShipScars
   * shape (its 7.6.2 integration point), captured at battle end and applied
   * at the next deployment. Absent until the ship has scars.
   */
  scars?: import('../engine/shipState').ShipScars
}

export type Formation = 'close' | 'standard' | 'wide'

/**
 * A unit's standing orders (5.2): the waypoint list and posture flags that let
 * a phase resolve with zero decisions. Changing any of this is an intervention
 * — a journal entry; the auto-steps the orders produce are derived.
 */
/**
 * The speed the order asks for, named in the designer's tiers rather than a
 * number so the same order means the same thing aboard any hull: what
 * 'cruise' IS in hexes a round is the unit's own derived stat (stats.ts
 * SpeedTiers). Cruise is efficient; max cruise less so; maximum and emergency
 * burn the tanks hard and light the ship up on enemy scopes, and emergency
 * running risks the drives themselves.
 */
export type SpeedTier = 'hold' | 'cruise' | 'max-cruise' | 'maximum' | 'emergency'

export interface StandingOrder {
  /** Ordered path; the unit steps toward waypoints[0] on its scheduled phases. */
  waypoints: Hex[]
  speed: SpeedTier
  /**
   * An exact speed in hexes a round (the designer's "set specific speeds"),
   * overriding the named tier when set. Clamped to the unit's envelope —
   * hold 0 up to emergency — and civilian units cap at 1–3 by merchant hull
   * (his note). The endurance burn and detection signature come from
   * whichever tier the number lands in, so 5 on a Yorktown burns like max
   * cruise and 9 lights it up like maximum.
   */
  exactSpeed?: number
  /** Passive-scan power setting: 0 quiet, 1 normal, 2 loud-and-sharp (4.3). */
  sensorPower: 0 | 1 | 2
  /**
   * Active Sensors order (designer's orders list): a separate dial from the
   * power setting. Active mode sharpens the searcher's own detection and
   * intelligence — strongly inside range 2 — and makes the emitter itself
   * read +7 signature speed on every enemy scope (sensorModel.ts §5–6).
   */
  activeSensors?: boolean
  cloaked: boolean
  formation: Formation
  /**
   * What to do when an engagement triggers in this unit's hex (7.2):
   * stand and fight (default), try to withdraw, or — while the enemy does
   * not know this unit exists — stay silent and let them pass. A hidden
   * unit whose posture is 'fight' springs an ambush (7.1).
   */
  engagement?: 'fight' | 'withdraw' | 'silent'
  /**
   * Repair priority for the round tick (3.2): categories fixed first, in
   * order. Unset uses DEFAULT_REPAIR_QUEUE. One queue per unit — the doc
   * says per ship; per unit is the same knob with less clicking, revisit if
   * playtests want finer control.
   */
  repairPriority?: RepairCategory[]
  /**
   * Intercept or Shadow (5.3) — aimed at a CONTACT of the ordering side,
   * never at an enemy unit directly. That indirection is the anti-leak
   * guarantee: the resolver steers toward the contact's estimated position,
   * the same estimate the side's view shows, so no order — a player's or a
   * future AI's — can act on information the side does not hold.
   */
  mission?: { type: 'intercept' | 'shadow'; contactId: string }
}

export type RepairCategory = 'drive' | 'shields' | 'weapons' | 'sensors' | 'systems' | 'structure'

/** Doc 3.2's default queue; 'systems' sweeps everything the five don't name. */
export const DEFAULT_REPAIR_QUEUE: readonly RepairCategory[] = [
  'drive',
  'shields',
  'weapons',
  'sensors',
  'systems',
  'structure',
]

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
  /** Endurance points remaining (6.4): fuel, supplies, ammo, spares. */
  endurance: number
  /** The tank's size — the smallest aboard sets the unit's legs (3.1). */
  enduranceMax: number
  /** Cloaked during any phase this round: +1 endurance at the tick (6.4). */
  cloakedThisRound: boolean
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

/**
 * The designer's contact states (briefing §13): a track is gained, held phase
 * to phase, lost, and — knowing the signature now — reacquired more easily
 * than it was first found. 'undetected' is the absence of a record; a
 * collapsed record (three quiet rounds) reads as undetected again.
 */
export type TrackState = 'detected' | 'tracked' | 'track-lost' | 'reacquired'

export interface ContactRecord {
  /** Opaque (`ct-<side>-<seq>`): a contact id that named its target unit
   *  would hand the enemy's order of battle to any client that read it. */
  id: string
  /** The side doing the seeing. */
  side: Side
  /** True unit this record shadows — umpire-only. A false contact shadows
   *  nothing: its target id (`phantom-<seq>`) matches no unit, ever. */
  targetUnitId: string
  /**
   * Track state (briefing §13). Absent on records from before the sensor
   * model landed — read those as 'tracked', which is what the old sweep's
   * successful-scan-only records were.
   */
  track?: TrackState
  /** Range at the last scan attempt, for retention's range-change adjustment. */
  lastRange?: number
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
  /** Fighter card per ship, for hulls with hangars (3.3). Null entries fly nothing. */
  wings?: (string | null)[]
  /** A reinforcement: held off the map until this round's tick (1.2, S3.2). */
  arrivesRound?: number
  /** Convoys: the hex that scores the delivery, and what it is worth (6.3, 10.1). */
  deliverHex?: Hex
  deliveryVp?: number
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
  /** First to this many victory points wins outright (10.1). Unset: rounds only. */
  vpThreshold?: number
  /** Balance dials (10.3), detection curve first among them. */
  tuning: {
    detectionCurve: readonly number[]
    misinformationBase: number
    falseContacts: boolean
    /**
     * Overrides for the sensor model's coefficients (sensorModel.ts) — the
     * designer's "keep all coefficients in a configurable data structure",
     * per scenario so a tuning pass is data, not a source change.
     */
    sensorModel?: Record<string, unknown>
  }
}

/** A standing-order change — the only thing a player actually journals (5.2). */
export type Intervention =
  | { type: 'set-order'; unitId: string; order: StandingOrder }
  | { type: 'set-waypoints'; unitId: string; waypoints: Hex[] }
  | { type: 'set-repair-priority'; unitId: string; queue: RepairCategory[] }

/**
 * One journal entry: one side's phase (5.1). A moves the odd phases, B the
 * even, and a unit's speed decides which of its side's eight phases it
 * actually steps in (schedule.ts).
 * Auto-steps are derived from standing orders and are NOT journalled.
 */
export interface PhaseMove {
  round: number
  /** 1–16 (schedule.ts ROUND_PHASES). */
  phase: number
  side: Side
  interventions: Intervention[]
  /**
   * Results for battles pending when this move was made (Part 9's journal
   * shape). The resolver refuses any move while a battle is unresolved and
   * its results are not aboard: the campaign waits for the table.
   */
  battles?: BattleRecord[]
}

/** One fought battle, as the journal remembers it (7.4, Part 9). */
export interface BattleRecord {
  engagementId: string
  /** FNV-1a of the generated battle file, linking journal to battle. */
  fileHash: string
  result: BattleResult
}

/**
 * What came back from the table — computed by readback for on-screen and
 * headless battles, hand-entered for the physical table (7.4). Ship keys are
 * `unitId/shipRecordId`.
 */
export interface BattleResult {
  ships: Record<
    string,
    {
      destroyed: boolean
      /** Left the map under J9 — retreats a hex on the operational map. */
      disengaged: boolean
      scars: import('../engine/shipState').ShipScars | null
      /** The carrier's wing after the battle, if the hull carries one (3.3). */
      wing?: WingRecord
    }
  >
  vp: Record<Side, number>
}

/** An engagement waiting on the table (7.1). Umpire truth; views filter it. */
export interface PendingEngagement {
  id: string
  hex: Hex
  round: number
  phase: number
  unitIds: Record<Side, string[]>
  /** The side that sprang from silence, if any — it deploys second (7.1). */
  ambushBy: Side | null
  /** A withdrawal that failed: the runner fights as defender (7.2). */
  caughtRetreating: Side | null
}

export interface CampaignState {
  round: number
  /** The phase about to be resolved, 1–16. */
  phase: number
  /** Copied from the scenario at creation so the resolver can end the clock. */
  roundLimit: number
  /** Next contact sequence number, so contact ids stay opaque and stable. */
  contactSeq: number
  /** Next engagement sequence number. */
  engagementSeq: number
  /** Battles triggered and not yet resolved — the campaign holds for them. */
  pendingBattles: PendingEngagement[]
  /** Reinforcements not yet arrived, spawned by the round tick (S3.2). */
  reinforcements: Array<{ arrivesRound: number; side: Side; unit: Unit }>
  /** Set when the campaign ends: the higher ledger, or a draw (10.1). */
  winner: Side | 'draw' | null
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
