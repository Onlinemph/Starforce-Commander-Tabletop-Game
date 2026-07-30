import { rollDie, type Rng } from './dice'
import { distanceToSegment } from './geometry'
import type { ShipState } from './shipState'
import type { Point, SystemKind } from './types'

/**
 * Nebulae (K4) and gas clouds (K5), from Expansion 3.
 *
 * A nebula covers the whole play area and has no counter (K4.1.1); a gas cloud
 * is a denser patch drawn as a counter (K5). Their effects are the same list —
 * K5.2.4 sends gas clouds straight back to the Common Nebula Effects of K4.2 —
 * so the two share this module, differing only in extent and safe speed.
 */

/** Terrain a ship can be inside: gas clouds, or the whole map in a nebula. */
export interface CloudFeature {
  id: string
  name: string
  center: Point
  radius: number
  /** Information points needed to detect a hidden unit inside (K5.2.3). */
  scan?: number
}

/**
 * Which Common Nebula Effects (K4.2) a scenario is using. "Specific scenarios
 * may alter the effects of a nebula" (K4.2), and K5.2.4 asks players to agree
 * which apply inside a gas cloud, so each is switchable. Everything except
 * turbulence is on by default, because K4.2.5 is the one marked `(Optional)`.
 */
export interface NebulaEffects {
  /** K4.2.1 — blue and green shield boxes are ignored. */
  shieldsInoperative: boolean
  /** K4.2.3 — targets are not easier to hit at low speed. */
  noLowSpeedPenalty: boolean
  /** K4.2.4 — SCNC, TRAN and TRAC need GEN SYS at MAX to work. */
  systemsHampered: boolean
  /** K4.2.6 — all weapon fire uses degraded fire control. */
  degradedFireControl: boolean
  /** K4.2.7 — no FTL into, out of, or within. */
  noFtl: boolean
  /** K4.2.5 (Optional) — a ship may be pushed 30° off course in Phase 3. */
  turbulence: boolean
}

export const STANDARD_NEBULA_EFFECTS: NebulaEffects = {
  shieldsInoperative: true,
  noLowSpeedPenalty: true,
  systemsHampered: true,
  degradedFireControl: true,
  noFtl: true,
  turbulence: false,
}

/** Maximum speed before a nebula starts tearing at the hull (K4.2.2). */
export const NEBULA_SAFE_SPEED = 2

/** Gas clouds are denser, so the safe speed drops to 1 (K5.2.1). */
export const GAS_CLOUD_SAFE_SPEED = 1

/** Systems a nebula hampers unless GEN SYS is at MAX (K4.2.4). */
export const HAMPERED_SYSTEMS: readonly SystemKind[] = ['SCNC', 'TRAN', 'TRAC']

// ---------------------------------------------------------------------------
// Extent
// ---------------------------------------------------------------------------

/**
 * A ship's base overlaps the counter (K5.1.2). Counters are 1.5 inches, so a
 * ship is inside once its centre comes within the cloud's radius plus half a
 * counter.
 */
export const COUNTER_RADIUS = 0.75

export function insideCloud(cloud: CloudFeature, position: Point): boolean {
  return Math.hypot(position.x - cloud.center.x, position.y - cloud.center.y) <= cloud.radius + COUNTER_RADIUS
}

export function cloudAt(clouds: readonly CloudFeature[], position: Point): CloudFeature | null {
  return clouds.find((cloud) => insideCloud(cloud, position)) ?? null
}

/** Does a line of sight cross a gas cloud? (K5.2.5 case 1) */
export function losCrossesCloud(clouds: readonly CloudFeature[], a: Point, b: Point): boolean {
  return clouds.some((cloud) => distanceToSegment(cloud.center, a, b) <= cloud.radius)
}

// ---------------------------------------------------------------------------
// Conditions on one ship
// ---------------------------------------------------------------------------

export interface CloudConditions {
  /** The whole map is a nebula (K4.1.1). */
  nebula: boolean
  clouds: readonly CloudFeature[]
  effects: NebulaEffects
}

