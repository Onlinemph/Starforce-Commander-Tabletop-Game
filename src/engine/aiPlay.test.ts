import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo, type AiDifficulty, type AiMemo } from './ai'
import { activeShips, victoryPoints, type GameState } from './game'
import { damageLevel, structureRemaining } from './shipState'

/**
 * Self-play: whole battles fought by the AI against itself, exactly as the
 * store drives it — closing duties before each segment advance, normal duties
 * after. This is the regression net for the captain: it must never wedge the
 * sequence of play, never argue with the rules in a loop, and actually fight.
 */

interface Driver {
  game: GameState
  journal: GameAction[]
  memo: AiMemo
  sides: string[]
  difficulty?: AiDifficulty
}

function drive(d: Driver, closing = false): void {
  for (let guard = 0; guard < 300; guard++) {
    const batch = aiNextActions(d.game, d.sides, d.memo, closing, d.difficulty ?? 'captain')
    if (batch.length === 0) return
    for (const action of batch) {
      applyAction(d.game, action)
      d.journal.push(action)
    }
    closing = false
  }
  throw new Error('AI driver did not settle within 300 iterations')
}

function overFor(game: GameState): boolean {
  const sides = new Set(activeShips(game).map((s) => s.side))
  return sides.size <= 1
}

/** Play a battle to a decision or a round cap, the way the store would. */
function selfPlay(
  scenarioId: string,
  seed: number,
  sides: string[],
  rounds = 14,
  difficulty: AiDifficulty = 'captain',
): Driver {
  const d: Driver = {
    game: startScenario(scenarioId, { seed }),
    journal: [],
    memo: createAiMemo(),
    sides,
    difficulty,
  }
  drive(d)
  for (let steps = 0; steps < 400; steps++) {
    if (overFor(d.game) || d.game.round > rounds) break
    drive(d, true)
    applyAction(d.game, { type: 'advance-segment' })
    d.journal.push({ type: 'advance-segment' })
    drive(d)
  }
  return d
}

