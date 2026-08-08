/**
 * A learned value function for the movement planner.
 *
 * Everything else in `ai.ts` scores a plot with terms somebody wrote down and
 * a coefficient somebody chose. Searching those coefficients (`npm run
 * evolve`) was worth 40 games a season on held-out battles, which settled the
 * first half of the question — the terms carry real signal and the hand-set
 * balance was wrong. This is the second half: are the *terms themselves* the
 * ceiling? A model that is handed a wider set of measurements and left to find
 * its own combination can express things no one thought to write down —
 * whether a plot is good depends on the exchange ratio rather than on
 * firepower and incoming separately, say, or on being in the enemy's teeth in
 * a way that only matters when the shields are already down.
 *
 * The design, and why it is this and not a chess engine.
 *
 * A chess bot searches. Search is not on the table here: `structuredClone` of
 * a GameState costs 1.1 ms, a plot decision weighs up to 280 candidates, and a
 * season is 192 games — so a single ply of true lookahead is four orders of
 * magnitude over budget. What is affordable is a *static* evaluation that is
 * better than the hand-written one, and that is what this is: a small network
 * over features already computed inside the candidate loop, costing a few
 * hundred multiply-adds per candidate and no clones at all.
 *
 * The features are deliberately a superset of the hand scorer's terms. That
 * matters: it means the model is not being asked to rediscover range
 * discipline from raw coordinates, only to re-weight and combine things the
 * captain can already see. If it cannot beat the hand weights when it has
 * every one of their inputs plus a dozen more, the answer to "are the terms
 * the ceiling" is no, and the ceiling is somewhere else entirely.
 *
 * The pipeline is three tools:
 *
 *   npm run selfplay   # play battles, record every plot the captain chose
 *   npm run train      # fit a model on what those plots led to
 *   npm run evolve -- --model <file> --blends 0,1,3   # does it play better?
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT. No model ships, and this is the record of why.
 * ---------------------------------------------------------------------------
 *
 * The models fit well. On battles they had never seen, a 16-unit network
 * predicts which side wins a plot's battle at AUC 0.88, and predicts the
 * damage that side deals over the following round at r 0.32. Both are far
 * above the floor, and the floor is the interesting part: fitting only the
 * nine features that are constant across one decision — health, round,
 * posture, damage level, the scoreboard — reaches r 0.17. So the positional
 * features are carrying real information the scoreboard does not have. That
 * question, "is there signal in a wider set of terms", has a clear yes.
 *
 * Then every one of them made the captain worse, at every strength tried:
 *
 *     model            blend    training suite (192 games)
 *     none                 —    80.7%   ← the shipped captain
 *     damage dealt       1.0    67.2%
 *     damage dealt       3.0    64.6%
 *     damage dealt      -2.0    67.7%   ← sign reversed, and still worse
 *     win/loss           0.5    74.0%
 *     win/loss           1.0    74.5%
 *     win/loss           3.0    66.1%
 *     win/loss           8.0    68.2%
 *
 * The reversed-sign row is the one that settles it. If the model held real
 * ranking information and were merely pointed the wrong way, negating it would
 * help; instead it costs thirteen points, the same as pointing it the right
 * way. What the model adds to the plot score is not a signal with a sign. It
 * is noise, and a scorer that loses games to noise in both directions is a
 * scorer whose ranking is already right.
 *
 * Why a model can predict well and still rank badly — the lesson worth keeping:
 *
 *   - Prediction is not control. The fit learns which positions are followed
 *     by damage; the planner needs to know which *choice* causes it. A ship
 *     doing damage is usually a ship that was already winning, and the model
 *     is rewarded for noticing that, which teaches it nothing about the
 *     decision in front of it.
 *   - The candidates are off-distribution. Training positions are the ones the
 *     captain chose; at scoring time it is asked about 280 candidates it would
 *     have rejected. `setPlotExploration` was written for exactly this and
 *     flying one plot in five at random did improve the fit (AUC 0.83 → 0.88)
 *     without improving the play at all — so coverage was not the binding
 *     constraint either.
 *   - Position predicts damage dealt (r 0.32) and damage taken (r 0.15) and
 *     their difference not at all (r 0.02). Engagement here is symmetric: the
 *     geometry that lets you shoot is the geometry that lets them shoot back.
 *     There may simply be less separable positional advantage in this game
 *     than the question assumed.
 *
 * What this does not rule out: a policy learned against the season directly,
 * which is what the weight evolution already is and what worked. The route
 * that failed is specifically supervised regression on self-play outcomes,
 * used as a static evaluator. The machinery is kept because it is the only way
 * to ask this question again cheaply, and because the next person to have the
 * idea deserves the eight measurements rather than the intuition.
 */

