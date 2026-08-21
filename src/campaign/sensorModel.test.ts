import { describe, expect, it } from 'vitest'
import {
  actorFromForm,
  cumulativeDetection,
  detectionProbability,
  falseContactChance,
  intelligenceProbability,
  reacquisitionProbability,
  retentionProbability,
  SENSOR_MODEL,
  type ScanGeometry,
  type SensorActor,
} from './sensorModel'

/**
 * The designer's own validation list (briefing §17), test for test. The
 * calibration anchor is his worked table — passive Yorktown II vs V-7D — and
 * every factor test isolates one dial by ratio, so the provisional
 * coefficients can be retuned from the real workbook without rewriting the
 * assertions that pin the *exact* formulas.
 */

const YORKTOWN_II = 'union-yorktown-ii-class-heavy-cruiser'
const V7D = 'vallari-v-7d-raider-class-battlecruiser'

const geom = (range: number, interveningTerrain = 0): ScanGeometry => ({ range, interveningTerrain })

function pair(): { searcher: SensorActor; target: SensorActor } {
  return { searcher: actorFromForm(YORKTOWN_II), target: actorFromForm(V7D) }
}

const detect = (s: SensorActor, t: SensorActor, range: number) =>
  detectionProbability(s, t, geom(range)).p
const intel = (s: SensorActor, t: SensorActor, range: number) =>
  intelligenceProbability(s, t, geom(range)).p

describe('calibration (§3): passive Yorktown II vs V-7D', () => {
  it('reads the range table exactly, 0 through 6', () => {
    const { searcher, target } = pair()
    const table = [0.9, 0.7, 0.5, 0.3, 0.1, 0.035, 0.01225]
    table.forEach((expected, range) => {
      expect(detect(searcher, target, range)).toBeCloseTo(expected, 10)
    })
  })

  it('compounds the approach sequence 4,3,3,2,2,1,1,0 to the printed cumulative', () => {
    const { searcher, target } = pair()
    const perScan = [4, 3, 3, 2, 2, 1, 1, 0].map((r) => detect(searcher, target, r))
    const printed = [0.1, 0.37, 0.559, 0.7795, 0.8898, 0.9669, 0.9901, 0.999]
    printed.forEach((expected, i) => {
      expect(cumulativeDetection(perScan.slice(0, i + 1))).toBeCloseTo(expected, 3)
    })
  })
})

describe('searcher active sensors (§6)', () => {
  it('doubles detection at ranges 0–2, smaller bonus at 3–6', () => {
    const { searcher, target } = pair()
    const active = { ...searcher, active: true }
    for (const r of [1, 2]) {
      expect(detect(active, target, r)).toBeCloseTo(Math.min(1, 2 * detect(searcher, target, r)), 10)
    }
    for (const r of [3, 5]) {
      const ratio = detect(active, target, r) / detect(searcher, target, r)
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(2)
    }
  })

  it('multiplies intelligence by 1.5 at ranges 0–2', () => {
    const { searcher, target } = pair()
    const active = { ...searcher, active: true }
    expect(intel(active, target, 2)).toBeCloseTo(Math.min(1, 1.5 * intel(searcher, target, 2)), 10)
  })
})

describe('target active emissions (§5)', () => {
  it('a target running active at speed 4 reads exactly like signature speed 11', () => {
    const { searcher, target } = pair()
    const active4 = { ...target, speed: 4, active: true }
    const passive11 = { ...target, speed: 11, active: false }
    expect(detect(searcher, active4, 3)).toBeCloseTo(detect(searcher, passive11, 3), 12)
    expect(intel(searcher, active4, 3)).toBeCloseTo(intel(searcher, passive11, 3), 12)
  })

  it('is additive, not a minimum: active at speed 4 beats passive at speed 7', () => {
    const { searcher, target } = pair()
    expect(detect(searcher, { ...target, speed: 4, active: true }, 3)).toBeGreaterThan(
      detect(searcher, { ...target, speed: 7 }, 3),
    )
  })
})

describe('target power signature (§8)', () => {
  it('MAX(0.5, 0.75 + 0.25 × power / 85): the printed examples', () => {
    const { searcher, target } = pair()
    const at = (power: number) => detect(searcher, { ...target, actualPower: power }, 3)
    expect(at(0) / at(85)).toBeCloseTo(0.75, 10)
    expect(at(170) / at(85)).toBeCloseTo(1.25, 10)
    // The floor: even a dead-cold hull is half as findable, never less.
    expect(at(-1000) / at(85)).toBeCloseTo(0.5, 10)
  })
})

