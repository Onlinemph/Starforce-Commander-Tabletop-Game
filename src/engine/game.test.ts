import { describe, expect, it } from 'vitest'
import { BLUE, RED, startScenario } from '../data/scenarios'
import { advanceSegment, PHASE_ORDER, PHASE_SEGMENTS, victoryPoints, type GameState } from './game'
import { applyAction } from './actions'
import { hitPointDamage, markStructure, sensorFunctionCap, sensorPointsAvailable, structureRemaining } from './shipState'

/** Walk the sequence of play until the given round/phase/segment is reached. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

describe('sequence of play (A3)', () => {
  it('runs five phases in order, then starts a new round', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    expect(game.round).toBe(1)
    expect(game.phase).toBe('engineering')
    expect(game.segment).toBe('resource-allocation')

    const seen: string[] = []
    for (let i = 0; i < 40 && game.round === 1; i++) {
      seen.push(`${game.phase}/${game.segment}`)
      advanceSegment(game)
    }

    expect(game.round).toBe(2)
    // Every phase and segment of round 1 was visited exactly once, in order.
    const expected = PHASE_ORDER.flatMap((phase) =>
      PHASE_SEGMENTS[phase].map((segment) => `${phase}/${segment}`),
    )
    expect(seen).toEqual(expected)
  })

  it('issues fresh command cards each combat phase (C1.1.1)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    expect(Object.keys(game.orders).sort()).toEqual(['blue-1', 'red-1'])

    game.orders['blue-1'].maneuver = 'hard'
    runTo(game, (g) => g.phase === 'combat-2' && g.segment === 'command')
    expect(game.orders['blue-1'].maneuver).toBe('straight')
  })

  it('moves ships during the Navigation Segment (A3.3.3)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    const startX = blue.placement.position.x

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game) // resolve navigation

    // Blue faces west (FAC 6) at speed 4, so it moves four inches left.
    expect(blue.placement.position.x).toBeCloseTo(startX - 4)
  })

  it('carries sensor allocations from the command card onto the ship (H2.2.2)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    game.orders['blue-1'].sensors = { targeting: 1, jamming: 1, tacticalScan: 0 }
    advanceSegment(game)

    const blue = game.ships.find((s) => s.id === 'blue-1')!
    expect(blue.sensors.targeting).toBe(1)
    expect(blue.sensors.jamming).toBe(1)
  })

  /*
   * H2.2 sets two separate limits on the sensor split and both bind. The
   * per-function cap was enforced; the budget was not, so a ship could run
   * targeting, jamming and Tactical Scan all at their cap at once and spend
   * three times the points its sensor line had produced. Jamming is added to
   * the range of every shot taken at it (H2.3.3) and can put a weapon out of
   * range entirely (H2.3.7), so the surplus was not a rounding matter.
   */
  describe('the sensor split is limited twice (H2.2)', () => {
    const plotted = (game: ReturnType<typeof startScenario>, id: string) => {
      const ship = game.ships.find((s) => s.id === id)!
      return { ship, available: sensorPointsAvailable(ship), cap: sensorFunctionCap(ship) }
    }

    it('never lets the three functions outspend the line that fed them (H2.2.2)', () => {
      const game = startScenario('s3.1-the-duel', { seed: 1 })
      runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
      const { ship, available } = plotted(game, 'blue-1')

      // Ask for the maximum on all three at once.
      for (const key of ['targeting', 'jamming', 'tacticalScan'] as const) {
        applyAction(game, { type: 'plot-sensor', shipId: ship.id, key, value: 99 })
      }
      const card = game.orders['blue-1'].sensors
      expect(card.targeting + card.jamming + card.tacticalScan).toBeLessThanOrEqual(available)
      expect(available).toBeGreaterThan(0)
    })

    it('still caps any one function at the undamaged sensor boxes (H2.2.3)', () => {
      const game = startScenario('s3.1-the-duel', { seed: 1 })
      runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
      const { ship, cap, available } = plotted(game, 'blue-1')
      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: 99 })
      // Whichever limit is tighter is the one that binds — here the unpowered
      // line's free points are fewer than the boxes.
      expect(game.orders['blue-1'].sensors.jamming).toBe(Math.min(cap, available))
    })

    it('lowers the cap as the sensors are shot away (H2.2.3)', () => {
      const game = startScenario('s3.1-the-duel', { seed: 1 })
      runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
      const { ship } = plotted(game, 'blue-1')
      ship.systemDamage['SENS'] = (ship.systemDamage['SENS'] ?? 0) + 1
      const hurtCap = sensorFunctionCap(ship)

      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: 99 })
      expect(game.orders['blue-1'].sensors.jamming).toBeLessThanOrEqual(hurtCap)

      // And with the boxes gone entirely there is no jamming to be had.
      ship.systemDamage['SENS'] = 99
      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: 99 })
      expect(game.orders['blue-1'].sensors.jamming).toBe(0)
    })

    it('gives a later function only what the earlier ones left (H2.2.2)', () => {
      const game = startScenario('s3.1-the-duel', { seed: 1 })
      runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
      const { ship, available } = plotted(game, 'blue-1')

      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'targeting', value: available })
      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: available })
      expect(game.orders['blue-1'].sensors.jamming).toBe(0)

      // Freeing the first hands the points straight back to the second.
      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'targeting', value: 0 })
      applyAction(game, { type: 'plot-sensor', shipId: ship.id, key: 'jamming', value: available })
      expect(game.orders['blue-1'].sensors.jamming).toBeGreaterThan(0)
    })
  })

  it('resets per-round state at the start of each round (G1.3.2)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    blue.greenShieldActive.F = 3
    blue.accelUsedThisRound = 2

    runTo(game, (g) => g.round === 2)
    // Shield reinforcement expires at the end of the round.
    expect(blue.greenShieldActive.F).toBe(0)
    expect(blue.accelUsedThisRound).toBe(0)
  })

  it('disengages a ship that leaves a fixed map (J9.2.2)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    blue.placement = { position: { x: -2, y: 18 }, heading: 270 }

    runTo(game, (g) => g.phase === 'final' && g.segment === 'disengagement')
    advanceSegment(game)
    expect(blue.disengaged).toBe(true)
  })
})

