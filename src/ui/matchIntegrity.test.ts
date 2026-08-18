import { beforeEach, describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { actionSide, applyAction, undoableInMatch, type GameAction } from '../engine/actions'
import { advanceSegment, defaultCommandCard, type GameState } from '../engine/game'
import { replayGame } from '../data/savedGame'
import { stateHash } from '../engine/stateHash'
import {
  canUndo,
  currentMatchSide,
  currentSave,
  dispatch,
  enableReadyGate,
  gateIsWaiting,
  getGame,
  journalLength,
  lockOptionalRules,
  newGame,
  readyAbsentSides,
  setMatchSide,
  undo,
  undoRefusal,
} from './store'

/**
 * The three ways an online match could quietly stop being the same game for
 * both players: an undo that reaches across the table, two boards drifting
 * apart in silence, and a gate waiting forever on an empty chair.
 */

function duel(): GameState {
  return startScenario('s3.1-the-duel', { seed: 5 })
}

describe('whose action is it (ownership)', () => {
  it('reads a side off the ship an order names', () => {
    const game = duel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    expect(
      actionSide(game, { type: 'plot-accel', shipId: blue.id, delta: 1 }),
    ).toBe('Blue Force')
  })

  it('reads it off the attacker, not the target', () => {
    const game = duel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(
      actionSide(game, {
        type: 'fire-volley',
        attackerId: red.id,
        targetId: blue.id,
        mounts: [],
        mode: 'standard',
        degraded: false,
      }),
    ).toBe('Red Force')
  })

  it('gives the sequence controls to nobody', () => {
    const game = duel()
    expect(actionSide(game, { type: 'advance-segment' })).toBeNull()
    expect(actionSide(game, { type: 'ops-next-step' })).toBeNull()
  })
})

describe('what may be taken back in a match', () => {
  it('lets a captain rewrite their own command card', () => {
    const game = duel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const plot: GameAction = {
      type: 'plot-maneuver',
      shipId: blue.id,
      maneuver: 'standard',
      direction: 'left',
    }
    expect(undoableInMatch(game, plot, 'Blue Force')).toBe(true)
  })

  it('refuses them the other commander’s card', () => {
    const game = duel()
    const red = game.ships.find((s) => s.side === 'Red Force')!
    const plot: GameAction = { type: 'plot-accel', shipId: red.id, delta: 2 }
    expect(undoableInMatch(game, plot, 'Blue Force')).toBe(false)
  })

  it('refuses anything that has rolled a die or been announced', () => {
    const game = duel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    const announced: GameAction[] = [
      { type: 'fire-volley', attackerId: blue.id, targetId: red.id, mounts: [], mode: 'standard', degraded: false },
      { type: 'scan', shipId: blue.id, targetId: red.id },
      { type: 'engage-cloak', shipId: blue.id },
      { type: 'damage-control', shipId: blue.id, assignments: [] },
      { type: 'set-shield-down', shipId: blue.id, side: 'F', down: true },
      { type: 'launch-shuttle', shipId: blue.id },
      { type: 'disengage', shipId: blue.id },
      { type: 'advance-segment' },
      { type: 'signal-ready', side: 'Blue Force', ready: true },
    ]
    for (const action of announced) {
      expect(undoableInMatch(game, action, 'Blue Force')).toBe(false)
    }
  })

  it('answers false for a console commanding no side at all', () => {
    const game = duel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    expect(undoableInMatch(game, { type: 'plot-accel', shipId: blue.id, delta: 1 }, null)).toBe(false)
  })
})

describe('the undo button in and out of a match', () => {
  beforeEach(() => {
    setMatchSide(null)
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
  })

  it('takes back anything at all when nobody is watching', () => {
    const blue = getGame().ships.find((s) => s.side === 'Blue Force')!
    dispatch({ type: 'plot-accel', shipId: blue.id, delta: 1 })
    dispatch({ type: 'advance-segment' })
    expect(currentMatchSide()).toBeNull()
    expect(canUndo()).toBe(true)
    const before = journalLength()
    undo()
    expect(journalLength()).toBe(before - 1)
  })

  it('refuses to unwind the segment once a match is on', () => {
    const blue = getGame().ships.find((s) => s.side === 'Blue Force')!
    dispatch({ type: 'plot-accel', shipId: blue.id, delta: 1 })
    dispatch({ type: 'advance-segment' })
    setMatchSide('Blue Force')

    expect(canUndo()).toBe(false)
    expect(undoRefusal()).toMatch(/cannot be taken back in a match/)
    const before = journalLength()
    undo()
    expect(journalLength()).toBe(before)
  })

  it('still lets a captain rewrite their own orders', () => {
    const blue = getGame().ships.find((s) => s.side === 'Blue Force')!
    setMatchSide('Blue Force')
    dispatch({ type: 'plot-accel', shipId: blue.id, delta: 1 })

    expect(undoRefusal()).toBeNull()
    const before = journalLength()
    undo()
    expect(journalLength()).toBe(before - 1)
  })

  it('will not reach across the table for the other side’s orders', () => {
    const red = getGame().ships.find((s) => s.side === 'Red Force')!
    // The other commander's order arrives before this console claims a side
    // (live, it arrives over the wire): the gate below would refuse writing
    // it locally, which is its own test.
    setMatchSide(null)
    dispatch({ type: 'plot-accel', shipId: red.id, delta: 1 })
    setMatchSide('Blue Force')

    expect(canUndo()).toBe(false)
    expect(undoRefusal()).toMatch(/other commander/)
  })
})

describe('the empty chair (ready gate)', () => {
  beforeEach(() => {
    setMatchSide(null)
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    enableReadyGate()
  })

  it('holds the segment while both sides are at their consoles', async () => {
    const game = getGame()
    expect(game.readyGate).toBe(true)
    dispatch({ type: 'signal-ready', side: 'Blue Force', ready: true })
    await readyAbsentSides(['Blue Force', 'Red Force'], [])
    expect(getGame().readySides).toEqual(['Blue Force'])
    expect(gateIsWaiting()).toBe(true)
  })

  it('readies a side nobody is connected for, so the gate is not a deadlock', async () => {
    const segment = getGame().segment
    dispatch({ type: 'signal-ready', side: 'Blue Force', ready: true })
    expect(gateIsWaiting()).toBe(true)

    // Red has closed the tab. With the last chair covered the gate opens and
    // the segment closes, which is the whole point — and closing it clears the
    // ready marks for the next one, so look at the segment, not the marks.
    await readyAbsentSides(['Blue Force'], [])
    expect(getGame().segment).not.toBe(segment)
  })

  it('journals it, so both clients and any later replay agree it happened', async () => {
    const before = journalLength()
    await readyAbsentSides(['Blue Force'], [])
    expect(journalLength()).toBeGreaterThan(before)
    expect(getGame().log.some((l) => l.message.includes('Red Force is ready'))).toBe(true)
  })

  it('leaves the computer’s sides alone — this very client drives them', async () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5, aiSides: ['Red Force'] })
    enableReadyGate()
    await readyAbsentSides(['Blue Force'], ['Red Force'])
    expect(getGame().readySides).not.toContain('Red Force')
  })

  it('says nothing twice about a side already readied', async () => {
    await readyAbsentSides(['Blue Force'], [])
    const after = journalLength()
    await readyAbsentSides(['Blue Force'], [])
    expect(journalLength()).toBe(after)
  })
})

