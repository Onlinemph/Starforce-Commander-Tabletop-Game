/**
 * Pirates — the incentive not to mass one giant fleet.
 *
 * The designer, verbatim: "if you don't have a ship on patrol near one of
 * your star systems, then there might be pirate attacks that cause you to
 * lose victory points." So: every star system belongs to whichever side of
 * the frontier it sits on, and at every round tick each owned system with no
 * friendly unit on patrol nearby rolls for a raid. A raid costs the owner
 * victory points and makes the news (state.events). A single ship standing
 * picket deters the clans entirely — which is exactly the point: the fleet
 * that stacks into one fist pays for it a system at a time.
 *
 * All numbers are the designer's balance dials, per scenario, in
 * `tuning.pirates`; the defaults below are provisional until his balancing
 * pass ("Figuring out the balance will take a bit").
 */

import { hexDistance } from './hexmap'
import {
  nextRandom,
  type CampaignMap,
  type CampaignScenario,
  type CampaignState,
  type Hex,
  type Side,
} from './types'

export interface PirateConfig {
  enabled: boolean
  raidChance: number
  raidVp: number
  patrolRange: number
}

export const PIRATE_DEFAULTS: PirateConfig = {
  enabled: true,
  raidChance: 0.15,
  raidVp: 2,
  patrolRange: 2,
}

export function resolvePirates(tuning?: CampaignScenario['tuning']['pirates']): PirateConfig {
  return { ...PIRATE_DEFAULTS, ...tuning }
}

/**
 * Whose space a star system sits in: the side of the FRONTIER it is on.
 * Measured against the nearest border hex — the border is a jagged line, so
 * a single column comparison would misfile systems near its kinks. A system
 * ON the border is contested and belongs to nobody; the clans leave the
 * warzone alone.
 */
export function systemOwner(map: CampaignMap, hex: Hex): Side | null {
  if (map.border.length === 0) return null
  let nearest = map.border[0]
  let best = Infinity
  for (const b of map.border) {
    const d = hexDistance(b, hex)
    if (d < best || (d === best && (b.q < nearest.q || (b.q === nearest.q && b.r < nearest.r)))) {
      nearest = b
      best = d
    }
  }
  if (hex.q === nearest.q) return null
  return hex.q < nearest.q ? 'A' : 'B'
}

/** The events feed stays a feed, not an archive. */
const EVENT_CAP = 60

/**
 * The round tick's pirate pass. Systems are visited in fixed (q, r) order and
 * only unpatrolled ones roll, so the rng stream replays. The ledger may go
 * negative — a coast left open long enough is a coast that lost the war's
 * accounting, which is the pressure the mechanic exists to apply.
 */
export function pirateRaidTick(
  ctx: { map: CampaignMap; scenario: CampaignScenario },
  state: CampaignState,
): void {
  const cfg = resolvePirates(ctx.scenario.tuning.pirates)
  if (!cfg.enabled || cfg.raidChance <= 0) return

  const systems = ctx.map.terrain
    .filter((t) => t.kind === 'system')
    .sort((a, b) => a.q - b.q || a.r - b.r)

  for (const sys of systems) {
    const hex = { q: sys.q, r: sys.r }
    const owner = systemOwner(ctx.map, hex)
    if (!owner) continue
    const patrolled = state.units.some(
      (u) => u.side === owner && hexDistance(u.hex, hex) <= cfg.patrolRange,
    )
    if (patrolled) continue
    if (nextRandom(state.rng) >= cfg.raidChance) continue

    state.vp[owner] -= cfg.raidVp
    state.events.push({
      round: state.round,
      side: owner,
      hex,
      text:
        `Pirate raid on the unpatrolled system at ${hex.q},${hex.r} — ` +
        `Commander ${owner} loses ${cfg.raidVp} VP. A ship within ` +
        `${cfg.patrolRange} hex${cfg.patrolRange === 1 ? '' : 'es'} deters the clans.`,
    })
    if (state.events.length > EVENT_CAP) state.events.splice(0, state.events.length - EVENT_CAP)
  }
}
