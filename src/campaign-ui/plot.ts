/**
 * Pure geometry for the operational plot — DOM-free, deterministic, testable.
 *
 * Everything the campaign map draws that is not a counter is built here: the
 * merged outlines that turn a set of hexes into ONE region (so a nebula stops
 * looking like blocky staining), the mesh with each edge emitted exactly once,
 * the frontier smoothing, and the two deterministic noise sources.
 *
 * The one non-obvious fact in this file is EDGE_DIR. Get it wrong and every
 * merged outline is inside-out. It is derived from `hexCenter`, not guessed,
 * and it is NOT `HEX_DIRECTIONS` in a different order — mixing the two
 * produces silently wrong regions.
 */

import { hexKey, hexNeighbors, inBounds } from '../campaign/hexmap'
import type { CampaignMap, Hex } from '../campaign/types'
import { hexCenter } from './helpers'

/** Hex circumradius in user units. Unchanged from the original component. */
export const HEX = 16
/** Column pitch: 1.5 · size. */
export const COL = HEX * 1.5
/** Row pitch: √3 · size. */
export const ROW = HEX * Math.sqrt(3)
/** Inradius: half a row. */
export const IN_R = ROW / 2

export interface P {
  x: number
  y: number
}

/* Corner i sits at 60·i degrees, exactly as hexPoints() computes it. Computed
   once as module constants so every hex derives its corners from bit-identical
   doubles and shared vertices match to the last ulp. */
export const CDX: readonly number[] = [HEX, HEX / 2, -HEX / 2, -HEX, -HEX / 2, HEX / 2]
export const CDY: readonly number[] = [0, IN_R, IN_R, 0, -IN_R, -IN_R]

/**
 * Edge i runs corner i → corner i+1 and faces this neighbour.
 *
 * Derived: `hexCenter` puts a neighbour at Δx = 1.5s·Δq, Δy = s√3·(Δr + Δq/2),
 * so d{1,0} lies at (1.5s, 0.866s) — lower-right, not east — whose half is
 * exactly edge 0's midpoint (0.75s, 0.433s).
 *
 * Traversal i → i+1 is CLOCKWISE in screen coordinates (y down), so outer
 * loops come out clockwise and holes counter-clockwise for free: render with
 * fillRule="evenodd" and holes are correct with no extra work.
 */
export const EDGE_DIR: readonly Hex[] = [
  { q: 1, r: 0 }, // E0
  { q: 0, r: 1 }, // E1
  { q: -1, r: 1 }, // E2
  { q: -1, r: 0 }, // E3  = −E0
  { q: 0, r: -1 }, // E4  = −E1
  { q: 1, r: -1 }, // E5  = −E2
]

function cornerOf(cx: number, cy: number, i: number, k: number): P {
  return { x: cx + CDX[i] * k, y: cy + CDY[i] * k }
}

/* The same 2 dp hexPoints() already uses, so endpoint matching is exact string
   equality and never a float comparison. Two hexes compute a shared corner from
   different centres; the doubles agree to ~1e-13 while the corner lattice is
   spaced 8 units in x and 13.86 in y — eleven orders of magnitude of margin. */
