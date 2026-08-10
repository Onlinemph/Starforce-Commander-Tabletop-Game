import { hasTrait, traitValue } from './combat'
import { ARC_ORDER } from './geometry'
import type {
  DieColor,
  FunctionLineDef,
  ScoutSensorDef,
  ShieldSide,
  ShipForm,
  SystemKind,
  WeaponSystemDef,
} from './types'

/**
 * Ship design and point valuation.
 *
 * Mariner Games' own design spreadsheet (`SHIP FORM MASTER … V38`) prices a
 * ship by valuing eight components, weighting each, and dividing by ten. This
 * module reimplements that model so custom ships can be costed on the same
 * scale as the printed ones — and so a design can be checked against the rules
 * before it ever reaches the map.
 *
 * The model's shape, in the sheet's own terms:
 *
 *     point value = (generalSystems + sensors + defence + powerSystem
 *                    + speedAccel + sif + maneuver + offense) / 10 × modifier
 *
 * Almost every component is scaled by the ship's firepower, which is why the
 * weapons are valued first and everything else is priced relative to them.
 */

// ---------------------------------------------------------------------------
// Constants, transcribed from the design sheet
// ---------------------------------------------------------------------------

/** Component weights (the sheet's "GLOBAL MODIFIERS" row). */
export const COMPONENT_WEIGHTS = {
  generalSystems: 1,
  sensors: 0.5,
  shields: 1,
  armor: 1,
  systemHits: 0.5,
  structure: 1,
  defence: 1,
  powerSystem: 0.75,
  speedAccel: 0.75,
  sif: 0.75,
  maneuver: 0.75,
  offense: 0.75,
} as const

/**
 * The sheet divides most component values by the actual power of a reference
 * hull. Everything is priced relative to that ship.
 */
export const REFERENCE_POWER = 118.39

/**
 * The sheet's per-size-class power multiplier (`K5`). Actual power delivered by
 * one power box is twice this (`O8 = K5 × 2`).
 */
export const POWER_MULTIPLIER: Record<number, number> = {
  1: 2.04,
  2: 2.56,
  3: 3.2,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
}

/** Average damage per die, before bonus damage. */
const DIE_AVERAGE: Record<Exclude<DieColor, 'red'>, number> = {
  blue: 1.5,
  green: 2.33,
  yellow: 3,
}

/** Bonus damage counts for less on a blue die than on the others. */
const BONUS_WEIGHT: Record<DieColor, number> = {
  blue: 0.666,
  green: 0.833,
  yellow: 0.833,
  red: 0.833,
}

/** How much each range bracket's damage is worth, near to far. */
const BRACKET_RANGE_WEIGHT = [1.24, 1.24, 1, 1, 0.797, 0.797]
const BRACKET_VALUE_WEIGHT = [0.085, 0.075, 0.065, 0.055, 0.05, 0.05]

/** A wider field of fire is worth more, by number of arcs covered. */
const ARC_MODIFIER = [0, 0.5, 0.66, 0.9, 1, 1.125, 1.25, 1.375, 1.5]

/** A weapon that takes longer to arm is worth less per shot. */
const ARMING_TIME_MULTIPLIER: Record<number, number> = {
  1: 1,
  2: 0.75,
  3: 0.44,
  4: 0.3125,
}

/**
 * Weapon trait modifiers, as printed in the sheet's lookup table (V41 — the
 * designer's 2026-04 revision; its internal stamp reads "Version 39.6").
 * Positive values make a weapon dearer, negative ones cheaper.
 *
 * The V41 repricing moved four families: homing guidance fell to a fraction
 * of its old cost (0.08→0.01 at the bottom step, 0.3→0.08 at the top),
 * missiles got much deeper discounts (−0.25→−0.8 at MISSILE-1), particle
 * weapons got cheaper, and point defence swapped its weighting (AREA 2→1,
 * INTCP 5→7) while gaining a PD COOP trait. The old spellings of the armour
 * and precision traits are kept as aliases so data written under either
 * revision prices identically.
 */
export const TRAIT_MODIFIERS: Record<string, number> = {
  'AMMO 3': -0.18,
  'AMMO 4': -0.16,
  'AMMO 6': -0.14,
  'AMMO 8': -0.06,
  'AMMO 12': -0.03,
  'AMMO 16': -0.02,
  'AREA EFC': 0.5,
  'ARMOR (+1)': 0.1,
  'ARMOR (+2)': 0.2,
  ARRAY: 0.5,
  ATMO: 0.05,
  CAPACTR: 0.05,
  ENVLPNG: 0.05,
  FTL: 0.1,
  'HOMING 1': 0.01,
  'HOMING 2': 0.03,
  'HOMING 3': 0.05,
  'HOMING 4': 0.08,
  'LIGHT 2+1': 0.33,
  'MED 3+1': 0.11,
  'MISSILE-1': -0.8,
  'MISSILE-2': -0.65,
  'MISSILE-3': -0.4,
  'MISSILE-4': -0.33,
  NoBAT: -0.1,
  NoSTRCT: -0.2,
  PARTCL: -0.2,
  'PD AREA': 1,
  'PD COOP': 2,
  'PD INTCP': 7,
  PDMODE: 0.05,
  PDWPN: -0.2,
  'PREC 0': 0,
  'PREC 1': 0,
  'PREC 2': 0,
  'PRCS ENG': 0.15,
  'PRCS SHLD': 0.05,
  'PRCS WPN': 0.15,
  'PROX MD': 0.05,
  SPLASH: 0.1,
  // V38 spellings of the same traits, kept so older data still prices.
  'ARMR (+1)': 0.1,
  'ARMR (+2)': 0.2,
  'PREC EN': 0.15,
  'PREC SH': 0.05,
  'PREC WP': 0.15,
}

