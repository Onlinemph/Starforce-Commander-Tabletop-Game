import type { Arc, Maneuver, Placement, Point, ShieldSide, TurnDirection } from './types'

export type { Placement }

/**
 * Table geometry: ranges, firing arcs, and the physical turn-template
 * maneuvers (E1, E2, C2, C3).
 *
 * Convention: headings are in degrees, 0 = "up" the map (north / facing 8 on
 * the scenario compass rose, S2.5.2), increasing clockwise. Distances are in
 * inches, matching the rulebook's standard unit (A2.4).
 */

export const TAU = Math.PI * 2

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

export function rad2deg(r: number): number {
  return (r * 180) / Math.PI
}

/** Normalise a heading into [0, 360). */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Unit vector pointing along `heading`. */
export function headingVector(heading: number): Point {
  const r = deg2rad(heading)
  return { x: Math.sin(r), y: -Math.cos(r) }
}

export function translate(p: Point, heading: number, distance: number): Point {
  const v = headingVector(heading)
  return { x: p.x + v.x * distance, y: p.y + v.y * distance }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ---------------------------------------------------------------------------
// Range (E1)
// ---------------------------------------------------------------------------

/**
 * Actual range, centre point to centre point, fractions rounded down (E1.1.1).
 *
 * "If the range is from 0 to .99 inches, the range is zero."
 */
export function actualRange(a: Point, b: Point): number {
  return Math.floor(distance(a, b))
}

/**
 * Effective range (H2.3.3): actual + target jamming − attacker targeting.
 * Targeting can drive this to zero but never below (H2.3.8).
 */
export function effectiveRange(actual: number, jamming: number, targeting: number): number {
  return Math.max(0, actual + jamming - targeting)
}

// ---------------------------------------------------------------------------
// Firing arcs (E2.2)
// ---------------------------------------------------------------------------

/**
 * The eight 45-degree arcs, listed clockwise from dead ahead. Each entry is the
 * arc's start angle relative to the ship's facing; the arc spans 45 degrees.
 */
export const ARC_ORDER: readonly Arc[] = ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP']

/** Start angle (relative bearing) of each arc. */
export const ARC_START: Record<Arc, number> = {
  FS: 0,
  SF: 45,
  SA: 90,
  AS: 135,
  AP: 180,
  PA: 225,
  PF: 270,
  FP: 315,
}

/** Which shield covers each arc (G1.1.1). */
export const ARC_SHIELD: Record<Arc, ShieldSide> = {
  FP: 'F',
  FS: 'F',
  SF: 'S',
  SA: 'S',
  AP: 'A',
  AS: 'A',
  PF: 'P',
  PA: 'P',
}

/** The two arcs each shield protects. */
export const SHIELD_ARCS: Record<ShieldSide, Arc[]> = {
  F: ['FP', 'FS'],
  S: ['SF', 'SA'],
  A: ['AP', 'AS'],
  P: ['PF', 'PA'],
}

/** Bearing of `target` as seen from `origin`, relative to `originHeading`. */
export function relativeBearing(origin: Point, originHeading: number, target: Point): number {
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const absolute = rad2deg(Math.atan2(dx, -dy))
  return normalizeHeading(absolute - originHeading)
}

const ARC_EPSILON = 1e-9

/**
 * The arc a bearing falls in. Returns both arcs when the bearing lands exactly
 * on an arc boundary — the rules make that a player choice, not a default
 * (E2.2.5 Ambiguous Arcs).
 */
export function arcsForBearing(bearing: number): Arc[] {
  const b = normalizeHeading(bearing)
  const onBoundary = Math.abs(b % 45) < ARC_EPSILON || Math.abs((b % 45) - 45) < ARC_EPSILON
  if (onBoundary) {
    const index = Math.round(b / 45) % 8
    const prev = (index + 7) % 8
    return [ARC_ORDER[prev], ARC_ORDER[index]]
  }
  return [ARC_ORDER[Math.floor(b / 45) % 8]]
}

/** Arc(s) of `origin` that `target` sits in (E2.2.3). */
export function arcTo(origin: Point, originHeading: number, target: Point): Arc[] {
  return arcsForBearing(relativeBearing(origin, originHeading, target))
}

/**
 * Shield(s) of the target struck by fire from `attacker` (E2.2.4). Two entries
 * mean the line of sight runs down a shield boundary and the *defender*
 * chooses (E2.2.5).
 */
export function shieldsFacing(
  attacker: Point,
  target: Point,
  targetHeading: number,
): ShieldSide[] {
  const arcs = arcTo(target, targetHeading, attacker)
  const sides = arcs.map((a) => ARC_SHIELD[a])
  return [...new Set(sides)]
}

/** True if any mount arc is one of the arcs the target sits in. */
export function canBearOn(mountArcs: readonly Arc[], targetArcs: readonly Arc[]): boolean {
  return targetArcs.some((a) => mountArcs.includes(a))
}

// ---------------------------------------------------------------------------
// Line of sight (E2.3, K3.1.3)
// ---------------------------------------------------------------------------

export interface CircleObstacle {
  center: Point
  radius: number
  /** Planets and moons block line of sight; asteroid fields only obstruct. */
  blocksLos: boolean
}

/** Shortest distance from `p` to segment `ab`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distance(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/**
 * Line of sight between two ships (E2.3.1). A ship overlapping a planet can see
 * past it — treat it as passing over the body (K3.1.3).
 */
export function hasLineOfSight(a: Point, b: Point, obstacles: CircleObstacle[]): boolean {
  return !obstacles.some((o) => {
    if (!o.blocksLos) return false
    if (distance(a, o.center) <= o.radius) return false
    if (distance(b, o.center) <= o.radius) return false
    return distanceToSegment(o.center, a, b) < o.radius
  })
}

// ---------------------------------------------------------------------------
// Maneuvers (C2, C3)
// ---------------------------------------------------------------------------

export interface ManeuverInput {
  start: Placement
  /** Speed in inches for this combat phase. Negative means reverse (C3.7). */
  speed: number
  maneuver: Maneuver
  direction: TurnDirection | null
  /**
   * Turn template in degrees for the ship's current speed, from the TURN line
   * (C2.2.2). `0` means the ship may not turn at this speed.
   */
  turnTemplate: number
  /** Half-inch slide rather than a full inch (C2.4.1). */
  halfSlide?: boolean
  /** Perform the slide before moving forward rather than after (C2.4.1). */
  slideFirst?: boolean
}

export interface ManeuverResult {
  end: Placement
  /** Sampled positions along the path, for terrain overlap checks (K1.3.1). */
  path: Point[]
  /** Stress points generated by the maneuver itself (C3.1.2). */
  stress: number
  /** Set when the plot was illegal; the ship moves straight instead (C1.1.2). */
  illegal?: string
}

function turnSign(direction: TurnDirection | null): number {
  return direction === 'left' ? -1 : 1
}

/**
 * Execute a plotted maneuver.
 *
 * Turns are performed by moving forward then pivoting by the turn template
 * (C2.2.3). Multi-part maneuvers split the movement in half and pivot between
 * the halves (C3.2.2, C3.3.2, C3.4.1, C3.5.6).
 */
export function applyManeuver(input: ManeuverInput): ManeuverResult {
  const { start, speed, maneuver, direction, turnTemplate } = input
  const path: Point[] = [start.position]

  // Reverse movement treats the stern as the bow (C3.7.2).
  const travelHeading = speed < 0 ? normalizeHeading(start.heading + 180) : start.heading
  const travelDistance = Math.abs(speed)

  const straight = (): ManeuverResult => {
    const end = translate(start.position, travelHeading, travelDistance)
    path.push(end)
    return { end: { position: end, heading: start.heading }, path, stress: 0 }
  }

  const illegal = (reason: string): ManeuverResult => ({ ...straight(), illegal: reason })

  // A turn plotted at a speed whose TURN entry is 0 is an illegal plot, and the
  // ship simply moves forward at its current speed (C1.1.2, C2.2.2).
  const isTurn =
    maneuver === 'standard' ||
    maneuver === 'easy' ||
    maneuver === 'hard' ||
    maneuver === 's-turn' ||
    maneuver === 'snap'
  if (isTurn && turnTemplate === 0) {
    return illegal('Ship may not turn at this speed (TURN 0).')
  }
  if (isTurn && direction === null) {
    return illegal('Turn plotted with no direction.')
  }

  const sign = turnSign(direction)
  // Easy turns always use the 20-degree template regardless of the ship's
  // maximum turn rate (C2.3.2).
  const template = maneuver === 'easy' ? 20 : turnTemplate

  switch (maneuver) {
    case 'straight':
      return straight()

    case 'slide': {
      // The ship shifts perpendicular without changing facing (C2.4.2).
      if (speed === 0) return illegal('No ship may perform a Slide at speed zero (C2.4.2).')
      const shift = input.halfSlide ? 0.5 : 1
      const shiftHeading = normalizeHeading(start.heading + 90 * sign)
      let pos = start.position
      if (input.slideFirst) {
        pos = translate(pos, shiftHeading, shift)
        path.push(pos)
        pos = translate(pos, travelHeading, travelDistance)
      } else {
        pos = translate(pos, travelHeading, travelDistance)
        path.push(pos)
        pos = translate(pos, shiftHeading, shift)
      }
      path.push(pos)
      return { end: { position: pos, heading: start.heading }, path, stress: 0 }
    }

    case 'easy':
    case 'standard': {
      // Move forward, then pivot (C2.2.3).
      const pos = translate(start.position, travelHeading, travelDistance)
      path.push(pos)
      return {
        end: { position: pos, heading: normalizeHeading(start.heading + template * sign) },
        path,
        stress: 0,
      }
    }

    case 'snap': {
      // Half movement, one standard turn, then the remaining half (C3.4.1).
      const half = travelDistance / 2
      const mid = translate(start.position, travelHeading, half)
      path.push(mid)
      const heading = normalizeHeading(start.heading + template * sign)
      const end = translate(mid, speed < 0 ? normalizeHeading(heading + 180) : heading, half)
      path.push(end)
      return { end: { position: end, heading }, path, stress: 1 }
    }

    case 'hard': {
      // Two standard turns in the same direction (C3.2.2).
      const half = travelDistance / 2
      const mid = translate(start.position, travelHeading, half)
      path.push(mid)
      const heading1 = normalizeHeading(start.heading + template * sign)
      const end = translate(mid, speed < 0 ? normalizeHeading(heading1 + 180) : heading1, half)
      path.push(end)
      return {
        end: { position: end, heading: normalizeHeading(heading1 + template * sign) },
        path,
        stress: 1,
      }
    }

    case 's-turn': {
      // Two standard turns in opposite directions (C3.3.2).
      const half = travelDistance / 2
      const mid = translate(start.position, travelHeading, half)
      path.push(mid)
      const heading1 = normalizeHeading(start.heading + template * sign)
      const end = translate(mid, speed < 0 ? normalizeHeading(heading1 + 180) : heading1, half)
      path.push(end)
      return {
        end: { position: end, heading: normalizeHeading(heading1 - template * sign) },
        path,
        stress: 1,
      }
    }

    case 'em-90':
    case 'em-180': {
      // Half movement, pivot in place, remaining half (C3.5.6). The 180 adds a
      // second 90-degree pivot in the same direction (C3.5.7).
      if (direction === null) return illegal('Emergency turn plotted with no direction.')
      const half = travelDistance / 2
      const mid = translate(start.position, travelHeading, half)
      path.push(mid)
      let heading = normalizeHeading(start.heading + 90 * sign)
      const end = translate(mid, speed < 0 ? normalizeHeading(heading + 180) : heading, half)
      path.push(end)
      if (maneuver === 'em-180') heading = normalizeHeading(heading + 90 * sign)
      return { end: { position: end, heading }, path, stress: emergencyTurnStress(maneuver, speed) }
    }
  }
}

/**
 * A 90-degree emergency turn costs stress equal to speed, minimum 1; the
 * 180-degree version costs twice speed, minimum 2 (C3.5.8, C3.5.9).
 */
export function emergencyTurnStress(maneuver: Maneuver, speed: number): number {
  const s = Math.abs(speed)
  if (maneuver === 'em-90') return Math.max(1, s)
  if (maneuver === 'em-180') return Math.max(2, s * 2)
  return 0
}

/** Stress caused purely by the maneuver, before acceleration stress (C3.1). */
export function maneuverStress(maneuver: Maneuver, speed: number): number {
  switch (maneuver) {
    case 'hard':
    case 's-turn':
    case 'snap':
      return 1
    case 'em-90':
    case 'em-180':
      return emergencyTurnStress(maneuver, speed)
    default:
      return 0
  }
}
