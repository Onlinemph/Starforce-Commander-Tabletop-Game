/**
 * The public headless battle driver (Border Command 7.6.1).
 *
 * The interleaved AI loop that the measurement harnesses in `tools/` and the
 * self-play tests have each carried privately, exported once: both sides'
 * captains act until the board is quiet, the segment advances, and the game
 * ends when one side stands alone or the round limit lands. Deterministic in
 * (setup, options) — the same battle plays out identically everywhere, which
 * is what lets the campaign's Quick Resolve be "the AI plays it" rather than
 * a table of multipliers, and lets two consoles verify each other's headless
 * results byte for byte.
 */

import { buildGame, type GameSetup, type SavedGame } from '../data/savedGame'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo, type AiDifficulty, type AiMemo, type AiPersonality } from './ai'
import { activeShips, type GameState } from './game'

export interface PlayBattleOptions {
  difficulty?: AiDifficulty
  /** Per-side temperament; unset sides play steady. */
  personality?: Partial<Record<string, AiPersonality>>
  /** Whether captains may disengage and refuse hopeless battles. */
  retreats?: boolean
  /** Round limit; the fight is called when the clock lands on it. */
  rounds?: number
}

export interface PlayedBattle {
  game: GameState
  /** The full action journal: `{version: 1, setup, actions}` replays it. */
  actions: GameAction[]
}

export function playBattle(setup: GameSetup, options: PlayBattleOptions = {}): PlayedBattle {
  const difficulty = options.difficulty ?? 'captain'
  const retreats = options.retreats ?? true
  const rounds = options.rounds ?? 15

  const game = buildGame(setup)
  const actions: GameAction[] = []
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = new Map<string, AiMemo>(sides.map((s) => [s, createAiMemo()]))

  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let g = 0; g < 400; g++) {
          const batch = aiNextActions(
            game,
            [side],
            memos.get(side)!,
            closing && pass === 0 && g === 0,
            difficulty,
            options.personality?.[side] ?? 'steady',
            retreats,
          )
          if (batch.length === 0) break
          for (const action of batch) {
            applyAction(game, action)
            actions.push(action)
          }
        }
      }
      if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
    }
  }

  drive(false)
  for (let step = 0; step < 3000; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    actions.push({ type: 'advance-segment' })
    drive(false)
  }
  return { game, actions }
}

/** The played battle as a battle file, for the replay theater or readback. */
export function playedBattleFile(setup: GameSetup, played: PlayedBattle): SavedGame {
  return { version: 1, setup, actions: played.actions }
}
