import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { commandPointsAvailable, commandSystemBoxes } from './command'
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
    const { game } = fight()
    for (const side of new Set(game.ships.map((s) => s.side))) {
      const flag = game.ships.find((s) => s.id === commandStateFor(game, side).commandShipId)
      if (!flag || commandSystemBoxes(flag) === 0) continue
      expect(genSysSetting(flag), `${flag.name} flies the flag but sits below MAX`).toBe('max')
      expect(commandPointsAvailable(flag)).toBeGreaterThan(0)
    }
  })

  it('pushes a consort past the cap its own sensors impose (H5.2.2)', () => {
    const { game } = fight()
    const lent = lentScanPoints(game)
    const helped = activeShips(game).filter((s) => (lent[s.id] ?? 0) > 0)
    expect(helped.length).toBeGreaterThan(0)
    // The whole point of a loan: effective scan above what the ship plotted.
    for (const s of helped) {
      expect(tacticalScanOf(game, s)).toBeGreaterThan(s.sensors.tacticalScan)
    }
  })
})
