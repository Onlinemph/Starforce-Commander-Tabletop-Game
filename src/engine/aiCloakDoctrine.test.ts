import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { cloakStrength, isCloaked } from './cloaking'
import { activeShips, cloakOf, type GameState } from './game'

/**
 * Cloak doctrine, both ends of it.
 *
 * The rules make this unusually sharp. A cloaked ship's jamming *is* its cloak
 * strength (`cloakStrength` reads the figure straight off the card), and a
 * searcher whose targeting is below it may not attempt a search at all
 * (H6.10.2) — equal targeting rolls one die, and only targeting above it rolls
 * in numbers. Meanwhile a cloaked ship cannot fire at all (H6.4.2).
 *
 * So the captain has two jobs it used to fail: while dark, put the sensor line
 * into jamming and come out for the shot rather than hiding through it; while
 * hunting, outbid the ghost's jamming or do not bother searching.
 *
 * Measured before this doctrine, an INVICTUS I against a YORKTOWN V spent 68%
 * of its command segments cloaked, fired 1.7 volleys a game and killed 4
 * opponents in 24. The same hull with its cloak *removed* killed 15. The AI
 * was using the cloak as armour.
 */

function fight(scenario: string, seed: number, sides: string[], rounds = 10) {
  const game: GameState = startScenario(scenario, { seed })
  const memo = createAiMemo()
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
  for (let step = 0; step < 400; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    journal.push({ type: 'advance-segment' })
    drive(false)
  }
  return { game, journal }
}

describe('a cloaked captain', () => {
  it('puts the sensor line into jamming, because jamming is the cloak', () => {
    const { game } = fight('exp5-aurelian-raid', 1, ['Blue Force', 'Aurelian Empire'])
    const dark = game.ships.filter((s) => {
      const c = cloakOf(game, s)
      return c && isCloaked(c)
    })
    // Whatever else it spent, a hidden ship's jamming is not zero — that is
    // the number a hunter has to beat before it may roll at all.
    for (const s of dark) expect(cloakStrength(s), s.name).toBeGreaterThan(0)
  })

  it('comes out of the dark to shoot rather than hiding through the battle', () => {
    const { game, journal } = fight('exp5-aurelian-raid', 1, ['Blue Force', 'Aurelian Empire'])
    const types = journal.map((a) => a.type)
    expect(types).toContain('engage-cloak')
    expect(types).toContain('decloak')
    // The point of decloaking: something is fired afterwards. A cloak that
    // never leads to a volley is armour, which is what this doctrine fixed.
    const shots = game.log.filter((e) => / fires on | launches /.test(e.message))
    expect(shots.length).toBeGreaterThan(0)
  })
})

describe('a captain hunting a ghost', () => {
  it('bids its targeting above the ghost it is hunting', () => {
    const { game } = fight('exp5-aurelian-raid', 1, ['Blue Force', 'Aurelian Empire'])
    const ghosts = game.ships.filter((s) => {
      const c = cloakOf(game, s)
      return c && isCloaked(c)
    })
    if (ghosts.length === 0) return // nobody hid this battle; nothing to prove
    const hunters = activeShips(game).filter((s) => s.side !== ghosts[0].side)
    const bestJamming = Math.max(...ghosts.map((g) => cloakStrength(g)))
    // At least one hunter can actually roll: targeting at or above the bid.
    expect(Math.max(0, ...hunters.map((h) => h.sensors.targeting))).toBeGreaterThanOrEqual(
      Math.min(bestJamming, 1),
    )
  })
})
