/**
 * Tune the plot scorer's coefficients by evolution strategy.
 *
 * The premise, from the sweep that came before it: the two things in `ai.ts`
 * chosen by judgment rather than measured were the allocation order and these
 * nineteen weights. Searching the first was worth 57 games a season. This asks
 * the same question of the second, and the answer settles something bigger —
 * whether the AI's ceiling is its *weights* or its *features*. A big win here
 * means the terms are right and were badly balanced; a small one means the
 * scorer is near the best its current terms can do, and the next real gain has
 * to come from new terms (a learned value function) rather than better numbers.
 *
 * Method: (1+λ) evolution strategy with self-adapting step size. No
 * dependencies, no gradients — the fitness is a season, which is noisy,
 * discrete and not differentiable, and λ=3 parallel children is what four
 * cores will carry. Weights are searched in log space, because every one of
 * them is a positive scale factor and the interesting moves are multiplicative
 * (is firepower worth twice what it says, or half) rather than additive.
 *
 * On overfitting, which is the whole risk here. The fitness is fought on two
 * scenarios with one set of seeds; the winner is checked on scenarios and
 * seeds it has never been scored against, and if it does not survive that it
 * does not ship. The held-out set is looked at once, at the end, on purpose —
 * a validation set consulted every generation is just a slower training set.
 *
 * Run it:
 *
 *   npm run evolve                    # a full run, resumable
 *   npm run evolve -- --generations 8 # a short one
 *   npm run evolve -- --validate '<json>'   # score a weight set on holdout
 */

import { readFileSync } from 'node:fs'
import {
  DEFAULT_PLOT_WEIGHTS,
  TUNED_PLOT_WEIGHTS,
  setPlotWeights,
  type PlotWeights,
} from '../src/engine/ai'
import { setPlotModel, type PlotModel } from '../src/engine/plotModel'
import { season } from './season'

const KEYS = Object.keys(DEFAULT_PLOT_WEIGHTS) as Array<keyof PlotWeights>

/**
 * Training and validation are disjoint in both scenario and seed. `season()`
 * always starts from seed 1, so the held-out runs are given their own scenarios
 * — a different battle is a stronger test than a different seed anyway, since
 * the thing we are afraid of is a captain tuned to one map.
 */
const TRAIN = [
  { label: 'duel', scenario: 's3.1-the-duel', hi: 'admiral', lo: 'captain', games: 96 },
  { label: 'squadron', scenario: 'exp2-squadron-engagement', hi: 'admiral', lo: 'ensign', games: 96 },
] as const

const HOLDOUT = [
  { label: 'flagship', scenario: 's3.6-target-the-flagship', hi: 'admiral', lo: 'captain', games: 192 },
  { label: 'raid', scenario: 'exp5-aurelian-raid', hi: 'admiral', lo: 'captain', games: 192 },
  { label: 'duel-ens', scenario: 's3.1-the-duel', hi: 'admiral', lo: 'ensign', games: 192 },
] as const

