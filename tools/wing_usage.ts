/**
 * Is the carrier actually using its wing?
 *
 *     npx vite-node tools/wing_usage.ts [games]
 *
 * A carrier can look busy in a battle log and still be wasting most of its
 * fighters, and the log is too long to audit by eye — the question that keeps
 * coming up is "are all four flights in the cycle, or is it flying two and
 * leaving two on the deck?". This answers it with numbers.
 *
 * Every figure here has been wrong at least once, which is why they are worth
 * watching:
 *
 *  - **distinct flights that ever flew** caught the AI-versus-AI bug, where the
 *    answer was 0 of 4 because the planner could not see an enemy.
 *  - **sorties versus strike runs** caught the touch-and-go, where the wing
 *    landed and relaunched every phase and the two numbers came apart.
 *  - **phases with any wing up** is the one to watch now: the whole wing tends
 *    to go home together and wait for the Hangar Bay Segment, which leaves
 *    phases with nothing in the air.
 */

import { buildGame } from '../src/data/savedGame'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo } from '../src/engine/ai'
import { activeShips, flightsAirborne, isCombatPhase } from '../src/engine/game'

const GAMES = Number(process.argv[2] ?? 12)
const CARRIER = 'fan-union-ark-royal-fleet-carrier'
const ENEMY = 'vallari-v-7c-raider-class-battlecruiser'

let phases = 0
let withAir = 0
let strikes = 0
let sorties = 0
let everUp = 0
let fighterDamage = 0
let lost = 0
let shipDamage = 0

for (let g = 0; g < GAMES; g++) {
  const game = buildGame({
    scenarioId: 's3.1-the-duel',
    seed: 0x5f04ce + g * 7919,
    mapScale: 2,
    fleets: { 'Blue Force': [CARRIER], 'Red Force': [ENEMY, ENEMY] },
    aiSides: ['Red Force', 'Blue Force'],
  })
  const carrier = game.ships.find((s) => s.side === 'Blue Force')!
  const memo = createAiMemo()
  const seen = new Set<string>()
  let lastPhase = ''

  for (let step = 0; step < 30000 && game.round <= 10; step++) {
    // Sample once per combat phase, in the segment the wing acts in.
    if (isCombatPhase(game.phase) && game.segment === 'flight-operations') {
      const key = `${game.round}/${game.phase}`
      if (key !== lastPhase) {
        lastPhase = key
        phases += 1
        const up = flightsAirborne(game, carrier)
        if (up.length > 0) withAir += 1
        for (const f of up) seen.add(f.id)
      }
    }
    let acted = false
    const batch: GameAction[] = aiNextActions(
      game,
      ['Red Force', 'Blue Force'],
      memo,
      true,
      'admiral',
    )
    for (const action of batch) {
      applyAction(game, action)
      acted = true
    }
    if (!acted) applyAction(game, { type: 'advance-segment' })
    if (activeShips(game).length < 2) break
  }

  everUp += seen.size
  for (const line of game.log) {
    const strike = /strikes .*? for (\d+) damage/.exec(line.message)
    if (strike) {
      strikes += 1
      fighterDamage += Number(strike[1])
    }
    if (/launches \d|back up/.test(line.message)) sorties += 1
    const down = /— (\d+) fighter\(s\) down/.exec(line.message)
    if (down) lost += Number(down[1])
    const volley = /fires on .*? → (\d+) damage/.exec(line.message)
    if (volley && line.message.startsWith(carrier.name)) shipDamage += Number(volley[1])
  }
}

const per = (n: number) => (n / GAMES).toFixed(1)
console.log(`${GAMES} games · ARK ROYAL (4 flights of SABRE) vs 2x V-7C RAIDER · 72" map`)
console.log(`  distinct flights that ever flew    ${per(everUp)} of 4`)
console.log(`  phases with any wing up            ${((withAir / phases) * 100).toFixed(0)}%  (${withAir}/${phases})`)
console.log(`  sorties (launch or relaunch)       ${per(sorties)} a game`)
console.log(`  strike runs                        ${per(strikes)} a game`)
console.log(`  damage delivered by the wing       ${per(fighterDamage)} a game`)
console.log(`  damage delivered by the ship       ${per(shipDamage)} a game`)
console.log(`  fighters lost                      ${per(lost)} of 24`)
