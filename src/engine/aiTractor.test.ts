import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips, type GameState } from './game'
import type { TractorLink } from './tractor'

/**
 * Tractor doctrine (J3), and the bookkeeping that had to exist before a
 * computer could be trusted with it.
 *
 * The beam does no damage. What it does is take speed away — and J3.3.4 takes
 * it from *both* ships, cross-indexed against each other's size class. That
 * asymmetry is the whole tactic: a hull tied to something two classes larger
 * drops from speed 6 to 2 while the larger one goes to 4. Grabbing down the
 * size chart is a weapon; grabbing up it is a favour to the enemy.
 *
 * The other half is the door. A ship held in a beam may not go to FTL
 * (J3.4.4), so a cripple that has decided to leave does not get to.
 *
 * Before this, `tractor-lock` was emitted only at a crippled enemy inside one
 * inch and `release-tractor`, `contest-tractor` and `displace-tractored` were
 * never emitted at all — three actions the engine understood and no player
 * ever sent.
 */

function fight(scenario: string, seed: number, rounds = 10) {
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
    journal.push({ type: 'advance-segment' })
    drive(false)
  }
  return { game, journal }
}

describe('a captain with tractor beams', () => {
  it('reaches for them at all, and settles the segment when it has', () => {
    /*
     * The wedge this guards against is the shape of every other refused
     * action: a plan that re-emits what the rules just turned down never
     * empties its batch, and the game hangs inside the segment rather than
     * playing something worse.
     *
     * Several seeds, because a beam reaches one inch at normal power and
     * whether two hulls ever pass that close is a property of the battle
     * rather than of the doctrine. Written against one seed, this passed until
     * an unrelated change to the power-allocation order moved the ships.
     */
    let locks = 0
    for (const seed of [3, 5, 8, 11, 14]) {
      locks += fight('exp2-squadron-engagement', seed).journal.filter(
        (a) => a.type === 'tractor-lock',
      ).length
    }
    expect(locks, 'no tractor lock attempted across five squadron battles').toBeGreaterThan(0)
  })

  it('does not tie itself to a hull two size classes larger (J3.3.4)', () => {
    /*
     * The chart punishes the smaller partner hardest, so this is the enemy's
     * tactic rather than ours. The exception the doctrine keeps is a cripple:
     * that lock is holding the door shut on an FTL escape (J3.4.4), which is
     * worth the speed it costs.
     */
    const { game, journal } = fight('exp2-squadron-engagement', 3)
    const sizeOf = (id: string) => game.ships.find((s) => s.id === id)?.form.sizeClass ?? 0
    for (const action of journal) {
      if (action.type !== 'tractor-lock') continue
      const source = game.ships.find((s) => s.id === action.shipId)!
      // Two or more classes larger is the "larger" column of the chart.
      const gap = sizeOf(action.targetId) - source.form.sizeClass
      if (gap >= 2) {
        const crippled = game.log.some((e) => /crippled/i.test(e.message))
        expect(crippled, `${source.name} grabbed something far bigger and healthy`).toBe(true)
      }
    }
  })
})

describe('a captain caught in someone else’s beam', () => {
  it('makes the beam prove itself, once, and does not ask twice (J3.6.1)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 5, mapScale: 2 })
    const [held, captor] = game.ships
    const link: TractorLink = {
      id: `${captor.id}->${held.id}`,
      sourceId: captor.id,
      targetId: held.id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    }
    game.ops.links.push(link)
    game.segment = 'operations'

    const memo = createAiMemo()
    const asked = () =>
      aiNextActions(game, [held.side], memo, false, 'admiral').filter(
        (a) => a.type === 'contest-tractor',
      )

    const first = asked()
    expect(first).toHaveLength(1)
    applyAction(game, first[0])
    // Whether the beam held or broke, the phase's one attempt is spent — and
    // a captain that kept asking would never empty its batch.
    expect(game.ops.contestedThisPhase.has(held.id)).toBe(true)
    expect(asked()).toHaveLength(0)
  })

  it('leaves a friendly tow alone', () => {
    // J3.4.4's other half: a friend with a wrecked FTL drive is towed home,
    // and fighting the beam that is saving you is not seamanship.
    const game = startScenario('exp2-squadron-engagement', { seed: 5, mapScale: 2 })
    const friends = game.ships.filter((s) => s.side === game.ships[0].side)
    expect(friends.length).toBeGreaterThan(1)
    game.ops.links.push({
      id: `${friends[1].id}->${friends[0].id}`,
      sourceId: friends[1].id,
      targetId: friends[0].id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    })
    game.segment = 'operations'
    const batch = aiNextActions(game, [friends[0].side], createAiMemo(), false, 'admiral')
    expect(batch.filter((a) => a.type === 'contest-tractor')).toHaveLength(0)
  })
})
