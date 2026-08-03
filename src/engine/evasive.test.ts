import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { resolveVolley } from './combat'
import { damageContext, defaultCommandCard, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { isHoming } from './homing'
import { executeMovement } from './navigation'
import { type ShipState } from './shipState'

/**
 * Evasive maneuvers (C3.6, optional): acceleration spent weaving instead of
 * on speed. It cuts both ways — the weaving ship rerolls dice from every
 * incoming volley, and hands the same number of rerolls to anything it
 * shoots at.
 */

function duel(seed = 4): { game: GameState; blue: ShipState; red: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed, armedStart: true })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  blue.placement = { position: { x: 15, y: 15 }, heading: 0 }
  red.placement = { position: { x: 15, y: 12 }, heading: 0 }
  for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
  // Power the drive, as a Resource Allocation Segment would: evasive spends
  // from that same pool (C3.6.2).
  for (const ship of [blue, red]) {
    const accel = ship.form.functions.find((l) => l.kind === 'accel')
    if (accel) ship.allocation[accel.id] = accel.steps.length
  }
  return { game, blue, red }
}

function firingMounts(attacker: ShipState, target: ShipState) {
  const arcs = arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position)
  return attacker.form.weapons.flatMap((w) =>
    isHoming(w)
      ? []
      : w.mounts.flatMap((m, i) => (canBearOn(m.arcs, arcs) ? [{ weaponId: w.id, mountIndex: i }] : [])),
  )
}

describe('plotting evasive maneuvers', () => {
  it('takes effect when the card is revealed, and spends the round’s acceleration', () => {
    const { game, blue } = duel()
    applyAction(game, { type: 'plot-evasive', shipId: blue.id, points: 2 })
    expect(game.orders[blue.id].evasive).toBe(2)
    // Nothing happens until the plot is revealed with the move (C3.6.4).
    expect(blue.evasive).toBe(0)
    executeMovement(blue, game.orders[blue.id])
    expect(blue.evasive).toBe(2)
    expect(blue.accelUsedThisRound).toBe(2)
  })

  it('is capped by what the drive was powered for this round', () => {
    const { game, blue } = duel()
    applyAction(game, { type: 'plot-evasive', shipId: blue.id, points: 99 })
    const card = game.orders[blue.id]
    executeMovement(blue, card)
    expect(blue.evasive).toBeLessThanOrEqual(blue.accelUsedThisRound)
    expect(blue.accelUsedThisRound).toBeGreaterThan(0)
  })

  it('holding the same depth is free; stopping and restarting is not (C3.6.4)', () => {
    const { game, blue } = duel()
    applyAction(game, { type: 'plot-evasive', shipId: blue.id, points: 1 })
    executeMovement(blue, game.orders[blue.id])
    const afterStart = blue.accelUsedThisRound
    // Same depth next phase: no further points.
    executeMovement(blue, { ...defaultCommandCard(blue), evasive: 1 })
    expect(blue.accelUsedThisRound).toBe(afterStart)
    // Stop, then start again: the old points are gone, new ones are spent.
    executeMovement(blue, { ...defaultCommandCard(blue), evasive: 0 })
    expect(blue.evasive).toBe(0)
    executeMovement(blue, { ...defaultCommandCard(blue), evasive: 1 })
    expect(blue.accelUsedThisRound).toBeGreaterThan(afterStart)
  })
})

describe('what evasive maneuvers buy, and cost', () => {
  /** Mean damage over many volleys, with the two ships set up as given. */
  function meanDamage(setup: (blue: ShipState, red: ShipState) => void, trials = 80): number {
    let total = 0
    for (let seed = 1; seed <= trials; seed++) {
      const { game, blue, red } = duel(seed)
      setup(blue, red)
      const result = resolveVolley(
        {
          attacker: blue,
          target: red,
          mounts: firingMounts(blue, red),
          mode: 'standard',
          defenderEvasiveRerolls: red.evasive + blue.evasive,
        },
        damageContext(game),
        game.rng,
      )
      total += result.ok ? result.damage.standard : 0
    }
    return total / trials
  }

  it('a weaving target takes less', () => {
    const steady = meanDamage(() => {})
    const weaving = meanDamage((_, red) => {
      red.evasive = 3
    })
    expect(weaving).toBeLessThan(steady)
  })

  it('a weaving attacker hits for less — the rule cuts both ways (C3.6.1)', () => {
    const steady = meanDamage(() => {})
    const weaving = meanDamage((blue) => {
      blue.evasive = 3
    })
    expect(weaving).toBeLessThan(steady)
  })

  it('proximity fire denies them, as it denies a red bracket’s (E3.3.4)', () => {
    // The same seed twice, weaving and steady: under proximity fire the two
    // must land identically, because the defender gets no rerolls at all.
    const fire = (evasive: number) => {
      const { game, blue, red } = duel(7)
      red.evasive = evasive
      const result = resolveVolley(
        {
          attacker: blue,
          target: red,
          mounts: firingMounts(blue, red),
          mode: 'proximity',
          defenderEvasiveRerolls: red.evasive,
        },
        damageContext(game),
        game.rng,
      )
      return result.ok ? result.damage.standard : -1
    }
    expect(fire(4)).toBe(fire(0))
  })
})
