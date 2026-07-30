import { distance, normalizeHeading } from './geometry'
import { turnTemplateAt, type ShipState } from './shipState'

/**
 * Formation Maneuvering (C5, Expansion 1).
 *
 * A formation flies as one counter: every member plots the lead ship's
 * maneuver at the lead ship's speed, and only the lead's marker stays on the
 * map. Formation affects the *maneuver* and nothing else — ships still use
 * their systems, sensors and weapons independently (C5 intro, C5.2).
 *
 * The tactical payoff is concentrated firepower from a single bearing; the
 * price is that a ship exploding inside the formation catches everyone
 * (E11.3.4).
 */

/** Joining range: 0 to 1.99 inches, i.e. range 1 (C5.1.2 step 1). */
export const FORMATION_RANGE = 2

/** Headings must be within 45 degrees of the lead's (C5.1.2 step 3). */
export const FORMATION_HEADING_ARC = 45

export interface Formation {
  id: string
  side: string
  leadId: string
  /** Members other than the lead, in join order. */
  memberIds: string[]
}

export function formationShips(formation: Formation, ships: readonly ShipState[]): ShipState[] {
  const ids = [formation.leadId, ...formation.memberIds]
  return ids
    .map((id) => ships.find((s) => s.id === id))
    .filter((s): s is ShipState => s !== undefined && !s.destroyed && !s.disengaged)
}

export function formationOf(formations: readonly Formation[], shipId: string): Formation | null {
  return (
    formations.find((f) => f.leadId === shipId || f.memberIds.includes(shipId)) ?? null
  )
}

/** Smallest angle between two headings, 0–180. */
export function headingDelta(a: number, b: number): number {
  const diff = Math.abs(normalizeHeading(a) - normalizeHeading(b))
  return diff > 180 ? 360 - diff : diff
}

/**
 * The three requirements of C5.1.2: range 1 of the lead, the same speed, and a
 * heading the joining ship could match with a turn of 45 degrees or less.
 * Returns an error message, or null when the ship may join.
 */
export function joinRequirements(lead: ShipState, joining: ShipState): string | null {
  if (lead.id === joining.id) return 'A ship cannot join formation with itself.'
  if (lead.side !== joining.side) return 'Only ships of the same faction may fly in formation (C5.1).'
  for (const ship of [lead, joining]) {
    if (ship.destroyed || ship.disengaged) return `${ship.name} is no longer in play.`
    if (ship.derelict) return `${ship.name} is a derelict and cannot maneuver (E11.2.4).`
  }

  const gap = distance(lead.placement.position, joining.placement.position)
  if (gap >= FORMATION_RANGE) {
    return `${joining.name} is ${gap.toFixed(2)}" from the lead ship — joining requires range 1 (C5.1.2).`
  }
  if (joining.speed !== lead.speed) {
    return `${joining.name} is at speed ${joining.speed}, the formation at ${lead.speed} (C5.1.2).`
  }
  const turn = headingDelta(lead.placement.heading, joining.placement.heading)
  if (turn > FORMATION_HEADING_ARC) {
    return `${joining.name} would need to turn ${Math.round(turn)}° to match the lead — more than 45° (C5.1.2).`
  }
  return null
}

/**
 * The lead ship is the least maneuverable in the group at the formation's
 * current speed (C5.1.1) — the smallest turn template, since a bigger template
 * angle is a tighter turn. Ties go to the caller's first candidate, which is
 * the owning player's choice.
 */
export function chooseLead(ships: readonly ShipState[]): ShipState | null {
  if (ships.length === 0) return null
  return ships.reduce((worst, ship) =>
    turnTemplateAt(ship, ship.speed) < turnTemplateAt(worst, worst.speed) ? ship : worst,
  )
}

/**
 * Form a new formation, or add ships to an existing one. Ships are checked
 * against the lead individually, so a ship that fails simply does not join.
 */
export function joinFormation(
  formations: Formation[],
  lead: ShipState,
  joining: readonly ShipState[],
): { formation: Formation | null; rejected: Array<{ ship: ShipState; reason: string }> } {
  const rejected: Array<{ ship: ShipState; reason: string }> = []
  const accepted: ShipState[] = []

  for (const ship of joining) {
    const problem = joinRequirements(lead, ship)
    if (problem) rejected.push({ ship, reason: problem })
    else accepted.push(ship)
  }
  if (accepted.length === 0) return { formation: null, rejected }

  // A ship may only be in one formation, so leave the old one first.
  for (const ship of [lead, ...accepted]) leaveFormation(formations, ship.id)

  const formation: Formation = {
    id: `formation-${lead.id}`,
    side: lead.side,
    leadId: lead.id,
    memberIds: accepted.map((s) => s.id),
  }
  formations.push(formation)
  return { formation, rejected }
}

/**
 * Drop a ship out of its formation (C5.2). A formation that loses its lead, or
 * falls below two ships, disbands.
 */
export function leaveFormation(formations: Formation[], shipId: string): Formation | null {
  const formation = formationOf(formations, shipId)
  if (!formation) return null

  if (formation.leadId === shipId) {
    formations.splice(formations.indexOf(formation), 1)
    return formation
  }
  formation.memberIds = formation.memberIds.filter((id) => id !== shipId)
  if (formation.memberIds.length === 0) {
    formations.splice(formations.indexOf(formation), 1)
  }
  return formation
}

/** Drop formations whose lead or members have left the battle. */
export function pruneFormations(formations: Formation[], ships: readonly ShipState[]): void {
  const gone = (id: string) => {
    const ship = ships.find((s) => s.id === id)
    return !ship || ship.destroyed || ship.disengaged || ship.derelict
  }
  for (const formation of [...formations]) {
    if (gone(formation.leadId)) {
      formations.splice(formations.indexOf(formation), 1)
      continue
    }
    formation.memberIds = formation.memberIds.filter((id) => !gone(id))
    if (formation.memberIds.length === 0) formations.splice(formations.indexOf(formation), 1)
  }
}

/**
 * Place every member on the lead ship's counter after movement (C5.1.3): only
 * the lead's marker is on the map, so the rest share its position, heading and
 * speed exactly.
 */
export function alignToLead(formation: Formation, ships: readonly ShipState[]): void {
  const lead = ships.find((s) => s.id === formation.leadId)
  if (!lead) return
  for (const id of formation.memberIds) {
    const ship = ships.find((s) => s.id === id)
    if (!ship || ship.destroyed || ship.disengaged) continue
    ship.placement = {
      position: { ...lead.placement.position },
      heading: lead.placement.heading,
    }
    ship.speed = lead.speed
  }
}
