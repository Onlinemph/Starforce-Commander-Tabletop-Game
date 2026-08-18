/**
 * Engagement — where the fog meets the table (design doc Part 7.1–7.2).
 *
 * After a phase's movement and scans, opposing units sharing a hex may have a
 * battle. The trigger is knowledge-gated, and the gate is the anti-leak rule
 * carried into combat: a unit whose presence is entirely unknown to the enemy
 * is never auto-engaged. Its owner chose a posture in advance — spring the
 * ambush, or stay silent and let them pass — and that choice was a standing
 * order, journalled like any other, not a peek at the umpire's map.
 *
 * Withdrawal (7.2) rolls the campaign stream: d6, +2 with a sprint in hand,
 * +2 in a nebula, +2 when the enemy's dossier on you is thin. Five or better
 * slips one hex away; less is a battle fought as the defender, caught
 * retreating.
 */

import { hexDistance, hexEquals, hexKey, hexNeighbors, inBounds, terrainAt } from './hexmap'
import { unitIsCloaked, unitProfile } from './detection'
import type { DetectionContext } from './detection'
import { shipFormById } from '../data/ships'
import {
  CONTACT_ATTRIBUTES,
  nextInt,
  type CampaignState,
  type Hex,
  type Side,
  type Unit,
} from './types'

/** Does `side` hold at least an exists-contact on this unit (7.1)? */
export function sideKnows(state: CampaignState, side: Side, unit: Unit): boolean {
  return state.contacts.some(
    (c) => c.side === side && c.targetUnitId === unit.id && c.attributes.exists !== undefined,
  )
}

/** How many rungs of this unit's dossier the enemy holds — the 7.2 modifier. */
function dossierDepth(state: CampaignState, enemy: Side, unit: Unit): number {
  const contact = state.contacts.find((c) => c.side === enemy && c.targetUnitId === unit.id)
  if (!contact) return 0
  return CONTACT_ATTRIBUTES.filter((a) => contact.attributes[a]).length
}

/** A sprint in hand: the 5.4 placeholder reads FTL rating two or better. */
function sprintAvailable(unit: Unit): boolean {
  return unit.ships.some((s) => (shipFormById(s.formId)?.ftlDriveBoxes ?? 0) >= 2)
}

/** One hex of separation for an escaper: the step that opens the most range. */
function escapeStep(ctx: DetectionContext, from: Hex, enemies: Unit[]): Hex {
  let best = from
  let bestScore = -1
  for (const n of hexNeighbors(from)) {
    if (!inBounds(n, ctx.map.width, ctx.map.height)) continue
    const score = Math.min(...enemies.map((e) => hexDistance(n, e.hex)))
    if (score > bestScore) {
      best = n
      bestScore = score
    }
  }
  return best
}

/**
 * Check every contested hex after a phase resolves (7.1). Per hex:
 *
 *  - Both sides known to each other → engagement, unless a side's every unit
 *    is postured to withdraw and its roll gets it out.
 *  - One side unknown → its posture decides: 'fight' springs the ambush,
 *    anything else stays silent and no battle happens. ('Withdraw' while
 *    invisible IS silence — nobody flees from a hunter who cannot see them.)
 *
 * Cloak is what makes hiding at range zero possible at all: the same-hex scan
 * always finds an uncloaked hull (4.3), so by the time this runs, co-located
 * uncloaked units know each other and ambush is a cloak's privilege.
 */
export function checkEngagements(ctx: DetectionContext, state: CampaignState): void {
  const contested = new Map<string, { hex: Hex; A: Unit[]; B: Unit[] }>()
  for (const unit of state.units) {
    const key = hexKey(unit.hex)
    let entry = contested.get(key)
    if (!entry) {
      entry = { hex: { ...unit.hex }, A: [], B: [] }
      contested.set(key, entry)
    }
    entry[unit.side].push(unit)
  }

  for (const { hex, A, B } of [...contested.values()]) {
    if (A.length === 0 || B.length === 0) continue
    // A hex already waiting on the table does not stack a second battle.
    if (state.pendingBattles.some((p) => hexEquals(p.hex, hex))) continue

    const aKnown = A.some((u) => sideKnows(state, 'B', u))
    const bKnown = B.some((u) => sideKnows(state, 'A', u))

    let ambushBy: Side | null = null
    if (!aKnown && !bKnown) continue // ships passing in the night, both dark
    if (!aKnown) {
      // A is invisible: engage only if A springs it.
      if (!A.some((u) => (u.order.engagement ?? 'fight') === 'fight')) continue
      ambushBy = 'A'
    } else if (!bKnown) {
      if (!B.some((u) => (u.order.engagement ?? 'fight') === 'fight')) continue
      ambushBy = 'B'
    }

    // Withdrawal (7.2): a side runs only if every unit of it wants to, and
    // only from a battle it can see coming — an ambushed side never rolls.
    let caughtRetreating: Side | null = null
    let escaped = false
    for (const [side, units, enemies] of [
      ['A', A, B],
      ['B', B, A],
    ] as Array<[Side, Unit[], Unit[]]>) {
      if (ambushBy && ambushBy !== side) continue // the ambushed learn too late
      if (ambushBy === side) continue // the ambusher chose this
      if (!units.every((u) => (u.order.engagement ?? 'fight') === 'withdraw')) continue
      const roll = 1 + nextInt(state.rng, 6)
      const thin = units.every((u) => dossierDepth(state, side === 'A' ? 'B' : 'A', u) <= 3)
      const total =
        roll +
        (units.some(sprintAvailable) ? 2 : 0) +
        (terrainAt(ctx.map, hex) === 'nebula' ? 2 : 0) +
        (thin ? 2 : 0)
      if (total >= 5) {
        const step = escapeStep(ctx, hex, enemies)
        for (const u of units) {
          u.hex = { ...step }
          u.movedLastOwnPhase = true
          u.course = { q: step.q - hex.q, r: step.r - hex.r }
        }
        escaped = true
      } else {
        caughtRetreating = side
      }
    }
    if (escaped) continue

    state.pendingBattles.push({
      id: `eg-${state.engagementSeq++}`,
      hex: { ...hex },
      round: state.round,
      phase: state.phase,
      unitIds: { A: A.map((u) => u.id), B: B.map((u) => u.id) },
      ambushBy,
      caughtRetreating,
    })
  }
}

/** May this unit hide at all right now? Ambush is a cloak's privilege. */
export function canHide(state: CampaignState, unit: Unit): boolean {
  const enemy: Side = unit.side === 'A' ? 'B' : 'A'
  return unitIsCloaked(unit) || !sideKnows(state, enemy, unit)
}

// Re-exported so handoff can size the ambusher's deployment edge.
export { unitProfile }
