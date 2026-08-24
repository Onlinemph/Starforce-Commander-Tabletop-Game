/**
 * Import a ship exported by the StarForce Commander Ship Designer
 * (crazyvulcan.github.io/starforce-commander-ship-designer) as a playable
 * ShipForm — so a design drawn there loads through the ship builder's
 * ordinary Upload button and then fights duels, fleets and campaigns like
 * any custom hull.
 *
 * The designer's export is a different shape from ours: function ladders as
 * string arrays, reactors as power-system "tracks", mount arcs as printed
 * arc numbers, structure as two counts. This module translates faithfully
 * where the export states a fact and by DOCUMENTED HEURISTIC where our form
 * needs a stat the export does not carry (size class, stress rating, damage
 * control rating — fitted to the canon roster's own ladders). Every imported
 * form is marked `provisional` and its notes record what was assumed, so
 * nothing pretends to be canon.
 *
 * Reverse-engineered from a sample export; the mappings most worth
 * verifying against the designer's rendered form are flagged VERIFY below.
 */

import type {
  Arc,
  DieColor,
  FunctionLineDef,
  RangeBracketDef,
  ReactorGroupDef,
  ShieldSide,
  ShipForm,
  StructureEntryDef,
  SystemGroupDef,
  SystemKind,
  WeaponMountDef,
  WeaponSystemDef,
} from '../engine/types'

// ---------------------------------------------------------------------------
// The export's shape (what the sample shows; everything optional-tolerant)
// ---------------------------------------------------------------------------

interface DesignerWeaponLine {
  label?: string
  enabled?: boolean
  free?: number
  values?: string[]
}

interface DesignerWeapon {
  name?: string
  mountArcs?: string[]
  mountFacings?: number[][]
  powerCircles?: number
  powerStops?: number[]
  structure?: number
  ranges?: Array<{ band?: string; type?: string; bonus?: number; dice?: string[] }>
  traits?: string[]
  special?: string
}

export interface DesignerExport {
  identity?: {
    name?: string
    classType?: string
    faction?: string
    era?: string
    pointValue?: number
  }
  engineering?: Record<string, number>
  shields?: { forward?: number; aft?: number; port?: number; starboard?: number }
  armor?: { forward?: number; aft?: number; port?: number; starboard?: number }
  shieldGen?: { count?: number; value?: number }
  functionsConfig?: {
    accDec?: { values?: string[]; free?: number }
    sifIdf?: { values?: string[]; free?: number; emer?: boolean }
    batRech?: { values?: string[]; free?: number }
    ftl?: { empty?: number }
    cloak?: { enabled?: boolean; empty?: number }
    sensor?: { values?: string[]; free?: number }
    genSys?: { values?: string[]; free?: number }
    weapons?: DesignerWeaponLine[]
  }
  powerSystem?: {
    tracks?: Array<{
      key?: string
      label?: string
      points?: number
      boxesPerPoint?: number
      boxPattern?: number[]
    }>
  }
  sublight?: {
    maxAccPhs?: number
    greenCircles?: number
    redCircles?: number
    spd?: number[]
    turns?: number[]
    dmgStops?: boolean[]
  }
  structure?: { repairable?: number; permanent?: number }
  shipArtDataUrl?: string
  weapons?: DesignerWeapon[]
  systems?: Array<{ key?: string; value?: string; power?: string }>
  crew?: { shuttleCraft?: number; marinesStationed?: number }
}

/** Is this JSON a ship-designer export rather than one of our ShipForms? */
export function looksLikeDesignerExport(raw: unknown): raw is DesignerExport {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Record<string, unknown>
  return 'identity' in d && 'functionsConfig' in d && 'powerSystem' in d
}

