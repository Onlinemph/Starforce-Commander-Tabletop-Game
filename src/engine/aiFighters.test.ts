import { describe, expect, it } from 'vitest'
import { THE_DUEL } from '../data/scenarios'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { createGame, launchFlight, recoverFlight, runHangarBay, type GameState } from './game'
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

  it('never proposes an action the engine will refuse — the loop that hung a battle', () => {
    /*
     * The failure this pins down was not a bad move, it was a hung game. The
     * planner floored the tape to decide reach and the engine did not, so a
     * flight 5.1" from its target read as "in reach, strike it" to one and
     * "5.1 away, refused" to the other. Nothing changed, so the planner
     * proposed it again: 11,906 identical strikes in one battle, and the same
     * shape again for landings once the strike was fixed. The driver runs this
     * until it returns nothing, so a refused action is an infinite loop.
     *
     * The measure is now shared, and every offer is remembered for the phase —
     * so this asserts the invariant rather than any particular arithmetic:
     * whatever the AI asks for, the engine accepts.
     */
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: carrier(), x: 30, y: 20 }),
    ])
    launchFlight(game, game.ships[0], 'starfury', 'strike', 6)
    launchFlight(game, game.ships[1], 'nial', 'space-superiority', 6)
    const memo = createAiMemo()
    const refusals: string[] = []
    let rounds = 0
    for (let i = 0; i < 400; i++) {
      const batch = aiNextActions(game, ['Blue'], memo, false, 'captain')
      if (batch.length === 0) {
        // Settle the phase and go round again: the loop only shows up when a
        // flight is left sitting a fraction of an inch outside its reach.
        if (++rounds > 8) break
        applyAction(game, { type: 'advance-segment' })
        while (game.segment !== 'flight-operations') {
          applyAction(game, { type: 'advance-segment' })
        }
        continue
      }
      for (const action of batch) {
        const out = applyAction(game, action)
        if (out.message) refusals.push(`${action.type}: ${out.message}`)
      }
    }
    /*
     * The invariant is that nothing repeats. One refusal can still happen
     * honestly — the last enemy flight dies to the first attacker and the
     * second addresses a counter that is no longer there — but a *repeated*
     * refusal is the loop, because a refusal changes no state.
     */
    const seen = new Set<string>()
    const repeated = refusals.filter((r) => !seen.add(r))
    expect(repeated, 'the AI re-proposed a refused action — this is the hang').toEqual([])
    for (const r of refusals) expect(r).toMatch(/No such flight/)
    expect(rounds, 'the AI never settled the segment').toBeGreaterThan(0)
  })

  it('launches when BOTH fleets are the computer\'s — the demo-game bug', () => {
    /*
     * Reported from a real battle: an ARK ROYAL fought eight rounds, fired
     * twelve volleys, and never put one of its twenty-four fighters into the
     * air.
     *
     * The driver hands `aiNextActions` *every* side the computer commands in a
     * single call, so in an AI-versus-AI game `sides` is both fleets. This
     * planner asked "who is not in `sides`?" to find its enemies and got
     * nobody, so the launch gate was vacuously satisfied and the wing stayed on
     * the deck for the whole battle. It worked whenever a human held one of the
     * fleets, which is the only configuration it had been tested in.
     *
     * Enemies are now read off the asking ship's own side, like every other
     * planner in the file.
     */
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 24, y: 20 }),
    ])
    const memo = createAiMemo()
    // Both sides in one call, exactly as the store's driver does it.
    const batch = aiNextActions(game, ['Blue', 'Red'], memo, false, 'captain')
    expect(
      batch.filter((a) => a.type === 'launch-flight').length,
      'the carrier kept its wing in the hangar with nobody to fight',
    ).toBe(2)
  })

  it('gets the wing up during the approach, not after contact', () => {
    /*
     * The hold used to be a flat 24 inches to the carrier. On the printed 36"
     * map that is most of the board; on a 72" one the fleets deploy about fifty
     * inches apart, so the whole wing sat aboard through the entire approach
     * and only launched at sixteen inches — by which time the shooting had
     * started and the fighters had no time to cross. The horizon is now
     * measured in the fighters' own speed: two rounds of flying.
     */
    const far = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 6, y: 36 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 60, y: 36 }),
    ])
    expect(
      aiNextActions(far, ['Blue'], createAiMemo(), false, 'captain').filter(
        (a) => a.type === 'launch-flight',
      ),
      'launched into empty space from across the map',
    ).toHaveLength(0)

    // Thirty inches: two rounds of flying for a speed-5 loaded SABRE.
    const closing = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 6, y: 36 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 34, y: 36 }),
    ])
    expect(
      aiNextActions(closing, ['Blue'], createAiMemo(), false, 'captain').filter(
        (a) => a.type === 'launch-flight',
      ).length,
      'still holding the wing with the enemy two rounds away',
    ).toBeGreaterThan(0)
  })

  it('does not land a spent flight and put it straight back up', () => {
    /*
     * From a battle report where the wing otherwise worked: rounds four to six
     * were nothing but the carrier landing two flights and relaunching the same
     * two flights, every phase, still on their BASIC face. Landing is only
     * worth doing for the rearm, and the rearm is the Hangar Bay Segment at the
     * end of the round — so a flight that goes back up in the phase it landed
     * has achieved precisely nothing and stopped fighting to do it.
     *
     * The engine still allows it: a BASIC counter is a fine dogfighter and a
     * player may launch one whenever they like. It is the AI that should not.
     */
    const ship = shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 })
    const game = flightOps([ship, shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 24, y: 20 })])
    launchFlight(game, ship, 'sabre', 'strike', 6)
    const flight = game.flights[0]
    flight.spent = true
    flight.activated = false
    flight.position = { x: 10, y: 21 }
    // The deck is otherwise empty, so the only thing it could launch is the
    // flight it is about to recover.
    ship.flightsAboard = 0

    const taken = play(game, 'Blue')
    expect(taken).toContain('recover-flight')
    expect(taken, 'the flight went straight back up without rearming').not.toContain('launch-flight')
    expect(game.flights[0].dockedTo).toBe(ship.id)
    expect(game.flights[0].spent, 'still spent — the Hangar Bay Segment has not run').toBe(true)

    // And once the segment has run, it flies again.
    runHangarBay(game)
    expect(game.flights[0].spent).toBe(false)
    game.ops.flightsLaunchedThisPhase = {}
    for (const f of game.flights) f.activated = false
    expect(play(game, 'Blue')).toContain('launch-flight')
  })

  it('relaunches the flight that landed, with the fighters it has left', () => {
    const ship = shipAt({ id: 'blue-1', side: 'Blue', form: carrier(), x: 10, y: 20 })
    const game = flightOps([ship, shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 24, y: 20 })])
    launchFlight(game, ship, 'sabre', 'strike', 6)
    const flight = game.flights[0]
    flight.members = 3
    flight.position = { x: 10, y: 21 }
    recoverFlight(game, flight.id, ship)
    game.ops.flightsLaunchedThisPhase = {}
    // A rearmed flight on the deck goes up before a fresh one is broken out.
    expect(launchFlight(game, ship)).toBeNull()
    expect(game.flights.filter((f) => !f.dockedTo)).toHaveLength(1)
    expect(game.flights.find((f) => !f.dockedTo)!.members).toBe(3)
  })

  it('does nothing at all, and costs nothing, in a battle with no fighters', () => {
    const game = flightOps([
      shipAt({ id: 'blue-1', side: 'Blue', x: 10, y: 20 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 20, y: 20 }),
    ])
    expect(aiNextActions(game, ['Blue'], createAiMemo(), false, 'captain')).toEqual([])
  })
})
