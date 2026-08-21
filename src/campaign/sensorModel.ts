/**
 * The designer's sensor model (Border Command briefing, August 2026).
 *
 * Implements the detection / intelligence / track-retention / reacquisition /
 * false-contact mathematics from the spreadsheet briefing, faithfully and
 * separately — five checks, never substituted for one another (§1, §13). The
 * calibration anchor is his own worked table: a passive YORKTOWN II searching
 * for a V-7D reads 90 / 70 / 50 / 30 / 10 / 3.5 / 1.225 % per scan at ranges
 * 0–6, and the approach sequence 4,3,3,2,2,1,1,0 compounds to 99.90% by the
 * cumulative rule 1 − Π(1 − pᵢ) (§3). Every other matchup scales off that
 * anchor by the briefing's stated factors.
 *
 * Two kinds of coefficient live in SENSOR_MODEL, and the distinction matters:
 *  - EXACT — a formula the briefing states in full (scout/command bonuses,
 *    power and size multipliers, the civilian ×3, the damage points, active
 *    sensor multipliers, retention/reacquisition, false-contact rates).
 *  - PROVISIONAL — behavior the briefing describes but whose exact numbers
 *    live in workbook cells that did not arrive (the file received carried
 *    only a SHIP DATA header): the two speed curves (B58/B94), the
 *    intelligence base curve (B96), terrain, cloak, formation. Shapes follow
 *    the briefing's prose ("gentle 0–3, moderate 4–6, severe 7+"); the
 *    numbers are stand-ins awaiting the real Sensor Model sheet.
 *
 * All of it is data (§16): a scenario overrides any coefficient through
 * `tuning.sensorModel`, and no probability is computed from anything but the
 * config plus the two actors — deterministic, seedable, loggable.
 */

import { shipFormById } from '../data/ships'
import { operationalStats } from './stats'
import type { Formation } from './types'

// ---------------------------------------------------------------------------
// Actors — the briefing's §2 variable lists, in one shape for either role
// ---------------------------------------------------------------------------

export interface SensorActor {
  /** SENS value at the current power setting (the SP0/SP1/SP2 ladder). */
  sensorValue: number
  /** Scout Sensors rating 0–5 (§7). */
  scoutSensors: number
  /** CMND box count (§7) — counts only when scoutSensors is 0. */
  command: number
  /** SNCS boxes — intelligence quality (§12). */
  sciences: number
  /** TOTAL ACTUAL POWER from the costing model (§8). */
  actualPower: number
  sizeClass: number
  /** Hexes per campaign round. May exceed 10 (§4). */
  speed: number
  /** Active sensor mode (§5, §6) — a dial separate from the power setting. */
  active: boolean
  cloaked: boolean
  unitType: 'military' | 'civilian'
  /** Structure damage on the briefing's 0–100 points scale (§11). */
  damage: number
  formation: Formation
  shipCount: number
  /** Terrain level occupied: 0 clear, 1 system, 2 nebula (orders doc). */
  terrain: number
}

export interface ScanGeometry {
  range: number
  /** Summed terrain levels of hexes between the two ships (§15). */
  interveningTerrain: number
}

// ---------------------------------------------------------------------------
// Coefficients (§16: one configurable structure)
// ---------------------------------------------------------------------------

/** A piecewise speed curve: index = speed, last entry decays by `beyondStep`. */
export interface SpeedCurve {
  values: readonly number[]
  /** Multiplier (searcher) or increment (target) per speed point past the table. */
  beyondStep: number
}

