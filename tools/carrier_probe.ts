/**
 * Three carrier questions, one harness:
 *
 *     npx vite-node tools/carrier_probe.ts -- --games 6
 *
 *  A. Massing A/B — does `distribute` do any better than the default
 *     `concentrate` in exactly the fights the titration lost? (Answering a
 *     player's "what if all the fighters focus one ship at a time" — they
 *     already do; this is the receipt.)
 *  B. The escorted carrier — carrier plus two cruisers against equal
 *     *balanced* points of warships, built with the balanced-points option
 *     the fleet picker now ships. If the fights come out even, 61 is the
 *     right price for the carrier as doctrine actually fields it.
 *  C. Carrier against carrier, and the fighter-stat spread — mirror match
 *     as the control, then the best card in the box (NIAL) against the
 *     weakest (MAGPIE) both ways, to see how much the airframe is worth.
 *
 * Measurement only; nothing in the game changes.
 */

import { FILE_FORMS, registerCustomForms, shipFormById } from '../src/data/ships'
import { registerCustomScenarios, startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo, setWingDoctrine, type AiMemo, type WingDoctrine } from '../src/engine/ai'
import { activeShips, victoryPoints, type GameState } from '../src/engine/game'
import { balancedPointValue } from '../src/engine/fleetValue'
import { health } from '../src/engine/battleScore'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const games = Number(arg('games') ?? 6)
const only = (arg('only') ?? 'abc').toLowerCase()
const rounds = 12

registerCustomForms(FILE_FORMS)

const CARRIER = 'fan-union-ark-royal-fleet-carrier'
const YORKTOWN = 'union-yorktown-i-class-heavy-cruiser'
const NELSON = 'union-nelson-ii-class-light-frigate'
const RAIDER = 'vallari-v-7c-raider-class-battlecruiser'

function run(args: {
  blue: string[]
  red: string[]
  seed: number
  blueWing?: string[]
  redWing?: string[]
  balanced?: boolean
  doctrine?: Partial<WingDoctrine>
}) {
  registerCustomScenarios([
    {
      id: 'carrier-probe',
      name: 'Carrier Probe',
      background: '',
      victory: 'destruction',
      bounds: { width: 72, height: 72, fixed: true },
      terrain: [],
      sides: [
        { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 5 }, force: args.blue, wing: args.blueWing },
        { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: args.red, wing: args.redWing },
      ],
    },
  ])
  setWingDoctrine(args.doctrine ?? {}, args.doctrine ? 'Alpha Fleet' : undefined)
  const game: GameState = startScenario('carrier-probe', {
    seed: args.seed,
    mapScale: 2,
    balancedPoints: args.balanced,
  })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let g = 0; g < 400; g++) {
          const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, 'captain', 'steady', true)
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
  setWingDoctrine({}) // never leak a doctrine into the next game
  const vp = victoryPoints(game)
  return {
    vpA: vp['Alpha Fleet'] ?? 0,
    vpB: vp['Beta Fleet'] ?? 0,
    healthA: health(game, 'Alpha Fleet'),
    healthB: health(game, 'Beta Fleet'),
    endRound: game.round,
  }
}

const worth = (ids: string[]) =>
  ids.reduce((n, id) => n + balancedPointValue(shipFormById(id)!), 0)

function report(label: string, blue: string[], red: string[], results: ReturnType<typeof run>[], balanced: boolean) {
  const balA = worth(blue)
  const balB = worth(red)
  let wins = 0
  let sum = 0
  for (const r of results) {
    const m = balanced ? r.vpA / balB - r.vpB / balA : r.healthA - r.healthB
    if (m > 0) wins++
    sum += m
  }
  console.log(
    `${label}: Alpha wins ${wins}/${results.length}, mean margin ${(sum / results.length).toFixed(2)}` +
      (balanced ? ` (balanced ${balA.toFixed(0)} vs ${balB.toFixed(0)})` : ''),
  )
}

