/**
 * The Shipwright — the third way to build a ship (the designer's request).
 *
 * The freeform builder lets you author every box and nothing stops a size-2
 * hull from shipping twenty torpedo tubes. The Shipwright is the opposite
 * discipline, Full Thrust style: the HULL is the budget. A size class buys a
 * total ACTUAL POWER allowance and a handful of hard caps — mounts, heavy
 * mounts, weapon systems, shield strength, system boxes, structure — and
 * every canon weapon carries a minimum hull size and a tech year. All of it
 * is DERIVED from the canon roster itself: each cap is the largest value any
 * canon ship of that size actually carries, each weapon's floor is the
 * smallest canon hull that mounts it, each tech level is a generation of the
 * in-universe timeline (the Yorktown marks land on 3645 / 3655 / 3662 /
 * 3667 / 3672 — those cadences are the bands). By construction, EVERY canon
 * ship passes its own envelope — the permanent test — and a player's design
 * is bounded by what the fiction has actually fielded.
 *
 * Everything the designer may want to tune is an override table
 * (ENVELOPE_OVERRIDES, WEAPON_FLOOR_OVERRIDES), not a code change.
 */

import { pointValue } from '../engine/shipBuilder'
import type {
  Arc,
  FunctionLineDef,
  ShieldSide,
  ShipForm,
  WeaponSystemDef,
} from '../engine/types'
import { SHIP_FORMS, shipFormById } from './ships'

const canon = () => SHIP_FORMS.filter((f) => !f.id.startsWith('fan-'))

// ---------------------------------------------------------------------------
// Tech levels — generations of the in-universe timeline
// ---------------------------------------------------------------------------

export interface TechLevel {
  level: number
  label: string
  /** Latest in-universe year this generation covers. */
  maxYear: number
}

/** The Yorktown cadence: I 3645, II 3655, III 3662, IV 3667, V 3672. */
export const TECH_LEVELS: TechLevel[] = [
  { level: 1, label: 'First Generation (to 3654)', maxYear: 3654 },
  { level: 2, label: 'Second Generation (to 3661)', maxYear: 3661 },
  { level: 3, label: 'Third Generation (to 3666)', maxYear: 3666 },
  { level: 4, label: 'Fourth Generation (to 3671)', maxYear: 3671 },
  { level: 5, label: 'Fifth Generation', maxYear: 9999 },
]

/** The generation an in-universe year belongs to. No year reads as latest. */
export function techLevelOfYear(year: number | undefined): number {
  if (!year) return TECH_LEVELS[TECH_LEVELS.length - 1].level
  for (const tl of TECH_LEVELS) if (year <= tl.maxYear) return tl.level
  return TECH_LEVELS[TECH_LEVELS.length - 1].level
}

const maxYearOfLevel = (level: number): number =>
  (TECH_LEVELS.find((t) => t.level === level) ?? TECH_LEVELS[TECH_LEVELS.length - 1]).maxYear

// ---------------------------------------------------------------------------
// The hull envelope — what a size class may carry, from the canon roster
// ---------------------------------------------------------------------------

export interface HullEnvelope {
  sizeClass: number
  /** Total ACTUAL POWER the design may spend (the tonnage). */
  powerBudget: number
  maxMounts: number
  maxHeavyMounts: number
  maxWeaponSystems: number
  maxSystemBoxes: number
  /** Sum of blue shield boxes across the four facings. */
  maxShieldTotal: number
  maxStructureBoxes: number
}

/** The designer's dial: any field here beats the derived value. */
export const ENVELOPE_OVERRIDES: Partial<Record<number, Partial<HullEnvelope>>> = {}

/** A weapon is heavy when any bracket rolls red attack dice (E8.3.4's tier). */
export function isHeavyWeapon(def: WeaponSystemDef): boolean {
  return def.brackets.some((b) => b.dice.includes('red'))
}

const mountCount = (f: ShipForm) => f.weapons.reduce((n, w) => n + w.mounts.length, 0)
const heavyMountCount = (f: ShipForm) =>
  f.weapons.filter(isHeavyWeapon).reduce((n, w) => n + w.mounts.length, 0)
const systemBoxCount = (f: ShipForm) => f.systems.reduce((n, g) => n + g.boxes, 0)
const shieldTotal = (f: ShipForm) =>
  (['F', 'S', 'A', 'P'] as ShieldSide[]).reduce((n, s) => n + f.shields.blue[s], 0)
const structureBoxes = (f: ShipForm) => f.structure.filter((e) => e.kind === 'box').length

let envelopeCache: Map<number, HullEnvelope> | null = null