export interface DesignerImport {
  form: ShipForm
  /** Mappings the export left ambiguous — shown to the importer, kept in notes. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ship'

/**
 * VERIFY: the designer numbers mount arcs; we map 1–8 clockwise from
 * front-starboard onto our eight 45° arcs (E2.2.1). `2|5` reads as one
 * mount bearing on arcs 2 and 5.
 */
const ARC_BY_NUMBER: Arc[] = ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP']

function arcsOf(spec: string): Arc[] {
  const arcs: Arc[] = []
  for (const part of spec.split(/[|,\s]+/)) {
    const n = int(part, 0)
    if (n >= 1 && n <= ARC_BY_NUMBER.length) arcs.push(ARC_BY_NUMBER[n - 1])
  }
  return arcs
}

/** A ladder of string values ("1","2","6") into function-line steps. */
function ladder(values: string[] | undefined, free: number | undefined) {
  return {
    freeValue: Math.max(0, int(free, 0)),
    steps: (values ?? []).map((v) => ({ powerCost: 1, value: int(v, 0) })),
  }
}

const DIE_BY_LETTER: Record<string, DieColor> = { R: 'red', Y: 'yellow', G: 'green', B: 'blue' }

/** "DMG 6, LEAK 3, STR 2" → the special-hit block (E7.2.5). */
function parseSpecial(text: string | undefined) {
  if (!text) return undefined
  const grab = (label: string) => {
    const m = new RegExp(`${label}\\s*\\+?\\s*(\\d+)`, 'i').exec(text)
    return m ? int(m[1]) : undefined
  }
  const damage = grab('DMG')
  if (damage === undefined) return undefined
  return { damage, leak: grab('LEAK'), structure: grab('STR') }
}

function weaponClassOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('torpedo')) return 'a-mat-torpedo'
  if (lower.includes('disruptor')) return 'disruptor'
  if (lower.includes('phaser')) return 'phaser'
  return 'custom'
}

