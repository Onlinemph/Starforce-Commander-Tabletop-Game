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
      sciences: 4,
      endurance: 5,
      cloak: false,
      ftlRating: 1,
      combatValue: 21,
    })
    expect(stats('union-union-iii-class-dreadnought')).toEqual({
      signature: 10,
      sensorRating: 9,
      sciences: 4,
      endurance: 8,
      cloak: false,
      ftlRating: 3,
      combatValue: 158.5,
    })
    expect(stats('vallari-v-7c-raider-class-battlecruiser')).toEqual({
      signature: 4,
      sensorRating: 6,
      sciences: 2,
      endurance: 6,
      cloak: false,
      ftlRating: 2,
      combatValue: 25,
    })
  })
})