/**
 * General system boxes are not all worth the same. Quarters, cargo and special
 * systems are free — they buy nothing in a fight — while a hangar or shuttle
 * bay costs a point a box.
 *
 * `CMND`, `CLOAK` and the scout sensor block are priced off the ship's own
 * sensor value rather than a flat rate, so they are handled separately. The
 * sheet has no row for `PROB`; a probe launcher is priced like a shuttle bay.
 *
 * Sciences are deliberately free here: they are already paid for through the
 * precision bonus they give the ship's weapons (E9.1.3).
 */
const SYSTEM_MODIFIER: Partial<Record<SystemKind, number>> = {
  SCNC: 0,
  TRAC: 1,
  TRAN: 1,
  SHTL: 1,
  HNGR: 1,
  QTRS: 0,
  CRGO: 0,
  SPCL: 0,
  PROB: 1,
}

/** The sheet's free-power cost of one arming point (`X58`). */
const ARMING_POINT_POWER = 1.6

/** The sheet's reference hit-point total; most ratios are taken against it. */
const REFERENCE_HIT_POINTS = 30

/**
 * A scout sensor's cost, from the sheet's own scout block: the ranges it works
 * at — targeting 18, jamming 6 at triple weight, scanning 18 — halved.
 */
export const SCOUT_SENSOR_COST = (18 * 1 + 6 * 3 + 18 * 1) / 2

/** Marines are priced by the squad. */
const MARINE_MODIFIER = 0.25

// ---------------------------------------------------------------------------
// Trait lookup
// ---------------------------------------------------------------------------

/**
 * The sheet's trait names and the ship forms' printed names differ in spelling
 * — `PD MODE` against `PDMODE`, `ENVLP` against `ENVLPNG` — so match on a
 * squashed form and fall back to a prefix match for the numbered traits.
 */
export function traitModifier(raw: string): number {
  const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9+]/g, '')
  /*
   * The designers' cost table writes the missile trait `MISSILE-N`; the rules
   * and the engine both write `MISL N` (F1.13, and `missileHitPoints`). They
   * are the same trait, and without this every missile weapon prices at zero —
   * a seam nothing had touched, because no printed hull carries one.
   */
  const target = squash(raw).replace(/^MISL(\d+)$/, 'MISSILE$1')
  for (const [name, value] of Object.entries(TRAIT_MODIFIERS)) {
    if (squash(name) === target) return value
  }
  // `AMMO 5` and the like fall to the nearest printed step.
  const numeric = raw.match(/^([A-Z ]+?)\s*(\d+)$/i)
  if (numeric) {
    const prefix = squash(numeric[1])
    const wanted = Number(numeric[2])
    const steps = Object.entries(TRAIT_MODIFIERS)
      .filter(([name]) => squash(name).startsWith(prefix) && /\d/.test(name))
      .map(([name, value]) => ({ n: Number(name.match(/\d+/)![0]), value }))
      .sort((a, b) => a.n - b.n)
    const match = steps.find((s) => s.n >= wanted) ?? steps[steps.length - 1]
    if (match) return match.value
  }
  return 0
}

// ---------------------------------------------------------------------------
// Weapon valuation
// ---------------------------------------------------------------------------

/** Average damage of a red die, which depends on the weapon's special hit. */
export function redDieAverage(weapon: WeaponSystemDef): number {
  const special = weapon.special
  // The sheet reads the SPCL line as damage + leak, with structure worth half
  // as much again, and averages it across the die's three Special faces.
  const specialDamage =
    (special?.damage ?? 0) + (special?.leak ?? 0) + (special?.structure ?? 0) * 1.5
  return (3 + 5 + specialDamage * 3) / 6
}

/** Expected damage of one bracket's dice, including bonus damage (E4.3). */
export function bracketDamage(weapon: WeaponSystemDef, bracketIndex: number): number {
  const bracket = weapon.brackets[bracketIndex]
  if (!bracket) return 0
  const bonus = bracket.bonus ?? 0
  let total = 0.001
  for (const die of bracket.dice) {
    const average = die === 'red' ? redDieAverage(weapon) : DIE_AVERAGE[die]
    total += average + bonus * BONUS_WEIGHT[die]
  }
  return total
}

/**
 * Weapons that can pick their target's systems apart are worth more, scaled by
 * the precision rating and the ship's sciences.
 */
function precisionBonus(weapon: WeaponSystemDef, scienceBoxes: number): number {
  const rating = traitValue(weapon, 'PREC')
  if (rating === null) return 0
  return (rating + scienceBoxes) * 0.25
}

