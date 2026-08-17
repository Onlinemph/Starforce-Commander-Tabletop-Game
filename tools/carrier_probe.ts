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
import { flightDestroyed } from '../src/engine/fighters'
import { hitPointDamage, structureRemaining, structureTotal } from '../src/engine/shipState'
import { balancedPointValue } from '../src/engine/fleetValue'
import { health } from '../src/engine/battleScore'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const games = Number(arg('games') ?? 6)
const only = (arg('only') ?? 'abc').toLowerCase()
// Which card the carrierless-wing experiments fly (E and F).
const wingCard = arg('card') ?? 'magpie'
// Second card for the wing-war experiment: G flies card vs card2 both ways.
const wingCard2 = arg('card2')
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
// ---- E. ten flights, no carrier, one warship ------------------------------
// "Have 10 flights without a carrier fight a 40 point ship." The engine ties
// every flight to a mother, so the closest legal staging is an unarmed
// 1-point tender parked in its own corner with the wing spawned airborne.
// Dead flights concede no victory points, so the verdict is what happens to
// the warship: does forty points of pure wing kill forty balanced points of
// hull before the strikes run out?
if (only.includes('e')) {
  console.log(`== E. 10 ${wingCard.toUpperCase()} strike flights (no carrier) vs one warship ==`)
  const nelson = shipFormById(NELSON)!
  const tender = structuredClone(nelson)
  tender.id = 'fan-wing-tender'
  tender.name = 'WING TENDER (unarmed)'
  tender.weapons = []
  tender.functions = tender.functions.filter((f) => f.kind !== 'weapon')
  tender.pointValue = 1
  registerCustomForms([...FILE_FORMS, tender])
  for (const [target, label] of [
    ['union-yorktown-iii-class-heavy-cruiser', 'YORKTOWN III (38 balanced)'],
    ['union-kursk-i-class-battlecruiser', 'KURSK I (42 balanced)'],
    ['union-exeter-ii-class-heavy-cruiser', 'EXETER II (59 balanced)'],
  ] as Array<[string, string]>) {
    let killed = 0
    let hurtSum = 0
    let flightsLeftSum = 0
    let roundSum = 0
    for (let g = 0; g < games; g++) {
      registerCustomScenarios([
        {
          id: 'wing-only',
          name: 'Wing Only',
          background: '',
          victory: 'destruction',
          bounds: { width: 72, height: 72, fixed: true },
          terrain: [],
          sides: [
            { side: 'Alpha Fleet', objective: 'strike', facing: 2, speed: 0, anchor: { x: 6, y: 6 }, spread: { x: 0, y: 3 }, force: ['fan-wing-tender'], value: [1] },
            { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: [target] },
          ],
        },
      ])
      const game: GameState = startScenario('wing-only', { seed: 25000 + g * 7919, mapScale: 2 })
      for (let i = 0; i < 10; i++) {
        game.counters.flight += 1
        game.flights.push({
          id: `flight-${game.counters.flight}`,
          side: 'Alpha Fleet',
          motherId: game.ships.find((s) => s.side === 'Alpha Fleet')!.id,
          cardId: wingCard,
          config: 'strike',
          spent: false,
          members: 6,
          position: { x: 14 + (i % 5) * 3, y: 24 + Math.floor(i / 5) * 4 },
          damage: 0,
          activated: false,
          attacked: false,
        })
      }
      const sides = [...new Set(game.ships.map((s) => s.side))]
      const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
      const drive = (closing: boolean) => {
        for (let pass = 0; pass < 50; pass++) {
          const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
          for (const side of sides) {
            for (let g2 = 0; g2 < 400; g2++) {
              const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g2 === 0, 'captain', 'steady', true)
              if (batch.length === 0) break
              for (const a of batch) applyAction(game, a as GameAction)
            }
          }
          if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
        }
      }
      drive(false)
      for (let step = 0; step < 3000; step++) {
        if (game.round > rounds) break
        const shipsLeft = new Set(activeShips(game).map((s) => s.side))
        const wingLeft = game.flights.some((f) => f.side === 'Alpha Fleet' && !flightDestroyed(f))
        if (!shipsLeft.has('Beta Fleet') || (!shipsLeft.has('Alpha Fleet') && !wingLeft)) break
        drive(true)
        applyAction(game, { type: 'advance-segment' })
        drive(false)
      }
      const foe = game.ships.find((s) => s.side === 'Beta Fleet')!
      if (foe.destroyed) killed += 1
      hurtSum += 1 - structureRemaining(foe) / structureTotal(foe)
      flightsLeftSum += game.flights
        .filter((f) => f.side === 'Alpha Fleet' && !flightDestroyed(f))
        .reduce((n, f) => n + f.members, 0)
      roundSum += game.round
    }
    console.log(
      `  vs ${label}: killed ${killed}/${games}, mean structure lost ${(100 * hurtSum / games).toFixed(0)}%, ` +
        `fighters surviving ${(flightsLeftSum / games).toFixed(1)}/60, mean end round ${(roundSum / games).toFixed(1)}`,
    )
  }
}
// ---- F. the same wing, but with a base to rearm from ----------------------
// Same fight as E, except the tender is a working 10-bay hangar: spent
// flights fly home, reload in the Hangar Bay Segment, and sortie again. If
// the wing's problem is ordnance supply, this fixes it; if its problem is
// that a strike pass cannot outpace the target's shield repair, it will not.
if (only.includes('f')) {
  console.log(`== F. 10 ${wingCard.toUpperCase()} flights WITH a rearm base vs one warship ==`)
  const nelson2 = shipFormById(NELSON)!
  const base = structuredClone(nelson2)
  base.id = 'fan-wing-base'
  base.name = 'WING BASE (unarmed, 10 bays)'
  base.weapons = []
  base.functions = base.functions.filter((f) => f.kind !== 'weapon')
  base.systems = [...base.systems, { kind: 'HNGR', label: 'Hangar Bay', boxes: 10 }]
  base.pointValue = 1
  registerCustomForms([...FILE_FORMS, base])
  for (const [target, label] of [
    ['union-yorktown-iii-class-heavy-cruiser', 'YORKTOWN III (38 balanced)'],
    ['union-nelson-ii-class-light-frigate', '2x NELSON II (31 balanced)'],
  ] as Array<[string, string]>) {
    const red = target.includes('nelson') ? [target, target] : [target]
    let killed = 0
    let hpSum = 0
    let strikesSum = 0
    let flightsLeftSum = 0
    for (let g = 0; g < games; g++) {
      registerCustomScenarios([
        {
          id: 'wing-base',
          name: 'Wing Base',
          background: '',
          victory: 'destruction',
          bounds: { width: 72, height: 72, fixed: true },
          terrain: [],
          sides: [
            { side: 'Alpha Fleet', objective: 'strike', facing: 2, speed: 0, anchor: { x: 6, y: 6 }, spread: { x: 0, y: 3 }, force: ['fan-wing-base'], value: [1] },
            { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: red },
          ],
        },
      ])
      const game: GameState = startScenario('wing-base', { seed: 26000 + g * 7919, mapScale: 2 })
      const mother = game.ships.find((s) => s.side === 'Alpha Fleet')!
      mother.flightsAboard = 0 // the wing starts airborne, not boxed
      for (let i = 0; i < 10; i++) {
        game.counters.flight += 1
        game.flights.push({
          id: `flight-${game.counters.flight}`,
          side: 'Alpha Fleet',
          motherId: mother.id,
          cardId: wingCard,
          config: 'strike',
          spent: false,
          members: 6,
          position: { x: 14 + (i % 5) * 3, y: 24 + Math.floor(i / 5) * 4 },
          damage: 0,
          activated: false,
          attacked: false,
        })
      }
      const sides = [...new Set(game.ships.map((s) => s.side))]
      const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
      const drive = (closing: boolean) => {
        for (let pass = 0; pass < 50; pass++) {
          const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
          for (const side of sides) {
            for (let g2 = 0; g2 < 400; g2++) {
              const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g2 === 0, 'captain', 'steady', true)
              if (batch.length === 0) break
              for (const a of batch) applyAction(game, a as GameAction)
            }
          }
          if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
        }
      }
      drive(false)
      for (let step = 0; step < 3000; step++) {
        if (game.round > rounds) break
        const shipsLeft = new Set(activeShips(game).map((s) => s.side))
        if (!shipsLeft.has('Beta Fleet')) break
        drive(true)
        applyAction(game, { type: 'advance-segment' })
        drive(false)
      }
      const foes = game.ships.filter((s) => s.side === 'Beta Fleet')
      if (foes.every((f) => f.destroyed)) killed += 1
      hpSum += foes.reduce((n, f) => n + hitPointDamage(f), 0)
      strikesSum += game.log.filter((l) => /runs in on|strikes .* shield/.test(l.message)).length
      flightsLeftSum += game.flights
        .filter((f) => f.side === 'Alpha Fleet' && !flightDestroyed(f))
        .reduce((n, f) => n + f.members, 0)
    }
    console.log(
      `  vs ${label}: killed all ${killed}/${games}, mean foe hit points lost ${(hpSum / games).toFixed(1)}, ` +
        `strike passes ${(strikesSum / games).toFixed(0)}/game, fighters surviving ${(flightsLeftSum / games).toFixed(1)}/60`,
    )
  }
}
// ---- G. wing against wing: ten flights each, opposing cards ---------------
// Pure air war: two unarmed ten-bay tenders in opposite corners, ten flights
// a side, both wings rigged space-superiority. Strike power is irrelevant
// against fighters — the dogfight runs on DFR and Dodge — so this is the
// experiment that prices the sky-fighting half of a card.
if (only.includes('g')) {
  console.log('== G. 10 flights vs 10 flights, space-superiority rig ==')
  const nelson3 = shipFormById(NELSON)!
  const base2 = structuredClone(nelson3)
  base2.id = 'fan-wing-base-g'
  base2.name = 'WING BASE (unarmed, 10 bays)'
  base2.weapons = []
  base2.functions = base2.functions.filter((f) => f.kind !== 'weapon')
  base2.systems = [...base2.systems, { kind: 'HNGR', label: 'Hangar Bay', boxes: 10 }]
  base2.pointValue = 1
  registerCustomForms([...FILE_FORMS, base2])
  const pairs: Array<[string, string]> = wingCard2
    ? [
        [wingCard, wingCard2],
        [wingCard2, wingCard],
      ]
    : [
        ['nial', 'peregrine'],
        ['peregrine', 'nial'],
      ]
  for (const [cardA, cardB] of pairs) {
    let aliveA = 0
    let aliveB = 0
    let winsA = 0
    for (let g = 0; g < games; g++) {
      registerCustomScenarios([
        {
          id: 'wing-war',
          name: 'Wing War',
          background: '',
          victory: 'destruction',
          bounds: { width: 72, height: 72, fixed: true },
          terrain: [],
          sides: [
            { side: 'Alpha Fleet', objective: 'sky', facing: 2, speed: 0, anchor: { x: 6, y: 36 }, spread: { x: 0, y: 3 }, force: ['fan-wing-base-g'], value: [1] },
            { side: 'Beta Fleet', objective: 'sky', facing: 6, speed: 0, anchor: { x: 66, y: 36 }, spread: { x: 0, y: 3 }, force: ['fan-wing-base-g'], value: [1] },
          ],
        },
      ])
      const game: GameState = startScenario('wing-war', { seed: 27000 + g * 7919, mapScale: 2 })
      for (const [side, card, x] of [
        ['Alpha Fleet', cardA, 14],
        ['Beta Fleet', cardB, 58],
      ] as Array<[string, string, number]>) {
        const mother = game.ships.find((s) => s.side === side)!
        mother.flightsAboard = 0
        for (let i = 0; i < 10; i++) {
          game.counters.flight += 1
          game.flights.push({
            id: `flight-${game.counters.flight}`,
            side,
            motherId: mother.id,
            cardId: card,
            config: 'space-superiority',
            spent: false,
            members: 6,
            position: { x: x + (i % 5) * 2, y: 26 + Math.floor(i / 5) * 4 },
            damage: 0,
            activated: false,
            attacked: false,
          })
        }
      }
      const sides = [...new Set(game.ships.map((s) => s.side))]
      const memos = new Map<string, AiMemo>(sides.map((x2) => [x2, createAiMemo()]))
      const drive = (closing: boolean) => {
        for (let pass = 0; pass < 50; pass++) {
          const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
          for (const side of sides) {
            for (let g2 = 0; g2 < 400; g2++) {
              const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g2 === 0, 'captain', 'steady', true)
              if (batch.length === 0) break
              for (const a of batch) applyAction(game, a as GameAction)
            }
          }
          if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
        }
      }
      drive(false)
      for (let step = 0; step < 3000; step++) {
        if (game.round > rounds) break
        const fightersOf = (side: string) =>
          game.flights.filter((f) => f.side === side && !flightDestroyed(f)).reduce((n, f) => n + f.members, 0)
        if (fightersOf('Alpha Fleet') === 0 || fightersOf('Beta Fleet') === 0) break
        drive(true)
        applyAction(game, { type: 'advance-segment' })
        drive(false)
      }
      const fightersOf = (side: string) =>
        game.flights.filter((f) => f.side === side && !flightDestroyed(f)).reduce((n, f) => n + f.members, 0)
      const a = fightersOf('Alpha Fleet')
      const b = fightersOf('Beta Fleet')
      aliveA += a
      aliveB += b
      if (a > b) winsA++
    }
    console.log(
      `  ${cardA.toUpperCase()} vs ${cardB.toUpperCase()}: ${cardA.toUpperCase()} wins the sky ${winsA}/${games}, ` +
        `mean fighters left ${(aliveA / games).toFixed(1)} vs ${(aliveB / games).toFixed(1)} (of 60 each)`,
    )
  }
}
console.log('done')
