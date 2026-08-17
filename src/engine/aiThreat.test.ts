import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo, estimatedVolleyDamage } from './ai'
import { defaultCommandCard, type GameState } from './game'
import { damageLevel } from './shipState'
import { woundToFraction } from './testWounds'

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

  it('danger, not distance: reinforcement follows the heavier battery', () => {
    // Two enemies equidistant and bow-on, one a command cruiser and one a
    // scout. Book knowledge says which side the real fire will come from —
    // the threat axis must lean toward the heavier charts, not split evenly.
    const game = startScenario('exp2-squadron-engagement', { seed: 4 })
    const blues = game.ships.filter((s) => s.side === 'Blue Force')
    const reds = [...game.ships.filter((s) => s.side === 'Red Force')].sort(
      (a, b) => b.form.pointValue - a.form.pointValue,
    )
    const me = blues[0]
    const heavy = reds[0]
    const light = reds[reds.length - 1]
    expect(heavy.form.pointValue).toBeGreaterThan(light.form.pointValue)
    me.placement = { position: { x: 18, y: 18 }, heading: 0 }
    heavy.placement = { position: { x: 8, y: 18 }, heading: 90 } // port, bow-on
    light.placement = { position: { x: 28, y: 18 }, heading: 270 } // starboard, bow-on
    for (const other of [...blues.slice(1), ...reds.slice(1, -1)]) other.destroyed = true
    // Free the budget to show the shield doctrine plainly.
    for (const weapon of me.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        me.mounts[weapon.id][i].damage = mount.hitBoxes
      })
    }
    const port = me.form.functions.find((l) => l.kind === 'shield-reinforce' && l.shieldSide === 'P')!
    const starboard = me.form.functions.find(
      (l) => l.kind === 'shield-reinforce' && l.shieldSide === 'S',
    )!
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    expect(
      actions.find((a) => a.type === 'allocate' && a.lineId === port.id),
      'the heavy cruiser holds the port side — reinforce it',
    ).toBeDefined()
    expect(actions.find((a) => a.type === 'allocate' && a.lineId === starboard.id)).toBeUndefined()
  })

  it('the estimate reads the book: range brackets, jamming, and the damage marker', () => {
    const game = startScenario('s3.1-the-duel', { seed: 9 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    red.placement = { position: { x: 15, y: 10 }, heading: 180 }

    const at = (range: number, jamming = 0) =>
      estimatedVolleyDamage(red, { x: 15, y: 10 + range }, jamming)

    // Closer is deadlier, and beyond every chart the estimate is zero.
    expect(at(3)).toBeGreaterThan(at(12))
    expect(at(40)).toBe(0)
    // Jamming pushes the enemy into worse brackets — or off the chart.
    expect(at(12, 4)).toBeLessThanOrEqual(at(12, 0))
    expect(at(12, 40)).toBe(0)

    // The public damage marker scales the estimate down as the enemy breaks.
    // The estimate itself reads only the book (the printed weapon charts), so
    // the wounds' marks on the actual mounts do not touch it — only the
    // marker does.
    const healthy = at(6)
    woundToFraction(red, 0.95)
    expect(damageLevel(red)).toBe('crippled')
    expect(at(6)).toBeLessThan(healthy)
    expect(at(6)).toBeGreaterThan(0)
    void blue
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
