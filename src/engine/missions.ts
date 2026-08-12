import { actualRange } from './geometry'
import type { Point } from './types'
import type { ShipState } from './shipState'

/**
 * Objectives other than killing.
 *
 * The battles so far have had one currency — damage — and the AI's whole
 * politics (posture, retreat, focus) reads the victory ledger that damage
 * writes. Missions widen the ledger, not the politics: each one is a thing on
 * the map that pays victory points for something other than shooting, the
 * points flow into the same S2.8 totals, and the AI's judgment about winning
 * and losing follows them for free. What each mission adds by hand is only
 * the geometry the scoreboard cannot teach: *go there* (a helm anchor) and,
 * for cargo, *that carrier is the target now*.
 *
 * Three kinds, chosen because together they cover the classic shapes:
 *
 * - `hold` — capture the hill. A circle on the map; at the end of every round
 *   the side with active ships inside and no enemy inside banks points.
 *   Contested or empty pays nobody.
 * - `cargo` — capture the flag. A counter at a point; a ship that ends a
 *   Navigation Segment within reach picks it up, and the points pay out only
 *   when the carrier leaves the map with it (J9 disengagement — the door, not
 *   a wall). A dead carrier drops it where it died.
 * - `rescue` — souls in peril. A site with people on it; a ship inside
 *   transporter range beams out up to its transporter capacity per Operations
 *   Segment, and each soul aboard pays out immediately. Either side may do
 *   the rescuing — a rescue denied to the enemy is a rescue all the same.
 */
export type MissionDef =
  | { kind: 'hold'; id: string; name: string; center: Point; radius: number; pointsPerRound: number }
  | { kind: 'cargo'; id: string; name: string; position: Point; radius: number; points: number }
  | { kind: 'rescue'; id: string; name: string; position: Point; souls: number; pointsPerSoul: number }

/** Live state, one entry per MissionDef, in the same order. */
export interface MissionState {
  id: string
  /** Victory points banked from this mission, by side. */
  earned: Record<string, number>
  /** cargo: who holds it now, where it lies when nobody does, and whether it left. */
  carrierId: string | null
  position: Point | null
  delivered: boolean
  /** rescue: souls still waiting at the site. */
  soulsLeft: number
}

export function newMissionStates(defs: readonly MissionDef[]): MissionState[] {
  return defs.map((def) => ({
    id: def.id,
    earned: {},
    carrierId: null,
    position: def.kind === 'cargo' ? { ...def.position } : null,
    delivered: false,
    soulsLeft: def.kind === 'rescue' ? def.souls : 0,
  }))
}

/** Points a side has banked across every mission — added into victoryPoints. */
export function missionPoints(states: readonly MissionState[], side: string): number {
  return states.reduce((sum, s) => sum + (s.earned[side] ?? 0), 0)
}

const bank = (state: MissionState, side: string, points: number) => {
  state.earned[side] = (state.earned[side] ?? 0) + points
}

/** A hull that can act on a mission: on the map, alive, and answering its helm. */
const fitAt = (ship: ShipState, round: number) =>
  !ship.destroyed && !ship.disengaged && !ship.derelict && !ship.capturedBy && ship.arrivesRound <= round

export interface MissionHooks {
  ships: ShipState[]
  round: number
  log: (message: string) => void
  /** Whether this hull's position is hidden by a cloak (H6.2.2). */
  hidden: (ship: ShipState) => boolean
  /** Transporter reach for a hull, in inches (J5). */
  reach: (ship: ShipState) => number
  /** Souls a hull can lift per Operations Segment (J5.1.2). */
  capacity: (ship: ShipState) => number
}

/**
 * End of round: the hill pays whoever holds it alone (contested pays nobody,
 * and a cloaked ship holds nothing — a flag nobody can see flying is not
 * flying, H6.2.2).
 */
export function scoreHoldMissions(defs: readonly MissionDef[], states: MissionState[], h: MissionHooks): void {
  defs.forEach((def, i) => {
    if (def.kind !== 'hold') return
    const inside = h.ships.filter(
      (s) => fitAt(s, h.round) && !h.hidden(s) && actualRange(s.placement.position, def.center) <= def.radius,
    )
    const sides = [...new Set(inside.map((s) => s.side))]
    if (sides.length !== 1) return
    bank(states[i], sides[0], def.pointsPerRound)
    h.log(`${sides[0]} holds ${def.name} (+${def.pointsPerRound} VP).`)
  })
}

/**
 * After movement: a ship ending within reach of a loose cargo takes it aboard
 * (nearest first; ties by id, so every console computes the same carrier).
 * Also the bookkeeping sweep: a carrier that died drops it where it died, and
 * one that left the map delivered it.
 */
