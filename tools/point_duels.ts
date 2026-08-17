/**
 * The duel test: which price list predicts single combat?
 *
 *     npx vite-node tools/point_duels.ts -- --games 8 --out tools/duel_results.csv
 *
 * Every panel hull fights every other one-on-one. No budget matching, no
 * counts — just the fight, so the results can be scored afterwards against
 * *any* pricing: does the printed list or the measured fleet-value list
 * better predict who wins a duel? The pairs where the two lists disagree
 * about the favorite are the ones that decide the question.
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

/** The same fourteen hulls the fleet calibration measured. */
const PANEL = [
  'union-nelson-ii-class-light-frigate',
  'union-xerxes-i-class-destroyer',
  'union-coventry-i-class-light-cruiser',
  'union-yorktown-i-class-heavy-cruiser',
  'union-yorktown-iii-class-heavy-cruiser',
  'union-kursk-i-class-battlecruiser',
  'union-exeter-ii-class-heavy-cruiser',
  'union-union-iii-class-dreadnought',
  'vallari-v-6l-savage-class-light-cruiser',
  'vallari-v-7c-raider-class-battlecruiser',
  'vallari-v-8a-ravager-class-destroyer',
  'vallari-v-7m-3-marauder-class-battlecruiser',
  'aurelian-corvus-i-class-destroyer',
  'aurelian-tonitrus-i-class-heavy-cruiser',
]

const games = Number(arg('games') ?? 8)
const rounds = Number(arg('rounds') ?? 12)
const rank = (arg('rank') ?? 'captain') as AiDifficulty
const out = arg('out') ?? 'tools/duel_results.csv'
const retreats = (arg('retreat') ?? 'on') !== 'off'

function runGame(idA: string, idB: string, seed: number) {
  registerCustomScenarios([
    {
      id: 'duel-test',
      name: 'Duel Test',
      background: '',
      victory: 'destruction',
      bounds: { width: 72, height: 72, fixed: true },
      terrain: [],
      sides: [
        { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 5 }, force: [idA] },
        { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: [idB] },
      ],
    },
  ])
  const game: GameState = startScenario('duel-test', { seed, mapScale: 2 })
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
  fs.writeFileSync(out, 'idA,idB,pvA,pvB,seed,vpA,vpB,healthA,healthB,endRound\n')
}
const done = new Set(
  fs
    .readFileSync(out, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const c = line.split(',')
      return `${c[0]}|${c[1]}|${c[4]}`
    }),
)

let played = 0
for (let i = 0; i < PANEL.length; i++) {
  for (let j = i + 1; j < PANEL.length; j++) {
    const idA = PANEL[i]
    const idB = PANEL[j]
    const pvA = shipFormById(idA)!.pointValue
    const pvB = shipFormById(idB)!.pointValue
    for (let g = 0; g < games; g++) {
      const seed = 9000 + g * 7919 + i * 131 + j * 17
      if (done.has(`${idA}|${idB}|${seed}`)) continue
      const r = runGame(idA, idB, seed)
      fs.appendFileSync(
        out,
        `${idA},${idB},${pvA},${pvB},${seed},${r.vpA},${r.vpB},${r.healthA.toFixed(3)},${r.healthB.toFixed(3)},${r.endRound}\n`,
      )
      played++
      if (played % 50 === 0) console.log(`${played} duels...`)
    }
  }
}
console.log(`done: ${played} duels played`)
