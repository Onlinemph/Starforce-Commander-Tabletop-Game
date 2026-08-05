import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { maneuverAllowedWhileCloaked } from './cloaking'
import { activeShips } from './game'

/**
 * The hung game, not the bad move.
 *
 * H6.8.5(3) allows a cloaked and still-hidden ship only straight, slide, easy
 * and standard; anything sharper is refused. `plot-maneuver` returns that
 * refusal to whoever dispatched it — and the AI driver, like every other
 * caller, throws the message away. So a captain who wanted a hard turn while
 * cloaked re-planned the same illegal turn every time it was asked, the batch
 * never emptied, and the game hung inside the Command Segment rather than
 * playing a worse move.
 *
 * Found while flying an Aurelian hull whose plasma torpedoes die at nine
 * inches — a ship that wants a hard turn very badly — but it was never that
 * ship's fault: the printed INVICTUS I is cloaked and armed the same way.
 */

describe('a cloaked captain', () => {
  it('is never offered a manoeuvre the cloak forbids (H6.8.5)', () => {
    for (const m of ['straight', 'slide', 'easy', 'standard']) {
      expect(maneuverAllowedWhileCloaked(m), m).toBe(true)
    }
    for (const m of ['hard', 'snap', 's-turn', 'em-90', 'em-180']) {
      expect(maneuverAllowedWhileCloaked(m), m).toBe(false)
    }
  })

  it('settles the Command Segment instead of re-plotting a refused turn', () => {
    // The Invictus is the printed hull that carries both a cloak and the
    // short-ranged plasma that makes a captain want to turn hard.
    const game = startScenario('s3.1-the-duel', {
      seed: 4,
      forms: {
        'Blue Force': 'aurelian-invictus-i-class-dreadnought',
        'Red Force': 'union-union-iii-class-dreadnought',
      },
    })
    const memo = createAiMemo()
    const sides = [...new Set(game.ships.map((s) => s.side))]

    for (let step = 0; step < 40; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1) break
      let batches = 0
      for (; batches < 300; batches++) {
        const batch = aiNextActions(game, sides, memo, false, 'admiral')
        if (batch.length === 0) break
        for (const action of batch) applyAction(game, action)
      }
      // The guard is what the harness uses to call a game wedged; reaching it
      // means the captains argued with the rules in a loop.
      expect(batches, `stuck in ${game.phase}/${game.segment}`).toBeLessThan(300)
      applyAction(game, { type: 'advance-segment' })
    }
  })
})
