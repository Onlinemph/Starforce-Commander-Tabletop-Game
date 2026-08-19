/**
 * Truth → per-side views (design doc 0.3.3, 4.4).
 *
 * This module is the wall. Player-facing code — a UI, a remote peer's
 * payload, a future campaign AI — receives a SideView and nothing else, and a
 * SideView is built by copying named fields, never by spreading truth objects:
 * a spread keeps whatever fields the source grows next year, and a leak you
 * built by accident is still a leak.
 *
 * What crosses the wall for the enemy: contact records with the umpire-only
 * fields stripped — no target unit id, no truth flags — at the position the
 * side believes, dead-reckoned while unobserved. What never crosses: enemy
 * units themselves, enemy standing orders, listening posts nobody has found,
 * and whether any word of a dossier is a lie (4.5 — finding out is the game).
 */

import { contactCollapsed, reckonedHex } from './detection'
import {
  CONTACT_ATTRIBUTES,
  type CampaignMap,
  type CampaignState,
  type ContactAttribute,
  type Hex,
  type Infrastructure,
  type Side,
  type Unit,
} from './types'

export interface ViewedAttribute {
  value: string
  stale: boolean
}

/** A contact as its owner sees it. Compare ContactRecord: no truth here. */
export interface ViewedContact {
  id: string
  attributes: Partial<Record<ContactAttribute, ViewedAttribute>>
  hex: Hex
  /** True when the position is a reckoning, not a fix from this phase. */
  positionEstimated: boolean
  /** Hexes of drift the reckoning may hide — one per unscanned round (4.4). */
  uncertainty: number
  lastScan: { round: number; phase: number }
  /** Three quiet rounds: a last-known marker, dossier withheld (4.4). */
  collapsed: boolean
}

/**
 * An engagement as one side sees it: its own committed units, the hex, and
 * whether it is the one springing the trap. The ENEMY's unit ids never
 * appear — what jumped you is learned at the table, from the battle file's
 * deployment, exactly as 7.3 intends.
 */
export interface ViewedEngagement {
  id: string
  hex: Hex
  round: number
  phase: number
  yourUnitIds: string[]
  youAmbush: boolean
  youWereCaughtRetreating: boolean
}

export interface SideView {
  side: Side
  round: number
  phase: number
  roundLimit: number
  finished: boolean
  map: CampaignMap
  /** Own units, whole — orders, debts, courses; they are yours. */
  units: Unit[]
  /** Own infrastructure, whole. */
  infrastructure: Infrastructure[]
  /**
   * Enemy infrastructure is on the charts (3.4, doc question 12.8) — except
   * listening posts, which appear only as contacts once found.
   */
  knownEnemyInfrastructure: Infrastructure[]
  contacts: ViewedContact[]
  /** Battles waiting on the table that this side is party to (7.1). */
  engagements: ViewedEngagement[]
  /**
   * YOUR reinforcement schedule (S3.2): what is coming and when, so a plan
   * can lean on it. The enemy's schedule never crosses — their arrivals are
   * simply new hulls in the fog, found the way anything is found.
   */
  incoming: Array<{ unitId: string; arrivesRound: number; kind: string; shipCount: number }>
  /** The scoreboard is public (10.1). */
  vp: Record<Side, number>
}

/**
 * The one way to look at a campaign from a chair. Everything returned is a
 * deep copy: handing a caller live references into truth would let mutation —
 * or serialization — walk back through the wall.
 */
export function viewFor(map: CampaignMap, state: CampaignState, side: Side): SideView {
  const contacts: ViewedContact[] = []
  for (const record of state.contacts) {
    if (record.side !== side) continue
    const collapsed = contactCollapsed(record)
    const attributes: Partial<Record<ContactAttribute, ViewedAttribute>> = {}
    for (const attr of CONTACT_ATTRIBUTES) {
      const entry = record.attributes[attr]
      if (!entry) continue
      // A collapsed contact keeps only its existence (4.4).
      if (collapsed && attr !== 'exists') continue
      attributes[attr] = { value: entry.value, stale: entry.stale }
    }
    const believed = reckonedHex(map, record, state)
    // "Scanned this phase" means the phase just resolved: the resolver has
    // already advanced the clock by the time anyone looks, so a fresh fix is
    // one from the previous slot, not the (still unresolved) current one.
    const prev =
      state.phase === 1 ? { round: state.round - 1, phase: 12 } : { round: state.round, phase: state.phase - 1 }
    const fresh = record.lastScan.round === prev.round && record.lastScan.phase === prev.phase
    contacts.push({
      id: record.id,
      attributes,
      hex: { q: believed.q, r: believed.r },
      positionEstimated: record.positionEstimated || !fresh,
      uncertainty: record.unscannedRounds,
      lastScan: { round: record.lastScan.round, phase: record.lastScan.phase },
      collapsed,
    })
  }

  const incoming = state.reinforcements
    .filter((r) => r.side === side)
    .map((r) => ({
      unitId: r.unit.id,
      arrivesRound: r.arrivesRound,
      kind: r.unit.kind as string,
      shipCount: r.unit.ships.length,
    }))

  const engagements: ViewedEngagement[] = state.pendingBattles
    .filter((p) => p.unitIds[side].length > 0)
    .map((p) => ({
      id: p.id,
      hex: { q: p.hex.q, r: p.hex.r },
      round: p.round,
      phase: p.phase,
      yourUnitIds: [...p.unitIds[side]],
      youAmbush: p.ambushBy === side,
      youWereCaughtRetreating: p.caughtRetreating === side,
    }))

  return {
    side,
    round: state.round,
    phase: state.phase,
    roundLimit: state.roundLimit,
    finished: state.finished,
    map: structuredClone(map),
    units: structuredClone(state.units.filter((u) => u.side === side)),
    infrastructure: structuredClone(state.infrastructure.filter((i) => i.side === side)),
    knownEnemyInfrastructure: structuredClone(
      state.infrastructure.filter((i) => i.side !== side && i.kind !== 'listening-post'),
    ),
    contacts,
    engagements,
    incoming,
    vp: { A: state.vp.A, B: state.vp.B },
  }
}
