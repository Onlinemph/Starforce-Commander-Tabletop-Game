/**
 * Generate a training set for the learned plot evaluator (`plotModel.ts`).
 *
 * Play battles, watch every plot the captain commits to, and write down what
 * happened next. Three labels come out of each decision, because they differ
 * in how much of the result they can honestly claim credit for:
 *
 *   w   did this side win the battle, in the end
 *   t   structure this hull lost over the following round
 *   d   structure the enemy side lost over the same round
 *
 * `win` is the real objective and is what a chess engine would use. It is also
 * the most confounded thing here: a ship that is winning is close and
 * shooting, a ship that is losing is crippled and running, so a fit reads
 * position as a symptom of the scoreboard at least as much as a cause of it.
 * The other two are differenced over one round, so a hull that is merely
 * already ahead scores zero on them, and they are per hull rather than per
 * side — the tightest thing a plot is answerable for is what happened to the
 * ship that flew it.
 *
 * What the three of them measured, which is the finding worth keeping: `d`
 * fits at r 0.32 and `t` at r 0.15, and their *difference* fits at r 0.02.
 * Position predicts how much damage you do and how much you take, and predicts
 * the exchange not at all — engagement in this game is symmetric, and the
 * geometry that lets you shoot is the geometry that lets them shoot back.
 *
 * Battles are fought only on the scenarios the weight evolution trained on, so
 * that the held-out battles stay genuinely held out and the two experiments can
 * be compared to each other.
 *
 * Run it:
 *
 *   npm run selfplay -- --games 400 --out data/plots-a.jsonl
 *   npm run selfplay -- --games 400 --seed-base 5000 --out data/plots-b.jsonl
 *
 * Four shards on four cores is the way; `npm run train` reads several files.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import {
  aiNextActions,
  createAiMemo,
  type AiDifficulty,
  type AiMemo,
  type AiPersonality,
} from '../src/engine/ai'
import { health } from '../src/engine/battleScore'
import { structureRemaining } from '../src/engine/shipState'
import { PLOT_FEATURE_NAMES, setPlotExploration, setPlotRecorder } from '../src/engine/plotModel'
import { activeShips, type GameState } from '../src/engine/game'
import { SEASON_MAP_SCALE } from './season'

/**
 * The training battles. Deliberately not the three the evolution held out
 * (target-the-flagship, the Aurelian raid, the duel against an ensign) — a
 * value function that has seen a map is not being tested on it.
 *
 * The mix is on purpose: two hulls and six hulls teach different things, and
 * a model that only ever saw a duel would learn that "nearest enemy" and "the
 * target" are the same ship.
 */
const TRAINING = [
  's3.1-the-duel',
  'exp2-squadron-engagement',
  's3.3-orbital-ambush',
  'exp3-nebula-patrol',
  's3.4-first-strike',
  's3.5-mutual-surprise',
] as const