function derivedEnvelopes(): Map<number, HullEnvelope> {
  if (envelopeCache) return envelopeCache
  const map = new Map<number, HullEnvelope>()
  for (const f of canon()) {
    const e =
      map.get(f.sizeClass) ??
      ({
        sizeClass: f.sizeClass,
        powerBudget: 0,
        maxMounts: 0,
        maxHeavyMounts: 0,
        maxWeaponSystems: 0,
        maxSystemBoxes: 0,
        maxShieldTotal: 0,
        maxStructureBoxes: 0,
      } as HullEnvelope)
    e.powerBudget = Math.max(e.powerBudget, Math.ceil(pointValue(f).actualPower))
    e.maxMounts = Math.max(e.maxMounts, mountCount(f))
    e.maxHeavyMounts = Math.max(e.maxHeavyMounts, heavyMountCount(f))
    e.maxWeaponSystems = Math.max(e.maxWeaponSystems, f.weapons.length)
    e.maxSystemBoxes = Math.max(e.maxSystemBoxes, systemBoxCount(f))
    e.maxShieldTotal = Math.max(e.maxShieldTotal, shieldTotal(f))
    e.maxStructureBoxes = Math.max(e.maxStructureBoxes, structureBoxes(f))
    map.set(f.sizeClass, e)
  }
  envelopeCache = map
  return map
}

/**
 * The envelope for one size class. A size the canon roster never built
 * (there is no canon size 6) interpolates between its neighbors, and a size
 * outside the roster entirely clamps to the nearest built one.
 */
export function hullEnvelope(sizeClass: number): HullEnvelope {
  const derived = derivedEnvelopes()
  const sizes = [...derived.keys()].sort((a, b) => a - b)
  let base: HullEnvelope
  if (derived.has(sizeClass)) base = { ...derived.get(sizeClass)! }
  else {
    const below = [...sizes].reverse().find((s) => s < sizeClass)
    const above = sizes.find((s) => s > sizeClass)
    if (below !== undefined && above !== undefined) {
      const lo = derived.get(below)!
      const hi = derived.get(above)!
      const mid = (k: keyof HullEnvelope) => Math.ceil(((lo[k] as number) + (hi[k] as number)) / 2)
      base = {
        sizeClass,
        powerBudget: mid('powerBudget'),
        maxMounts: mid('maxMounts'),
        maxHeavyMounts: mid('maxHeavyMounts'),
        maxWeaponSystems: mid('maxWeaponSystems'),
        maxSystemBoxes: mid('maxSystemBoxes'),
        maxShieldTotal: mid('maxShieldTotal'),
        maxStructureBoxes: mid('maxStructureBoxes'),
      }
    } else {
      const nearest = below ?? above ?? sizes[0]
      base = { ...derived.get(nearest)!, sizeClass }
    }
  }
  return { ...base, ...(ENVELOPE_OVERRIDES[sizeClass] ?? {}) }
}

// ---------------------------------------------------------------------------
// The weapon catalog — every canon weapon, with its floor and its year
// ---------------------------------------------------------------------------

export interface CatalogWeapon {
  /** The printed weapon name — the catalog key. */
  key: string
  /** The weapon as its earliest, smallest canon carrier prints it. */
  weapon: WeaponSystemDef
  /** That carrier's arming ladder for it, ready to ride along. */
  armingLine: FunctionLineDef
  /** Factions whose canon ships carry it. */
  factions: string[]
  /** Smallest canon hull that mounts it — the size floor. */
  minSizeClass: number
  /** Earliest in-universe year it appears. */
  introYear: number
  heavy: boolean
}

/** The designer's dial: a weapon named here uses this floor instead. */
export const WEAPON_FLOOR_OVERRIDES: Record<string, number> = {}

let catalogCache: CatalogWeapon[] | null = null

export function weaponCatalog(): CatalogWeapon[] {
  if (catalogCache) return catalogCache
  const byName = new Map<string, CatalogWeapon & { carrierYear: number; carrierSize: number }>()
  for (const f of canon()) {
    for (const w of f.weapons) {
      const line = f.functions.find((l) => l.kind === 'weapon' && l.weaponSystemId === w.id)
      if (!line) continue
      const year = f.year ?? 9999
      const entry = byName.get(w.name)
      if (!entry) {
        byName.set(w.name, {
          key: w.name,
          weapon: structuredClone(w),
          armingLine: structuredClone(line),
          factions: [f.faction],
          minSizeClass: f.sizeClass,
          introYear: year,
          heavy: isHeavyWeapon(w),
          carrierYear: year,
          carrierSize: f.sizeClass,
        })
        continue
      }
      if (!entry.factions.includes(f.faction)) entry.factions.push(f.faction)
      entry.minSizeClass = Math.min(entry.minSizeClass, f.sizeClass)
      entry.introYear = Math.min(entry.introYear, year)
      // The template comes from the earliest carrier; ties go to the smaller.
      if (year < entry.carrierYear || (year === entry.carrierYear && f.sizeClass < entry.carrierSize)) {
        entry.weapon = structuredClone(w)
        entry.armingLine = structuredClone(line)
        entry.carrierYear = year
        entry.carrierSize = f.sizeClass
      }
    }
  }
  catalogCache = [...byName.values()]
    .map(({ carrierYear: _y, carrierSize: _s, ...rest }) => rest)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  return catalogCache
}

