import { afterEach, describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips } from './game'
import {
  activePlotModel,
  PLOT_FEATURE_COUNT,
  PLOT_FEATURE_NAMES,
  plotModelMatches,
  plotModelValue,
  setPlotModel,
  setPlotRecorder,
  type PlotModel,
} from './plotModel'

/**
 * The learned evaluator's plumbing.
 *
 * None of this tests whether the model plays well — only a season can say
 * that, and the one that shipped is argued for where it is defined. What is
 * tested here is everything that could go wrong silently: a feature vector
 * that drifts out of step with the names it was trained against, a model that
 * leaks into ranks it was never measured at, and a recorder that hands the
 * trainer rows full of NaN because some geometry divided by zero on an empty
 * board.
 *
 * The silent failure is the one worth guarding. A misaligned feature vector
 * does not throw — it produces a model that reads `incoming` where `bearing`
 * should be and plays confident nonsense, and every measurement downstream of
 * it is wasted.
 */

/** A model that returns exactly one feature, so its arithmetic is checkable. */
function probe(index: number, blend = 1): PlotModel {
  return {
    names: [...PLOT_FEATURE_NAMES],
    mean: new Array(PLOT_FEATURE_COUNT).fill(0),
    scale: new Array(PLOT_FEATURE_COUNT).fill(1),
    hidden: [],
    hiddenBias: [],
    out: PLOT_FEATURE_NAMES.map((_, i) => (i === index ? 1 : 0)),
    outBias: 0,
    blend,
  }
}

function fight(scenario: string, seed: number, rounds = 6, rank: 'ensign' | 'captain' | 'admiral' = 'admiral') {
  const game = startScenario(scenario, { seed, mapScale: 2 })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = sides.map(() => createAiMemo())
  const journal: GameAction[] = []
  const drive = (closing: boolean) => {
    for (const [index, side] of sides.entries()) {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, [side], memos[index], closing, rank)
        if (batch.length === 0) break
        for (const action of batch) {
          applyAction(game, action as GameAction)
          journal.push(action as GameAction)
        }
      }
    }
  }
  drive(false)
  for (let step = 0; step < 400; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    journal.push({ type: 'advance-segment' })
    drive(false)
  }
  return journal
}

afterEach(() => {
  setPlotModel(null)
  setPlotRecorder(null)
})

describe('the plot model’s arithmetic', () => {
  it('reads a standardised feature the way the trainer wrote it', () => {
    const model = probe(3)
    model.mean[3] = 2
    model.scale[3] = 4
    model.outBias = 0.5
    const features = new Array(PLOT_FEATURE_COUNT).fill(0)
    features[3] = 10
    expect(plotModelValue(model, features)).toBeCloseTo(0.5 + (10 - 2) / 4, 10)
  })

  it('runs a hidden layer through tanh', () => {
    const model = probe(0)
    model.hidden = [PLOT_FEATURE_NAMES.map((_, i) => (i === 0 ? 2 : 0))]
    model.hiddenBias = [0.25]
    model.out = [3]
    model.outBias = -1
    const features = new Array(PLOT_FEATURE_COUNT).fill(0)
    features[0] = 0.5
    expect(plotModelValue(model, features)).toBeCloseTo(-1 + 3 * Math.tanh(2 * 0.5 + 0.25), 10)
  })
})

describe('a model trained against a different build', () => {
  it('is refused rather than misread', () => {
    const stale = { ...probe(0), names: PLOT_FEATURE_NAMES.slice(0, 5) }
    expect(plotModelMatches(stale)).toBe(false)
    expect(() => setPlotModel(stale)).toThrow(/different feature list/)

    const renamed = { ...probe(0), names: [...PLOT_FEATURE_NAMES].reverse() }
    expect(plotModelMatches(renamed)).toBe(false)
  })
})

describe('the recorder', () => {
  it('hands the trainer one finite row per plot the admiral commits to', () => {
    const rows: number[][] = []
    const ids: string[] = []
    setPlotRecorder((features, side, shipId) => {
      rows.push(features)
      ids.push(`${side}/${shipId}`)
    })
    const journal = fight('exp2-squadron-engagement', 4)
    setPlotRecorder(null)

    expect(rows.length).toBeGreaterThan(20)
    for (const row of rows) {
      expect(row).toHaveLength(PLOT_FEATURE_COUNT)
      // A NaN here is a silent poison: it trains to NaN weights and the model
      // then scores every candidate identically, which reads as "the model
      // did nothing" rather than as a bug.
      expect(row.every((v) => Number.isFinite(v))).toBe(true)
    }
    // Both sides fly, and more than one hull each.
    expect(new Set(ids).size).toBeGreaterThan(2)
    expect(journal.some((a) => a.type === 'plot-maneuver')).toBe(true)
  })

  it('stays silent for ranks the model was never measured at', () => {
    /*
     * Every tuned thing in `ai.ts` binds to the admiral — the weights, the
     * allocation order, and this. A season is the admiral against a fixed
     * lower rank, so a change that reaches both sides measures as zero
     * however good it is, and one that reaches the *opponent* measures
     * backwards.
     */
    let seen = 0
    setPlotRecorder(() => {
      seen += 1
    })
    fight('s3.1-the-duel', 2, 3, 'captain')
    expect(seen).toBe(0)
    fight('s3.1-the-duel', 2, 3, 'admiral')
    expect(seen).toBeGreaterThan(0)
  })
})

describe('an installed model', () => {
  it('is not one of them, by default', () => {
    // No model ships — see the header of `plotModel.ts` for the eight seasons
    // that decided it. This is the guard against one arriving by accident:
    // installing a model changes how every admiral in the app flies, and it
    // would do so silently.
    expect(activePlotModel()).toBeNull()
  })

  it('changes nothing at all when its blend is zero', () => {
    // The escape hatch has to be exact: if a model at blend 0 moves a single
    // plot, then the measured effect of a model at blend 3 is partly the cost
    // of merely having one installed, and the whole sweep is unreadable.
    const before = fight('s3.1-the-duel', 7)
    setPlotModel(probe(5, 0))
    const after = fight('s3.1-the-duel', 7)
    expect(after).toEqual(before)
  })

  it('moves the helm when its blend is not', () => {
    const before = fight('s3.1-the-duel', 7)
    // `bearing` at a heavy blend: a captain paid this much to point its bow
    // at the enemy flies differently from one that is not.
    setPlotModel(probe(PLOT_FEATURE_NAMES.indexOf('bearing'), 60))
    const after = fight('s3.1-the-duel', 7)
    expect(after).not.toEqual(before)
  })
})
