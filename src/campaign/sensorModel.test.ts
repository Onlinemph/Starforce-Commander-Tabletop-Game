import { describe, expect, it } from 'vitest'
import {
  cumulativeDetection,
  detectionProbability,
  falseContactChance,
  formationNumber,
  intelligenceProbability,
  reacquisitionProbability,
  retentionProbability,
  SENSOR_MODEL,
  type ScanGeometry,
  type SensorActor,
} from './sensorModel'

/**
 * The designer's own validation list (briefing §17) against his workbook's
 * equations. The golden anchor is the sheet's cached worked example —
 * Yorktown II searching a V-2P Raider at range 2 — whose cell values these
 * tests pin to the last digit; the factor tests isolate one dial at a time,
 * by exact ratio where the dial multiplies outside the sigmoid and by
 * direction where it rides inside it.
 */

/** The workbook's B-column searcher: Yorktown II, passive, speed 2. */
function yorktownII(): SensorActor {
  return {
    sens: 3,
    scoutSensors: 0,
    command: 0,
    sciences: 4,
    actualPower: 122,
    sp0: 2,
    sp1: 4,
    sp2: 6,
    speed: 2,
    active: false,
    cloaked: false,
    unitType: 'military',
    damage: 0,
    formation: 0,
    sizeClass: 5,
    shipCount: 1,
    terrain: 0,
  }
}

/** The workbook's C-column target: V-2P Raider, passive, speed 2. */
function v2pRaider(): SensorActor {
  return {
    sens: 3,
    scoutSensors: 0,
    command: 0,
    sciences: 1,
    actualPower: 61,
    sp0: 1,
    sp1: 3,
    sp2: 5,
    speed: 2,
    active: false,
    cloaked: false,
    unitType: 'military',
    damage: 0,
    formation: 0,
    sizeClass: 2,
    shipCount: 1,
    terrain: 0,
  }
}

const geom = (range: number, interveningTerrain = 0): ScanGeometry => ({ range, interveningTerrain })

const detect = (s: SensorActor, t: SensorActor, range: number) =>
  detectionProbability(s, t, geom(range)).p
const intel = (s: SensorActor, t: SensorActor, range: number) =>
  intelligenceProbability(s, t, geom(range)).p

describe('the golden cells: the workbook’s own worked example', () => {
  it('detection B60 = 0.515470552703701', () => {
    expect(detect(yorktownII(), v2pRaider(), 2)).toBeCloseTo(0.515470552703701, 12)
  })

  it('intelligence B96 = 0.18991849618949763', () => {
    expect(intel(yorktownII(), v2pRaider(), 2)).toBeCloseTo(0.18991849618949763, 12)
  })

  it('retention B106 and reacquisition B107 from those readings', () => {
    const intelP = intel(yorktownII(), v2pRaider(), 2)
    const detP = detect(yorktownII(), v2pRaider(), 2)
    expect(retentionProbability(2, 2, intelP)).toBeCloseTo(0.8689918496189497, 12)
    expect(reacquisitionProbability(detP, 2, 2, intelP)).toBeCloseTo(0.615470552703701, 12)
  })
})

describe('range behavior (B56, B92)', () => {
  it('detection follows the stepped range factor exactly, ratio for ratio', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const p2 = detect(s, t, 2)
    const steps = SENSOR_MODEL.detectionRangeSteps
    for (let r = 0; r <= 4; r++) {
      expect(detect(s, t, r) / p2).toBeCloseTo(steps[r] / steps[2], 10)
    }
    // Beyond range 4: ×0.35 per hex — R4 ~10% territory falls to ~3.5%, ~1.2%.
    expect(detect(s, t, 5) / detect(s, t, 4)).toBeCloseTo(0.35, 10)
    expect(detect(s, t, 6) / detect(s, t, 5)).toBeCloseTo(0.35, 10)
  })

  it('detection declines monotonically from point blank out', () => {
    const s = yorktownII()
    const t = v2pRaider()
    let last = Infinity
    for (let r = 0; r <= 8; r++) {
      const p = detect(s, t, r)
      expect(p).toBeLessThan(last)
      expect(p).toBeGreaterThan(0)
      last = p
    }
  })

  it('the cumulative rule is 1 − PRODUCT(1 − p)', () => {
    expect(cumulativeDetection([0.5, 0.5])).toBeCloseTo(0.75, 10)
    expect(cumulativeDetection([])).toBe(0)
    expect(cumulativeDetection([1, 0.1])).toBe(1)
    // An approach compounds: every extra scan can only raise the total.
    const s = yorktownII()
    const t = v2pRaider()
    const approach = [4, 3, 3, 2, 2, 1, 1, 0].map((r) => detect(s, t, r))
    let running = 0
    for (let i = 0; i < approach.length; i++) {
      const next = cumulativeDetection(approach.slice(0, i + 1))
      expect(next).toBeGreaterThan(running)
      running = next
    }
    expect(running).toBeGreaterThan(0.99)
  })
})

