import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { type GameState } from './game'
import { structureRemaining } from './shipState'

/**
 * Fleet coordination: a squadron's guns converge on the same kill.
 */

describe('fleet focus fire', () => {
  it('the squadron converges on one kill instead of spreading damage', () => {
    const game: GameState = startScenario('exp2-squadron-engagement', { seed: 6 })
    const blues = game.ships.filter((s) => s.side === 'Blue Force')
    const reds = game.ships.filter((s) => s.side === 'Red Force')

    // Two shooters, two identical-range targets — one already half broken.
    blues[0].placement = { position: { x: 12, y: 20 }, heading: 0 }
    blues[1].placement = { position: { x: 18, y: 20 }, heading: 0 }
    reds[0].placement = { position: { x: 12, y: 12 }, heading: 180 }
    reds[1].placement = { position: { x: 18, y: 12 }, heading: 180 }
    for (const other of [...blues.slice(2), ...reds.slice(2)]) other.destroyed = true
    const wounded = reds[1]
    wounded.structureDamaged = wounded.structureDamaged.map((_, i, all) => i < all.length * 0.6)
    expect(structureRemaining(wounded)).toBeLessThan(structureRemaining(reds[0]))

    // Arm every blue battery by hand and enter the Combat Segment.
    for (const ship of [blues[0], blues[1]]) {
      for (const weapon of ship.form.weapons) {
        weapon.mounts.forEach((mount, i) => {
          ship.mounts[weapon.id][i].armed = mount.armingCircles
        })
      }
      ship.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
    }
    game.phase = 'combat-1'
    game.segment = 'combat'

    const actions: GameAction[] = []
    const memo = createAiMemo()
    for (let guard = 0; guard < 20; guard++) {
      const batch = aiNextActions(game, ['Blue Force'], memo, true, 'captain')
      if (batch.length === 0) break
      for (const action of batch) {
        applyAction(game, action)
        actions.push(action)
      }
    }

    const volleys = actions.filter((a) => a.type === 'fire-volley')
    expect(volleys.length).toBeGreaterThanOrEqual(2)
    // Everyone shoots the wounded ship: kill one, then the next.
    for (const volley of volleys) {
      expect('targetId' in volley && volley.targetId).toBe(wounded.id)
    }
  })
})
