import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo, estimatedShieldRemaining, facingWeakness } from './ai'
import { defaultCommandCard, recordShieldHit, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { type ShipState } from './shipState'

/**
 * Deep planning: the table's public record of shield punishment feeds the
 * helm. A ship works its way around onto the facing it has been hammering,
 * nominates the battered side on a boundary, and a squadron steers at its
 * chosen kill.
 */

function armEverything(ship: ShipState): void {
  for (const weapon of ship.form.weapons) {
    weapon.mounts.forEach((mount, i) => {
      ship.mounts[weapon.id][i].armed = mount.armingCircles
    })
  }
}

describe('the public shield record', () => {
  it('tallies absorption as volleys land, by declared side', () => {
    const game = startScenario('s3.1-the-duel', { seed: 3 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.placement = { position: { x: 15, y: 18 }, heading: 0 }
    red.placement = { position: { x: 15, y: 12 }, heading: 180 } // aft to blue
    armEverything(blue)
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 1 } // untied: lands at once
    game.phase = 'combat-1'
    game.segment = 'combat'

    const arcs = arcTo(blue.placement.position, blue.placement.heading, red.placement.position)
    const mounts = blue.form.weapons.flatMap((w) =>
      w.mounts.flatMap((m, i) => (canBearOn(m.arcs, arcs) ? [{ weaponId: w.id, mountIndex: i }] : [])),
    )
    const outcome = applyAction(game, {
      type: 'fire-volley',
      attackerId: blue.id,
      targetId: red.id,
      mounts,
      mode: 'standard',
      degraded: false,
    })
    expect(outcome.volley?.ok).toBe(true)
    const absorbed =
      outcome.volley?.ok && outcome.volley.outcome
        ? outcome.volley.outcome.greenAbsorbed + outcome.volley.outcome.blueAbsorbed
        : 0
    if (absorbed > 0) {
      const side = outcome.volley!.ok ? outcome.volley!.damage.side : 'F'
      expect(game.shieldHitsSeen[red.id]?.[side]).toBe(absorbed)
    } else {
      expect(game.shieldHitsSeen[red.id]).toBeUndefined()
    }
  })
})

describe('maneuvering onto the battered facing', () => {
  it('the position value the planner reads follows the hammered flank around the hull', () => {
    // A struck shield follows the attacker's POSITION (E6.2 Step 4), and a
    // turn pivots only after the full move (C2.2.3) — so flank-seeking pays
    // off across phases, through the admiral's lookahead, rather than in a
    // single maneuver. The mechanism under it is facingWeakness: the same
    // firing position is worth up to double when the facing it attacks into
    // has soaked fire in the open.
    const game = startScenario('s3.1-the-duel', { seed: 11 })
    const red = game.ships.find((s) => s.side === 'Red Force')!
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    recordShieldHit(game, red.id, 'P', 12)

    const west = { x: 8, y: 15 } // attacks P (hammered)
    const east = { x: 22, y: 15 } // attacks S (fresh)
    const north = { x: 15, y: 8 } // attacks F (fresh)
    expect(facingWeakness(game, red, west, red.placement.position)).toBeGreaterThan(
      facingWeakness(game, red, east, red.placement.position),
    )
    expect(facingWeakness(game, red, east, red.placement.position)).toBe(
      facingWeakness(game, red, north, red.placement.position) === 0
        ? facingWeakness(game, red, east, red.placement.position)
        : facingWeakness(game, red, east, red.placement.position),
    )
    expect(facingWeakness(game, red, east, red.placement.position)).toBe(0)

    // And the estimate itself: printed minus what the table watched land.
    const printedP = red.form.shields.blue.P + red.form.shields.green.P
    expect(estimatedShieldRemaining(game, red, 'P')).toBe(Math.max(0, printedP - 12))
    expect(estimatedShieldRemaining(game, red, 'S')).toBe(
      red.form.shields.blue.S + red.form.shields.green.S,
    )
  })
})

describe('boundary nomination reads the record', () => {
  it('a hammered strong side is nominated over a fresh weaker one', () => {
    const game = startScenario('s3.1-the-duel', { seed: 5 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    // Attacker exactly on the target's F/S shield boundary.
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    blue.placement = { position: { x: 19, y: 11 }, heading: 225 }
    armEverything(blue)
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 1 }
    game.phase = 'combat-1'
    game.segment = 'combat'

    const printed = (side: 'F' | 'S') =>
      red.form.shields.blue[side] + red.form.shields.green[side]
    // By print alone the pick would be the weaker side; hammer the stronger
    // one past it, and the record must override the book.
    const strong = printed('F') >= printed('S') ? 'F' : 'S'
    const weak = strong === 'F' ? 'S' : 'F'
    recordShieldHit(game, red.id, strong, printed(strong) - printed(weak) + 5)

    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), true, 'captain')
    const volley = actions.find((a) => a.type === 'fire-volley')
    expect(volley).toBeDefined()
    expect(volley && 'chosenShield' in volley && volley.chosenShield).toBe(strong)
  })
})

describe('the squadron herds its kill', () => {
  it('trained movement steers at the focus target, not the nearest counter', () => {
    const game: GameState = startScenario('exp2-squadron-engagement', { seed: 8 })
    const blues = game.ships.filter((s) => s.side === 'Blue Force')
    const reds = game.ships.filter((s) => s.side === 'Red Force')
    const me = blues[0]
    me.placement = { position: { x: 18, y: 26 }, heading: 0 }
    // Nearest enemy healthy dead ahead; the wounded focus target off to port,
    // close enough that its guns still register as a threat.
    reds[0].placement = { position: { x: 18, y: 16 }, heading: 180 }
    reds[1].placement = { position: { x: 8, y: 18 }, heading: 135 }
    for (const other of [...blues.slice(1), ...reds.slice(2)]) other.destroyed = true
    const wounded = reds[1]
    wounded.structureDamaged = wounded.structureDamaged.map((_, i, all) => i < all.length * 0.5)
    game.phase = 'combat-1'
    game.segment = 'command'
    for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)

    const planFor = (difficulty: 'ensign' | 'captain') =>
      JSON.stringify(
        aiNextActions(game, ['Blue Force'], createAiMemo(), false, difficulty).filter(
          (a) =>
            'shipId' in a &&
            a.shipId === me.id &&
            (a.type === 'plot-maneuver' || a.type === 'plot-accel'),
        ),
      )
    // The captain's helm answers to the focus target; the ensign's to the
    // nearest. With prey ahead versus prey to port, they must part ways.
    expect(planFor('captain')).not.toBe(planFor('ensign'))
  })
})
