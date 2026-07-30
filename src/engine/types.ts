/**
 * StarForce Commander — core type definitions.
 *
 * Rule references in comments point at the v2.6 Basic Set rulebook
 * (e.g. `B1.3.1` = Section B, chapter 1, rule 3.1).
 *
 * The ship-form schema below is designed to be authored as data. Everything
 * the Standard rules can read off a printed ship form has a home here, so
 * importing the canon Ship Book should never require an engine change.
 */

// ---------------------------------------------------------------------------
// Dice (A2.7, E7.2)
// ---------------------------------------------------------------------------

/** The four attack dice, weakest to strongest. */
export type DieColor = 'blue' | 'green' | 'yellow' | 'red'

/** A single die face. `-` is a blank (miss). */
export type DieFace = '-' | 'L' | 'M' | 'H' | 'S'

// ---------------------------------------------------------------------------
// Geometry (E2)
// ---------------------------------------------------------------------------

/** The eight 45-degree firing arcs (E2.2.1). */
export type Arc = 'FS' | 'SF' | 'SA' | 'AS' | 'AP' | 'PA' | 'PF' | 'FP'

/** The four shield facings (G1.1.1). Also used for armor (G2.1.1). */
export type ShieldSide = 'F' | 'S' | 'A' | 'P'

/** Position on the play surface, in inches. Origin is the map's top-left. */
export interface Point {
  x: number
  y: number
}

/**
 * A unit's position and facing. Headings are degrees clockwise from "up" the
 * map, which is direction 8 on the scenario compass rose (S2.5.2).
 */
export interface Placement {
  position: Point
  heading: number
}

// ---------------------------------------------------------------------------
// Ship form: engineering (B1.4, B2)
// ---------------------------------------------------------------------------

/**
 * One reactor "power point" — a green dot plus the black boxes that must all
 * be marked before the point stops producing power (B1.4.1, E8.5.1).
 */
export interface PowerPointDef {
  /** Number of hit boxes this power point can absorb before going offline. */
  boxes: number
}

/** A reactor group, e.g. `L MAIN`, `SL REAC`, `AUX PWR` (B2.2.1). */
export interface ReactorGroupDef {
  id: string
  label: string
  /** Which damage-card primary hits target this group. */
  hitKind: ReactorHitKind
  points: PowerPointDef[]
}

export type ReactorHitKind =
  | 'left-main'
  | 'right-main'
  | 'center-main'
  | 'sublight-reactor'
  | 'aux'

/**
 * A line in the FUNCTIONS / POWER LEVEL column (B2.2).
 *
 * `freeValue` is the capability the line provides with no power spent — the
 * pre-filled solid green circles, which do not count against total power
 * (B2.2.3). `steps` are the purchasable circles, left to right.
 */
export interface FunctionLineDef {
  id: string
  label: string
  kind: FunctionKind
  /** Value delivered with zero power spent (free power). */
  freeValue: number
  /**
   * Each entry is one green circle. `powerCost` is normally 1, but heavy
   * weapons can need several power points per arming point (E4.2.11).
   * `value` is the cumulative capability once this circle is filled.
   */
  steps: Array<{ powerCost: number; value: number }>
  /**
   * `sequential` lines must be filled left to right (B2.2.2). Shield, GEN SYS
   * and EMER lines may be filled in any order.
   */
  sequential: boolean
  /** For `weapon` lines: the weapon system this line arms. */
  weaponSystemId?: string
  /** For `shield-repair` / `shield-reinforce` lines: which facing. */
  shieldSide?: ShieldSide
}

export type FunctionKind =
  | 'accel' // ACC/DEC (B2.2.4)
  | 'sif' // SIF (B2.2.5)
  | 'emergency-turn' // EMER (B2.2.6)
  | 'weapon' // one line per weapon system (B2.2.7)
  | 'shield-reinforce' // SHLD RNFC (G1.3.2)
  | 'shield-repair' // SHLD REPR (G1.3.3)
  | 'sensor' // SENSOR (B2.2.9, H2.2.1)
  | 'gen-sys' // GEN SYS NRM/MAX (B2.2.10, J1.1)
  | 'battery-recharge' // BAT RECH (B2.2.11)
  | 'ftl-drive' // FTL DRV (B2.2.12, J9.1.2)
  | 'special' // scout sensors, cloaks, etc.

// ---------------------------------------------------------------------------
// Ship form: weapons (B1.5, E3.2)
// ---------------------------------------------------------------------------

export type RangeBand = 'green' | 'black' | 'red'

