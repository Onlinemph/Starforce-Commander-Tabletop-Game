import { actualRange } from './geometry'
import {
  activeScoutSensors,
  isScout,
  scoutSensorsIntact,
  scoutSensorsPowered,
  usingScoutSensors,
  type ScoutSensorState,
  type ShipState,
} from './shipState'
import type { ScoutFunction } from './types'

/**
 * Scouting Sensors (H3, Expansion 1).
 *
 * Scouts carry larger sensors than a warship's, and spend them supporting the
 * fleet rather than themselves: illuminating a target so every friendly ship
 * shooting at it gains targeting points (H3.4), blanketing an area in jamming
 * that every friendly ship inside benefits from (H3.5), or running long-range
 * informational scans (H3.6).
 *
 * Each sensor is assigned one function during Resource Allocation and is stuck
 * with it for the round (H3.2.2).
 *
 * One erratum in the source: H3.2.1 lists the three functions as "targeting,
 * jamming, or tactical scan", but H3.3.1 and H3.6 both name them targeting,
 * area jamming and informational scans, and no rule anywhere lets a scout
 * sensor feed H2.4 Tactical Scan. The engine follows H3.3.1.
 */

// ---------------------------------------------------------------------------
// Assignment (H3.2)
// ---------------------------------------------------------------------------

/**
 * Assign one scout sensor a function for the round (H3.2.2). Returns an error
 * message when the order is illegal, in which case nothing changes.
 */
export function setScoutAssignment(
  scout: ShipState,
  index: number,
  fn: ScoutFunction,
  targetId: string | null,
  ships: readonly ShipState[],
): string | null {
  const block = scout.form.scoutSensor
  if (!block) return `${scout.name} has no scouting sensors (H3.1.1).`

  const sensor = scout.scoutAssignments[index]
  if (!sensor) return 'Unknown scout sensor.'

  if (fn === 'targeting') {
    if (!targetId) return 'A targeting sensor must illuminate a specific enemy ship (H3.4.1).'
    const target = ships.find((s) => s.id === targetId)
    if (!target) return 'Unknown target.'
    if (target.side === scout.side) return 'Scouts illuminate enemy ships, not friendly ones (H3.4.1).'
    if (target.destroyed || target.disengaged) return `${target.name} is no longer in play.`
    // H3.4.2: the number beside the targeting icon is the illumination range.
    const range = actualRange(scout.placement.position, target.placement.position)
    if (range > block.targetingRange) {
      return `${target.name} is ${range}" away — targeting range is ${block.targetingRange}" (H3.4.2).`
    }
  }

  sensor.function = fn
  sensor.targetId = fn === 'targeting' ? targetId : null
  return null
}

/**
 * Switch a scout sensor on or off during Operations step 2.E (H3.3.2). The
 * function it was assigned does not change.
 */
export function setScoutSensorActive(scout: ShipState, index: number, active: boolean): void {
  const sensor = scout.scoutAssignments[index]
  if (sensor) sensor.active = active
}

export function scoutSensorsOn(scout: ShipState, fn: ScoutFunction): ScoutSensorState[] {
  return activeScoutSensors(scout).filter((s) => s.function === fn)
}

// ---------------------------------------------------------------------------
// Fleet support (H3.4, H3.5)
// ---------------------------------------------------------------------------

/**
 * Whether a ship may take support from *another* scout (H3.4.4, H3.5.3): a
 * scout already using its own scout sensors is transmitting, not listening.
 *
 * Its own sensors still serve it — H3.5.1 says outright that "a scout receives
 * the benefits of its own area jamming", and nothing stops a scout shooting at
 * a target it is itself illuminating.
 */
export function mayReceiveScoutSupport(ship: ShipState): boolean {
  return !(isScout(ship) && usingScoutSensors(ship))
}

