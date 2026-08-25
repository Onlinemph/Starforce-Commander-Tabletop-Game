/**
 * Pure helpers for the campaign UI — the parts worth testing without a DOM.
 *
 * The components stay thin over these: hex geometry for the SVG map, and the
 * intervention staging that turns a player's edits into the journal's shape
 * (one set-order per touched unit, last edit wins — interventions ARE the
 * journal entry, 5.2, so the staging discipline is the file format's).
 */

import { entryCost, hexEquals, hexStepToward, terrainAt } from '../campaign/hexmap'
import type { CampaignMap, Hex, Intervention, StandingOrder } from '../campaign/types'

/** Flat-top hex geometry. `size` is the circumradius in pixels. */
export function hexCenter(h: Hex, size: number): { x: number; y: number } {
  return {
    x: size * 1.5 * h.q,
    y: size * Math.sqrt(3) * (h.r + h.q / 2),
  }
}

/** The six corners of a flat-top hex, as an SVG points string. */
export function hexPoints(h: Hex, size: number): string {
  const c = hexCenter(h, size)
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i)
    pts.push(`${(c.x + size * Math.cos(angle)).toFixed(2)},${(c.y + size * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

/** Pixel → nearest hex, for map clicks. Inverse of hexCenter, cube-rounded. */
export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = (2 / 3) * (x / size)
  const r = (-1 / 3) * (x / size) + (Math.sqrt(3) / 3) * (y / size)
  // Cube rounding.
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: rq, r: rr }
}

/**
 * Rounds to reach each waypoint at `speed` hexes a round — the ETA the plot
 * prints beside a waypoint. Walks the exact greedy line the resolver walks
 * (hexStepToward, one entry cost per hex, nebula and dust costing 2) and
 * converts cumulative credits to rounds: after R rounds the schedule has
 * granted R·speed credits, so a point costing C is reached in ceil(C/speed).
 * Returns [] when the unit is making no way — a hold has no ETA.
 */
export function waypointRounds(
  map: CampaignMap,
  start: Hex,
  waypoints: Hex[],
  speed: number,
): number[] {
  if (speed <= 0) return []
  const out: number[] = []
  let cost = 0
  let at = start
  for (const wp of waypoints) {
    for (let guard = 0; guard < 500 && !hexEquals(at, wp); guard++) {
      const next = hexStepToward(at, wp)
      if (hexEquals(next, at)) break
      cost += entryCost(terrainAt(map, next))
      at = next
    }
    out.push(Math.ceil(cost / speed))
  }
  return out
}

/**
 * Stage an order edit: one pending set-order per unit, the latest edit
 * replacing the previous. What the player sees staged is exactly what the
 * journal will carry.
 */
export function stageOrder(
  pending: Intervention[],
  unitId: string,
  order: StandingOrder,
): Intervention[] {
  const kept = pending.filter((i) => !(i.type === 'set-order' && i.unitId === unitId))
  return [...kept, { type: 'set-order', unitId, order }]
}

/** The staged order for a unit, if any — so the console edits what it staged. */
export function stagedOrderFor(pending: Intervention[], unitId: string): StandingOrder | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    const entry = pending[i]
    if (entry.type === 'set-order' && entry.unitId === unitId) return entry.order
  }
  return null
}

/** Trigger a browser download of a text file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