/** The floor for one weapon name, override first. */
export function weaponFloor(entry: CatalogWeapon): number {
  return WEAPON_FLOOR_OVERRIDES[entry.key] ?? entry.minSizeClass
}

/** The catalog a given hull may shop from. */
export function catalogFor(options: {
  faction: string
  sizeClass: number
  techLevel: number
  openCatalog?: boolean
}): CatalogWeapon[] {
  const maxYear = maxYearOfLevel(options.techLevel)
  return weaponCatalog().filter(
    (entry) =>
      weaponFloor(entry) <= options.sizeClass &&
      entry.introYear <= maxYear &&
      (options.openCatalog || entry.factions.includes(options.faction)),
  )
}

// ---------------------------------------------------------------------------
// Chassis — a canon hull with the guns removed, ready to arm
// ---------------------------------------------------------------------------

export interface ChassisOption {
  donorId: string
  label: string
  faction: string
  sizeClass: number
  year: number
  techLevel: number
  /** Power the bare hull already spends, before any weapons. */
  hullPower: number
  powerBudget: number
}

/** Strip a form of its weapons and their arming lines. */
function stripWeapons(form: ShipForm): ShipForm {
  const bare = structuredClone(form)
  bare.weapons = []
  bare.functions = bare.functions.filter((l) => l.kind !== 'weapon')
  return bare
}

/** Canon hulls a faction may lay down at a tech level, smallest first. */
export function chassisOptions(faction: string, techLevel: number): ChassisOption[] {
  const maxYear = maxYearOfLevel(techLevel)
  return canon()
    .filter((f) => f.faction === faction && (f.year ?? 0) <= maxYear)
    .map((f) => ({
      donorId: f.id,
      label: f.name,
      faction: f.faction,
      sizeClass: f.sizeClass,
      year: f.year ?? 0,
      techLevel: techLevelOfYear(f.year),
      hullPower: Math.ceil(pointValue(stripWeapons(f)).actualPower),
      powerBudget: hullEnvelope(f.sizeClass).powerBudget,
    }))
    .sort((a, b) => a.sizeClass - b.sizeClass || a.year - b.year || (a.label < b.label ? -1 : 1))
}

/** Lay down a bare hull from a canon donor, ready for the catalog. */
export function buildChassis(donorId: string, className: string): ShipForm | string {
  const donor = shipFormById(donorId)
  if (!donor) return `No such canon hull: ${donorId}`
  const bare = stripWeapons(donor)
  const stamp = Date.now().toString(36)
  bare.id = `wright-${className.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design'}-${stamp}`
  bare.name = className
  bare.pointValue = 0 // repriced on save; the budget is power, not points
  bare.notes = `Laid down in the Shipwright on a ${donor.name} chassis.`
  bare.provisional = true
  delete bare.victoryTable
  delete bare.shipBookPage
  delete bare.shipBook
  return bare
}

// ---------------------------------------------------------------------------
// Arming — put a catalog weapon aboard
// ---------------------------------------------------------------------------

/** Arc presets a mount may be laid on, when not keeping the printed arcs. */
export const ARC_PRESETS: Record<string, Arc[]> = {
  forward: ['FP', 'FS'],
  'forward-wide': ['PF', 'FP', 'FS', 'SF'],
  starboard: ['SF', 'SA'],
  port: ['PF', 'PA'],
  aft: ['AS', 'AP'],
  turret: ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP'],
}

/**
 * Add `mountCount` mounts of a catalog weapon. Mount arcs follow the printed
 * template (cycled), or an ARC_PRESETS key applied to every mount.
 */
export function addCatalogWeapon(
  form: ShipForm,
  entry: CatalogWeapon,
  mountCount: number,
  arcPreset?: keyof typeof ARC_PRESETS,
): void {
  const serial = form.weapons.length + 1
  const weapon = structuredClone(entry.weapon)
  weapon.id = `${weapon.id.replace(/-\d+$/, '')}-w${serial}`
  const template = entry.weapon.mounts
  weapon.mounts = Array.from({ length: Math.max(1, mountCount) }, (_, i) => {
    const printed = template[i % template.length]
    return {
      ...structuredClone(printed),
      id: `${weapon.id}-m${i + 1}`,
      ...(arcPreset ? { arcs: [...ARC_PRESETS[arcPreset]] } : {}),
    }
  })
  form.weapons.push(weapon)
  const line = structuredClone(entry.armingLine)
  line.id = `wline-${serial}`
  line.weaponSystemId = weapon.id
  form.functions.push(line)
}

