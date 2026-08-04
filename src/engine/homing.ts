import { hasTrait, traitValue } from './combat'
import { FACE_DAMAGE, rollDice, type DieRoll, type Rng } from './dice'
import { actualRange, arcTo, bearing, distance, shieldsFacing, translate } from './geometry'
import type { ShipState } from './shipState'
import type { Arc, Placement, Point, RangeBracketDef, ShieldSide, WeaponSystemDef } from './types'

/**
 * Homing Weapons (E5, Expansion 5).
 *
 * A homing weapon is a counter that moves on the map toward its target, one
 * leg per combat phase, until it hits or runs out of endurance. Its firing
 * chart is divided into thick red boxes, one per phase of flight (E5.1.5): the
 * widest bracket in box *n* is how far it travels during phase *n*, and the
 * bracket the target actually falls into decides the dice.
 */

/** Counters are three-quarters of an inch square (E5.1.9). */
export const HOMING_COUNTER_SIZE = 0.75

// ---------------------------------------------------------------------------
// Weapon classification (F1.10, F1.13, F1.16)
// ---------------------------------------------------------------------------

export function isHoming(weapon: WeaponSystemDef): boolean {
  return hasTrait(weapon, 'HOMING')
}

/** F1.13 — a missile; `MISL X` is the damage that destroys one. */
export function isMissile(weapon: WeaponSystemDef): boolean {
  return hasTrait(weapon, 'MISL')
}

/** F1.16 — a particle weapon, whose damage is worn down rather than stopped. */
export function isParticle(weapon: WeaponSystemDef): boolean {
  return hasTrait(weapon, 'PARTCL')
}

/**
 * Damage needed to destroy one missile (F13.2). Missiles without a printed
 * value take one point, which is the least a counter can absorb.
 */
export function missileHitPoints(weapon: WeaponSystemDef): number {
  return Math.max(1, traitValue(weapon, 'MISL') ?? 1)
}

/** Endurance in phases — the number of red boxes on the chart (E5.1.5). */
export function endurance(weapon: WeaponSystemDef): number {
  return weapon.brackets.reduce((max, b) => Math.max(max, b.endurancePhase ?? 0), 0)
}

/**
 * How far the weapon travels during a given phase of flight: the widest bracket
 * inside that phase's red box (E5.1.5).
 */
export function speedInPhase(weapon: WeaponSystemDef, phase: number): number {
  const inBox = weapon.brackets.filter((b) => b.endurancePhase === phase)
  return inBox.reduce((max, b) => Math.max(max, b.max), 0)
}

/**
 * The bracket a hit is resolved on: within the current phase's red box, the one
 * whose range covers the distance to the target (E5.1.5).
 */
export function bracketForImpact(
  weapon: WeaponSystemDef,
  phase: number,
  range: number,
): RangeBracketDef | null {
  const inBox = weapon.brackets.filter((b) => b.endurancePhase === phase)
  return inBox.find((b) => range >= b.min && range <= b.max) ?? null
}

// ---------------------------------------------------------------------------
// In-flight state
// ---------------------------------------------------------------------------

export interface HomingWeapon {
  id: string
  /** Ship that launched it, for ownership and faction (E5.2.6). */
  ownerId: string
  side: string
  weaponId: string
  weaponName: string
  targetId: string
  position: Point
  /** Flight phases completed. The launch phase does not count (E5.1.6). */
  phasesFlown: number
  /** Cap set at launch; it may be flown slower than maximum (E5.2.5). */
  maxSpeed: number
  /** Damage taken from defensive and offensive fire (F13.2, F1.16.1). */
  damage: number
  /** Held by a tractor beam and going nowhere (E5.4 Step 6). */
  tractored: boolean
  destroyed: boolean
  /** Set once it has struck, so it is removed after the volley. */
  impacted: boolean
  /**
   * A shield the rules name outright rather than deriving from geometry: a
   * head-on interception or an overflight always lands on the leading facing
   * (E5.9.1, E5.9.2), whatever the counters look like afterwards.
   */
  forcedShield?: ShieldSide
}

let sequence = 0

export function launchHomingWeapon(args: {
  launcher: ShipState
  weapon: WeaponSystemDef
  target: ShipState
  arc: Arc
  /** Reduced top speed, for launching into a nebula or asteroids (E5.2.5). */
  maxSpeed?: number
}): HomingWeapon {
  const { launcher, weapon, target, arc } = args
  return {
    id: `hw-${++sequence}`,
    ownerId: launcher.id,
    side: launcher.side,
    weaponId: weapon.id,
    weaponName: weapon.name,
    targetId: target.id,
    // E5.2.8: the counter is placed flush against the side of the launching
    // ship's counter that the firing arc covers.
    position: launchPoint(launcher.placement, arc),
    phasesFlown: 0,
    maxSpeed: args.maxSpeed ?? Infinity,
    damage: 0,
    tractored: false,
    destroyed: false,
    impacted: false,
  }
}