// ---- A. massing A/B --------------------------------------------------------
if (only.includes('a')) {
console.log('== A. concentrate vs distribute, in the fights the titration lost ==')
for (const [red, label] of [
  [[RAIDER, RAIDER, RAIDER], '3x V-7C'],
  [[YORKTOWN, YORKTOWN], '2x YORKTOWN I'],
  [[NELSON, NELSON, NELSON, NELSON, NELSON], '5x NELSON II'],
] as Array<[string[], string]>) {
  for (const massing of ['concentrate', 'distribute'] as const) {
    const results = []
    for (let g = 0; g < games; g++) {
      results.push(run({ blue: [CARRIER], red, seed: 21000 + g * 7919, doctrine: { massing } }))
    }
    report(`  vs ${label}, ${massing}`, [CARRIER], red, results, false)
  }
}

}
// ---- B. the escorted carrier ----------------------------------------------
if (only.includes('b')) {
console.log('== B. carrier + two cruisers, equal balanced points, balanced scoring ==')
const escort = [CARRIER, YORKTOWN, YORKTOWN] // 61 + 23 + 23 = 107 balanced
for (const [red, label] of [
  [[YORKTOWN, YORKTOWN, YORKTOWN, YORKTOWN, YORKTOWN], '5x YORKTOWN I (115)'],
  [[RAIDER, RAIDER, RAIDER, RAIDER], '4x V-7C (100)'],
  [[NELSON, NELSON, NELSON, NELSON, NELSON, NELSON, NELSON], '7x NELSON II (108.5)'],
] as Array<[string[], string]>) {
  const results = []
  for (let g = 0; g < games; g++) {
    results.push(run({ blue: escort, red, seed: 22000 + g * 7919, balanced: true }))
  }
  report(`  vs ${label}`, escort, red, results, true)
}

}
// ---- C. carrier vs carrier, and the card spread ---------------------------
if (only.includes('c')) {
console.log('== C. carrier vs carrier: mirror, then NIAL (best card) vs MAGPIE (weakest) ==')
for (const [wingA, wingB] of [
  ['sabre', 'sabre'],
  ['nial', 'magpie'],
  ['magpie', 'nial'],
  ['nial', 'nial'],
] as Array<[string, string]>) {
  const results = []
  for (let g = 0; g < games; g++) {
    results.push(
      run({ blue: [CARRIER], red: [CARRIER], seed: 23000 + g * 7919, blueWing: [wingA], redWing: [wingB] }),
    )
  }
  report(`  ${wingA} vs ${wingB}`, [CARRIER], [CARRIER], results, false)
}
}
// ---- D. the bare hull: strip the hangar, titrate what is left -------------
// The carrier's 61 decomposes as hull + wing only if the hull is measured
// too. Same trick the versus machine uses for cloak ablations: the hangar is
// taken off the form, so the ship deploys with no flights at all.
if (only.includes('d')) {
  console.log('== D. the bare hull (hangar stripped): break-even vs the probes ==')
  const base = shipFormById(CARRIER)!
  const bare = structuredClone(base)
  bare.id = `${base.id}-no-wing`
  bare.name = `${base.name} (no wing)`
  bare.systems = bare.systems.filter((g) => g.kind !== 'HNGR')
  registerCustomForms([...FILE_FORMS, bare])
  for (const [probe, counts] of [
    [YORKTOWN, [1, 2]],
    [RAIDER, [1, 2]],
    [NELSON, [2, 3, 4]],
  ] as Array<[string, number[]]>) {
    for (const n of counts) {
      const results = []
      for (let g = 0; g < games; g++) {
        results.push(run({ blue: [bare.id], red: Array(n).fill(probe), seed: 24000 + g * 7919 }))
      }
      report(`  bare hull vs ${n}x ${probe.split('-')[1]}`, [CARRIER], Array(n).fill(probe), results, false)
    }
  }
}
console.log('done')