/** One column of a weapon's firing chart (E3.2.1 item 3). */
export interface RangeBracketDef {
  /** Inclusive, in inches of *effective* range (E1.3.2). */
  min: number
  max: number
  /**
   * Green brackets let the attacker reroll; red brackets let the defender
   * reroll (E1.2).
   */
  band: RangeBand
  /** One entry per attack die rolled by a single mount. */
  dice: DieColor[]
  /** Bonus damage per die that scores a hit (E4.3). */
  bonus?: number
}

/** Damage produced by an `S` result on a red die (E7.2.5, F1.40). */
export interface SpecialHitDef {
  /** Standard damage points. */
  damage: number
  /** `LEAK +X` (F1.42). */
  leak?: number
  /** `STR +X` — applied only if shields *and* armor are down (F1.43). */
  structure?: number
}

export interface WeaponMountDef {
  id: string
  /** Arcs this mount may fire into (E2.2.2). */
  arcs: Arc[]
  /** Number of green arming circles (E4.2.2). */
  armingCircles: number
  /** Number of black damage boxes (E8.3.1). */
  hitBoxes: number
  /**
   * Slow-arming diamonds (E4.2.8). `roundGates[i] === true` means a diamond
   * sits between arming circle `i` and `i + 1`, so filling past it requires
   * waiting for the next Resource Allocation Segment.
   */
  roundGates?: boolean[]
  /** `AMMO X` (F1.2) — shots available for this mount, if limited. */
  ammo?: number
}

export interface WeaponSystemDef {
  id: string
  name: string
  /** phaser | disruptor | a-mat-torpedo | ... (E3.1.2) */
  weaponClass: string
  mounts: WeaponMountDef[]
  brackets: RangeBracketDef[]
  special?: SpecialHitDef
  /** Raw trait strings as printed, e.g. `PD MODE`, `PREC 1`, `NoBAT`. */
  traits: string[]
}

// ---------------------------------------------------------------------------
// Ship form: defenses and systems (B1.6, B1.7, B1.8, G1, G2)
// ---------------------------------------------------------------------------

export interface ShieldDef {
  /** Black SHIELD GEN boxes — repair/reinforce strength (G1.1.2). */
  generatorBoxes: number
  /** Blue boxes per facing (G1.1.3). */
  blue: Record<ShieldSide, number>
  /**
   * Green reinforcement boxes per facing (G1.1.4). Normally equal to
   * `generatorBoxes`, but stored per-side so unusual forms round-trip.
   */
  green: Record<ShieldSide, number>
}

/** General system groups shown in the SYSTEMS block (B1.7). */
export type SystemKind =
  | 'SENS' // sensors (H2)
  | 'SCNC' // sciences (J4)
  | 'TRAC' // tractor beams (J3)
  | 'TRAN' // transporters (J5)
  | 'SHTL' // shuttle bay (J8)
  | 'HNGR' // hangar bay
  | 'QTRS' // quarters (J2)
  | 'CRGO' // cargo (J11)
  | 'PROB' // probe launcher (J7)
  | 'SPCL' // special system (E8.4.7)

export interface SystemGroupDef {
  kind: SystemKind
  label: string
  boxes: number
}

/**
 * One entry on the Structural Integrity track (B1.8, B3.1.2). The track is an
 * ordered mix of boxes and Damage Control Rating markers; crossing a marker
 * permanently drops the ship's DC rating.
 */
export type StructureEntryDef =
  | { kind: 'box'; color: 'black' | 'red' }
  | { kind: 'dc'; rating: number }

/** Sublight Drive and Maneuvering block (B1.4.4, C1.2, E8.5.4). */
export interface SublightDef {
  /** Highest plottable speed (C1.2.7). Never above 8. */
  maxSpeed: number
  /**
   * Turn template in degrees for each speed, indexed by speed. `0` means the
   * ship may not turn at that speed (C2.2.2).
   */
  turnBySpeed: number[]
  /** Max acceleration in a single combat phase (C1.2.5). */
  maxAccelPerPhase: number
  /** Safe acceleration points per round — green circles (C1.2.6). */
  safeAccelPerRound: number
  /** Additional acceleration points per round that cause stress — red circles. */
  stressAccelPerRound: number
  /** Number of sublight drive damage boxes. */
  driveBoxes: number
  /**
   * New maximum speed after `k + 1` drive boxes are damaged (E8.5.4).
   * Length must equal `driveBoxes`; the final entry is normally 0, which
   * forces an involuntary Emergency Stop.
   */
  dmgTopSpeed: number[]
}

// ---------------------------------------------------------------------------
// Ship form (B1)
// ---------------------------------------------------------------------------

export type Availability = 'common' | 'uncommon' | 'rare' | 'unique'