/** Reset the counter numbering; tests rely on stable ids. */
export function resetHomingIds(): void {
  sequence = 0
}

/** Which side of the launching ship's counter the weapon appears on (E5.2.8). */
export function launchPoint(placement: Placement, arc: Arc): Point {
  const offsets: Record<ShieldSide, number> = { F: 0, S: 90, A: 180, P: 270 }
  const side = SIDE_FOR_ARC[arc]
  return translate(placement.position, placement.heading + offsets[side], HOMING_COUNTER_SIZE)
}

const SIDE_FOR_ARC: Record<Arc, ShieldSide> = {
  FS: 'F',
  FP: 'F',
  SF: 'S',
  SA: 'S',
  AS: 'A',
  AP: 'A',
  PA: 'P',
  PF: 'P',
}

// ---------------------------------------------------------------------------
// Movement (E5.3)
// ---------------------------------------------------------------------------

/** Distance this weapon covers in its next phase (E5.1.5, E5.2.5, E5.10.1). */
export function nextLegDistance(
  hw: HomingWeapon,
  weapon: WeaponSystemDef,
  jammingPenalty = 0,
): number {
  const phase = hw.phasesFlown + 1
  const base = Math.min(speedInPhase(weapon, phase), hw.maxSpeed)
  // E5.10.1: jamming never slows the first leg, only the ones after it.
  const slowed = phase === 1 ? base : Math.max(0, base - jammingPenalty)
  return slowed
}

export function outOfEndurance(hw: HomingWeapon, weapon: WeaponSystemDef): boolean {
  return hw.phasesFlown >= endurance(weapon)
}

export interface MoveResult {
  /** True when the weapon reached its target and will resolve an impact. */
  impact: boolean
  /** Distance actually flown. */
  flown: number
  /** Shield the impact strikes, when it impacts (E5.4 Step 2). */
  side?: ShieldSide
  /** Removed for running out of endurance (E5.1.6). */
  expired: boolean
}

/**
 * Move one homing weapon after its target has moved (E5.3.3, E5.3.4).
 *
 * If the target is within the leg's range the weapon closes and impacts;
 * otherwise it flies the full leg straight at the target, which satisfies both
 * "must move closer" and "must move at maximum speed" (E5.3.4).
 */
export function moveHomingWeapon(
  hw: HomingWeapon,
  weapon: WeaponSystemDef,
  target: ShipState,
  jammingPenalty = 0,
): MoveResult {
  if (hw.destroyed || hw.impacted) return { impact: false, flown: 0, expired: false }
  if (hw.tractored) return { impact: false, flown: 0, expired: false }
  if (outOfEndurance(hw, weapon)) return { impact: false, flown: 0, expired: true }

  const leg = nextLegDistance(hw, weapon, jammingPenalty)
  hw.phasesFlown += 1

  const gap = distance(hw.position, target.placement.position)
  // E1.1.1: a range of N reaches anything up to N.99 inches away.
  if (Math.floor(gap) <= leg) {
    // E5.4 Step 2 draws the line from where the weapon is *now* to the target's
    // centre, so the shield has to be read before the counter is moved. The
    // counter then sits flush against the shield it struck.
    const side = shieldsFacing(hw.position, target.placement.position, target.placement.heading)[0]
    hw.position = translate(
      target.placement.position,
      bearing(target.placement.position, hw.position),
      HOMING_COUNTER_SIZE,
    )
    hw.impacted = true
    return { impact: true, flown: gap, side, expired: false }
  }

  const heading = bearing(hw.position, target.placement.position)
  hw.position = translate(hw.position, heading, leg)
  return { impact: false, flown: leg, expired: false }
}

/** Shield struck by an impact, drawn from the weapon's counter (E5.4 Step 2). */
export function impactShield(hw: HomingWeapon, target: ShipState): ShieldSide {
  return shieldsFacing(hw.position, target.placement.position, target.placement.heading)[0]
}

/** Both 45° arcs that define the struck shield may answer with point defense (E5.4 Step 2). */
export function defendingArcs(hw: HomingWeapon, target: ShipState): Arc[] {
  return arcTo(target.placement.position, target.placement.heading, hw.position)
}

// ---------------------------------------------------------------------------
// Unusual situations (E5.9)
// ---------------------------------------------------------------------------

/**
 * A head-on attack resolves *before* the target moves (E5.9.1): if the weapon
 * lies in the arc the target is travelling into and is no further away than the
 * target's speed, the target would otherwise fly past and be hit in the back.
 */
export function isHeadOn(hw: HomingWeapon, target: ShipState): boolean {
  if (target.speed === 0) return false
  // Reverse makes the aft arc the leading one (E5.9.1).
  const facing = target.speed < 0 ? target.placement.heading + 180 : target.placement.heading
  const arcs = arcTo(target.placement.position, facing, hw.position)
  const ahead = arcs.some((a) => a === 'FS' || a === 'FP')
  if (!ahead) return false
  return actualRange(target.placement.position, hw.position) <= Math.abs(target.speed)
}

