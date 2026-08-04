/**
 * The season harness: the measuring instrument this project's balance claims
 * are made with.
 *
 * Every doctrine change here is argued with numbers, and the numbers come from
 * mirrored self-play — the same seed played from both hulls, so a scenario
 * that favours one side cannot be mistaken for a doctrine that favours one
 * side. Thirty-two games is noise; the defaults below are 64 and 128, which is
 * the smallest sample that has reliably distinguished a real effect from a
 * lucky afternoon in this codebase.
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
import { structureRemaining } from '../src/engine/shipState'

/**
 * The standing baselines. A change that moves these has to justify itself, and
 * a change that claims to improve the AI has to move at least one of them —
 * or show its gain somewhere else and leave these alone.
 */
export const BASELINES = [
  { label: 'duel adm-vs-capt', scenario: 's3.1-the-duel', hi: 'admiral', lo: 'captain', expect: '39W-24L of 64' },
  { label: 'duel adm-vs-ens', scenario: 's3.1-the-duel', hi: 'admiral', lo: 'ensign', expect: '55W-9L of 64' },
  {
    label: 'squadron adm-vs-ens',
    scenario: 'exp2-squadron-engagement',
    hi: 'admiral',
    lo: 'ensign',
    // Was 51W-13L until scout sensors were wired into informational scans
    // (H3.6): both fleets here carry a scout, and one whose scan reaches 21"
    // for three extra points instead of 8" for none changes what its captain
    // knows. Same 51 wins; one loss became a draw.
    expect: '51W-12L of 64',
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

export function playOne(options: GameOptions): GameState {
  const game = startScenario(options.scenario, { seed: options.seed, ...options.setup })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const blue: Side = { game, memo: createAiMemo(), sides: [sides[0]], difficulty: options.blue }
  const red: Side = { game, memo: createAiMemo(), sides: [sides[1]], difficulty: options.red }
  const both = (closing: boolean) => {
    drive(blue, closing, options.retreat, options.personality)
    drive(red, closing, options.retreat, options.personality)
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

/**
 * How well a side came out of it: structure still floating, nothing for a hull
 * that left, and a penalty for one that died. Coarser than victory points and
 * much harder to game — a fleet that wins on points while losing every hull
 * has not won anything.
 */
export function health(game: GameState, side: string): number {
  return game.ships
    .filter((s) => s.side === side)
    .reduce((sum, s) => sum + (s.destroyed ? -1 : s.disengaged ? 0 : structureRemaining(s)), 0)
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

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function report(result: SeasonResult, expected?: string): void {
  const rate = result.games > 0 ? Math.round((result.wins / result.games) * 100) : 0
  const line =
    `${result.label.padEnd(24)} ${String(result.wins).padStart(3)}W ` +
    `${String(result.losses).padStart(3)}L of ${result.games}  (${rate}%, margin ${result.averageMargin})`
  console.log(expected ? `${line}   baseline ${expected}` : line)
}

function main(): void {
  if (process.argv.includes('--list')) {
    console.log('Standing baselines — a change that moves these owes an explanation:\n')
    for (const b of BASELINES) console.log(`  ${b.label.padEnd(24)} ${b.expect}`)
    console.log('\nMirrored: every seed is played from both hulls. 32 games is noise; 64 is the floor.')
    return
  }

  const games = Number(flag('games', '64'))
  const scenario = flag('scenario')
  const started = Date.now()

  if (scenario) {
    const hi = (flag('hi', 'admiral') ?? 'admiral') as AiDifficulty
    const lo = (flag('lo', 'captain') ?? 'captain') as AiDifficulty
    report(season(`${scenario} ${hi}-vs-${lo}`, scenario, games, hi, lo))
  } else {
    for (const baseline of BASELINES) {
      report(
        season(baseline.label, baseline.scenario, games, baseline.hi, baseline.lo),
        baseline.expect,
      )
    }
  }
  console.log(`\n${((Date.now() - started) / 1000).toFixed(0)}s`)
}

main()