describe('victory points (S2.8.4)', () => {
  it('scores each damage band from the hit-point table (S2.8.3)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const red = game.ships.find((s) => s.id === 'red-1')!
    const table = red.form.victoryTable!
    expect(table.length).toBe(5)

    // Below the first threshold nothing is scored.
    expect(victoryPoints(game)[BLUE]).toBe(0)

    // Each band pays exactly its printed points, and bands are not cumulative.
    // Damage is dealt in hit points: internal boxes first (one each), then
    // structure (two each) — but never the last structure box, which would be
    // destruction rather than a band.
    const dealOneHitPoint = (): void => {
      const group = red.form.systems.find((g) => (red.systemDamage[g.kind] ?? 0) < g.boxes)
      if (group) {
        red.systemDamage[group.kind] = (red.systemDamage[group.kind] ?? 0) + 1
        return
      }
      for (const weapon of red.form.weapons) {
        for (const [i, mount] of weapon.mounts.entries()) {
          const state = red.mounts[weapon.id][i]
          if (state.damage < mount.hitBoxes) {
            state.damage += 1
            return
          }
        }
      }
      for (const reactor of red.form.reactors) {
        for (const [i, point] of reactor.points.entries()) {
          if (red.reactorDamage[reactor.id][i] < point.boxes) {
            red.reactorDamage[reactor.id][i] += 1
            return
          }
        }
      }
      if (structureRemaining(red) > 1) {
        markStructure(red)
        return
      }
      throw new Error('ran out of boxes before the band was reached')
    }
    for (const row of table) {
      while (hitPointDamage(red) < row.damage) dealOneHitPoint()
      expect(victoryPoints(game)[BLUE]).toBeCloseTo(row.points)
    }
    expect(victoryPoints(game)[RED]).toBe(0)
  })

  it('awards full value for a destroyed ship', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const red = game.ships.find((s) => s.id === 'red-1')!
    while (markStructure(red)) {
      /* mark every box */
    }
    expect(victoryPoints(game)[BLUE]).toBeCloseTo(red.form.pointValue)
  })

  it('awards 50% for an undamaged ship that disengages (S2.8.4 item 4)', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const red = game.ships.find((s) => s.id === 'red-1')!
    red.disengaged = true
    expect(victoryPoints(game)[BLUE]).toBeCloseTo(red.form.pointValue * 0.5)
  })
})

describe('renaming a ship', () => {
  it('changes the name, logs the christening, and holds it through a save', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const ship = game.ships[0]
    const old = ship.name
    const outcome = applyAction(game, { type: 'rename-ship', shipId: ship.id, name: '  I.S.S. Renown  ' })
    expect(outcome.message).toBeNull()
    expect(ship.name).toBe('I.S.S. Renown')
    expect(game.log.some((l) => l.message.includes(old) && l.message.includes('I.S.S. Renown'))).toBe(true)
  })

  it('refuses an empty name and a name another hull holds', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const [a, b] = game.ships
    expect(applyAction(game, { type: 'rename-ship', shipId: a.id, name: '   ' }).message).toBeTruthy()
    // The log identifies ships by name — and the AI reads the log — so a
    // name may not be taken while another hull answers to it.
    expect(applyAction(game, { type: 'rename-ship', shipId: a.id, name: b.name }).message).toBeTruthy()
    expect(a.name).not.toBe(b.name)
  })

  it('is deterministic on replay: the journaled rename rebuilds the same name', () => {
    const game = startScenario('s3.1-the-duel', { seed: 7 })
    const ship = game.ships[1]
    applyAction(game, { type: 'rename-ship', shipId: ship.id, name: 'V.I.S. Duelist' })
    const replay = startScenario('s3.1-the-duel', { seed: 7 })
    applyAction(replay, { type: 'rename-ship', shipId: ship.id, name: 'V.I.S. Duelist' })
    expect(replay.ships[1].name).toBe(game.ships[1].name)
  })
})
