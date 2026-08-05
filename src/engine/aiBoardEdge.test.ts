import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { shipFormById } from '../data/ships'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips, type GameState } from './game'

/**
 * The captain has to stay on the board.
 *
 * Leaving it ends the battle (J9.2.2), and a hull that cannot turn at its
 * current speed — C2.2.2 prints a `0` in the turn row for several printed
 * ships — commits to that several rounds before the edge arrives. The UNION
 * dreadnoughts have such a row at their best speed, and the captain used to
 * accelerate into it while closing: six phases of one heading, straight
 * through the enemy and off the far side of a 36-inch map, at nearly full
 * structure with the enemy nearly dead.
 *
 * These run on the printed board on purpose. Seasons are fought at 72 inches
 * where the problem barely appears, which is exactly why it needs a test — the
 * standing baselines would not catch a regression here.
 */

const UNION_III = 'union-union-iii-class-dreadnought'
const EXETER_II = 'union-exeter-ii-class-heavy-cruiser'

/** A printed-board duel between two heavy hulls, played out by both captains. */
function playPrinted(seed: number, rounds = 10): GameState {
  const game = startScenario('s3.1-the-duel', {
    seed,
    mapScale: 1,
    fleets: { 'Blue Force': [UNION_III], 'Red Force': [EXETER_II] },
  })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = sides.map(() => createAiMemo())
  for (let guard = 0; guard < 400; guard++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1) break
    if (game.round > rounds) break
    for (const [i, side] of sides.entries()) {
      for (let k = 0; k < 60; k++) {
        const batch = aiNextActions(game, [side], memos[i], k === 0, 'captain', 'steady', false)
        if (batch.length === 0) break
        for (const a of batch) applyAction(game, a as GameAction)
      }
    }
    applyAction(game, { type: 'advance-segment' })
  }
  return game
}

describe('the captain stays on the board', () => {
  it('has hulls that cannot turn at their best speed, or these tests prove nothing', () => {
    const form = shipFormById(UNION_III)!
    const top = form.sublight.maxSpeed
    expect(form.sublight.turnBySpeed[top]).toBe(0)
    // And no free acceleration, so it sheds speed slowly (B2.2).
    expect(form.functions.find((l) => l.kind === 'accel')?.freeValue).toBe(0)
  })

  /*
   * Ablated on these eight seeds: with the committed-run check disabled the
   * dreadnought leaves in 7 of 8, and with it in 4. Half the problem, not all
   * of it — the printed map is genuinely tight for a hull this size, which is
   * why seasons moved to 72 inches rather than waiting for this to be perfect.
   * Five is the guard: it catches a regression to the old behaviour while
   * leaving a game of slack for dice.
   */
  it('roughly halves the times a dreadnought flies off a printed map', () => {
    let left = 0
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const game = playPrinted(seed)
      const me = game.ships.find((s) => s.form.id === UNION_III)!
      if (me.disengaged) left += 1
    }
    // Retreat is off, so a departure here is the helm running out of board
    // rather than a captain deciding to go.
    expect(left).toBeLessThanOrEqual(5)
  })

  it('fights the battle instead: the cruiser is the one that dies', () => {
    let killed = 0
    let lost = 0
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const game = playPrinted(seed)
      const me = game.ships.find((s) => s.form.id === UNION_III)!
      const foe = game.ships.find((s) => s.form.id === EXETER_II)!
      if (foe.destroyed) killed += 1
      if (me.destroyed) lost += 1
    }
    expect(killed).toBeGreaterThan(lost)
  })
})
