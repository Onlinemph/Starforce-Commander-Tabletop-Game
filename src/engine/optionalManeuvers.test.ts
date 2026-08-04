import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { defaultCommandCard, type GameState } from './game'
import { executeMovement, plannedMovement } from './navigation'
import {
  createShip,
  currentMaxSpeed,
  driveDestroyed,
  turnTemplateAt,
  type ShipState,
} from './shipState'
import { findShipForm } from '../data/ships'

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

describe('sublight drive damage (E8.5.4)', () => {
  /**
   * How many hits it takes to lose a given speed is printed on each ship's own
   * DMG line, so it differs hull to hull — a Yorktown has six drive boxes, a
   * Passer three. The rulebook's worked example is the check that the ladder
   * is read off the right column.
   */
  function wreckDrive(ship: ShipState, hits: number): void {
    ship.systemDamage['__sublight'] = hits
  }

  it('reads the top speed off the ship’s own DMG ladder', () => {
    const { ship } = duel()
    expect(currentMaxSpeed(ship)).toBe(ship.form.sublight.maxSpeed)
    for (let hits = 1; hits <= ship.form.sublight.driveBoxes; hits++) {
      wreckDrive(ship, hits)
      expect(currentMaxSpeed(ship)).toBe(ship.form.sublight.dmgTopSpeed[hits - 1])
    }
  })

  it('matches the rulebook’s worked example: three hits, top speed 2', () => {
    const yorktown = findShipForm('YORKTOWN IIIc-class Command Cruiser')!
    const ship = createShip({
      id: 'y',
      side: 'Blue Force',
      name: 'YORKTOWN',
      form: yorktown,
      placement: { position: { x: 10, y: 10 }, heading: 0 },
      speed: 6,
    })
    wreckDrive(ship, 3)
    expect(currentMaxSpeed(ship)).toBe(2)
  })

  it('gives different hulls different ladders', () => {
    const passer = findShipForm('PASSER I-class Frigate')!
    const yorktown = findShipForm('YORKTOWN IIIc-class Command Cruiser')!
    // Same top speed, very different tolerance for damage.
    expect(passer.sublight.maxSpeed).toBe(yorktown.sublight.maxSpeed)
    expect(passer.sublight.driveBoxes).toBeLessThan(yorktown.sublight.driveBoxes)
    expect(passer.sublight.dmgTopSpeed).not.toEqual(yorktown.sublight.dmgTopSpeed)
  })

  it('holds a ship with every box gone to a standstill and an easy turn, indefinitely', () => {
    const { game, ship } = duel()
    wreckDrive(ship, ship.form.sublight.driveBoxes)
    ship.speed = 0
    expect(currentMaxSpeed(ship)).toBe(0)

    // Long past any Emergency Stop counter, which is the bug this pins: the
    // restriction belongs to the damage, not to a phase count.
    ship.emergencyStopPhases = 0
    const heading = ship.placement.heading
    const hard = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      speed: 0,
      accel: 0,
      maneuver: 'hard',
      direction: 'left',
    })
    expect(hard.maneuver).toBe('straight')
    expect(hard.end.heading).toBe(heading)

    // An Easy Turn from a standstill is still allowed.
    const easy = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      speed: 0,
      accel: 0,
      maneuver: 'easy',
      direction: 'left',
    })
    expect(easy.maneuver).toBe('easy')
    expect(easy.speed).toBe(0)

    // ...and plotting a speed it cannot make is corrected to a standstill.
    const running = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      speed: 4,
      accel: 2,
      maneuver: 'easy',
      direction: 'left',
    })
    expect(running.speed).toBe(0)
    expect(applyAction(game, { type: 'plot-maneuver', shipId: ship.id, maneuver: 'easy', direction: 'left' }).message).toBeNull()
  })

  it('lets a repaired box release the ship again', () => {
    const { ship } = duel()
    wreckDrive(ship, ship.form.sublight.driveBoxes)
    expect(driveDestroyed(ship)).toBe(true)
    wreckDrive(ship, ship.form.sublight.driveBoxes - 1)
    expect(driveDestroyed(ship)).toBe(false)

    const hard = plannedMovement(ship, {
      ...defaultCommandCard(ship),
      speed: 0,
      accel: 0,
      maneuver: 'hard',
      direction: 'left',
    })
    expect(hard.maneuver).toBe('hard')
  })
})
