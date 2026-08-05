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
  /** Set when something happened here worth stopping for. */
  moment?: ReplayMoment
}

/**
 * The kinds of moment worth a mark on the bar, loudest last — a frame that is
 * both a volley and a kill is remembered as the kill.
 */
export type ReplayMoment = 'round' | 'volley' | 'kill'

const MOMENT_RANK: Record<ReplayMoment, number> = { round: 0, volley: 1, kill: 2 }

export interface ReplayTimeline {
  frames: ReplayFrame[]
  /** Frame indices where a new round begins — the chapter marks. */
  roundStarts: number[]
  /**
   * Every frame worth stopping at, in order.
   *
   * Most of a battle is bookkeeping: a 778-action squadron game is mostly
   * power allocations and segment advances, and watching it action by action
   * buries the four minutes anybody wants to see. These are the moments the
   * engine itself thought were worth writing down — a volley resolving, a ship
   * coming apart, a new round — so the bar can be marked and stepped through
   * by what happened rather than by how many clicks it took.
   */
  moments: Array<{ index: number; kind: ReplayMoment; text: string }>
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
  const moments: ReplayTimeline['moments'] = []
  let logged = game.log.length
  let round = game.round

  saved.actions.forEach((action, i) => {
    applyAction(game, action)
    const captions = game.log.slice(logged).map((e) => e.message)
    const frame: ReplayFrame = {
      index: i + 1,
      round: game.round,
      phase: game.phase,
      segment: game.segment,
      captions,
      action,
    }
    frames.push(frame)
    logged = game.log.length

    // What happened here, read off the engine's own words.
    const kill = captions.find((c) => / is destroyed\.| comes apart /.test(c))
    const volley = captions.find((c) => / fires on /.test(c))
    if (game.round !== round) {
      round = game.round
      roundStarts.push(i + 1)
      note(moments, frame, 'round', `Round ${game.round}`)
    }
    if (volley) note(moments, frame, 'volley', volley)
    if (kill) note(moments, frame, 'kill', kill)
  })

  return { frames, roundStarts, moments }
}

/**
 * Record a moment against a frame, keeping the loudest when several land at
 * once — a volley that kills is remembered as the kill, because that is what
 * somebody scrubbing the bar is looking for.
 */
function note(
  moments: ReplayTimeline['moments'],
  frame: ReplayFrame,
  kind: ReplayMoment,
  text: string,
): void {
  const existing = moments.at(-1)
  if (existing?.index === frame.index) {
    if (MOMENT_RANK[kind] <= MOMENT_RANK[existing.kind]) return
    moments[moments.length - 1] = { index: frame.index, kind, text }
  } else {
    moments.push({ index: frame.index, kind, text })
  }
  frame.moment = moments.at(-1)!.kind
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
