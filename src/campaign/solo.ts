/**
 * The scripted solo opponent (design doc Part 11, build Phase 5's cheap 70%).
 *
 * Not the tactical AI's cousin — a doctrine that plans UNDER the fog. The
 * whole design is in the signature: `soloOrders` takes a SideView and nothing
 * else, so the compiler itself forbids it the umpire's truth. It hunts what
 * its side has actually seen, patrols where its side guesses the enemy might
 * be, and walks into ambushes exactly as often as its information deserves.
 * The tactical AI still fights the resulting battles at full strength.
 *
 * Deterministic: same view, same orders — campaign replay depends on it, and
 * so does the two-consoles-agree property if a remote game ever drives a side
 * with this.
 */

import { hexDistance } from './hexmap'
import type { SideView, ViewedContact } from './views'
import type { Hex, Intervention, StandingOrder, Unit } from './types'

/** The contact most worth a warship's attention: nearest live one. */
function quarry(view: SideView, from: Hex): ViewedContact | null {
  let best: ViewedContact | null = null
  let bestRange = Infinity
  for (const contact of view.contacts) {
    if (contact.collapsed) continue
    const range = hexDistance(from, contact.hex)
    if (range < bestRange) {
      best = contact
      bestRange = range
    }
  }
  return best
}

/** A patrol line along the border, spread by unit index so the net has width. */
function patrolStation(view: SideView, index: number): Hex | null {
  const border = view.map.border
  if (border.length === 0) return null
  const slot = border[Math.min(border.length - 1, (index * 7) % border.length)]
  return { q: slot.q, r: slot.r }
}

function sameOrder(a: StandingOrder, b: StandingOrder): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * One phase's interventions for the side this view belongs to. Convoys keep
 * their scheduled routes; warships intercept the nearest contact their side
 * holds, or take a patrol station on the border when the fog is empty.
 * Only CHANGED orders are emitted — a quiet phase is zero interventions,
 * exactly as the doc's workload rule wants (5.2).
 */
export function soloOrders(view: SideView): Intervention[] {
  const interventions: Intervention[] = []
  view.units.forEach((unit: Unit, index: number) => {
    // Shipping sails its schedule; the escort doctrine is the route itself.
    if (unit.kind === 'convoy') return

    const seen = quarry(view, unit.hex)
    const desired: StandingOrder = structuredClone(unit.order)
    desired.speed = 'cruise'
    if (seen) {
      desired.mission = { type: 'intercept', contactId: seen.id }
    } else {
      desired.mission = undefined
      const station = patrolStation(view, index)
      const arrived = station && hexDistance(unit.hex, station) === 0
      if (station && !arrived && desired.waypoints.length === 0) {
        desired.waypoints = [station]
      }
      // On station with nothing seen: hold quiet and listen hard.
      if (arrived) {
        desired.speed = 'hold'
        desired.sensorPower = 2
      }
    }
    // A dry tank cannot afford hungry sensors (6.4).
    if (unit.endurance <= 1 && desired.sensorPower === 2) desired.sensorPower = 1

    if (!sameOrder(unit.order, desired)) {
      interventions.push({ type: 'set-order', unitId: unit.id, order: desired })
    }
  })
  return interventions
}
