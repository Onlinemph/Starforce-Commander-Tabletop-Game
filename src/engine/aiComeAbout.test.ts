import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips, defaultCommandCard, type GameState } from './game'

/**
 * The captain must come about. Two ships that charge, pass, and open the
 * range are the commonest shape of a duel — a captain who keeps flying
 * straight with the enemy dead astern has stopped fighting. These tests pin
 * the recovery: the first turn of a comeback must look worth plotting even
 * though it only improves the bearing, not the range.
 */

/** The moment after a head-on pass: the enemy sits dead astern. */
function passedSetup(): GameState {
  const game = startScenario('s3.1-the-duel', { seed: 5 })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  blue.placement = { position: { x: 15, y: 14 }, heading: 0 } // flying north
  red.placement = { position: { x: 15, y: 22 }, heading: 180 } // flying south
  blue.speed = 4
  red.speed = 4
  game.phase = 'combat-1'
  game.segment = 'command'
  for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
  return game
}

describe('the AI comes about', () => {
  it('plots a turn when the enemy is dead astern', () => {
    const game = passedSetup()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo())
    const maneuver = actions.find((a) => a.type === 'plot-maneuver')
    expect(maneuver, 'a ship with its enemy astern must begin turning').toBeDefined()
    expect(maneuver && 'maneuver' in maneuver && maneuver.maneuver).not.toBe('straight')
  })

  it('a full duel keeps fighting after the pass: turns are plotted and late rounds still see fire', () => {
    const game = startScenario('s3.1-the-duel', { seed: 42 })
    const memo = createAiMemo()
    const sides = ['Blue Force', 'Red Force']
    const journal: GameAction[] = []
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, sides, memo, closing)
        if (batch.length === 0) return
        for (const a of batch) {
          applyAction(game, a)
          journal.push({ ...a, round: game.round } as GameAction & { round: number })
        }
        closing = false
      }
      throw new Error('driver did not settle')
    }
    drive(false)
    for (let steps = 0; steps < 300; steps++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 10) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      journal.push({ type: 'advance-segment', round: game.round } as GameAction & { round: number })
      drive(false)
    }

    // The captains actually steer: real turn plots, not a token one.
    const turns = journal.filter(
      (a) => a.type === 'plot-maneuver' && 'maneuver' in a && a.maneuver !== 'straight',
    )
    expect(turns.length).toBeGreaterThanOrEqual(6)

    // And the battle does not go quiet after the first pass: fire keeps
    // landing in the later rounds (or somebody already died of it).
    const over = new Set(activeShips(game).map((s) => s.side)).size <= 1
    const lateVolleys = journal.filter(
      (a) => a.type === 'fire-volley' && (a as { round?: number }).round! >= 4,
    )
    expect(over || lateVolleys.length > 0).toBe(true)
  })
})
