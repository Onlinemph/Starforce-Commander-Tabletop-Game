import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from '../engine/actions'
import { advanceSegment, type GameState } from '../engine/game'
import { currentStep, tutorialShip, TUTORIAL } from './tutorial'

/**
 * The guided battle follows the game rather than the mouse: every step is
 * finished by a condition on the state, so a player who wanders off, does
 * things out of order, or presses undo is still exactly where the tutorial
 * thinks they are. These pin that, because the alternative — a remembered step
 * index — is the version that strands people.
 */

function duel(): GameState {
  return startScenario('s3.1-the-duel', { seed: 1 })
}

const stepOf = (game: GameState) => currentStep(game, tutorialShip(game, 'Blue Force'))
const idOf = (game: GameState) => TUTORIAL[stepOf(game)].id

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 60): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
}

describe('the guided battle', () => {
  it('opens on the welcome step of a fresh battle', () => {
    expect(idOf(duel())).toBe('welcome')
  })

  it('moves off welcome as soon as the player does anything at all', () => {
    const game = duel()
    advanceSegment(game)
    expect(idOf(game)).not.toBe('welcome')
  })

  it('asks for power, and is satisfied by power', () => {
    const game = duel()
    advanceSegment(game) // leave the welcome step behind
    // Back to allocation for a clean read of the power step.
    const fresh = duel()
    const ship = tutorialShip(fresh, 'Blue Force')!
    const line = ship.form.functions.find((l) => l.steps.length > 0)!
    expect(TUTORIAL.find((s) => s.id === 'power')!.done(fresh, ship)).toBe(false)
    applyAction(fresh, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: 1 })
    expect(TUTORIAL.find((s) => s.id === 'power')!.done(fresh, ship)).toBe(true)
  })

  it('asks for a plotted card, and is satisfied by plotting one', () => {
    const game = duel()
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    const ship = tutorialShip(game, 'Blue Force')!
    const plot = TUTORIAL.find((s) => s.id === 'plot')!
    expect(plot.done(game, ship)).toBe(false)
    applyAction(game, { type: 'plot-maneuver', shipId: ship.id, maneuver: 'standard', direction: 'left' })
    expect(plot.done(game, ship)).toBe(true)
  })

  it('asks for a sensor split, and is satisfied by one', () => {
    const game = duel()
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    const ship = tutorialShip(game, 'Blue Force')!
    const sensors = TUTORIAL.find((s) => s.id === 'sensors')!
    expect(sensors.done(game, ship)).toBe(false)
    applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: 1 })
    expect(sensors.done(game, ship)).toBe(true)
  })

  /*
   * The reason the step is derived instead of stored. Undo in this app replays
   * a prefix of the journal into a fresh game, so anything the tutorial had
   * remembered would survive a rewind it should not have survived.
   */
  it('rewinds with the battle rather than remembering how far it got', () => {
    const game = duel()
    const ship = tutorialShip(game, 'Blue Force')!
    const line = ship.form.functions.find((l) => l.steps.length > 0)!
    const before = stepOf(game)

    applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: 1 })
    expect(stepOf(game)).toBeGreaterThan(before)

    // A rebuilt game — which is exactly what undo hands back — reads as step one.
    expect(stepOf(duel())).toBe(before)
  })

  it('never runs off the end of the script', () => {
    const game = duel()
    runTo(game, (g) => g.round > 2, 200)
    const index = stepOf(game)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(TUTORIAL.length)
  })

  it('has a distinct id, a title and a body for every step', () => {
    const ids = TUTORIAL.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const step of TUTORIAL) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
    }
  })

  it('survives a battle with no ships to teach with', () => {
    const game = duel()
    game.ships.forEach((s) => (s.destroyed = true))
    expect(() => stepOf(game)).not.toThrow()
  })
})