/** How many arming circles a mount needs, which sets its arming time. */
function armingTime(weapon: WeaponSystemDef): number {
  const circles = Math.max(...weapon.mounts.map((m) => m.armingCircles), 1)
  // Slow-arming diamonds stretch a mount over more Resource Allocation
  // Segments than it has circles (E4.2.8).
  const gates = Math.max(
    ...weapon.mounts.map((m) => (m.roundGates ?? []).filter(Boolean).length),
    0,
  )
  return Math.min(4, Math.max(1, Math.min(circles, gates + 1)))
}

export interface WeaponValue {
  name: string
  /** Weighted damage across the firing chart. */
  basicDamage: number
  /** Reach, worth the square root of the outermost range. */
  rangeModifier: number
  armingMultiplier: number
  traitModifier: number
  /**
   * Power freed up by one free arming point on this weapon's FUNCTIONS line.
   * The sheet counts free arming as power the ship never has to spend, so it
   * lands in ACTUAL FREE POWER alongside free acceleration and free SIF.
   */
  powerPerArmingPoint: number
  /** The weapon's contribution to the ship's offense. */
  value: number
}

/**
 * Value one weapon system (the sheet's per-weapon block).
 *
 * Damage is summed across the six brackets, each weighted by how useful that
 * range is and how wide the bracket is; the total is scaled by the weapon's
 * reach, its arming time, and the arcs and traits of each mount.
 */
export function valueWeapon(
  weapon: WeaponSystemDef,
  /**
   * `sensorReach` is the sheet's "1 PWR SENSOR" cell: V41 reads it as half
   * the ship's best sensor line value (it was the one-power value in V38).
   */
  opts: { scienceBoxes: number; sensorReach: number },
): WeaponValue {
  const precision = precisionBonus(weapon, opts.scienceBoxes)

  let basicDamage = 0
  for (let i = 0; i < 6; i++) {
    const bracket = weapon.brackets[i]
    if (!bracket) continue
    const width = bracket.max - bracket.min + 1
    // The precision bonus applies to the first three brackets only — a
    // precision shot needs to be close (E9.1.3).
    const damage = bracketDamage(weapon, i) * BRACKET_RANGE_WEIGHT[i] + (i < 3 ? precision : 0)
    basicDamage += damage * width * BRACKET_VALUE_WEIGHT[i]
  }

  const maxRange = weapon.brackets.reduce((m, b) => Math.max(m, b.max), 0)
  const reach = Math.max(1, maxRange + opts.sensorReach)
  const rangeModifier = reach / (Math.sqrt(reach) * 4)

  const armingMultiplier = ARMING_TIME_MULTIPLIER[armingTime(weapon)] ?? 1
  const traits = weapon.traits.reduce((sum, t) => sum + traitModifier(t), 0)

  const perMount = basicDamage * rangeModifier * armingMultiplier
  let value = 0
  for (const mount of weapon.mounts) {
    const arcs = ARC_MODIFIER[Math.min(8, mount.arcs.length)] ?? 1
    value += perMount * (arcs + traits)
  }

  const circles = Math.max(1, ...weapon.mounts.map((m) => m.armingCircles))
  const powerPerArmingPoint = (basicDamage * rangeModifier * ARMING_POINT_POWER) / circles

  return {
    name: weapon.name,
    basicDamage,
    rangeModifier,
    armingMultiplier,
    traitModifier: traits,
    powerPerArmingPoint,
    value,
  }
}

// ---------------------------------------------------------------------------
// Ship valuation
// ---------------------------------------------------------------------------

export interface PointBreakdown {
  generalSystems: number
  sensors: number
  defence: number
  powerSystem: number
  speedAccel: number
  sif: number
  maneuver: number
  offense: number
  /** Sum of the eight components, before the divide by ten. */
  subtotal: number
  /** The printed point value. */
  points: number
  /** Total offense, which most other components are scaled against. */
  totalOffense: number
  /** Actual power, free power included — the sheet's `O4`. */
  actualPower: number
  /** Every damage box on the form — the sheet's `J8`. */
  systemBoxes: number
  weapons: WeaponValue[]
}

function systemBoxes(form: ShipForm, kind: SystemKind): number {
  return form.systems.filter((g) => g.kind === kind).reduce((n, g) => n + g.boxes, 0)
}

function lineValueAt(form: ShipForm, kind: string, circles: number): number {
  const line = form.functions.find((l) => l.kind === kind)
  if (!line) return 0
  if (circles === 0) return line.freeValue
  return line.steps[Math.min(circles, line.steps.length) - 1]?.value ?? line.freeValue
}

/**
 * Every damage box printed on the form (`J8`): general systems, sensors, shield
 * generators, reactors and batteries, the FTL drive, the maneuvering block and
 * every weapon mount. The sheet treats all of them as one pool, so a ship that
 * soaks damage in its engineering section is worth as much as one that soaks it
 * in its science labs.
 */
function totalSystemBoxes(form: ShipForm): number {
  const general = form.systems.reduce((n, g) => n + g.boxes, 0)
  const reactors = form.reactors.reduce(
    (n, g) => n + g.points.reduce((m, p) => m + p.boxes, 0),
    0,
  )
  const mounts = form.weapons.reduce(
    (n, w) => n + w.mounts.reduce((m, mount) => m + mount.hitBoxes, 0),
    0,
  )
  return (
    general +
    (form.scoutSensor?.damageBoxes ?? 0) +
    form.shields.generatorBoxes +
    reactors +
    form.batteries +
    form.ftlDriveBoxes +
    form.sublight.driveBoxes +
    mounts
  )
}

