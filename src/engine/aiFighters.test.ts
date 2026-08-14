import { describe, expect, it } from 'vitest'
import { THE_DUEL } from '../data/scenarios'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { createGame, launchFlight, type GameState } from './game'
import { createShip, type ShipState } from './shipState'
import type { ShipForm } from './types'

/**
 * The AI flies its wing.
 *
 * Without this the fighter rules would be a solitaire feature: a human could
 * launch, and the AI's carrier would sit with a full hangar for the whole
 * battle while its opponent's fighters ran up the score.
 */

function carrier(): ShipForm {
  return {
    ...YORKTOWN,
    systems: [
      ...YORKTOWN.systems,
      { kind: 'HNGR', label: 'Hangar Bay', boxes: 4 },
      { kind: 'LNCH', label: 'Launch Bay', boxes: 2 },
      { kind: 'LNDG', label: 'Landing Bay', boxes: 1 },
    ],
  }
}

function shipAt(args: {
  id: string
  side: string
  form?: ShipForm
  x: number
  y: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side,
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x, y: args.y }, heading: 90 },
    speed: 0,
  })
}

function flightOps(ships: ShipState[], seed = 12): GameState {
  const game = createGame({ scenario: THE_DUEL, ships, seed })
  game.phase = 'combat-1'
  game.segment = 'flight-operations'
  return game
}

/** Run the AI to a standstill, applying what it asks for. */
function play(game: GameState, side: string): string[] {
  const memo = createAiMemo()
  const taken: string[] = []
  for (let i = 0; i < 30; i++) {
    const batch = aiNextActions(game, [side], memo, false, 'captain')
    if (batch.length === 0) break
    for (const action of batch) {
      applyAction(game, action)
      taken.push(action.type)
    }
  }
  return taken
}

describe('the AI in the Flight Operations Segment', () => {
  it('launches its wing when there is an enemy within reach of the battle', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 26, y: 20 }),
    ])
    const taken = play(game, 'Blue')
    expect(taken.filter((t) => t === 'launch-flight').length, 'no flights launched').toBe(2)
    expect(game.flights).toHaveLength(2)
    // Nothing to dogfight, so it loads for the hull.
    expect(game.flights.every((f) => f.config === 'strike')).toBe(true)
  })

  it('keeps them in the hangar while the enemy is still a map away', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 2, y: 2 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 68, y: 68 }),
    ])
    play(game, 'Blue')
    expect(game.flights).toHaveLength(0)
  })

  it('loads for the dogfight while enemy fighters are in the air', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: carrier(), x: 26, y: 20 }),
    ])
    launchFlight(game, game.ships[1], 'nial', 'space-superiority', 6)
    play(game, 'Blue')
    expect(game.flights.filter((f) => f.side === 'Blue')).toHaveLength(2)
    expect(
      game.flights.filter((f) => f.side === 'Blue').every((f) => f.config === 'space-superiority'),
    ).toBe(true)
  })

  it('closes on an enemy flight and engages it', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: carrier(), x: 40, y: 20 }),
    ])
    launchFlight(game, game.ships[0], 'nial', 'space-superiority', 6)
    launchFlight(game, game.ships[1], 'sentri', 'basic', 6)
    // Both flights already spent their launch activation; clear it so this
    // phase is about flying, not launching.
    for (const f of game.flights) f.activated = false
    const red = game.flights.find((f) => f.side === 'Red')!
    red.position = { x: 14, y: 20 }
    const before = red.members

    const taken = play(game, 'Blue')
    expect(taken).toContain('dogfight')
    const after = game.flights.find((f) => f.id === red.id)
    expect(after === undefined || after.members < before).toBe(true)
  })

  it('runs a strike in on a hull when there are no fighters to fight', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 16, y: 20 }),
    ])
    launchFlight(game, game.ships[0], 'peregrine', 'strike', 6)
    for (const f of game.flights) f.activated = false
    const taken = play(game, 'Blue')
    expect(taken).toContain('flight-strike')
    expect(game.flights[0].spent, 'the load should be gone after the run').toBe(true)
  })

  it('takes a spent flight home to rearm rather than loitering', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 60, y: 60 }),
    ])
    launchFlight(game, game.ships[0], 'starfury', 'strike', 6)
    const flight = game.flights[0]
    flight.activated = false
    flight.spent = true
    // BASIC Starfury is strike 1-1: still armed, so give it nothing in reach
    // to shoot at and a mother ship right alongside.
    flight.position = { x: 10, y: 21 }
    const taken = play(game, 'Blue')
    expect(taken.some((t) => t === 'recover-flight' || t === 'move-flight')).toBe(true)
  })

  it('does nothing at all, and costs nothing, in a battle with no fighters', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 20, y: 20 }),
    ])
    expect(aiNextActions(game, ['Blue'], createAiMemo(), false, 'captain')).toEqual([])
  })
})
