import { describe, expect, it } from 'vitest'
import type { Hex } from '../campaign/types'
import { EDGE_DIR, HEX, components, hexNoise, hexesWithin, mapSeed, meshPaths, regionPath } from './plot'
import { hexCenter } from './helpers'

/** Loops in a merged outline, as `M…L…Z` groups. */
function loops(d: string): string[] {
  return d.split('M').filter(Boolean).map((chunk) => `M${chunk}`)
}
function segments(d: string): number {
  return (d.match(/L/g) ?? []).length
}

describe('EDGE_DIR', () => {
  it('names the neighbour each edge actually faces', () => {
    // Edge i's midpoint must be exactly half the offset to EDGE_DIR[i].
    for (let i = 0; i < 6; i++) {
      const a = corner(i)
      const b = corner((i + 1) % 6)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const nb = hexCenter(EDGE_DIR[i], HEX)
      expect(mid.x).toBeCloseTo(nb.x / 2, 9)
      expect(mid.y).toBeCloseTo(nb.y / 2, 9)
    }
  })

  it('is antipodal at three steps', () => {
    for (let i = 0; i < 3; i++) {
      expect(EDGE_DIR[i + 3].q + EDGE_DIR[i].q).toBe(0)
      expect(EDGE_DIR[i + 3].r + EDGE_DIR[i].r).toBe(0)
    }
  })
})

function corner(i: number): { x: number; y: number } {
  const angle = (Math.PI / 180) * (60 * i)
  return { x: HEX * Math.cos(angle), y: HEX * Math.sin(angle) }
}

describe('regionPath', () => {
  it('draws a single hex as one closed loop of six segments', () => {
    const d = regionPath([{ q: 3, r: 3 }])
    expect(loops(d)).toHaveLength(1)
    expect(segments(d)).toBe(6)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('drops the shared edge between two neighbours', () => {
    const d = regionPath([
      { q: 3, r: 3 },
      { q: 4, r: 3 },
    ])
    expect(loops(d)).toHaveLength(1)
    expect(segments(d)).toBe(10)
  })

  it('leaves a hole when a ring encloses an empty centre', () => {
    const centre = { q: 5, r: 5 }
    const ring = EDGE_DIR.map((d) => ({ q: centre.q + d.q, r: centre.r + d.r }))
    const d = regionPath(ring)
    // One outer loop, one inner loop. evenodd then leaves the hole open.
    expect(loops(d)).toHaveLength(2)
  })

  it('keeps both loops when two lobes pinch at one shared corner', () => {
    // Two hexes meeting at a single vertex: q,r and q+1,r-1 share only a corner
    // through the gap, so the outline is two loops and neither may be dropped.
    const d = regionPath([
      { q: 0, r: 0 },
      { q: 1, r: 1 },
    ])
    expect(loops(d)).toHaveLength(2)
    expect(segments(d)).toBe(12)
  })

  it('closes a 19-hex uncertainty cloud', () => {
    const cloud = hexesWithin({ q: 10, r: 10 }, 2)
    expect(cloud).toHaveLength(19)
    const d = regionPath(cloud)
    expect(loops(d)).toHaveLength(1)
    // A radius-2 hex disc has 12 boundary hexes and 30 boundary edges.
    expect(segments(d)).toBe(30)
  })

  it('is empty for no members', () => {
    expect(regionPath([])).toBe('')
  })
})

describe('meshPaths', () => {
  it('emits every edge exactly once', () => {
    const w = 4
    const h = 3
    const { grid, rim } = meshPaths(w, h, new Set())
    // Each interior edge once, each boundary edge once. Total edge slots are
    // 6·cells; interior edges are counted twice among those slots.
    const interior = (grid.match(/M/g) ?? []).length
    const boundary = (rim.match(/M/g) ?? []).length
    expect(interior * 2 + boundary).toBe(6 * w * h)
  })

  it('promotes a system hex to a whole lit outline', () => {
    const { lit } = meshPaths(4, 3, new Set(['1,0']))
    expect((lit.match(/M/g) ?? []).length).toBe(1)
    expect(segments(lit)).toBe(5)
    expect(lit.endsWith('Z')).toBe(true)
  })
})

describe('components', () => {
  it('splits a set into connected groups in array order', () => {
    const members: Hex[] = [
      { q: 0, r: 0 },
      { q: 5, r: 5 },
      { q: 1, r: 0 },
      { q: 6, r: 5 },
    ]
    const out = components(members)
    expect(out).toHaveLength(2)
    expect(out[0][0]).toEqual({ q: 0, r: 0 })
    expect(out[0]).toHaveLength(2)
    expect(out[1][0]).toEqual({ q: 5, r: 5 })
  })
})

describe('determinism', () => {
  it('hexNoise is pinned to coordinates and salt', () => {
    const a = hexNoise({ q: 4, r: -2 }, 0x51)
    expect(hexNoise({ q: 4, r: -2 }, 0x51)).toBe(a)
    expect(hexNoise({ q: 4, r: -2 }, 0x52)).not.toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
  })

  it('mapSeed changes when the map changes and not otherwise', () => {
    const map = { width: 4, height: 3, terrain: [{ q: 1, r: 0, kind: 'dust' as const }], border: [{ q: 2, r: 0 }] }
    expect(mapSeed(map)).toBe(mapSeed(structuredClone(map)))
    expect(mapSeed({ ...map, border: [{ q: 3, r: 0 }] })).not.toBe(mapSeed(map))
  })
})
