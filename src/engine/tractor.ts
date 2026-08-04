import type { Rng } from './dice'
import { rollDie } from './dice'
import { actualRange } from './geometry'
import { systemPower, type PowerLevel } from './operations'
import { undamagedSystemBoxes, type ShipState } from './shipState'
import type { DieFace, Point, SystemKind } from './types'

/**
 * Tractor beams (J3).
 *
 * A beam is one undamaged TRAC box (J3.1.2). Locks are rolled on blue dice, and
 * what counts as a lock differs by what is being grabbed: a small target needs
 * one die to come up L or M, while a starship needs the *total* damage result
 * across every die committed to beat its size class.
 */

/** Beam range at normal and maximum power (J3.1.3). */
export const TRACTOR_RANGE: Record<'nrm' | 'max', number> = { nrm: 1, max: 2 }

/** A ship may be displaced one inch in any direction (J3.5.2). */
export const DISPLACE_DISTANCE = 1

export type TractorTargetKind = 'ship' | 'small'

export interface TractorLink {
  id: string
  /** The ship working the beam — J3's "tractoring ship". */
  sourceId: string
  targetId: string
  targetKind: TractorTargetKind
  /**
   * Beams committed. Only one is needed to *hold* a target once the lock is
   * made, so the rest are free again next phase (J3.3.3).
   */
  beams: number
  power: 'nrm' | 'max'
}

export function tractorBeams(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'TRAC')
}

/** Beams already committed to a link this phase. */
export function beamsInUse(links: TractorLink[], shipId: string): number {
  return links.filter((l) => l.sourceId === shipId).reduce((n, link) => n + link.beams, 0)
}

export function beamsAvailable(ship: ShipState, links: TractorLink[]): number {
  return Math.max(0, tractorBeams(ship) - beamsInUse(links, ship.id))
}

export function tractorPower(ship: ShipState, maxSystem: SystemKind | null): 'nrm' | 'max' {
  return systemPower(ship, 'TRAC', maxSystem) === 'max' ? 'max' : 'nrm'
}

export function tractorReach(power: 'nrm' | 'max'): number {
  return TRACTOR_RANGE[power]
}

export function linksHolding(links: TractorLink[], targetId: string): TractorLink[] {
  return links.filter((l) => l.targetId === targetId)
}

export function linkBetween(links: TractorLink[], sourceId: string, targetId: string): TractorLink | undefined {
  return links.find((l) => l.sourceId === sourceId && l.targetId === targetId)
}

// ---------------------------------------------------------------------------
// Lock-on rolls
// ---------------------------------------------------------------------------

/**
 * A blue die's "damage result" when rolling for a lock: miss 0, light 2,
 * medium 3 (J3.3.1). Nothing is damaged — the number only decides the lock.
 */
export const LOCK_VALUE: Record<DieFace, number> = { '-': 0, L: 2, M: 3, H: 3, S: 3 }

export interface LockResult {
  faces: DieFace[]
  /** Summed damage result, doubled at MAX power (J3.3.1). */
  total: number
  /** The number that had to be met, for starships. */
  required: number
  locked: boolean
}

/**
 * Lock onto a starship (J3.3.1): roll one blue die per beam, add the damage
 * results, double them at MAX power, and compare against the target's size
 * class. Jamming and targeting have no effect on any of it.
 */
export function lockOnStarship(
  rng: Rng,
  beams: number,
  power: 'nrm' | 'max',
  targetSizeClass: number,
): LockResult {
  const faces: DieFace[] = []
  for (let i = 0; i < beams; i += 1) faces.push(rollDie('blue', rng).face)
  const raw = faces.reduce((n, f) => n + LOCK_VALUE[f], 0)
  const total = power === 'max' ? raw * 2 : raw
  return { faces, total, required: targetSizeClass, locked: total >= targetSizeClass }
}

/**
 * Lock onto a small target (J3.2.1): any single die coming up L or M is enough,
 * however many beams are pointed at it.
 */
export function lockOnSmall(rng: Rng, beams: number): LockResult {
  const faces: DieFace[] = []
  for (let i = 0; i < beams; i += 1) faces.push(rollDie('blue', rng).face)
  const locked = faces.some((f) => f === 'L' || f === 'M')
  return { faces, total: faces.reduce((n, f) => n + LOCK_VALUE[f], 0), required: 0, locked }
}

