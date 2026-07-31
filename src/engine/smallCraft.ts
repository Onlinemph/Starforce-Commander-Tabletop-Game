import { FACE_DAMAGE } from './dice'
import { actualRange, bearing, distance, translate } from './geometry'
import { systemPower } from './operations'
import { genSysSetting, undamagedSystemBoxes, type ShipState } from './shipState'
import type { DieColor, DieFace, Point, SystemKind } from './types'

/**
 * Small craft (E12) — shuttles (J8) and probes (J7).
 *
 * Both are counters on the map that are neither ships nor weapons: they move
 * without plotting, ignore stress, and die to a handful of damage points. They
 * share one state shape because tractor beams, weapons and shuttle bays treat
 * them the same way (J3.2).
 */

export type SmallCraftKind = 'shuttle' | 'jamming-shuttle' | 'probe'

export interface SmallCraft {
  id: string
  kind: SmallCraftKind
  side: string
  /** The ship that launched it. */
  motherId: string
  position: Point
  damage: number
  /** Moved and acted this phase (J8.2.2). */
  activated: boolean
  /** Probes only — the object it was aimed at when launched (J7.2.3). */
  targetId?: string
  /** Probes only — arrived and sending data back (J7.3.2). */
  transmitting?: boolean
  /** Marine squads riding along (J8.3.5). */
  marines?: number
  /** Ship this shuttle has landed on or docked with (J8.2.6). */
  dockedTo?: string
}

// ---------------------------------------------------------------------------
// Standard shuttle (J8.3)
// ---------------------------------------------------------------------------

/** Inches per combat phase (J8.3.1). */
export const SHUTTLE_SPEED = 3
/** Damage points that destroy a standard shuttle (J8.3.3). */
export const SHUTTLE_HITS = 4
/**
 * Evasion level (J8.3.2). C3.6 Evasive Maneuvers is an optional rule, so under
 * the Standard rules this is recorded and unused.
 */
export const SHUTTLE_EVASION = 1
/** Shuttles carried per undamaged SHTL box (J8.1.5). */
export const SHUTTLES_PER_BOX = 2
/** Range a shuttle launches into and lands from (J8.2.1, J8.2.4). */
export const SHUTTLE_RANGE = 1
/** Boxes a MAX-power bay can patch up in the Damage Control Segment (J8.1.4). */
export const SHUTTLE_REPAIR_AT_MAX = 4

// ---------------------------------------------------------------------------
// Standard probe (J7.3)
// ---------------------------------------------------------------------------

/** How far a probe flies in the Navigation Segment (J7.3.2). */
export const PROBE_SPEED = 16
/** It stops this far short and holds station (J7.3.1). */
export const PROBE_STANDOFF = 4
/** Beyond this the probe can no longer reach its mother ship (J7.3.3). */
export const PROBE_LINK_RANGE = 36
/** Information gathered per phase once transmitting (J7.3.3). */
export const PROBE_INFO_PER_PHASE = 1
/** Any hit at all destroys a probe (J7.3.3). */
export const PROBE_HITS = 1

export function hitPointsOf(craft: SmallCraft): number {
  return craft.kind === 'probe' ? PROBE_HITS : SHUTTLE_HITS
}

export function isDestroyed(craft: SmallCraft): boolean {
  return craft.damage >= hitPointsOf(craft)
}

export function isShuttle(craft: SmallCraft): boolean {
  return craft.kind === 'shuttle' || craft.kind === 'jamming-shuttle'
}

// ---------------------------------------------------------------------------
// Capacity and launching
// ---------------------------------------------------------------------------

/** Shuttles a bay holds — two per undamaged SHTL box (J8.1.5). */
export function shuttleCapacity(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'SHTL') * SHUTTLES_PER_BOX
}

/** Probes carried: one per size class unless the form says otherwise (J7.2.2). */
export function probeCapacity(ship: ShipState): number {
  return ship.form.sizeClass
}

export function craftOf(craft: SmallCraft[], motherId: string): SmallCraft[] {
  return craft.filter((c) => c.motherId === motherId && !isDestroyed(c))
}

/**
 * Why a shuttle may not launch, or `null` if it may (J8.2.1).
 *
 * One a phase, from a bay with an undamaged box and a shuttle left aboard.
 */
