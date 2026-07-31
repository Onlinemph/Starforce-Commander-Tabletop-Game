import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { armingCapacityThisRound, lineValue, type ShipState } from './shipState'

/**
 * Auto-arming (E4.2.2): distributing arming points is a decision only while
 * they are scarce. Once an allocation covers every circle a weapon may
 * legally fill this segment, the game fills them.
 */

function totalCapacity(ship: ShipState, weaponId: string): number {
  const weapon = ship.form.weapons.find((w) => w.id === weaponId)!
  return weapon.mounts.reduce(
    (sum, _, i) => sum + armingCapacityThisRound(weapon, i, ship.mounts[weaponId][i]),
    0,
  )
}

function armedCircles(ship: ShipState, weaponId: string): number {
  return ship.mounts[weaponId].reduce((sum, m) => sum + m.armed, 0)
}

describe('auto-arm on allocation', () => {
  it('fills every legally fillable circle when the points cover them all', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    for (const ship of game.ships) {
      for (const line of ship.form.functions) {
        if (line.kind !== 'weapon' || !line.weaponSystemId) continue
        const weaponId = line.weaponSystemId
        const capacity = totalCapacity(ship, weaponId)

        applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: line.steps.length })
        const generated = lineValue(ship, line.id)

        if (generated >= capacity) {
          // No choice existed: everything fillable must now be filled, and the
          // log must say so.
          expect(totalCapacity(ship, weaponId)).toBe(0)
          expect(armedCircles(ship, weaponId)).toBeGreaterThan(0)
          expect(game.log.some((l) => l.message.includes('armed in full'))).toBe(true)
          // Slow-arming gates are still respected: nothing armed past them.
          const weapon = ship.form.weapons.find((w) => w.id === weaponId)!
          for (const [i, mount] of weapon.mounts.entries()) {
            const gate = mount.roundGates?.findIndex(Boolean) ?? -1
            if (gate >= 0) expect(ship.mounts[weaponId][i].armed).toBeLessThanOrEqual(gate + 1)
          }
        } else {
          // Scarce points stay the player's decision.
          expect(armedCircles(ship, weaponId)).toBe(0)
        }
      }
    }
  })

  it('leaves a scarce allocation for the player to distribute', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2 })
    const ship = game.ships[0]
    const line = ship.form.functions.find((l) => l.kind === 'weapon' && l.weaponSystemId)!
    const weaponId = line.weaponSystemId!
    const capacity = totalCapacity(ship, weaponId)

    // One circle at a time until just before the points cover everything.
    for (let circles = 1; circles <= line.steps.length; circles++) {
      const before = armedCircles(ship, weaponId)
      applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles })
      if (lineValue(ship, line.id) < capacity) {
        expect(armedCircles(ship, weaponId)).toBe(before)
      }
    }
  })

  it('journals identically: the auto-arm replays inside the allocate action', () => {
    const a = startScenario('s3.1-the-duel', { seed: 3 })
    const b = startScenario('s3.1-the-duel', { seed: 3 })
    const ship = a.ships[0]
    const line = ship.form.functions.find((l) => l.kind === 'weapon' && l.weaponSystemId)!
    const action = { type: 'allocate', shipId: ship.id, lineId: line.id, circles: line.steps.length } as const
    applyAction(a, action)
    applyAction(b, action)
    expect(JSON.stringify(a.ships[0].mounts)).toBe(JSON.stringify(b.ships[0].mounts))
  })
})