/** Canon-roster ladders for the stats the export does not carry (3.1.1). */
function sizeClassOf(structureBoxes: number): number {
  if (structureBoxes <= 7) return 2
  if (structureBoxes <= 10) return 3
  if (structureBoxes <= 13) return 4
  if (structureBoxes <= 16) return 5
  if (structureBoxes <= 18) return 6
  return 7
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/** Convert one designer export; returns the form plus mapping warnings. */
export function designerFormToShipForm(raw: DesignerExport): DesignerImport | string {
  const warnings: string[] = []
  const identity = raw.identity ?? {}
  const className = (identity.classType || identity.name || 'Imported Design').trim()
  const fx = raw.functionsConfig ?? {}

  // --- Power system tracks → reactors, batteries, FTL boxes ---------------
  const reactors: ReactorGroupDef[] = []
  let batteries = 0
  let ftlDriveBoxes = 0
  const HIT_BY_KEY: Record<string, ReactorGroupDef['hitKind']> = {
    lMain: 'left-main',
    rMain: 'right-main',
    cMain: 'center-main',
    slReac: 'sublight-reactor',
    auxPwr: 'aux',
  }
  for (const track of raw.powerSystem?.tracks ?? []) {
    const points = Math.max(0, int(track.points, 0))
    if (track.key === 'battery') {
      batteries = points
      continue
    }
    if (track.key === 'ftlDrive') {
      ftlDriveBoxes = points
      continue
    }
    const hitKind = HIT_BY_KEY[track.key ?? '']
    if (!hitKind) {
      if (points > 0) warnings.push(`Unknown power track "${track.key}" skipped (${points} points).`)
      continue
    }
    if (points === 0) continue
    const pattern = track.boxPattern ?? []
    reactors.push({
      id: slug(track.label ?? track.key ?? 'reactor'),
      label: track.label ?? track.key ?? 'REACTOR',
      hitKind,
      points: Array.from({ length: points }, (_, i) => ({
        boxes: Math.max(1, int(pattern[i], int(track.boxesPerPoint, 1))),
      })),
    })
  }

  // --- Weapons -------------------------------------------------------------
  const weapons: WeaponSystemDef[] = []
  const weaponIds: (string | null)[] = []
  ;(raw.weapons ?? []).forEach((w, index) => {
    const line = fx.weapons?.[index]
    const named = (w.name ?? '').trim().length > 0
    const enabled = line?.enabled ?? named
    const brackets: RangeBracketDef[] = []
    for (const r of w.ranges ?? []) {
      const m = /(\d+)\s*[-–]\s*(\d+)/.exec(r.band ?? '')
      if (!m) continue
      const band = r.type === 'green' ? 'green' : r.type === 'red' ? 'red' : 'black'
      brackets.push({
        min: int(m[1]),
        max: int(m[2]),
        band,
        dice: (r.dice ?? []).map((d) => DIE_BY_LETTER[d.toUpperCase()] ?? 'yellow'),
        ...(r.bonus ? { bonus: r.bonus } : {}),
      })
    }
    if (!enabled || brackets.length === 0) {
      weaponIds.push(null)
      return
    }
    const name = named ? w.name!.trim().toUpperCase() : `WEAPON ${index + 1}`
    const id = `${slug(name)}-${index + 1}`
    const circles = Math.max(1, int(w.powerCircles, 1))
    // powerStops name the 1-based circle a slow-arming diamond sits before
    // (E4.2.8); our roundGates[i] is the gate between circle i and i + 1.
    const gates = Array.from({ length: Math.max(0, circles - 1) }, () => false)
    for (const stop of w.powerStops ?? []) {
      const g = int(stop, 0) - 2
      if (g >= 0 && g < gates.length) gates[g] = true
    }
    const mountSpecs = (w.mountArcs ?? []).filter((s) => arcsOf(s).length > 0)
    if (mountSpecs.length === 0) {
      warnings.push(`${name}: no readable mount arcs — mount given all-around coverage.`)
      mountSpecs.push('1|2|3|4|5|6|7|8')
    }
    const mounts: WeaponMountDef[] = mountSpecs.map((spec, m) => ({
      id: `${id}-m${m + 1}`,
      arcs: arcsOf(spec),
      armingCircles: circles,
      hitBoxes: Math.max(1, int(w.structure, 1)),
      ...(gates.some(Boolean) ? { roundGates: gates } : {}),
    }))
    weapons.push({
      id,
      name,
      weaponClass: weaponClassOf(name),
      mounts,
      brackets,
      ...(parseSpecial(w.special) ? { special: parseSpecial(w.special)! } : {}),
      traits: (w.traits ?? []).map(String),
    })
    weaponIds.push(id)
  })

  // --- Function lines ------------------------------------------------------
  const functions: FunctionLineDef[] = []
  functions.push({
    id: 'accel',
    label: 'ACC/DEC',
    kind: 'accel',
    ...ladder(fx.accDec?.values, fx.accDec?.free),
    sequential: true,
  })
  functions.push({
    id: 'sif',
    label: 'SIF/IDF',
    kind: 'sif',
    ...ladder(fx.sifIdf?.values, fx.sifIdf?.free),
    sequential: true,
  })
  if (fx.sifIdf?.emer) {
    functions.push({
      id: 'emer',
      label: 'EMER',
      kind: 'emergency-turn',
      freeValue: 0,
      steps: [{ powerCost: 1, value: 1 }],
      sequential: false,
    })
  }
  if ((fx.batRech?.values ?? []).length > 0 || batteries > 0) {
    functions.push({
      id: 'bat-rech',
      label: 'BAT RECH',
      kind: 'battery-recharge',
      ...ladder(fx.batRech?.values, fx.batRech?.free),
      sequential: false,
    })
  }
  const ftlCircles = Math.max(0, int(fx.ftl?.empty, 0))
  if (ftlCircles > 0) {
    functions.push({
      id: 'ftl',
      label: 'FTL DRV',
      kind: 'ftl-drive',
      freeValue: 0,
      steps: Array.from({ length: ftlCircles }, (_, i) => ({ powerCost: 1, value: i + 1 })),
      sequential: true,
    })
  }
  for (const side of ['F', 'P', 'S', 'A'] as ShieldSide[]) {
    functions.push({
      id: `rnfc-${side}`,
      label: `SHLD RNFC ${side}`,
      kind: 'shield-reinforce',
      freeValue: 0,
      steps: [{ powerCost: 1, value: 1 }],
      sequential: false,
      shieldSide: side,
    })
    functions.push({
      id: `repr-${side}`,
      label: `SHLD REPR ${side}`,
      kind: 'shield-repair',
      freeValue: 0,
      steps: [{ powerCost: 1, value: 1 }],
      sequential: false,
      shieldSide: side,
    })
  }
  functions.push({
    id: 'sensor',
    label: 'SENSOR',
    kind: 'sensor',
    ...ladder(fx.sensor?.values, fx.sensor?.free),
    sequential: true,
  })
  {
    // GEN SYS prints named levels (NRM, MAX); `free` levels come lit.
    const levels = fx.genSys?.values ?? []
    const free = Math.max(0, int(fx.genSys?.free, 0))
    functions.push({
      id: 'gensys',
      label: 'GEN SYS',
      kind: 'gen-sys',
      freeValue: Math.min(free, levels.length),
      steps: levels.slice(free).map((_, i) => ({ powerCost: 1, value: free + i + 1 })),
      sequential: true,
    })
  }
  if (fx.cloak?.enabled) {
    functions.push({
      id: 'cloak',
      label: 'CLOAK',
      kind: 'special',
      freeValue: 0,
      steps: Array.from({ length: Math.max(1, int(fx.cloak.empty, 1)) }, () => ({
        powerCost: 1,
        value: 1,
      })),
      sequential: true,
    })
  }
  ;(fx.weapons ?? []).forEach((line, index) => {
    const weaponId = weaponIds[index]
    if (!weaponId) return
    functions.push({
      id: `wpn-${index + 1}`,
      label: (line.label ?? `WPN ${index + 1}`).toUpperCase(),
      kind: 'weapon',
      ...ladder(line.values, line.free),
      sequential: true,
      weaponSystemId: weaponId,
    })
  })

  // --- Systems block --------------------------------------------------------
  const SYSTEM_BY_KEY: Record<string, { kind: SystemKind; label: string }> = {
    SENS: { kind: 'SENS', label: 'Sensors' },
    SCNC: { kind: 'SCNC', label: 'Sciences' },
    TRAC: { kind: 'TRAC', label: 'Tractor Beams' },
    TRAN: { kind: 'TRAN', label: 'Transporters' },
    SHTL: { kind: 'SHTL', label: 'Shuttle Bay' },
    HNGR: { kind: 'HNGR', label: 'Hangar Bay' },
    LNCH: { kind: 'LNCH', label: 'Launch Bay' },
    LAND: { kind: 'LNDG', label: 'Landing Bay' },
    QTRS: { kind: 'QTRS', label: 'Quarters' },
    CRGO: { kind: 'CRGO', label: 'Cargo' },
    PROB: { kind: 'PROB', label: 'Probe Launcher' },
    CMND: { kind: 'CMND', label: 'Command Systems' },
    CLOAK: { kind: 'CLOAK', label: 'Cloaking System' },
  }
  const systems: SystemGroupDef[] = []
  let scoutSensors = 0
  for (const entry of raw.systems ?? []) {
    const key = (entry.key ?? '').toUpperCase()
    const boxes = int(entry.value, 0)
    if (boxes <= 0) continue
    if (key === 'SCOUT') {
      scoutSensors = boxes
      continue
    }
    const known = SYSTEM_BY_KEY[key]
    if (known) systems.push({ kind: known.kind, label: known.label, boxes })
    else {
      warnings.push(`System "${key}" has no exact slot here — kept as a special system.`)
      systems.push({ kind: 'SPCL', label: key, boxes })
    }
  }

  // --- Structure track (counts only: repairable = black, permanent = red) ---
  const black = Math.max(0, int(raw.structure?.repairable, 0))
  const red = Math.max(0, int(raw.structure?.permanent, 0))
  const structure: StructureEntryDef[] = [
    ...Array.from({ length: black }, () => ({ kind: 'box', color: 'black' }) as const),
    ...Array.from({ length: red }, () => ({ kind: 'box', color: 'red' }) as const),
  ]
  if (structure.length === 0) return 'This design has no structure track — nothing to damage.'

  // --- Sublight: descending printed rows → per-speed template ---------------
  const sub = raw.sublight ?? {}
  const spd = sub.spd ?? []
  const turns = sub.turns ?? []
  const stops = sub.dmgStops ?? []
  const maxSpeed = Math.max(0, ...spd.map((s) => int(s, 0)))
  const turnBySpeed = Array.from({ length: maxSpeed + 1 }, (_, speed) => {
    const row = spd.findIndex((s) => int(s, -1) === speed)
    return row >= 0 ? Math.max(0, int(turns[row], 0)) : 0
  })
  // A damage stop marks one drive box; the ladder below it is the new cap.
  const dmgTopSpeed: number[] = []
  spd.forEach((_, row) => {
    if (stops[row]) dmgTopSpeed.push(Math.max(0, int(spd[row + 1], 0)))
  })
  const driveBoxes = dmgTopSpeed.length

  // --- Meta the export does not carry: canon-ladder heuristics --------------
  const sizeClass = sizeClassOf(structure.length)
  const stressRating = sizeClass <= 4 ? Math.max(1, sizeClass) : sizeClass - 1
  const damageControlRating = Math.ceil((sizeClass + 1) / 2)
  warnings.push(
    `Size class ${sizeClass}, stress ${stressRating} and DC rating ${damageControlRating} were derived from the structure track (the export does not carry them) — correct them in the builder if the printed form disagrees.`,
  )

  const shields = raw.shields ?? {}
  const armor = raw.armor ?? {}
  const gen = raw.shieldGen ?? {}
  const era = (identity.era ?? '').trim()
  const shipName = (identity.name ?? '').trim()

  const form: ShipForm = {
    id: `designer-${slug(className)}`,
    name: className,
    faction: (identity.faction ?? 'CUSTOM').trim() || 'CUSTOM',
    sizeClass,
    stressRating,
    damageControlRating,
    reactors,
    batteries,
    ftlDriveBoxes,
    functions,
    weapons,
    shields: {
      generatorBoxes: Math.max(0, int(gen.count, 0)),
      blue: {
        F: Math.max(0, int(shields.forward, 0)),
        A: Math.max(0, int(shields.aft, 0)),
        P: Math.max(0, int(shields.port, 0)),
        S: Math.max(0, int(shields.starboard, 0)),
      },
      // VERIFY: the SHLD GEN "value" reads as the reinforcement boxes a side.
      green: {
        F: Math.max(0, int(gen.value, 0)),
        A: Math.max(0, int(gen.value, 0)),
        P: Math.max(0, int(gen.value, 0)),
        S: Math.max(0, int(gen.value, 0)),
      },
    },
    armor: {
      F: Math.max(0, int(armor.forward, 0)),
      A: Math.max(0, int(armor.aft, 0)),
      P: Math.max(0, int(armor.port, 0)),
      S: Math.max(0, int(armor.starboard, 0)),
    },
    systems,
    structure,
    sublight: {
      maxSpeed,
      turnBySpeed,
      maxAccelPerPhase: Math.max(1, int(sub.maxAccPhs, 1)),
      safeAccelPerRound: Math.max(0, int(sub.greenCircles, 0)),
      stressAccelPerRound: Math.max(0, int(sub.redCircles, 0)),
      driveBoxes,
      dmgTopSpeed,
    },
    marineSquads: Math.max(0, int(raw.crew?.marinesStationed, 0)),
    shuttles: Math.max(0, int(raw.crew?.shuttleCraft, 0)),
    pointValue: Math.max(0, int(identity.pointValue, 0)),
    provisional: true,
    notes: [
      'Imported from the StarForce Commander Ship Designer.',
      shipName && shipName !== className ? `Exported as "${shipName}".` : '',
      era ? `Era: ${era}.` : '',
      ...warnings,
    ]
      .filter(Boolean)
      .join(' '),
    ...(raw.shipArtDataUrl ? { art: raw.shipArtDataUrl } : {}),
  }
  if (scoutSensors > 0) {
    form.scoutSensor = {
      sensors: scoutSensors,
      damageBoxes: scoutSensors,
      targetingRange: 21,
      jammingRange: scoutSensors >= 4 ? 9 : 6,
      scanRange: 21,
    }
    functions.push({
      id: 'scout-sen',
      label: 'SCOUT SEN',
      kind: 'special',
      freeValue: 0,
      steps: Array.from({ length: scoutSensors }, (_, i) => ({ powerCost: 1, value: i + 1 })),
      sequential: true,
    })
    warnings.push('Scout sensor ranges defaulted to canon-typical values (21/6–9/21).')
  }
  return { form, warnings }
}
