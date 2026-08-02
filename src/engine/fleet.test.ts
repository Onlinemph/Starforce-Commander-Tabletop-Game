import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, shipFormById } from '../data/ships'
import {
  BLUE,
  printedForce,
  RED,
  scenarioSides,
  SCENARIOS,
  startScenario,
} from '../data/scenarios'
import {
  availabilityIn,
  fleetFormIds,
  fleetPoints,
  fleetSize,
  MAX_SHIPS_PER_SIDE,
  validateFleets,
  type FleetEntry,
} from './fleet'
import type { ShipForm } from './types'

const forms = new Map(SHIP_FORMS.map((f) => [f.id, f]))
const byName = (fragment: string): ShipForm =>
  SHIP_FORMS.find((f) => f.name.toUpperCase().includes(fragment.toUpperCase()))!

const errors = (problems: ReturnType<typeof validateFleets>) =>
  problems.filter((p) => p.severity === 'error').map((p) => p.message)

/**
 * S2.5.4's availability limits are advisory here: they are told to the player
 * and never block the battle, because a digital table that refuses to deal
 * the cards is worse than one that lets a friendly game bend a tournament
 * rule. Structural impossibilities — an empty force, more hulls than the
 * setup zone holds — remain errors.
 */
const advice = (problems: ReturnType<typeof validateFleets>) =>
  problems.filter((p) => p.severity === 'warning').map((p) => p.message)

// ---------------------------------------------------------------------------
// S2.5.4 availability
// ---------------------------------------------------------------------------

describe('ship availability (S2.5.4)', () => {
  const ship = (availability: ShipForm['availability'], year: number) =>
    ({ availability, year, pointValue: 10, name: 'X', id: 'x' }) as ShipForm

  it('holds a class at its printed rarity when the year is not in play', () => {
    expect(availabilityIn(ship('rare', 3600))).toBe('rare')
  })

  it('walks a new class from rare to common over its first three years', () => {
    const common = ship('common', 3600)
    expect(availabilityIn(common, 3600)).toBe('rare')
    expect(availabilityIn(common, 3601)).toBe('uncommon')
    expect(availabilityIn(common, 3602)).toBe('common')
    expect(availabilityIn(common, 3650)).toBe('common')
  })

  it('never lets a class become more available than its printed maximum', () => {
    const rare = ship('rare', 3600)
    expect(availabilityIn(rare, 3650)).toBe('rare')
    const unique = ship('unique', 3600)
    expect(availabilityIn(unique, 3650)).toBe('unique')
  })

  it('refuses a class that has not entered service', () => {
    expect(availabilityIn(ship('common', 3600), 3599)).toBe('unavailable')
  })
})

// ---------------------------------------------------------------------------
// Force composition
// ---------------------------------------------------------------------------

