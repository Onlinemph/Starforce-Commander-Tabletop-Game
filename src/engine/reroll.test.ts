import { describe, expect, it } from 'vitest'
import { allShipForms } from '../data/ships'
import { DIE_FACES, FACE_DAMAGE, expectedValue, faceValue } from './dice'
import { isHoming } from './homing'
import { startScenario } from '../data/scenarios'
import { resolveVolley } from './combat'
import { damageContext } from './game'
import { arcTo, canBearOn } from './geometry'
import type { DieFace } from './types'

/**
 * When to take a reroll is an expected-value question, and the engine answers
 * it with the simplest rule available: reroll a face worth less than a fresh
 * roll of the same die (attacker), or more than one (defender). These tests
 * pin down why that simple rule is the right one.
 */

describe('the reroll threshold', () => {
  it('is the mean of the die, so a reroll is only taken when it gains', () => {
    // A green die: L L L M H miss → (2+2+2+3+4+0)/6.
    const mean = expectedValue('green', 0, 0)
    expect(mean).toBeCloseTo(13 / 6, 6)
    // The attacker keeps anything at or above it, rerolls anything below.
    expect(faceValue('M', 0, 0)).toBeGreaterThan(mean) // 3 — keep
    expect(faceValue('L', 0, 0)).toBeLessThan(mean) // 2 — reroll
    expect(faceValue('-', 0, 0)).toBeLessThan(mean) // miss — always reroll
  })

  it('follows the weapon: a fat Special pulls the threshold above a Medium', () => {
    // Red carries S on half its faces (E7.2.5), so a big SPCL raises the bar
    // enough that even a Medium hit is worth rerolling away.
    const fat = expectedValue('red', 6, 0)
    expect(faceValue('M', 6, 0)).toBeLessThan(fat)
    // With a small SPCL the same Medium is worth keeping.
    const lean = expectedValue('red', 2, 0)
    expect(faceValue('M', 2, 0)).toBeGreaterThan(lean)
  })
})

/**
 * The threshold reads standard damage only, while an `H` also generates a
 * point of leak (E7.2.6) and an `S` can carry LEAK+X and STR+X. Valuing those
 * would be more faithful — and across every direct-fire weapon in the roster
 * it changes not one decision, because it lifts a face and the mean it is
 * measured against together. The simple rule stays because it is provably the
 * same rule here, not because the difference was never checked.
 */
describe('leak and structure do not change the answer', () => {
  const leakAware = (
    face: DieFace,
    spcl: { damage?: number; leak?: number; structure?: number } | undefined,
    bonus: number,
  ): number => {
    if (face === '-') return 0
    if (face === 'S') {
      return (spcl?.damage ?? 0) + bonus + (spcl?.leak ?? 0) + (spcl?.structure ?? 0) * 0.5
    }
    return FACE_DAMAGE[face] + bonus + (face === 'H' ? 1 : 0)
  }

  it('agrees with the shipped threshold for every direct-fire weapon', () => {
    let checked = 0
    for (const form of allShipForms()) {
      for (const weapon of form.weapons) {
        // Homing weapons resolve on their own path (E5.4) and never take
        // bracket rerolls, so their faces are not this rule's business.
        if (isHoming(weapon)) continue
        for (const bracket of weapon.brackets) {
          const bonus = bracket.bonus ?? 0
          for (const color of new Set(bracket.dice)) {
            const spcl = weapon.special
            const awareMean =
              DIE_FACES[color].reduce((s, f) => s + leakAware(f, spcl, bonus), 0) /
              DIE_FACES[color].length
            for (const face of new Set(DIE_FACES[color])) {
              checked += 1
              const shippedKeeps =
                faceValue(face, spcl?.damage ?? 0, bonus) >=
                expectedValue(color, spcl?.damage ?? 0, bonus)
              const awareKeeps = leakAware(face, spcl, bonus) >= awareMean
              expect(
                awareKeeps,
                `${weapon.name} ${color} ${face}: leak-aware valuation disagrees`,
              ).toBe(shippedKeeps)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
})

/**
 * Cover rerolls are a budget, and the rulebook lets the defender spend it
 * however it likes — five on one die, one on five dice, or anything between
 * (E6.2 Step 9, K2.1.8). So the allocation is a real decision, and the engine
 * makes it adaptively across the whole volley.
 */
describe('spending a cover reroll budget', () => {
  function volley(coverRerolls: number, seed: number) {
    const game = startScenario('s3.1-the-duel', { seed, armedStart: true })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.placement = { position: { x: 15, y: 15 }, heading: 0 }
    red.placement = { position: { x: 15, y: 12 }, heading: 0 }
    const arcs = arcTo(blue.placement.position, blue.placement.heading, red.placement.position)
    const mounts = blue.form.weapons.flatMap((w) =>
      isHoming(w)
        ? []
        : w.mounts.flatMap((m, i) => (canBearOn(m.arcs, arcs) ? [{ weaponId: w.id, mountIndex: i }] : [])),
    )
    const result = resolveVolley(
      { attacker: blue, target: red, mounts, mode: 'standard', defenderCoverRerolls: coverRerolls },
      damageContext(game),
      game.rng,
    )
    return result.ok ? result.damage.standard : 0
  }

  it('more cover keeps taking damage off, rather than running out of list', () => {
    // The old fixed one-pass-per-record ordering stalled once every die in
    // its sorted list had been touched once, stranding the rest of a large
    // budget. Spending adaptively, more cover keeps paying.
    const trials = 60
    const mean = (cover: number) => {
      let total = 0
      for (let seed = 1; seed <= trials; seed++) total += volley(cover, seed)
      return total / trials
    }
    const none = mean(0)
    const some = mean(2)
    const lots = mean(6)
    expect(some).toBeLessThan(none)
    expect(lots).toBeLessThan(some)
  })
})
