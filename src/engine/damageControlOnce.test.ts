import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { advanceSegment, type GameState } from './game'
import { repairTargets } from './engineering'
import { markStructure, type ShipState } from './shipState'

/**
 * One set of damage-control rolls per round (B3.2) — the playtest found that
 * a failed repair could simply be rolled again until it worked, the same
 * exploit it caught on cloak searches.
 */

function hurtAtDamageControl(): { game: GameState; ship: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed: 8 })
  const ship = game.ships[0]
  markStructure(ship)
  markStructure(ship)
  for (let i = 0; i < 60 && game.segment !== 'damage-control'; i++) advanceSegment(game)
  expect(game.segment).toBe('damage-control')
  return { game, ship }
}

describe('damage control rolls once per round (B3.2)', () => {
  it('refuses a second set of rolls, and the crews try again next round', () => {
    const { game, ship } = hurtAtDamageControl()
    const target = repairTargets(ship).find((t) => t.category === 'structure')!
    const roll = () =>
      applyAction(game, {
        type: 'damage-control',
        shipId: ship.id,
        assignments: [{ category: 'structure', dice: 2, targetKey: target.key }],
      })

    const first = roll()
    expect(first.message).toBeNull() // dice rolled, hit or miss
    expect(ship.repairsRolledRound).toBe(game.round)

    const second = roll()
    expect(second.message).toMatch(/rolls this round \(B3\.2\)/)

    // Next round's Damage Control Segment: the crews may try again.
    const round = game.round
    for (let i = 0; i < 400 && !(game.round === round + 1 && game.segment === 'damage-control'); i++) {
      advanceSegment(game)
    }
    expect(game.segment).toBe('damage-control')
    expect(game.round).toBe(round + 1)
    if (repairTargets(ship).some((t) => t.category === 'structure')) {
      expect(roll().message).toBeNull()
    }
  })

  it('an empty assignment list spends nothing', () => {
    const { game, ship } = hurtAtDamageControl()
    applyAction(game, { type: 'damage-control', shipId: ship.id, assignments: [] })
    expect(ship.repairsRolledRound).toBe(0)
    const target = repairTargets(ship).find((t) => t.category === 'structure')!
    expect(
      applyAction(game, {
        type: 'damage-control',
        shipId: ship.id,
        assignments: [{ category: 'structure', dice: 1, targetKey: target.key }],
      }).message,
    ).toBeNull()
  })
})
