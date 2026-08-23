/**
 * The designer's sensor model — his Sensor Model workbook, cell for cell
 * (StarForce_Commander_Sensor_Model.xlsx, August 2026).
 *
 * Five separate checks, never substituted for one another (briefing §1, §13):
 * initial detection (B60), intelligence (B96), track retention (B106),
 * reacquisition (B107) and false contacts (B108). The equations are his
 * "intentionally provisional playtest equations" (sheet A98), implemented
 * exactly — including the parts a fresh design might question — so his
 * calibration work survives the port and the next tuning pass happens in
 * one configurable structure instead of a spreadsheet diff.
 *
 * The shape of a detection roll (B60):
 *
 *   p = clamp01( σ(5·((capability − difficulty) − 0.35))
 *                · rangeFactor · environment · searcherSpeed · targetSpeed
 *                · powerSignature · sizeSignature · activeBonus
 *                · highSpeedPenalty · civilian
 *                + damageBonus )
 *
 * where capability is a weighted sum of the searcher's SENS, ACTUAL POWER,
 * SP1/SP2/SP0 sensor points, active status and SNCS (B54), scaled by the
 * scout-or-command factor (E33); and difficulty is an additive stack of the
 * target's cloak, terrain, formation, ship count and a whisper of its own
 * SENS (B55). Intelligence (B96) is the same skeleton with its own weights,
 * gentler range curve, steeper speed penalty, and a ×2 inside range 1.
 *
 * The workbook's own worked example — Yorktown II (SENS 3, power 122,
 * SP 2/4/6, SNCS 4, speed 2, passive) searching a V-2P Raider (power 61,
 * size 2, speed 2) at range 2 — computes detection 0.515470552703701 and
 * intelligence 0.18991849618949763, and the tests pin those digits.
 *
 * Every coefficient sits in SENSOR_MODEL, overridable per scenario through
 * `tuning.sensorModel` (top-level shallow merge: override a section object
 * whole). Two departures from the workbook's literal cells, both by the
 * designer's ruling on the flagged footnotes:
 *  - B91's intelligence-difficulty damage term read 0.06 × (damage + 1)
 *    with damage on the 0–100 points scale detection divides by 20 — one
 *    band of damage shut intelligence off entirely. FIXED per his go-ahead
 *    by reading damage in the same 20-point bands as detection's E49:
 *    0.06 × (INT(damage/20) + 1). Undamaged still contributes exactly the
 *    sheet's 0.06, so the golden worked-example cells still pin.
 *  - Formations are now two, per his redesign: Standard (0, the default —
 *    every ship scans) and Close (1 — the unit reads as ONE target, only
 *    the lead ship scans, the true count resolves only through a 25%-per-
 *    scan peek, and formation-keeping carries a 0.25%-per-phase collision
 *    risk). 'Wide' in an old file reads as Standard.
 */

import type { Formation } from './types'

// ---------------------------------------------------------------------------
// Actors — the sheet's yellow input table, one shape for either role
// ---------------------------------------------------------------------------

export interface SensorActor {
  /** Sensor Rating (SENS) — the printed rating, baseline 3 (sheet B8). */
  sens: number
  /** Scout Sensors rating 0–5 (B7). */
  scoutSensors: number
  /** Command Systems (CMND) boxes (B19) — counts only without a scout. */
  command: number
  /** Sciences (SNCS) boxes (B18). */
  sciences: number
  /** Total Actual Power (B9), baseline 85. */
  actualPower: number
  /** The 0/1/2-power sensor points, all three static stats (B15/B12/B13). */
  sp0: number
  sp1: number
  sp2: number
  /** Hexes per campaign round; baseline scanning speed 4, may exceed 10. */
  speed: number
  /** Sensor Mode: false = Passive, true = Active (B14). */
  active: boolean
  cloaked: boolean
  unitType: 'military' | 'civilian'
  /** Structure damage on the sheet's points scale (C23; detection E49). */
  damage: number
  /** Formation number: 0 Single, 1 Close, 2 Medium, 3 Wide (C22). */
  formation: number
  sizeClass: number
  shipCount: number
  /** Terrain level occupied: 0 none, 1 system, 2 nebula (B16/C26). */
  terrain: number
}

