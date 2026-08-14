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
    // BASIC on both sides: nothing is carrying ordnance, so the phase is
    // unambiguously about the dogfight.
    launchFlight(game, game.ships[0], 'nial', 'basic', 6)
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

  it('takes its ordnance to the hull even with enemy fighters in reach', () => {
    /*
     * The doctrine bug this pins down: with "an enemy flight first" as a flat
     * rule, two carriers traded eighty fighters across eight rounds and not
     * one of them touched a hull. A loaded counter is spent in a single run
     * and flips to BASIC afterwards — holding it back to dogfight throws the
     * whole reason for the sortie away.
     */
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: carrier(), x: 16, y: 20 }),
    ])
    launchFlight(game, game.ships[0], 'peregrine', 'strike', 6)
    launchFlight(game, game.ships[1], 'sentri', 'basic', 6)
    for (const f of game.flights) f.activated = false
    game.flights.find((f) => f.side === 'Red')!.position = { x: 12, y: 20 }
    // Empty the deck, so the only Blue decision this phase is the one under
    // test rather than a fresh space-superiority flight's.
    game.ships[0].flightsAboard = 0

    const taken = play(game, 'Blue')
    expect(taken).toContain('flight-strike')
    expect(taken).not.toContain('dogfight')
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

  it('turns its point defense on an enemy flight in reach', () => {
    /*
     * E10.2.2 puts a flight's jamming onto the actual range of every non-PD
     * volley and E12.4.3 exempts point defense from it, so a PD mount is the
     * only thing aboard that answers fighters properly. Leaving it idle with a
     * flight on the doorstep is the most wasteful thing on the board.
     */
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: carrier(), x: 30, y: 20 }),
    ])
    game.segment = 'combat'
    launchFlight(game, game.ships[1], 'nial', 'space-superiority', 6)
    game.flights[0].position = { x: 11, y: 20 }
    for (const s of game.ships) {
      for (const weapon of s.form.weapons) {
        s.mounts[weapon.id].forEach((m, i) => {
          m.armed = weapon.mounts[i].armingCircles
        })
      }
    }
    const shots = aiNextActions(game, ['Blue'], createAiMemo(), false, 'captain').filter(
      (a) => a.type === 'fire-small-target',
    )
    expect(shots.length, 'the AI never fired at the flight').toBeGreaterThan(0)
    expect(shots.every((a) => a.type === 'fire-small-target' && a.targetId === game.flights[0].id)).toBe(
      true,
    )
  })

  it('does nothing at all, and costs nothing, in a battle with no fighters', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 20, y: 20 }),
    ])
    expect(aiNextActions(game, ['Blue'], createAiMemo(), false, 'captain')).toEqual([])
  })
})