/**
 * The measurements a plot is judged on.
 *
 * The first block varies from candidate to candidate — this is what the model
 * actually discriminates with. The second block is constant across one
 * decision and so cannot change a ranking on its own; it is here to give the
 * hidden layer something to condition on, which is the only way a linear model
 * over the first block can become "range matters more when the shields are
 * gone".
 *
 * Order is load-bearing: a model records the names it was trained with and
 * refuses to run against a different list, because a silently misaligned
 * feature vector is a model that appears to work and plays nonsense.
 */
export const PLOT_FEATURE_NAMES = [
  // --- positional: what this candidate changes ---
  /** Distance from the guns' preferred band, as a penalty. */
  'rangeErr',
  /** Kiting: inside the held band, and outside it. Scored separately because
   *  an inch too close costs far more than an inch too far. */
  'insideBand',
  'outsideBand',
  /** Bow round onto the target, continuous, and the threshold bonus. */
  'bearing',
  'bowOn',
  /** Dice brought to bear; the same scaled by the target's weakest facing;
   *  and the same again counting only brackets the captain would fire. */
  'firepower',
  'firepowerWeak',
  'firepowerLive',
  /** Shield presented to the aggregate threat axis. */
  'shieldFacing',
  /** Whether the shield being presented is this hull's worst. */
  'weakestExposed',
  /** The volley expected back from every visible enemy. */
  'incoming',
  /** Exchange ratio rather than the two sides of it separately. */
  'exchange',
  /** Asteroid cover taken at a legal speed, and full line-of-sight cover. */
  'cover',
  'hidden',
  'losBlocked',
  /** Stress the SIF eats, and stress that draws a card. */
  'stressCovered',
  'stressUncovered',
  /** How far into the stopping margin this plot reaches, and whether the
   *  speed it commits to takes the ship off the board before she can turn. */
  'edgeShort',
  'blindOff',
  /** The best follow-up available from here, one phase on. */
  'lookahead',
  /** Speed, the change in it, and the closing rate this plot produces. */
  'speed',
  'accel',
  'closing',
  'nearest',
  /** Turn taken as a fraction of the table's allowance (C3.9.1). */
  'turnRate',
  /** Standing in the enemy's teeth, and the crossing angle. */
  'inTheirTeeth',
  'crossing',
  /** Distance from the range band the *enemy* wants. */
  'theirBandErr',
  /** Speed over an asteroid field's safe speed along the path (K2.1.6). */
  'rockRisk',

  // --- context: constant across this decision, conditioning only ---
  'ownHealth',
  'sideHealth',
  'enemyHealth',
  'outnumber',
  'roundFrac',
  'posture',
  'stressFrac',
  'mountsReady',
  'damaged',
] as const

export type PlotFeatureName = (typeof PLOT_FEATURE_NAMES)[number]

export const PLOT_FEATURE_COUNT = PLOT_FEATURE_NAMES.length

/**
 * A trained evaluator. Stored as plain JSON so a model is a file that can be
 * diffed, checked in, and handed to `--model` without a runtime.
 *
 * `hidden` empty means a pure linear model, which is the honest baseline: if
 * the network beats the hand weights but the linear model does not, the gain
 * is in the interactions, and if they both do, it was only ever the balance.
 */