export const NO_CLOUDS: CloudConditions = {
  nebula: false,
  clouds: [],
  effects: STANDARD_NEBULA_EFFECTS,
}

/** Is this ship subject to nebula effects — in the nebula, or in a cloud? */
export function underCloudEffects(conditions: CloudConditions, ship: ShipState): boolean {
  return conditions.nebula || cloudAt(conditions.clouds, ship.placement.position) !== null
}

/**
 * Safe speed where the ship currently is (K4.2.2, K5.2.1). A gas cloud inside a
 * nebula is the denser region, so the lower limit wins. `Infinity` in clear
 * space, where neither rule applies.
 */
export function safeSpeed(conditions: CloudConditions, position: Point): number {
  if (cloudAt(conditions.clouds, position)) return GAS_CLOUD_SAFE_SPEED
  if (conditions.nebula) return NEBULA_SAFE_SPEED
  return Infinity
}

/** Blue dice rolled for travelling too fast, one per point over (K4.2.2). */
export function overspeedDice(conditions: CloudConditions, ship: ShipState): number {
  const limit = safeSpeed(conditions, ship.placement.position)
  if (limit === Infinity) return 0
  return Math.max(0, Math.abs(ship.speed) - limit)
}

/** Blue and green shield boxes are ignored inside (K4.2.1). */
export function shieldsInoperative(conditions: CloudConditions, ship: ShipState): boolean {
  return conditions.effects.shieldsInoperative && underCloudEffects(conditions, ship)
}

/** Slow targets gain nothing from being slow (K4.2.3). */
export function lowSpeedPenaltyNegated(conditions: CloudConditions, target: ShipState): boolean {
  return conditions.effects.noLowSpeedPenalty && underCloudEffects(conditions, target)
}

/**
 * SCNC, TRAN and TRAC "will not function at normal power" unless GEN SYS is set
 * to MAX (K4.2.4). Read as: inside a cloud those systems are off unless the
 * ship is running GEN SYS at MAX, which restores them to normal.
 */
export function systemIsHampered(
  conditions: CloudConditions,
  ship: ShipState,
  kind: SystemKind,
): boolean {
  if (!conditions.effects.systemsHampered) return false
  if (!HAMPERED_SYSTEMS.includes(kind)) return false
  if (!underCloudEffects(conditions, ship)) return false
  return ship.genSysLevel !== 'max'
}

/** No FTL into, out of or inside a nebula, including to disengage (K4.2.7). */
export function ftlBlocked(conditions: CloudConditions, ship: ShipState): boolean {
  return conditions.effects.noFtl && underCloudEffects(conditions, ship)
}

/**
 * Whether a volley must use degraded fire control because of the clouds
 * (K4.2.6, K5.2.5).
 *
 * K5.2.5 lists four cases for gas clouds — line of sight crossing a cloud,
 * shooting out of one, shooting into one, and both ships inside — which
 * together mean any cloud anywhere on the firing line degrades the shot.
 */
export function degradedByClouds(
  conditions: CloudConditions,
  attacker: ShipState,
  target: ShipState,
): boolean {
  if (!conditions.effects.degradedFireControl) return false
  if (conditions.nebula) return true
  const a = attacker.placement.position
  const b = target.placement.position
  return (
    cloudAt(conditions.clouds, a) !== null ||
    cloudAt(conditions.clouds, b) !== null ||
    losCrossesCloud(conditions.clouds, a, b)
  )
}

// ---------------------------------------------------------------------------
// Turbulence (K4.2.5, optional)
// ---------------------------------------------------------------------------

/**
 * Turbulence check made after movement in Phase 3 (K4.2.5): roll one red and
 * one green die. A MISS on the red turns the ship 30° right, a MISS on the
 * green 30° left, and a MISS on both cancels out. Every other face is ignored.
 *
 * Returns the heading change in degrees.
 */
export function turbulenceTurn(rng: Rng): number {
  const right = rollDie('red', rng).face === '-'
  const left = rollDie('green', rng).face === '-'
  if (right === left) return 0 // both, or neither
  return right ? 30 : -30
}
