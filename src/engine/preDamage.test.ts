import { describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'
import { registerCustomScenarios, startScenario, THE_DUEL } from '../data/scenarios'
import { createGame, pointsAgainst, victoryPoints } from './game'
import {
  applyPreDamage,
  createShip,
  damageControlRating,
  structureRemaining,
  structureTotal,
  type ShipState,
} from './shipState'

/**
 * Ships fielded already hurt (S2.8 baseline).
 *
 * A rescue scenario needs a cripple and a campaign needs last week's
 * survivors, but the victory rules assume every hull starts whole — S2.8.2
 * prices damage from zero. So pre-damage is two separate promises: the wounds
 * are physically real (boxes marked, damage control degraded, stress checks
 * remember), and the ledger scores only what this battle adds. A fleet that
 * finishes off a 90%-dead wreck earns the last sliver of its value, not the
 * whole prize.
 */

function hull(form = YORKTOWN): ShipState {
  return createShip({
    id: 'ship',
    side: 'Blue',
    name: 'TEST HULL',
    form,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 2,
  })
}

describe('applyPreDamage', () => {
  it('marks the fraction of the track and records the baseline', () => {
    const ship = hull()
    const total = structureTotal(ship)
    applyPreDamage(ship, 0.5)
    const marked = total - structureRemaining(ship)
    expect(marked).toBe(Math.floor(total * 0.5))
    expect(ship.preDamaged).toBe(marked)
  })

  it('stops one box short of destruction however large the fraction', () => {
    const ship = hull()
    applyPreDamage(ship, 5)
    expect(structureRemaining(ship)).toBe(1)
    expect(ship.destroyed).toBe(false)
  })

  it('degrades damage control like real hits, because the scars are real (B3.1.2)', () => {
    const fresh = hull()
    const scarred = hull()
    applyPreDamage(scarred, 0.75)
    expect(scarred.structureHitsTaken).toBe(scarred.preDamaged)
    expect(damageControlRating(scarred)).toBeLessThan(damageControlRating(fresh))
  })
})

describe('the victory ledger scores only this battle (S2.8.2 baseline)', () => {
  it('concedes nothing at the opening bell', () => {
    const ship = hull()
    applyPreDamage(ship, 0.9)
    expect(pointsAgainst(ship)).toBe(0)
  })

  it('prices new damage from the baseline, not from zero', () => {
    // YORKTOWN's printed table: 7 boxes -> 12 points, 10 boxes -> 17.
    const ship = hull()
    applyPreDamage(ship, 0.5) // 6 of 13 boxes
    expect(ship.preDamaged).toBe(6)
    for (let i = 0; i < 4; i++) ship.structureDamaged[ship.structureDamaged.findIndex((d) => !d)] = true
    // 10 damaged: the table says 17, the baseline of 6 says 6 — this battle
    // earned the difference.
    expect(pointsAgainst(ship)).toBe(17 - 6)
  })

  it('awards the gap to full value for destroying a pre-damaged hull, not the whole prize', () => {
    const ship = hull()
    applyPreDamage(ship, 0.9) // 11 of 13 boxes; the table prices 11 at 17
    ship.destroyed = true
    expect(pointsAgainst(ship)).toBe(ship.form.pointValue - 17)
    const fresh = hull()
    fresh.destroyed = true
    expect(pointsAgainst(fresh)).toBe(fresh.form.pointValue)
  })

  it('holds the ledger at zero even if repairs take the ship above its baseline', () => {
    const ship = hull()
    applyPreDamage(ship, 0.5)
    // Damage control patches two black boxes: current damage below baseline.
    ship.structureDamaged[ship.structureDamaged.findIndex((d) => d)] = false
    ship.structureDamaged[ship.structureDamaged.findIndex((d) => d)] = false
    expect(pointsAgainst(ship)).toBe(0)
  })
})

describe('a designed scenario fields wounded ships', () => {
  const RESCUE = {
    id: 'test-rescue',
    name: 'The Rescue',
    background: '',
    victory: 'destruction',
    bounds: { width: 36, height: 36, fixed: true },
    terrain: [],
    sides: [
      {
        side: 'Blue',
        objective: 'save the cripple',
        facing: 2,
        speed: 2,
        anchor: { x: 6, y: 18 },
        spread: { x: 0, y: 4 },
        force: ['union-yorktown-i-class-heavy-cruiser', 'union-yorktown-i-class-heavy-cruiser'],
        damage: [0, 0.9],
      },
      {
        side: 'Red',
        objective: 'finish it',
        facing: 6,
        speed: 4,
        anchor: { x: 30, y: 18 },
        spread: { x: 0, y: 4 },
        force: ['vallari-v-7c-raider-class-battlecruiser'],
      },
    ],
  }

  it('deploys the damage by force index and replays derive the same baseline', () => {
    registerCustomScenarios([RESCUE])
    const game = startScenario('test-rescue', { seed: 11 })
    const [escort, cripple] = game.ships.filter((s) => s.side === 'Blue')
    expect(escort.preDamaged).toBe(0)
    expect(structureRemaining(escort)).toBe(structureTotal(escort))
    const total = structureTotal(cripple)
    expect(total - structureRemaining(cripple)).toBe(Math.floor(total * 0.9))
    expect(cripple.preDamaged).toBe(Math.floor(total * 0.9))
    expect(pointsAgainst(cripple)).toBe(0)

    // The baseline is re-derived from the scenario, never carried by a save:
    // the same setup produces the same wounds.
    const again = startScenario('test-rescue', { seed: 11 })
    const twin = again.ships.filter((s) => s.side === 'Blue')[1]
    expect(twin.structureDamaged).toEqual(cripple.structureDamaged)
    registerCustomScenarios([])
  })

  it('leaves printed scenarios untouched', () => {
    const game = createGame({ scenario: THE_DUEL, ships: [hull()], seed: 1 })
    expect(game.ships[0].preDamaged).toBe(0)
  })
})

describe('a scenario re-prices its hulls (S2.8 override)', () => {
  it('scores the override by damage fractions, ignoring the printed table', () => {
    const ship = hull()
    ship.pointValue = 100
    // 7 of 13 boxes is moderate (50%): half of 100, not the table's 12.
    for (let i = 0; i < 7; i++) ship.structureDamaged[i] = true
    expect(pointsAgainst(ship)).toBe(50)
    ship.destroyed = true
    expect(pointsAgainst(ship)).toBe(100)
  })

  it('keeps the printed victory table while the book value stands', () => {
    const ship = hull()
    for (let i = 0; i < 7; i++) ship.structureDamaged[i] = true
    expect(pointsAgainst(ship)).toBe(12)
  })

  it('composes with pre-damage: the override prices only this battle', () => {
    const ship = hull()
    ship.pointValue = 100
    applyPreDamage(ship, 0.5) // 6 of 13: minor side of moderate -> 25%
    ship.destroyed = true
    expect(pointsAgainst(ship)).toBe(100 - 25)
  })

  it('flows from the scenario side to the deployed hull', () => {
    registerCustomScenarios([
      {
        id: 'test-worth',
        name: 'The Freighter',
        background: '',
        victory: '',
        bounds: { width: 36, height: 36, fixed: true },
        terrain: [],
        sides: [
          {
            side: 'Blue',
            objective: '',
            facing: 2,
            speed: 2,
            anchor: { x: 6, y: 18 },
            spread: { x: 0, y: 4 },
            force: ['union-yorktown-i-class-heavy-cruiser', 'union-yorktown-i-class-heavy-cruiser'],
            value: [0, 60],
          },
          {
            side: 'Red',
            objective: '',
            facing: 6,
            speed: 4,
            anchor: { x: 30, y: 18 },
            spread: { x: 0, y: 4 },
            force: ['vallari-v-7c-raider-class-battlecruiser'],
          },
        ],
      },
    ])
    const game = startScenario('test-worth', { seed: 3 })
    const [escort, prize] = game.ships.filter((s) => s.side === 'Blue')
    // Index 0 was left at 0 = "printed value", index 1 re-priced to 60.
    expect(escort.pointValue).toBe(escort.form.pointValue)
    expect(prize.pointValue).toBe(60)
    prize.destroyed = true
    expect(victoryPoints(game)['Red']).toBe(60)
    registerCustomScenarios([])
  })
})
