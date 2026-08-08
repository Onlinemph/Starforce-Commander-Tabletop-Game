/**
 * Fit the learned plot evaluator on self-play data (`npm run selfplay`).
 *
 * A small feed-forward net — 38 inputs, one tanh hidden layer, one output —
 * trained with Adam and no dependencies. The size is set by what the movement
 * planner can afford, not by what would fit best: a plot decision weighs up to
 * 280 candidates and a season is 192 battles, so the forward pass has to cost
 * a few hundred multiply-adds and nothing more. That rules out anything deep
 * and rules in exactly this.
 *
 * The three questions this tool has to answer before a season is worth running:
 *
 *   1. Is there signal at all? Compare validation loss against predicting the
 *      base rate. If the features say nothing, stop here.
 *   2. Is the signal *positional*, or is the model just reading the scoreboard?
 *      `--only context` fits the nine features that are constant across one
 *      decision — health, round, posture, damage. Those cannot change a
 *      ranking, so whatever they score is the floor. A full model that only
 *      matches it has learned "the ship that is winning wins" and will play no
 *      better for knowing it.
 *   3. Do the interactions matter? `--hidden 0` is a plain linear model over
 *      the same features. If it ties the network, the gain was never in the
 *      interactions and the linear one should ship — it is faster and it can
 *      be read.
 *
 * Validation splits by *battle*, not by row. Two plots from the same game share
 * a label and most of their context; splitting by row would let the model
 * memorise a battle and call it generalisation.
 *
 * All three questions came back yes when this was run, and the captain still
 * played worse for it at every strength. That is the finding, and it is worth
 * stating here rather than only where the model lives: a validation number is
 * not a season, and nothing in this file can tell you whether a model plays.
 * Only `npm run evolve -- --model … --blends …` can. See `plotModel.ts`.
 *
 * Run it:
 *
 *   npm run train -- --data 'data/plots-*.jsonl' --label swing --hidden 16 --out models/plot.json
 *   npm run train -- --data 'data/plots-*.jsonl' --label win --only context
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { PLOT_FEATURE_NAMES, type PlotModel } from '../src/engine/plotModel'

const N = PLOT_FEATURE_NAMES.length
/** Where the constant-across-a-decision block starts. See PLOT_FEATURE_NAMES. */
const CONTEXT_FROM = PLOT_FEATURE_NAMES.indexOf('ownHealth')

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

/**
 * What a plot is answerable for. Four choices, from the longest causal chain
 * to the shortest.
 *
 * `win` is the real objective and the most confounded: a ship that is winning
 * is close and shooting, a ship that is losing is crippled and running, so the
 * fit reads position as a symptom of the scoreboard at least as much as a
 * cause of it. `swing` and `taken` difference that away — a hull already ahead
 * scores zero on them — at the price of a much noisier signal. `taken` is the
 * tightest of all, because the structure this hull loses over the next round
 * is the one thing its own helm is unambiguously answerable for; it is also
 * only half the job, and a captain that optimised it alone would fly away.
 */
const LABELS: Record<string, (row: { w: number; t: number; d: number }) => number> = {
  win: (r) => r.w,
  swing: (r) => r.d - r.t,
  taken: (r) => -r.t,
  dealt: (r) => r.d,
  /**
   * The two halves, weighted. `--mix 0` is pure offence and `--mix 1` is
   * `swing`, and the interesting values are in between for a reason that took
   * a measurement to see: position predicts damage dealt (r 0.20) and damage
   * taken (r 0.15) perfectly respectably, and predicts their *difference* not
   * at all (r 0.02). Engagement in this game is symmetric — the geometry that
   * lets you shoot is the geometry that lets them shoot back, and subtracting
   * one from the other subtracts away nearly everything a position knows. So
   * how much a captain should trade is a doctrine choice, not something the
   * data will settle, and it is set here and measured by season.
   */
  mix: (r) => r.d - MIX * r.t,
}

const MIX = Number(flag('mix') ?? 0.5)

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface Data {
  x: Float64Array
  y: Float64Array
  game: Int32Array
  rows: number
}

