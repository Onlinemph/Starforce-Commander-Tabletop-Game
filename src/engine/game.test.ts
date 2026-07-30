import { describe, expect, it } from 'vitest'
import { BLUE, RED, startScenario } from '../data/scenarios'
import { advanceSegment, PHASE_ORDER, PHASE_SEGMENTS, victoryPoints, type GameState } from './game'
import { markStructure, structureTotal } from './shipState'

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
  it('scores damage levels by structure percentage', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const red = game.ships.find((s) => s.id === 'red-1')!
    const total = structureTotal(red)

    // Half the structure gone → moderate damage → 50% of point value.
    for (let i = 0; i < Math.ceil(total * 0.5); i++) markStructure(red)
    expect(victoryPoints(game)[BLUE]).toBeCloseTo(red.form.pointValue * 0.5)
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