type Suite = ReadonlyArray<{
  label: string
  scenario: string
  hi: 'admiral' | 'captain' | 'ensign'
  lo: 'admiral' | 'captain' | 'ensign'
  games: number
}>

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Win rate across a suite, as a fraction — the thing being maximised. */
function fitness(weights: PlotWeights, suite: Suite): { rate: number; detail: string } {
  setPlotWeights(weights)
  const scale = Number(flag('games-scale') ?? 1)
  let wins = 0
  let games = 0
  const parts: string[] = []
  for (const entry of suite) {
    const count = Math.max(2, Math.round(entry.games * scale))
    const result = season(entry.label, entry.scenario, count, entry.hi, entry.lo)
    wins += result.wins
    games += result.games
    parts.push(`${entry.label} ${result.wins}W-${result.losses}L`)
  }
  setPlotWeights(null)
  return { rate: wins / games, detail: parts.join('  ') }
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/** Deterministic normal deviate, so a run can be repeated exactly. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    const a = (state >>> 8) / 0x1000000
    state = (state * 1664525 + 1013904223) >>> 0
    const b = (state >>> 8) / 0x1000000
    // Box–Muller; `a` is never 0 because the shift keeps it above 2^-24.
    return Math.sqrt(-2 * Math.log(a + 1e-12)) * Math.cos(2 * Math.PI * b)
  }
}

function mutate(parent: PlotWeights, sigma: number, normal: () => number): PlotWeights {
  const child = { ...parent }
  for (const key of KEYS) {
    // Log space: these are scale factors, so a step means "×1.2", not "+0.2",
    // and nothing can wander to zero or negative and invert the term's meaning.
    child[key] = Math.max(1e-3, parent[key] * Math.exp(sigma * normal()))
  }
  return child
}

function show(weights: PlotWeights): string {
  return KEYS.map((k) => `${k}=${weights[k].toFixed(3)}`).join(' ')
}

function main(): void {
  /*
   * Blend sweep for a learned evaluator (`npm run train`). It lives here
   * rather than in its own tool so that TRAIN and HOLDOUT keep exactly one
   * definition: the value function has to be held to the same split the
   * weights were, or the two results cannot be compared and the holdout stops
   * being a holdout.
   *
   *   npm run evolve -- --model models/plot.json --blends 0.5,1,2,4
   *   npm run evolve -- --model models/plot.json --blends 2 --holdout
   */
  const modelPath = flag('model')
  if (modelPath) {
    const model = JSON.parse(readFileSync(modelPath, 'utf8')) as PlotModel
    const suite = process.argv.includes('--holdout') ? HOLDOUT : TRAIN
    console.log(`${modelPath}  ${model.note ?? ''}`)
    console.log(`suite: ${process.argv.includes('--holdout') ? 'HOLDOUT' : 'train'}`)
    for (const blend of (flag('blends') ?? '1').split(',').map(Number)) {
      setPlotModel(blend === 0 ? null : { ...model, blend })
      // Against the shipped weights, not the hand-set ones: the evolved
      // captain is the thing the model has to beat, and blend 0 is that
      // captain measured in the same run as its control.
      const result = fitness(TUNED_PLOT_WEIGHTS, suite)
      setPlotModel(null)
      console.log(`blend ${String(blend).padStart(5)}   ${(result.rate * 100).toFixed(1)}%   ${result.detail}`)
    }
    return
  }

  /*
   * Coordinate sweep: take the shipped weights and move one coefficient at a
   * time, hard, in both directions.
   *
   * This is the cheap first pass at a newly widened search space, and it earns
   * its place over jumping straight back to the evolution strategy for two
   * reasons. It is embarrassingly parallel — `--keys` shards it across cores,
   * where an ES is a chain — and it is *diagnostic*: an ES tells you where the
   * optimum is and a coordinate sweep tells you which coefficients the season
   * can even feel. Most of them cannot be felt at all, and knowing which is
   * worth more than another decimal place on the ones that can.
   *
   *   npm run evolve -- --coords --keys lead,leadTurn,edgeCrowd
   *   npm run evolve -- --coords --factors 0.5,2 --games-scale 1
   */
  if (process.argv.includes('--coords')) {
    const keys = (flag('keys')?.split(',') ?? KEYS) as Array<keyof PlotWeights>
    const factors = (flag('factors') ?? '0.5,2').split(',').map(Number)
    const base = fitness(TUNED_PLOT_WEIGHTS, TRAIN)
    console.log(`base    ${(base.rate * 100).toFixed(1)}%   ${base.detail}`)
    for (const key of keys) {
      for (const factor of factors) {
        const trial = { ...TUNED_PLOT_WEIGHTS, [key]: TUNED_PLOT_WEIGHTS[key] * factor }
        const result = fitness(trial, TRAIN)
        const delta = (result.rate - base.rate) * 100
        console.log(
          `${key.padEnd(16)} x${String(factor).padEnd(5)} ${(result.rate * 100).toFixed(1)}%  ` +
            `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}   ${result.detail}`,
        )
      }
    }
    return
  }

  const validate = flag('validate')
  if (validate) {
    const weights = { ...DEFAULT_PLOT_WEIGHTS, ...(JSON.parse(validate) as Partial<PlotWeights>) }
    const held = fitness(weights, HOLDOUT)
    console.log(`holdout ${(held.rate * 100).toFixed(1)}%   ${held.detail}`)
    return
  }

  const generations = Number(flag('generations') ?? 30)
  const lambda = Number(flag('lambda') ?? 3)
  const normal = makeRng(Number(flag('seed') ?? 20260808))

  let parent = { ...DEFAULT_PLOT_WEIGHTS }
  let parentFit = fitness(parent, TRAIN)
  let sigma = 0.25
  console.log(`gen  0  base   ${(parentFit.rate * 100).toFixed(1)}%   ${parentFit.detail}`)

  for (let generation = 1; generation <= generations; generation++) {
    let bestChild: PlotWeights | null = null
    let bestFit = parentFit
    for (let i = 0; i < lambda; i++) {
      const child = mutate(parent, sigma, normal)
      const fit = fitness(child, TRAIN)
      if (fit.rate > bestFit.rate) {
        bestFit = fit
        bestChild = child
      }
    }
    if (bestChild) {
      parent = bestChild
      parentFit = bestFit
      // The 1/5th rule, loosely: success means the neighbourhood is worth
      // exploring further out; failure means step in.
      sigma = Math.min(0.5, sigma * 1.3)
      console.log(`gen ${String(generation).padStart(2)}  +      ${(parentFit.rate * 100).toFixed(1)}%   ${parentFit.detail}`)
      console.log(`        ${show(parent)}`)
    } else {
      sigma = Math.max(0.03, sigma * 0.85)
      console.log(`gen ${String(generation).padStart(2)}  ·      ${(parentFit.rate * 100).toFixed(1)}%   sigma ${sigma.toFixed(3)}`)
    }
  }

  console.log(`\nbest on training: ${(parentFit.rate * 100).toFixed(1)}%`)
  console.log(JSON.stringify(parent))
  // Parallel restarts skip this and validate the winner once, at the end —
  // scoring every run against the holdout would turn it into a training set.
  if (process.argv.includes('--no-holdout')) return
  const held = fitness(parent, HOLDOUT)
  const baseHeld = fitness(DEFAULT_PLOT_WEIGHTS, HOLDOUT)
  console.log(`\nholdout  tuned ${(held.rate * 100).toFixed(1)}%   ${held.detail}`)
  console.log(`holdout  base  ${(baseHeld.rate * 100).toFixed(1)}%   ${baseHeld.detail}`)
}

main()