export interface PlotModel {
  names: readonly string[]
  /** Per-feature standardisation from the training set. */
  mean: number[]
  scale: number[]
  /** hidden[h][i]; empty for a linear model. */
  hidden: number[][]
  hiddenBias: number[]
  /** Output layer over the hidden units, or over the inputs when linear. */
  out: number[]
  outBias: number
  /**
   * How much of a plot's score this model is worth, alongside the hand terms.
   * Zero switches it off; a large value makes it the whole scorer. Measured
   * like everything else here, not chosen.
   */
  blend: number
  /** Free-form: what it was trained on, so a file explains itself. */
  note?: string
}

/**
 * The value this model puts on a position, as a logit rather than a
 * probability. Ranking is all we need and the logit keeps its resolution out
 * at the ends, where a sigmoid has squashed everything good into 0.99.
 */
export function plotModelValue(model: PlotModel, features: number[]): number {
  const { mean, scale, hidden, hiddenBias, out } = model
  if (hidden.length === 0) {
    let sum = model.outBias
    for (let i = 0; i < out.length; i++) sum += out[i] * ((features[i] - mean[i]) / scale[i])
    return sum
  }
  let sum = model.outBias
  for (let h = 0; h < hidden.length; h++) {
    const row = hidden[h]
    let z = hiddenBias[h]
    for (let i = 0; i < row.length; i++) z += row[i] * ((features[i] - mean[i]) / scale[i])
    sum += out[h] * Math.tanh(z)
  }
  return sum
}

/** A model whose feature list does not match this build is not usable. */
export function plotModelMatches(model: PlotModel): boolean {
  return (
    model.names.length === PLOT_FEATURE_COUNT &&
    model.names.every((name, i) => name === PLOT_FEATURE_NAMES[i])
  )
}

// ---------------------------------------------------------------------------
// Installation and recording
// ---------------------------------------------------------------------------

let installed: PlotModel | null = null

/**
 * Install an evaluator for the movement planner, or clear it.
 *
 * Like `setPlotWeights` and `setAllocationOrder`, this binds to the admiral
 * alone: a season is the admiral against a fixed lower rank, and a change
 * applied to both sides measures as zero however good it is.
 */
export function setPlotModel(model: PlotModel | null): void {
  if (model && !plotModelMatches(model)) {
    throw new Error(
      `plot model was trained on a different feature list (${model.names.length} features, this build has ${PLOT_FEATURE_COUNT})`,
    )
  }
  installed = model
}

export function activePlotModel(): PlotModel | null {
  return installed
}

export type PlotRecorder = (features: number[], side: string, shipId: string) => void

let recorder: PlotRecorder | null = null

/**
 * Watch the plots the captain actually commits to. The training set is
 * on-policy by construction — these are the positions this AI reaches, not
 * positions somebody imagined it might — which is what makes the labels mean
 * anything: the model learns what tends to follow from the decisions this
 * captain is really making.
 */
export function setPlotRecorder(fn: PlotRecorder | null): void {
  recorder = fn
}

export function plotRecorder(): PlotRecorder | null {
  return recorder
}

let exploration = 0

/**
 * Fly a fraction of plots at random while recording.
 *
 * This is not a difficulty setting and it must never reach a game anybody is
 * playing — it exists because a value function trained only on the plots the
 * captain chose cannot rank the ones it rejected. Every training position
 * would be a position this AI likes, and at scoring time the model is asked
 * about 280 candidates of which it has seen the shape of maybe one. What it
 * does with the other 279 is extrapolation, and extrapolation from a network
 * is not a mild loss of accuracy — it is a confident answer from nowhere.
 *
 * Taking a random plot sometimes is the cheapest cure: the training set then
 * contains positions reached by bad decisions as well as good ones, with real
 * labels attached, which is the only way the model can learn that they are
 * bad. It costs play strength in the recorded games, and that is the trade —
 * the labels get worse so that the coverage gets better.
 */
export function setPlotExploration(rate: number): void {
  exploration = Math.max(0, Math.min(1, rate))
}

export function plotExploration(): number {
  return recorder === null ? 0 : exploration
}
