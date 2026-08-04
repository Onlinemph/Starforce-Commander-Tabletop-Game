import type {
  Arc,
  FunctionLineDef,
  Placement,
  ScoutFunction,
  ShieldSide,
  ShipForm,
  SystemKind,
  WeaponSystemDef,
} from './types'

export const SHIELD_SIDES: readonly ShieldSide[] = ['F', 'S', 'A', 'P']

// ---------------------------------------------------------------------------
// Mutable per-ship state
// ---------------------------------------------------------------------------

/** One scout sensor's orders for the round (H3.2.2, H3.3.2). */
export interface ScoutSensorState {
  function: ScoutFunction
  /** Enemy ship illuminated, for targeting sensors only (H3.4.1). */
  targetId: string | null
  /** Switched on or off during Operations step 2.E (H3.3.2). */
  active: boolean
}

export interface MountState {
  /** Green arming circles filled (E4.2.2). */
  armed: number
  /** Circles filled during the current Resource Allocation, for slow-arm gates. */
  armedThisRound: number
  /** Black damage boxes marked (E8.3.1). */
  damage: number
  /** Ammunition triangles expended (F1.2.2). */
  ammoUsed: number
}

export interface ShipState {
  id: string
  /** Owning player. */
  side: string
  /** Vessel name, e.g. "U.S.S. Yorktown". */
  name: string
  form: ShipForm

  placement: Placement
  /** Current speed in inches per combat phase. Negative is reverse (C3.7). */
  speed: number

  // ── Engineering ────────────────────────────────────────────────────────
  /** Hits on each power point, keyed by reactor group id. */
  reactorDamage: Record<string, number[]>
  /**
   * Arming the general crew to repel boarders (J6.3, optional). Holds the
   * round through which the ship stays in that state — twenty rounds past the
   * fight, per J6.3.2 — and zero when the crew is at its stations.
   */
  crewArmedUntil: number
  /**
   * The force's flagship (S3.6). Damage scored against it is worth double to
   * the enemy, and its side gets free tactical scan points to hand out.
   */
  flagship: boolean
  /**
   * A reinforcement's arrival round (S3.2). Until then the hull is off the map
   * entirely: not drawn, not targetable, not counted as active.
   */
  arrivesRound: number
  batteryDamaged: boolean[]
  batteryCharged: boolean[]
  ftlDriveDamage: number
  /** Power circles filled per FUNCTIONS line this round (B2.2). */
  allocation: Record<string, number>

  // ── Weapons ────────────────────────────────────────────────────────────
  mounts: Record<string, MountState[]>

  // ── Defenses ───────────────────────────────────────────────────────────
  shieldGeneratorDamage: number
  blueShieldDamage: Record<ShieldSide, number>
  /** Green boxes currently powered this round (G1.3.2). */
  greenShieldActive: Record<ShieldSide, number>
  greenShieldDamage: Record<ShieldSide, number>
  shieldsDown: Record<ShieldSide, boolean>
  armorDamage: Record<ShieldSide, number>

  // ── Systems ────────────────────────────────────────────────────────────
  systemDamage: Record<string, number>
  genSysLevel: 'off' | 'nrm' | 'max'
  /** Sensor points split during the Command Segment (H2.2.2). */
  sensors: { targeting: number; jamming: number; tacticalScan: number }
  /** Scout sensor damage boxes marked (H3.1.1). */
  scoutSensorDamage: number
  /**
   * One entry per scout sensor, set during Resource Allocation and fixed for
   * the round (H3.2.2). Sensors beyond the number the SCOUT SEN line powers
   * are simply unpowered and contribute nothing.
   */
  scoutAssignments: ScoutSensorState[]

  // ── Structure ──────────────────────────────────────────────────────────
  /** Damaged flags, one per box entry on the Structural Integrity track. */
  structureDamaged: boolean[]
  /** Highest total structure hits ever taken — DC rating never recovers (B3.1.2). */
  structureHitsTaken: number
  /** Structure damage after every box is marked (E11.2.2). */
  excessStructureDamage: number

  // ── Round state ────────────────────────────────────────────────────────
  stressMarkers: number
  /** Acceleration points spent this round, for the /ROUND track (C1.2.6). */
  accelUsedThisRound: number
  /**
   * Acceleration points currently spent weaving (C3.6.3): the number of
   * attack dice this ship may reroll from each incoming volley — and the
   * number its own targets may reroll right back at it.
   */
  evasive: number
  /** Emergency turns are once per round (C3.5.4). */
  emergencyTurnUsed: boolean
  /** Phases remaining at speed zero from an Emergency Stop (C3.8.2). */
  emergencyStopPhases: number