describe('force composition (S2.5)', () => {
  const entry = (form: ShipForm, count = 1): FleetEntry => ({ formId: form.id, count })

  it('adds up a force by point value and hull count', () => {
    const yorktown = byName('YORKTOWN I-class')
    const list = [entry(yorktown, 3)]
    expect(fleetPoints(list, forms)).toBe(yorktown.pointValue * 3)
    expect(fleetSize(list)).toBe(3)
    expect(fleetFormIds(list)).toEqual([yorktown.id, yorktown.id, yorktown.id])
  })

  it('accepts a force of common ships', () => {
    const common = SHIP_FORMS.find((f) => f.availability === 'common')!
    const problems = validateFleets([{ side: BLUE, entries: [entry(common, 2)] }], forms)
    expect(errors(problems)).toEqual([])
  })

  it('rejects an empty force', () => {
    expect(errors(validateFleets([{ side: BLUE, entries: [] }], forms))).toEqual([
      'The force has no ships.',
    ])
  })

  it('allows a lone uncommon ship however expensive it is', () => {
    // "You can always have at least one uncommon ship within your force."
    const uncommon = SHIP_FORMS.find((f) => f.availability === 'uncommon')!
    const cheap = SHIP_FORMS.find(
      (f) => f.availability === 'common' && f.pointValue < uncommon.pointValue / 4,
    )!
    const problems = validateFleets(
      [{ side: BLUE, entries: [entry(uncommon), entry(cheap)] }],
      forms,
    )
    expect(errors(problems)).toEqual([])
  })

  it('holds a second uncommon ship to 40% of the force', () => {
    const uncommon = SHIP_FORMS.find((f) => f.availability === 'uncommon')!
    const problems = validateFleets([{ side: BLUE, entries: [entry(uncommon, 2)] }], forms)
    expect(advice(problems).join(' ')).toMatch(/Uncommon ships are 100%/)
    expect(errors(problems)).toEqual([])
  })

  it('lets a second uncommon ship in once the force is big enough', () => {
    const uncommon = SHIP_FORMS.find((f) => f.availability === 'uncommon')!
    const common = SHIP_FORMS.filter((f) => f.availability === 'common').sort(
      (a, b) => b.pointValue - a.pointValue,
    )[0]
    // Two uncommon hulls need commons worth at least 1.5x their value.
    const need = Math.ceil((uncommon.pointValue * 2 * 1.5) / common.pointValue)
    const problems = validateFleets(
      [{ side: BLUE, entries: [entry(uncommon, 2), entry(common, need)] }],
      forms,
    )
    expect(errors(problems)).toEqual([])
  })

  it('holds rare ships to 20% with no exemption for the first one', () => {
    const rare = SHIP_FORMS.find((f) => f.availability === 'rare')!
    const problems = validateFleets([{ side: BLUE, entries: [entry(rare)] }], forms)
    // "These ships are valuable and rarely travel alone" — a lone rare ship is
    // 100% of its force, so it needs an escort.
    expect(advice(problems).join(' ')).toMatch(/Rare ships are 100%/)
    expect(errors(problems)).toEqual([])
  })

  it('allows one unique ship in a battle but not two', () => {
    const unique = SHIP_FORMS.filter((f) => f.availability === 'unique')
    if (unique.length < 2) return
    const one = validateFleets([{ side: BLUE, entries: [entry(unique[0])] }], forms)
    expect(errors(one).some((m) => /unique/.test(m))).toBe(false)
    const two = validateFleets(
      [
        { side: BLUE, entries: [entry(unique[0])] },
        { side: RED, entries: [entry(unique[1])] },
      ],
      forms,
    )
    expect(advice(two).join(' ')).toMatch(/unique ships are in the battle/)
    expect(errors(two)).toEqual([])
  })

  it('refuses a class that has not entered service by the battle year', () => {
    const late = [...SHIP_FORMS].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0]
    const problems = validateFleets([{ side: BLUE, entries: [entry(late)] }], forms, {
      year: (late.year ?? 0) - 1,
    })
    expect(advice(problems).join(' ')).toMatch(/does not enter service until/)
    expect(errors(problems)).toEqual([])
  })

  it('applies the point budget', () => {
    const form = byName('YORKTOWN I-class')
    const over = validateFleets([{ side: BLUE, entries: [entry(form, 3)] }], forms, {
      budget: form.pointValue * 2,
    })
    expect(errors(over).join(' ')).toMatch(/against a budget of/)
    const under = validateFleets([{ side: BLUE, entries: [entry(form)] }], forms, {
      budget: form.pointValue * 4,
    })
    expect(under.some((p) => p.severity === 'warning')).toBe(true)
  })

  it('caps a force at what a setup zone holds', () => {
    const form = byName('YORKTOWN I-class')
    const problems = validateFleets(
      [{ side: BLUE, entries: [entry(form, MAX_SHIPS_PER_SIDE + 1)] }],
      forms,
    )
    expect(errors(problems).join(' ')).toMatch(/setup zone holds at most/)
  })
})

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