export function launchRefusal(
  ship: ShipState,
  craft: SmallCraft[],
  launchedThisPhase: boolean,
): string | null {
  if (undamagedSystemBoxes(ship, 'SHTL') === 0) {
    return `${ship.name} has no undamaged SHTL boxes (J8.1.1).`
  }
  if (launchedThisPhase) return `${ship.name} has already launched a shuttle this phase (J8.1.2).`
  if (ship.shuttlesAboard < 1) return `${ship.name} has no shuttles left aboard (J8.1.5).`
  if (craftOf(craft, ship.id).filter(isShuttle).length >= shuttleCapacity(ship)) {
    return `${ship.name}'s bay only ever held ${shuttleCapacity(ship)} shuttles (J8.1.5).`
  }
  if (ship.derelict || ship.destroyed) return `${ship.name} cannot conduct flight operations.`
  return null
}

/**
 * A jamming shuttle needs GEN SYS at MAX and a mother ship crawling at speed 3
 * or less (J8.4.1, J8.4.2).
 */
export function jammingLaunchRefusal(ship: ShipState): string | null {
  if (genSysSetting(ship) !== 'max') {
    return 'A jamming shuttle needs GEN SYS set to MAX during Resource Allocation (J8.4.1).'
  }
  if (Math.abs(ship.speed) > SHUTTLE_SPEED) {
    return `${ship.name} is at speed ${ship.speed}; a jamming shuttle needs speed ${SHUTTLE_SPEED} or less (J8.4.2).`
  }
  return null
}

/** Launch position: the aft arc, within an inch of the ship (J8.2.1). */
export function launchPosition(ship: ShipState): Point {
  return translate(ship.placement.position, (ship.placement.heading + 180) % 360, SHUTTLE_RANGE)
}

// ---------------------------------------------------------------------------
// J8.4 — jamming shuttles
// ---------------------------------------------------------------------------

/**
 * The single point of jamming a working jamming shuttle lends its mother ship
 * (J8.4.1). Only one shuttle's worth, only to the ship that launched it.
 */
export function jammingFromShuttles(craft: SmallCraft[], ship: ShipState): number {
  const working = craft.some(
    (c) =>
      c.kind === 'jamming-shuttle' &&
      c.motherId === ship.id &&
      !isDestroyed(c) &&
      Math.abs(ship.speed) <= SHUTTLE_SPEED,
  )
  return working ? 1 : 0
}

/**
 * Jamming shuttles that must scuttle themselves: their mother ship has
 * outrun them, been destroyed, or gone derelict (J8.4.2).
 */
export function scuttledJammers(craft: SmallCraft[], ships: ShipState[]): SmallCraft[] {
  const byId = new Map(ships.map((s) => [s.id, s]))
  return craft.filter((c) => {
    if (c.kind !== 'jamming-shuttle' || isDestroyed(c)) return false
    const mother = byId.get(c.motherId)
    if (!mother) return true
    return mother.destroyed || mother.derelict || Math.abs(mother.speed) > SHUTTLE_SPEED
  })
}

// ---------------------------------------------------------------------------
// J8.2 — moving, recovering and docking
// ---------------------------------------------------------------------------

/** How far a shuttle may move when activated (J8.2.3). Movement is not plotted. */
export function moveRefusal(craft: SmallCraft, to: Point): string | null {
  if (!isShuttle(craft)) return 'Only shuttles move under their own orders (J7.3.2).'
  if (craft.activated) return 'This shuttle has already activated this phase (J8.2.2).'
  if (craft.dockedTo) return 'The shuttle is docked and may not move until its marines disembark (J8.2.6).'
  const travelled = distance(craft.position, to)
  if (travelled > SHUTTLE_SPEED + 1e-9) {
    return `That is ${travelled.toFixed(1)}"; a shuttle moves ${SHUTTLE_SPEED}" a phase (J8.3.1).`
  }
  return null
}

/**
 * Why a shuttle may not land aboard a friendly ship, or `null` if it may
 * (J8.2.4). The ship has to be moving forward slower than the shuttle and hold
 * that speed through the phase.
 */
