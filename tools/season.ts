/**
 * The season harness: the measuring instrument this project's balance claims
 * are made with.
 *
 * Every doctrine change here is argued with numbers, and the numbers come from
 * mirrored self-play — the same seed played from both hulls, so a scenario
 * that favours one side cannot be mistaken for a doctrine that favours one
 * side. The default is 192 games, and that is a consequence of the board.
 *
 * Seasons are fought on 72 inches (see SEASON_MAP_SCALE), where the rank gaps
 * are far narrower than they were on the printed 36 — the squadron admiral
 * beat an ensign 83% of the time on the small map and 59% here, because room
 * to recover from a mistake is room the better captain cannot punish. Smaller
 * effects need more games to see: at 64 the squadron baseline read 32W-32L,
 * a dead heat, which three times the sample shows was an afternoon's luck
 * rather than parity. 192 is the floor for a claim about doctrine now.
 *
 * Run it:
 *
 *   npm run season                    # the standing baselines
 *   npm run season -- --games 256     # a deeper look
 *   npm run season -- --scenario s3.6-target-the-flagship --hi admiral --lo captain
 *   npm run season -- --list          # what the baselines are and where they came from
 *
 * It is deliberately not part of `npm test`: a full season takes minutes, and
 * a test suite nobody runs is worse than one that measures nothing.
 */

import { startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import {
  aiNextActions,
  createAiMemo,
  type AiDifficulty,
  type AiMemo,
  type AiPersonality,
} from '../src/engine/ai'
import { activeShips, victoryPoints, type GameState } from '../src/engine/game'

export { health } from '../src/engine/battleScore'
import { health } from '../src/engine/battleScore'

/**
 * The standing baselines. A change that moves these has to justify itself, and
 * a change that claims to improve the AI has to move at least one of them —
 * or show its gain somewhere else and leave these alone.
 */
export const BASELINES = [
  /*
   * Re-measured on the 72-inch board, at 192 games. The old numbers were taken
   * on the printed 36 at 64 games and are kept here because the size of the
   * change is the interesting part: every rank gap narrows on a big board,
   * because room to recover from a mistake is room the better captain cannot
   * punish. Nothing about the AI changed between these two columns — only the
   * board it was measured on.
   *
   *                        36" / 64 games        72" / 192 games
   *     duel adm-vs-capt   41W-23L   (64%)       105W-87L   (55%)
   *     duel adm-vs-ens    54W-10L   (84%)       117W-75L   (61%)
   *     squadron adm-ens   53W-11L   (83%)       110W-81L   (57%)
   *
   * The right-hand column is also read with the corrected health(): per hull
   * against its own structure, and half credit for a ship that left. It moves
   * these seasons by a game or two, because ships rarely reach the edge of a
   * 72-inch board — and it moves a UNION III against an EXETER II on the
   * printed map from 11W-26L to 28W-12L, which is the whole reason it was
   * rewritten.
   *
   * A useful side-effect: the board-edge margin that had to be widened to keep
   * heavy hulls on the printed map is worth almost nothing here — the same
   * three seasons run 104W-85L, 117W-75L, 114W-77L without it. Twice the board
   * fixes the whole class of problem that margin was patching. It stays,
   * because the printed map is still a legal board to fight on.
   */
  {
    label: 'duel adm-vs-capt',
    scenario: 's3.1-the-duel',
    hi: 'admiral',
    lo: 'captain',
    /*
     * 105W-87L → 110W-82L with tractor doctrine (J3), and that five games is
     * noise rather than a gain: the same matchup over 384 games reads
     * 210W-174L, which is 54.7% — the rate the 105W-87L baseline already was,
     * to one decimal. Recorded because it is what a re-run now prints, not
     * because the captain got better at anything.
     */
    // → 105W-87L when the allocation order was searched. The admiral did not
    // get worse: every rank now repairs its shields before it buys the first
    // drive point, so the gap between two captains who both learned the same
    // lesson closes again. Held against a fixed opponent the new order is
    // worth 412/576 against 355 — see DEFAULT_ALLOCATION_ORDER.
    // → 129W-62L with the admiral's evolved plot weights (see
    // TUNED_PLOT_WEIGHTS). Held-out validation is the claim, not this: on
    // three scenarios the search never scored against, 59.4% → 71.2%.
    expect: '129W-62L of 192',
  },
  {
    label: 'duel adm-vs-ens',
    scenario: 's3.1-the-duel',
    hi: 'admiral',
    lo: 'ensign',
    // → 137W-55L with the searched allocation order, → 172W-19L with the
    // evolved plot weights.
    expect: '172W-19L of 192',
  },
  {
    label: 'squadron adm-vs-ens',
    scenario: 'exp2-squadron-engagement',
    hi: 'admiral',
    lo: 'ensign',
    // On the printed board this ran 51W-13L → 51W-12L when scout sensors were
    // wired into informational scans (H3.6), → 52W-11L when E8.5.4's
    // restriction was tied to the damage rather than a phase count, → 53W-11L
    // with the board-edge margin. All of that history is small-map history.
    // Then 108W-82L → 110W-81L on the 72-inch board when the captain started
    // checking where a plot commits the ship rather than only where it ends:
    // a squadron has more hulls to fly into a corner than a duel does.
    // → 122W-68L with precise turn rates (C3.9.1), and → 120W-72L before
    // them when the command ship was finally switched on (H5): the
    // admiral designates a flag, powers its GEN SYS to MAX so the CMND boxes
    // produce at all (H5.1.3), and lends tactical scan to the hulls whose own
    // sensor rating caps them lower (H5.2.2). The duels do not move, and
    // should not — a lone ship has nobody to lend to. Buying that GEN SYS
    // point *early* is the whole trick: queued after the guns and the eyes it
    // never got power, and the season did not move by a single game.
    // → 120W-69L with tractor doctrine (J3) and marine doctrine (J6), which is
    // inside the noise both ways; neither is claimed as a gain. See the
    // comments on `planTractors` and `planBoarding` for what they are for.
    // → 135W-57L with the searched allocation order: shield repair (G1.3.3)
    // ahead of the first drive point, reinforcement (G1.3.2) to the very back.
    // → 142W-50L when fire discipline stopped holding the ship along with the
    // long shot: the all-red gate ran after target selection, so a captain
    // that rejected its best-scoring target stood down entirely instead of
    // firing at a hull sitting in a green bracket somewhere else.
    // → 171W-21L with the evolved plot weights.
    expect: '171W-21L of 192',
  },
] as const

interface Side {
  game: GameState
  memo: AiMemo
  sides: string[]
  difficulty: AiDifficulty
}

/** Run one side's captains until they have nothing left to say. */
function drive(side: Side, closing: boolean, retreat: boolean, personality: AiPersonality): void {
  for (let guard = 0; guard < 400; guard++) {
    const batch = aiNextActions(
      side.game,
      side.sides,
      side.memo,
      closing,
      side.difficulty,
      personality,
      retreat,
    )
    if (batch.length === 0) return
    for (const action of batch) applyAction(side.game, action as GameAction)
    closing = false
  }
  throw new Error('the captains never settled')
}

export interface GameOptions {
  scenario: string
  seed: number
  blue: AiDifficulty
  red: AiDifficulty
  rounds: number
  retreat: boolean
  personality: AiPersonality
  setup?: Record<string, unknown>
}

/**
 * Every season is fought on a 72-inch board — `mapScale: 2`, the printed 36
 * doubled in both directions — and that is the house standard for measurement
 * here, not a per-run choice.
 *
 * The printed map is small enough to be a participant. A hull that needs
 * twenty inches to come to a stop, or that cannot turn at all at its best
 * speed (C2.2.2 prints a `0` in that row for several), runs out of board
 * before it runs out of options: the UNION dreadnoughts sailed off the edge in
 * most duels they were winning, which says more about 36 inches than about the
 * ships. At 72 there is room to be out-fought rather than out-run, so what the
 * numbers measure is doctrine instead of geometry.
 *
 * Pass `setup: { mapScale: 1 }` to fight on the printed board deliberately.
 */
export const SEASON_MAP_SCALE = 2

export function playOne(options: GameOptions): GameState {
  const game = startScenario(options.scenario, {
    seed: options.seed,
    mapScale: SEASON_MAP_SCALE,
    ...options.setup,
  })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const blue: Side = { game, memo: createAiMemo(), sides: [sides[0]], difficulty: options.blue }
  const red: Side = { game, memo: createAiMemo(), sides: [sides[1]], difficulty: options.red }
  /**
   * Both sides, until neither has anything left to say.
   *
   * Running each side to exhaustion once is not the same thing: an action by
   * one side can be what unblocks the other, and with a single pass that reply
   * has to wait for the next segment. Ordinarily the difference is invisible —
   * the baselines are identical either way — but under H4 the firing-step
   * clock is shared table state that the two sides wind forward alternately,
   * one step each, and a single pass gave a six-step clock two chances to
   * advance. The fleets spent the battle waiting for a step that never came.
   */
  const both = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      drive(blue, closing && pass === 0, options.retreat, options.personality)
      drive(red, closing && pass === 0, options.retreat, options.personality)
      if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
    }
  }
  both(false)
  for (let guard = 0; guard < 500; guard++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1) break
    if (game.round > options.rounds) break
    both(true)
    applyAction(game, { type: 'advance-segment' })
    both(false)
  }
  return game
}

