import { describe, expect, it } from 'vitest'
import { allHexes, hexDistance } from '../campaign/hexmap'
import { hexCenter, pixelToHex, stageOrder, stagedOrderFor, waypointRounds } from './helpers'
import type { CampaignMap, Intervention, StandingOrder } from '../campaign/types'

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

describe('waypoint ETAs', () => {
  const flat: CampaignMap = { width: 20, height: 16, terrain: [], border: [] }

  it('counts cumulative rounds at the ordered pace, one leg after another', () => {
    // 8 hexes at 4 a round is 2 rounds; the first waypoint 4 in lands at 1.
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 4, r: 0 }, { q: 8, r: 0 }], 4)).toEqual([1, 2])
    // A leg the speed does not divide rounds UP — half-finished is not arrived.
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 5, r: 0 }], 4)).toEqual([2])
  })

  it('charges nebula and dust hexes double, the resolver’s own entry cost', () => {
    const misty: CampaignMap = {
      ...flat,
      terrain: [
        { q: 1, r: 0, kind: 'nebula' },
        { q: 2, r: 0, kind: 'dust' },
      ],
    }
    // 2 + 2 + 1 = 5 credits to (3,0): at speed 2 that is 3 rounds, not 2.
    expect(waypointRounds(misty, { q: 0, r: 0 }, [{ q: 3, r: 0 }], 2)).toEqual([3])
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 3, r: 0 }], 2)).toEqual([2])
  })

  it('a unit making no way has no ETA', () => {
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 4, r: 0 }], 0)).toEqual([])
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