export interface ScanGeometry {
  range: number
  /** Summed terrain levels of hexes between the ships (B17). */
  interveningTerrain: number
}

// ---------------------------------------------------------------------------
// Coefficients (§16: one configurable structure, mirroring the sheet)
// ---------------------------------------------------------------------------

/** B54/B90: weight per searcher stat; each stat is divided by its baseline. */
export interface CapabilityWeights {
  sens: number
  power: number
  sp1: number
  sp2: number
  sp0: number
  /** × (activeStatus + 1) — active mode nudges capability itself. */
  activeMode: number
  sciences: number
}

/** B55/B91: additive difficulty stack; most terms read × (input + 1). */
export interface DifficultyWeights {
  base: number
  cloak: number
  terrain: number
  formation: number
  /** × shipCount, straight. */
  shipCount: number
  /** × (targetSENS / sensBaseline) — E52/E86's whisper. */
  targetSensor: number
  /**
   * Intelligence only: × (INT(damage / damageStep) + 1) — B91 with the
   * designer-approved band reading, so damage nudges rather than shuts.
   */
  damage: number
}

export interface SensorModelConfig {
  /** The stat baselines every capability term divides by (sheet notes). */
  baselines: { sens: number; power: number; sp1: number; sp2: number; sp0: number; sciences: number }
  detectionCapability: CapabilityWeights
  detectionDifficulty: DifficultyWeights
  intelCapability: CapabilityWeights
  intelDifficulty: DifficultyWeights
  /** σ(gain × ((capability − difficulty) − offset)) — B60/B96. */
  detectionSigmoid: { gain: number; offset: number }
  intelSigmoid: { gain: number; offset: number }
  /** B56: stepped by range 0–4, then × falloff per hex, floored. */
  detectionRangeSteps: readonly number[]
  detectionRangeFalloff: number
  detectionRangeFloor: number
  /** B92: 1 − slope × range through 4, then base × ratio^(r−4), floored. */
  intelRangeSlope: number
  intelRangeBeyondBase: number
  intelRangeBeyondRatio: number
  intelRangeFloor: number
  /** B57/B93: MAX(floor, 1 − a×terrainA − b×between). */
  detectionEnvironment: { terrainA: number; between: number; floor: number }
  intelEnvironment: { terrainA: number; between: number; floor: number }
  /** B58/B94: gentle 0–3, moderate 4–6, severe 7+ (base × ratio^(s−6)). */
  searcherSpeedDetection: { gentleSlope: number; moderateSlope: number; severeBase: number; severeRatio: number; floor: number }
  searcherSpeedIntel: { gentleSlope: number; moderateSlope: number; severeBase: number; severeRatio: number; floor: number }
  /** The gentle curves start at this value at speed 0 (1.15 − slope×s). */
  searcherSpeedIdle: number
  /** B59/B95: 0.7+0.1s / 1+0.2(s−3) / 1.6×1.5^(s−6); s = speed (+7 active). */
  targetSpeed: { lowBase: number; lowSlope: number; midSlope: number; highBase: number; highRatio: number }
  /** EXACT (§5): active target reads +7 signature speed — additive. */
  targetActiveSpeedBonus: number
  /** E40/E74: searcher active multipliers inside range 2; nothing beyond. */
  searcherActiveCloseRange: number
  searcherActiveDetection: number
  searcherActiveIntel: number
  /** E33/E66: scout per point, else command per point. */
  scoutDetectionPerPoint: number
  scoutIntelPerPoint: number
  commandDetectionPerPoint: number
  commandIntelPerPoint: number
  /** E35/E69: MAX(floor, base + slope × power / powerBaseline). */
  powerFloor: number
  powerBase: number
  powerSlope: number
  /** E45/E79: MAX(floor, 1 + slope × (sizeClass − pivot)). */
  sizeFloor: number
  sizeSlope: number
  sizePivot: number
  /** E51/E85: civilian targets, multiplying the final probability. */
  civilianMultiplier: number
  /** E49: +points × INT(damage / step), additive, within range 6. */
  damageBonusPerStep: number
  damageStep: number
  damageMaxRange: number
  /** B60/B96 tails: at searcher speed ≥ threshold and range > 1. */
  highSpeedThreshold: number
  highSpeedDetectionFactor: number
  highSpeedIntelFactor: number
  /** §12: intelligence ×2 inside this range, capped at 100%. */
  intelCloseRange: number
  intelCloseMultiplier: number
  /** B106: retention. */
  retentionBase: number
  retentionCloserBonus: number
  retentionFartherPerHex: number
  retentionIntelWeight: number
  retentionMin: number
  retentionMax: number
  /** B107: reacquisition. */
  reacquisitionBase: number
  reacquisitionFreshBonus: number
  reacquisitionIntelWeight: number
  reacquisitionMin: number
  reacquisitionMax: number
  /** B108: false contacts per scan. */
  falseContactPassive: number
  falseContactActive: number
  /**
   * Close formation (the designer's redesign): the chance per scan that the
   * count of a close formation can even be peeked at — "a 25% chance that a
   * detection can be attempted on each additional ship beyond the first" —
   * and the small per-phase risk of two hulls flying that tight touching.
   */
  closeFormationCountChance: number
  closeFormationCollision: number
  /**
   * PROVISIONAL (not in the sheet): beyond this range no retention or
   * reacquisition roll happens at all — a held track goes cold, a lost one
   * stays lost. Without a horizon the 5% floors would hold tracks on
   * targets half a map away, forever, five percent at a time.
   */
  trackingMaxRange: number
  /**
   * Playtest/debug dial: flat probabilities replacing the computed ones.
   * Detection and intelligence overrides apply within `damageMaxRange` and
   * read 0 beyond it — "certain within sensor reach" — which is also what
   * deterministic integration tests pin.
   */
  override?: {
    detection?: number
    intelligence?: number
    retention?: number
    reacquisition?: number
  }
}