const pkey = (p: P): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`

/**
 * Connected components of a hex set, flood-filled over hexNeighbors.
 *
 * Iterates `members` in ARRAY order, so the result is deterministic. Map/Set
 * iteration in JS is insertion order — stated here so nobody "optimises" this
 * into an unordered structure and breaks the seeded scatter downstream.
 */
export function components(members: Hex[]): Hex[][] {
  const set = new Map<string, Hex>()
  for (const h of members) set.set(hexKey(h), h)
  const seen = new Set<string>()
  const out: Hex[][] = []
  for (const h of members) {
    const k0 = hexKey(h)
    if (seen.has(k0)) continue
    seen.add(k0)
    const group: Hex[] = [h]
    for (let i = 0; i < group.length; i++) {
      for (const n of hexNeighbors(group[i])) {
        const k = hexKey(n)
        if (seen.has(k) || !set.has(k)) continue
        seen.add(k)
        group.push(set.get(k)!)
      }
    }
    out.push(group)
  }
  return out
}

/**
 * One merged outline for a set of hexes: every interior edge dropped, the
 * surviving edges chained end-to-start into closed loops, all loops in one `d`.
 *
 * Use with fillRule="evenodd" — winding is already correct (see EDGE_DIR).
 */
export function regionPath(members: Hex[], size = HEX): string {
  if (members.length === 0) return ''
  const k = size / HEX
  const set = new Set(members.map(hexKey))
  const segs: { a: P; b: P; used: boolean }[] = []
  for (const h of members) {
    const c = hexCenter(h, size)
    for (let i = 0; i < 6; i++) {
      const d = EDGE_DIR[i]
      if (set.has(`${h.q + d.q},${h.r + d.r}`)) continue // interior: drop it
      segs.push({ a: cornerOf(c.x, c.y, i, k), b: cornerOf(c.x, c.y, (i + 1) % 6, k), used: false })
    }
  }
  /* A LIST per start point, not a value: two lobes of one region can pinch at a
     single shared corner where the vertex has two outgoing edges, and a plain
     Map<point, edge> silently drops one so the chain never closes. */
  const byStart = new Map<string, typeof segs>()
  for (const s of segs) {
    const key = pkey(s.a)
    const list = byStart.get(key)
    if (list) list.push(s)
    else byStart.set(key, [s])
  }
  let d = ''
  for (const seed of segs) {
    if (seed.used) continue
    seed.used = true
    let cur = seed
    d += `M${seed.a.x.toFixed(2)},${seed.a.y.toFixed(2)}`
    d += `L${cur.b.x.toFixed(2)},${cur.b.y.toFixed(2)}`
    for (;;) {
      const next = byStart.get(pkey(cur.b))?.find((s) => !s.used)
      if (!next) break
      next.used = true
      cur = next
      d += `L${cur.b.x.toFixed(2)},${cur.b.y.toFixed(2)}`
    }
    d += 'Z'
  }
  return d
}

/**
 * The mesh, each edge emitted exactly once.
 *
 * Because EDGE_DIR[i+3] = −EDGE_DIR[i], the shared edge between two in-bounds
 * hexes is edge i of one and edge i+3 of the other; skipping i ≥ 3 whenever the
 * neighbour is in bounds hands every interior edge to exactly one owner and
 * every boundary edge to its only in-bounds owner. The original component
 * stroked every interior edge TWICE, which is half of why the mesh read at
 * double weight.
 *
 * `rim` is the boundary edges as loose segments — the form the once-only
 * invariant is stated in, and the form a dashed stroke must NOT be drawn in,
 * because SVG restarts strokeDasharray at every subpath. The component takes
 * its plot edge from `regionPath(allHexes(w, h))`, which is the same geometry
 * chained into closed loops.
 *
 * `lit` carries the whole outline of every system hex: the corona spills across
 * neighbours, so the instrument layer restates which hex is actually the system.
 * The component strokes it BROKEN (a tick centred on each edge), which is what
 * keeps it from reading as a tile — or as the selection frame.
 *
 * `veiled` is the interior mesh of an opaque region: an edge whose BOTH owners
 * are in `veilKeys`. Dust is a hole, and a full-weight cool hairline across
 * every shared edge inside it is the single strongest reason a dust belt reads
 * as a stack of separate hexes rather than one smear. Splitting the edges here
 * costs nothing at draw time — the alternative, a mask over the whole mesh, is
 * an offscreen buffer the size of the plot.
 */
export function meshPaths(
  w: number,
  h: number,
  systemKeys: Set<string>,
  veilKeys: Set<string> = new Set(),
): { grid: string; veiled: string; rim: string; lit: string } {
  let grid = ''
  let veiled = ''
  let rim = ''
  let lit = ''
  for (let q = 0; q < w; q++) {
    const rMin = -Math.floor(q / 2)
    for (let r = rMin; r < rMin + h; r++) {
      const c = hexCenter({ q, r }, HEX)
      const isSystem = systemKeys.has(`${q},${r}`)
      const isVeiled = veilKeys.has(`${q},${r}`)
      if (isSystem) {
        let ring = ''
        for (let i = 0; i < 6; i++) {
          const p = cornerOf(c.x, c.y, i, 1)
          ring += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`
        }
        lit += `${ring}Z`
      }
      for (let i = 0; i < 6; i++) {
        const d = EDGE_DIR[i]
        const nbIn = inBounds({ q: q + d.q, r: r + d.r }, w, h)
        if (i >= 3 && nbIn) continue // the neighbour owns it as its own i−3
        const a = cornerOf(c.x, c.y, i, 1)
        const b = cornerOf(c.x, c.y, (i + 1) % 6, 1)
        const seg = `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`
        if (!nbIn) rim += seg
        else if (isVeiled && veilKeys.has(`${q + d.q},${r + d.r}`)) veiled += seg
        else grid += seg
      }
    }
  }
  return { grid, veiled, rim, lit }
}

