import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips, type GameState } from './game'

/**
 * Point defense (E12.4.3), and a filter that made it impossible.
 *
 * A mount was offered to the interception only if *no* enemy sat inside its
 * brackets and arcs — the idea being to spend only guns that had nothing else
 * to do. But a torpedo comes in from the direction of the ship that launched
 * it, so the only mounts the filter ever left were the ones pointing the other
 * way. The result was airtight: across roughly three hundred measured battles
 * `fire-small-target` was never emitted once, and in every sampled phase where
 * a counter was about to land and the defender had ready, idle point defense
 * aboard, the count of those mounts that could bear on the counter was zero.
 *
 * Idle is now a preference — free mounts are spent first — with a budget of
 * half a ship's point defense for mounts taken out of the volley, so a ship
 * cannot win the interception by losing the gunnery duel.
 *
 * The test is deliberately a whole battle rather than a fixture. The bug was
 * not in any one decision; it was that a plausible-looking filter composed
 * with the geometry to produce nothing, and only a real fight shows that.
 */

function fight(scenario: string, seed: number, rounds = 12) {
  const game: GameState = startScenario(scenario, { seed, mapScale: 2 })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = sides.map(() => createAiMemo())
  const journal: GameAction[] = []
  const drive = (closing: boolean) => {
    for (const [index, side] of sides.entries()) {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, [side], memos[index], closing, 'admiral')
        if (batch.length === 0) break
        for (const a of batch) {
          applyAction(game, a)
          journal.push(a)
        }
        if (guard === 299) throw new Error(`${side} never settled in ${game.segment}`)
      }
    }
  }
  drive(false)
  for (let step = 0; step < 400; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    drive(false)
  }
  return { game, journal }
}

describe('a fleet under a torpedo wave', () => {
  it('actually shoots at the torpedoes', () => {
    // The Aurelian raid is the scenario built around homing weapons, so it is
    // where an interception that never happens is most visible.
    let shots = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { journal } = fight('exp5-aurelian-raid', seed)
      shots += journal.filter((a) => a.type === 'fire-small-target').length
    }
    expect(shots, 'point defense never fired across six raids').toBeGreaterThan(0)
  })

  it('does not turn its whole battery on the wave', () => {
    /*
     * The budget: at most half a ship's ready point defense may be taken out
     * of the volley in a phase. Without a ceiling, "shoot the torpedoes" is
     * the kind of rule that quietly stops a fleet firing at ships at all.
     */
    const { journal } = fight('exp5-aurelian-raid', 1)
    const perPhase = new Map<string, number>()
    let phase = 0
    for (const action of journal) {
      if (action.type === 'advance-segment') phase += 1
      if (action.type !== 'fire-small-target') continue
      const key = `${phase}:${action.attackerId}`
      perPhase.set(key, (perPhase.get(key) ?? 0) + 1)
    }
    // Every printed hull in this scenario carries a small point-defense
    // battery; none of them should be emptying it into the sky in one phase.
    for (const [key, count] of perPhase) {
      expect(count, `${key} fired ${count} interceptions in one phase`).toBeLessThanOrEqual(4)
    }
  })
})
