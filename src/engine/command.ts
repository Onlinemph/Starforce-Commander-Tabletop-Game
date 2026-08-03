import { actualRange } from './geometry'
import { genSysSetting, undamagedSystemBoxes, type ShipState } from './shipState'

/**
 * Command Systems (H5, Expansion 2).
 *
 * A command ship generates tactical scan points from its CMND system boxes and
 * lends them to friendly ships for the rest of the round. Receiving ships may
 * spend those points on any legal tactical scan function, and may exceed the
 * cap their own sensors would impose (H5.2.2).
 */

/** Maximum lending range, in inches (H5.1.5). */
export const COMMAND_RANGE = 36

/** A ship (or base) that prints CMND boxes is a command ship (H5.1.1, H5.1.2). */
export function hasCommandSystems(ship: ShipState): boolean {
  return ship.form.systems.some((group) => group.kind === 'CMND' && group.boxes > 0)
}

export function commandSystemBoxes(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'CMND')
}

/**
 * Command points the ship can currently lend (H5.1.3, H5.1.4).
 *
 * Each functioning CMND box generates one point, but only while GEN SYS is set
 * to MAX — the command systems draw on the same communications and tactical
 * data plant. A ship that is gone, derelict or disengaged lends nothing, which
 * is what makes the H4.7 "what if the dreadnought is destroyed?" case work.
 */
export function commandPointsAvailable(ship: ShipState): number {
  if (ship.destroyed || ship.derelict || ship.disengaged) return 0
  /**
   * A flagship carries two points that cost nothing and need no GEN SYS
   * (S3.6) — the staff aboard rather than the hardware. They stack with
   * anything its CMND boxes produce, and are still bounded at the receiving
   * end by that ship's own sensor rating.
   */
  const flag = ship.flagship ? FLAGSHIP_SCAN_POINTS : 0
  if (genSysSetting(ship) !== 'max') return flag
  return flag + commandSystemBoxes(ship)
}

/** Free tactical scan points a flagship may hand out each round (S3.6). */
export const FLAGSHIP_SCAN_POINTS = 2

/** One recipient's share of the command ship's output. */
export interface CommandAssignment {
  shipId: string
  points: number
}

/**
 * Per-side command state for the current round.
 *
 * Assignments are ordered. Order is the owning player's declared priority: when
 * the command ship loses boxes, points are withdrawn from the tail first unless
 * the player names a ship with `revokeCommandPoint` — H4.7 gives that choice to
 * the owner "as soon as the damage occurs".
 */
export interface CommandState {
  /** Only one ship per side may lend at a time (H5.1.6). */
  commandShipId: string | null
  assignments: CommandAssignment[]
}

export function newCommandState(): CommandState {
  return { commandShipId: null, assignments: [] }
}

export function assignedPoints(state: CommandState, shipId: string): number {
  return state.assignments.find((a) => a.shipId === shipId)?.points ?? 0
}

export function totalAssigned(state: CommandState): number {
  return state.assignments.reduce((sum, a) => sum + a.points, 0)
}

/**
 * Set one recipient's share during the Resource Allocation Segment (H5.2.1).
 * Returns an error message when the assignment is illegal, in which case
 * nothing is changed.
 */
export function setCommandAssignment(
  state: CommandState,
  ships: readonly ShipState[],
  shipId: string,
  points: number,
): string | null {
  const commandShip = ships.find((s) => s.id === state.commandShipId)
  if (!commandShip) return 'No command ship has been designated this round (H5.1.6).'

  const recipient = ships.find((s) => s.id === shipId)
  if (!recipient) return 'Unknown ship.'
  if (recipient.destroyed || recipient.disengaged) return `${recipient.name} is no longer in play.`

  // H5.2.4: same faction only.
  if (recipient.side !== commandShip.side) {
    return 'Command ships may only lend tactical scan to units of the same faction (H5.2.4).'
  }

  if (points < 0) return 'Command points cannot be negative.'

  // H5.2.3: a command ship may lend itself at most one point.
  if (recipient.id === commandShip.id && points > 1) {
    return 'A command ship may lend itself a maximum of one tactical scan point (H5.2.3).'
  }

  // H5.1.5: 36" maximum lending range.
  const range = actualRange(commandShip.placement.position, recipient.placement.position)
  if (points > 0 && range > COMMAND_RANGE) {
    return `${recipient.name} is ${range}" away — command range is ${COMMAND_RANGE}" (H5.1.5).`
  }

  const available = commandPointsAvailable(commandShip)
  const others = totalAssigned(state) - assignedPoints(state, shipId)
  if (others + points > available) {
    return `${commandShip.name} generates only ${available} command point${available === 1 ? '' : 's'} (H5.1.4).`
  }

  const existing = state.assignments.find((a) => a.shipId === shipId)
  if (points === 0) {
    state.assignments = state.assignments.filter((a) => a.shipId !== shipId)
  } else if (existing) {
    existing.points = points
  } else {
    state.assignments.push({ shipId, points })
  }
  return null
}

/**
 * Give up one lent point, the owning player's choice of ship (H4.7).
 * Used when the command ship loses a CMND box mid-phase.
 */
export function revokeCommandPoint(state: CommandState, shipId: string): void {
  const entry = state.assignments.find((a) => a.shipId === shipId)
  if (!entry) return
  entry.points -= 1
  if (entry.points <= 0) state.assignments = state.assignments.filter((a) => a.shipId !== shipId)
}

/**
 * Tactical scan points each ship currently holds on loan.
 *
 * Derived rather than stored, because the loan is live: a destroyed command
 * ship, a command ship that drops out of GEN SYS MAX, or a damaged CMND box all
 * take points back off the recipients immediately (H4.5.2, H4.7). Points are
 * withdrawn from the end of the assignment list, so the earlier entries — the
 * ships the player prioritised — keep theirs.
 */
export function lentTacticalScan(
  state: CommandState,
  ships: readonly ShipState[],
): Record<string, number> {
  const out: Record<string, number> = {}
  const commandShip = ships.find((s) => s.id === state.commandShipId)
  if (!commandShip) return out

  let capacity = commandPointsAvailable(commandShip)
  for (const assignment of state.assignments) {
    if (capacity <= 0) break
    const recipient = ships.find((s) => s.id === assignment.shipId)
    if (!recipient || recipient.destroyed || recipient.disengaged) continue
    const granted = Math.min(assignment.points, capacity)
    out[assignment.shipId] = (out[assignment.shipId] ?? 0) + granted
    capacity -= granted
  }
  return out
}
