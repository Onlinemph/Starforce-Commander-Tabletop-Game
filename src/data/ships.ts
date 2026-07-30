import type { FunctionLineDef, ShipForm, StructureEntryDef, WeaponSystemDef } from '../engine/types'

/**
 * Ship forms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVISIONAL DATA — REPLACE WITH THE CANON SHIP BOOK
 * ─────────────────────────────────────────────────────────────────────────────
 * The stats below are reconstructed from the worked examples scattered through
 * the v2.6 rulebook — the Yorktown-class heavy cruiser's power total (B2.2.1),
 * sensor rating (H2.2.3), damage control track (B3.1.2), turn rates (C2.2.2),
 * sublight damage table (E8.5.4), phaser and torpedo arming (E4.1, E4.2.8), and
 * the Type-51 Gravitic Disruptor firing chart (E3.2.1) — plus reasonable
 * interpolation for everything the rulebook does not print. The actual stats
 * live in Ship Book 1.
 *
 * Every ship is `provisional: true` so the UI can flag it. Importing the real
 * Ship Book means writing new `ShipForm` objects here; no engine change needed.
 */

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/** A sequential line whose circles each cost one power, e.g. ACC/DEC. */
function seqLine(
  id: string,
  label: string,
  kind: FunctionLineDef['kind'],
  freeValue: number,
  values: number[],
  extra: Partial<FunctionLineDef> = {},
): FunctionLineDef {
  return {
    id,
    label,
    kind,
    freeValue,
    steps: values.map((value) => ({ powerCost: 1, value })),
    sequential: true,
    ...extra,
  }
}

/** A line whose circles may be filled in any order, e.g. shields, GEN SYS. */
function freeOrderLine(
  id: string,
  label: string,
  kind: FunctionLineDef['kind'],
  circles: number,
  extra: Partial<FunctionLineDef> = {},
): FunctionLineDef {
  return {
    id,
    label,
    kind,
    freeValue: 0,
    steps: Array.from({ length: circles }, (_, i) => ({ powerCost: 1, value: i + 1 })),
    sequential: false,
    ...extra,
  }
}

function shieldLines(prefix: 'rnfc' | 'repr'): FunctionLineDef[] {
  const kind = prefix === 'rnfc' ? 'shield-reinforce' : 'shield-repair'
  const label = prefix === 'rnfc' ? 'SHLD RNFC' : 'SHLD REPR'
  return (['F', 'P', 'S', 'A'] as const).map((side) => ({
    id: `${prefix}-${side}`,
    label: `${label} ${side}`,
    kind,
    freeValue: 0,
    steps: [{ powerCost: 1, value: 1 }],
    sequential: false,
    shieldSide: side,
  }))
}

/** Structural Integrity track: boxes interleaved with DC rating markers (B1.8). */
function structureTrack(segments: Array<{ black?: number; red?: number; then?: number }>): StructureEntryDef[] {
  const track: StructureEntryDef[] = []
  for (const segment of segments) {
    for (let i = 0; i < (segment.black ?? 0); i++) track.push({ kind: 'box', color: 'black' })
    for (let i = 0; i < (segment.red ?? 0); i++) track.push({ kind: 'box', color: 'red' })
    if (segment.then !== undefined) track.push({ kind: 'dc', rating: segment.then })
  }
  return track
}

// ---------------------------------------------------------------------------
// U.F.S. Yorktown-class Heavy Cruiser
// ---------------------------------------------------------------------------

/**
 * LNC-447 Phaser. Four mounts, two arming circles each (E4.2 Arming Example 2).
 * "At range 8 you roll one green and one blue die" (E6.2 Step 7).
 */
