import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { predictEnemyPlot } from './ai'
import { relativeBearing } from './geometry'
import { type GameState } from './game'
import { type MountState, type ShipState } from './shipState'

/**
 * Opponent modeling: the admiral plays the enemy's turn before its own.
 * Plotting is simultaneous, so the prediction is the plot the enemy's seat
 * would choose off the current board — book turn tables and public state
 * only, never their hidden allocation.
 */

function duel(seed = 13): { game: GameState; blue: ShipState; red: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  return { game, blue, red }
}

function offBow(position: { x: number; y: number }, heading: number, target: { x: number; y: number }): number {
  const bearing = relativeBearing(position, heading, target)
  return Math.min(bearing, 360 - bearing)
}

describe('predictEnemyPlot', () => {
  it('predicts the enemy coming about, not sailing on', () => {
    const { game, blue, red } = duel()
    // Red mid-board, flying away from blue at speed 3.
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    red.speed = 3
    blue.placement = { position: { x: 15, y: 26 }, heading: 0 } // dead astern of red

    const plan = predictEnemyPlot(game, red, blue)
    const current = offBow(red.placement.position, red.placement.heading, blue.placement.position)
    const predicted = offBow(plan.position, plan.heading, blue.placement.position)
    expect(predicted, 'the modeled enemy turns its bow toward the viewer').toBeLessThan(current)
  })

  it('never predicts a plot off the board', () => {
    const { game, blue, red } = duel()
    // Red racing at the north edge, two inches out.
    red.placement = { position: { x: 15, y: 2.5 }, heading: 0 }
    red.speed = 4
    blue.placement = { position: { x: 15, y: 20 }, heading: 0 }

    const plan = predictEnemyPlot(game, red, blue)
    const { width, height } = game.scenario.bounds
    expect(plan.position.x).toBeGreaterThanOrEqual(0)
    expect(plan.position.y).toBeGreaterThanOrEqual(0)
    expect(plan.position.x).toBeLessThanOrEqual(width)
    expect(plan.position.y).toBeLessThanOrEqual(height)
  })

  it('is pure book and public state: identical for identical boards', () => {
    const a = duel(21)
    const b = duel(21)
    for (const s of [a, b]) {
      s.red.placement = { position: { x: 10, y: 18 }, heading: 90 }
      s.red.speed = 2
      s.blue.placement = { position: { x: 22, y: 12 }, heading: 270 }
    }
    // Hidden state differs wildly; the prediction must not notice.
    a.red.allocation = {}
    for (const weapon of b.red.form.weapons) {
      b.red.mounts[weapon.id].forEach((m: MountState) => {
        m.armed = 99
      })
    }
    expect(predictEnemyPlot(a.game, a.red, a.blue)).toEqual(predictEnemyPlot(b.game, b.red, b.blue))
  })

  it('chains: a second prediction continues from the first', () => {
    const { game, blue, red } = duel()
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    red.speed = 3
    blue.placement = { position: { x: 15, y: 26 }, heading: 0 }
    const first = predictEnemyPlot(game, red, blue)
    const second = predictEnemyPlot(game, red, blue, first, first.speed)
    // Two modeled phases bring the bow further around than one.
    expect(offBow(second.position, second.heading, blue.placement.position)).toBeLessThanOrEqual(
      offBow(first.position, first.heading, blue.placement.position),
    )
  })
})
