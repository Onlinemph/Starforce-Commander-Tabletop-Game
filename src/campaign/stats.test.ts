import { describe, expect, it } from 'vitest'
import { FILE_FORMS, registerCustomForms, SHIP_FORMS, shipFormById } from '../data/ships'
import { operationalStats } from './stats'

/**
 * Operational stats are derived over the whole canon roster (3.1), pinned by
 * the doc's sanity anchors (3.1.1): a formula change that breaks an anchor is
 * wrong; the anchor is not. Two anchors were corrected against the data —
 * V-7 carries no cloak in this roster (Aurelian hulls do), and KNOX II's
 * survey character lives in its Scout Sensor block — see stats.ts.
 */

registerCustomForms(FILE_FORMS)

const canon = SHIP_FORMS.filter((f) => !f.id.startsWith('fan-') && f.pointValue > 0)
const stats = (id: string) => operationalStats(shipFormById(id)!)

describe('the derivation covers the roster', () => {
  it('derives in-range stats for every canon hull', () => {
    expect(canon.length).toBeGreaterThanOrEqual(93)
    for (const form of canon) {
      const s = operationalStats(form)
      expect(s.signature, form.id).toBeGreaterThanOrEqual(1)
      expect(s.signature, form.id).toBeLessThanOrEqual(10)
      expect(s.sensorRating, form.id).toBeGreaterThanOrEqual(1)
      expect(s.sensorRating, form.id).toBeLessThanOrEqual(10)
      expect(s.sciences, form.id).toBeGreaterThanOrEqual(0)
      expect(s.sciences, form.id).toBeLessThanOrEqual(5)
      expect(s.endurance, form.id).toBeGreaterThanOrEqual(4)
      expect(s.endurance, form.id).toBeLessThanOrEqual(8)
      expect(s.combatValue, form.id).toBe(form.pointValue)
      // The speed ladder is ordered and starts at a real crawl or better.
      expect(s.speeds.cruise, form.id).toBeGreaterThanOrEqual(1)
      expect(s.speeds.maxCruise, form.id).toBeGreaterThanOrEqual(s.speeds.cruise)
      expect(s.speeds.maximum, form.id).toBeGreaterThanOrEqual(s.speeds.maxCruise)
      expect(s.speeds.emergency, form.id).toBe(s.speeds.maximum + 1)
      // Sensor power buys acuity, never sells it.
      expect(s.sensorRatings[0], form.id).toBeLessThanOrEqual(s.sensorRatings[1])
      expect(s.sensorRatings[1], form.id).toBeLessThanOrEqual(s.sensorRatings[2])
      expect(s.sensorRatings[2], form.id).toBe(s.sensorRating)
    }
  })

  it('spreads signatures instead of bunching them', () => {
    const seen = new Set(canon.map((f) => operationalStats(f).signature))
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })
})

describe('sanity anchors (3.1.1)', () => {
  it('Hermes scout: quiet and sharp-eyed', () => {
    const s = stats('union-hermes-i-class-scout')
    expect(s.signature).toBeLessThanOrEqual(3)
    expect(s.sensorRating).toBeGreaterThanOrEqual(7)
  })

  it('Yorktown III: a heavy cruiser sounds like one', () => {
    const s = stats('union-yorktown-iii-class-heavy-cruiser')
    expect(s.signature).toBeGreaterThanOrEqual(6)
    expect(s.signature).toBeLessThanOrEqual(7)
  })

  it('UNION III: a dreadnought is loud', () => {
    expect(stats('union-union-iii-class-dreadnought').signature).toBeGreaterThanOrEqual(8)
  })

  it('cloak reads off the form: Aurelian hulls carry it, the V-7 does not', () => {
    // The doc's anchor said "V-7: cloak true"; in this roster cloaking is an
    // Aurelian line on all 31 of their hulls and nobody else's. Part 12
    // material for Doyle — the derivation follows the data.
    expect(stats('aurelian-corvus-i-class-destroyer').cloak).toBe(true)
    expect(stats('vallari-v-7c-raider-class-battlecruiser').cloak).toBe(false)
    expect(stats('union-yorktown-i-class-heavy-cruiser').cloak).toBe(false)
    expect(canon.filter((f) => operationalStats(f).cloak)).toHaveLength(31)
  })

  it('Knox II survey cruiser: sciences at the top of the scale', () => {
    expect(stats('union-knox-ii-class-survey-cruiser').sciences).toBeGreaterThanOrEqual(4)
  })

  it('a pinned sample, so drift is a diff and not a surprise', () => {
    expect(stats('union-hermes-i-class-scout')).toEqual({
      signature: 3,
      sensorRating: 8,
      sensorRatings: [4, 5, 8],
      sciences: 4,
      endurance: 5,
      cloak: false,
      ftlRating: 1,
      speeds: { cruise: 4, maxCruise: 6, maximum: 10, emergency: 11 },
      combatValue: 21,
      actualPower: 55.46666666666667,
      sizeClass: 3,
      scoutSensors: 3,
      commandBoxes: 0,
      sensorValues: [2, 3, 6],
      sciencesRaw: 2,
      sensBoxes: 3,
    })
    expect(stats('union-union-iii-class-dreadnought')).toEqual({
      signature: 10,
      sensorRating: 9,
      sensorRatings: [5, 7, 9],
      sciences: 4,
      endurance: 8,
      cloak: false,
      ftlRating: 3,
      speeds: { cruise: 6, maxCruise: 10, maximum: 12, emergency: 13 },
      combatValue: 158.5,
      actualPower: 259.2839881133813,
      sizeClass: 7,
      scoutSensors: 0,
      commandBoxes: 5,
      sensorValues: [4, 6, 8],
      sciencesRaw: 4,
      sensBoxes: 4,
    })
    expect(stats('vallari-v-7c-raider-class-battlecruiser')).toEqual({
      signature: 4,
      sensorRating: 6,
      sensorRatings: [2, 4, 6],
      sciences: 2,
      endurance: 6,
      cloak: false,
      ftlRating: 2,
      speeds: { cruise: 4, maxCruise: 6, maximum: 9, emergency: 10 },
      combatValue: 25,
      actualPower: 93.25429727095296,
      sizeClass: 4,
      scoutSensors: 0,
      commandBoxes: 0,
      sensorValues: [2, 4, 6],
      sciencesRaw: 2,
      sensBoxes: 3,
    })
  })

  it("the designer's own speed examples come out true", () => {
    // "a Yorktown has 9" for Maximum Speed (FTL circles ×2 + SIF), and
    // "most ships have a 4" for cruising (FTL circles + 1).
    const yorktown = stats('union-yorktown-i-class-heavy-cruiser').speeds
    expect(yorktown).toEqual({ cruise: 4, maxCruise: 6, maximum: 9, emergency: 10 })
    const cruises = canon.map((f) => operationalStats(f).speeds.cruise)
    const atFour = cruises.filter((c) => c === 4).length
    expect(atFour).toBeGreaterThan(canon.length / 2)
  })
})