  marineSquads: number
  /**
   * Crew units still aboard: two per size class (E11.5.4), and what abandoning
   * ship is trying to save. Marines are counted within them (E11.4.2).
   */
  crewUnits: number
  /** Enemy marine squads currently aboard, keyed by their owner. */
  boarders: Record<string, number>
  shuttlesAboard: number

  derelict: boolean
  destroyed: boolean
  disengaged: boolean
  capturedBy: string | null
  /** Round the ship was captured, which gates its FTL drive (J6.2.5). */
  capturedRound: number | null
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function zeroSides(): Record<ShieldSide, number> {
  return { F: 0, S: 0, A: 0, P: 0 }
}

export function createShip(args: {
  id: string
  side: string
  name: string
  form: ShipForm
  placement: Placement
  speed: number
  flagship?: boolean
  arrivesRound?: number
}): ShipState {
  const { form } = args

  const reactorDamage: Record<string, number[]> = {}
  for (const group of form.reactors) {
    reactorDamage[group.id] = group.points.map(() => 0)
  }

  const mounts: Record<string, MountState[]> = {}
  for (const weapon of form.weapons) {
    mounts[weapon.id] = weapon.mounts.map(() => ({
      armed: 0,
      armedThisRound: 0,
      damage: 0,
      ammoUsed: 0,
    }))
  }

  const systemDamage: Record<string, number> = {}
  for (const group of form.systems) systemDamage[group.kind] = 0

  return {
    id: args.id,
    side: args.side,
    name: args.name,
    form,
    placement: args.placement,
    speed: args.speed,
    reactorDamage,
    // Batteries begin a scenario fully charged (B2.4.1).
    crewArmedUntil: 0,
    flagship: args.flagship ?? false,
    arrivesRound: args.arrivesRound ?? 1,
    batteryDamaged: new Array(form.batteries).fill(false),
    batteryCharged: new Array(form.batteries).fill(true),
    ftlDriveDamage: 0,
    allocation: {},
    mounts,
    shieldGeneratorDamage: 0,
    blueShieldDamage: zeroSides(),
    greenShieldActive: zeroSides(),
    greenShieldDamage: zeroSides(),
    shieldsDown: { F: false, S: false, A: false, P: false },
    armorDamage: zeroSides(),
    systemDamage,
    genSysLevel: 'off',
    sensors: { targeting: 0, jamming: 0, tacticalScan: 0 },
    scoutSensorDamage: 0,
    scoutAssignments: newScoutAssignments(form),
    structureDamaged: form.structure.filter((e) => e.kind === 'box').map(() => false),
    structureHitsTaken: 0,
    excessStructureDamage: 0,
    stressMarkers: 0,
    accelUsedThisRound: 0,
    evasive: 0,
    emergencyTurnUsed: false,
    emergencyStopPhases: 0,
    marineSquads: form.marineSquads,
    crewUnits: form.sizeClass * 2,
    boarders: {},
    shuttlesAboard: form.shuttles,
    derelict: false,
    destroyed: false,
    disengaged: false,
    capturedBy: null,
    capturedRound: null,
  }
}

// ---------------------------------------------------------------------------
// Power (B2.2)
// ---------------------------------------------------------------------------

/** Power points produced by undamaged reactors (B2.2.1). */
export function reactorPower(ship: ShipState): number {
  let total = 0
  for (const group of ship.form.reactors) {
    const damage = ship.reactorDamage[group.id] ?? []
    group.points.forEach((point, i) => {
      if ((damage[i] ?? 0) < point.boxes) total += 1
    })
  }
  return total
}

/** Charged, undamaged batteries (B2.4). */
export function batteryPower(ship: ShipState): number {
  return ship.batteryCharged.filter((c, i) => c && !ship.batteryDamaged[i]).length
}

/** Power spent so far this Resource Allocation Segment. */
export function powerSpent(ship: ShipState): number {
  let spent = 0
  for (const line of ship.form.functions) {
    const filled = ship.allocation[line.id] ?? 0
    for (let i = 0; i < filled; i++) spent += line.steps[i]?.powerCost ?? 1
  }
  return spent
}

/**
 * Capability a FUNCTIONS line currently delivers: free power plus the value of
 * the rightmost filled circle (B2.2.3, B2.2.4).
 */
export function lineValue(ship: ShipState, lineId: string): number {
  const line = ship.form.functions.find((l) => l.id === lineId)
  if (!line) return 0
  const filled = ship.allocation[lineId] ?? 0
  if (filled === 0) return line.freeValue
  if (line.sequential) return line.steps[filled - 1]?.value ?? line.freeValue
  // Non-sequential lines (shields, GEN SYS, EMER) accumulate per circle.
  return line.freeValue + filled
}

/**
 * GEN SYS setting implied by the current allocation (J1.1).
 *
 * Free power normally covers NRM; purchased circles reach MAX. Derived rather
 * than read from `genSysLevel` so that systems which need MAX can be planned
 * *during* the Resource Allocation Segment — command systems are assigned then
 * (H5.2.1), before `commitAllocation` writes the committed value.
 */
export function genSysSetting(ship: ShipState): 'off' | 'nrm' | 'max' {
  const line = findLine(ship.form, 'gen-sys')
  if (!line) return 'off'
  const value = lineValue(ship, line.id)
  return value >= 2 ? 'max' : value >= 1 ? 'nrm' : 'off'
}

export function findLine(form: ShipForm, kind: string, match?: Partial<FunctionLineDef>) {
  return form.functions.find(
    (l) =>
      l.kind === kind &&
      (!match?.shieldSide || l.shieldSide === match.shieldSide) &&
      (!match?.weaponSystemId || l.weaponSystemId === match.weaponSystemId),
  )
}

// ---------------------------------------------------------------------------
// Damage control (B3.1.2)
// ---------------------------------------------------------------------------

/**
 * Current Damage Control Rating (B3.1.2).
 *
 * The Structural Integrity track interleaves boxes with rating markers. "When
 * the ship suffers a structure hit resulting in a box to the right of a number,
 * reduce the ship's Damage Control Rating to the following number to the
 * right." So a marker only bites once a box *beyond* it is damaged, and the new
 * rating is the marker after the one passed.
 *
 * Worked example from B3.1.2 — a Yorktown whose track is `□□□■ 4 □□□ 3 …` with
 * a DC icon of 4: four hits leave it at 4, the fifth drops it to 3, and eight
 * hits drop it to 2. Reductions are permanent even if a box is repaired
 * (B3.3.3), which is why this reads `structureHitsTaken` rather than current
 * damage.
 */
/**
 * Whether the general crew is under arms rather than at their stations (J6.3).
 * The state expires on its own at the start of a round, so every caller can
 * ask this without also knowing what round it is.
 */
export function crewIsArmed(ship: ShipState): boolean {
  return ship.crewArmedUntil > 0
}

export function damageControlRating(ship: ShipState): number {
  const markers: number[] = []
  let passed = 0
  let boxesSeen = 0
  for (const entry of ship.form.structure) {
    if (entry.kind === 'box') {
      boxesSeen += 1
    } else {
      markers.push(entry.rating)
      if (boxesSeen < ship.structureHitsTaken) passed += 1
    }
  }
  if (markers.length === 0) return ship.form.damageControlRating
  return markers[Math.min(passed, markers.length - 1)]
}

// ---------------------------------------------------------------------------
// Sublight drive (C1.2.7, E8.5.4)
// ---------------------------------------------------------------------------

export function sublightDriveDamage(ship: ShipState): number {
  return ship.systemDamage['__sublight'] ?? 0
}

/** Maximum speed after sublight drive damage (E8.5.4). */
export function currentMaxSpeed(ship: ShipState): number {
  const hits = sublightDriveDamage(ship)
  if (hits === 0) return ship.form.sublight.maxSpeed
  const table = ship.form.sublight.dmgTopSpeed
  return table[Math.min(hits, table.length) - 1] ?? 0
}

/** Reverse is capped at half maximum speed, rounded down (C3.7.3). */
export function maxReverseSpeed(ship: ShipState): number {
  return Math.floor(currentMaxSpeed(ship) / 2)
}

/** Turn template for the ship's current speed, from the TURN line (C2.2.2). */
export function turnTemplateAt(ship: ShipState, speed: number): number {
  const index = Math.abs(speed)
  return ship.form.sublight.turnBySpeed[index] ?? 0
}

// ---------------------------------------------------------------------------
// Sensors (H2.2.3)
// ---------------------------------------------------------------------------

export function sensorBoxesRemaining(ship: ShipState): number {
  const group = ship.form.systems.find((g) => g.kind === 'SENS')
  if (!group) return 0
  return Math.max(0, group.boxes - (ship.systemDamage['SENS'] ?? 0))
}

/** Total sensor points generated by the SENSOR line (H2.2.1). */
export function sensorPointsAvailable(ship: ShipState): number {
  const line = findLine(ship.form, 'sensor')
  return line ? lineValue(ship, line.id) : 0
}

/**
 * Maximum points assignable to any *single* sensor function — capped by
 * undamaged sensor boxes (H2.2.3).
 */
export function sensorFunctionCap(ship: ShipState): number {
  return sensorBoxesRemaining(ship)
}

// ---------------------------------------------------------------------------
// Scouting sensors (H3)
// ---------------------------------------------------------------------------

/** Fresh orders for a form's scout sensors: idle, pointed nowhere, switched on. */
export function newScoutAssignments(form: ShipForm): ScoutSensorState[] {
  const count = form.scoutSensor?.sensors ?? 0
  return Array.from({ length: count }, () => ({
    function: 'targeting' as ScoutFunction,
    targetId: null,
    active: true,
  }))
}

export function isScout(ship: ShipState): boolean {
  return (ship.form.scoutSensor?.sensors ?? 0) > 0
}

/** Scout sensors still undamaged (H3.1.1). */
export function scoutSensorsIntact(ship: ShipState): number {
  const block = ship.form.scoutSensor
  if (!block) return 0
  return Math.max(0, block.sensors - ship.scoutSensorDamage)
}

/**
 * Scout sensors the SCOUT SEN line is currently powering (H3.2.1).
 *
 * The numbers beside that line's circles are sensor counts rather than a
 * capability value: one power point might activate two sensors. Damage caps the
 * total, and scout sensors never store power from round to round (H3.2.2).
 */
export function scoutSensorsPowered(ship: ShipState): number {
  const block = ship.form.scoutSensor
  if (!block) return 0
  const scoutLine = ship.form.functions.find((l) => l.label.startsWith('SCOUT SEN'))
  const powered = scoutLine ? lineValue(ship, scoutLine.id) : 0
  return Math.min(powered, scoutSensorsIntact(ship))
}

/**
 * Scout sensors that are powered, undamaged and switched on, grouped by the
 * function they were assigned during Resource Allocation (H3.2.2, H3.3.2).
 */
export function activeScoutSensors(ship: ShipState): ScoutSensorState[] {
  if (ship.destroyed || ship.derelict || ship.disengaged) return []
  return ship.scoutAssignments.slice(0, scoutSensorsPowered(ship)).filter((s) => s.active)
}

/** True once the scout is using any of its scout sensors (H3.4.4, H3.5.3). */
export function usingScoutSensors(ship: ShipState): boolean {
  return activeScoutSensors(ship).length > 0
}

export function undamagedSystemBoxes(ship: ShipState, kind: SystemKind): number {
  const group = ship.form.systems.find((g) => g.kind === kind)
  if (!group) return 0
  return Math.max(0, group.boxes - (ship.systemDamage[kind] ?? 0))
}

// ---------------------------------------------------------------------------
// Shields (G1)
// ---------------------------------------------------------------------------

export function shieldGeneratorRating(ship: ShipState): number {
  return Math.max(0, ship.form.shields.generatorBoxes - ship.shieldGeneratorDamage)
}

export function blueShieldRemaining(ship: ShipState, side: ShieldSide): number {
  return Math.max(0, ship.form.shields.blue[side] - ship.blueShieldDamage[side])
}

export function greenShieldRemaining(ship: ShipState, side: ShieldSide): number {
  return Math.max(0, ship.greenShieldActive[side] - ship.greenShieldDamage[side])
}

export function armorRemaining(ship: ShipState, side: ShieldSide): number {
  return Math.max(0, ship.form.armor[side] - ship.armorDamage[side])
}

// ---------------------------------------------------------------------------
// Weapons (E3, E4)
// ---------------------------------------------------------------------------

export function weaponById(form: ShipForm, id: string): WeaponSystemDef | undefined {
  return form.weapons.find((w) => w.id === id)
}

export function mountIsDamaged(def: WeaponSystemDef, index: number, state: MountState): boolean {
  return state.damage >= def.mounts[index].hitBoxes
}

export function mountIsDegraded(def: WeaponSystemDef, index: number, state: MountState): boolean {
  return state.damage > 0 && state.damage < def.mounts[index].hitBoxes
}

/** A mount fires when every arming circle is filled (E4.2.3). */
export function mountIsReady(def: WeaponSystemDef, index: number, state: MountState): boolean {
  if (mountIsDamaged(def, index, state)) return false
  const mount = def.mounts[index]
  if (mount.ammo !== undefined && state.ammoUsed >= mount.ammo) return false
  return state.armed >= mount.armingCircles
}

/**
 * How many further arming circles this mount may take during the current
 * Resource Allocation Segment.
 *
 * Circles fill left to right (E4.2.4). A slow-arming diamond between two
 * circles means the right-hand circle may only be filled in a *later* Resource
 * Allocation Segment, so a single round's run of circles may never cross a
 * diamond (E4.2.8).
 */
export function armingCapacityThisRound(def: WeaponSystemDef, index: number, state: MountState): number {
  const mount = def.mounts[index]
  const gates = mount.roundGates ?? []
  let allowed = 0
  let filledThisRound = state.armedThisRound
  for (let circle = state.armed; circle < mount.armingCircles; circle++) {
    // gates[c] sits between circle c and circle c + 1.
    if (circle > 0 && gates[circle - 1] && filledThisRound > 0) break
    allowed += 1
    filledThisRound += 1
  }
  return allowed
}

/** Weapons the ship can actually fire right now, with their bearing arcs. */
export function readyMounts(ship: ShipState): Array<{
  weapon: WeaponSystemDef
  index: number
  state: MountState
  arcs: Arc[]
}> {
  const out: Array<{ weapon: WeaponSystemDef; index: number; state: MountState; arcs: Arc[] }> = []
  for (const weapon of ship.form.weapons) {
    const states = ship.mounts[weapon.id] ?? []
    states.forEach((state, index) => {
      if (mountIsReady(weapon, index, state)) {
        out.push({ weapon, index, state, arcs: weapon.mounts[index].arcs })
      }
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Structure (B1.8, E11)
// ---------------------------------------------------------------------------

export function structureBoxes(ship: ShipState): Array<{ color: 'black' | 'red'; damaged: boolean }> {
  const boxes = ship.form.structure.filter((e) => e.kind === 'box') as Array<{
    kind: 'box'
    color: 'black' | 'red'
  }>
  return boxes.map((b, i) => ({ color: b.color, damaged: ship.structureDamaged[i] }))
}

export function structureRemaining(ship: ShipState): number {
  return ship.structureDamaged.filter((d) => !d).length
}

export function structureTotal(ship: ShipState): number {
  return ship.structureDamaged.length
}

/**
 * Mark one structure box. Black boxes are marked first because damage control
 * can repair them (B1.8, E8.7.1). Returns false when every box is already
 * damaged, which makes the hit excess structure damage (E11.2.2).
 */
export function markStructure(ship: ShipState): boolean {
  const boxes = ship.form.structure.filter((e) => e.kind === 'box') as Array<{
    kind: 'box'
    color: 'black' | 'red'
  }>
  let index = boxes.findIndex((b, i) => b.color === 'black' && !ship.structureDamaged[i])
  if (index === -1) index = ship.structureDamaged.findIndex((d) => !d)
  if (index === -1) return false
  ship.structureDamaged[index] = true
  ship.structureHitsTaken += 1
  return true
}

/** Damage level for victory points (S2.8.4). */
export type DamageLevel = 'none' | 'minor' | 'light' | 'moderate' | 'heavy' | 'crippled' | 'destroyed'

export function damageLevel(ship: ShipState): DamageLevel {
  const total = structureTotal(ship)
  if (total === 0) return 'none'
  const damaged = total - structureRemaining(ship)
  if (ship.destroyed || damaged >= total) return 'destroyed'
  const pct = damaged / total
  if (pct === 0) return 'none'
  if (pct >= 0.9) return 'crippled'
  if (pct >= 0.75) return 'heavy'
  if (pct >= 0.5) return 'moderate'
  if (pct >= 0.25) return 'light'
  return 'minor'
}

/** Fraction of point value earned by an opponent (S2.8.4). */
export const VICTORY_FRACTION: Record<DamageLevel, number> = {
  none: 0,
  minor: 0.1,
  light: 0.25,
  moderate: 0.5,
  heavy: 0.75,
  crippled: 0.9,
  destroyed: 1,
}

// ---------------------------------------------------------------------------
// Round bookkeeping
// ---------------------------------------------------------------------------

/**
 * Clear per-round state at the start of a new Engineering Phase.
 * Shield reinforcement and its damage expire at end of round (G1.3.2).
 */
export function beginRound(ship: ShipState): void {
  ship.allocation = {}
  // Scout sensors do not store power between rounds, and their function is
  // re-assigned during each Resource Allocation Segment (H3.2.2, H3.3.3).
  for (const sensor of ship.scoutAssignments) sensor.active = true
  ship.genSysLevel = 'off'
  ship.accelUsedThisRound = 0
  ship.evasive = 0
  ship.emergencyTurnUsed = false
  ship.stressMarkers = 0
  for (const side of SHIELD_SIDES) {
    ship.greenShieldActive[side] = 0
    ship.greenShieldDamage[side] = 0
  }
  for (const states of Object.values(ship.mounts)) {
    for (const state of states) state.armedThisRound = 0
  }
}