/** Why a lock-on may not be attempted, or `null` if it may. */
export function lockRefusal(
  source: ShipState,
  targetPosition: Point,
  links: TractorLink[],
  power: 'nrm' | 'max',
  beams: number,
): string | null {
  if (tractorBeams(source) === 0) return `${source.name} has no undamaged TRAC boxes (J3.1.2).`
  const free = beamsAvailable(source, links)
  if (beams > free) {
    return `${source.name} has ${free} free tractor beam(s); the rest are holding something (J3.2.4).`
  }
  if (beams < 1) return 'No tractor beams committed.'
  const range = actualRange(source.placement.position, targetPosition)
  const reach = tractorReach(power)
  if (range > reach) {
    return `Target is ${range}" away; the beam reaches ${reach}" at ${power.toUpperCase()} power (J3.1.3).`
  }
  return null
}

// ---------------------------------------------------------------------------
// J3.3.4 — speed while linked
// ---------------------------------------------------------------------------

/**
 * The Tractor Link Speed Adjustment Chart, indexed by current speed 0–8.
 *
 * Columns are the size of the *other* ship relative to this one: two or more
 * classes smaller, similar (within one), or two or more classes larger. Being
 * tied to something big slows you far more than being tied to something small.
 */
const LINK_SPEED_CHART: Record<'smaller' | 'similar' | 'larger', number[]> = {
  smaller: [0, 1, 2, 2, 3, 3, 4, 4, 5],
  similar: [0, 0, 1, 1, 2, 2, 3, 3, 4],
  larger: [0, 0, 0, 0, 1, 1, 2, 2, 3],
}

export function relativeSize(self: number, other: number): 'smaller' | 'similar' | 'larger' {
  const difference = other - self
  if (difference >= 2) return 'larger'
  if (difference <= -2) return 'smaller'
  return 'similar'
}

/**
 * A ship's adjusted speed while held in or working tractor links (J3.3.4).
 *
 * Step 4 cross-indexes the ship's speed against the size of the ship it is
 * linked to; step 5 then takes off one more for every further ship in the
 * group. The chart's own footnote prints −2 for the larger-by-two column, but
 * step 5's procedure says "by 1 … regardless of size", so the procedure wins.
 */
export function adjustedSpeed(
  ship: ShipState,
  links: TractorLink[],
  ships: ShipState[],
  trueSpeed = ship.speed,
): number {
  const partners = linkedPartners(ship.id, links)
  if (partners.length === 0) return trueSpeed

  const sizeOf = (id: string) => ships.find((s) => s.id === id)?.form.sizeClass
  const speed = Math.max(0, Math.min(8, Math.abs(trueSpeed)))

  // Step 2 uses the ship this one is linked to. With several, the largest
  // partner is the one that dominates the tow.
  let column: 'smaller' | 'similar' | 'larger' = 'smaller'
  for (const partnerId of partners) {
    const size = sizeOf(partnerId)
    if (size === undefined) continue
    const relative = relativeSize(ship.form.sizeClass, size)
    if (relative === 'larger') column = 'larger'
    else if (relative === 'similar' && column !== 'larger') column = 'similar'
  }

  const base = LINK_SPEED_CHART[column][speed]
  const extra = Math.max(0, groupSize(ship.id, links) - 2)
  const adjusted = Math.max(0, base - extra)
  return trueSpeed < 0 ? -adjusted : adjusted
}

/** Ships directly linked to this one, in either direction. */
export function linkedPartners(shipId: string, links: TractorLink[]): string[] {
  const partners = new Set<string>()
  for (const link of links) {
    if (link.targetKind !== 'ship') continue
    if (link.sourceId === shipId) partners.add(link.targetId)
    if (link.targetId === shipId) partners.add(link.sourceId)
  }
  return [...partners]
}

/**
 * Every ship tied into the same chain of links, directly or through others —
 * J3.3.4's "whether directly linked or linked to a ship that is linked".
 */
export function linkedGroup(shipId: string, links: TractorLink[]): string[] {
  const seen = new Set([shipId])
  const queue = [shipId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const partner of linkedPartners(current, links)) {
      if (!seen.has(partner)) {
        seen.add(partner)
        queue.push(partner)
      }
    }
  }
  return [...seen]
}

function groupSize(shipId: string, links: TractorLink[]): number {
  return linkedGroup(shipId, links).length
}

/** True while any tractor link holds this ship, in either direction (J3.4.2). */
export function isLinked(shipId: string, links: TractorLink[]): boolean {
  return links.some(
    (l) => l.targetId === shipId || (l.sourceId === shipId && l.targetKind === 'ship'),
  )
}

// ---------------------------------------------------------------------------
// J3.5 — displacement
// ---------------------------------------------------------------------------

