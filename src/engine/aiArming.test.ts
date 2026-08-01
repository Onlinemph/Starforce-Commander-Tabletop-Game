import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { armingPlan } from './ai'
import { armingPointsAvailable } from './engineering'
import { applyAction } from './actions'
import { mountIsReady } from './shipState'

/**
 * Scarce arming points must be concentrated, not spread: a mount fires only
 * when fully armed, so round-robin distribution can leave every battery
 * half-charged and the ship silent.
 */

describe('arming concentration', () => {
  it('four points on three two-circle mounts readies two mounts, not one', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const phaser = blue.form.weapons.find((w) => w.weaponClass === 'phaser')!
    expect(phaser.mounts).toHaveLength(3)
    expect(phaser.mounts.every((m) => m.armingCircles === 2)).toBe(true)

    // One circle on the PHASER line generates 4 arming points — scarce:
    // the six circles across three mounts cannot all fill.
    const line = blue.form.functions.find(
      (l) => l.kind === 'weapon' && l.weaponSystemId === phaser.id,
    )!
    blue.allocation[line.id] = 1
    expect(armingPointsAvailable(blue, phaser.id)).toBe(4)

    const plan = armingPlan(blue, phaser)
    expect(plan).toHaveLength(4)
    for (const action of plan) applyAction(game, action)

    const ready = phaser.mounts.filter((_, i) =>
      mountIsReady(phaser, i, blue.mounts[phaser.id][i]),
    )
    expect(ready, 'concentrated points ready two full mounts').toHaveLength(2)
  })

  it('finishes a nearly-armed mount before starting a fresh one', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const phaser = blue.form.weapons.find((w) => w.weaponClass === 'phaser')!
    const line = blue.form.functions.find(
      (l) => l.kind === 'weapon' && l.weaponSystemId === phaser.id,
    )!
    // The line's free point only, with mount 2 already half-armed from a
    // prior round.
    void line
    blue.mounts[phaser.id][2].armed = 1
    expect(armingPointsAvailable(blue, phaser.id)).toBe(1)

    const plan = armingPlan(blue, phaser)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ type: 'arm-mount', mountIndex: 2 })
    for (const action of plan) applyAction(game, action)
    expect(mountIsReady(phaser, 2, blue.mounts[phaser.id][2])).toBe(true)
  })

  it('spends nothing when no points are generated', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const phaser = blue.form.weapons.find((w) => w.weaponClass === 'phaser')!
    // The free point is already spent this round; nothing remains.
    blue.mounts[phaser.id][0].armedThisRound = 1
    expect(armingPointsAvailable(blue, phaser.id)).toBe(0)
    expect(armingPlan(blue, phaser)).toHaveLength(0)
    void game
  })
})