describe('target size class (§9)', () => {
  it('MAX(0.10, 1 + 0.15 × (size − 4)): the printed examples', () => {
    const { searcher, target } = pair()
    const at = (size: number) => detect(searcher, { ...target, sizeClass: size }, 3)
    expect(at(2) / at(4)).toBeCloseTo(0.7, 10)
    expect(at(6) / at(4)).toBeCloseTo(1.3, 10)
    expect(at(7) / at(4)).toBeCloseTo(1.45, 10)
  })
})

describe('searcher speed (§4)', () => {
  it('degrades monotonically and keeps working past speed 10', () => {
    const { searcher, target } = pair()
    let last = Infinity
    for (const speed of [0, 2, 4, 6, 8, 10, 12, 15]) {
      const p = detect({ ...searcher, speed }, target, 1)
      expect(p).toBeLessThanOrEqual(last)
      expect(p).toBeGreaterThan(0)
      last = p
    }
  })

  it('at speed 10+, range > 1: detection ×0.10 and intelligence ×0.05 on top', () => {
    const { searcher, target } = pair()
    const slow = { ...searcher, speed: 9 }
    const fast = { ...searcher, speed: 10 }
    const curveRatioDet =
      detect(fast, target, 1) / detect(slow, target, 1) // no penalty inside range 1
    expect(detect(fast, target, 3) / detect(slow, target, 3)).toBeCloseTo(0.1 * curveRatioDet, 10)
    const curveRatioInt = intel(fast, target, 1) / intel(slow, target, 1)
    expect(intel(fast, target, 3) / intel(slow, target, 3)).toBeCloseTo(0.05 * curveRatioInt, 10)
  })

  it('intelligence degrades faster than detection at high speed', () => {
    const { searcher, target } = pair()
    const detRatio = detect({ ...searcher, speed: 8 }, target, 1) / detect(searcher, target, 1)
    const intRatio = intel({ ...searcher, speed: 8 }, target, 1) / intel(searcher, target, 1)
    expect(intRatio).toBeLessThan(detRatio)
  })
})

describe('civilian targets (§10)', () => {
  it('three times the final probability, capped at 100%', () => {
    const { searcher, target } = pair()
    const freighter = { ...target, unitType: 'civilian' as const }
    expect(detect(searcher, freighter, 4)).toBeCloseTo(3 * detect(searcher, target, 4), 10)
    expect(intel(searcher, freighter, 4)).toBeCloseTo(3 * intel(searcher, target, 4), 10)
    expect(detect(searcher, freighter, 0)).toBe(1) // 3 × 90% caps
  })
})

describe('damage signature (§11)', () => {
  it('+5 points per full 20 damage, additive, only inside range 6', () => {
    const { searcher, target } = pair()
    const base = detect(searcher, target, 3)
    expect(detect(searcher, { ...target, damage: 19 }, 3)).toBeCloseTo(base, 10)
    expect(detect(searcher, { ...target, damage: 20 }, 3)).toBeCloseTo(base + 0.05, 10)
    expect(detect(searcher, { ...target, damage: 40 }, 3)).toBeCloseTo(base + 0.1, 10)
    const far = detect(searcher, target, 7)
    expect(detect(searcher, { ...target, damage: 40 }, 7)).toBeCloseTo(far, 10)
  })
})

describe('scout and command (§7)', () => {
  it('scout points: +25% each to detection, +20% each to intelligence', () => {
    const { searcher, target } = pair()
    const plain = { ...searcher, scoutSensors: 0, command: 0 }
    const scout2 = { ...plain, scoutSensors: 2 }
    expect(detect(scout2, target, 3) / detect(plain, target, 3)).toBeCloseTo(1.5, 10)
    expect(intel(scout2, target, 3) / intel(plain, target, 3)).toBeCloseTo(1.4, 10)
  })

  it('command counts only without a scout block: +5% detection, +15% intelligence', () => {
    const { searcher, target } = pair()
    const plain = { ...searcher, scoutSensors: 0, command: 0 }
    const command2 = { ...plain, command: 2 }
    expect(detect(command2, target, 3) / detect(plain, target, 3)).toBeCloseTo(1.1, 10)
    expect(intel(command2, target, 3) / intel(plain, target, 3)).toBeCloseTo(1.3, 10)
    const both = { ...plain, scoutSensors: 1, command: 5 }
    const scoutOnly = { ...plain, scoutSensors: 1 }
    expect(detect(both, target, 3)).toBeCloseTo(detect(scoutOnly, target, 3), 12)
  })
})