export const SENSOR_MODEL: SensorModelConfig = {
  baselines: { sens: 3, power: 85, sp1: 4, sp2: 6, sp0: 2, sciences: 3 },
  detectionCapability: { sens: 0.25, power: 0.18, sp1: 0.12, sp2: 0.1, sp0: 0.08, activeMode: 0.05, sciences: 0.07 },
  detectionDifficulty: { base: 0.48, cloak: 0.15, terrain: 0.08, formation: 0.06, shipCount: 0.04, targetSensor: 0.01, damage: 0 },
  intelCapability: { sens: 0.22, power: 0.14, sp1: 0.1, sp2: 0.08, sp0: 0.03, activeMode: 0.04, sciences: 0.22 },
  intelDifficulty: { base: 0.29, cloak: 0.18, terrain: 0.15, formation: 0.1, shipCount: 0.05, targetSensor: 0.01, damage: 0.06 },
  detectionSigmoid: { gain: 5, offset: 0.35 },
  intelSigmoid: { gain: 5, offset: 0.2 },
  detectionRangeSteps: [6.004904, 4.670481, 3.336058, 2.001635, 0.667212],
  detectionRangeFalloff: 0.35,
  detectionRangeFloor: 0.01,
  intelRangeSlope: 0.12,
  intelRangeBeyondBase: 0.52,
  intelRangeBeyondRatio: 0.3,
  intelRangeFloor: 0.005,
  detectionEnvironment: { terrainA: 0.1, between: 0.12, floor: 0.15 },
  intelEnvironment: { terrainA: 0.12, between: 0.15, floor: 0.1 },
  searcherSpeedDetection: { gentleSlope: 0.05, moderateSlope: 0.1, severeBase: 0.7, severeRatio: 0.45, floor: 0.001 },
  searcherSpeedIntel: { gentleSlope: 0.05, moderateSlope: 0.15, severeBase: 0.55, severeRatio: 0.35, floor: 0.0005 },
  searcherSpeedIdle: 1.15,
  targetSpeed: { lowBase: 0.7, lowSlope: 0.1, midSlope: 0.2, highBase: 1.6, highRatio: 1.5 },
  targetActiveSpeedBonus: 7,
  searcherActiveCloseRange: 2,
  searcherActiveDetection: 2,
  searcherActiveIntel: 1.5,
  scoutDetectionPerPoint: 0.25,
  scoutIntelPerPoint: 0.2,
  commandDetectionPerPoint: 0.05,
  commandIntelPerPoint: 0.15,
  powerFloor: 0.5,
  powerBase: 0.75,
  powerSlope: 0.25,
  sizeFloor: 0.1,
  sizeSlope: 0.15,
  sizePivot: 4,
  civilianMultiplier: 3,
  damageBonusPerStep: 0.05,
  damageStep: 20,
  damageMaxRange: 6,
  highSpeedThreshold: 10,
  highSpeedDetectionFactor: 0.1,
  highSpeedIntelFactor: 0.05,
  intelCloseRange: 1,
  intelCloseMultiplier: 2,
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
  closeFormationCountChance: 0.25,
  closeFormationCollision: 0.0025,
  trackingMaxRange: 8,
}

