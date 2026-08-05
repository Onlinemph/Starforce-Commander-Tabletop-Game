import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch, getGame, newGame, unattendedSides } from './store'

/**
 * The silent walkover.
 *
 * A side that is neither handed to the computer nor given orders does not
 * lose a battle — it never fights one. Its ships hold their opening speed,
 * never plot, never fire, and are taken apart by whoever *is* being played,
 * and nothing in the rules objects, because declining to give orders is
 * legal. That makes it invisible, and it is one missed checkbox away.
 *
 * It matters because it corrupts every conclusion drawn afterwards. Measured
 * on the two fan destroyers, mirrored, 40 games: with both sides driven the
 * Sharlin loses to the Omega 0-40; with the Omega left untended the same duel
 * reads 40-0 the other way, and the Sharlin kills 11 of them. Same hulls,
 * same dice, same board — the only difference is that nobody was flying one
 * of them. A test bench that can do that without saying so is worse than no
 * test bench.
 */

const DUEL = { scenarioId: 's3.1-the-duel', seed: 5 }

/** Segment advances from the opening Resource Allocation to the next one. */
const SEGMENTS_PER_ROUND = 25

/** Walk the sequence of play forward without anybody giving an order. */
function idleThrough(segments: number): void {
  for (let i = 0; i < segments; i++) dispatch({ type: 'advance-segment' })
}

describe('a force nobody is commanding', () => {
  beforeEach(() => {
    newGame({ ...DUEL })
  })

  it('says nothing during the opening round, when silence is still normal', () => {
    expect(unattendedSides()).toEqual([])
    // Part way through round one is still too early to accuse anyone.
    idleThrough(3)
    expect(getGame().round).toBe(1)
    expect(unattendedSides()).toEqual([])
  })

  it('names both sides once a whole round has passed in silence', () => {
    idleThrough(SEGMENTS_PER_ROUND)
    expect(getGame().round).toBeGreaterThan(1)
    expect(unattendedSides()).toEqual(['Blue Force', 'Red Force'])
  })

  it('clears a side the moment it gives an order', () => {
    idleThrough(SEGMENTS_PER_ROUND)
    const ship = getGame().ships.find((s) => s.side === 'Blue Force')!
    dispatch({ type: 'plot-accel', shipId: ship.id, delta: 0 })
    expect(unattendedSides()).toEqual(['Red Force'])
  })

  it('never accuses a side the computer is flying', () => {
    newGame({ ...DUEL, aiSides: ['Red Force'] })
    idleThrough(SEGMENTS_PER_ROUND)
    // Red is the computer's, so only the empty chair is named.
    expect(unattendedSides()).toEqual(['Blue Force'])
  })

  it('is silent when the computer has both forces — the self-play case', () => {
    newGame({ ...DUEL, aiSides: ['Blue Force', 'Red Force'] })
    idleThrough(SEGMENTS_PER_ROUND)
    expect(unattendedSides()).toEqual([])
  })
})
