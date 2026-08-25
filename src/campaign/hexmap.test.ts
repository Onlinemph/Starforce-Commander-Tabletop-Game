import { describe, expect, it } from 'vitest'
import {
  allHexes,
  entryCost,
  generateMap,
  hexDistance,
  hexNeighbors,
  hexStepToward,
  inBounds,
  snapToHexLine,
  terrainAt,
  HEX_DIRECTIONS,
} from './hexmap'
import { nextInt, type CampaignRng, type Hex } from './types'

/**
 * The one hexDistance (2.1), property-tested as the doc instructs, and the
 * seeded generator whose output is stored rather than trusted to reproduce.
 */

const rnd = (rng: CampaignRng): Hex => ({ q: nextInt(rng, 41) - 20, r: nextInt(rng, 41) - 20 })

describe('hex math', () => {
  it('distance is a metric: identity, symmetry, triangle inequality', () => {
    const rng = { seed: 99, calls: 0 }
    for (let i = 0; i < 500; i++) {
      const a = rnd(rng)
      const b = rnd(rng)
      const c = rnd(rng)
      expect(hexDistance(a, a)).toBe(0)
      expect(hexDistance(a, b)).toBe(hexDistance(b, a))
      expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c))
      expect(Number.isInteger(hexDistance(a, b))).toBe(true)
      expect(hexDistance(a, b)).toBeGreaterThanOrEqual(0)
    }
  })

  it('every neighbor is at distance one, and there are six of them', () => {
    const rng = { seed: 7, calls: 0 }
    for (let i = 0; i < 100; i++) {
      const h = rnd(rng)
      const ns = hexNeighbors(h)
      expect(ns).toHaveLength(6)
      expect(new Set(ns.map((n) => `${n.q},${n.r}`)).size).toBe(6)
      for (const n of ns) expect(hexDistance(h, n)).toBe(1)
    }
  })

  it('stepping toward a target closes exactly one hex per step, deterministically', () => {
    const rng = { seed: 13, calls: 0 }
    for (let i = 0; i < 100; i++) {
      const from = rnd(rng)
      const to = rnd(rng)
      let at = from
      let guard = 0
      while (hexDistance(at, to) > 0 && guard++ < 200) {
        const next = hexStepToward(at, to)
        expect(hexDistance(next, to)).toBe(hexDistance(at, to) - 1)
        at = next
      }
      expect(at).toEqual(to)
      // Same inputs, same path.
      expect(hexStepToward(from, to)).toEqual(hexStepToward(from, to))
    }
  })

  it('snapToHexLine returns on-line clicks exactly, on every ray', () => {
    const from = { q: 10, r: 5 }
    for (const d of HEX_DIRECTIONS) {
      for (let k = 1; k <= 6; k++) {
        const target = { q: from.q + k * d.q, r: from.r + k * d.r }
        if (!inBounds(target, 30, 22)) continue
        expect(snapToHexLine(from, target, 30, 22)).toEqual(target)
      }
    }
    expect(snapToHexLine(from, from, 30, 22)).toBeNull()
  })

  it('snapToHexLine lands off-line clicks on a straight ray, never further than the click', () => {
    const rng = { seed: 31, calls: 0 }
    for (let i = 0; i < 200; i++) {
      const from = { q: 5 + nextInt(rng, 20), r: -2 + nextInt(rng, 12) }
      const target = { q: nextInt(rng, 30), r: -Math.floor(nextInt(rng, 30) / 2) + nextInt(rng, 22) }
      if (!inBounds(from, 30, 22) || !inBounds(target, 30, 22)) continue
      const snapped = snapToHexLine(from, target, 30, 22)
      if (hexDistance(from, target) === 0) {
        expect(snapped).toBeNull()
        continue
      }
      expect(snapped).not.toBeNull()
      // On one of the six rays: the whole leg walks a single direction.
      const leg = hexDistance(from, snapped!)
      const dir = HEX_DIRECTIONS.find(
        (d) => snapped!.q === from.q + leg * d.q && snapped!.r === from.r + leg * d.r,
      )
      expect(dir).toBeDefined()
      expect(inBounds(snapped!, 30, 22)).toBe(true)
      expect(leg).toBeLessThanOrEqual(hexDistance(from, target))
      // Deterministic.
      expect(snapToHexLine(from, target, 30, 22)).toEqual(snapped)
    }
  })

  it('the rectangle holds width x height hexes and inBounds agrees', () => {
    const hexes = allHexes(11, 9)
    expect(hexes).toHaveLength(11 * 9)
    for (const h of hexes) expect(inBounds(h, 11, 9)).toBe(true)
    expect(inBounds({ q: -1, r: 0 }, 11, 9)).toBe(false)
    expect(inBounds({ q: 11, r: -5 }, 11, 9)).toBe(false)
  })
})

describe('map generation (2.2)', () => {
  const generate = (seed: number) => generateMap({ seed, calls: 0 }, 40, 30)

  it('is deterministic: same seed, same map, byte for byte', () => {
    expect(JSON.stringify(generate(42))).toBe(JSON.stringify(generate(42)))
    expect(JSON.stringify(generate(42))).not.toBe(JSON.stringify(generate(43)))
  })

  it('keeps the spacing and count rules across seeds', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const map = generate(seed)
      const systems = map.terrain.filter((t) => t.kind === 'system')
      expect(systems.length).toBeGreaterThanOrEqual(8)
      expect(systems.length).toBeLessThanOrEqual(14)
      for (const a of systems) {
        for (const b of systems) {
          if (a === b) continue
          expect(hexDistance(a, b)).toBeGreaterThanOrEqual(4)
        }
      }
      expect(map.terrain.filter((t) => t.kind === 'nebula').length).toBeGreaterThan(0)
      expect(map.terrain.filter((t) => t.kind === 'dust').length).toBeGreaterThan(0)
      for (const t of map.terrain) expect(inBounds(t, map.width, map.height)).toBe(true)
      // One entry per hex — no terrain stacked on terrain.
      expect(new Set(map.terrain.map((t) => `${t.q},${t.r}`)).size).toBe(map.terrain.length)
      expect(map.border.length).toBeGreaterThan(0)
    }
  })

  it('reads deep space where nothing was placed, and charges slow terrain double', () => {
    const map = generate(21)
    expect(terrainAt(map, { q: -100, r: 0 })).toBe('deep')
    expect(entryCost('deep')).toBe(1)
    expect(entryCost('system')).toBe(1)
    expect(entryCost('nebula')).toBe(2)
    expect(entryCost('dust')).toBe(2)
  })
})
