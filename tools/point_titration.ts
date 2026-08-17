/**
 * Titration: how many cheap hulls is one big hull actually worth?
 *
 *     npx vite-node tools/point_titration.ts -- \
 *         --games 4 --rounds 12 --out tools/titration_results.csv
 *
 * The equal-points sweep proved the direction — swarms win, almost without
 * exception — but a fight that one-sided cannot measure *magnitude*: every
 * equal-points game saturates. So instead each anchor hull stands alone
 * against a probe swarm whose count steps through the range around parity,
 * and the count where the win rate crosses even IS the anchor's price in
 * probes. No model, no extrapolation: the break-even is read off the table.
 *
 * Measurement only; nothing in the game changes.
 */

import fs from 'node:fs'
import { FILE_FORMS, registerCustomForms, shipFormById } from '../src/data/ships'
import { registerCustomScenarios, startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo, type AiDifficulty, type AiMemo } from '../src/engine/ai'
import { activeShips, victoryPoints, type GameState } from '../src/engine/game'
import { health } from '../src/engine/battleScore'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

registerCustomForms(FILE_FORMS)

/** The hulls that stand alone. */
const ANCHORS = [
  'aurelian-tonitrus-i-class-heavy-cruiser', //  36
  'union-yorktown-iii-class-heavy-cruiser', //   42.3
  'union-kursk-i-class-battlecruiser', //        50.3
  'vallari-v-7m-3-marauder-class-battlecruiser', // 75
  'union-exeter-ii-class-heavy-cruiser', //     100.1
  'union-union-iii-class-dreadnought', //       158.5
  // The carrier: its price is half fighter wing, and a wing is already a
  // swarm — the concentration discount the curve applies to gunships has no
  // business touching it. Measured instead.
  'fan-union-ark-royal-fleet-carrier', //        99.2 (hull 47.3 + wing)
]

/** The swarms that press them. */
const PROBES = [
  'union-nelson-ii-class-light-frigate', //   15.5
  'union-xerxes-i-class-destroyer', //        16.3
  'vallari-v-6l-savage-class-light-cruiser', // 17
  'union-coventry-i-class-light-cruiser', //  20.2
  'aurelian-corvus-i-class-destroyer', //     22
  'union-yorktown-i-class-heavy-cruiser', //  23
  'vallari-v-7c-raider-class-battlecruiser', // 25
]

for (const id of [...ANCHORS, ...PROBES]) {
  if (!shipFormById(id)) {
    console.error(`No such form: ${id}`)
    process.exit(1)
  }
}

const games = Number(arg('games') ?? 4)
const rounds = Number(arg('rounds') ?? 12)
const rank = (arg('rank') ?? 'captain') as AiDifficulty
const out = arg('out') ?? 'tools/titration_results.csv'
/**
 * Subset filters for expensive ranks: `--anchors exeter,union-iii` and
 * `--probes nelson,yorktown-i` match by substring, and `--window 0.35,1.3`
 * narrows the probed ratio band around parity. The admiral thinks about a
 * hundred times longer per game than the captain, so its sweep has to spend
 * games where the crossing actually lives.
 */
const anchorFilter = arg('anchors')?.split(',')
const probeFilter = arg('probes')?.split(',')
const [ratioLo, ratioHi] = (arg('window') ?? '0.25,2.0').split(',').map(Number)
/**
 * `--retreat off` nails every hull to the deck. The admiral's hopeless-odds
 * doctrine declines any battle at three-to-one *by hull count*, so with
 * retreats on, a lone capital ship facing three frigates concedes half its
 * value without firing — and the titration measures the doctrine instead of
 * the combat. Off, the break-even is the fight itself.
 */
const retreats = (arg('retreat') ?? 'on') !== 'off'

function runGame(anchorId: string, probeId: string, n: number, seed: number) {
  registerCustomScenarios([
    {
      id: 'titration',
      name: 'Titration',
      background: '',
      victory: 'destruction',
      bounds: { width: 72, height: 72, fixed: true },
      terrain: [],
      sides: [
        { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 5 }, force: [anchorId] },
        { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: Array(n).fill(probeId) },
      ],
    },
  ])
  const game: GameState = startScenario('titration', { seed, mapScale: 2 })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let g = 0; g < 400; g++) {
          const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, rank, 'steady', retreats)
          if (batch.length === 0) break
          for (const a of batch) applyAction(game, a as GameAction)
        }
      }
      if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
    }
  }
  drive(false)
  for (let step = 0; step < 3000; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    drive(false)
  }
  const vp = victoryPoints(game)
  return {
    vpA: vp['Alpha Fleet'] ?? 0,
    vpB: vp['Beta Fleet'] ?? 0,
    healthA: health(game, 'Alpha Fleet'),
    healthB: health(game, 'Beta Fleet'),
    endRound: game.round,
  }
}

if (!fs.existsSync(out)) {
  fs.writeFileSync(out, 'anchor,probe,n,pvAnchor,pvProbes,seed,vpA,vpB,healthA,healthB,endRound\n')
}
const done = new Set(
  fs
    .readFileSync(out, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const c = line.split(',')
      return `${c[0]}|${c[1]}|${c[2]}|${c[5]}`
    }),
)

let played = 0
for (const anchorId of ANCHORS) {
  if (anchorFilter && !anchorFilter.some((f) => anchorId.includes(f))) continue
  const pvA = shipFormById(anchorId)!.pointValue
  for (const probeId of PROBES) {
    if (probeFilter && !probeFilter.some((f) => probeId.includes(f))) continue
    const pvP = shipFormById(probeId)!.pointValue
    for (let n = 1; n <= 8; n++) {
      // Probe the region around parity: far outside it the answer is known.
      const ratio = (n * pvP) / pvA
      if (ratio < ratioLo || ratio > ratioHi) continue
      for (let g = 0; g < games; g++) {
        const seed = 5000 + g * 7919 + ANCHORS.indexOf(anchorId) * 733 + PROBES.indexOf(probeId) * 89 + n * 13
        if (done.has(`${anchorId}|${probeId}|${n}|${seed}`)) continue
        const r = runGame(anchorId, probeId, n, seed)
        fs.appendFileSync(
          out,
          `${anchorId},${probeId},${n},${pvA},${(n * pvP).toFixed(1)},${seed},` +
            `${r.vpA},${r.vpB},${r.healthA.toFixed(3)},${r.healthB.toFixed(3)},${r.endRound}\n`,
        )
        played++
        if (played % 25 === 0) console.log(`${played} games...`)
      }
    }
  }
}
console.log(`done: ${played} games played`)
