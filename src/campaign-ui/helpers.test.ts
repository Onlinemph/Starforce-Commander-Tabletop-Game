import { describe, expect, it } from 'vitest'
import { allHexes, hexDistance } from '../campaign/hexmap'
import { hexCenter, pixelToHex, stageOrder, stagedOrderFor } from './helpers'
import type { Intervention, StandingOrder } from '../campaign/types'

describe('campaign map geometry', () => {
  it('pixelToHex inverts hexCenter across the whole board', () => {
    for (const h of allHexes(20, 16)) {
      const c = hexCenter(h, 14)
      expect(pixelToHex(c.x, c.y, 14)).toEqual(h)
    }
  })

  it('a click near a hex edge still lands on one of the two neighbors', () => {
    const a = hexCenter({ q: 3, r: 4 }, 14)
    const b = hexCenter({ q: 4, r: 4 }, 14)
    const mid = pixelToHex((a.x + b.x) / 2 + 0.01, (a.y + b.y) / 2, 14)
    expect(hexDistance(mid, { q: 3, r: 4 })).toBeLessThanOrEqual(1)
    expect(hexDistance(mid, { q: 4, r: 4 })).toBeLessThanOrEqual(1)
  })
})

describe('intervention staging (5.2)', () => {
  const order = (speed: StandingOrder['speed']): StandingOrder => ({
    waypoints: [],
    speed,
    sensorPower: 1,
    cloaked: false,
    formation: 'standard',
  })

  it('keeps one set-order per unit, last edit winning', () => {
    let pending: Intervention[] = []
    pending = stageOrder(pending, 'u-1', order('cruise'))
    pending = stageOrder(pending, 'u-2', order('hold'))
    pending = stageOrder(pending, 'u-1', order('hold'))
    expect(pending).toHaveLength(2)
    expect(stagedOrderFor(pending, 'u-1')?.speed).toBe('hold')
    expect(stagedOrderFor(pending, 'u-2')?.speed).toBe('hold')
    expect(stagedOrderFor(pending, 'u-3')).toBeNull()
  })
})
