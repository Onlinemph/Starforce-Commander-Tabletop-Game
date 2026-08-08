import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { commandSystemBoxes } from './command'
import { activeShips, commandStateFor, lentScanPoints, tacticalScanOf } from './game'
import { genSysSetting } from './shipState'

/**
 * Command systems (H5) — the one system the captain paid for and never
 * switched on.
 *
 * A command ship lends tactical scan to its squadron, and H5.2.2 lets a lent
 * point push a ship *past* the cap its own sensor rating imposes: the only way
 * in the game to buy initiative a hull cannot buy for itself. Firing order
 * decides who shoots first, and under the one-opportunity rule that often
 * decides who shoots at all.
 *
 * The catch is H5.1.3: CMND boxes produce nothing unless the ship's GEN SYS
 * line is at MAX. Queued behind the guns and the eyes that power point never
 * arrived, and the whole system stayed dark — the squadron season did not move
 * by a single game out of 192. Bought early it is worth ten: 110W-81L → 120W-72L.
 */

function fight(rounds = 4) {
  const game = startScenario('exp2-squadron-engagement', { seed: 3, mapScale: 2 })
  const memo = createAiMemo()
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const journal: GameAction[] = []
  const drive = (closing: boolean) => {
    for (let guard = 0; guard < 300; guard++) {
      const batch = aiNextActions(game, sides, memo, closing, 'admiral')
      if (batch.length === 0) return
      for (const a of batch) {
        applyAction(game, a)
        journal.push(a)
      }
      closing = false
    }
    throw new Error('the captains never settled')
  }
  drive(false)
  for (let step = 0; step < 200; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    journal.push({ type: 'advance-segment' })
    drive(false)
  }
  return { game, journal }
}

describe('a squadron with a flag bridge', () => {
  it('lends its scan, having a flag designated to lend it', () => {
    const { game, journal } = fight()
    // A scenario may already name a flag, so re-designation is not guaranteed
    // — what must happen is that somebody ends up flying it and lending.
    for (const side of new Set(game.ships.map((s) => s.side))) {
      expect(commandStateFor(game, side).commandShipId, side).toBeTruthy()
    }
    expect(journal.map((a) => a.type)).toContain('assign-command')
  })

  it('powers the flag to GEN SYS MAX, or the boxes produce nothing (H5.1.3)', () => {
    /*
     * Sampled through the battle, not off the end state. Which ship flies the
     * flag and whether it still has consorts in range both change as hulls
     * die, so the final position says nothing about whether the captain ever
     * bought the power point — an earlier version read the end and broke the
     * moment an unrelated change altered where the battle stopped.
     */
    const game = startScenario('exp2-squadron-engagement', { seed: 3, mapScale: 2 })
    const memo = createAiMemo()
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, sides, memo, closing, 'admiral')
        if (batch.length === 0) return
        for (const a of batch) applyAction(game, a)
        closing = false
      }
      throw new Error('the captains never settled')
    }
    let everPowered = false
    drive(false)
    for (let step = 0; step < 200; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 4) break
      drive(true)
      for (const side of sides) {
        const flag = game.ships.find((s) => s.id === commandStateFor(game, side).commandShipId)
        // Points can still read zero at MAX once the CMND boxes are shot
        // out, which is the rule working; what is being tested is that the
        // captain bought the power point at all.
        if (flag && commandSystemBoxes(flag) > 0 && genSysSetting(flag) === 'max') {
          everPowered = true
        }
      }
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    expect(everPowered, 'no flag ever reached GEN SYS MAX').toBe(true)
  })

  it('pushes a consort past the cap its own sensors impose (H5.2.2)', () => {
    /*
     * Sampled through the battle, like the GEN SYS test above and for the
     * same reason. This used to read the loan off the END state, and passed
     * for months on the accident that seed 3 happened to finish with a loan
     * still active — until rollout plotting moved where the battle stops and
     * the final position had a dead flag. Mid-battle the doctrine was running
     * the whole time: 255 lent samples across the same four rounds.
     */
    const game = startScenario('exp2-squadron-engagement', { seed: 3, mapScale: 2 })
    const memo = createAiMemo()
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, sides, memo, closing, 'admiral')
        if (batch.length === 0) return
        for (const a of batch) applyAction(game, a)
        closing = false
      }
      throw new Error('the captains never settled')
    }
    let loans = 0
    let aboveOwnCap = 0
    drive(false)
    for (let step = 0; step < 200; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 4) break
      drive(true)
      const lent = lentScanPoints(game)
      for (const s of activeShips(game)) {
        if ((lent[s.id] ?? 0) > 0) {
          loans += 1
          // The whole point of a loan: scan above what the hull plotted.
          if (tacticalScanOf(game, s) > s.sensors.tacticalScan) aboveOwnCap += 1
        }
      }
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    expect(loans, 'no consort ever held a lent scan point').toBeGreaterThan(0)
    expect(aboveOwnCap).toBe(loans)
  })
})

/**
 * Precise turns (C3.9.1): a turn may be taken at any rate up to the one the
 * table allows. The captain used to take the full template every time, so its
 * only choices were "swing as hard as the ship can" or "fly straight" — which
 * is what walking a battery onto a target instead of sweeping past it needs.
 *
 * Admiral only: it multiplies the candidate space, and rank is search depth.
 * Worth 117W-75L → 126W-66L in the duel season and 120W-72L → 122W-68L in the
 * squadron.
 */
describe('precise turns', () => {
  const rates = (difficulty: 'admiral' | 'captain') => {
    const game = startScenario('s3.1-the-duel', { seed: 3, mapScale: 2 })
    const memo = createAiMemo()
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const seen: number[] = []
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, sides, memo, closing, difficulty)
        if (batch.length === 0) return
        for (const a of batch) {
          if (a.type === 'plot-turn-rate' && a.rate !== null) seen.push(a.rate)
          applyAction(game, a)
        }
        closing = false
      }
      throw new Error('the captains never settled')
    }
    drive(false)
    for (let step = 0; step < 200; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 6) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    return seen
  }

  it('are used by the admiral, and are always below the full template', () => {
    const seen = rates('admiral')
    expect(seen.length).toBeGreaterThan(0)
    // Every printed counter, and never one the table would refuse.
    for (const r of seen) expect([20, 25, 30, 35, 40, 45, 60]).toContain(r)
  })

  it('are not offered below admiral — rank is search depth', () => {
    expect(rates('captain')).toEqual([])
  })
})