/**
 * Price a ship the way the designers' spreadsheet does.
 *
 * `specialModifier` is the sheet's free hand — a designer's thumb on the scale
 * for a ship that plays better or worse than its parts suggest.
 */
export function pointValue(form: ShipForm, specialModifier = 1): PointBreakdown {
  const powerPoints = form.reactors.reduce((n, g) => n + g.points.length, 0)
  const powerPerBox = (POWER_MULTIPLIER[form.sizeClass] ?? form.sizeClass) * 2
  const pointsAndBatteries = powerPoints + form.batteries

  const sensorLine = form.functions.find((l) => l.kind === 'sensor')
  const sensorRating = systemBoxes(form, 'SENS') || 1
  const sensorAtZero = sensorLine?.freeValue ?? 0
  const sensorAtOne = lineValueAt(form, 'sensor', 1)
  const sensorAtTwo = lineValueAt(form, 'sensor', 2)

  const scienceBoxes = systemBoxes(form, 'SCNC')

  // ---- offense, which everything else is priced against ------------------
  // V41: a weapon's effective reach is stretched by half the ship's best
  // sensor line value, whichever power level that is (it was the one-power
  // value, whole, in V38).
  const sensorReach = Math.max(sensorAtZero, sensorAtOne, sensorAtTwo) / 2
  const weapons = form.weapons.map((w) => valueWeapon(w, { scienceBoxes, sensorReach }))
  const totalOffense = COMPONENT_WEIGHTS.offense * weapons.reduce((n, w) => n + w.value, 0)

  // ---- actual power ------------------------------------------------------
  // Free power is power the ship never has to spend: the sensor points, the
  // acceleration and the SIF it gets for nothing, plus every free arming point
  // on a weapon line (B2.2.3).
  const freeAccel = lineValueAt(form, 'accel', 0)
  const freeSif = lineValueAt(form, 'sif', 0)
  const freeShieldPower = lineValueAt(form, 'shield-reinforce', 0)
  const freeArmingPower = form.weapons.reduce((n, w, i) => {
    const line = form.functions.find((l) => l.weaponSystemId === w.id)
    return n + (line?.freeValue ?? 0) * weapons[i].powerPerArmingPoint
  }, 0)
  const freePower =
    (sensorRating > 0 ? (sensorAtZero / sensorRating) * powerPerBox : 0) +
    freeAccel * powerPerBox +
    freeSif * powerPerBox +
    // V41 counts free shield power as free power too. No printed or fan hull
    // carries any today, so this term is faithful rather than consequential.
    freeShieldPower * powerPerBox +
    freeArmingPower
  const actualPower = powerPerBox * pointsAndBatteries + freePower
  const powerRatio = actualPower / REFERENCE_POWER

  // ---- hit points --------------------------------------------------------
  const shieldBoxes = (['F', 'S', 'A', 'P'] as const).reduce(
    (n, side) => n + form.shields.blue[side],
    0,
  )
  const armorBoxes = (['F', 'S', 'A', 'P'] as const).reduce((n, side) => n + form.armor[side], 0)
  const systemHitBoxes = totalSystemBoxes(form)
  const structureBoxes = form.structure.filter((e) => e.kind === 'box').length
  const hitPoints = shieldBoxes + armorBoxes + systemHitBoxes + structureBoxes
  const hitRatio = hitPoints / REFERENCE_HIT_POINTS

  // ---- the eight components ---------------------------------------------
  // Sensors are cubed and normalised, then priced against firepower.
  const sensorValue =
    ((sensorRating ** 3 / 27) * 0.4 +
      (sensorAtZero ** 3 / 8) * 0.1 +
      (sensorAtOne ** 3 / 64) * 0.1 +
      (sensorAtTwo ** 3 / 216) * 0.4) *
    totalOffense
  const sensors = sensorValue * COMPONENT_WEIGHTS.sensors * powerRatio

  // The three specialist systems are priced off other totals rather than by a
  // flat per-box rate: a command box is worth an eighth of the ship's sensor
  // value, a cloak the whole of it, and a scout sensor its own fixed cost.
  const specialistSystems =
    systemBoxes(form, 'CMND') * (sensorValue / 8) +
    // V41 halved the cloak's price: half the ship's sensor value per box
    // (it was the whole of it in V38).
    systemBoxes(form, 'CLOAK') * sensorValue * 0.5 +
    (form.scoutSensor?.sensors ?? 0) * SCOUT_SENSOR_COST

  const generalSystems =
    form.systems.reduce((n, g) => n + g.boxes * (SYSTEM_MODIFIER[g.kind] ?? 0), 0) +
    specialistSystems +
    form.marineSquads * MARINE_MODIFIER

  const shieldGenerator =
    hitRatio * pointsAndBatteries * (form.shields.generatorBoxes / 10) +
    freeShieldPower * form.shields.generatorBoxes * hitRatio
  const shieldValue = shieldBoxes * COMPONENT_WEIGHTS.shields + shieldGenerator
  const damageControlValue = 0.5 * form.damageControlRating * hitRatio

  // Stress bites into the value of a ship's system boxes.
  const maxSif = lineValueAt(form, 'sif', 3)
  const stressBase = (40 - (pointsAndBatteries + maxSif * 3 + freeSif * 6)) / 10
  const stressHits = ((systemHitBoxes + structureBoxes) / 52) * 2
  const stressDamage = (stressBase + stressHits) * (form.stressRating * 0.25 * 2.5)

  const systemHitValue =
    (systemHitBoxes + damageControlValue - stressDamage) * COMPONENT_WEIGHTS.systemHits

  // An FTL drive that costs more than the main reactors can make is a liability
  // in a fight, so the sheet pays a ship back for a cheap one (J9.1.2).
  const ftlPerRound = lineValueAt(form, 'ftl-drive', 99)
  const mainReactorPoints = form.reactors
    .filter((g) => g.hitKind.endsWith('-main'))
    .reduce((n, g) => n + g.points.length, 0)
  const ftlPenalty = (ftlPerRound - mainReactorPoints) * -2

  const defence =
    shieldValue + armorBoxes * COMPONENT_WEIGHTS.armor + systemHitValue + structureBoxes + ftlPenalty

  const powerSystem = powerRatio * totalOffense * COMPONENT_WEIGHTS.powerSystem

  const { sublight } = form
  const accelValue =
    freeAccel * totalOffense * 0.4 +
    ((sublight.maxAccelPerPhase * totalOffense) / 2) * 0.25 +
    ((sublight.safeAccelPerRound * totalOffense) / 2) * 0.25 +
    ((sublight.stressAccelPerRound * totalOffense) / 4) * 0.1 +
    ((sublight.maxSpeed * totalOffense) / 6) * 0.15
  const speedAccel = accelValue * COMPONENT_WEIGHTS.speedAccel * powerRatio

  const sifValue =
    (form.stressRating * totalOffense) / -4 +
    (maxSif * totalOffense) / 3 +
    freeSif * (totalOffense * 0.33) +
    0.01
  const sif = sifValue * COMPONENT_WEIGHTS.sif * powerRatio

  // Turn templates are worth more at speed, so the sheet weights the fast rows.
  // The second term reads the maneuvering block's damage boxes: each one is
  // printed against the speed it drops the ship to (E8.5.4), and a box that
  // costs you nothing but a crawl is worth less than one that leaves you fast.
  const turnTotal = sublight.turnBySpeed.reduce((n, t) => n + t, 0) + sublight.maxSpeed * 30
  const SPEED_WEIGHTS = [-1.3, -1.2, -1.1, 1, 1.1, 1.2, 1.3]
  const driveBoxValue = sublight.dmgTopSpeed.reduce((n, speed) => n + (SPEED_WEIGHTS[speed] ?? 0), 0)
  const maneuver = ((turnTotal / 190) * totalOffense + driveBoxValue) * COMPONENT_WEIGHTS.maneuver

  // Offense is paid twice over: once against the ship's outer defenses, which
  // decide how long it lives to keep shooting, and once against what is left
  // underneath them.
  const outerRatio = (shieldValue + armorBoxes) / REFERENCE_HIT_POINTS
  const innerRatio = (systemHitValue + structureBoxes) / REFERENCE_HIT_POINTS
  const offense =
    totalOffense * outerRatio +
    ((totalOffense * innerRatio) / 2) * COMPONENT_WEIGHTS.offense * powerRatio

  const subtotal =
    generalSystems + sensors + defence + powerSystem + speedAccel + sif + maneuver + offense

  return {
    generalSystems,
    sensors,
    defence,
    powerSystem,
    speedAccel,
    sif,
    maneuver,
    offense,
    subtotal,
    points: (subtotal / 10) * specialModifier,
    totalOffense,
    actualPower,
    systemBoxes: systemHitBoxes,
    weapons,
  }
}

