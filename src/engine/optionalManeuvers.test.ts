import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { defaultCommandCard, type GameState } from './game'
import { executeMovement, plannedMovement } from './navigation'
import { turnTemplateAt, type ShipState } from './shipState'

/**
 * The optional maneuvers the engine could already perform and no captain could
 * actually order: an emergency stop (C3.8) and precise turns and slides
 * (C3.9). Both were finished work sitting behind a missing control.
 */

function duel(): { game: GameState; ship: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed: 6 })
  const ship = game.ships[0]
  game.orders[ship.id] = defaultCommandCard(ship)
  return { game, ship }
}

describe('precise turns and slides (C3.9)', () => {
  it('turns at the rate the captain names, not the rate the ship could manage', () => {
    const { ship } = duel()
    const hard = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      maneuver: 'standard',
      direction: 'right',
    })
    const gentle = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      maneuver: 'standard',
      direction: 'right',
      turnRate: 20,
    })
    const swing = (heading: number) => Math.abs(((heading - ship.placement.heading + 540) % 360) - 180)
    expect(swing(gentle.end.heading)).toBeLessThan(swing(hard.end.heading))
    expect(swing(gentle.end.heading)).toBeCloseTo(20, 0)
  })

  it('never turns harder than the table allows, whatever the card says', () => {
    const { ship } = duel()
    const allowed = turnTemplateAt(ship, ship.speed)
    const greedy = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      maneuver: 'standard',
      direction: 'right',
      turnRate: 90,
    })
    const swing = Math.abs(((greedy.end.heading - ship.placement.heading + 540) % 360) - 180)
    expect(swing).toBeLessThanOrEqual(allowed + 0.001)
  })

  it('slides half an inch when the card says so (C3.9.5)', () => {
    const { ship } = duel()
    const full = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      maneuver: 'slide',
      direction: 'right',
    })
    const half = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      maneuver: 'slide',
      direction: 'right',
      halfSlide: true,
    })
    expect(full.end.position).not.toEqual(half.end.position)
  })

  it('is plotted through the card, so a replay turns the same way', () => {
    const { game, ship } = duel()
    applyAction(game, { type: 'plot-maneuver', shipId: ship.id, maneuver: 'standard', direction: 'right' })
    applyAction(game, { type: 'plot-turn-rate', shipId: ship.id, rate: 20 })
    expect(game.orders[ship.id].turnRate).toBe(20)
    applyAction(game, { type: 'plot-turn-rate', shipId: ship.id, rate: null })
    expect(game.orders[ship.id].turnRate).toBeUndefined()
  })
})

describe('emergency stop (C3.8)', () => {
  it('stops the ship dead, straight ahead, whatever else was plotted', () => {
    const { game, ship } = duel()
    ship.speed = 4
    applyAction(game, { type: 'plot-maneuver', shipId: ship.id, maneuver: 'hard', direction: 'left' })
    applyAction(game, { type: 'plot-emergency-stop', shipId: ship.id, on: true })

    const card = game.orders[ship.id]
    expect(card.maneuver).toBe('straight')
    expect(card.speed).toBe(0)

    const heading = ship.placement.heading
    executeMovement(ship, card)
    expect(ship.speed).toBe(0)
    expect(ship.placement.heading).toBe(heading)
  })

  it('costs stress equal to the speed it was making, not acceleration (C3.8.1, C3.8.3)', () => {
    const { game, ship } = duel()
    ship.speed = 5
    ship.stressMarkers = 0
    ship.accelUsedThisRound = 0
    applyAction(game, { type: 'plot-emergency-stop', shipId: ship.id, on: true })
    executeMovement(ship, game.orders[ship.id])
    expect(ship.stressMarkers).toBe(5)
    expect(ship.accelUsedThisRound).toBe(0)
  })

  it('holds the ship still through the following phase as well (C3.8.2)', () => {
    const { game, ship } = duel()
    ship.speed = 3
    applyAction(game, { type: 'plot-emergency-stop', shipId: ship.id, on: true })
    executeMovement(ship, game.orders[ship.id])
    expect(ship.emergencyStopPhases).toBe(1)

    // The next phase: the captain plots speed 4 and gets nothing.
    const where = { ...ship.placement.position }
    executeMovement(ship, { ...defaultCommandCard(ship), speed: 4, accel: 2 })
    expect(ship.speed).toBe(0)
    expect(ship.placement.position).toEqual(where)
    expect(ship.emergencyStopPhases).toBe(0)
  })

  it('is refused while the drive is already down (C3.8.4)', () => {
    const { game, ship } = duel()
    ship.emergencyStopPhases = 1
    const refused = applyAction(game, { type: 'plot-emergency-stop', shipId: ship.id, on: true })
    expect(refused.message).toContain('already stopped')
  })
})