describe('intelligence close range (§12)', () => {
  it('doubles at ranges 0–1, capped at 100%', () => {
    const { searcher, target } = pair()
    const r1 = intelligenceProbability(searcher, target, geom(1))
    expect(r1.factors.closeRange).toBe(2)
    expect(r1.p).toBeLessThanOrEqual(1)
    const r2 = intelligenceProbability(searcher, target, geom(2))
    expect(r2.factors.closeRange).toBeUndefined()
  })

  it('detected is not identified: the checks are separate and intel is harder', () => {
    const { searcher, target } = pair()
    expect(intel(searcher, target, 3)).toBeLessThan(detect(searcher, target, 3))
  })
})

describe('cloak and terrain (§15)', () => {
  it('cloak cuts detection substantially but never to zero', () => {
    const { searcher, target } = pair()
    const dark = { ...target, cloaked: true }
    expect(detect(searcher, dark, 2)).toBeLessThan(detect(searcher, target, 2) * 0.3)
    expect(detect(searcher, dark, 2)).toBeGreaterThan(0)
  })

  it('target terrain, searcher terrain and intervening terrain each cost', () => {
    const { searcher, target } = pair()
    const base = detect(searcher, target, 3)
    expect(detect(searcher, { ...target, terrain: 2 }, 3)).toBeLessThan(base)
    expect(detect({ ...searcher, terrain: 2 }, target, 3)).toBeLessThan(base)
    expect(detectionProbability(searcher, target, geom(3, 2)).p).toBeLessThan(base)
  })
})

describe('track maintenance (§13)', () => {
  it('retention: 85% base, +10 closer, −10 per hex farther, +10% × intel', () => {
    expect(retentionProbability(3, 3, 0)).toBeCloseTo(0.85, 10)
    expect(retentionProbability(3, 2, 0)).toBeCloseTo(0.95, 10)
    expect(retentionProbability(3, 5, 0)).toBeCloseTo(0.65, 10)
    expect(retentionProbability(3, 3, 0.5)).toBeCloseTo(0.9, 10)
    // Clamps: [5%, 99%].
    expect(retentionProbability(3, 20, 0)).toBe(0.05)
    expect(retentionProbability(3, 2, 1)).toBeCloseTo(0.99, 10)
  })

  it('reacquisition beats a comparable fresh search by at least 10 points, unless capped', () => {
    for (const fresh of [0.05, 0.3, 0.6, 0.9]) {
      const p = reacquisitionProbability(fresh, 3, 3, 0)
      expect(p).toBeGreaterThanOrEqual(Math.min(0.95, fresh + 0.1))
    }
    expect(reacquisitionProbability(0.94, 3, 3, 0)).toBe(0.95) // cap
    // The formula arm: 50% + adjustment + 20% × intel.
    expect(reacquisitionProbability(0, 3, 2, 0.5)).toBeCloseTo(0.7, 10)
  })
})

describe('false contacts (§14)', () => {
  it('0.5% per passive scan, 0.1% per active scan', () => {
    expect(falseContactChance(false)).toBeCloseTo(0.005, 10)
    expect(falseContactChance(true)).toBeCloseTo(0.001, 10)
  })
})

describe('caps and edges (§16–§17)', () => {
  it('every probability stays in [0, 1], including hostile inputs', () => {
    const { searcher, target } = pair()
    const monster: SensorActor = {
      ...target,
      actualPower: 10000,
      sizeClass: 10,
      speed: 25,
      active: true,
      damage: 100,
      unitType: 'civilian',
      shipCount: 8,
    }
    expect(detect(searcher, monster, 0)).toBe(1)
    const whisper: SensorActor = { ...target, actualPower: 0, sizeClass: 1, cloaked: true, terrain: 2 }
    const p = detect({ ...searcher, speed: 30, terrain: 2 }, whisper, 12)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThan(0.001)
  })

  it('the cumulative rule is 1 − PRODUCT(1 − p)', () => {
    expect(cumulativeDetection([0.5, 0.5])).toBeCloseTo(0.75, 10)
    expect(cumulativeDetection([])).toBe(0)
    expect(cumulativeDetection([1, 0.1])).toBe(1)
  })

  it('coefficients override through the config without touching the module', () => {
    const { searcher, target } = pair()
    const cfg = { ...SENSOR_MODEL, civilianMultiplier: 2 }
    const p = detectionProbability(searcher, { ...target, unitType: 'civilian' }, geom(4), cfg).p
    expect(p).toBeCloseTo(2 * detect(searcher, target, 4), 10)
  })
})