export interface SensorModelConfig {
  /** EXACT (§3): per-scan detection by range for the calibration pair. */
  detectionRangeCurve: readonly number[]
  /** EXACT (§3): each hex past the curve multiplies by this (10→3.5→1.225%). */
  beyondCurveFalloff: number
  /** PROVISIONAL (B96 missing): intelligence base by range. */
  intelRangeCurve: readonly number[]
  /** EXACT (§12): intelligence ×2 inside this range, capped at 100%. */
  intelCloseRange: number
  intelCloseMultiplier: number
  /** PROVISIONAL (B58): searcher speed → detection multiplier. */
  searcherSpeedDetection: SpeedCurve
  /** PROVISIONAL (B94): searcher speed → intelligence multiplier (steeper). */
  searcherSpeedIntel: SpeedCurve
  /** EXACT (§4): at searcher speed ≥ this and range > 1, extra reductions. */
  highSpeedThreshold: number
  highSpeedDetectionFactor: number
  highSpeedIntelFactor: number
  /** PROVISIONAL (B59/B95): target signature-speed → multiplier. */
  targetSpeedSignature: SpeedCurve
  /** EXACT (§5): active target reads +7 signature speed — additive. */
  targetActiveSpeedBonus: number
  /** EXACT (§6): searcher active multipliers inside range 2. */
  searcherActiveCloseRange: number
  searcherActiveDetection: number
  searcherActiveIntel: number
  /** PROVISIONAL (§6): the "smaller bonuses" at ranges 3–6. */
  searcherActiveLongDetection: number
  searcherActiveLongIntel: number
  /** EXACT (§7): per-point conditional bonuses. */
  scoutDetectionPerPoint: number
  scoutIntelPerPoint: number
  commandDetectionPerPoint: number
  commandIntelPerPoint: number
  /** PROVISIONAL: linear sensor-value scaling around this reference. */
  referenceSensorValue: number
  /** PROVISIONAL (§7): "very small" target-sensor difficulty, per point. */
  targetSensorPenaltyPerPoint: number
  targetSensorPenaltyFloor: number
  /** EXACT (§8): max(floor, base + slope × power / powerRef). */
  powerFloor: number
  powerBase: number
  powerSlope: number
  powerReference: number
  /** EXACT (§9): max(floor, 1 + slope × (sizeClass − pivot)). */
  sizeFloor: number
  sizeSlope: number
  sizePivot: number
  /** EXACT (§10): civilian targets, applied to the final probability. */
  civilianMultiplier: number
  /** EXACT (§11): +points × INT(damage / step), additive, within range 6. */
  damageBonusPerStep: number
  damageStep: number
  damageMaxRange: number
  /** PROVISIONAL (§12): intelligence bonus per SNCS box. */
  sciencesIntelPerPoint: number
  /** PROVISIONAL (§15): multipliers by terrain level [clear, system, nebula]. */
  targetTerrain: readonly number[]
  searcherTerrain: readonly number[]
  /** PROVISIONAL (§15): per summed intervening terrain level. */
  interveningTerrainStep: number
  /** PROVISIONAL (§15): substantial, never zero. */
  cloakDetection: number
  cloakIntel: number
  /** PROVISIONAL (orders doc): formation effects, both roles. */
  searcherFormationClose: number
  searcherFormationWide: number
  targetFormationClose: number
  targetFormationWide: number
  /** PROVISIONAL: more hulls are louder, per ship past the first. */
  shipCountStep: number
  /** EXACT (§13): retention. */
  retentionBase: number
  retentionCloserBonus: number
  retentionFartherPerHex: number
  retentionIntelWeight: number
  retentionMin: number
  retentionMax: number
  /** EXACT (§13): reacquisition. */
  reacquisitionBase: number
  reacquisitionFreshBonus: number
  reacquisitionIntelWeight: number
  reacquisitionMin: number
  reacquisitionMax: number
  /** EXACT (§14): false contacts per scan. */
  falseContactPassive: number
  falseContactActive: number
  /**
   * PROVISIONAL: beyond this range no retention or reacquisition roll
   * happens at all — a held track goes cold, a lost one stays lost. The
   * briefing's retention formula presumes tracking ranges ("mostly 0–6");
   * without a horizon its 5% floor would hold tracks on targets half a map
   * away, forever, five percent at a time.
   */
  trackingMaxRange: number
  /** Calibration pair — the normalizer pins this matchup to the range curve. */
  calibrationSearcher: string
  calibrationTarget: string
  /**
   * Playtest/debug dial (§16's logging spirit): flat probabilities that
   * replace the computed ones. Detection and intelligence overrides apply
   * within range `damageMaxRange` and read 0 beyond it — "certain within
   * sensor reach" — which is also what deterministic integration tests pin.
   */
  override?: {
    detection?: number
    intelligence?: number
    retention?: number
    reacquisition?: number
  }
}