export function recoveryRefusal(craft: SmallCraft, ship: ShipState, speedChanged: boolean): string | null {
  if (craft.side !== ship.side) return 'That ship is not friendly — see J8.2.6 for docking with an enemy.'
  if (ship.speed < 0) return `${ship.name} is moving astern (J8.2.4 item 1).`
  if (ship.speed >= SHUTTLE_SPEED) {
    return `${ship.name} is at speed ${ship.speed}; recovery needs less than ${SHUTTLE_SPEED} (J8.2.4 item 1).`
  }
  if (speedChanged) return `${ship.name} changed speed this phase (J8.2.4 item 1).`
  if (undamagedSystemBoxes(ship, 'SHTL') === 0) return `${ship.name}'s shuttle bay is wrecked (J8.1.1).`
  const range = distance(craft.position, ship.placement.position)
  if (range >= SHUTTLE_RANGE + 1) {
    return `The shuttle is ${range.toFixed(1)}" out; it must finish within ${SHUTTLE_RANGE + 1}" (J8.2.4 item 2).`
  }
  return null
}

/**
 * Shuttles a bay may recover this phase: one normally, two at MAX power — and
 * the second needs a spare tractor beam (J8.1.2, J8.1.3).
 */
export function recoveryAllowance(
  ship: ShipState,
  maxSystem: SystemKind | null,
  freeTractorBeams: number,
): number {
  const power = systemPower(ship, 'SHTL', maxSystem)
  if (power === 'off') return 0
  return power === 'max' && freeTractorBeams > 0 ? 2 : 1
}

/**
 * Why a shuttle may not board an enemy ship, or `null` if it may (J8.2.6).
 *
 * The target must be slower than the shuttle, have a shield down somewhere, and
 * not already have taken its size class in boarders this phase.
 */
export function dockingRefusal(
  craft: SmallCraft,
  ship: ShipState,
  dockedThisPhase: number,
  adjustedSpeed = ship.speed,
): string | null {
  if (craft.side === ship.side) return 'That ship is friendly — see J8.2.4 for recovery.'
  if (Math.abs(adjustedSpeed) >= SHUTTLE_SPEED) {
    return `${ship.name} is at speed ${adjustedSpeed}; docking needs less than ${SHUTTLE_SPEED} (J8.2.6 step 1).`
  }
  const range = distance(craft.position, ship.placement.position)
  if (range >= SHUTTLE_RANGE + 1) {
    return `The shuttle is ${range.toFixed(1)}" out; it must finish within ${SHUTTLE_RANGE + 1}" (J8.2.6 step 2).`
  }
  if ((['F', 'S', 'A', 'P'] as const).every((s) => !ship.shieldsDown[s])) {
    return `${ship.name} has every shield up; a shuttle needs one down to board (J8.2.6 step 5).`
  }
  if (dockedThisPhase >= ship.form.sizeClass) {
    return `${ship.name} can take ${ship.form.sizeClass} shuttle(s) a phase, one per size class (J8.2.6).`
  }
  return null
}

// ---------------------------------------------------------------------------
// J3.2.6 — bringing a small target aboard
// ---------------------------------------------------------------------------

/**
 * Why a tractored object may not be brought aboard (J3.2.6). Live weapons and
 * armed enemy craft stay outside.
 */
export function captureRefusal(craft: SmallCraft, ship: ShipState): string | null {
  if (undamagedSystemBoxes(ship, 'SHTL') === 0 && undamagedSystemBoxes(ship, 'HNGR') === 0) {
    return `${ship.name} has no shuttle or landing bay (J3.2.6).`
  }
  if (craft.kind === 'jamming-shuttle' && craft.side !== ship.side) {
    return 'An enemy jamming shuttle scuttles itself rather than be captured (J8.4.3).'
  }
  return null
}

// ---------------------------------------------------------------------------
// J7 — probes
// ---------------------------------------------------------------------------

/**
 * Weapon classes that can load a probe instead of ordnance (J7.1.3). Most ships
 * have no dedicated launcher, so this is the path that actually gets used.
 */
export function isProbeCapableLauncher(weaponClass: string): boolean {
  return /torpedo|missile/i.test(weaponClass)
}

/**
 * Why a probe may not be launched from a dedicated PROB launcher (J7.2.1).
 * Torpedo-tube launches go through `torpedoProbeRefusal` instead.
 */
