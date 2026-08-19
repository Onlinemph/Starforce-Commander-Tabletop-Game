import { describe, expect, it } from 'vitest'
import { hexesThisPhase, movementPhases, ownPhaseIndex, ROUND_PHASES } from './schedule'

/**
 * The designer's 16-phase movement schedule, row for row. The implementation
 * generates it from the join order; this test holds it to the printed table.
 */

describe('the 16-phase movement schedule', () => {
  it("reproduces the designer's table for player A", () => {
    expect(movementPhases(1, 'A')).toEqual([15])
    expect(movementPhases(2, 'A')).toEqual([7, 15])
    expect(movementPhases(3, 'A')).toEqual([3, 7, 15])
    expect(movementPhases(4, 'A')).toEqual([3, 7, 11, 15])
    expect(movementPhases(5, 'A')).toEqual([3, 7, 11, 13, 15])
    expect(movementPhases(6, 'A')).toEqual([3, 5, 7, 11, 13, 15])
    expect(movementPhases(7, 'A')).toEqual([3, 5, 7, 9, 11, 13, 15])
    expect(movementPhases(8, 'A')).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
  })

  it('player B is the same table plus one', () => {
    for (let speed = 1; speed <= 8; speed++) {
      expect(movementPhases(speed, 'B')).toEqual(movementPhases(speed, 'A').map((p) => p + 1))
    }
    expect(movementPhases(1, 'B')).toEqual([16])
    expect(movementPhases(8, 'B')).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
  })

  it('a round always delivers exactly `speed` hexes', () => {
    for (const side of ['A', 'B'] as const) {
      for (let speed = 0; speed <= 13; speed++) {
        let total = 0
        for (let phase = 1; phase <= ROUND_PHASES; phase++) {
          total += hexesThisPhase(speed, side, phase)
        }
        expect(total, `speed ${speed} side ${side}`).toBe(speed)
      }
    }
  })

  it('very high speed moves twice in a phase, as the designer notes', () => {
    // Speed 9 wraps the join order: the speed-1 phase carries the extra hex.
    expect(hexesThisPhase(9, 'A', 15)).toBe(2)
    expect(movementPhases(9, 'A')).toEqual(movementPhases(8, 'A'))
    // A dreadnought at emergency (13) doubles up in five of its eight phases.
    const doubled = movementPhases(13, 'A').filter((p) => hexesThisPhase(13, 'A', p) === 2)
    expect(doubled).toHaveLength(5)
  })

  it('you only move on your own phases', () => {
    for (let phase = 1; phase <= ROUND_PHASES; phase++) {
      const aOwns = phase % 2 === 1
      expect(ownPhaseIndex('A', phase) !== null).toBe(aOwns)
      expect(ownPhaseIndex('B', phase) !== null).toBe(!aOwns)
      expect(hexesThisPhase(8, aOwns ? 'B' : 'A', phase)).toBe(0)
    }
  })
})