const LNC_447_PHASER: WeaponSystemDef = {
  id: 'lnc-447',
  name: 'LNC-447 Phaser',
  weaponClass: 'phaser',
  traits: ['PD MODE', 'PREC 1'],
  mounts: [
    { id: 'ph-f', arcs: ['FP', 'FS', 'PF', 'SF'], armingCircles: 2, hitBoxes: 1 },
    { id: 'ph-s', arcs: ['FS', 'SF', 'SA'], armingCircles: 2, hitBoxes: 1 },
    { id: 'ph-p', arcs: ['FP', 'PF', 'PA'], armingCircles: 2, hitBoxes: 1 },
    { id: 'ph-a', arcs: ['AP', 'AS', 'PA', 'SA'], armingCircles: 2, hitBoxes: 1 },
  ],
  brackets: [
    { min: 0, max: 2, band: 'green', dice: ['yellow', 'green'] },
    { min: 3, max: 5, band: 'green', dice: ['green', 'blue'] },
    { min: 6, max: 8, band: 'black', dice: ['green', 'blue'] },
    { min: 9, max: 11, band: 'black', dice: ['blue', 'blue'] },
    { min: 12, max: 15, band: 'red', dice: ['blue'] },
  ],
}

/**
 * Mk-4 A/MAT Torpedo. Slow-arming: two circles with a diamond between them, so
 * two full rounds to arm (E4.2.8, Arming Example 4). An `S` result causes a
 * heavy hit plus one structure hit on penetration (F4.2).
 */
const MK4_TORPEDO: WeaponSystemDef = {
  id: 'mk4-torp',
  name: 'Mk-4 A/MAT Torpedo',
  weaponClass: 'a-mat-torpedo',
  traits: ['NoBAT', 'FTL'],
  special: { damage: 4, leak: 1, structure: 1 },
  mounts: [
    { id: 'tp-1', arcs: ['FP', 'FS'], armingCircles: 2, hitBoxes: 1, roundGates: [true] },
    { id: 'tp-2', arcs: ['FP', 'FS'], armingCircles: 2, hitBoxes: 1, roundGates: [true] },
    { id: 'tp-3', arcs: ['FP', 'FS', 'PF'], armingCircles: 2, hitBoxes: 1, roundGates: [true] },
    { id: 'tp-4', arcs: ['FP', 'FS', 'SF'], armingCircles: 2, hitBoxes: 1, roundGates: [true] },
  ],
  brackets: [
    { min: 0, max: 4, band: 'green', dice: ['red'], bonus: 1 },
    { min: 5, max: 10, band: 'black', dice: ['red'] },
    { min: 11, max: 16, band: 'black', dice: ['yellow'] },
    { min: 17, max: 20, band: 'red', dice: ['green'] },
  ],
}