// ---------------------------------------------------------------------------
// Design validation
// ---------------------------------------------------------------------------

export interface DesignProblem {
  severity: 'error' | 'warning'
  message: string
}

/**
 * Check a design against the limits the rules actually state. Errors would make
 * the ship unplayable; warnings are things no printed ship does.
 */
export function validateDesign(form: ShipForm): DesignProblem[] {
  const problems: DesignProblem[] = []
  const error = (message: string) => problems.push({ severity: 'error', message })
  const warn = (message: string) => problems.push({ severity: 'warning', message })

  if (!form.name.trim()) error('The ship needs a class name.')
  if (form.sizeClass < 1 || form.sizeClass > 10) error('Size class runs from 1 to 10 (B1.3.1).')
  if (form.sublight.maxSpeed < 1) error('A ship needs a maximum speed of at least 1 (C1.2.7).')
  if (form.sublight.maxSpeed > 8) error('No ship may exceed speed 8 (C1.2.7).')
  if (form.reactors.length === 0) error('A ship needs at least one reactor (B2.1.1).')
  /*
   * Main reactor durability scales with the hull, and the designer's own
   * builder sheet (V41) prints the exact table — boxes per power point, odd
   * and even points separately, which is how the printed size-3s alternate
   * 2,1,2,1. Checked against all 93 printed forms: not one deviates. It is
   * NOT floor(size/2): size 6 carries 2, size 9 carries 4. Sublight and
   * auxiliary reactors are deliberately unchecked, because the printed forms
   * themselves stray from the sheet's ladder there (the size-3 sublights
   * carry 2,2). Found the hard way, twice: first a size-10 fan dreadnought
   * shipped with size-7 reactors because nothing checked, then the inferred
   * floor/ceil rule this replaced let a size-9 carry fives.
   */
  const MAIN_LADDER: Record<number, [number, number]> = {
    1: [1, 1], 2: [1, 1], 3: [2, 1], 4: [2, 2], 5: [2, 2],
    6: [2, 2], 7: [3, 3], 8: [3, 3], 9: [4, 4], 10: [5, 5],
  }
  const rungs = MAIN_LADDER[form.sizeClass]
  if (rungs) {
    for (const reactor of form.reactors) {
      if (!['left-main', 'right-main', 'center-main'].includes(reactor.hitKind)) continue
      const off = reactor.points.findIndex((p, i) => p.boxes !== rungs[i % 2])
      if (off >= 0) {
        const want = rungs[0] === rungs[1] ? `${rungs[0]} boxes` : `${rungs[0]},${rungs[1]} boxes, alternating`
        error(
          `${reactor.label}: a size-${form.sizeClass} hull's main reactor points carry ` +
            `${want} (the designer's builder table); point ${off + 1} has ${reactor.points[off].boxes}.`,
        )
      }
    }
  }
  /*
   * Custom counter art is cosmetic, but it travels inside the form — into
   * saves, library entries and remote matches — so it has to be something an
   * <image> can safely draw and something the library's size cap can carry.
   * The embedded cap leaves room for the rest of a big design under
   * MAX_DESIGN_BYTES.
   */
  if (form.art !== undefined) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(form.art) && !/^https:\/\//.test(form.art)) {
      error('Counter art must be an embedded PNG/JPEG/WebP or an https:// link.')
    } else if (form.art.length > 48_000) {
      error('Embedded counter art is too large — the builder scales uploads down for a reason.')
    }
  }
  if (form.weapons.length === 0) warn('The ship has no weapons.')
  if (form.structure.filter((e) => e.kind === 'box').length === 0) {
    error('A ship needs at least one structure box (B1.8).')
  }
  if (form.damageControlRating < 1) warn('A Damage Control Rating of zero means no repairs (B3.1).')
  if (form.stressRating < 1) error('Stress Rating must be at least 1 (C3.1).')

  /*
   * G1.1.3 prints a maximum on each shield facing, and it is flat — the same
   * ceiling for a frigate and for the largest hull the rules allow.
   *
   * A warning rather than an error, by this function's own contract: nothing
   * anywhere enforces the cap at play time, so a ship over it is completely
   * playable, which makes it "something no printed ship does" and not
   * "unplayable". It used to be an error, and that made the ceiling a hard
   * wall for designs the printed roster never had to think about — a size 10
   * super dreadnought carrying a heavy cruiser's screens because a number
   * written for size 5 hulls said so.
   */
  const shieldCap: Record<string, number> = { F: 36, S: 28, P: 28, A: 36 }
  for (const side of ['F', 'S', 'A', 'P'] as const) {
    if (form.shields.blue[side] > shieldCap[side]) {
      warn(
        `${side} shield is ${form.shields.blue[side]}, over the printed maximum of ` +
          `${shieldCap[side]} (G1.1.3). Legal to play; no printed ship does it.`,
      )
    }
  }

  for (const weapon of form.weapons) {
    const label = weapon.name || 'unnamed weapon'
    if (weapon.mounts.length === 0) error(`${label} has no mounts.`)
    if (weapon.brackets.length === 0) error(`${label} has no firing chart (E3.2.1).`)
    for (const mount of weapon.mounts) {
      if (mount.arcs.length === 0) error(`${label} has a mount with no firing arc (E2.2.2).`)
      // An arc outside the printed eight never matches a bearing, so the mount
      // silently never fires — the ship looks armed on paper and loses every
      // battle. Worth an error rather than trusting the type: designs arrive
      // here from JSON files and from other people's browsers.
      for (const arc of mount.arcs) {
        if (!(ARC_ORDER as readonly string[]).includes(arc)) {
          error(
            `${label} has a mount with the firing arc "${arc}", which is not one of the ` +
              `eight printed arcs ${ARC_ORDER.join(', ')} (E2.2.2). It would never bear on anything.`,
          )
        }
      }
      if (mount.armingCircles < 1) error(`${label} has a mount with no arming circles (E4.2.2).`)
      if (mount.hitBoxes < 1) error(`${label} has a mount with no damage boxes (E8.3.1).`)
    }
    // Homing weapons restart their range each phase, so only direct-fire charts
    // have to run continuously (E3.2.1, E5.1.5).
    if (!hasTrait(weapon, 'HOMING')) {
      let previous = -1
      for (const bracket of weapon.brackets) {
        if (bracket.min !== previous + 1) {
          warn(`${label}'s firing chart has a gap or overlap at ${bracket.min}-${bracket.max}.`)
        }
        previous = bracket.max
      }
    }
    if (!form.functions.some((l) => l.weaponSystemId === weapon.id)) {
      error(`${label} has no arming line in FUNCTIONS (E4.2.6).`)
    }
    // The designers price the printed `AMMO X` trait, not the shot count on the
    // mount, so a limited weapon without the trait is costed as unlimited.
    const shots = weapon.mounts.find((m) => m.ammo !== undefined)?.ammo
    if (shots !== undefined && !weapon.traits.some((t) => /^AMMO/i.test(t))) {
      warn(`${label} is limited to ${shots} shots but carries no AMMO trait, so it is priced as if it had unlimited ammunition (F1.2).`)
    }
  }

  const unknownTraits = form.weapons
    .flatMap((w) => w.traits)
    .filter((t) => t && traitModifier(t) === 0 && !/^PREC/i.test(t) && !/^SPCL/i.test(t))
  for (const trait of [...new Set(unknownTraits)]) {
    warn(`Trait "${trait}" is not in the designers' cost table, so it is priced at zero.`)
  }

  // A special system the FUNCTIONS block cannot power is unusable in play.
  if ((form.scoutSensor?.sensors ?? 0) > 0 && !form.functions.some((l) => l.label.startsWith('SCOUT SEN'))) {
    error('The scout sensor block has no SCOUT SEN line to power it (H3.2.1).')
  }
  if (systemBoxes(form, 'CLOAK') > 0 && !form.functions.some((l) => l.label === 'CLOAK')) {
    error('The cloaking system has no CLOAK line to power it (H6.3.1).')
  }

  // E5.1.5 — a homing weapon's brackets sit in thick red endurance boxes, one
  // per phase of flight. Without them the weapon has nowhere to fly.
  for (const weapon of form.weapons) {
    if (!hasTrait(weapon, 'HOMING')) continue
    if (!weapon.brackets.some((b) => b.endurancePhase !== undefined)) {
      error(`${weapon.name || 'A homing weapon'} has no endurance boxes on its chart (E5.1.5).`)
    }
  }

  // E8.5.4 — one entry per sublight drive box, each the speed that box drops
  // the ship to. Without them the engine cannot slow a crippled ship down.
  if (form.sublight.dmgTopSpeed.length !== form.sublight.driveBoxes) {
    error(
      `The sublight drive has ${form.sublight.driveBoxes} boxes but ` +
        `${form.sublight.dmgTopSpeed.length} damaged-speed entries (E8.5.4).`,
    )
  }
  if (form.sublight.turnBySpeed.length < form.sublight.maxSpeed + 1) {
    error('The turn table needs a row for every speed from 0 to the maximum (C2.2.2).')
  }

  // B2.2 — a line the ship can never fill is a printing error, not a choice.
  const available = form.reactors.reduce((n, g) => n + g.points.length, 0) + form.batteries
  const cheapest = form.functions
    .filter((l) => l.steps.length > 0)
    .reduce((n, l) => Math.min(n, l.steps[0].powerCost), Infinity)
  if (cheapest !== Infinity && cheapest > available) {
    error(`No FUNCTIONS line can be powered: the ship makes only ${available} power (B2.2).`)
  }

  return problems
}