/** A scenario's overrides merged over the defaults (tuning.sensorModel). */
export function resolveSensorModel(overrides?: Record<string, unknown>): SensorModelConfig {
  if (!overrides) return SENSOR_MODEL
  return { ...SENSOR_MODEL, ...overrides } as SensorModelConfig
}

/**
 * Formation as the difficulty stack numbers it, after the designer's
 * redesign: 0 Standard (the default — a single ship is always Standard),
 * 1 Close. 'Wide' survives only in old files and reads as Standard.
 */
export function formationNumber(formation: Formation, shipCount: number): number {
  if (shipCount <= 1) return 0
  return formation === 'close' ? 1 : 0
}

// ---------------------------------------------------------------------------
// Pieces — each one a named cell
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** E33 / E66: scout points, or command points only when there is no scout. */
function scoutCommandFactor(actor: SensorActor, scoutPer: number, commandPer: number): number {
  if (actor.scoutSensors > 0) return 1 + scoutPer * actor.scoutSensors
  return 1 + commandPer * actor.command
}

/** B54 / B90: the weighted searcher capability sum. */
function capability(
  s: SensorActor,
  w: CapabilityWeights,
  base: SensorModelConfig['baselines'],
  scoutFactor: number,
): number {
  const raw =
    w.sens * (s.sens / base.sens) +
    w.power * (s.actualPower / base.power) +
    w.sp1 * (s.sp1 / base.sp1) +
    w.sp2 * (s.sp2 / base.sp2) +
    w.sp0 * (s.sp0 / base.sp0) +
    w.activeMode * ((s.active ? 1 : 0) + 1) +
    w.sciences * (s.sciences / base.sciences)
  return raw * scoutFactor
}

/** B55 / B91: the additive target difficulty stack. */
function difficulty(
  t: SensorActor,
  w: DifficultyWeights,
  sensBaseline: number,
  damageStep: number,
): number {
  return (
    w.base +
    w.cloak * ((t.cloaked ? 1 : 0) + 1) +
    w.terrain * (t.terrain + 1) +
    w.formation * (t.formation + 1) +
    w.shipCount * t.shipCount +
    // Intelligence only (B91); detection carries weight 0 here. Damage reads
    // in the same 20-point bands as E49 — the designer's fix for the sheet's
    // raw-points term, which shut intelligence off at one band of damage.
    w.damage * (Math.floor(Math.max(0, t.damage) / damageStep) + 1) +
    w.targetSensor * (t.sens / sensBaseline)
  )
}

/** B56: the stepped detection range factor with its steep tail. */
function detectionRangeFactor(cfg: SensorModelConfig, range: number): number {
  const r = Math.max(0, Math.round(range))
  const steps = cfg.detectionRangeSteps
  if (r < steps.length) return steps[r]
  return Math.max(
    cfg.detectionRangeFloor,
    steps[steps.length - 1] * cfg.detectionRangeFalloff ** (r - (steps.length - 1)),
  )
}

