import { describe, expect, it } from 'vitest'
import { DAMAGE_DECK, HIT_LABELS, PRECISION_SECTION } from './damageDeck'
import { DIE_FACES, FACE_DAMAGE } from '../engine/dice'
import type { DamageCategory } from '../engine/types'

/**
 * Integrity of the damage deck transcribed from the print-and-play card sheets,
 * and of the die faces transcribed from the Captain's Reference Card.
 */

describe('damage deck (A2.6, E8)', () => {
  it('holds exactly 56 cards', () => {
    expect(DAMAGE_DECK.length).toBe(56)
  })

  it('gives every card a unique id', () => {
    const ids = DAMAGE_DECK.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses only the six printed colour categories (E8.2 – E8.7)', () => {
    const categories: DamageCategory[] = [
      'defense',
      'weapon',
      'general',
      'engineering',
      'critical',
      'structure',
    ]
    for (const card of DAMAGE_DECK) expect(categories).toContain(card.category)
  })

  it('labels every hit it can produce', () => {
    for (const card of DAMAGE_DECK) {
      expect(HIT_LABELS[card.primary], card.primary).toBeTruthy()
      if (card.alt) expect(HIT_LABELS[card.alt], card.alt).toBeTruthy()
    }
  })

  it('gives critical hits no alternate hit (E8.6)', () => {
    const critical = DAMAGE_DECK.filter((c) => c.category === 'critical')
    expect(critical.length).toBe(6)
    for (const card of critical) expect(card.alt, card.primary).toBeUndefined()
    // The six printed criticals.
    expect(critical.map((c) => c.primary).sort()).toEqual([
      'battery-power-loss',
      'bridge-hit',
      'main-engineering-hit',
      'major-fire',
      'minor-fire',
      'no-effect',
    ])
  })

  it('gives every non-critical card an alternate hit (E7.3.7)', () => {
    for (const card of DAMAGE_DECK) {
      if (card.category === 'critical') continue
      expect(card.alt, `${card.category}/${card.primary}`).toBeTruthy()
    }
  })

  it('carries Stress Damage icons on a minority of cards (C3.1.4)', () => {
    const stress = DAMAGE_DECK.filter((c) => c.stressIcon)
    expect(stress.length).toBe(13)
    // A stress check draws Stress Rating cards and damages on any icon, so the
    // icon has to be uncommon enough for low-rated ships to often pass.
    expect(stress.length / DAMAGE_DECK.length).toBeLessThan(0.3)
  })

  it('keeps every precision-targetable hit out of the critical category (E8.6)', () => {
    for (const card of DAMAGE_DECK) {
      if (card.category === 'critical') {
        expect(PRECISION_SECTION[card.primary], card.primary).toBeUndefined()
      }
    }
  })

  it('never points an alternate hit at a critical result (E8.6)', () => {
    const criticalHits = new Set(
      DAMAGE_DECK.filter((c) => c.category === 'critical').map((c) => c.primary),
    )
    for (const card of DAMAGE_DECK) {
      if (card.alt) expect(criticalHits.has(card.alt), card.alt).toBe(false)
    }
  })
})

describe('attack dice (A2.7, Captain\'s Reference Card)', () => {
  it('has six faces per die', () => {
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      expect(DIE_FACES[color], color).toHaveLength(6)
    }
  })

  it('gives only red dice a Special face (E7.2.5)', () => {
    expect(DIE_FACES.red.filter((f) => f === 'S')).toHaveLength(3)
    for (const color of ['yellow', 'green', 'blue'] as const) {
      expect(DIE_FACES[color], color).not.toContain('S')
    }
  })

  it('caps each die at its printed maximum result (J3.2.5)', () => {
    // Red → S, yellow and green → H, blue → M.
    expect(DIE_FACES.blue).not.toContain('H')
    expect(DIE_FACES.green).toContain('H')
    expect(DIE_FACES.yellow).toContain('H')
  })

  it('orders potency red > yellow > green > blue (A2.7)', () => {
    const mean = (color: 'red' | 'yellow' | 'green' | 'blue', specialDamage: number) =>
      DIE_FACES[color].reduce(
        (sum, f) => sum + (f === 'S' ? specialDamage : FACE_DAMAGE[f]),
        0,
      ) / 6

    // Compare with a modest Special value so red is not flattered by a
    // ship-killer torpedo's SPCL line.
    const s = 4
    expect(mean('red', s)).toBeGreaterThan(mean('yellow', s))
    expect(mean('yellow', s)).toBeGreaterThan(mean('green', s))
    expect(mean('green', s)).toBeGreaterThan(mean('blue', s))
  })

  it('misses on exactly one face, except blue which misses on two', () => {
    expect(DIE_FACES.red.filter((f) => f === '-')).toHaveLength(1)
    expect(DIE_FACES.yellow.filter((f) => f === '-')).toHaveLength(1)
    expect(DIE_FACES.green.filter((f) => f === '-')).toHaveLength(1)
    expect(DIE_FACES.blue.filter((f) => f === '-')).toHaveLength(2)
  })
})