/**
 * Whether a beam may shove its target around (J3.5.1). The tractoring ship must
 * be at least the target's size class and running at MAX; and two ships of
 * similar size that have grabbed each other simply hold each other in place.
 */
export function displaceRefusal(
  source: ShipState,
  target: ShipState,
  links: TractorLink[],
  power: 'nrm' | 'max',
): string | null {
  const link = linkBetween(links, source.id, target.id)
  if (!link) return `${source.name} has no tractor lock on ${target.name}.`
  if (power !== 'max') return 'Displacing needs the beam at MAX power (J3.5.1).'
  if (source.form.sizeClass < target.form.sizeClass - 1) {
    return `${source.name} is too small to displace ${target.name} (J3.5.1).`
  }
  const mutual = linkBetween(links, target.id, source.id)
  if (mutual && relativeSize(source.form.sizeClass, target.form.sizeClass) === 'similar') {
    return 'Both ships have each other locked at similar size, so neither may displace the other (J3.5.1).'
  }
  if (mutual && source.form.sizeClass < target.form.sizeClass) {
    return `${target.name} is the larger ship, so only it may displace (J3.5.1).`
  }
  // J3.5.2: the shove happens after both ships have moved, and only if the
  // target is still in the beam once they have.
  const range = actualRange(source.placement.position, target.placement.position)
  const reach = tractorReach(power)
  if (range > reach) {
    return `${target.name} has drifted to ${range}"; the beam reaches ${reach}" (J3.5.2).`
  }
  return null
}

/**
 * Where a displaced ship ends up (J3.5.2): one inch forward, aft, to port or
 * to starboard.
 *
 * Measured against the *towed* ship's own facings, which is what F/A/P/S mean
 * everywhere else in the game — the same four sides its shields are printed
 * on. The towing ship chooses the direction; it does not lend its heading.
 */
export function displacedPosition(target: ShipState, direction: 'F' | 'A' | 'P' | 'S'): Point {
  const bearing = { F: 0, S: 90, A: 180, P: 270 }[direction]
  const angle = ((target.placement.heading + bearing) * Math.PI) / 180
  return {
    x: target.placement.position.x + Math.sin(angle) * DISPLACE_DISTANCE,
    y: target.placement.position.y - Math.cos(angle) * DISPLACE_DISTANCE,
  }
}

// ---------------------------------------------------------------------------
// J3.6 — breaking a lock
// ---------------------------------------------------------------------------

export interface BreakReport {
  broken: TractorLink[]
  reasons: string[]
}

/**
 * Locks that lapse because the ships drifted apart, checked after everyone has
 * moved (J3.6.2), and locks whose last beam has been shot away (J3.6.4).
 */
export function pruneLinks(
  links: TractorLink[],
  ships: ShipState[],
  positionOf: (id: string) => Point | undefined,
): BreakReport {
  const broken: TractorLink[] = []
  const reasons: string[] = []
  const byId = new Map(ships.map((s) => [s.id, s]))

  for (const link of [...links]) {
    const source = byId.get(link.sourceId)
    const targetPosition = positionOf(link.targetId)

    if (!source || source.destroyed || source.disengaged) {
      broken.push(link)
      reasons.push('the tractoring ship is gone')
      continue
    }
    if (tractorBeams(source) === 0) {
      broken.push(link)
      reasons.push(`${source.name}'s tractor beams are all damaged (J3.6.4)`)
      continue
    }
    if (!targetPosition) {
      broken.push(link)
      reasons.push('the target is gone')
      continue
    }
    const range = actualRange(source.placement.position, targetPosition)
    if (range > tractorReach(link.power)) {
      broken.push(link)
      reasons.push(`the link exceeded range ${tractorReach(link.power)}" (J3.6.2)`)
    }
  }

  for (const link of broken) {
    const index = links.indexOf(link)
    if (index >= 0) links.splice(index, 1)
  }
  return { broken, reasons }
}

/**
 * A held ship may force the beam to prove itself again each phase (J3.6.1). The
 * attacker re-rolls the lock; failing it breaks the link.
 */
export function contestLink(rng: Rng, link: TractorLink, target: ShipState): LockResult {
  return lockOnStarship(rng, link.beams, link.power, target.form.sizeClass)
}

/** A ship held in a tractor beam may not go to FTL (J3.4.4). */
export function ftlBlockedBy(shipId: string, links: TractorLink[]): boolean {
  return links.some((l) => l.targetId === shipId && l.targetKind === 'ship')
}

export function powerLabel(power: PowerLevel): string {
  return power.toUpperCase()
}
