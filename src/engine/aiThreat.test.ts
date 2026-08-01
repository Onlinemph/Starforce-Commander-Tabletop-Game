import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo } from './ai'
import { defaultCommandCard, type GameState } from './game'

/**
 * Threat assessment: the AI reads the table — who is close, who is bow-on —
 * and turns that into shield doctrine. All public information; nothing an
 * opponent across a physical table could not see.
 */

describe('threat-aware shields', () => {
  function allocationGame(): GameState {
    // Round zero, Resource Allocation. Weapons are wrecked so the budget is
    // free to show the shield doctrine plainly.
    const game = startScenario('s3.1-the-duel', { seed: 7 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.placement = { position: { x: 15, y: 20 }, heading: 0 }
    red.placement = { position: { x: 15, y: 10 }, heading: 180 } // dead ahead of blue
    for (const weapon of blue.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        blue.mounts[weapon.id][i].damage = mount.hitBoxes
      })
    }
    return game
  }

  it('the captain reinforces the shield side facing the threat', () => {
    const game = allocationGame()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const forward = blue.form.functions.find(
      (l) => l.kind === 'shield-reinforce' && l.shieldSide === 'F',
    )
    expect(forward, 'the fixture hull needs an F reinforcement line').toBeDefined()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    const reinforced = actions.find((a) => a.type === 'allocate' && a.lineId === forward!.id)
    expect(reinforced, 'enemy dead ahead — the F shield should get a point').toBeDefined()
  })

  it('the ensign does not think about incoming fire', () => {
    const game = allocationGame()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const forward = blue.form.functions.find(
      (l) => l.kind === 'shield-reinforce' && l.shieldSide === 'F',
    )!
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'ensign')
    expect(actions.find((a) => a.type === 'allocate' && a.lineId === forward.id)).toBeUndefined()
  })

  it('the hull answers to every enemy: the flanker decides which way it rotates', () => {
    // Bow shield stripped, target ahead: the hull must angle away. With one
    // enemy the left/right choice is a symmetric coin; a flanker breaks the
    // symmetry through the aggregate threat axis, so the plotted maneuver
    // must depend on which side the flanker holds.
    const plot = (flank: 'starboard' | 'port') => {
      const game = startScenario('exp2-squadron-engagement', { seed: 4 })
      const blues = game.ships.filter((s) => s.side === 'Blue Force')
      const reds = game.ships.filter((s) => s.side === 'Red Force')
      const me = blues[0]
      me.placement = { position: { x: 15, y: 20 }, heading: 0 }
      reds[0].placement = { position: { x: 15, y: 8 }, heading: 180 } // ahead
      // Forward-quarter flanker: close enough to the bow axis that the
      // stripped F still faces the aggregate threat — it only breaks the
      // left/right symmetry of the turn away.
      reds[1].placement =
        flank === 'starboard'
          ? { position: { x: 21, y: 9 }, heading: 225 }
          : { position: { x: 9, y: 9 }, heading: 135 }
      // Everyone else is out of the battle entirely.
      for (const other of [...blues.slice(1), ...reds.slice(2)]) {
        other.destroyed = true
      }
      me.blueShieldDamage.F = 99
      me.greenShieldDamage.F = 99
      game.phase = 'combat-1'
      game.segment = 'command'
      for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
      const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
      return JSON.stringify(
        actions.filter(
          (a) => 'shipId' in a && a.shipId === me.id && (a.type === 'plot-maneuver' || a.type === 'plot-accel'),
        ),
      )
    }
    expect(plot('starboard')).not.toBe(plot('port'))
  })

  it('a stripped shield changes the plotted maneuver: the hull turns a healthy side in', () => {
    const plot = (stripForward: boolean) => {
      const game = startScenario('s3.1-the-duel', { seed: 7 })
      const blue = game.ships.find((s) => s.side === 'Blue Force')!
      const red = game.ships.find((s) => s.side === 'Red Force')!
      blue.placement = { position: { x: 15, y: 26 }, heading: 0 }
      red.placement = { position: { x: 19, y: 9 }, heading: 180 } // far, off the bow
      if (stripForward) {
        blue.blueShieldDamage.F = 99
        blue.greenShieldDamage.F = 99
      }
      game.phase = 'combat-1'
      game.segment = 'command'
      for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
      const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
      return JSON.stringify(actions.filter((a) => a.type === 'plot-maneuver' || a.type === 'plot-accel'))
    }
    expect(plot(true)).not.toBe(plot(false))
  })
})