/**
 * A target that flies over a homing weapon's counter is hit as it passes
 * (E5.9.2) — on the front shield going forward, the aft shield in reverse.
 */
export function overflies(path: readonly Point[], hw: HomingWeapon): boolean {
  const reach = HOMING_COUNTER_SIZE + 0.75 // homing counter plus half a ship counter
  return path.some((p) => distance(p, hw.position) <= reach)
}

export function overflightShield(target: ShipState): ShieldSide {
  return target.speed < 0 ? 'A' : 'F'
}

// ---------------------------------------------------------------------------
// Impact damage (E5.4 Step 7, F1.16)
// ---------------------------------------------------------------------------

export interface HomingVolley {
  weapons: HomingWeapon[]
  side: ShieldSide
  rolls: DieRoll[]
  standard: number
  leak: number
  structure: number
  /** Damage the volley soaked up before impact, for particle weapons (F1.16.1). */
  absorbed: number
}

/**
 * Roll a homing volley's damage (E5.4 Step 7) and, for particle weapons, wear
 * it down by the fire it took on the way in (F1.16.2).
 *
 * The reduction eats standard damage first, then leak, then `STR +X`; if all
 * three reach zero the volley is destroyed and its special effects are ignored
 * (F1.16.2 steps 5–8).
 */
export function resolveHomingVolley(
  weapons: readonly HomingWeapon[],
  def: WeaponSystemDef,
  side: ShieldSide,
  phase: number,
  range: number,
  rng: Rng,
): HomingVolley {
  const live = weapons.filter((w) => !w.destroyed && !w.tractored)
  const bracket = bracketForImpact(def, phase, range)
  const colors = bracket ? live.flatMap(() => bracket.dice) : []
  const rolls = rollDice(colors, rng)
  const bonus = bracket?.bonus ?? 0

  let standard = 0
  let leak = 0
  let structure = 0
  for (const die of rolls) {
    if (die.face === '-') continue
    if (die.face === 'S') {
      standard += (def.special?.damage ?? 0) + bonus
      leak += def.special?.leak ?? 0
      structure += def.special?.structure ?? 0
    } else {
      standard += FACE_DAMAGE[die.face] + bonus
      if (die.face === 'H') leak += 1
    }
  }

  const absorbed = live.reduce((sum, w) => sum + w.damage, 0)
  if (isParticle(def) && absorbed > 0) {
    // F1.16.2 step 2: every three points taken off one point of damage done.
    let reduction = Math.floor(absorbed / 3)
    const takeFrom = (value: number) => {
      const used = Math.min(value, reduction)
      reduction -= used
      return value - used
    }
    standard = takeFrom(standard)
    leak = takeFrom(leak)
    structure = takeFrom(structure)
  }

  return { weapons: [...live], side, rolls, standard, leak, structure, absorbed }
}

/**
 * Apply point defense damage to a volley of homing weapons (E5.4 Steps 4–5).
 *
 * A missile is destroyed once it has taken `MISL X` points and partial damage
 * does nothing (F13.2); a particle weapon is never stopped outright, it just
 * arrives weaker (F1.16.1). The defender assigns the points, so damage is
 * poured into one weapon at a time — finishing a missile beats spreading.
 */
export function applyDefensiveFire(
  weapons: HomingWeapon[],
  def: WeaponSystemDef,
  damage: number,
): { destroyed: HomingWeapon[]; absorbed: number } {
  const destroyed: HomingWeapon[] = []
  let left = damage
  const threshold = missileHitPoints(def)

  for (const hw of weapons) {
    if (left <= 0) break
    if (hw.destroyed || hw.tractored) continue
    if (isMissile(def)) {
      const needed = threshold - hw.damage
      const spend = Math.min(left, needed)
      hw.damage += spend
      left -= spend
      if (hw.damage >= threshold) {
        hw.destroyed = true
        destroyed.push(hw)
      }
    } else {
      // Particle weapons soak everything thrown at them (F1.16.1).
      hw.damage += left
      left = 0
    }
  }
  return { destroyed, absorbed: damage - left }
}

/** One tractor beam holds one missile; particle weapons cannot be held (E5.4 Step 6). */
export function tractorHomingWeapon(hw: HomingWeapon, def: WeaponSystemDef): string | null {
  if (!isMissile(def)) {
    return 'Tractor beams may not be used against particle weapons (E5.4 Step 6).'
  }
  if (hw.destroyed) return 'That weapon has already been destroyed.'
  hw.tractored = true
  return null
}

/**
 * Jamming slows a homing weapon rather than shortening its range (E5.10.1).
 * Optional; returns the speed reduction from the second leg onward.
 */
export function jammingPenalty(target: ShipState, launcher: ShipState): number {
  return Math.max(0, target.sensors.jamming - launcher.sensors.targeting)
}