export function removeWeapon(form: ShipForm, weaponId: string): void {
  form.weapons = form.weapons.filter((w) => w.id !== weaponId)
  form.functions = form.functions.filter(
    (l) => l.kind !== 'weapon' || l.weaponSystemId !== weaponId,
  )
}

// ---------------------------------------------------------------------------
// Validation — the whole point
// ---------------------------------------------------------------------------

export interface WrightViolation {
  rule: string
  message: string
}

/**
 * Everything wrong with a design under the Shipwright's discipline. Empty
 * for every canon ship at its own tech level — the permanent test.
 */
export function shipwrightViolations(
  form: ShipForm,
  options: { techLevel: number; openCatalog?: boolean },
): WrightViolation[] {
  const violations: WrightViolation[] = []
  const envelope = hullEnvelope(form.sizeClass)
  const maxYear = maxYearOfLevel(options.techLevel)

  const power = pointValue(form).actualPower
  if (power > envelope.powerBudget + 1e-9) {
    violations.push({
      rule: 'power',
      message: `Uses ${Math.ceil(power)} ACTUAL POWER — a size-${form.sizeClass} hull carries at most ${envelope.powerBudget}.`,
    })
  }
  const mounts = mountCount(form)
  if (mounts > envelope.maxMounts) {
    violations.push({
      rule: 'mounts',
      message: `${mounts} weapon mounts — a size-${form.sizeClass} hull fits at most ${envelope.maxMounts}.`,
    })
  }
  const heavies = heavyMountCount(form)
  if (heavies > envelope.maxHeavyMounts) {
    violations.push({
      rule: 'heavy-mounts',
      message: `${heavies} heavy mounts (red-dice weapons) — at most ${envelope.maxHeavyMounts} at this size.`,
    })
  }
  if (form.weapons.length > envelope.maxWeaponSystems) {
    violations.push({
      rule: 'weapon-systems',
      message: `${form.weapons.length} weapon systems — at most ${envelope.maxWeaponSystems} at this size.`,
    })
  }
  const systems = systemBoxCount(form)
  if (systems > envelope.maxSystemBoxes) {
    violations.push({
      rule: 'systems',
      message: `${systems} system boxes — at most ${envelope.maxSystemBoxes} at this size.`,
    })
  }
  const shields = shieldTotal(form)
  if (shields > envelope.maxShieldTotal) {
    violations.push({
      rule: 'shields',
      message: `${shields} shield boxes across the facings — at most ${envelope.maxShieldTotal} at this size.`,
    })
  }
  const boxes = structureBoxes(form)
  if (boxes > envelope.maxStructureBoxes) {
    violations.push({
      rule: 'structure',
      message: `${boxes} structure boxes — at most ${envelope.maxStructureBoxes} at this size.`,
    })
  }

  const byName = new Map(weaponCatalog().map((e) => [e.key, e]))
  for (const w of form.weapons) {
    const entry = byName.get(w.name)
    if (!entry) {
      violations.push({
        rule: 'catalog',
        message: `${w.name} is not a canon weapon — the Shipwright arms from the printed catalog only.`,
      })
      continue
    }
    const floor = weaponFloor(entry)
    if (floor > form.sizeClass) {
      violations.push({
        rule: 'weapon-size',
        message: `${w.name} needs a size-${floor} hull — this is a size ${form.sizeClass}.`,
      })
    }
    if (entry.introYear > maxYear) {
      violations.push({
        rule: 'tech-level',
        message: `${w.name} enters service in ${entry.introYear} — beyond this design's generation.`,
      })
    }
    if (!options.openCatalog && !entry.factions.includes(form.faction)) {
      violations.push({
        rule: 'faction',
        message: `${w.name} is ${entry.factions.join('/')} hardware — open the catalog to fit it anyway.`,
      })
    }
  }
  return violations
}

/** The live budget readout the UI paints. */
export function shipwrightBudget(form: ShipForm) {
  const envelope = hullEnvelope(form.sizeClass)
  return {
    envelope,
    power: Math.ceil(pointValue(form).actualPower),
    mounts: mountCount(form),
    heavyMounts: heavyMountCount(form),
    weaponSystems: form.weapons.length,
    systemBoxes: systemBoxCount(form),
    shieldTotal: shieldTotal(form),
    structureBoxes: structureBoxes(form),
  }
}