function load(pattern: string): Data {
  const dir = dirname(pattern) || '.'
  const stem = basename(pattern).replace('*', '')
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(stem.split('.')[0]) && f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
  if (files.length === 0) throw new Error(`no data files matching ${pattern}`)
  const label = flag('label') ?? 'swing'

  const xs: number[] = []
  const ys: number[] = []
  const gs: number[] = []
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue
      const row = JSON.parse(line) as { g: number; w: number; t: number; d: number; f: number[] }
      if (row.f.length !== N) throw new Error(`row has ${row.f.length} features, build has ${N}`)
      for (const v of row.f) xs.push(v)
      ys.push(LABELS[label](row))
      gs.push(row.g)
    }
  }
  console.log(`${files.length} files, ${ys.length} plots, label ${label}`)
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), game: Int32Array.from(gs), rows: ys.length }
}

// ---------------------------------------------------------------------------
// The net
// ---------------------------------------------------------------------------

interface Net {
  hidden: number
  W1: Float64Array
  b1: Float64Array
  W2: Float64Array
  b2: number
}

function makeNet(hidden: number, rng: () => number): Net {
  // Xavier-ish: keep the pre-activation variance near 1 so tanh starts in its
  // useful range rather than saturated flat.
  const s1 = Math.sqrt(1 / N)
  const s2 = hidden > 0 ? Math.sqrt(1 / hidden) : Math.sqrt(1 / N)
  return {
    hidden,
    W1: Float64Array.from({ length: hidden * N }, () => (rng() * 2 - 1) * s1),
    b1: new Float64Array(hidden),
    W2: Float64Array.from({ length: hidden > 0 ? hidden : N }, () => (rng() * 2 - 1) * s2),
    b2: 0,
  }
}

/** Forward pass for one row; `h` is scratch for the hidden activations. */
function forward(net: Net, x: Float64Array, at: number, h: Float64Array): number {
  if (net.hidden === 0) {
    let sum = net.b2
    for (let i = 0; i < N; i++) sum += net.W2[i] * x[at + i]
    return sum
  }
  let sum = net.b2
  for (let u = 0; u < net.hidden; u++) {
    let z = net.b1[u]
    const base = u * N
    for (let i = 0; i < N; i++) z += net.W1[base + i] * x[at + i]
    h[u] = Math.tanh(z)
    sum += net.W2[u] * h[u]
  }
  return sum
}

interface Adam {
  m: Float64Array
  v: Float64Array
}

