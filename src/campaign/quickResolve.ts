/**
 * Quick Resolve = the AI plays it (design doc Part 8).
 *
 * No abstract combat table, no calibration loop: the same battle file the
 * "Fight this battle" button would load is played headlessly by the tactical
 * AI through the engine's public driver, and the same readback walks the
 * result home. Accurate by construction — the AI plays the same rules,
 * terrain, carried damage and disengagement the players would — and
 * inspectable: the returned battle file replays in the theater, so a dispute
 * about a skipped battle is settled by video, not by a multiplier.
 *
 * Deterministic in (campaign state, engagement): the seed comes from the
 * engagement identity, so campaign replay reproduces every quick battle
 * identically and two consoles can verify each other's results by hash.
 * The parity test pins the whole promise: quickResolve's record equals the
 * played-path-with-both-AI record, byte for byte.
 */

import { playBattle, playedBattleFile } from '../engine/selfPlay'
import type { AiDifficulty, AiPersonality } from '../engine/ai'
import { battleFileFor, hashText, readback } from './handoff'
import type { DetectionContext } from './detection'
import type { BattleRecord, CampaignState, PendingEngagement, Side, Unit } from './types'

export interface QuickResolveOptions {
  /** The doc says admiral; captain is the fast lane for tests and previews. */
  difficulty?: AiDifficulty
  rounds?: number
}

/**
 * Temperament from posture (Part 8): a side whose units were trying to
 * withdraw or shadow fights cautious, an interceptor fights aggressive,
 * everyone else steady.
 */
export function temperamentOf(units: Unit[]): AiPersonality {
  if (units.some((u) => u.order.mission?.type === 'intercept')) return 'aggressive'
  if (units.every((u) => u.order.engagement === 'withdraw' || u.order.mission?.type === 'shadow')) {
    return 'cautious'
  }
  return 'steady'
}

export interface QuickResolved {
  record: BattleRecord
  /** The full battle file, journal included — watch it in the replay theater. */
  battleText: string
}

/**
 * Resolve one pending engagement headlessly. Returns the journal-ready
 * record and the battle file it came from, or a string describing what
 * refused. Nothing here mutates the campaign — the record rides the next
 * phase move like any table-fought result.
 */
export function quickResolve(
  ctx: DetectionContext,
  state: CampaignState,
  campaignId: string,
  engagement: PendingEngagement,
  options: QuickResolveOptions = {},
): QuickResolved | string {
  const battle = battleFileFor(ctx, state, campaignId, engagement)
  const fileHash = hashText(JSON.stringify(battle))

  const unitsOf = (side: Side) =>
    engagement.unitIds[side]
      .map((id) => state.units.find((u) => u.id === id))
      .filter((u): u is Unit => Boolean(u))
  const personality: Partial<Record<string, AiPersonality>> = {
    'Alpha Command': temperamentOf(unitsOf('A')),
    'Beta Command': temperamentOf(unitsOf('B')),
  }

  const played = playBattle(battle.setup, {
    difficulty: options.difficulty ?? 'admiral',
    rounds: options.rounds ?? 15,
    retreats: true, // honest about retreat: hopeless odds fly for the door
    personality,
  })
  const battleText = JSON.stringify(playedBattleFile(battle.setup, played))
  const result = readback(state, engagement, battleText)
  if (typeof result === 'string') return result
  return { record: { engagementId: engagement.id, fileHash, result }, battleText }
}
