/**
 * Are the flight counters readable, or is the wing one pile?
 *
 *     npx vite-node tools/flight_spacing.ts
 *
 * Counters are physical objects. Two of them at the same coordinates are one
 * counter to a player looking at the map, and a stack of four reads as a single
 * flight — which is a worse lie than any rounding the map does, because the
 * player cannot see what is over the table.
 *
 * The planner used to produce exactly that. Every flight launched onto the same
 * point off the carrier's stern, everybody converging on a dogfight stepped
 * onto the target's own point, and a wing going home all landed on the
 * carrier's. Measured on a carrier duel over eight rounds: **18.8% of flight
 * pairs sat within 0.4" of each other and the closest pair was 0.00"** — dead
 * coincident. After the fan-out it is 0.5% and 0.15".
 *
 * This samples every airborne pair at the end of each combat phase, which is
 * when a player is actually looking at the board.
 */

import { buildGame } from '../src/data/savedGame'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo } from '../src/engine/ai'
import { activeShips, isCombatPhase } from '../src/engine/game'

/** Closer than this and the two deltas overlap on screen. */
const TOO_CLOSE = 0.4

let samples = 0
let stacked = 0
let worst = Infinity

const game = buildGame({
  scenarioId: 's3.1-the-duel',
  seed: 0x5f04ce,
  mapScale: 2,
  fleets: {
    'Blue Force': ['fan-union-ark-royal-fleet-carrier'],
    'Red Force': ['fan-b5-omega-destroyer'],
  },
  aiSides: ['Red Force', 'Blue Force'],
})
const memo = createAiMemo()

for (let step = 0; step < 30000 && game.round <= 8; step++) {
  if (isCombatPhase(game.phase) && game.segment === 'delayed-action') {
    const up = game.flights.filter((f) => !f.dockedTo && f.members > 0)
    for (let i = 0; i < up.length; i++) {
      for (let j = i + 1; j < up.length; j++) {
        const gap = Math.hypot(
          up[i].position.x - up[j].position.x,
          up[i].position.y - up[j].position.y,
        )
        samples += 1
        if (gap < TOO_CLOSE) stacked += 1
        worst = Math.min(worst, gap)
      }
    }
  }
  let acted = false
  for (const action of aiNextActions(
    game,
    ['Red Force', 'Blue Force'],
    memo,
    true,
    'admiral',
  ) as GameAction[]) {
    applyAction(game, action)
    acted = true
  }
  if (!acted) applyAction(game, { type: 'advance-segment' })
  if (activeShips(game).length < 2) break
}

console.log(`ARK ROYAL vs OMEGA, 8 rounds, 72" map`)
console.log(`  flight pairs sampled      ${samples}`)
console.log(
  `  pairs closer than ${TOO_CLOSE}"    ${stacked} (${((stacked / Math.max(1, samples)) * 100).toFixed(1)}%)`,
)
console.log(`  closest pair seen         ${worst === Infinity ? 'n/a' : `${worst.toFixed(2)}"`}`)
