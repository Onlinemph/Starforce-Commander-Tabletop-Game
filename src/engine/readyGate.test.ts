import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { replayGame } from '../data/savedGame'
import { applyAction, type GameAction } from './actions'
import { everyoneReady, sidesAwaited, type GameState } from './game'

/**
 * The ready gate, for battles fought in two browsers.
 *
 * A shared table enforces B1.9.1 by itself: nobody reveals until both pencils
 * are down. Two browsers do not — either player can close the Command Segment
 * while the other is still writing, and the half-written card is what moves.
 * So a gated segment closes on agreement, worked out identically at both ends
 * from the same journal.
 */

const gated = (readyGate = true) => startScenario('s3.1-the-duel', { seed: 4, readyGate })

const ready = (side: string, on = true): GameAction => ({ type: 'signal-ready', side, ready: on })

describe('closing a segment by agreement', () => {
  it('refuses to advance while a side is still working', () => {
    const game = gated()
    const at = `${game.phase}/${game.segment}`
    const refused = applyAction(game, { type: 'advance-segment' })
    expect(refused.message).toContain('Waiting for')
    expect(`${game.phase}/${game.segment}`).toBe(at)
  })

  it('closes the moment the last side says so — nobody presses next', () => {
    const game = gated()
    const at = game.segment
    const [first, second] = sidesAwaited(game)

    applyAction(game, ready(first))
    expect(game.segment).toBe(at)
    expect(everyoneReady(game)).toBe(false)

    applyAction(game, ready(second))
    expect(game.segment).not.toBe(at)
    // A new segment is a new question.
    expect(game.readySides).toEqual([])
  })

  it('lets a player change their mind while the others are still working', () => {
    const game = gated()
    const [first] = sidesAwaited(game)
    applyAction(game, ready(first))
    expect(game.readySides).toEqual([first])
    applyAction(game, ready(first, false))
    expect(game.readySides).toEqual([])
  })

  it('does not wait for a side that has nothing left in the battle', () => {
    const game = gated()
    const [, second] = sidesAwaited(game)
    for (const ship of game.ships.filter((s) => s.side === second)) ship.destroyed = true
    expect(sidesAwaited(game)).not.toContain(second)
    // One side left, one signal, and the segment closes.
    const at = game.segment
    applyAction(game, ready(sidesAwaited(game)[0]))
    expect(game.segment).not.toBe(at)
  })
})

describe('an ungated battle', () => {
  it('advances on request, as the hot-seat game always has', () => {
    const game = gated(false)
    const at = game.segment
    expect(applyAction(game, { type: 'advance-segment' }).message).toBeNull()
    expect(game.segment).not.toBe(at)
  })

  it('has no use for ready signals', () => {
    const game = gated(false)
    expect(applyAction(game, ready('Blue Force')).message).toContain('does not use ready checks')
  })
})

describe('the gate survives the journal', () => {
  it('replays to the same place, the segments closing where they closed', () => {
    const setup = { scenarioId: 's3.1-the-duel', seed: 4, readyGate: true }
    const live: GameState = startScenario(setup.scenarioId, setup)
    const actions: GameAction[] = []
    for (let i = 0; i < 6; i++) {
      for (const side of sidesAwaited(live)) {
        const action = ready(side)
        applyAction(live, action)
        actions.push(action)
      }
    }
    const rebuilt = replayGame({ version: 1, setup, actions })
    expect(`${rebuilt.round}/${rebuilt.phase}/${rebuilt.segment}`).toBe(
      `${live.round}/${live.phase}/${live.segment}`,
    )
  })
})
