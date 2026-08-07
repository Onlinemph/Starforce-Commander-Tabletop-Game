import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { selectBracket } from './combat'
import { activeShips, terrainObstacles } from './game'
import { actualRange, arcTo, canBearOn, effectiveRange, hasLineOfSight } from './geometry'
import { isHoming } from './homing'
import { mountIsReady, type ShipState } from './shipState'

/**
 * Fire discipline should hold the long shot, not the ship.
 *
 * An all-red volley hands the defender rerolls and costs next round's arming
 * points, so a trained captain waits for a better bracket. But the gate that
 * does the waiting ran *after* the target was chosen, and targets are chosen
 * by counting dice with no regard to what colour they are — so the captain
 * could reject its highest-scoring target for being a long shot and then stand
 * down entirely, with a hull sitting in a green bracket somewhere else on the
 * board. It now falls back to that hull instead.
 *
 * This is measured rather than staged. Two attempts to build a fixture for it
 * both passed against the unfixed code, which is the tell that the bug lives
 * in the interaction of target scoring, range bands and the board rather than
 * in any position that can be written down — so the test counts the thing that
 * was actually wrong, across whole battles, on fixed seeds. It is exact, not
 * statistical: the same seeds always produce the same count.
 *
 * Before the fallback: 33 live firing solutions passed up across these 16
 * battles, and 56 across 32. After: 25 and 47. The squadron season moved
 * 135W-57L → 142W-50L. Note what is *not* claimed — the remaining passes are
 * still unexplained, roughly one and a half a battle, and this fixed one cause
 * of them rather than the class.
 */

/** Does this ship have a bearing, ready mount in a bracket better than red? */
function hasLiveSolution(game: ReturnType<typeof startScenario>, ship: ShipState): boolean {
  const obstacles = terrainObstacles(game.scenario.terrain)
  for (const enemy of activeShips(game)) {
    if (enemy.side === ship.side) continue
    if (!hasLineOfSight(ship.placement.position, enemy.placement.position, obstacles)) continue
    const arcs = arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position)
    const effective = effectiveRange(
      actualRange(ship.placement.position, enemy.placement.position),
      enemy.sensors.jamming,
      ship.sensors.targeting,
    )
    for (const weapon of ship.form.weapons) {
      if (isHoming(weapon)) continue
      for (const [index, mount] of weapon.mounts.entries()) {
        if (!mountIsReady(weapon, index, ship.mounts[weapon.id][index])) continue
        if (!canBearOn(mount.arcs, arcs)) continue
        const found = selectBracket(weapon, effective, enemy.speed === 0)
        if (found && found.bracket.band !== 'red') return true
      }
    }
  }
  return false
}

function countHeldShots(scenario: string, seeds: number[]): number {
  let held = 0
  for (const seed of seeds) {
    const game = startScenario(scenario, { seed, mapScale: 2 })
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const memos = sides.map(() => createAiMemo())
    const drive = (closing: boolean) => {
      for (const [index, side] of sides.entries()) {
        for (let guard = 0; guard < 300; guard++) {
          const batch = aiNextActions(game, [side], memos[index], closing, 'admiral')
          if (batch.length === 0) break
          for (const action of batch) {
            if (action.type === 'pass-fire') {
              const ship = game.ships.find((s) => s.id === action.shipId)
              if (ship && hasLiveSolution(game, ship)) held += 1
            }
            applyAction(game, action as GameAction)
          }
          if (guard === 299) throw new Error(`${side} never settled in ${game.segment}`)
        }
      }
    }
    drive(false)
    for (let step = 0; step < 400; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 12) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
  }
  return held
}

describe('a captain that has rejected the long shot', () => {
  it('does not also throw away the good one', () => {
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1)
    const held =
      countHeldShots('s3.1-the-duel', seeds) + countHeldShots('exp2-squadron-engagement', seeds)
    // 33 before the fallback, 25 after, on exactly these seeds. The ceiling
    // sits between the two, so this fails on the old behaviour rather than
    // merely describing the new one.
    expect(held, 'live firing solutions passed up across 16 battles').toBeLessThan(30)
  })
})