export function updateCargoMissions(defs: readonly MissionDef[], states: MissionState[], h: MissionHooks): void {
  defs.forEach((def, i) => {
    if (def.kind !== 'cargo') return
    const state = states[i]
    if (state.delivered) return

    const carrier = state.carrierId ? h.ships.find((s) => s.id === state.carrierId) : undefined
    if (carrier) {
      if (carrier.disengaged && !carrier.destroyed) {
        state.delivered = true
        state.carrierId = null
        bank(state, carrier.side, def.points)
        h.log(`${carrier.name} carries ${def.name} off the map (+${def.points} VP).`)
        return
      }
      if (!fitAt(carrier, h.round)) {
        state.carrierId = null
        state.position = { ...carrier.placement.position }
        h.log(`${def.name} is adrift where ${carrier.name} lost it.`)
      } else {
        return // still safely aboard
      }
    }

    if (!state.position) return
    const candidates = h.ships
      .filter((s) => fitAt(s, h.round) && !h.hidden(s) && actualRange(s.placement.position, state.position!) <= def.radius)
      .sort(
        (a, b) =>
          actualRange(a.placement.position, state.position!) - actualRange(b.placement.position, state.position!) ||
          (a.id < b.id ? -1 : 1),
      )
    if (candidates.length === 0) return
    state.carrierId = candidates[0].id
    state.position = null
    h.log(`${candidates[0].name} takes ${def.name} aboard.`)
  })
}

/**
 * Each Operations Segment: every hull inside transporter range lifts up to its
 * capacity, in ship order — both sides may work the same site, and the points
 * pay on the spot (a soul aboard is a soul saved; if the ship dies later that
 * is a tragedy the kill points already price).
 */
export function runRescueMissions(defs: readonly MissionDef[], states: MissionState[], h: MissionHooks): void {
  defs.forEach((def, i) => {
    if (def.kind !== 'rescue') return
    const state = states[i]
    if (state.soulsLeft <= 0) return
    for (const ship of h.ships) {
      if (state.soulsLeft <= 0) break
      if (!fitAt(ship, h.round) || h.hidden(ship)) continue
      if (actualRange(ship.placement.position, def.position) > h.reach(ship)) continue
      const lifted = Math.min(state.soulsLeft, h.capacity(ship))
      if (lifted <= 0) continue
      state.soulsLeft -= lifted
      bank(state, ship.side, lifted * def.pointsPerSoul)
      h.log(
        `${ship.name} beams ${lifted} aboard from ${def.name} (+${lifted * def.pointsPerSoul} VP` +
          (state.soulsLeft > 0 ? `, ${state.soulsLeft} remain` : ', site cleared') +
          ').',
      )
    }
  })
}

/**
 * The helm anchor: where a ship should be for the missions' sake, or null when
 * the fight is the only mission. One ship per errand — the nearest fit hull of
 * its side — so a flag needs a runner, not a fleet; everyone else fights, and
 * the fight follows the runner on its own (the enemy converges on the same
 * point for the same reason).
 */
export function missionAnchor(
  defs: readonly MissionDef[],
  states: readonly MissionState[],
  ships: readonly ShipState[],
  ship: ShipState,
  reach: number,
  round: number,
): { point: Point; hold: number } | null {
  const nearestOfSide = (target: Point): ShipState | null => {
    let best: ShipState | null = null
    let bestDist = Infinity
    for (const s of ships) {
      if (s.side !== ship.side || !fitAt(s, round)) continue
      const d = actualRange(s.placement.position, target)
      if (d < bestDist || (d === bestDist && best !== null && s.id < best.id)) {
        best = s
        bestDist = d
      }
    }
    return best
  }

  for (const [i, def] of defs.entries()) {
    const state = states[i]
    if (def.kind === 'cargo') {
      if (state.delivered) continue
      // Carrying it: wantsToLeave turns the ship for home; no anchor needed.
      if (state.carrierId === ship.id) return null
      if (state.position && nearestOfSide(state.position)?.id === ship.id) {
        return { point: state.position, hold: Math.max(0, def.radius - 1) }
      }
    }
    if (def.kind === 'rescue' && state.soulsLeft > 0) {
      if (nearestOfSide(def.position)?.id === ship.id) {
        return { point: def.position, hold: Math.max(1, reach - 1) }
      }
    }
    if (def.kind === 'hold') {
      if (nearestOfSide(def.center)?.id === ship.id) {
        return { point: def.center, hold: Math.max(0, def.radius - 1) }
      }
    }
  }
  return null
}

/** The cargo mission this ship is carrying, if any — its ticket home. */
export function carryingCargo(
  defs: readonly MissionDef[],
  states: readonly MissionState[],
  shipId: string,
): boolean {
  return states.some((s, i) => defs[i].kind === 'cargo' && s.carrierId === shipId && !s.delivered)
}