interface Sample {
  /** Which battle, so the fit can be split by game rather than by row. */
  g: number
  /** Final outcome for the side that made this plot: 1 win, 0 loss. */
  w: number
  /** Structure this hull lost over the following round, as a fraction. */
  t: number
  /** Structure the enemy side lost over the same round, per hull. */
  d: number
  f: number[]
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

interface Pending {
  side: string
  ship: string
  tick: number
  features: number[]
}

/** Structure left on a hull, as a fraction of its own printed track. */
function hullFraction(ship: { destroyed: boolean; form: { structure: Array<{ kind: string }> } }): number {
  const boxes = ship.form.structure.filter((e) => e.kind === 'box').length || 1
  return ship.destroyed ? 0 : structureRemaining(ship as never) / boxes
}

/**
 * One battle, with the plot recorder running.
 *
 * This is `playOne` from the season harness with a timeline stapled to it: the
 * health margin is read at the end of every segment, and every plot remembers
 * which segment it was made in, so the swing label is a lookup rather than a
 * second simulation.
 */
function playAndRecord(
  scenario: string,
  seed: number,
  gameIndex: number,
  difficulty: AiDifficulty,
  rows: Sample[],
): void {
  const game: GameState = startScenario(scenario, { seed, mapScale: SEASON_MAP_SCALE })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos: Record<string, AiMemo> = {}
  for (const side of sides) memos[side] = createAiMemo()

  const pending: Pending[] = []
  let tick = 0
  /*
   * Structure per hull and per side, read at the end of every segment. The
   * per-hull track is what makes the label causal: a plot is one ship's
   * decision, and the tightest thing it is answerable for is whether that
   * ship got shot over the following round.
   */
  const timeline: Array<{ ship: Record<string, number>; side: Record<string, number> }> = []
  const snapshot = () => {
    const ship: Record<string, number> = {}
    const side: Record<string, number> = {}
    const count: Record<string, number> = {}
    for (const s of game.ships) {
      const fraction = hullFraction(s)
      ship[s.id] = fraction
      side[s.side] = (side[s.side] ?? 0) + fraction
      count[s.side] = (count[s.side] ?? 0) + 1
    }
    for (const key of Object.keys(side)) side[key] /= count[key]
    timeline.push({ ship, side })
  }
  snapshot()

  setPlotRecorder((features, side, shipId) => {
    pending.push({ side, ship: shipId, tick, features })
  })

  const personality: AiPersonality = 'steady'
  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let guard = 0; guard < 400; guard++) {
          const batch = aiNextActions(
            game,
            [side],
            memos[side],
            closing && pass === 0 && guard === 0,
            difficulty,
            personality,
            true,
          )
          if (batch.length === 0) break
          for (const action of batch) applyAction(game, action as GameAction)
        }
      }
      if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
    }
  }

  drive(false)
  for (let guard = 0; guard < 500; guard++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1) break
    if (game.round > 12) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    tick += 1
    snapshot()
    drive(false)
  }
  setPlotRecorder(null)

  const final = health(game, sides[0]) - health(game, sides[1])
  const last = timeline.length - 1
  const round = (v: number) => Math.round(v * 1e4) / 1e4
  for (const entry of pending) {
    const sign = entry.side === sides[0] ? 1 : -1
    const enemySide = sides[entry.side === sides[0] ? 1 : 0]
    // A round is three phases, and three segments on is where the volley this
    // plot was flown for has actually landed.
    const now = timeline[Math.min(entry.tick, last)]
    const then = timeline[Math.min(last, entry.tick + 3)]
    rows.push({
      g: gameIndex,
      w: final * sign > 0 ? 1 : 0,
      t: round((now.ship[entry.ship] ?? 0) - (then.ship[entry.ship] ?? 0)),
      d: round(now.side[enemySide] - then.side[enemySide]),
      f: entry.features.map(round),
    })
  }
}

function main(): void {
  const games = Number(flag('games') ?? 240)
  const seedBase = Number(flag('seed-base') ?? 0)
  const out = flag('out') ?? 'data/plots.jsonl'
  /*
   * Both captains at the top rank. The recorder only fires for the admiral —
   * the model binds there, like every other tuned thing in `ai.ts` — so an
   * admiral-versus-ensign game would teach the model what beating a weak
   * opponent looks like, which is not the position it will be asked to judge.
   */
  const difficulty = (flag('rank') ?? 'admiral') as AiDifficulty
  /*
   * How often to fly a plot at random instead of the best one. Zero gives a
   * training set of positions this captain approves of and nothing else, which
   * is exactly the set a value function cannot rank candidates from — see
   * `setPlotExploration`. The recorded games are worse for it, on purpose.
   */
  const explore = Number(flag('explore') ?? 0.2)
  setPlotExploration(explore)
  console.log(`${games} battles at ${difficulty}, exploration ${explore}`)

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, '')
  const started = Date.now()
  let written = 0
  for (let i = 0; i < games; i++) {
    const scenario = TRAINING[i % TRAINING.length]
    const seed = seedBase + Math.floor(i / TRAINING.length) + 1
    const rows: Sample[] = []
    playAndRecord(scenario, seed, seedBase + i, difficulty, rows)
    appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    written += rows.length
    if ((i + 1) % 10 === 0) {
      const rate = (Date.now() - started) / 1000 / (i + 1)
      const left = Math.round(rate * (games - i - 1))
      console.log(`${i + 1}/${games} battles  ${written} plots  ~${left}s left`)
    }
  }
  console.log(`${written} plots of ${PLOT_FEATURE_NAMES.length} features → ${out}`)
}

main()