export const YORKTOWN: ShipForm = {
  id: 'ufs-yorktown-ca',
  name: 'Yorktown-class Heavy Cruiser',
  faction: 'Union of Federated Systems',
  sizeClass: 5,
  stressRating: 4,
  damageControlRating: 4,
  provisional: true,
  notes:
    'Reconstructed from rulebook examples: TOTAL POWER 8+1 (B2.2.1), sensor rating 3 (H2.2.3), ' +
    'DC track 4/3/2/1 (B3.1.2), turn rates at speeds 2/3/5/6 (C2.2.2), sublight damage table (E8.5.4).',

  // TOTAL POWER 8+1 (B2.2.1 worked example).
  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }] },
    { id: 'aux', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 1 }] },
  ],
  batteries: 1,
  ftlDriveBoxes: 2,

  functions: [
    // Free acceleration point, then 2/3/4 (B2.2.2 worked example).
    seqLine('accel', 'ACC/DEC', 'accel', 1, [2, 3, 4]),
    seqLine('sif', 'SIF', 'sif', 0, [1, 2, 3]),
    freeOrderLine('emer', 'EMER', 'emergency-turn', 1),
    // 1 free arming point, then 4/6/8 (E4.1 Arming Example 1).
    seqLine('f-lnc447', 'LNC-447 PH', 'weapon', 1, [4, 6, 8], { weaponSystemId: 'lnc-447' }),
    seqLine('f-mk4', 'Mk-4 TORP', 'weapon', 0, [2, 4], { weaponSystemId: 'mk4-torp' }),
    ...shieldLines('rnfc'),
    ...shieldLines('repr'),
    // 2 free sensor points, then 4/6 (H2.2.1 worked example).
    seqLine('sensor', 'SENSOR', 'sensor', 2, [4, 6]),
    // Free power covers NRM; one circle reaches MAX (J1.1.1).
    seqLine('gensys', 'GEN SYS', 'gen-sys', 1, [2]),
    freeOrderLine('bat-rech', 'BTY RECH', 'battery-recharge', 1),
    seqLine('ftl', 'FTL DRV', 'ftl-drive', 0, [1, 2, 3]),
  ],

  weapons: [LNC_447_PHASER, MK4_TORPEDO],

  shields: {
    // 16 forward shield boxes with 3 green above them (G1.3.2 worked example).
    generatorBoxes: 3,
    blue: { F: 16, P: 12, S: 12, A: 10 },
    green: { F: 3, P: 3, S: 3, A: 3 },
  },
  armor: { F: 0, P: 0, S: 0, A: 0 },

  systems: [
    { kind: 'SENS', label: 'Sensors', boxes: 3 },
    { kind: 'SCNC', label: 'Sciences', boxes: 4 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 2 },
    { kind: 'TRAN', label: 'Transporters', boxes: 2 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 1 },
    { kind: 'QTRS', label: 'Quarters', boxes: 6 },
  ],

  // 4 hits at DC 4, then DC 3, then DC 2 at 8 hits (B3.1.2 worked example).
  structure: structureTrack([
    { black: 3, red: 1, then: 3 },
    { black: 2, red: 2, then: 2 },
    { red: 2, then: 1 },
  ]),

  sublight: {
    maxSpeed: 6,
    // Speed 2 → 35°, speed 3 → 30°, speed 5 → 20°, speed 6 → no turn (C2.2.2).
    turnBySpeed: [60, 45, 35, 30, 25, 20, 0],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 6,
    // Three hits leave a top speed of 2, four leave 1 (E8.5.4).
    dmgTopSpeed: [5, 4, 2, 1, 1, 0],
  },

  marineSquads: 4,
  shuttles: 2,
  pointValue: 14,
  year: 2251,
  availability: 'uncommon',
}

// ---------------------------------------------------------------------------
// Vallari Imperium cruiser
// ---------------------------------------------------------------------------

/**
 * Type-51 Gravitic Disruptor — firing chart transcribed directly from the
 * worked example in E3.2.1: yellow at 0-2, green at 3-5 and 6-8, blue at 9-11
 * and 12-13 (extreme). Six mounts, one arming circle, one damage box each.
 */
const TYPE_51_DISRUPTOR: WeaponSystemDef = {
  id: 'type-51',
  name: 'Type-51 Gravitic Disruptor',
  weaponClass: 'disruptor',
  traits: ['PD MODE', 'ATMO', 'PREC 0'],
  mounts: [
    { id: 'ds-1', arcs: ['FP', 'FS'], armingCircles: 1, hitBoxes: 1 },
    { id: 'ds-2', arcs: ['FP', 'FS'], armingCircles: 1, hitBoxes: 1 },
    { id: 'ds-3', arcs: ['FS', 'SF', 'SA'], armingCircles: 1, hitBoxes: 1 },
    { id: 'ds-4', arcs: ['FP', 'PF', 'PA'], armingCircles: 1, hitBoxes: 1 },
    { id: 'ds-5', arcs: ['AP', 'AS'], armingCircles: 1, hitBoxes: 1 },
    { id: 'ds-6', arcs: ['SA', 'AS', 'AP', 'PA'], armingCircles: 1, hitBoxes: 1 },
  ],
  brackets: [
    { min: 0, max: 2, band: 'green', dice: ['yellow'] },
    { min: 3, max: 5, band: 'green', dice: ['green'] },
    { min: 6, max: 8, band: 'black', dice: ['green'] },
    { min: 9, max: 11, band: 'black', dice: ['blue'] },
    { min: 12, max: 13, band: 'red', dice: ['blue'] },
  ],
}