export function probeLaunchRefusal(
  ship: ShipState,
  probesLaunchedThisRound: number,
  maxSystem: SystemKind | null,
): string | null {
  const launchers = undamagedSystemBoxes(ship, 'PROB')
  if (launchers === 0) return `${ship.name} has no undamaged PROB launcher (J7.1.1).`
  if (systemPower(ship, 'PROB', maxSystem) !== 'max') {
    return 'A probe is armed by setting the systems line to MAX (J7.2.1).'
  }
  if (probesLaunchedThisRound >= launchers) {
    return `${ship.name} may launch one probe per launcher per round (J7.2.1).`
  }
  return null
}

/**
 * Why a torpedo tube may not send a probe instead of ordnance (J7.2.2). The
 * tube has to have paid its full arming cost, which the probe then consumes.
 */
export function torpedoProbeRefusal(
  ship: ShipState,
  weaponClass: string,
  mountArmed: boolean,
  probesUsed: number,
): string | null {
  if (!isProbeCapableLauncher(weaponClass)) {
    return 'Only a torpedo or missile launcher can carry a probe (J7.1.3).'
  }
  if (!mountArmed) return 'The launcher must spend its full arming time to load a probe (J7.2.2).'
  if (probesUsed >= probeCapacity(ship)) {
    return `${ship.name} carries ${probeCapacity(ship)} probe(s), one per size class (J7.2.2).`
  }
  return null
}

/**
 * Fly a probe toward its target and report where it ends up (J7.3.2).
 *
 * It runs up to sixteen inches and stops four short. If it cannot close to
 * within four inches it is lost, and if the target has since moved out of that
 * four-inch bubble the probe stops working.
 */
export interface ProbeStep {
  position: Point
  arrived: boolean
  lost: boolean
}

export function moveProbe(craft: SmallCraft, target: Point): ProbeStep {
  const gap = distance(craft.position, target)
  if (gap <= PROBE_STANDOFF) return { position: craft.position, arrived: true, lost: false }

  const travel = Math.min(PROBE_SPEED, gap - PROBE_STANDOFF)
  const position = translate(craft.position, bearing(craft.position, target), travel)
  const arrived = distance(position, target) <= PROBE_STANDOFF + 1e-9
  // One flight is all it gets: a probe that cannot close to the standoff
  // distance in a single move is lost (J7.3.2).
  return { position, arrived, lost: !arrived }
}

/**
 * A transmitting probe keeps working while its target stays inside the standoff
 * bubble and its mother ship stays inside the link range (J7.3.2, J7.3.3).
 */
export function probeStillWorks(craft: SmallCraft, target: Point, mother: ShipState | undefined): boolean {
  if (!craft.transmitting) return false
  if (actualRange(craft.position, target) > PROBE_STANDOFF) return false
  if (!mother || mother.destroyed || mother.disengaged) return false
  return actualRange(mother.placement.position, craft.position) <= PROBE_LINK_RANGE
}

// ---------------------------------------------------------------------------
// E12.4, J3.2.5 — shooting at a small target
// ---------------------------------------------------------------------------

/**
 * The face every die shows when fired at a small target held in your own
 * tractor beam. There is nothing to roll: the target is shifted into whatever
 * arc suits and every die does its own maximum (J3.2.5).
 */
export const HELD_TARGET_FACE: Record<DieColor, DieFace> = {
  blue: 'M',
  green: 'H',
  yellow: 'H',
  red: 'S',
}

export interface SmallTargetVolley {
  faces: DieFace[]
  /** Damage before degraded fire control halves it. */
  raw: number
  damage: number
  /** Standard weapons must fire at small targets through E10 (E12.4.4). */
  degraded: boolean
  /** Held in the firer's own tractor beam, so nothing was rolled (J3.2.5). */
  automatic: boolean
}

/**
 * Damage one mount does to a small target.
 *
 * A point defense weapon fires normally and applies its damage in full
 * (E12.4.3). Anything else must use Degraded Fire Control, which halves the
 * total and rounds down (E12.4.4, E10.2.3).
 */
export function smallTargetDamage(
  faces: DieFace[],
  specialDamage: number,
  pointDefense: boolean,
  automatic = false,
): SmallTargetVolley {
  const raw = faces.reduce(
    (n, face) => n + (face === 'S' ? specialDamage : FACE_DAMAGE[face as Exclude<DieFace, 'S'>]),
    0,
  )
  const degraded = !pointDefense
  return {
    faces,
    raw,
    damage: degraded ? Math.floor(raw / 2) : raw,
    degraded,
    automatic,
  }
}
