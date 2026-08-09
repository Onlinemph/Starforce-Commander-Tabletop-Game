/**
 * The Union bow-tank: how a human actually flies a forward-firing hull.
 *
 * Built from the first played battle report, in the player's own words:
 * reinforce and repair the F shield every round before anything else, keep
 * the nose on the enemy, fire everything forward. "I would see this as being
 * common for a union player — all their damage is facing forward, so of
 * course it's best to keep the nose towards them and firing."
 *
 * This is the project's first human-derived opponent model, and it exists
 * because AI-vs-AI seasons never produce it: no rank commits a whole power
 * budget to one facing. Measured the day it was built:
 *
 *     bow-tank vs stock captain    48W-48L   — dead even; the tank fully
 *                                              neutralises ordinary doctrine
 *     admiral  vs bow-tank         96W-0L    — perfect; flanking + rollouts
 *                                              answer it completely
 *
 * So the human loss it came from rode on the round-1 stress wound (since
 * gated — see the stress doctrine in bestPlot) and well-played rounds 1-3,
 * not on the tank being unanswerable. Kept as a harness fixture so future
 * doctrine changes can be checked against a human style, not only against
 * other AIs:
 *
 *     npx vite-node tools/tanker.ts -- --hi admiral --games 96
 */

import { startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo, setRolloutEnemyRank, type AiDifficulty, type AiMemo } from '../src/engine/ai'
import { activeShips, type GameState } from '../src/engine/game'
import { health } from '../src/engine/battleScore'
import { SEASON_MAP_SCALE } from './season'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1] }
const hi = (arg('hi') ?? 'admiral') as AiDifficulty
const games = Number(arg('games') ?? 96)

let wins = 0, losses = 0
const seeds = games / 2
for (let seed = 1; seed <= seeds; seed++) {
  for (const flipped of [false, true]) {
    const game: GameState = startScenario('s3.1-the-duel', { seed, mapScale: SEASON_MAP_SCALE })
    const sides = [...new Set(game.ships.map((s) => s.side))]
    // The tanker flies whichever hull is the Yorktown — bow-tanking is Union
    // doctrine, and the mirror still swaps who gets the better seed.
    const tankSide = game.ships.find((s) => /yorktown/i.test(s.name))!.side
    const aiSide = sides.find((x) => x !== tankSide)!
    const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
    const rankOf = (side: string): AiDifficulty => (side === aiSide ? hi : 'captain')
    // Mirrored via seed reuse: flipped swaps nothing here (hulls are fixed by
    // doctrine), so play each seed twice for sample size instead.
    void flipped

    const tank = (side: string) => {
      if (side !== tankSide) return
      const ship = game.ships.find((s) => s.side === side)!
      if (ship.destroyed) return
      for (const line of ship.form.functions) {
        if ((line.kind === 'shield-reinforce' || line.kind === 'shield-repair') && line.shieldSide === 'F') {
          applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: line.steps.length })
        }
      }
    }
    const drive = (closing: boolean) => {
      for (let pass = 0; pass < 50; pass++) {
        const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
        for (const side of sides) {
          setRolloutEnemyRank(side === aiSide ? 'captain' : hi)
          if (game.phase === 'engineering') tank(side)
          for (let g = 0; g < 400; g++) {
            const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, rankOf(side), 'steady', true)
            if (batch.length === 0) break
            for (const a of batch) applyAction(game, a as GameAction)
          }
        }
        if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
      }
    }
    drive(false)
    for (let step = 0; step < 400; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 12) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    const margin = health(game, aiSide) - health(game, tankSide)
    if (margin > 0) wins++
    else if (margin < 0) losses++
  }
}
console.log(`${hi} vs bow-tank captain (Yorktown): ${wins}W-${losses}L of ${games}`)