describe('the state fingerprint', () => {
  it('agrees for two clients replaying the same battle', () => {
    expect(stateHash(duel())).toBe(stateHash(duel()))
  })

  it('notices a different shuffle before a single card is drawn', () => {
    // The decks differ; nothing on the board does yet. This is a desync that
    // already exists and would otherwise stay invisible until the next hit.
    expect(stateHash(startScenario('s3.1-the-duel', { seed: 1 }))).not.toBe(
      stateHash(startScenario('s3.1-the-duel', { seed: 2 })),
    )
  })

  it('moves when the battle does', () => {
    const game = duel()
    const before = stateHash(game)
    advanceSegment(game)
    expect(stateHash(game)).not.toBe(before)
  })

  it('moves when a ship does', () => {
    const game = duel()
    const before = stateHash(game)
    game.ships[0].placement.position.x += 3
    expect(stateHash(game)).not.toBe(before)
  })

  it('moves when a ship takes damage', () => {
    const game = duel()
    const before = stateHash(game)
    game.ships[0].structureDamaged[0] = true
    expect(stateHash(game)).not.toBe(before)
  })

  it('ignores the log, which the two consoles narrate differently', () => {
    const game = duel()
    const before = stateHash(game)
    game.log.push({ round: game.round, phase: game.phase, segment: game.segment, message: 'chatter' })
    expect(stateHash(game)).toBe(before)
  })

  it('is stable across a plotted order that changes nothing on the board', () => {
    const game = duel()
    game.orders[game.ships[0].id] = defaultCommandCard(game.ships[0])
    const before = stateHash(game)
    applyAction(game, { type: 'plot-turn-rate', shipId: game.ships[0].id, rate: 20 })
    // Orders are secret and unresolved: the boards still match.
    expect(stateHash(game)).toBe(before)
  })
})

