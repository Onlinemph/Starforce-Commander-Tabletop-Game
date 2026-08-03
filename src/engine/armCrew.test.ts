import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { advanceSegment, tacticalScanOf, type GameState } from './game'
import { totalPowerAvailable } from './engineering'
import { crewIsArmed, type ShipState } from './shipState'

/**
 * Arming the general crew (J6.3, optional).
 *
 * An act of desperation: it raises two improvised squads per size class and
 * costs the ship its damage control, two points of power and its place in the
 * firing order for twenty rounds after the fighting ends. The rulebook is
 * blunt about the trade, and so is this.
 */

function boarded(): { game: GameState; ship: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed: 8 })
  const ship = game.ships[0]
  const enemy = game.ships[1]
  ship.boarders[enemy.side] = 3
  // Wind on to the segment where the decision is made (J6.3.2).
  for (let i = 0; i < 40 && game.segment !== 'boarding-combat'; i++) advanceSegment(game)
  return { game, ship }
}

describe('the decision', () => {
  it('is made during Boarding Combat and nowhere else (J6.3.2)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 8 })
    const ship = game.ships[0]
    expect(applyAction(game, { type: 'arm-crew', shipId: ship.id }).message).toContain(
      'Boarding Combat Segment',
    )
    expect(crewIsArmed(ship)).toBe(false)
  })

  it('raises two squads per size class (J6.3.1)', () => {
    const { game, ship } = boarded()
    const before = ship.marineSquads
    expect(applyAction(game, { type: 'arm-crew', shipId: ship.id }).message).toBeNull()
    expect(ship.marineSquads).toBe(before + 2 * ship.form.sizeClass)
    expect(crewIsArmed(ship)).toBe(true)
  })

  it('cannot be taken twice', () => {
    const { game, ship } = boarded()
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    expect(applyAction(game, { type: 'arm-crew', shipId: ship.id }).message).toContain(
      'already under arms',
    )
  })

  it('is too late once the ship is taken (J6.3.1)', () => {
    const { game, ship } = boarded()
    ship.capturedBy = 'Red Force'
    expect(applyAction(game, { type: 'arm-crew', shipId: ship.id }).message).toContain('already taken')
  })
})

describe('what it costs (J6.3.4)', () => {
  it('stops damage control entirely', () => {
    const { game, ship } = boarded()
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    const refused = applyAction(game, {
      type: 'damage-control',
      shipId: ship.id,
      assignments: [{ category: 'structure', dice: 2 }],
    })
    expect(refused.message).toContain('no damage control')
  })

  it('takes two points of power off the ship', () => {
    const { game, ship } = boarded()
    const before = totalPowerAvailable(ship)
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    expect(totalPowerAvailable(ship)).toBe(before - 2)
  })

  it('puts the ship last in the firing order, whatever its scan says', () => {
    const { game, ship } = boarded()
    ship.sensors.tacticalScan = 3
    expect(tacticalScanOf(game, ship)).toBe(3)
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    expect(tacticalScanOf(game, ship)).toBeLessThan(0)
  })
})

describe('how long it lasts (J6.3.2)', () => {
  it('keeps the clock reset while the boarders are still aboard', () => {
    const { game, ship } = boarded()
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    const first = ship.crewArmedUntil
    // The boarding fight resolves itself when the segment closes, so fresh
    // boarders keep arriving — which is the case the rule is about.
    for (let i = 0; i < 80 && game.round < 3; i++) {
      ship.boarders['Red Force'] = 3
      advanceSegment(game)
    }
    expect(ship.crewArmedUntil).toBeGreaterThan(first)
    expect(crewIsArmed(ship)).toBe(true)
  })

  it('stands the crew down twenty rounds after the fighting ends', () => {
    const { game, ship } = boarded()
    applyAction(game, { type: 'arm-crew', shipId: ship.id })
    ship.boarders = {}
    // Jump the clock past the twenty rounds and turn the round over.
    ship.crewArmedUntil = game.round
    for (let i = 0; i < 40 && ship.crewArmedUntil > 0; i++) advanceSegment(game)
    expect(crewIsArmed(ship)).toBe(false)
    expect(game.log.some((l) => l.message.includes('stands down'))).toBe(true)
  })
})