/**
 * What the designers' thumb was worth on a printed ship: the sheet's Special
 * Modifier, recovered by dividing the printed point value by the model's.
 *
 * A value near 1 means the ship costs what its parts say it should. Anything
 * far from 1 is the designers saying the ship plays better or worse than the
 * sum of its numbers — which is exactly what the modifier is for.
 */
export function impliedSpecialModifier(form: ShipForm): number {
  const prelim = pointValue(form).points
  return prelim > 0 ? form.pointValue / prelim : 1
}

// ---------------------------------------------------------------------------
// Blank designs
// ---------------------------------------------------------------------------

const side = <T,>(value: T): Record<ShieldSide, T> => ({ F: value, S: value, A: value, P: value })

/** The FUNCTIONS lines every ship has, in the order the forms print them. */
function standardFunctions(): FunctionLineDef[] {
  const lines: FunctionLineDef[] = [
    { id: 'accel', label: 'ACC/DEC', kind: 'accel', freeValue: 1, steps: step([2, 3]), sequential: true },
    { id: 'sif', label: 'SIF/IDF', kind: 'sif', freeValue: 0, steps: step([1, 2]), sequential: true },
    { id: 'emer', label: 'EMER', kind: 'emergency-turn', freeValue: 0, steps: step([1]), sequential: false },
    {
      id: 'bat-rech',
      label: 'BTY RECH',
      kind: 'battery-recharge',
      freeValue: 0,
      steps: step([1]),
      sequential: false,
    },
    { id: 'ftl', label: 'FTL DRV', kind: 'ftl-drive', freeValue: 0, steps: step([1, 2]), sequential: true },
  ]
  for (const s of ['F', 'S', 'A', 'P'] as const) {
    lines.push({
      id: `rnfc-${s}`,
      label: `SHLD RNFC ${s}`,
      kind: 'shield-reinforce',
      freeValue: 0,
      steps: step([1]),
      sequential: false,
      shieldSide: s,
    })
  }
  for (const s of ['F', 'S', 'A', 'P'] as const) {
    lines.push({
      id: `repr-${s}`,
      label: `SHLD REPR ${s}`,
      kind: 'shield-repair',
      freeValue: 0,
      steps: step([1]),
      sequential: false,
      shieldSide: s,
    })
  }
  lines.push(
    { id: 'sensor', label: 'SENSOR', kind: 'sensor', freeValue: 2, steps: step([4, 6]), sequential: true },
    { id: 'gensys', label: 'GEN SYS', kind: 'gen-sys', freeValue: 1, steps: step([2]), sequential: true },
  )
  return lines
}

