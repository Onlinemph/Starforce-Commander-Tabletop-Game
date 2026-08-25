/**
 * Axial hex math and seeded map generation (design doc Part 2).
 *
 * Flat-top hexes on axial (q, r) integers. `hexDistance` is implemented once,
 * here, through cube coordinates — the doc's instruction is to property-test
 * it and never inline it, because a second hand-rolled distance is how two
 * modules quietly disagree about whether a contact is in scan range.
 */

import {
  nextInt,
  nextRandom,
  type CampaignMap,
  type CampaignRng,
  type Hex,
  type TerrainKind,
} from './types'

/** The six flat-top axial direction vectors, fixed order for determinism. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

/** Cube distance via the axial shortcut (s = −q−r). */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }))
}

/**
 * The single hex step from `from` toward `to`: the neighbor that closes the
 * most distance, ties broken by direction order so a replay steps identically.
 * Stepping toward yourself stays put.
 */
export function hexStepToward(from: Hex, to: Hex): Hex {
  if (hexEquals(from, to)) return from
  let best = from
  let bestDist = hexDistance(from, to)
  for (const n of hexNeighbors(from)) {
    const d = hexDistance(n, to)
    if (d < bestDist) {
      best = n
      bestDist = d
    }
  }
  return best
}

/**
 * The nearest hex to `target` that lies on one of the six straight rays out
 * of `from`, never leaving the map. Plotted courses are straight legs only —
 * a zigzag is several waypoints — so a map click snaps here before it becomes
 * a waypoint. A click already on a ray returns exactly itself; ties between
 * rays prefer the shorter leg, then the fixed direction order, so the snap is
 * deterministic. Returns null when `from` IS the target (no leg to plot).
 */
export function snapToHexLine(from: Hex, target: Hex, width: number, height: number): Hex | null {
  const reach = hexDistance(from, target)
  if (reach === 0) return null
  let best: Hex | null = null
  let bestDist = Infinity
  let bestLeg = Infinity
  for (const d of HEX_DIRECTIONS) {
    let at = from
    for (let leg = 1; leg <= reach; leg++) {
      at = { q: at.q + d.q, r: at.r + d.r }
      if (!inBounds(at, width, height)) break
      const dist = hexDistance(at, target)
      if (dist < bestDist || (dist === bestDist && leg < bestLeg)) {
        best = at
        bestDist = dist
        bestLeg = leg
      }
    }
  }
  return best
}

/**
 * Rectangle membership for the stored map: axial columns q ∈ [0, width),
 * with r offset so each column holds `height` rows — the standard rectangular
 * axial layout for flat-top grids.
 */
export function inBounds(h: Hex, width: number, height: number): boolean {
  if (h.q < 0 || h.q >= width) return false
  const rMin = -Math.floor(h.q / 2)
  return h.r >= rMin && h.r < rMin + height
}

/** Every hex of the rectangle, row-major, for generation and rendering. */
export function allHexes(width: number, height: number): Hex[] {
  const out: Hex[] = []
  for (let q = 0; q < width; q++) {
    const rMin = 0 - Math.floor(q / 2)
    for (let r = rMin; r < rMin + height; r++) out.push({ q, r })
  }
  return out
}

export function terrainAt(map: CampaignMap, h: Hex): TerrainKind {
  const found = map.terrain.find((t) => t.q === h.q && t.r === h.r)
  return found?.kind ?? 'deep'
}

/** Phases one hex step costs on entry: nebula and dust move at half pace (2.2). */
export function entryCost(kind: TerrainKind): 1 | 2 {
  return kind === 'nebula' || kind === 'dust' ? 2 : 1
}

/**
 * Seeded map generation (2.2): 8–14 star systems at least 4 apart, 3–5 nebula
 * blobs of 3–8 hexes, 2–4 dust belts. The result is stored in the campaign
 * file; the seed is an input, not a substitute for storage.
 */
export function generateMap(rng: CampaignRng, width: number, height: number): CampaignMap {
  const terrain = new Map<string, { q: number; r: number; kind: Exclude<TerrainKind, 'deep'> }>()
  const hexes = allHexes(width, height)
  const pick = (): Hex => hexes[nextInt(rng, hexes.length)]

  // Star systems: rejection-sample the spacing rule, deterministically.
  const systems: Hex[] = []
  const systemTarget = 8 + nextInt(rng, 7)
  for (let attempt = 0; attempt < 400 && systems.length < systemTarget; attempt++) {
    const h = pick()
    if (systems.some((s) => hexDistance(s, h) < 4)) continue
    systems.push(h)
    terrain.set(hexKey(h), { q: h.q, r: h.r, kind: 'system' })
  }

  // Nebula blobs: random walks from a seed hex, skipping systems.
  const blobCount = 3 + nextInt(rng, 3)
  for (let b = 0; b < blobCount; b++) {
    let at = pick()
    const size = 3 + nextInt(rng, 6)
    for (let i = 0; i < size; i++) {
      if (inBounds(at, width, height) && !terrain.has(hexKey(at))) {
        terrain.set(hexKey(at), { q: at.q, r: at.r, kind: 'nebula' })
      }
      at = hexNeighbors(at)[nextInt(rng, 6)]
    }
  }

  // Dust belts: drifting lines, 4–8 hexes long.
  const beltCount = 2 + nextInt(rng, 3)
  for (let b = 0; b < beltCount; b++) {
    let at = pick()
    const heading = nextInt(rng, 6)
    const length = 4 + nextInt(rng, 5)
    for (let i = 0; i < length; i++) {
      if (inBounds(at, width, height) && !terrain.has(hexKey(at))) {
        terrain.set(hexKey(at), { q: at.q, r: at.r, kind: 'dust' })
      }
      // Mostly straight, with a seeded wobble.
      const dir = nextRandom(rng) < 0.7 ? heading : (heading + (nextInt(rng, 2) === 0 ? 1 : 5)) % 6
      const d = HEX_DIRECTIONS[dir]
      at = { q: at.q + d.q, r: at.r + d.r }
    }
  }

  // The border: a jagged vertical line near the middle column (2.3).
  const border: Hex[] = []
  let bq = Math.floor(width / 2)
  for (let row = 0; row < height; row++) {
    const h = { q: bq, r: -Math.floor(bq / 2) + row }
    if (inBounds(h, width, height)) border.push(h)
    if (nextRandom(rng) < 0.3) {
      bq += nextInt(rng, 2) === 0 ? 1 : -1
      bq = Math.max(Math.floor(width / 3), Math.min(Math.floor((2 * width) / 3), bq))
    }
  }

  return { width, height, terrain: [...terrain.values()], border }
}
