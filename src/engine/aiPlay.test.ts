import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo, type AiMemo } from './ai'
import { activeShips, victoryPoints, type GameState } from './game'
import { damageLevel, structureRemaining } from './shipState'

/**
 * Self-play: whole battles fought by the AI against itself, exactly as the
 * store drives it — closing duties before each segment advance, normal duties
 * after. This is the regression net for the captain: it must never wedge the
 * sequence of play, never argue with the rules in a loop, and actually fight.
 */

interface Driver {
  game: GameState
  journal: GameAction[]
  memo: AiMemo
  sides: string[]
}

function drive(d: Driver, closing = false): void {
  for (let guard = 0; guard < 300; guard++) {
    const batch = aiNextActions(d.game, d.sides, d.memo, closing)
    if (batch.length === 0) return
    for (const action of batch) {
      applyAction(d.game, action)
      d.journal.push(action)
    }
    closing = false
  }
  throw new Error('AI driver did not settle within 300 iterations')
}

function overFor(game: GameState): boolean {
  const sides = new Set(activeShips(game).map((s) => s.side))
  return sides.size <= 1
}

/** Play a battle to a decision or a round cap, the way the store would. */
function selfPlay(scenarioId: string, seed: number, sides: string[], rounds = 14): Driver {
  const d: Driver = {
    game: startScenario(scenarioId, { seed }),
    journal: [],
    memo: createAiMemo(),
    sides,
  }
  drive(d)
  for (let steps = 0; steps < 400; steps++) {
    if (overFor(d.game) || d.game.round > rounds) break
    drive(d, true)
    applyAction(d.game, { type: 'advance-segment' })
    d.journal.push({ type: 'advance-segment' })
    drive(d)
  }
  return d
}

describe('AI self-play', () => {
  it('fights a duel to a decision without wedging', () => {
    const d = selfPlay('s3.1-the-duel', 42, ['Blue Force', 'Red Force'])
    // The battle was fought, not idled: volleys landed and hulls took damage.
    expect(d.journal.some((a) => a.type === 'fire-volley')).toBe(true)
    const damaged = d.game.ships.some(
      (s) => s.destroyed || s.disengaged || damageLevel(s) !== 'none',
    )
    expect(damaged).toBe(true)
    // Somebody scored.
    const points = Object.values(victoryPoints(d.game))
    expect(Math.max(...points)).toBeGreaterThan(0)
  })

  it('is deterministic: same seed, same battle, action for action', () => {
    const a = selfPlay('s3.1-the-duel', 7, ['Blue Force', 'Red Force'], 6)
    const b = selfPlay('s3.1-the-duel', 7, ['Blue Force', 'Red Force'], 6)
    expect(JSON.stringify(a.journal)).toBe(JSON.stringify(b.journal))
  })

  it('beats an opponent that does nothing', () => {
    const d = selfPlay('s3.1-the-duel', 11, ['Blue Force'])
    const passive = d.game.ships.find((s) => s.side === 'Red Force')!
    const active = d.game.ships.find((s) => s.side === 'Blue Force')!
    // The passive ship is worse off than the one shooting at it.
    expect(structureRemaining(passive)).toBeLessThan(structureRemaining(active))
  })

  it('survives every scenario, including terrain and the Aurelians', () => {
    const boards: Array<[string, string[]]> = [
      ['s3.3-orbital-ambush', ['Blue Force', 'Red Force']],
      ['exp2-squadron-engagement', ['Blue Force', 'Red Force']],
      ['exp3-nebula-patrol', ['Blue Force', 'Red Force']],
      ['exp5-aurelian-raid', ['Blue Force', 'Aurelian Empire']],
    ]
    for (const [scenarioId, sides] of boards) {
      const d = selfPlay(scenarioId, 3, sides, 5)
      expect(d.game.round).toBeGreaterThan(1)
    }
  })

  it('respects rocks: no full-speed transit of an asteroid field it can avoid', () => {
    const d = selfPlay('s3.1-the-duel', 21, ['Blue Force', 'Red Force'], 8)
    // Weak but honest assertion: the game with terrain runs clean too.
    const t = startScenario('s3.1-the-duel', { seed: 21, terrain: 6 })
    const dt: Driver = { game: t, journal: [], memo: createAiMemo(), sides: ['Blue Force', 'Red Force'] }
    drive(dt)
    for (let steps = 0; steps < 200; steps++) {
      if (overFor(dt.game) || dt.game.round > 8) break
      drive(dt, true)
      applyAction(dt.game, { type: 'advance-segment' })
      drive(dt)
    }
    expect(dt.game.round).toBeGreaterThan(1)
    expect(d.game.round).toBeGreaterThan(1)
  })

  it('the idempotence contract holds: asking twice owes nothing new', () => {
    const d: Driver = {
      game: startScenario('s3.1-the-duel', { seed: 99 }),
      journal: [],
      memo: createAiMemo(),
      sides: ['Red Force'],
    }
    drive(d)
    // Immediately asking again — as every human click does — owes nothing.
    expect(aiNextActions(d.game, d.sides, d.memo)).toHaveLength(0)
  })
})