describe('the dispatch gate: one console, one side', () => {
  beforeEach(() => {
    setMatchSide(null)
  })

  it('refuses orders for the other commander’s ships in a match', () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    setMatchSide('Blue Force')
    const red = getGame().ships.find((s) => s.side === 'Red Force')!
    const before = journalLength()
    const refused = dispatch({ type: 'plot-accel', shipId: red.id, delta: 1 })
    expect(refused.message).toContain('another console')
    // Nothing was journalled for the other side to receive.
    expect(journalLength()).toBe(before)
    // An own-side action passes the gate (rename is legal in any segment).
    const blue = getGame().ships.find((s) => s.side === 'Blue Force')!
    expect(dispatch({ type: 'rename-ship', shipId: blue.id, name: 'U.S.S. Gatekeeper' }).message).toBeNull()
    setMatchSide(null)
  })

  it('still lets the creator ready an absent side through the gate', () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    enableReadyGate()
    setMatchSide('Blue Force')
    // signal-ready is the one side-carrying action left open: the creator
    // covers sides with nobody at their console (readyAbsentSides).
    const outcome = dispatch({ type: 'signal-ready', side: 'Red Force', ready: true })
    expect(outcome.message === null || !outcome.message.includes('another console')).toBe(true)
    setMatchSide(null)
  })
})

/**
 * The optional rules are agreed before the battle, and `set-coordinated-fire`
 * is one of the handful of actions that belongs to the table rather than to a
 * side — so the ownership gate lets either console send it, and without a lock
 * a player could switch H4 off from inside a firing sequence going against
 * them.
 */
describe('the rule set is settled when the match begins', () => {
  beforeEach(() => {
    setMatchSide(null)
    newGame({ scenarioId: 's3.1-the-duel', seed: 5, coordinatedFire: true })
  })

  it('lets a solo captain change their mind', () => {
    expect(getGame().coordinatedFire).toBe(true)
    expect(dispatch({ type: 'set-coordinated-fire', on: false }).message).toBeNull()
    expect(getGame().coordinatedFire).toBe(false)
  })

  it('refuses the change once the rules are locked', () => {
    expect(lockOptionalRules()).toBe(true)
    expect(getGame().rulesLocked).toBe(true)
    const refused = dispatch({ type: 'set-coordinated-fire', on: false })
    expect(refused.message).toMatch(/settled when the match began/i)
    expect(getGame().coordinatedFire).toBe(true)
  })

  it('refuses it from the other console too, so the two journals stay identical', () => {
    lockOptionalRules()
    setMatchSide('Red Force')
    // The gate passes it — the action names no side — and the engine is what
    // refuses, which is the point: a modified client changes nothing here.
    dispatch({ type: 'set-coordinated-fire', on: false })
    expect(getGame().coordinatedFire).toBe(true)
    setMatchSide(null)
  })

  it('travels in the save, so a joiner and a replay arrive locked', () => {
    lockOptionalRules()
    const rebuilt = replayGame(currentSave())
    expect(rebuilt.rulesLocked).toBe(true)
    expect(rebuilt.coordinatedFire).toBe(true)
  })

  it('will not lock a battle that is already under way', () => {
    const blue = getGame().ships.find((s) => s.side === 'Blue Force')!
    dispatch({ type: 'rename-ship', shipId: blue.id, name: 'U.S.S. Too Late' })
    expect(lockOptionalRules()).toBe(false)
    expect(getGame().rulesLocked).toBe(false)
  })
})
