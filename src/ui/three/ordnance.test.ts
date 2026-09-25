import { describe, expect, it } from 'vitest'
import type { Flight } from '../../engine/fighters'
import { bearingDeg, fannedFlights, formationSeats } from './ordnance'

function flight(id: string, x: number, y: number, members = 4): Flight {
  return {
    id,
    side: 'Blue Fleet',
    motherId: 'carrier-1',
    cardId: 'sabre',
    config: 'strike',
    spent: false,
    members,
    position: { x, y },
    damage: 0,
    activated: false,
    attacked: false,
  }
}

describe('fannedFlights', () => {
  it('leaves a single flight exactly where it is', () => {
    const [{ at }] = fannedFlights([flight('a', 10, 10)])
    expect(at).toEqual({ x: 10, y: 10 })
  })

  it('nudges a second flight stacked on the same spot apart, leaving the first alone', () => {
    const [first, second] = fannedFlights([flight('a', 10, 10), flight('b', 10, 10)])
    expect(first.at).toEqual({ x: 10, y: 10 })
    expect(second.at).not.toEqual({ x: 10, y: 10 })
    expect(Math.hypot(second.at.x - 10, second.at.y - 10)).toBeCloseTo(0.34, 5)
  })

  it('does not fan flights that are merely close, only ones on the same half-inch cell', () => {
    const [, second] = fannedFlights([flight('a', 10, 10), flight('b', 10.3, 10.3)])
    expect(second.at).toEqual({ x: 10.3, y: 10.3 })
  })

  it('fans a third stacked flight to a different angle than the second', () => {
    const [, second, third] = fannedFlights([flight('a', 5, 5), flight('b', 5, 5), flight('c', 5, 5)])
    expect(second.at).not.toEqual(third.at)
  })
})

describe('formationSeats', () => {
  it('always seats the leader at the origin', () => {
    expect(formationSeats(1)).toEqual([{ x: 0, z: 0 }])
  })

  it('returns exactly n seats, one per fighter', () => {
    for (const n of [1, 2, 3, 4, 6, 8]) {
      expect(formationSeats(n)).toHaveLength(n)
    }
  })

  it('fans seats out symmetrically behind the leader', () => {
    const seats = formationSeats(3)
    expect(seats[0]).toEqual({ x: 0, z: 0 })
    expect(seats[1].x).toBeCloseTo(-seats[2].x, 5)
    expect(seats[1].z).toBeCloseTo(seats[2].z, 5)
    // Behind the leader, not ahead of it (nose is −z).
    expect(seats[1].z).toBeGreaterThan(0)
  })

  it('never returns fewer than one seat', () => {
    expect(formationSeats(0)).toHaveLength(1)
  })
})

describe('bearingDeg', () => {
  it('reads due north as heading 0', () => {
    expect(bearingDeg({ x: 0, z: 10 }, { x: 0, z: 0 })).toBeCloseTo(0, 5)
  })

  it('reads due east as heading 90', () => {
    expect(bearingDeg({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(90, 5)
  })

  it('reads due south as heading 180', () => {
    expect(bearingDeg({ x: 0, z: 0 }, { x: 0, z: 10 })).toBeCloseTo(180, 5)
  })

  it('reads due west as heading -90 (i.e. 270 going the other way)', () => {
    expect(bearingDeg({ x: 0, z: 0 }, { x: -10, z: 0 })).toBeCloseTo(-90, 5)
  })
})