describe('deploying a composed force', () => {
  it('still deploys every scenario exactly as printed', () => {
    for (const { scenario } of SCENARIOS) {
      const game = startScenario(scenario.id, { seed: 1 })
      expect(game.ships.length, scenario.name).toBeGreaterThan(0)
      for (const ship of game.ships) {
        expect(ship.placement.position.x).toBeGreaterThan(0)
        expect(ship.placement.position.x).toBeLessThan(scenario.bounds.width)
        expect(ship.placement.position.y).toBeGreaterThan(0)
        expect(ship.placement.position.y).toBeLessThan(scenario.bounds.height)
      }
    }
  })

  it('reports the force a scenario prints', () => {
    expect(scenarioSides('s3.1-the-duel')).toEqual([BLUE, RED])
    expect(printedForce('s3.1-the-duel', BLUE)).toHaveLength(1)
    expect(printedForce('exp2-squadron-engagement', BLUE)).toHaveLength(3)
  })

  it('fields a composed force in place of the printed one', () => {
    const scout = byName('HERMES I-class')
    const game = startScenario('s3.1-the-duel', {
      fleets: { [BLUE]: [scout.id, scout.id, scout.id] },
      seed: 1,
    })
    const blue = game.ships.filter((s) => s.side === BLUE)
    expect(blue).toHaveLength(3)
    expect(blue.every((s) => s.form.id === scout.id)).toBe(true)
    // Red keeps the printed force.
    expect(game.ships.filter((s) => s.side === RED)).toHaveLength(1)
  })

  it('gives every ship its own name and id', () => {
    const form = byName('YORKTOWN I-class')
    const game = startScenario('s3.1-the-duel', {
      fleets: { [BLUE]: Array.from({ length: MAX_SHIPS_PER_SIDE }, () => form.id) },
      seed: 1,
    })
    const blue = game.ships.filter((s) => s.side === BLUE)
    expect(new Set(blue.map((s) => s.id)).size).toBe(MAX_SHIPS_PER_SIDE)
    expect(new Set(blue.map((s) => s.name)).size).toBe(MAX_SHIPS_PER_SIDE)
  })

  it('keeps a full force inside the map and off each other', () => {
    const form = byName('YORKTOWN I-class')
    for (const { scenario } of SCENARIOS) {
      const sides = scenarioSides(scenario.id)
      const game = startScenario(scenario.id, {
        fleets: Object.fromEntries(
          sides.map((s) => [s, Array.from({ length: MAX_SHIPS_PER_SIDE }, () => form.id)]),
        ),
        seed: 1,
      })
      expect(game.ships).toHaveLength(sides.length * MAX_SHIPS_PER_SIDE)
      for (const ship of game.ships) {
        const { x, y } = ship.placement.position
        expect(x, `${scenario.name} x`).toBeGreaterThanOrEqual(1.5)
        expect(x, `${scenario.name} x`).toBeLessThanOrEqual(scenario.bounds.width - 1.5)
        expect(y, `${scenario.name} y`).toBeGreaterThanOrEqual(1.5)
        expect(y, `${scenario.name} y`).toBeLessThanOrEqual(scenario.bounds.height - 1.5)
      }
      // Counters are 1.5 inches across, so no two may sit closer than that.
      for (const a of game.ships) {
        for (const b of game.ships) {
          if (a === b) continue
          const d = Math.hypot(
            a.placement.position.x - b.placement.position.x,
            a.placement.position.y - b.placement.position.y,
          )
          expect(d, `${scenario.name}: ${a.name} and ${b.name} overlap`).toBeGreaterThanOrEqual(1.5)
        }
      }
    }
  })

  it('ignores form ids that are not in the roster', () => {
    const game = startScenario('s3.1-the-duel', { fleets: { [BLUE]: ['nonsense'] }, seed: 1 })
    // Falls back to the printed force rather than deploying nothing.
    expect(game.ships.filter((s) => s.side === BLUE)).toHaveLength(1)
    expect(shipFormById('nonsense')).toBeUndefined()
  })
})
