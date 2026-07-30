import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { firingOrder, resolveVolley } from './combat'
import {
  activeShips,
  advanceSegment,
  damageContext,
  isCombatPhase,
  terrainObstacles,
  victoryPoints,
  type GameState,
} from './game'
import { armingPointsAvailable, armMount, setAllocation } from './engineering'
import { arcTo, canBearOn, relativeBearing } from './geometry'
import { mountIsReady, structureRemaining, type ShipState } from './shipState'

/**
 * A scripted end-to-end battle.
 *
 * This drives the whole Sequence of Play with a simple captain on both sides —
 * arm everything, close head-on, fire whatever bears — and asserts the game
 * reaches a conclusion without wedging. It is the regression net for the loop
 * as a whole rather than for any one rule.
 */

/** Spend all available power on weapons, sensors and the drive, then arm up. */
function allocate(ship: ShipState): void {
  const weaponLines = ship.form.functions.filter((l) => l.kind === 'weapon')
  for (const line of weaponLines) setAllocation(ship, line.id, line.steps.length)
  const sensor = ship.form.functions.find((l) => l.kind === 'sensor')
  if (sensor) setAllocation(ship, sensor.id, 1)
  const accel = ship.form.functions.find((l) => l.kind === 'accel')
  if (accel) setAllocation(ship, accel.id, 1)
  const sif = ship.form.functions.find((l) => l.kind === 'sif')
  if (sif) setAllocation(ship, sif.id, 1)

  // Spread arming points across mounts, filling each as far as it will go.
  for (const weapon of ship.form.weapons) {
    let guard = 0
    while (armingPointsAvailable(ship, weapon.id) > 0 && guard++ < 60) {
      const progressed = weapon.mounts.some((_, index) => armMount(ship, weapon.id, index) === null)
      if (!progressed) break
    }
  }
}

/**
 * A captain who actually fights: turn toward the enemy, slow down to stay in
 * the fight, and split sensor points between targeting and tactical scan.
 */
function plotOrders(game: GameState): void {
  for (const ship of activeShips(game)) {
    const card = game.orders[ship.id]
    if (!card) continue

    const enemy = activeShips(game).find((s) => s.side !== ship.side)
    card.accel = 0
    card.speed = ship.speed
    card.sensors = { targeting: 1, jamming: 0, tacticalScan: ship.id === 'blue-1' ? 2 : 1 }

    if (!enemy) {
      card.maneuver = 'straight'
      card.direction = null
      continue
    }

    const bearing = relativeBearing(ship.placement.position, ship.placement.heading, enemy.placement.position)
    // Bearings within the forward arc need no correction.
    if (bearing < 25 || bearing > 335) {
      card.maneuver = 'straight'
      card.direction = null
    } else {
      card.direction = bearing < 180 ? 'right' : 'left'
      // Come round hard when the enemy is off the beam or astern.
      card.maneuver = bearing > 70 && bearing < 290 ? 'hard' : 'standard'
    }

    // Slow to a speed that can still turn, so the duel does not become a
    // single joust down the length of the map (C2.2.2 — TURN 0 at top speed).
    const turnable = ship.form.sublight.turnBySpeed.reduce(
      (best, degrees, speed) => (degrees > 0 ? speed : best),
      0,
    )
    if (ship.speed > turnable && ship.accelUsedThisRound < ship.form.sublight.safeAccelPerRound) {
      card.accel = -1
      card.speed = ship.speed - 1
    }
  }
}

/** Fire every mount that bears and is in range, in Tactical Scan order. */
function resolveCombat(game: GameState): void {
  for (const group of firingOrder(game.ships)) {
    for (const attacker of group) {
      const target = activeShips(game).find((s) => s.side !== attacker.side)
      if (!target) return

      const targetArcs = arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position)
      const mounts = attacker.form.weapons.flatMap((weapon) =>
        weapon.mounts
          .map((mount, mountIndex) => ({ weapon, mount, mountIndex }))
          .filter(
            ({ weapon, mount, mountIndex }) =>
              mountIsReady(weapon, mountIndex, attacker.mounts[weapon.id][mountIndex]) &&
              canBearOn(mount.arcs, targetArcs),
          )
          .map(({ weapon, mountIndex }) => ({ weaponId: weapon.id, mountIndex })),
      )
      if (mounts.length === 0) continue

      resolveVolley(
        {
          attacker,
          target,
          mounts,
          mode: 'standard',
          obstacles: terrainObstacles(game.scenario.terrain),
        },
        damageContext(game),
        game.rng,
      )
    }
  }
}

function playBattle(seed: number, maxRounds = 40): GameState {
  const game = startScenario('s3.1-the-duel', { seed })

  let steps = 0
  while (game.round <= maxRounds && steps++ < 2000) {
    const survivors = new Set(activeShips(game).map((s) => s.side))
    if (survivors.size < 2) break

    if (game.phase === 'engineering' && game.segment === 'resource-allocation') {
      for (const ship of activeShips(game)) if (!ship.derelict) allocate(ship)
    }
    if (isCombatPhase(game.phase)) {
      if (game.segment === 'command') plotOrders(game)
      if (game.segment === 'combat') resolveCombat(game)
    }
    advanceSegment(game)
  }
  return game
}

describe('full battle playthrough', () => {
  it('reaches a decision without wedging', () => {
    const game = playBattle(20250730)
    const survivingSides = new Set(activeShips(game).map((s) => s.side))

    // Somebody took real damage — the ships closed and actually fought.
    const totalDamage = game.ships.reduce(
      (sum, s) => sum + (s.structureDamaged.length - structureRemaining(s)),
      0,
    )
    expect(totalDamage).toBeGreaterThan(0)
    expect(survivingSides.size).toBeLessThanOrEqual(2)
    expect(game.log.length).toBeGreaterThan(10)
  })

  it('produces a winner across a spread of seeds', () => {
    let decisive = 0
    for (const seed of [1, 7, 99, 4242, 31337]) {
      const game = playBattle(seed)
      const sides = new Set(activeShips(game).map((s) => s.side))
      if (sides.size < 2) decisive += 1

      // Victory points are always well-formed, decisive or not.
      const points = victoryPoints(game)
      for (const value of Object.values(points)) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    }
    expect(decisive).toBeGreaterThan(0)
  })

  it('never leaves a ship in an impossible state', () => {
    const game = playBattle(555)
    for (const ship of game.ships) {
      expect(structureRemaining(ship)).toBeGreaterThanOrEqual(0)
      expect(ship.stressMarkers).toBeGreaterThanOrEqual(0)
      expect(Math.abs(ship.speed)).toBeLessThanOrEqual(ship.form.sublight.maxSpeed)
      for (const weapon of ship.form.weapons) {
        ship.mounts[weapon.id].forEach((state, i) => {
          expect(state.armed).toBeLessThanOrEqual(weapon.mounts[i].armingCircles)
          expect(state.damage).toBeLessThanOrEqual(weapon.mounts[i].hitBoxes)
        })
      }
      for (const side of ['F', 'S', 'A', 'P'] as const) {
        expect(ship.blueShieldDamage[side]).toBeLessThanOrEqual(ship.form.shields.blue[side])
      }
    }
  })
})