export const SENSOR_MODEL: SensorModelConfig = {
  detectionRangeCurve: [0.9, 0.7, 0.5, 0.3, 0.1],
  beyondCurveFalloff: 0.35,
  intelRangeCurve: [0.5, 0.4, 0.28, 0.17, 0.06],
  intelCloseRange: 1,
  intelCloseMultiplier: 2,
  searcherSpeedDetection: {
    values: [1, 0.98, 0.96, 0.93, 0.87, 0.8, 0.72, 0.6, 0.48, 0.36, 0.25],
    beyondStep: 0.9,
  },
  searcherSpeedIntel: {
    values: [1, 0.96, 0.92, 0.87, 0.78, 0.68, 0.58, 0.45, 0.33, 0.22, 0.15],
    beyondStep: 0.85,
  },
  highSpeedThreshold: 10,
  highSpeedDetectionFactor: 0.1,
  highSpeedIntelFactor: 0.05,
  targetSpeedSignature: {
    values: [1, 1.03, 1.06, 1.1, 1.18, 1.26, 1.35, 1.5, 1.65, 1.8, 1.95],
    beyondStep: 0.15,
  },
  targetActiveSpeedBonus: 7,
  searcherActiveCloseRange: 2,
  searcherActiveDetection: 2,
  searcherActiveIntel: 1.5,
  searcherActiveLongDetection: 1.15,
  searcherActiveLongIntel: 1.1,
  scoutDetectionPerPoint: 0.25,
  scoutIntelPerPoint: 0.2,
  commandDetectionPerPoint: 0.05,
  commandIntelPerPoint: 0.15,
  referenceSensorValue: 6,
  targetSensorPenaltyPerPoint: 0.005,
  targetSensorPenaltyFloor: 0.9,
  powerFloor: 0.5,
  powerBase: 0.75,
  powerSlope: 0.25,
  powerReference: 85,
  sizeFloor: 0.1,
  sizeSlope: 0.15,
  sizePivot: 4,
  civilianMultiplier: 3,
  damageBonusPerStep: 0.05,
  damageStep: 20,
  damageMaxRange: 6,
  sciencesIntelPerPoint: 0.1,
  targetTerrain: [1, 0.6, 0.35],
  searcherTerrain: [1, 0.85, 0.6],
  interveningTerrainStep: 0.8,
  cloakDetection: 0.12,
  cloakIntel: 0.12,
  searcherFormationClose: 0.8,
  searcherFormationWide: 1.25,
  targetFormationClose: 0.85,
  targetFormationWide: 1.15,
  shipCountStep: 0.05,
  retentionBase: 0.85,
  retentionCloserBonus: 0.1,
  retentionFartherPerHex: 0.1,
  retentionIntelWeight: 0.1,
  retentionMin: 0.05,
  retentionMax: 0.99,
  reacquisitionBase: 0.5,
  reacquisitionFreshBonus: 0.1,
  reacquisitionIntelWeight: 0.2,
  reacquisitionMin: 0.05,
  reacquisitionMax: 0.95,
  falseContactPassive: 0.005,
  falseContactActive: 0.001,
  trackingMaxRange: 8,
  calibrationSearcher: 'union-yorktown-ii-class-heavy-cruiser',
  calibrationTarget: 'vallari-v-7d-raider-class-battlecruiser',
}

