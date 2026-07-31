import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from '../engine/actions'
import { aiNextActions, createAiMemo } from '../engine/ai'
import { activeShips, type GameState } from '../engine/game'
import { fxAfter, fxBefore, weaponFx, type BattleFx } from './fx'

/**
 * Battle visuals are a pure function of the action stream, so an AI-fought
 * battle doubles as the fixture: every volley the captains fire must come out
 * the other side as shots and impacts, correctly classified.
 */

function collectFx(scenarioId: string, seed: number, sides: string[], rounds: number): BattleFx[] {
  const game: GameState = startScenario(scenarioId, { seed })
  const memo = createAiMemo()
  const all: BattleFx[] = []
  const land = (action: GameAction) => {
    const pre = fxBefore(game, action)
    const outcome = applyAction(game, action)
    all.push(...pre, ...fxAfter(game, action, outcome))
  }
  const drive = (closing: boolean) => {
    for (let guard = 0; guard < 300; guard++) {
      const batch = aiNextActions(game, sides, memo, closing)
      if (batch.length === 0) return
      for (const action of batch) land(action)
      closing = false
    }
    throw new Error('driver did not settle')
  }
  drive(false)
  for (let steps = 0; steps < 200; steps++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    land({ type: 'advance-segment' })
    drive(false)
  }
  return all
}

describe('battle effects', () => {
  it('classifies weapons by their printed names', () => {
    expect(weaponFx('LNC-447 PHASER')).toBe('phaser')
    expect(weaponFx('MK-3 A/MAT TORPEDO')).toBe('torpedo')
    expect(weaponFx('TYPE-41 GRAVITIC DISRUPTOR')).toBe('disruptor')
    expect(weaponFx('SOMETHING ELSE')).toBe('generic')
  })

  it('a fought duel produces phaser, torpedo and disruptor fire, and both impacts', () => {
    // The Duel is Yorktown (phasers + torpedoes) against Karnath (disruptors).
    const fx = collectFx('s3.1-the-duel', 42, ['Blue Force', 'Red Force'], 10)
    const shots = fx.filter((f) => f.kind === 'shot')
    const weapons = new Set(shots.map((f) => f.weapon))
    expect(weapons.has('phaser')).toBe(true)
    expect(weapons.has('torpedo')).toBe(true)
    expect(weapons.has('disruptor')).toBe(true)

    const impacts = fx.filter((f) => f.kind === 'impact')
    const kinds = new Set(impacts.map((f) => f.impact))
    expect(kinds.has('shield')).toBe(true)
    expect(kinds.has('hull')).toBe(true)

    // Staggers are sane: non-negative, and mounts of one volley spread out.
    for (const f of fx) expect(f.delay).toBeGreaterThanOrEqual(0)
    expect(shots.some((f) => f.delay > 0)).toBe(true)
  })

  it('homing torpedoes flash on impact, read off the board before resolution', () => {
    const fx = collectFx('exp5-aurelian-raid', 3, ['Blue Force', 'Aurelian Empire'], 12)
    // The raid's homing volleys arrive: torpedo shots into the target ship
    // plus a hull burst, derived from resolve-homing-impacts.
    expect(fx.some((f) => f.kind === 'shot' && f.weapon === 'torpedo')).toBe(true)
    expect(fx.some((f) => f.kind === 'impact' && f.impact === 'hull')).toBe(true)
  })

  it('a refused volley leaves no trace', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const action: GameAction = {
      type: 'fire-volley',
      attackerId: 'missing',
      targetId: 'also-missing',
      mounts: [],
      mode: 'standard',
      degraded: false,
    }
    const outcome = applyAction(game, action)
    expect(fxAfter(game, action, outcome)).toHaveLength(0)
  })
})