describe('searcher active sensors (E40, E74)', () => {
  it('doubles detection inside range 2 — and the mode bump rides the sigmoid too', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const active = { ...s, active: true }
    for (const r of [1, 2]) {
      const reading = detectionProbability(active, t, geom(r))
      expect(reading.factors.searcherActive).toBe(2)
      // At least the doubled passive chance — the cap eats the rest.
      expect(reading.p).toBeGreaterThanOrEqual(Math.min(1, 2 * detect(s, t, r)))
    }
    for (const r of [3, 5]) {
      const ratio = detect(active, t, r) / detect(s, t, r)
      expect(ratio).toBeGreaterThan(1) // capability's 0.05 × (active+1) term
      expect(ratio).toBeLessThan(2)
    }
  })

  it('multiplies intelligence by 1.5 inside range 2', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const reading = intelligenceProbability({ ...s, active: true }, t, geom(2))
    expect(reading.factors.searcherActive).toBe(1.5)
    expect(reading.p / intel(s, t, 2)).toBeGreaterThan(1.5)
  })
})

describe('target active emissions (B59, B95)', () => {
  it('a target running active at speed 4 reads exactly like signature speed 11', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const active4 = { ...t, speed: 4, active: true }
    const passive11 = { ...t, speed: 11, active: false }
    expect(detect(s, active4, 3)).toBeCloseTo(detect(s, passive11, 3), 12)
    expect(intel(s, active4, 3)).toBeCloseTo(intel(s, passive11, 3), 12)
  })

  it('is additive, not a minimum: active at speed 4 beats passive at speed 7', () => {
    const s = yorktownII()
    const t = v2pRaider()
    expect(detect(s, { ...t, speed: 4, active: true }, 3)).toBeGreaterThan(
      detect(s, { ...t, speed: 7 }, 3),
    )
  })
})

describe('target power signature (E35)', () => {
  it('MAX(0.5, 0.75 + 0.25 × power / 85): the printed examples, exact ratios', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const at = (power: number) => detect(s, { ...t, actualPower: power }, 3)
    expect(at(0) / at(85)).toBeCloseTo(0.75, 10)
    expect(at(170) / at(85)).toBeCloseTo(1.25, 10)
    expect(at(-1000) / at(85)).toBeCloseTo(0.5, 10) // the floor
  })
})

describe('target size class (E45)', () => {
  it('MAX(0.10, 1 + 0.15 × (size − 4)): the printed examples, exact ratios', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const at = (size: number) => detect(s, { ...t, sizeClass: size }, 3)
    expect(at(2) / at(4)).toBeCloseTo(0.7, 10)
    expect(at(6) / at(4)).toBeCloseTo(1.3, 10)
    expect(at(7) / at(4)).toBeCloseTo(1.45, 10)
  })
})

describe('searcher speed (B58, B94)', () => {
  it('degrades monotonically and keeps working past speed 10', () => {
    const s = yorktownII()
    const t = v2pRaider()
    let last = Infinity
    for (const speed of [0, 2, 4, 6, 8, 10, 12, 15]) {
      const p = detect({ ...s, speed }, t, 1)
      expect(p).toBeLessThan(last)
      expect(p).toBeGreaterThan(0)
      last = p
    }
  })

  it('at speed 10+, range > 1: detection ×0.10 and intelligence ×0.05 on top', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const slow = { ...s, speed: 9 }
    const fast = { ...s, speed: 10 }
    const curveRatioDet = detect(fast, t, 1) / detect(slow, t, 1) // no penalty inside range 1
    expect(detect(fast, t, 3) / detect(slow, t, 3)).toBeCloseTo(0.1 * curveRatioDet, 10)
    const curveRatioInt = intel(fast, t, 1) / intel(slow, t, 1)
    expect(intel(fast, t, 3) / intel(slow, t, 3)).toBeCloseTo(0.05 * curveRatioInt, 10)
  })

  it('intelligence degrades faster than detection at high speed', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const detRatio = detect({ ...s, speed: 8 }, t, 1) / detect({ ...s, speed: 0 }, t, 1)
    const intRatio = intel({ ...s, speed: 8 }, t, 1) / intel({ ...s, speed: 0 }, t, 1)
    expect(intRatio).toBeLessThan(detRatio)
  })
})

