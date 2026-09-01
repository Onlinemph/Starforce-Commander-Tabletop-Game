/**
 * Campaign objectives (the designer's "the player wins by achieving
 * objectives" roadmap, 10.1) — the scaffold his list will fill.
 *
 * An objective is scenario data: a side, a kind, a target, a price. The
 * state already knows enough to judge four kinds — a station destroyed, a
 * count of enemy hulls killed, a star system scouted, a hex held across
 * round ticks — and each is paid ONCE, at the round tick, into the same
 * public ledger the battles and convoys feed, with a dispatch for both
 * commanders. A side's own objectives show in its view; the enemy's do not
 * (their goals are their business, and finding out is the game).
 */

import { hexEquals, hexKey } from './hexmap'
import { pushEvent } from './scoring'
import type { CampaignObjective, CampaignScenario, CampaignState, Side } from './types'

/** How far along an objective is, for the view — done, or n of count. */
export function objectiveStatus(
  state: CampaignState,
  objective: CampaignObjective,
): { done: boolean; progress: number; count: number } {
  const done = state.objectivesDone.includes(objective.id)
  switch (objective.kind) {
    case 'destroy-ships': {
      const enemy: Side = objective.side === 'A' ? 'B' : 'A'
      const count = objective.count ?? 1
      return { done, progress: Math.min(count, state.shipsLost[enemy] ?? 0), count }
    }
    case 'hold-hex': {
      const count = objective.count ?? 1
      return { done, progress: Math.min(count, state.objectiveProgress[objective.id] ?? 0), count }
    }
    default:
      return { done, progress: done ? 1 : 0, count: 1 }
  }
}

function achieved(state: CampaignState, objective: CampaignObjective): boolean {
  switch (objective.kind) {
    case 'destroy-station': {
      const station = state.infrastructure.find((i) => i.id === objective.stationId)
      return Boolean(station?.destroyed)
    }
    case 'destroy-ships': {
      const enemy: Side = objective.side === 'A' ? 'B' : 'A'
      return (state.shipsLost[enemy] ?? 0) >= (objective.count ?? 1)
    }
    case 'scout-hex':
      return Boolean(objective.hex && (state.scouted[objective.side] ?? []).includes(hexKey(objective.hex)))
    case 'hold-hex': {
      // Progress is kept by the tick itself: consecutive ticks with a
      // friendly unit standing on the hex.
      return (state.objectiveProgress[objective.id] ?? 0) >= (objective.count ?? 1)
    }
  }
}

/**
 * The round tick's objectives pass: advance the held-hex clocks, then pay
 * whatever is newly achieved. Fixed order (scenario order), no dice.
 */
export function objectiveTick(scenario: CampaignScenario, state: CampaignState): void {
  const objectives = scenario.objectives ?? []
  if (objectives.length === 0) return
  state.objectivesDone ??= []
  state.objectiveProgress ??= {}
  for (const objective of objectives) {
    if (state.objectivesDone.includes(objective.id)) continue
    if (objective.kind === 'hold-hex' && objective.hex) {
      const held = state.units.some((u) => u.side === objective.side && hexEquals(u.hex, objective.hex!))
      state.objectiveProgress[objective.id] = held ? (state.objectiveProgress[objective.id] ?? 0) + 1 : 0
    }
    if (!achieved(state, objective)) continue
    state.objectivesDone.push(objective.id)
    state.vp[objective.side] += objective.vp
    const where = objective.hex ??
      state.infrastructure.find((i) => i.id === objective.stationId)?.hex ?? { q: 0, r: 0 }
    pushEvent(
      state,
      objective.side,
      where,
      `Objective achieved — Commander ${objective.side}: ${objective.text} (+${objective.vp} VP).`,
    )
  }
}
