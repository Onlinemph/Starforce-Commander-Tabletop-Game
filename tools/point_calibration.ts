/**
 * The point-calibration sweep: does a point buy the same amount of winning
 * on every hull?
 *
 *     npx vite-node tools/point_calibration.ts -- \
 *         --games 3 --rounds 12 --rank captain --out tools/calibration_results.csv
 *
 * Mono-class fleets of a fixed panel of printed hulls fight every other
 * panel member at (as near as integers allow) equal points, the way the
 * fleet picker's budget matches them in real play. For each pair the hull
 * counts are chosen to minimize the point mismatch, and pairs that cannot
 * be matched within 12% are skipped rather than measured crooked. Every
 * game appends one CSV row, so a partial run is already data.
 *
 * The outcome recorded is the real game's currency — the S2.8 victory-point
 * margin — plus the season harness's health margin as a second reading.
 * Nothing here changes the game: this is the measuring instrument for the
 * question "is a swarm of cheap hulls worth more than its price says?"
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

/**
 * The panel: printed hulls spanning the price range and all three factions.
 * Fourteen hulls keep the round-robin affordable while covering 15 to 158
 * points; the fit for the rest of the roster comes from regressing these
 * measured values against the stats every form carries.
 */
const PANEL = [
  'union-nelson-ii-class-light-frigate', //   15.5
  'union-xerxes-i-class-destroyer', //        16.3
  'union-coventry-i-class-light-cruiser', //  20.2
  'union-yorktown-i-class-heavy-cruiser', //  23.0
  'union-yorktown-iii-class-heavy-cruiser', //42.3
  'union-kursk-i-class-battlecruiser', //     50.3
  'union-exeter-ii-class-heavy-cruiser', //  100.1
  'union-union-iii-class-dreadnought', //    158.5
  'vallari-v-6l-savage-class-light-cruiser', //  17
  'vallari-v-7c-raider-class-battlecruiser', //  25
  'vallari-v-8a-ravager-class-destroyer', //     47
  'vallari-v-7m-3-marauder-class-battlecruiser', // 75
  'aurelian-corvus-i-class-destroyer', //        22
  'aurelian-tonitrus-i-class-heavy-cruiser', //  36
]

for (const id of PANEL) {
  if (!shipFormById(id)) {
    console.error(`No such form: ${id}`)
    process.exit(1)
  }
}

const games = Number(arg('games') ?? 3)
const rounds = Number(arg('rounds') ?? 12)
const rank = (arg('rank') ?? 'captain') as AiDifficulty
const out = arg('out') ?? 'tools/calibration_results.csv'
const onlyPair = arg('pair') // "3,7" panel indexes, for spot checks / timing

const MAX_COUNT = 8
const MISMATCH_LIMIT = 0.12

/** Best integer counts for a near-equal-points fight, or null if none is fair. */
function matchCounts(pvA: number, pvB: number): { nA: number; nB: number } | null {
  let best: { nA: number; nB: number; miss: number; total: number } | null = null
  for (let nA = 1; nA <= MAX_COUNT; nA++) {
    for (let nB = 1; nB <= MAX_COUNT; nB++) {
      const a = nA * pvA
      const b = nB * pvB
      const miss = Math.abs(a - b) / ((a + b) / 2)
      if (miss > MISMATCH_LIMIT) continue
      // Prefer the fairest match; among equals, the bigger battle reads better.
      if (!best || miss < best.miss - 1e-9 || (Math.abs(miss - best.miss) <= 1e-9 && a + b > best.total)) {
        best = { nA, nB, miss, total: a + b }
      }
    }
  }
  return best && { nA: best.nA, nB: best.nB }
}

function runGame(idA: string, idB: string, nA: number, nB: number, seed: number) {
  registerCustomScenarios([
    {
      id: 'calibration',
      name: 'Calibration',
      background: '',
      victory: 'destruction',
      bounds: { width: 72, height: 72, fixed: true },
      terrain: [],
      sides: [
        { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 5 }, force: Array(nA).fill(idA) },
        { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: Array(nB).fill(idB) },
      ],
    },
  ])
  const game: GameState = startScenario('calibration', { seed, mapScale: 2 })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
  // The interleaved driver from the versus machine: both AIs act until the
  // board is quiet, so an out-scanned side still gets its binding turn.
  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let g = 0; g < 400; g++) {
          const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, rank, 'steady', true)
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
  const killed = (side: string) => game.ships.filter((s) => s.side === side && s.destroyed).length
  return {
    vpA: vp['Alpha Fleet'] ?? 0,
    vpB: vp['Beta Fleet'] ?? 0,
    healthA: health(game, 'Alpha Fleet'),
    healthB: health(game, 'Beta Fleet'),
    lostA: killed('Alpha Fleet'),
    lostB: killed('Beta Fleet'),
    endRound: game.round,
  }
}

if (!fs.existsSync(out)) {
  fs.writeFileSync(out, 'idA,idB,nA,nB,pvA,pvB,seed,vpA,vpB,healthA,healthB,lostA,lostB,endRound\n')
}
const done = new Set(
  fs
    .readFileSync(out, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const c = line.split(',')
      return `${c[0]}|${c[1]}|${c[6]}`
    }),
)

const pairs: Array<[number, number]> = []
for (let i = 0; i < PANEL.length; i++) {
  for (let j = i + 1; j < PANEL.length; j++) pairs.push([i, j])
}
const selected = onlyPair ? [onlyPair.split(',').map(Number) as [number, number]] : pairs

let played = 0
let skipped = 0
for (const [i, j] of selected) {
  const idA = PANEL[i]
  const idB = PANEL[j]
  const pvA = shipFormById(idA)!.pointValue
  const pvB = shipFormById(idB)!.pointValue
  const match = matchCounts(pvA, pvB)
  if (!match) {
    skipped++
    continue
  }
  const { nA, nB } = match
  for (let g = 0; g < games; g++) {
    const seed = 1000 + g * 7919 + i * 131 + j * 17
    if (done.has(`${idA}|${idB}|${seed}`)) continue
    const t0 = Date.now()
    const r = runGame(idA, idB, nA, nB, seed)
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    fs.appendFileSync(
      out,
      `${idA},${idB},${nA},${nB},${(nA * pvA).toFixed(1)},${(nB * pvB).toFixed(1)},${seed},` +
        `${r.vpA},${r.vpB},${r.healthA.toFixed(3)},${r.healthB.toFixed(3)},${r.lostA},${r.lostB},${r.endRound}\n`,
    )
    played++
    console.log(
      `[${played}] ${nA}x ${idA.split('-').slice(1, 3).join(' ')} vs ${nB}x ${idB.split('-').slice(1, 3).join(' ')} ` +
        `seed ${seed}: vp ${r.vpA}-${r.vpB} health ${r.healthA.toFixed(2)}-${r.healthB.toFixed(2)} (${secs}s)`,
    )
  }
}
console.log(`done: ${played} games played, ${skipped} pairs unmatched within ${MISMATCH_LIMIT * 100}%`)