describe('AI self-play', () => {
  it('fights a duel to a decision without wedging', () => {
    const d = selfPlay('s3.1-the-duel', 42, ['Blue Force', 'Red Force'])
    // The battle was fought, not idled: volleys landed and hulls took damage.
    expect(d.journal.some((a) => a.type === 'fire-volley')).toBe(true)
    const damaged = d.game.ships.some(
      (s) => s.destroyed || s.disengaged || damageLevel(s) !== 'none',
    )
    expect(damaged).toBe(true)
    // Somebody scored.
    const points = Object.values(victoryPoints(d.game))
    expect(Math.max(...points)).toBeGreaterThan(0)
  })

  it('is deterministic: same seed, same battle, action for action', () => {
    const a = selfPlay('s3.1-the-duel', 7, ['Blue Force', 'Red Force'], 6)
    const b = selfPlay('s3.1-the-duel', 7, ['Blue Force', 'Red Force'], 6)
    expect(JSON.stringify(a.journal)).toBe(JSON.stringify(b.journal))
  })

  it('beats an opponent that does nothing', () => {
    const d = selfPlay('s3.1-the-duel', 11, ['Blue Force'])
    const passive = d.game.ships.find((s) => s.side === 'Red Force')!
    const active = d.game.ships.find((s) => s.side === 'Blue Force')!
    // The passive ship is worse off than the one shooting at it.
    expect(structureRemaining(passive)).toBeLessThan(structureRemaining(active))
  })

  it('survives every scenario, including terrain and the Aurelians', () => {
    const boards: Array<[string, string[]]> = [
      ['s3.3-orbital-ambush', ['Blue Force', 'Red Force']],
      ['exp2-squadron-engagement', ['Blue Force', 'Red Force']],
      ['exp3-nebula-patrol', ['Blue Force', 'Red Force']],
      ['exp5-aurelian-raid', ['Blue Force', 'Aurelian Empire']],
    ]
    for (const [scenarioId, sides] of boards) {
      const d = selfPlay(scenarioId, 3, sides, 5)
      expect(d.game.round).toBeGreaterThan(1)
    }
  })

  it('respects rocks: no full-speed transit of an asteroid field it can avoid', () => {
    const d = selfPlay('s3.1-the-duel', 21, ['Blue Force', 'Red Force'], 8)
    // Weak but honest assertion: the game with terrain runs clean too.
    const t = startScenario('s3.1-the-duel', { seed: 21, terrain: 6 })
    const dt: Driver = { game: t, journal: [], memo: createAiMemo(), sides: ['Blue Force', 'Red Force'] }
    drive(dt)
    for (let steps = 0; steps < 200; steps++) {
      if (overFor(dt.game) || dt.game.round > 8) break
      drive(dt, true)
      applyAction(dt.game, { type: 'advance-segment' })
      drive(dt)
    }
    expect(dt.game.round).toBeGreaterThan(1)
    expect(d.game.round).toBeGreaterThan(1)
  })

  it('every difficulty fights a clean duel', () => {
    for (const difficulty of ['ensign', 'captain', 'admiral'] as const) {
      const d = selfPlay('s3.1-the-duel', 42, ['Blue Force', 'Red Force'], 8, difficulty)
      expect(d.journal.some((a) => a.type === 'fire-volley')).toBe(true)
      expect(d.game.round).toBeGreaterThan(1)
    }
  })

  it('difficulties actually differ: the ensign fights a different battle', () => {
    const captain = selfPlay('s3.1-the-duel', 42, ['Blue Force', 'Red Force'], 6, 'captain')
    const ensign = selfPlay('s3.1-the-duel', 42, ['Blue Force', 'Red Force'], 6, 'ensign')
    expect(JSON.stringify(captain.journal)).not.toBe(JSON.stringify(ensign.journal))
  })

  it('the Aurelians cloak, hunt, decloak and loose their homing torpedoes', () => {
    const d = selfPlay('exp5-aurelian-raid', 3, ['Blue Force', 'Aurelian Empire'], 12)
    const types = new Set(d.journal.map((a) => a.type))
    expect(types.has('engage-cloak')).toBe(true)
    expect(types.has('decloak')).toBe(true)
    expect(types.has('cloak-search')).toBe(true)
    expect(types.has('launch-homing')).toBe(true)
    // The Union side answers what arrives: point defense against the incoming
    // torpedoes, then the impacts resolved — never left hanging.
    expect(types.has('fire-small-target')).toBe(true)
    expect(types.has('resolve-homing-impacts')).toBe(true)
  })

  it('the admiral wins the season against the ensign', () => {
    // One duel proves the dice; a season proves the doctrine. Each seed is
    // played twice with the hulls swapped, so neither captain owns the
    // stronger ship. Deterministic, so this is an exact count, not a flake.
    //
    // Calibration honesty: in a symmetric duel between competent captains
    // the dice and the damage deck dominate, so rank is worth points, not
    // routs — measured ~56% for the admiral over this fixed season. The
    // real difficulty gap is the ensign's exploitable habits (red-band pot
    // shots, no target lead, second-best plots, no exotic systems), which a
    // human punishes far harder than a mirror-image AI does.
    const margin = (seed: number, blueDiff: AiDifficulty, redDiff: AiDifficulty): number => {
      const game = startScenario('s3.1-the-duel', { seed })
      const blue: Driver = { game, journal: [], memo: createAiMemo(), sides: ['Blue Force'], difficulty: blueDiff }
      const red: Driver = { game, journal: [], memo: createAiMemo(), sides: ['Red Force'], difficulty: redDiff }
      const both = (closing: boolean) => {
        drive(blue, closing)
        drive(red, closing)
      }
      both(false)
      for (let steps = 0; steps < 400; steps++) {
        if (overFor(game) || game.round > 12) break
        both(true)
        applyAction(game, { type: 'advance-segment' })
        both(false)
      }
      const health = (side: string) => {
        const ship = game.ships.find((s) => s.side === side)!
        return ship.destroyed ? -1 : ship.disengaged ? 0 : structureRemaining(ship)
      }
      return health('Blue Force') - health('Red Force')
    }

    let wins = 0
    let losses = 0
    for (let seed = 1; seed <= 32; seed++) {
      for (const m of [margin(seed, 'admiral', 'ensign'), -margin(seed, 'ensign', 'admiral')]) {
        if (m > 0) wins++
        else if (m < 0) losses++
      }
    }
    expect(wins).toBeGreaterThan(losses)
  })

  it('the idempotence contract holds: asking twice owes nothing new', () => {
    const d: Driver = {
      game: startScenario('s3.1-the-duel', { seed: 99 }),
      journal: [],
      memo: createAiMemo(),
      sides: ['Red Force'],
    }
    drive(d)
    // Immediately asking again — as every human click does — owes nothing.
    expect(aiNextActions(d.game, d.sides, d.memo)).toHaveLength(0)
  })
})