describe('civilian targets (E51, E85)', () => {
  it('three times the final probability, capped at 100%', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const freighter = { ...t, unitType: 'civilian' as const }
    expect(detect(s, freighter, 4)).toBeCloseTo(3 * detect(s, t, 4), 10)
    expect(intel(s, freighter, 4)).toBeCloseTo(3 * intel(s, t, 4), 10)
    expect(detect(s, freighter, 0)).toBe(1) // 3 × a near-certainty caps
  })
})

describe('damage signature (E49)', () => {
  it('+5 points per full 20 damage, additive, only inside range 6', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const base = detect(s, t, 3)
    expect(detect(s, { ...t, damage: 19 }, 3)).toBeCloseTo(base, 10)
    expect(detect(s, { ...t, damage: 20 }, 3)).toBeCloseTo(base + 0.05, 10)
    expect(detect(s, { ...t, damage: 40 }, 3)).toBeCloseTo(base + 0.1, 10)
    expect(detect(s, { ...t, damage: 40 }, 7)).toBeCloseTo(detect(s, t, 7), 10)
  })

  it('VERBATIM, flagged for the designer: B91 makes intelligence collapse on a damaged hull', () => {
    // Intelligence difficulty adds 0.06 × (damage + 1) with damage on the
    // same points scale detection divides by 20 — so 20 points of damage
    // adds 1.26 difficulty and the sigmoid shuts. Implemented as the sheet
    // computes it; one coefficient to change if damage there meant a band.
    const s = yorktownII()
    const t = v2pRaider()
    expect(intel(s, { ...t, damage: 20 }, 2)).toBeLessThan(0.05 * intel(s, t, 2))
  })
})

describe('scout and command (E33, E66)', () => {
  it('scout points help, command points help less, both through the sigmoid', () => {
    const s = { ...yorktownII(), scoutSensors: 0, command: 0 }
    const t = v2pRaider()
    const base = detect(s, t, 3)
    expect(detect({ ...s, scoutSensors: 2 }, t, 3)).toBeGreaterThan(base)
    expect(detect({ ...s, command: 2 }, t, 3)).toBeGreaterThan(base)
    expect(detect({ ...s, scoutSensors: 2 }, t, 3)).toBeGreaterThan(detect({ ...s, command: 2 }, t, 3))
    const baseIntel = intel(s, t, 3)
    expect(intel({ ...s, scoutSensors: 2 }, t, 3)).toBeGreaterThan(baseIntel)
    expect(intel({ ...s, command: 2 }, t, 3)).toBeGreaterThan(baseIntel)
  })

  it('a scout block present, command systems are ignored entirely', () => {
    const s = { ...yorktownII(), scoutSensors: 1, command: 0 }
    const t = v2pRaider()
    expect(detect({ ...s, command: 5 }, t, 3)).toBeCloseTo(detect(s, t, 3), 12)
    expect(intel({ ...s, command: 5 }, t, 3)).toBeCloseTo(intel(s, t, 3), 12)
  })
})

describe('intelligence close range (B96)', () => {
  it('doubles at ranges 0–1, capped at 100%', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const r1 = intelligenceProbability(s, t, geom(1))
    expect(r1.factors.closeRange).toBe(2)
    expect(r1.p).toBeLessThanOrEqual(1)
    expect(intelligenceProbability(s, t, geom(2)).factors.closeRange).toBeUndefined()
  })

  it('detected is not identified: the checks are separate and intel is harder', () => {
    const s = yorktownII()
    const t = v2pRaider()
    expect(intel(s, t, 2)).toBeLessThan(detect(s, t, 2))
  })
})

