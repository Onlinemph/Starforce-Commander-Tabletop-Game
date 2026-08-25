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

import { playBattle, playedBattleFile, type PlayBattleOptions, type PlayedBattle } from '../engine/selfPlay'
import type { GameSetup } from '../data/savedGame'
import type { AiDifficulty, AiPersonality } from '../engine/ai'
import { captureScars, scarsAreEmpty } from '../engine/shipState'
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

/** Did the fight actually happen? Nobody hurt, dead, taken or out the door = no. */
function undecided(game: PlayedBattle['game']): boolean {
  return game.ships.every(
    (s) =>
      !s.destroyed &&
      !s.derelict &&
      s.capturedBy === null &&
      !s.disengaged &&
      scarsAreEmpty(captureScars(s)),
  )
}

/**
 * Play an engagement's battle to a DECISION. The round clock is a cap, not a
 * promise of contact: the fleets deploy a full board apart, and a short clock
 * can land while they are still closing — the engagement would then read back
 * as if nothing happened at all (every hull fresh, nobody disengaged), which
 * is the playtest's "my ship auto-resolved against two others and came out
 * completely fresh". If the clock lands on a battle where literally nothing
 * happened, it gets more time — doubled, up to four times the asked-for
 * clock — and the replay is deterministic, so the extension replays the same
 * opening rounds and both consoles still derive the same result. A battle
 * where SOMETHING happened may still end on the clock: co-located survivors
 * re-engage next phase, so a mid-fight call continues rather than vanishes.
 */
export function playEngagement(setup: GameSetup, options: PlayBattleOptions): PlayedBattle {
  const asked = options.rounds ?? 15
  let rounds = asked
  let played = playBattle(setup, { ...options, rounds })
  while (rounds < asked * 4 && undecided(played.game)) {
    rounds *= 2
    played = playBattle(setup, { ...options, rounds })
  }
  return played
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

  const played = playEngagement(battle.setup, {
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