function zeros(net: Net): { W1: Adam; b1: Adam; W2: Adam; b2: Adam } {
  const pair = (n: number) => ({ m: new Float64Array(n), v: new Float64Array(n) })
  return { W1: pair(net.W1.length), b1: pair(net.b1.length), W2: pair(net.W2.length), b2: pair(1) }
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

function main(): void {
  const data = load(flag('data') ?? 'data/plots.jsonl')
  const label = flag('label') ?? 'swing'
  const logistic = label === 'win'
  const hidden = Number(flag('hidden') ?? 16)
  const epochs = Number(flag('epochs') ?? 12)
  const decay = Number(flag('decay') ?? 1e-5)
  const lr = Number(flag('lr') ?? 3e-3)
  const only = flag('only')

  let state = 12345
  const rng = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }

  // Split by battle. One in five games is never trained on.
  const held = new Set<number>()
  for (let r = 0; r < data.rows; r++) if (data.game[r] % 5 === 0) held.add(data.game[r])
  const train: number[] = []
  const valid: number[] = []
  for (let r = 0; r < data.rows; r++) (held.has(data.game[r]) ? valid : train).push(r)
  console.log(`${train.length} train rows, ${valid.length} validation rows from ${held.size} held-out battles`)

  // Standardise on the training rows only.
  const mean = new Array(N).fill(0)
  const scale = new Array(N).fill(1)
  for (const r of train) for (let i = 0; i < N; i++) mean[i] += data.x[r * N + i]
  for (let i = 0; i < N; i++) mean[i] /= train.length
  for (const r of train) {
    for (let i = 0; i < N; i++) {
      const d = data.x[r * N + i] - mean[i]
      scale[i] += d * d
    }
  }
  for (let i = 0; i < N; i++) scale[i] = Math.max(1e-6, Math.sqrt(scale[i] / train.length))

  /*
   * Ablation by masking rather than by a narrower net: zeroing a standardised
   * feature is exactly "this measurement is always average", which is what we
   * mean by taking it away, and it keeps every model the same shape so the
   * losses are comparable to the digit.
   */
  const keep = new Float64Array(N).fill(1)
  if (only === 'context') for (let i = 0; i < CONTEXT_FROM; i++) keep[i] = 0
  if (only === 'positional') for (let i = CONTEXT_FROM; i < N; i++) keep[i] = 0
  if (only) console.log(`ablation: keeping ${only} features only`)

  const z = new Float64Array(data.rows * N)
  for (let r = 0; r < data.rows; r++) {
    for (let i = 0; i < N; i++) z[r * N + i] = keep[i] * ((data.x[r * N + i] - mean[i]) / scale[i])
  }

  // A regression target is standardised too; a binary one is left alone.
  let yMean = 0
  let yScale = 1
  if (!logistic) {
    for (const r of train) yMean += data.y[r]
    yMean /= train.length
    let variance = 0
    for (const r of train) variance += (data.y[r] - yMean) ** 2
    yScale = Math.max(1e-6, Math.sqrt(variance / train.length))
  }
  const target = (r: number) => (logistic ? data.y[r] : (data.y[r] - yMean) / yScale)

  const net = makeNet(hidden, rng)
  const opt = zeros(net)
  const h = new Float64Array(Math.max(1, hidden))
  const batch = 256
  let step = 0

  const loss = (rows: number[]): number => {
    let total = 0
    for (const r of rows) {
      const p = forward(net, z, r * N, h)
      const t = target(r)
      total += logistic
        ? Math.log(1 + Math.exp(-(2 * t - 1) * p)) // t in {0,1}
        : 0.5 * (p - t) ** 2
    }
    return total / rows.length
  }

  /** Rank AUC for the binary label; Pearson correlation for the continuous one. */
  const quality = (rows: number[]): string => {
    const scored = rows.map((r) => ({ p: forward(net, z, r * N, h), y: data.y[r] }))
    if (logistic) {
      scored.sort((a, b) => a.p - b.p)
      let positives = 0
      let rankSum = 0
      scored.forEach((s, i) => {
        if (s.y > 0.5) {
          positives += 1
          rankSum += i + 1
        }
      })
      const negatives = scored.length - positives
      if (positives === 0 || negatives === 0) return 'auc n/a'
      const auc = (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
      return `auc ${auc.toFixed(4)}`
    }
    let mp = 0
    let my = 0
    for (const s of scored) {
      mp += s.p
      my += s.y
    }
    mp /= scored.length
    my /= scored.length
    let cov = 0
    let vp = 0
    let vy = 0
    for (const s of scored) {
      cov += (s.p - mp) * (s.y - my)
      vp += (s.p - mp) ** 2
      vy += (s.y - my) ** 2
    }
    return `r ${(cov / Math.sqrt(Math.max(1e-12, vp * vy))).toFixed(4)}`
  }

  const bump = (w: Float64Array, g: Float64Array, a: Adam, index: number): void => {
    const grad = g[index] + decay * w[index]
    a.m[index] = 0.9 * a.m[index] + 0.1 * grad
    a.v[index] = 0.999 * a.v[index] + 0.001 * grad * grad
    const mh = a.m[index] / (1 - Math.pow(0.9, step))
    const vh = a.v[index] / (1 - Math.pow(0.999, step))
    w[index] -= (lr * mh) / (Math.sqrt(vh) + 1e-8)
  }

  const gW1 = new Float64Array(net.W1.length)
  const gb1 = new Float64Array(net.b1.length)
  const gW2 = new Float64Array(net.W2.length)
  const gb2 = new Float64Array(1)

  console.log(`epoch  0  train ${loss(train).toFixed(4)}  valid ${loss(valid).toFixed(4)}  ${quality(valid)}`)
  for (let epoch = 1; epoch <= epochs; epoch++) {
    // Fisher–Yates on a copy, so each epoch sees a different batch composition.
    const order = train.slice()
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (let start = 0; start < order.length; start += batch) {
      gW1.fill(0)
      gb1.fill(0)
      gW2.fill(0)
      gb2[0] = 0
      const end = Math.min(order.length, start + batch)
      const size = end - start
      for (let k = start; k < end; k++) {
        const r = order[k]
        const at = r * N
        const p = forward(net, z, at, h)
        const t = target(r)
        // d(loss)/d(output), for both losses.
        const d = logistic ? 1 / (1 + Math.exp(-p)) - t : p - t
        if (net.hidden === 0) {
          for (let i = 0; i < N; i++) gW2[i] += (d * z[at + i]) / size
        } else {
          for (let u = 0; u < net.hidden; u++) {
            gW2[u] += (d * h[u]) / size
            const dz = ((d * net.W2[u] * (1 - h[u] * h[u])) / size)
            gb1[u] += dz
            const base = u * N
            for (let i = 0; i < N; i++) gW1[base + i] += dz * z[at + i]
          }
        }
        gb2[0] += d / size
      }
      step += 1
      for (let i = 0; i < net.W2.length; i++) bump(net.W2, gW2, opt.W2, i)
      for (let i = 0; i < net.W1.length; i++) bump(net.W1, gW1, opt.W1, i)
      for (let i = 0; i < net.b1.length; i++) bump(net.b1, gb1, opt.b1, i)
      const b2 = Float64Array.of(net.b2)
      bump(b2, gb2, opt.b2, 0)
      net.b2 = b2[0]
    }
    console.log(
      `epoch ${String(epoch).padStart(2)}  train ${loss(train).toFixed(4)}  valid ${loss(valid).toFixed(4)}  ${quality(valid)}`,
    )
  }

  // The floor: what predicting the training mean would have scored.
  let base = 0
  if (logistic) {
    let rate = 0
    for (const r of train) rate += data.y[r]
    rate /= train.length
    for (const r of valid) base += -(data.y[r] * Math.log(rate) + (1 - data.y[r]) * Math.log(1 - rate))
    base /= valid.length
  } else {
    for (const r of valid) base += 0.5 * target(r) ** 2
    base /= valid.length
  }
  console.log(`constant-prediction validation loss ${base.toFixed(4)}`)

  if (hidden === 0) {
    console.log('\nlinear coefficients, largest first:')
    const ranked = PLOT_FEATURE_NAMES.map((name, i) => ({ name, w: net.W2[i] }))
      .filter((e) => Math.abs(e.w) > 1e-6)
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    for (const e of ranked) console.log(`  ${e.name.padEnd(16)} ${e.w >= 0 ? ' ' : ''}${e.w.toFixed(4)}`)
  }

  /*
   * Normalise the output to unit spread on the training set before writing.
   * That makes `blend` mean the same thing from one model to the next — score
   * points per standard deviation of the model's opinion — so a blend swept
   * for one file is a sensible starting point for the next.
   */
  const preds = train.map((r) => forward(net, z, r * N, h))
  const pm = preds.reduce((a, b) => a + b, 0) / preds.length
  const ps = Math.sqrt(preds.reduce((a, b) => a + (b - pm) ** 2, 0) / preds.length) || 1
  for (let i = 0; i < net.W2.length; i++) net.W2[i] /= ps
  net.b2 = (net.b2 - pm) / ps

  const out = flag('out')
  if (!out) return
  const model: PlotModel = {
    names: [...PLOT_FEATURE_NAMES],
    // Fold the ablation mask into the scale so a masked model is a plain
    // model. A huge finite divisor rather than Infinity: JSON has no infinity,
    // and a round-trip through `null` would divide by zero instead of by
    // everything.
    mean: mean.map((m, i) => (keep[i] ? m : 0)),
    scale: scale.map((s, i) => (keep[i] ? s : 1e12)),
    hidden: hidden === 0 ? [] : Array.from({ length: hidden }, (_, u) => Array.from(net.W1.subarray(u * N, u * N + N))),
    hiddenBias: Array.from(net.b1),
    out: Array.from(net.W2),
    outBias: net.b2,
    blend: Number(flag('blend') ?? 1),
    note: `label=${label} hidden=${hidden} epochs=${epochs} rows=${train.length}${only ? ` only=${only}` : ''}`,
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(model))
  console.log(`\nwrote ${out}  (${model.note})`)
}

main()