describe('cloak, terrain and formation (B55, B57, B91, B93)', () => {
  it('cloak cuts both checks through the sigmoid — substantially, never to zero', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const dark = { ...t, cloaked: true }
    expect(detect(s, dark, 2)).toBeLessThan(detect(s, t, 2) * 0.7)
    expect(detect(s, dark, 2)).toBeGreaterThan(0)
    expect(intel(s, dark, 2)).toBeLessThan(intel(s, t, 2))
    expect(intel(s, dark, 2)).toBeGreaterThan(0)
  })

  it('target terrain, searcher terrain and intervening terrain each cost', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const base = detect(s, t, 3)
    expect(detect(s, { ...t, terrain: 2 }, 3)).toBeLessThan(base)
    expect(detect({ ...s, terrain: 2 }, t, 3)).toBeLessThan(base)
    expect(detectionProbability(s, t, geom(3, 2)).p).toBeLessThan(base)
  })

  it('VERBATIM, flagged for the designer: B55 makes a WIDE formation the hardest to find', () => {
    // The sheet adds 0.06 × (formation + 1) to difficulty, so 3 = Wide is
    // the most difficult target — the orders doc says wide should be a
    // little easier. Implemented as the sheet computes it.
    const s = yorktownII()
    const t = v2pRaider()
    expect(detect(s, { ...t, formation: 3, shipCount: 3 }, 3)).toBeLessThan(
      detect(s, { ...t, formation: 0, shipCount: 3 }, 3),
    )
  })

  it('formation numbering follows the orders doc', () => {
    expect(formationNumber('standard', 1)).toBe(0) // single ship
    expect(formationNumber('close', 3)).toBe(1)
    expect(formationNumber('standard', 3)).toBe(2)
    expect(formationNumber('wide', 3)).toBe(3)
  })
})

describe('track maintenance (B103–B107)', () => {
  it('retention: 85% base, +10 closer, −10 per hex farther, +10% × intel', () => {
    expect(retentionProbability(3, 3, 0)).toBeCloseTo(0.85, 10)
    expect(retentionProbability(3, 2, 0)).toBeCloseTo(0.95, 10)
    expect(retentionProbability(3, 5, 0)).toBeCloseTo(0.65, 10)
    expect(retentionProbability(3, 3, 0.5)).toBeCloseTo(0.9, 10)
    expect(retentionProbability(3, 20, 0)).toBe(0.05) // floor
    expect(retentionProbability(3, 2, 1)).toBeCloseTo(0.99, 10) // ceiling
  })

  it('reacquisition beats a comparable fresh search by at least 10 points, unless capped', () => {
    for (const fresh of [0.05, 0.3, 0.6, 0.9]) {
      const p = reacquisitionProbability(fresh, 3, 3, 0)
      expect(p).toBeGreaterThanOrEqual(Math.min(0.95, fresh + 0.1))
    }
    expect(reacquisitionProbability(0.94, 3, 3, 0)).toBe(0.95) // cap
    expect(reacquisitionProbability(0, 3, 2, 0.5)).toBeCloseTo(0.7, 10) // formula arm
  })
})

describe('false contacts (B108)', () => {
  it('0.5% per passive scan, 0.1% per active scan', () => {
    expect(falseContactChance(false)).toBeCloseTo(0.005, 10)
    expect(falseContactChance(true)).toBeCloseTo(0.001, 10)
  })
})

describe('caps, edges and the config (§16–§17)', () => {
  it('every probability stays in [0, 1], including hostile inputs', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const monster: SensorActor = {
      ...t,
      actualPower: 10000,
      sizeClass: 10,
      speed: 25,
      active: true,
      damage: 100,
      unitType: 'civilian',
      shipCount: 8,
    }
    expect(detect(s, monster, 0)).toBe(1)
    const whisper: SensorActor = { ...t, actualPower: 0, sizeClass: 1, cloaked: true, terrain: 2 }
    const p = detect({ ...s, speed: 30, terrain: 2 }, whisper, 12)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThan(0.001)
  })

  it('coefficients override through the config without touching the module', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const cfg = { ...SENSOR_MODEL, civilianMultiplier: 2 }
    const p = detectionProbability(s, { ...t, unitType: 'civilian' }, geom(4), cfg).p
    expect(p).toBeCloseTo(2 * detect(s, t, 4), 10)
  })

  it('the override dial pins flat probabilities inside sensor reach', () => {
    const s = yorktownII()
    const t = v2pRaider()
    const cfg = { ...SENSOR_MODEL, override: { detection: 1 } }
    expect(detectionProbability(s, t, geom(4), cfg).p).toBe(1)
    expect(detectionProbability(s, t, geom(9), cfg).p).toBe(0)
  })
})