/** Catmull-Rom through the points, emitted as cubic Béziers. Endpoints clamped. */
export function smooth(p: P[], t = 1 / 6): string {
  if (p.length === 0) return ''
  if (p.length === 1) return `M${p[0].x.toFixed(2)},${p[0].y.toFixed(2)}`
  let d = `M${p[0].x.toFixed(2)},${p[0].y.toFixed(2)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] ?? p[i + 1]
    const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t }
    const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t }
    d +=
      `C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ` +
      `${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

/** A circle as two arcs, so hundreds of stars fit in one <path>. */
export function dot(x: number, y: number, r: number): string {
  const rr = r.toFixed(2)
  return (
    `M${x.toFixed(1)},${y.toFixed(1)}m${(-r).toFixed(2)},0` +
    `a${rr},${rr} 0 1,0 ${(2 * r).toFixed(2)},0a${rr},${rr} 0 1,0 ${(-2 * r).toFixed(2)},0`
  )
}

/**
 * One seed for the whole sky, from map data only (FNV-1a).
 *
 * Same campaign → same sky on every render, after a reload, in a replay and on
 * the opponent's screen. It reads only `map`, which is already public to both
 * sides, so it leaks nothing. It doubles as the memo signature: `viewFor` does
 * `structuredClone(map)`, so `view.map` is a fresh object every render and
 * memoising on it would re-run every merge every time.
 */
export function mapSeed(map: CampaignMap): number {
  let h = 0x811c9dc5
  const feed = (n: number): void => {
    h ^= n | 0
    h = Math.imul(h, 0x01000193)
  }
  feed(map.width)
  feed(map.height)
  for (const t of map.terrain) {
    feed(t.q)
    feed(t.r)
    feed(t.kind.charCodeAt(0))
  }
  for (const b of map.border) {
    feed(b.q)
    feed(b.r)
  }
  return h >>> 0
}

/**
 * A positional hash in [0,1). Per-hex features use this, never the sequential
 * stream, so adding a nebula somewhere can never resize a star elsewhere.
 */
export function hexNoise(h: Hex, salt: number): number {
  let n = (Math.imul(h.q, 0x27d4eb2d) ^ Math.imul(h.r, 0x165667b1) ^ salt) | 0
  n = Math.imul(n ^ (n >>> 15), n | 1)
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61)
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296
}

/** Every hex within `radius` of `c`, in a fixed order. */
export function hexesWithin(c: Hex, radius: number): Hex[] {
  const out: Hex[] = []
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius)
    const hi = Math.min(radius, -dq + radius)
    for (let dr = lo; dr <= hi; dr++) out.push({ q: c.q + dq, r: c.r + dr })
  }
  return out
}