/** A heavy gravitic lance giving the Vallari a red-die punch at close range. */
const GL_9_LANCE: WeaponSystemDef = {
  id: 'gl-9',
  name: 'GL-9 Gravitic Lance',
  weaponClass: 'disruptor',
  traits: ['NoBAT', 'ATMO'],
  special: { damage: 4, structure: 1 },
  mounts: [
    { id: 'gl-1', arcs: ['FP', 'FS'], armingCircles: 2, hitBoxes: 2, roundGates: [true] },
    { id: 'gl-2', arcs: ['FP', 'FS'], armingCircles: 2, hitBoxes: 2, roundGates: [true] },
  ],
  brackets: [
    { min: 0, max: 3, band: 'green', dice: ['red'], bonus: 1 },
    { min: 4, max: 9, band: 'black', dice: ['red'] },
    { min: 10, max: 14, band: 'black', dice: ['yellow'] },
    { min: 15, max: 18, band: 'red', dice: ['green'] },
  ],
}

export const VALLARI_CRUISER: ShipForm = {
  id: 'vallari-karnath-ca',
  name: 'Karnath-class Cruiser',
  faction: 'Vallari Imperium',
  sizeClass: 5,
  stressRating: 3,
  damageControlRating: 3,
  provisional: true,
  notes:
    'Reconstructed. The Type-51 Gravitic Disruptor firing chart is transcribed from the worked ' +
    'example in E3.2.1; everything else is interpolated to give the Yorktown a balanced opponent.',

  reactors: [
    { id: 'c-main', label: 'C MAIN', hitKind: 'center-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }, { boxes: 2 }] },
    { id: 'aux', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 1 }, { boxes: 1 }] },
  ],
  batteries: 2,
  ftlDriveBoxes: 2,

  functions: [
    seqLine('accel', 'ACC/DEC', 'accel', 1, [2, 3, 4, 5]),
    seqLine('sif', 'SIF', 'sif', 1, [2, 3]),
    freeOrderLine('emer', 'EMER', 'emergency-turn', 1),
    seqLine('f-type51', 'TYPE-51 DISR', 'weapon', 2, [4, 6], { weaponSystemId: 'type-51' }),
    seqLine('f-gl9', 'GL-9 LANCE', 'weapon', 0, [1, 2], { weaponSystemId: 'gl-9' }),
    ...shieldLines('rnfc'),
    ...shieldLines('repr'),
    seqLine('sensor', 'SENSOR', 'sensor', 1, [3, 5]),
    seqLine('gensys', 'GEN SYS', 'gen-sys', 1, [2]),
    freeOrderLine('bat-rech', 'BTY RECH', 'battery-recharge', 2),
    seqLine('ftl', 'FTL DRV', 'ftl-drive', 0, [1, 2, 3]),
  ],

  weapons: [TYPE_51_DISRUPTOR, GL_9_LANCE],

  shields: {
    generatorBoxes: 2,
    blue: { F: 14, P: 11, S: 11, A: 9 },
    green: { F: 2, P: 2, S: 2, A: 2 },
  },
  // Vallari hulls carry armor plate as well as shields (G2).
  armor: { F: 3, P: 2, S: 2, A: 2 },

  systems: [
    { kind: 'SENS', label: 'Sensors', boxes: 2 },
    { kind: 'SCNC', label: 'Sciences', boxes: 2 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 2 },
    { kind: 'TRAN', label: 'Transporters', boxes: 1 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 1 },
    { kind: 'QTRS', label: 'Quarters', boxes: 5 },
  ],

  structure: structureTrack([
    { black: 2, red: 2, then: 2 },
    { black: 2, red: 3, then: 1 },
    { red: 2 },
  ]),

  sublight: {
    maxSpeed: 7,
    turnBySpeed: [60, 45, 40, 35, 30, 25, 20, 0],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 3,
    stressAccelPerRound: 2,
    driveBoxes: 6,
    dmgTopSpeed: [6, 5, 3, 2, 1, 0],
  },

  marineSquads: 6,
  shuttles: 1,
  pointValue: 14,
  year: 2248,
  availability: 'common',
}

export const SHIP_FORMS: ShipForm[] = [YORKTOWN, VALLARI_CRUISER]

export function shipFormById(id: string): ShipForm | undefined {
  return SHIP_FORMS.find((f) => f.id === id)
}