const step = (values: number[]) => values.map((value) => ({ powerCost: 1, value }))

/**
 * A legal, playable starting point for a new design: a small hull with one
 * reactor, a light shield grid and no weapons. Everything else the builder
 * edits from here.
 */
export function blankForm(id: string): ShipForm {
  return {
    id,
    name: 'New Class',
    faction: 'Custom',
    sizeClass: 3,
    stressRating: 3,
    damageControlRating: 3,
    reactors: [
      // Size 3 alternates 2,1 per the designer's table, like the printed 3s.
      { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 2 }, { boxes: 1 }] },
      { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 2 }, { boxes: 1 }] },
    ],
    batteries: 1,
    ftlDriveBoxes: 2,
    functions: standardFunctions(),
    weapons: [],
    shields: { generatorBoxes: 2, blue: side(8), green: side(2) },
    armor: side(0),
    systems: [
      { kind: 'SENS', label: 'Sensors', boxes: 2 },
      { kind: 'SCNC', label: 'Sciences', boxes: 2 },
      { kind: 'QTRS', label: 'Quarters', boxes: 2 },
    ],
    structure: [
      { kind: 'box', color: 'black' },
      { kind: 'dc', rating: 2 },
      { kind: 'box', color: 'black' },
      { kind: 'box', color: 'red' },
    ],
    sublight: {
      maxSpeed: 5,
      turnBySpeed: [45, 40, 35, 30, 25, 20],
      maxAccelPerPhase: 2,
      safeAccelPerRound: 2,
      stressAccelPerRound: 1,
      driveBoxes: 3,
      dmgTopSpeed: [3, 1, 0],
    },
    marineSquads: 2,
    shuttles: 0,
    pointValue: 0,
    year: 3600,
    availability: 'common',
    notes: 'Custom design.',
  }
}