/** B92: intelligence declines gently through 4, steeply past it. */
function intelRangeFactor(cfg: SensorModelConfig, range: number): number {
  const r = Math.max(0, Math.round(range))
  if (r <= 4) return 1 - cfg.intelRangeSlope * r
  return Math.max(cfg.intelRangeFloor, cfg.intelRangeBeyondBase * cfg.intelRangeBeyondRatio ** (r - 4))
}

/** B57 / B93: the searcher's own environment. */
function environmentFactor(
  env: { terrainA: number; between: number; floor: number },
  searcher: SensorActor,
  geom: ScanGeometry,
): number {
  return Math.max(env.floor, 1 - env.terrainA * searcher.terrain - env.between * geom.interveningTerrain)
}

/** B58 / B94: gentle 0–3, moderate 4–6, severe 7+. */
function searcherSpeedFactor(
  cfg: SensorModelConfig,
  curve: { gentleSlope: number; moderateSlope: number; severeBase: number; severeRatio: number; floor: number },
  speed: number,
): number {
  const s = Math.max(0, speed)
  if (s <= 3) return cfg.searcherSpeedIdle - curve.gentleSlope * s
  if (s <= 6) return 1 - curve.moderateSlope * (s - 3)
  return Math.max(curve.floor, curve.severeBase * curve.severeRatio ** (s - 6))
}

/** B59 / B95: signature speed = target speed + 7 when active. */
function targetSpeedFactor(cfg: SensorModelConfig, target: SensorActor): number {
  const t = cfg.targetSpeed
  const s = Math.max(0, target.speed) + (target.active ? cfg.targetActiveSpeedBonus : 0)
  if (s <= 3) return t.lowBase + t.lowSlope * s
  if (s <= 6) return 1 + t.midSlope * (s - 3)
  return t.highBase * t.highRatio ** (s - 6)
}

/** E35 / E69: the target's power signature. */
function powerFactor(cfg: SensorModelConfig, target: SensorActor): number {
  return Math.max(cfg.powerFloor, cfg.powerBase + cfg.powerSlope * (target.actualPower / cfg.baselines.power))
}

/** E45 / E79: the target's size signature. */
function sizeFactor(cfg: SensorModelConfig, target: SensorActor): number {
  return Math.max(cfg.sizeFloor, 1 + cfg.sizeSlope * (target.sizeClass - cfg.sizePivot))
}

// ---------------------------------------------------------------------------
// Detection (B60) and intelligence (B96)
// ---------------------------------------------------------------------------

export interface SensorReading {
  p: number
  /** Every factor and its value, for the briefing's §16 logging requirement. */
  factors: Record<string, number>
}

