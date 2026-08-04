/**
 * Abandoning ship (E11.4 – E11.6, optional).
 *
 * The rest of Section E is about killing ships. This part is about the people
 * aboard them, and it is the only place in the rulebook where a losing captain
 * has something left to play for: a hull is worth points to whoever wrecks it,
 * but a crew is worth points to whoever *saves* it, and an experienced crew
 * that gets off a dying ship can be reassigned in a campaign (E11.4).
 *
 * Two ways off. The transporter is the fast one and the ugly one — safety
 * protocols come off and a fifth of the crew does not survive the trip on
 * average — but it happens the moment the ship is dying, which is usually the
 * only moment there is (E11.5). Escape pods are safer and slower: they go at
 * the end of the round, which means the ship has to survive that long, and a
 * hull that blows up under weapon fire takes very nearly everyone with it
 * (E11.6.1). Pods then sit where they were dropped, waiting for somebody to
 * come and get them — friend or enemy, because a captured crew scores just as
 * well as a rescued one.
 *
 * The functions here are pure: they take state and dice and return what
 * happened. The sequencing lives in `game.ts`, where the segments are.
 */

import { rollDie, type Rng } from './dice'
import { actualRange } from './geometry'
import type { ShipState } from './shipState'
import type { Point } from './types'

/** Two crew units per size class (E11.5.4). */
export const CREW_UNITS_PER_SIZE_CLASS = 2

/** A saved or captured crew unit is worth this much at scoring (E11.4.2). */
export const VICTORY_POINTS_PER_CREW = 2

/** Escape pods are dropped this far from the hull (E11.6.4). */
export const POD_DROP_DISTANCE = 2

/** A stopped ship this close may take a pod aboard (E11.6.5). */
export const POD_LANDING_RANGE = 1

/** How many crew a ship carries at full complement (E11.5.4). */
export function crewComplement(ship: ShipState): number {
  return ship.form.sizeClass * CREW_UNITS_PER_SIZE_CLASS
}

/**
 * A pod counter on the map: slow, defenceless, and full of people who are
 * worth points to whoever reaches them first.
 */
export interface EscapePod {
  id: string
  /** The side whose crew is aboard — not necessarily the side that holds it. */
  side: string
  /** The ship they left. */
  fromShipId: string
  fromShipName: string
  position: Point
  /** Crew units still aboard the pod. */
  crew: number
}

// ---------------------------------------------------------------------------
// E11.5 Transporter evacuation
// ---------------------------------------------------------------------------

export interface EvacOutcome {
  /** Dice faces, one per crew unit attempted. */
  faces: string[]
  saved: number
  lost: number
}

/**
 * Why an emergency beam-out cannot be made, or null (E11.5.1, E11.5.2).
 *
 * Deliberately laxer than an ordinary transport (J5): the destination may keep
 * its shields up if it likes, and only *one* end needs a working transporter
 * box, because the rule says the crew may go if either ship can manage it.
 * This is the last resort, not a routine beam.
 */
export function evacRefusal(
  from: ShipState,
  to: ShipState,
  reach: number,
  fromBoxes: number,
  toBoxes: number,
): string | null {
  if (from.crewUnits <= 0) return `${from.name} has nobody left to evacuate.`
  if (to.destroyed || to.disengaged) return `${to.name} is not there to receive them.`
  if (to.id === from.id) return 'A crew cannot evacuate to its own ship.'
  // E11.5.2: either end will do.
  if (fromBoxes === 0 && toBoxes === 0) {
    return 'Neither ship has an undamaged transporter box (E11.5.2).'
  }
  const range = actualRange(from.placement.position, to.placement.position)
  if (range > reach) {
    return `${to.name} is ${range}" away; emergency transport reaches ${reach}" (E11.5.1).`
  }
  return null
}

/**
 * Beam the crew off (E11.5.4): one green die per crew unit, an L, M or H gets
 * that unit across, a Miss means it did not. The caller has already checked
 * the refusal.
 */
export function evacuateByTransporter(from: ShipState, rng: Rng): EvacOutcome {
  const faces: string[] = []
  let saved = 0
  for (let i = 0; i < from.crewUnits; i++) {
    const face = rollDie('green', rng).face
    faces.push(face)
    if (face === 'L' || face === 'M' || face === 'H') saved++
  }
  const lost = from.crewUnits - saved
  from.crewUnits = 0
  return { faces, saved, lost }
}

// ---------------------------------------------------------------------------
// E11.6 Escape pods
// ---------------------------------------------------------------------------

/**
 * Why the pods cannot go, or null (E11.6.2).
 *
 * The captain's own judgement is the only gate the rule puts on this — "if she
 * determines the ship is about to be destroyed" — so a functional ship may
 * abandon just as a derelict may. What it cannot do is abandon twice, or
 * abandon a hull that is already gone.
 */
export function podRefusal(ship: ShipState): string | null {
  if (ship.destroyed) return `${ship.name} is gone; there was no time (E11.6.1).`
  if (ship.crewUnits <= 0) return `${ship.name} has already been abandoned.`
  return null
}

/**
 * Where the pods appear: two inches off the hull, on the side away from the
 * ship's heading, so they are not sitting under it (E11.6.4).
 */
export function podPosition(ship: ShipState): Point {
  const radians = ((ship.placement.heading + 180) * Math.PI) / 180
  return {
    x: ship.placement.position.x + Math.sin(radians) * POD_DROP_DISTANCE,
    y: ship.placement.position.y - Math.cos(radians) * POD_DROP_DISTANCE,
  }
}

/**
 * Whether this ship can take that pod aboard by landing it (E11.6.5): the ship
 * must be stopped and within range 1. Beaming has its own path and no such
 * restriction beyond transporter range.
 */
export function podMayLand(pod: EscapePod, ship: ShipState): string | null {
  if (ship.destroyed || ship.disengaged) return `${ship.name} is not there.`
  if (ship.speed !== 0) return `${ship.name} must be stopped to take a pod aboard (E11.6.5).`
  const range = actualRange(pod.position, ship.placement.position)
  if (range > POD_LANDING_RANGE) {
    return `The pod is ${range}" away; a landing needs ${POD_LANDING_RANGE}" (E11.6.5).`
  }
  return null
}

// ---------------------------------------------------------------------------
// E11.4.2 Scoring
// ---------------------------------------------------------------------------

/**
 * Crew points at the end of a battle.
 *
 * Rescued crew has already been counted as it came aboard. Pods still floating
 * go to the victors: "a victorious player with forces remaining on the map at
 * the end of a battle can be assumed to have rescued friendly escape pods or
 * captured enemy escape pods" (E11.4, page 42). With more than one side still
 * present nobody has swept the field, so those pods score for nobody.
 */
export function crewVictoryPoints(
  rescued: Readonly<Record<string, number>>,
  pods: readonly EscapePod[],
  sidesStillPresent: readonly string[],
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const [side, units] of Object.entries(rescued)) {
    totals[side] = (totals[side] ?? 0) + units * VICTORY_POINTS_PER_CREW
  }
  if (sidesStillPresent.length === 1) {
    const victor = sidesStillPresent[0]
    for (const pod of pods) {
      totals[victor] = (totals[victor] ?? 0) + pod.crew * VICTORY_POINTS_PER_CREW
    }
  }
  return totals
}