/** A scenario's overrides merged over the defaults (tuning.sensorModel). */
export function resolveSensorModel(overrides?: Record<string, unknown>): SensorModelConfig {
  if (!overrides) return SENSOR_MODEL
  return { ...SENSOR_MODEL, ...overrides } as SensorModelConfig
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** The range curve with its beyond-the-table falloff (§3). */
function rangeBase(curve: readonly number[], falloff: number, range: number): number {
  const r = Math.max(0, Math.round(range))
  if (r < curve.length) return curve[r]
  return curve[curve.length - 1] * falloff ** (r - (curve.length - 1))
}

/** Searcher speed curves multiply; the tail decays by beyondStep per point. */
function searcherSpeedFactor(curve: SpeedCurve, speed: number): number {
  const s = Math.max(0, Math.round(speed))
  if (s < curve.values.length) return curve.values[s]
  const last = curve.values[curve.values.length - 1]
  return Math.max(0.01, last * curve.beyondStep ** (s - (curve.values.length - 1)))
}

/** Target signature speed grows; the tail adds beyondStep per point (§5). */
function targetSpeedFactor(curve: SpeedCurve, speed: number): number {
  const s = Math.max(0, Math.round(speed))
  if (s < curve.values.length) return curve.values[s]
  const last = curve.values[curve.values.length - 1]
  return last + curve.beyondStep * (s - (curve.values.length - 1))
}

/** §7: scout points, or command points only when there is no scout block. */
function scoutCommandFactor(actor: SensorActor, scoutPer: number, commandPer: number): number {
  if (actor.scoutSensors > 0) return 1 + scoutPer * actor.scoutSensors
  return 1 + commandPer * actor.command
}

function terrainLevel(levels: readonly number[], level: number): number {
  return levels[Math.max(0, Math.min(levels.length - 1, Math.round(level)))]
}

// ---------------------------------------------------------------------------
// Calibration (§3): the anchor pair reads the range table exactly
// ---------------------------------------------------------------------------

/** An actor from a ship form, at a stated posture — also the test fixture. */
export function actorFromForm(
  formId: string,
  opts: Partial<Omit<SensorActor, 'sensorValue'>> & { sensorPower?: 0 | 1 | 2 } = {},
): SensorActor {
  const form = shipFormById(formId)
  if (!form) throw new Error(`No such form: ${formId}`)
  const stats = operationalStats(form)
  const power = opts.sensorPower ?? 1
  return {
    // Raw values: the model applies its own scout and command bonuses (§7),
    // so the folded ratings would count them twice.
    sensorValue: stats.sensorValues[power],
    scoutSensors: opts.scoutSensors ?? stats.scoutSensors,
    command: opts.command ?? stats.commandBoxes,
    sciences: opts.sciences ?? stats.sciencesRaw,
    actualPower: opts.actualPower ?? stats.actualPower,
    sizeClass: opts.sizeClass ?? stats.sizeClass,
    speed: opts.speed ?? 0,
    active: opts.active ?? false,
    cloaked: opts.cloaked ?? false,
    unitType: opts.unitType ?? 'military',
    damage: opts.damage ?? 0,
    formation: opts.formation ?? 'standard',
    shipCount: opts.shipCount ?? 1,
    terrain: opts.terrain ?? 0,
  }
}

/**
 * The one number standing in for the missing workbook's base capability
 * constant: whatever the factor product comes to for the calibrated passive
 * Yorktown II vs V-7D pair (both at speed 0, clear space), divide it out —
 * so that pair reads the §3 range table exactly, and everything else scales
 * relative to it by the briefing's own factors.
 */
const normalizers = new WeakMap<SensorModelConfig, { detection: number; intel: number }>()

function calibration(cfg: SensorModelConfig): { detection: number; intel: number } {
  let cached = normalizers.get(cfg)
  if (cached) return cached
  const searcher = actorFromForm(cfg.calibrationSearcher)
  const target = actorFromForm(cfg.calibrationTarget)
  const geom: ScanGeometry = { range: 3, interveningTerrain: 0 }
  cached = {
    detection: 1 / rawDetectionFactors(searcher, target, geom, cfg),
    intel: 1 / rawIntelFactors(searcher, target, geom, cfg),
  }
  normalizers.set(cfg, cached)
  return cached
}

// ---------------------------------------------------------------------------
// Detection (§3–§11)
// ---------------------------------------------------------------------------

export interface SensorReading {
  p: number
  /** Every factor and its value, for the briefing's §16 logging requirement. */
  factors: Record<string, number>
}

/** The non-range factor product — normalized against the calibration pair. */
function rawDetectionFactors(
  searcher: SensorActor,
  target: SensorActor,
  geom: ScanGeometry,
  cfg: SensorModelConfig,
): number {
  let f = 1
  f *= searcher.sensorValue / cfg.referenceSensorValue
  f *= scoutCommandFactor(searcher, cfg.scoutDetectionPerPoint, cfg.commandDetectionPerPoint)
  f *= searcherSpeedFactor(cfg.searcherSpeedDetection, searcher.speed)
  f *= terrainLevel(cfg.searcherTerrain, searcher.terrain)
  if (searcher.formation === 'close') f *= cfg.searcherFormationClose
  if (searcher.formation === 'wide') f *= cfg.searcherFormationWide
  if (searcher.cloaked) f *= cfg.cloakDetection // scanning from under a cloak is muffled too

  const signatureSpeed = target.speed + (target.active ? cfg.targetActiveSpeedBonus : 0)
  f *= targetSpeedFactor(cfg.targetSpeedSignature, signatureSpeed)
  f *= Math.max(cfg.powerFloor, cfg.powerBase + (cfg.powerSlope * target.actualPower) / cfg.powerReference)
  f *= Math.max(cfg.sizeFloor, 1 + cfg.sizeSlope * (target.sizeClass - cfg.sizePivot))
  f *= Math.max(
    cfg.targetSensorPenaltyFloor,
    1 - cfg.targetSensorPenaltyPerPoint * target.sensorValue,
  )
  f *= terrainLevel(cfg.targetTerrain, target.terrain)
  f *= cfg.interveningTerrainStep ** Math.max(0, geom.interveningTerrain)
  if (target.cloaked) f *= cfg.cloakDetection
  if (target.formation === 'close') f *= cfg.targetFormationClose
  if (target.formation === 'wide') f *= cfg.targetFormationWide
  f *= 1 + cfg.shipCountStep * Math.max(0, target.shipCount - 1)
  return f
}

/** Per-scan detection probability (§3), factors logged. */
export function detectionProbability(
  searcher: SensorActor,
  target: SensorActor,
  geom: ScanGeometry,
  cfg: SensorModelConfig = SENSOR_MODEL,
): SensorReading {
  const flat = cfg.override?.detection
  if (flat !== undefined) {
    const p = geom.range <= cfg.damageMaxRange ? clamp01(flat) : 0
    return { p, factors: { override: p } }
  }
  const base = rangeBase(cfg.detectionRangeCurve, cfg.beyondCurveFalloff, geom.range)
  let p = base * rawDetectionFactors(searcher, target, geom, cfg) * calibration(cfg).detection

  const factors: Record<string, number> = { base }
  // §6: active sensors double detection inside range 2, smaller bonus beyond.
  if (searcher.active) {
    const bonus =
      geom.range <= cfg.searcherActiveCloseRange
        ? cfg.searcherActiveDetection
        : cfg.searcherActiveLongDetection
    p *= bonus
    factors.searcherActive = bonus
  }
  // §4: a searcher tearing along at 10+ hears almost nothing past range 1.
  if (searcher.speed >= cfg.highSpeedThreshold && geom.range > 1) {
    p *= cfg.highSpeedDetectionFactor
    factors.highSpeed = cfg.highSpeedDetectionFactor
  }
  // §11: damage points are additive percentage points, inside range 6.
  if (geom.range <= cfg.damageMaxRange) {
    const bonus = cfg.damageBonusPerStep * Math.floor(target.damage / cfg.damageStep)
    p += bonus
    if (bonus > 0) factors.damageBonus = bonus
  }
  // §10: civilians are three times as findable, applied to the final number.
  if (target.unitType === 'civilian') {
    p *= cfg.civilianMultiplier
    factors.civilian = cfg.civilianMultiplier
  }
  return { p: clamp01(p), factors }
}

// ---------------------------------------------------------------------------
// Intelligence (§12) — a separate check: detected is not identified
// ---------------------------------------------------------------------------

function rawIntelFactors(
  searcher: SensorActor,
  target: SensorActor,
  geom: ScanGeometry,
  cfg: SensorModelConfig,
): number {
  let f = 1
  f *= searcher.sensorValue / cfg.referenceSensorValue
  f *= scoutCommandFactor(searcher, cfg.scoutIntelPerPoint, cfg.commandIntelPerPoint)
  f *= 1 + cfg.sciencesIntelPerPoint * searcher.sciences
  f *= searcherSpeedFactor(cfg.searcherSpeedIntel, searcher.speed)
  f *= terrainLevel(cfg.searcherTerrain, searcher.terrain)
  if (searcher.formation === 'close') f *= cfg.searcherFormationClose
  if (searcher.formation === 'wide') f *= cfg.searcherFormationWide
  if (searcher.cloaked) f *= cfg.cloakIntel

  const signatureSpeed = target.speed + (target.active ? cfg.targetActiveSpeedBonus : 0)
  f *= targetSpeedFactor(cfg.targetSpeedSignature, signatureSpeed)
  f *= Math.max(cfg.powerFloor, cfg.powerBase + (cfg.powerSlope * target.actualPower) / cfg.powerReference)
  f *= Math.max(cfg.sizeFloor, 1 + cfg.sizeSlope * (target.sizeClass - cfg.sizePivot))
  f *= terrainLevel(cfg.targetTerrain, target.terrain)
  f *= cfg.interveningTerrainStep ** Math.max(0, geom.interveningTerrain)
  if (target.cloaked) f *= cfg.cloakIntel
  if (target.formation === 'close') f *= cfg.targetFormationClose
  if (target.formation === 'wide') f *= cfg.targetFormationWide
  f *= 1 + cfg.shipCountStep * Math.max(0, target.shipCount - 1)
  return f
}

/** Per-scan intelligence probability (§12), factors logged. */
export function intelligenceProbability(
  searcher: SensorActor,
  target: SensorActor,
  geom: ScanGeometry,
  cfg: SensorModelConfig = SENSOR_MODEL,
): SensorReading {
  const flat = cfg.override?.intelligence
  if (flat !== undefined) {
    const p = geom.range <= cfg.damageMaxRange ? clamp01(flat) : 0
    return { p, factors: { override: p } }
  }
  const base = rangeBase(cfg.intelRangeCurve, cfg.beyondCurveFalloff, geom.range)
  let p = base * rawIntelFactors(searcher, target, geom, cfg) * calibration(cfg).intel

  const factors: Record<string, number> = { base }
  if (searcher.active) {
    const bonus =
      geom.range <= cfg.searcherActiveCloseRange
        ? cfg.searcherActiveIntel
        : cfg.searcherActiveLongIntel
    p *= bonus
    factors.searcherActive = bonus
  }
  if (searcher.speed >= cfg.highSpeedThreshold && geom.range > 1) {
    p *= cfg.highSpeedIntelFactor
    factors.highSpeed = cfg.highSpeedIntelFactor
  }
  // §12: point-blank analysis is twice as productive, capped at 100%.
  if (geom.range <= cfg.intelCloseRange) {
    p *= cfg.intelCloseMultiplier
    factors.closeRange = cfg.intelCloseMultiplier
  }
  if (target.unitType === 'civilian') {
    p *= cfg.civilianMultiplier
    factors.civilian = cfg.civilianMultiplier
  }
  return { p: clamp01(p), factors }
}

// ---------------------------------------------------------------------------
// Track maintenance (§13) — never a substitute for fresh detection
// ---------------------------------------------------------------------------

function rangeChangeAdjustment(
  previousRange: number,
  currentRange: number,
  closerBonus: number,
  fartherPerHex: number,
): number {
  if (currentRange < previousRange) return closerBonus
  if (currentRange > previousRange) return -fartherPerHex * (currentRange - previousRange)
  return 0
}

/** §13: hold the track this scan. More intelligence in hand holds it better. */
export function retentionProbability(
  previousRange: number,
  currentRange: number,
  currentIntelProbability: number,
  cfg: SensorModelConfig = SENSOR_MODEL,
): number {
  if (cfg.override?.retention !== undefined) return clamp01(cfg.override.retention)
  const adj = rangeChangeAdjustment(
    previousRange,
    currentRange,
    cfg.retentionCloserBonus,
    cfg.retentionFartherPerHex,
  )
  return clamp(
    cfg.retentionBase + adj + cfg.retentionIntelWeight * currentIntelProbability,
    cfg.retentionMin,
    cfg.retentionMax,
  )
}

/**
 * §13: pick a lost track back up. Always easier than a cold search — the
 * searcher knows the signature now — so the fresh-detection chance plus ten
 * points is the floor under the formula, both clamped to [5%, 95%].
 */
export function reacquisitionProbability(
  freshDetectionProbability: number,
  previousRange: number,
  currentRange: number,
  currentIntelProbability: number,
  cfg: SensorModelConfig = SENSOR_MODEL,
): number {
  if (cfg.override?.reacquisition !== undefined) return clamp01(cfg.override.reacquisition)
  const adj = rangeChangeAdjustment(
    previousRange,
    currentRange,
    cfg.retentionCloserBonus,
    cfg.retentionFartherPerHex,
  )
  return clamp(
    Math.max(
      freshDetectionProbability + cfg.reacquisitionFreshBonus,
      cfg.reacquisitionBase + adj + cfg.reacquisitionIntelWeight * currentIntelProbability,
    ),
    cfg.reacquisitionMin,
    cfg.reacquisitionMax,
  )
}

// ---------------------------------------------------------------------------
// False contacts (§14) and the cumulative rule (§3)
// ---------------------------------------------------------------------------

/** §14: ghosts per scan — passive space hears more of them than active. */
export function falseContactChance(active: boolean, cfg: SensorModelConfig = SENSOR_MODEL): number {
  return active ? cfg.falseContactActive : cfg.falseContactPassive
}

/** §3: cumulative probability over independent scans, 1 − Π(1 − pᵢ). */
export function cumulativeDetection(perScan: readonly number[]): number {
  return 1 - perScan.reduce((keep, p) => keep * (1 - p), 1)
}