/** Targeting points one scout is putting on one target (H3.4.1). */
export function targetingFrom(scout: ShipState, target: ShipState): number {
  if (!isScout(scout) || scout.side === target.side) return 0
  return scoutSensorsOn(scout, 'targeting').filter((s) => s.targetId === target.id).length
}

/** Area jamming one scout is providing to one friendly ship (H3.5.1, H3.5.2). */
export function jammingFrom(scout: ShipState, ship: ShipState): number {
  if (!isScout(scout) || scout.side !== ship.side) return 0
  const block = scout.form.scoutSensor!
  const range = actualRange(scout.placement.position, ship.placement.position)
  if (range > block.jammingRange) return 0
  return scoutSensorsOn(scout, 'jamming').length
}

export interface ScoutSupport {
  /** Extra targeting points the attacker gains against this target (H3.4.1). */
  targeting: number
  /** Extra jamming points the target gains (H3.5.1). */
  jamming: number
  /** Names of the scouts providing each, for the log. */
  targetingFrom: string | null
  jammingFrom: string | null
}

export const NO_SCOUT_SUPPORT: ScoutSupport = {
  targeting: 0,
  jamming: 0,
  targetingFrom: null,
  jammingFrom: null,
}

/**
 * Scout support applying to one volley (H3.4, H3.5).
 *
 * A ship may take targeting from a single scout and jamming from a single
 * scout (H3.4.4, H3.5.3), so where several scouts could help, the best one
 * wins — a player would always pick that one.
 */
export function scoutSupportFor(
  attacker: ShipState,
  target: ShipState,
  ships: readonly ShipState[],
): ScoutSupport {
  const support: ScoutSupport = { ...NO_SCOUT_SUPPORT }
  const scouts = ships.filter((s) => isScout(s) && !s.destroyed && !s.disengaged && !s.derelict)

  const usable = (scout: ShipState, receiver: ShipState) =>
    scout.id === receiver.id || mayReceiveScoutSupport(receiver)

  for (const scout of scouts) {
    if (scout.side !== attacker.side || !usable(scout, attacker)) continue
    const points = targetingFrom(scout, target)
    if (points > support.targeting) {
      support.targeting = points
      support.targetingFrom = scout.name
    }
  }

  for (const scout of scouts) {
    if (scout.side !== target.side || !usable(scout, target)) continue
    const points = jammingFrom(scout, target)
    if (points > support.jamming) {
      support.jamming = points
      support.jammingFrom = scout.name
    }
  }

  return support
}

// ---------------------------------------------------------------------------
// Informational scans (H3.6)
// ---------------------------------------------------------------------------

/**
 * Range and bonus information points for a scan run with scout sensors
 * (H3.6.1, H3.6.2). J4.2's scan procedure itself is not interactive yet, so
 * this reports what the scout contributes rather than resolving a scan.
 */
export function scanCapability(scout: ShipState): { range: number; bonusPoints: number } | null {
  const block = scout.form.scoutSensor
  if (!block) return null
  const sensors = scoutSensorsOn(scout, 'scan').length
  if (sensors === 0) return null
  return { range: block.scanRange, bonusPoints: sensors }
}

// ---------------------------------------------------------------------------
// Damage (H3.1.1)
// ---------------------------------------------------------------------------

/**
 * Can a Sensor Hit or Special System hit still find a scout sensor to mark?
 * A scout's captain chooses between scout sensors and normal sensors on a
 * Sensor Hit; Special System hits always land on the scout sensors (H3.1.1).
 */
export function scoutSensorAvailable(ship: ShipState): boolean {
  return scoutSensorsIntact(ship) > 0
}

export function damageScoutSensor(ship: ShipState): boolean {
  if (!scoutSensorAvailable(ship)) return false
  ship.scoutSensorDamage += 1
  // A damaged sensor stops working even if its power circle stays filled.
  const powered = scoutSensorsPowered(ship)
  for (let i = powered; i < ship.scoutAssignments.length; i++) {
    ship.scoutAssignments[i].active = false
  }
  return true
}
