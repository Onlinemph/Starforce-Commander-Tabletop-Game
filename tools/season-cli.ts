/**
 * The season command line.
 *
 * Split from `season.ts` so that importing `season()` or `playOne()` does not
 * fight a 192-game season as a side effect — which it did, for every probe and
 * for the sweep, costing four minutes and printing a page of season results in
 * front of whatever the caller meant to say. An entry-point guard cannot do
 * the job here: vite-node strips the script path out of `process.argv`
 * entirely, so a module has no way to tell whether it is the one that was run.
 */

import { readFileSync } from 'node:fs'
import { BASELINES, season, type SeasonResult } from './season'
import type { AiDifficulty } from '../src/engine/ai'
import { setPlotModel, type PlotModel } from '../src/engine/plotModel'

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
    console.log('\nMirrored: every seed is played from both hulls, on a 72" board. 192 is the floor.')
    return
  }

  const games = Number(flag('games', '192'))
  const scenario = flag('scenario')

  /*
   * Fly the admiral with a learned evaluator installed (`npm run train`). The
   * blend can be overridden here rather than re-trained, because it is the one
   * number in the model that is not fitted — how much of the plot's score the
   * network is worth has to be measured against the hand terms it is being
   * added to, and this is the instrument that measures it.
   */
  const modelPath = flag('model')
  if (modelPath) {
    const model = JSON.parse(readFileSync(modelPath, 'utf8')) as PlotModel
    const override = flag('blend')
    if (override !== undefined) model.blend = Number(override)
    setPlotModel(model)
    console.log(`model ${modelPath}  blend ${model.blend}  ${model.note ?? ''}\n`)
  }

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

// This file is the entry point and nothing imports it, so it simply runs.
main()