export interface SeasonResult {
  label: string
  wins: number
  losses: number
  draws: number
  games: number
  averageMargin: number
}

/**
 * A mirrored season: every seed played twice, once from each hull, with the
 * result read from the *stronger* side's point of view. Playing both sides of
 * the same seed is what separates a doctrine that wins from a scenario that
 * favours whoever deploys in the east.
 */
export function season(
  label: string,
  scenario: string,
  games: number,
  hi: AiDifficulty,
  lo: AiDifficulty,
  extra: Partial<GameOptions> = {},
): SeasonResult {
  let wins = 0
  let losses = 0
  let margin = 0
  const seeds = Math.max(1, Math.floor(games / 2))
  for (let seed = 1; seed <= seeds; seed++) {
    for (const flipped of [false, true]) {
      const game = playOne({
        scenario,
        seed,
        blue: flipped ? lo : hi,
        red: flipped ? hi : lo,
        rounds: 12,
        retreat: true,
        personality: 'steady',
        ...extra,
      })
      const sides = [...new Set(game.ships.map((s) => s.side))]
      const delta = (health(game, sides[0]) - health(game, sides[1])) * (flipped ? -1 : 1)
      margin += delta
      if (delta > 0) wins++
      else if (delta < 0) losses++
    }
  }
  const played = seeds * 2
  return {
    label,
    wins,
    losses,
    draws: played - wins - losses,
    games: played,
    averageMargin: Math.round((margin / played) * 10) / 10,
  }
}

/** Victory points to the first side, averaged — for asymmetric matchups. */
export function pointMargin(game: GameState, side: string): number {
  const points = victoryPoints(game)
  const enemy = Object.keys(points).find((s) => s !== side)
  return points[side] - (enemy ? points[enemy] : 0)
}