/** Per-scan detection probability — cell B60, term for term. */
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

  const scoutFactor = scoutCommandFactor(searcher, cfg.scoutDetectionPerPoint, cfg.commandDetectionPerPoint)
  const cap = capability(searcher, cfg.detectionCapability, cfg.baselines, scoutFactor)
  const diff = difficulty(target, cfg.detectionDifficulty, cfg.baselines.sens, cfg.damageStep)
  const gate = sigmoid(cfg.detectionSigmoid.gain * (cap - diff - cfg.detectionSigmoid.offset))
  const factors: Record<string, number> = {
    capability: cap,
    difficulty: diff,
    gate,
    range: detectionRangeFactor(cfg, geom.range),
    environment: environmentFactor(cfg.detectionEnvironment, searcher, geom),
    searcherSpeed: searcherSpeedFactor(cfg, cfg.searcherSpeedDetection, searcher.speed),
    targetSpeed: targetSpeedFactor(cfg, target),
    power: powerFactor(cfg, target),
    size: sizeFactor(cfg, target),
  }

  let p = gate * factors.range * factors.environment * factors.searcherSpeed * factors.targetSpeed * factors.power * factors.size

  // E40: active sensors double detection inside range 2; nothing beyond
  // (the small long-range benefit lives in the capability term above).
  if (searcher.active && geom.range <= cfg.searcherActiveCloseRange) {
    p *= cfg.searcherActiveDetection
    factors.searcherActive = cfg.searcherActiveDetection
  }
  // B60's tail: a searcher tearing along at 10+ hears little past range 1.
  if (searcher.speed >= cfg.highSpeedThreshold && geom.range > 1) {
    p *= cfg.highSpeedDetectionFactor
    factors.highSpeed = cfg.highSpeedDetectionFactor
  }
  // E51: civilians are three times as findable — inside the product.
  if (target.unitType === 'civilian') {
    p *= cfg.civilianMultiplier
    factors.civilian = cfg.civilianMultiplier
  }
  // E49: damage points are additive, inside range 6, after everything else.
  if (geom.range <= cfg.damageMaxRange) {
    const bonus = cfg.damageBonusPerStep * Math.floor(Math.max(0, target.damage) / cfg.damageStep)
    p += bonus
    if (bonus > 0) factors.damageBonus = bonus
  }
  return { p: clamp01(p), factors }
}

/** Per-scan intelligence probability — cell B96, term for term. */
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

  const scoutFactor = scoutCommandFactor(searcher, cfg.scoutIntelPerPoint, cfg.commandIntelPerPoint)
  const cap = capability(searcher, cfg.intelCapability, cfg.baselines, scoutFactor)
  const diff = difficulty(target, cfg.intelDifficulty, cfg.baselines.sens, cfg.damageStep)
  const gate = sigmoid(cfg.intelSigmoid.gain * (cap - diff - cfg.intelSigmoid.offset))
  const factors: Record<string, number> = {
    capability: cap,
    difficulty: diff,
    gate,
    range: intelRangeFactor(cfg, geom.range),
    environment: environmentFactor(cfg.intelEnvironment, searcher, geom),
    searcherSpeed: searcherSpeedFactor(cfg, cfg.searcherSpeedIntel, searcher.speed),
    targetSpeed: targetSpeedFactor(cfg, target),
    power: powerFactor(cfg, target),
    size: sizeFactor(cfg, target),
  }

  let p = gate * factors.range * factors.environment * factors.searcherSpeed * factors.targetSpeed * factors.power * factors.size

  if (searcher.active && geom.range <= cfg.searcherActiveCloseRange) {
    p *= cfg.searcherActiveIntel
    factors.searcherActive = cfg.searcherActiveIntel
  }
  // B96: point-blank analysis is twice as productive.
  if (geom.range <= cfg.intelCloseRange) {
    p *= cfg.intelCloseMultiplier
    factors.closeRange = cfg.intelCloseMultiplier
  }
  if (searcher.speed >= cfg.highSpeedThreshold && geom.range > 1) {
    p *= cfg.highSpeedIntelFactor
    factors.highSpeed = cfg.highSpeedIntelFactor
  }
  if (target.unitType === 'civilian') {
    p *= cfg.civilianMultiplier
    factors.civilian = cfg.civilianMultiplier
  }
  return { p: clamp01(p), factors }
}

// ---------------------------------------------------------------------------
// Track maintenance (B103–B108) — never a substitute for fresh detection
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

/** B106: hold the track this scan. More intelligence in hand holds it better. */
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
 * B107: pick a lost track back up. Always easier than a cold search — the
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
// False contacts (B108) and the cumulative rule (§3)
// ---------------------------------------------------------------------------

/** B108: ghosts per scan — passive space hears more of them than active. */
export function falseContactChance(active: boolean, cfg: SensorModelConfig = SENSOR_MODEL): number {
  return active ? cfg.falseContactActive : cfg.falseContactPassive
}

/** §3: cumulative probability over independent scans, 1 − Π(1 − pᵢ). */
export function cumulativeDetection(perScan: readonly number[]): number {
  return 1 - perScan.reduce((keep, p) => keep * (1 - p), 1)
}