/**
 * Keep the FUNCTIONS lines that special systems depend on in step with the rest
 * of the form.
 *
 * A scout sensor block is powered by its SCOUT SEN line and a cloak by its
 * CLOAK line, and the engine finds both by label. A form carrying the block but
 * not the line is not a ship with a broken sensor — it is a ship whose sensors
 * can never be switched on, so the builder maintains the pair rather than
 * leaving a player to notice mid-battle.
 *
 * A line that already reaches the sensor count is left exactly as it is. Some
 * printed scouts buy two sensors with their first power point — the KNOX II has
 * four sensors on three circles — and that is a design choice, not an error to
 * normalise away. Only a line that cannot reach the count is rebuilt, at one
 * sensor per power point.
 */
export function syncSpecialLines(form: ShipForm): void {
  const drop = (id: string) => {
    form.functions = form.functions.filter((l) => l.id !== id)
  }

  const sensors = form.scoutSensor?.sensors ?? 0
  const scout = form.functions.find((l) => l.id === 'scout-sen')
  if (sensors > 0) {
    const steps = Array.from({ length: sensors }, (_, i) => ({ powerCost: 1, value: i + 1 }))
    if (!scout) {
      form.functions.push({
        id: 'scout-sen',
        label: 'SCOUT SEN',
        kind: 'special',
        freeValue: 0,
        steps,
        sequential: true,
      })
    } else if ((scout.steps[scout.steps.length - 1]?.value ?? scout.freeValue) !== sensors) {
      scout.steps = steps
    }
  } else if (scout) {
    drop('scout-sen')
  }

  const cloakBoxes = systemBoxes(form, 'CLOAK')
  const cloak = form.functions.find((l) => l.id === 'cloak')
  if (cloakBoxes > 0 && !cloak) {
    // H6.3.1 — a cloak needs every circle on the line filled, so the number of
    // circles is what the cloak costs to run.
    form.functions.push({
      id: 'cloak',
      label: 'CLOAK',
      kind: 'special',
      freeValue: 0,
      steps: [
        { powerCost: 1, value: 1 },
        { powerCost: 1, value: 2 },
      ],
      sequential: true,
    })
  } else if (cloakBoxes === 0 && cloak) {
    drop('cloak')
  }
}

/** A scout sensor block at the strength the smallest printed scouts carry. */
export function blankScoutSensor(): ScoutSensorDef {
  return { sensors: 2, damageBoxes: 2, targetingRange: 18, jammingRange: 6, scanRange: 18 }
}

/** A new weapon system, plus the FUNCTIONS line that arms it (E4.2.6). */
export function blankWeapon(id: string): { weapon: WeaponSystemDef; line: FunctionLineDef } {
  const weapon: WeaponSystemDef = {
    id,
    name: 'NEW WEAPON',
    weaponClass: 'phaser',
    mounts: [{ id: `${id}-m1`, arcs: ['FS', 'FP'], armingCircles: 2, hitBoxes: 1 }],
    brackets: [
      { min: 0, max: 4, band: 'green', dice: ['yellow'] },
      { min: 5, max: 9, band: 'black', dice: ['green'] },
      { min: 10, max: 14, band: 'red', dice: ['blue'] },
    ],
    traits: [],
  }
  const line: FunctionLineDef = {
    id: `f-${id}`,
    label: weapon.name,
    kind: 'weapon',
    freeValue: 0,
    steps: step([2, 4]),
    sequential: true,
    weaponSystemId: id,
  }
  return { weapon, line }
}
