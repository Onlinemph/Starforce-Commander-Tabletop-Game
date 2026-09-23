/**
 * Turning a ship's Navigation leg into keyframes for the map.
 *
 * The tabletop moves a ship in straight legs with pivots between them —
 * forward then turn (C2.2.3), half, turn, half (C3.2.2, C3.4.1), a slide
 * without changing facing (C2.4.2), stern-first in reverse (C3.7.2). The map
 * used to tween straight from the old counter to the new one, which draws a
 * turning ship skidding sideways across the chord of its turn. This replays the
 * leg instead: travel along each straight, pivot in place where the maneuver
 * pivots, and finish on the heading the table ends up with.
 *
 * Headings come out *unwrapped* — each key turns the short way from the one
 * before — so a CSS/Web Animations rotate never spins the long way round.
 */
import type { MoveTrail } from '../engine/game'
import type { Placement, Point } from '../engine/types'

export interface MotionKey {
  x: number
  y: number
  /** Unwrapped degrees, continuous with the key before. */
  heading: number
  /** 0..1 along the animation. */
  offset: number
}

/** How much a pivot weighs against travel when sharing out the time, in inches. */
const PIVOT_WEIGHT = 0.9

const shortest = (from: number, to: number) => ((to - from + 540) % 360) - 180

/** Compass bearing from `a` to `b`, clockwise from up — the engine's convention. */
function bearing(a: Point, b: Point): number {
  return (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI
}

/**
 * Keyframes for one leg, ending exactly on `final` — which may differ from the
 * leg's own end when something moved the ship afterwards (turbulence, joining
 * a formation's lead). `startHeading` is the unwrapped heading the counter is
 * currently drawn at, so the animation starts where the eye already is.
 */
export function trailKeyframes(trail: MoveTrail, final: Placement, startHeading: number): MotionKey[] {
  const raw: Array<{ p: Point; h: number; w: number }> = []
  let h = startHeading
  const at = (p: Point, heading: number, weight: number) => raw.push({ p: { ...p }, h: heading, w: weight })

  const points: Point[] = [trail.from.position, ...trail.path.slice(1)]
  const last = points[points.length - 1]
  if (Math.hypot(final.position.x - last.x, final.position.y - last.y) > 1e-6) points.push(final.position)

  at(points[0], h, 0)
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 1e-6) continue
    const travel = bearing(a, b)
    // Relative to the current facing, a leg is forward, astern, or a slide.
    // Anything else means the maneuver pivoted at `a` before this leg.
    const rel = ((shortest(h, travel) % 360) + 360) % 360
    const aligned = [0, 90, 180, 270, 360].some((q) => Math.abs(rel - q) < 1)
    if (!aligned) {
      const facing = trail.reverse ? travel + 180 : travel
      h += shortest(h, facing)
      at(a, h, PIVOT_WEIGHT)
    }
    at(b, h, length)
  }
  // The maneuver's own finishing pivot, then anything that turned it after.
  const end = points[points.length - 1]
  for (const heading of [trail.heading, final.heading]) {
    const delta = shortest(h, heading)
    if (Math.abs(delta) > 0.5) {
      h += delta
      at(end, h, PIVOT_WEIGHT)
    }
  }

  const total = raw.reduce((n, k) => n + k.w, 0)
  if (total === 0) return [{ x: end.x, y: end.y, heading: h, offset: 0 }]
  let run = 0
  return raw.map((k) => {
    run += k.w
    return { x: k.p.x, y: k.p.y, heading: k.h, offset: run / total }
  })
}

/** Milliseconds for a leg: brisk for a nudge, never so long it holds up play. */
export function trailDuration(keys: readonly MotionKey[]): number {
  let travel = 0
  for (let i = 1; i < keys.length; i++) {
    travel += Math.hypot(keys[i].x - keys[i - 1].x, keys[i].y - keys[i - 1].y)
  }
  return Math.round(Math.min(1500, Math.max(600, 500 + travel * 110)))
}

/** Is this trail from a later Navigation Segment than `seen`? Scrubbing backward must not replay moves. */
export function trailIsNewer(trail: MoveTrail, seen: { round: number; phase: string } | undefined): boolean {
  if (!seen) return true
  if (trail.round !== seen.round) return trail.round > seen.round
  return trail.phase > seen.phase
}