export interface ShipForm {
  id: string
  /** Class name, e.g. "Yorktown-class Heavy Cruiser". */
  name: string
  faction: string
  /** B1.3.1 — drives explosion damage, tractor locks, crew count. */
  sizeClass: number
  /** B1.3.3 — damage cards drawn per stress check. */
  stressRating: number
  /** B1.3.4 — base damage control rating, before structure loss. */
  damageControlRating: number

  reactors: ReactorGroupDef[]
  /** Each battery stores one power point (B2.4). */
  batteries: number
  /** FTL DRV hit boxes in the Power Systems block (J9.1.1). */
  ftlDriveBoxes: number

  functions: FunctionLineDef[]
  weapons: WeaponSystemDef[]
  shields: ShieldDef
  armor: Record<ShieldSide, number>
  systems: SystemGroupDef[]
  structure: StructureEntryDef[]
  sublight: SublightDef

  marineSquads: number
  shuttles: number

  /** Victory point value (S2.8.3). */
  pointValue: number
  year?: number
  availability?: Availability

  /**
   * Set when the stats are our own reconstruction rather than canon, so the
   * UI can flag them. Remove when real Ship Book data is imported.
   */
  provisional?: boolean
  notes?: string
}

// ---------------------------------------------------------------------------
// Damage deck (A2.6, E8)
// ---------------------------------------------------------------------------

export type DamageCategory =
  | 'defense' // blue
  | 'weapon' // red
  | 'general' // yellow
  | 'engineering' // green
  | 'critical' // white
  | 'structure' // orange

/** The specific effect a damage card applies (E8.2 – E8.7). */
export type DamageHit =
  // Defense (blue)
  | 'shield-generator'
  | 'shield-power-loss'
  // Weapons (red)
  | 'any-weapon'
  | 'facing-weapon'
  | 'heavy-weapon'
  | 'weapon-power-loss'
  // General systems (yellow)
  | 'any-hit'
  | 'casualties'
  | 'sciences'
  | 'sensors'
  | 'sensor-power-loss'
  | 'shuttle-bay'
  | 'special-system'
  | 'tractor-beam'
  | 'transporter'
  | 'quarters'
  // Engineering (green)
  | 'aux-reactor'
  | 'battery'
  | 'sublight-drive'
  | 'sublight-reactor'
  | 'left-main-reactor'
  | 'right-main-reactor'
  | 'any-main-reactor'
  | 'ftl-drive'
  | 'sif'
  // Critical (white)
  | 'bridge-hit'
  | 'major-fire'
  | 'minor-fire'
  | 'main-engineering-hit'
  | 'battery-power-loss'
  | 'no-effect'
  // Structural (orange)
  | 'structure'
  | 'derelict'

export interface DamageCard {
  id: string
  category: DamageCategory
  primary: DamageHit
  /** `ALT HIT` — used when the primary system has nothing left (E7.3.7). */
  alt?: DamageHit
  /** Cards bearing the Stress Damage icon (C3.1.4). */
  stressIcon: boolean
}

// ---------------------------------------------------------------------------
// Orders (C1, H2.2.2)
// ---------------------------------------------------------------------------

export type Maneuver =
  | 'straight' // C2.1
  | 'easy' // C2.3
  | 'standard' // C2.2
  | 'snap' // C3.4
  | 'hard' // C3.2
  | 's-turn' // C3.3
  | 'slide' // C2.4
  | 'em-90' // C3.5
  | 'em-180' // C3.5

export type TurnDirection = 'left' | 'right'

/** One phase's worth of command card (C1). */
export interface CommandCard {
  maneuver: Maneuver
  direction: TurnDirection | null
  /** Acceleration points spent this phase; sign gives accelerate/decelerate. */
  accel: number
  /** Speed the ship will be moving at once the change takes effect (C1.2.4). */
  speed: number
  /** Half-inch slide instead of a full inch (C2.4.1). */
  halfSlide?: boolean
  /** Sensor point split (H2.2.2). */
  sensors: { targeting: number; jamming: number; tacticalScan: number }
  /** Shields the captain has ordered lowered (G1.1.5). */
  shieldsDown: ShieldSide[]
}

// ---------------------------------------------------------------------------
// Sequence of play (A3)
// ---------------------------------------------------------------------------

export type Phase = 'engineering' | 'combat-1' | 'combat-2' | 'combat-3' | 'final'

export type Segment =
  // Engineering Phase (A3.2)
  | 'resource-allocation'
  | 'damage-control'
  // Combat Phases (A3.3)
  | 'command'
  | 'operations'
  | 'navigation'
  | 'combat'
  | 'flight-operations'
  | 'delayed-action'
  // Final Phase (A3.4)
  | 'stress-check'
  | 'boarding-combat'
  | 'disengagement'
  | 'hangar-bay'
  | 'final-activity'

export interface SequencePosition {
  round: number
  phase: Phase
  segment: Segment
}
