/**
 * The versus machine: any force against any force, measured.
 *
 * Born from a question the fan-design file kept getting asked in different
 * costumes — "would a Star Destroyer beat a Star Trek ship?" — which no two
 * fandoms have ever settled by argument. This settles it the way everything
 * else in this repository is settled: the game itself is the evaluator.
 *
 *     npx vite-node tools/versus.ts -- \
 *         --a fan-b5-sharlin-warcruiser \
 *         --b fan-b5-omega-destroyer,fan-b5-omega-destroyer \
 *         --games 40 --rank captain
 *
 * Comma-separate a side's form ids to field a fleet. Hulls are fixed by the
 * question, so each seed is played twice for sample size rather than
 * mirrored. Health decides, as in the season harness: structure afloat,
 * nothing for a hull that left, a penalty for one that died.
 */

import { FILE_FORMS, registerCustomForms, shipFormById } from '../src/data/ships'
import { registerCustomScenarios, startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo, type AiDifficulty, type AiMemo } from '../src/engine/ai'
import { activeShips, type GameState } from '../src/engine/game'
import { health } from '../src/engine/battleScore'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

registerCustomForms(FILE_FORMS)

const forceA = (arg('a') ?? 'fan-sw-imperial-star-destroyer').split(',')
const forceB = (arg('b') ?? 'fan-union-trafalgar-super-dreadnought').split(',')
const games = Number(arg('games') ?? 40)
const rank = (arg('rank') ?? 'captain') as AiDifficulty
const rounds = Number(arg('rounds') ?? 12)
/**
 * Fight it out. By default a hull that decides the day is lost may run for
 * the board edge (J9), and the twelve-round clock stops the rest — which
 * measures who is *winning*, not who would eventually die. `--retreat off`
 * nails everyone to the deck and `--kill` runs until one side is gone (or
 * the round cap, raised well out of the way, admits the fight is a
 * stalemate). The two answer a different question from the default, and both
 * are worth asking of the same pair.
 */
const retreats = (arg('retreat') ?? 'on') !== 'off'
const toTheDeath = process.argv.includes('--kill')
const cap = toTheDeath ? Math.max(rounds, 60) : rounds

for (const id of [...forceA, ...forceB]) {
  if (!shipFormById(id)) {
    console.error(`No such form: ${id}`)
    process.exit(1)
  }
}

/**
 * `--nocloak a|b|both` — the ablation that answers whether a cloak is worth
 * carrying on a given hull.
 *
 * A cloak is not free even when it is fully powered: its FUNCTIONS line eats
 * reactor power the same round the plasma line wants it, and the ship cannot
 * fire while it is up (H6.4.2). Whether that trade pays is a per-hull
 * question about slack — an ACIPTER I has one point left after cloak and
 * tube, a LUPUS I has four — and the only honest way to ask it is to field
 * the same hull twice, once with the cloak taken off the card, against the
 * same opponent on the same seeds.
 *
 * The cloak is removed from the form rather than left unused, so the power it
 * would have taken is genuinely available to everything else.
 */
const noCloak = arg('nocloak')
if (noCloak) {
  const strip = (form: ReturnType<typeof shipFormById>) => {
    const bare = structuredClone(form!)
    bare.id = `${bare.id}-nocloak`
    bare.name = `${bare.name} (no cloak)`
    bare.functions = bare.functions.filter((l) => l.label !== 'CLOAK')
    bare.systems = bare.systems.filter((s) => s.kind !== 'CLOAK')
    return bare
  }
  const extra: ReturnType<typeof strip>[] = []
  const bareId = (ids: string[]) =>
    ids.map((id) => {
      const bare = strip(shipFormById(id))
      if (!extra.some((f) => f.id === bare.id)) extra.push(bare)
      return bare.id
    })
  if (noCloak === 'a' || noCloak === 'both') forceA.splice(0, forceA.length, ...bareId(forceA))
  if (noCloak === 'b' || noCloak === 'both') forceB.splice(0, forceB.length, ...bareId(forceB))
  registerCustomForms([...FILE_FORMS, ...extra])
}
const label = (ids: string[]) =>
  ids.map((id) => shipFormById(id)!.name.split('-class')[0]).join(' + ')
const points = (ids: string[]) =>
  ids.reduce((n, id) => n + (shipFormById(id)!.pointValue || 0), 0)

registerCustomScenarios([
  {
    id: 'versus',
    name: 'Versus',
    background: '',
    victory: 'destruction',
    bounds: { width: 72, height: 72, fixed: true },
    terrain: [],
    sides: [
      { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 6 }, force: forceA },
      { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 6 }, force: forceB },
    ],
  },
])

let wins = 0
let losses = 0
let draws = 0
let stalemates = 0
let aKilled = 0
let bKilled = 0
for (let seed = 1; seed <= Math.max(1, Math.floor(games / 2)); seed++) {
  for (const rep of [0, 1]) {
    const game: GameState = startScenario('versus', { seed: seed * 7919 + rep, mapScale: 2 })
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
    const drive = (closing: boolean) => {
      for (let pass = 0; pass < 50; pass++) {
        const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
        for (const side of sides) {
          for (let g = 0; g < 400; g++) {
            const batch = aiNextActions(
              game,
              [side],
              memos.get(side)!,
              closing && pass === 0 && g === 0,
              rank,
              'steady',
              retreats,
            )
            if (batch.length === 0) break
            for (const a of batch) applyAction(game, a as GameAction)
          }
        }
        if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
      }
    }
    drive(false)
    for (let step = 0; step < 3000; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > cap) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    const left = (side: string) => game.ships.filter((s) => s.side === side && !s.destroyed).length
    const aLeft = left('Alpha Fleet')
    const bLeft = left('Beta Fleet')
    aKilled += game.ships.filter((s) => s.side === 'Beta Fleet' && s.destroyed).length
    bKilled += game.ships.filter((s) => s.side === 'Alpha Fleet' && s.destroyed).length
    if (toTheDeath) {
      // Somebody has to be gone for this to count as settled; anything else
      // is a fight neither side could finish, and saying so is the result.
      if (aLeft > 0 && bLeft === 0) wins++
      else if (bLeft > 0 && aLeft === 0) losses++
      else stalemates++
      continue
    }
    const margin = health(game, 'Alpha Fleet') - health(game, 'Beta Fleet')
    if (margin > 0) wins++
    else if (margin < 0) losses++
    else draws++
  }
}

const total = wins + losses + draws + stalemates
console.log(
  `${label(forceA)} (${points(forceA)} pts)  vs  ${label(forceB)} (${points(forceB)} pts)` +
    `  [${rank}${retreats ? '' : ', no retreat'}${toTheDeath ? ', to the death' : ''}]\n` +
    `   ${wins}W-${losses}L${draws ? `-${draws}D` : ''}${stalemates ? ` (${stalemates} unsettled)` : ''} of ${total}` +
    `\n   hulls destroyed: by ${label(forceA)} ${aKilled}, by ${label(forceB)} ${bKilled}`,
)
