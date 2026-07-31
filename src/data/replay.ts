import type { GameAction } from '../engine/actions'
import { applyAction } from '../engine/actions'
import type { GameState } from '../engine/game'
import type { Phase, Segment } from '../engine/types'
import { buildGame, type SavedGame } from './savedGame'

/**
 * The replay theater's data: a battle file scrubbed to any moment.
 *
 * The journal is the whole trick. A battle is (setup + actions) and the engine
 * is deterministic, so the game after N actions is a pure function of the
 * file — the same fact undo already stands on. The theater adds a timeline
 * built in one pass: what round each moment belongs to, and what the engine's
 * own log said as each action landed, which becomes the narration.
 */

export interface ReplayFrame {
  /** How many actions of the journal are applied at this moment. */
  index: number
  round: number
  phase: Phase
  segment: Segment
  /** What the engine logged as this action resolved — the narration. */
  captions: string[]
  /** The action that produced this frame (undefined for frame zero). */
  action?: GameAction
}

export interface ReplayTimeline {
  frames: ReplayFrame[]
  /** Frame indices where a new round begins — the chapter marks. */
  roundStarts: number[]
}

/** One pass over the journal, recording where every moment sits. */
export function buildTimeline(saved: SavedGame): ReplayTimeline {
  const game = buildGame(saved.setup)
  // Setup itself may speak — the round banner, terrain rolls — so frame zero
  // owns whatever the log holds before the first action.
  const frames: ReplayFrame[] = [
    {
      index: 0,
      round: game.round,
      phase: game.phase,
      segment: game.segment,
      captions: game.log.map((e) => e.message),
    },
  ]
  const roundStarts: number[] = []
  let logged = game.log.length
  let round = game.round

  saved.actions.forEach((action, i) => {
    applyAction(game, action)
    frames.push({
      index: i + 1,
      round: game.round,
      phase: game.phase,
      segment: game.segment,
      captions: game.log.slice(logged).map((e) => e.message),
      action,
    })
    logged = game.log.length
    if (game.round !== round) {
      round = game.round
      roundStarts.push(i + 1)
    }
  })

  return { frames, roundStarts }
}

/** The game as it stood after the first `index` actions. */
export function replayPrefix(saved: SavedGame, index: number): GameState {
  const game = buildGame(saved.setup)
  for (const action of saved.actions.slice(0, index)) applyAction(game, action)
  return game
}

/**
 * A caption for a quiet action — one the engine had nothing to say about.
 * Most bookkeeping clicks are quiet; the type itself reads well enough.
 */
export function actionLabel(action: GameAction): string {
  const words = action.type.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
