import { describe, expect, it } from 'vitest'
import { BLUE, RED, startScenario } from '../data/scenarios'
import {
  boardersAboard,
  boardingSides,
  capturedFtlAvailable,
  capturedRefusal,
  CAPTURED_FTL_LOCKOUT,
  combatDice,
  controllingSide,
  isCaptured,
  KILL_FACE,
  maneuverAllowedWhenCaptured,
  MAX_ATTACKERS_PER_SQUAD,
  resolveBoarding,
  tightQuarters,
} from './boarding'
import {
  advanceSegment,
  attackAllowed,
  fightBoarders,
  performScan,
  setSabotageSquads,
  shipsUnderBoarding,
  type GameState,
} from './game'
import { DIE_FACES, type Rng } from './dice'
import { validatePlot } from './navigation'
import { structureRemaining, type ShipState } from './shipState'

/**
 * Boarding combat (J6.2).
 *
 * J6.3 (arming the crew) and B3.4 (damage control repelling boarders) are both
 * optional rules; B3.4 is implemented in the Damage Control Segment, J6.3 is
 * out of scope for the Standard game.
 */

function duel(seed = 1): GameState {
  return startScenario('s3.1-the-duel', { seed })
}

function runTo(game: GameState, segment: string): void {
  for (let i = 0; i < 300 && game.segment !== segment; i += 1) advanceSegment(game)
}

/**
 * A die that always shows the given face, so a rule can be read exactly. The
 * index is looked up from the real face table rather than assumed, so
 * reordering the die cannot quietly invert a test.
 */
function fixedRng(face: 'L' | 'M' | '-'): Rng {
  const index = DIE_FACES.blue.indexOf(face)
  if (index < 0) throw new Error(`a blue die has no ${face} face`)
  return { int: () => index } as unknown as Rng
}

// ---------------------------------------------------------------------------
// J6.2.3 — tight quarters
// ---------------------------------------------------------------------------

describe('tight quarters (J6.2.3)', () => {
  it('lets everyone fight while the odds are under two to one', () => {
    expect(combatDice(3, 2)).toBe(3)
    expect(tightQuarters(3, 2)).toBe(false)
  })

  it('caps the larger force at two squads per defender', () => {
    expect(tightQuarters(6, 2)).toBe(true)
    expect(combatDice(6, 2)).toBe(2 * MAX_ATTACKERS_PER_SQUAD)
    // Twelve marines against one defender still only get two dice.
    expect(combatDice(12, 1)).toBe(2)
  })

  it('is what makes a small force expensive to dig out', () => {
    // A lone squad facing ten takes two dice a round, not ten.
    expect(combatDice(10, 1)).toBe(2)
    expect(combatDice(1, 10)).toBe(1)
  })

  it('gives no dice against nobody', () => {
    expect(combatDice(4, 0)).toBe(0)
    expect(tightQuarters(4, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// J6.2.2 — the fight
// ---------------------------------------------------------------------------

describe('boarding combat (J6.2.2)', () => {
  function boarded(attackers: number, defenders: number) {
    const game = duel()
    const ship = game.ships[1]
    ship.marineSquads = defenders
    ship.boarders[BLUE] = attackers
    return { game, ship }
  }

  it('kills one enemy squad per Light hit', () => {
    const { ship } = boarded(3, 3)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('L'))
    expect(KILL_FACE).toBe('L')
    expect(outcome.attackers.kills).toBe(3)
    expect(outcome.defenders.kills).toBe(3)
  })

  it('ignores misses and Medium hits', () => {
    const { ship } = boarded(4, 4)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('M'))
    expect(outcome.attackers.kills).toBe(0)
    expect(ship.marineSquads).toBe(4)
    expect(ship.boarders[BLUE]).toBe(4)
  })

  it('resolves both sides at once, so a fight can wipe out everyone', () => {
    const { ship } = boarded(2, 2)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('L'))
    expect(ship.marineSquads).toBe(0)
    expect(boardersAboard(ship)).toBe(0)
    // Nobody is left to hold the ship, so it is not captured.
    expect(outcome.captured).toBe(false)
    expect(outcome.repelled).toBe(true)
  })

  it('captures the ship when every defender is dead (J6.2.2 item 2)', () => {
    const { ship } = boarded(4, 1)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('L'))
    expect(ship.marineSquads).toBe(0)
    // Tight quarters means only two defenders' worth of dice come back, and
    // the single defender rolls one — so attackers survive.
    expect(ship.boarders[BLUE]).toBeGreaterThan(0)
    expect(outcome.captured).toBe(true)
  })

  it('ends the action when every attacker is dead (J6.2.2 item 3)', () => {
    const { ship } = boarded(1, 4)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('L'))
    expect(outcome.repelled).toBe(true)
    expect(ship.boarders[BLUE]).toBeUndefined()
    expect(boardingSides(ship)).toEqual([])
  })

  it('runs on into the next round while both sides survive (item 4)', () => {
    const { ship } = boarded(4, 4)
    const outcome = resolveBoarding(ship, BLUE, fixedRng('M'))
    expect(outcome.continues).toBe(true)
    expect(outcome.captured).toBe(false)
    expect(outcome.repelled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// J6.2.4 — wrecking the ship instead
// ---------------------------------------------------------------------------

describe('marine sabotage (J6.2.4)', () => {
  it('takes the sabotaging squads out of the fight', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.marineSquads = 4
    ship.boarders[BLUE] = 4
    const outcome = resolveBoarding(ship, BLUE, fixedRng('M'), 3)
    expect(outcome.sabotage.squads).toBe(3)
    expect(outcome.attackers.squads).toBe(1)
    expect(outcome.attackers.dice).toBe(1)
  })

  it('scores a damage point per Light hit', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.marineSquads = 1
    ship.boarders[BLUE] = 3
    const outcome = resolveBoarding(ship, BLUE, fixedRng('L'), 3)
    expect(outcome.sabotage.damage).toBe(3)
  })

  it('cannot send more saboteurs than there are squads aboard', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.marineSquads = 2
    ship.boarders[BLUE] = 2
    const outcome = resolveBoarding(ship, BLUE, fixedRng('M'), 9)
    expect(outcome.sabotage.squads).toBe(2)
    expect(outcome.attackers.squads).toBe(0)
  })

  it('never damages the structure track — those hits are lost', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.marineSquads = 1
    ship.boarders[BLUE] = 6
    const before = structureRemaining(ship)
    setSabotageSquads(game, ship, BLUE, 6)
    // Enough damage that a structure hit is all but certain over many draws.
    for (let i = 0; i < 12; i += 1) {
      ship.boarders[BLUE] = 6
      ship.marineSquads = 1
      setSabotageSquads(game, ship, BLUE, 6)
      fightBoarders(game, ship, BLUE)
      if (ship.destroyed) break
    }
    expect(structureRemaining(ship)).toBe(before)
    expect(ship.destroyed).toBe(false)
    expect(game.log.some((e) => /Structure Hit ignored/.test(e.message))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sequence of play
// ---------------------------------------------------------------------------

describe('the Boarding Combat Segment (J6.2.1)', () => {
  it('fights automatically in the Final Phase', () => {
    const game = duel(3)
    const ship = game.ships[1]
    ship.marineSquads = 3
    ship.boarders[BLUE] = 3
    expect(shipsUnderBoarding(game).map((s) => s.id)).toEqual([ship.id])

    runTo(game, 'boarding-combat')
    advanceSegment(game)
    expect(game.log.some((e) => /boarding combat/.test(e.message))).toBe(true)
  })

  it('leaves ships with nobody aboard alone', () => {
    const game = duel()
    expect(shipsUnderBoarding(game)).toEqual([])
    runTo(game, 'boarding-combat')
    const before = game.log.length
    advanceSegment(game)
    expect(game.log.slice(before).some((e) => /boarding combat/.test(e.message))).toBe(false)
  })

  it('clears the sabotage orders once the segment is done', () => {
    const game = duel(5)
    const ship = game.ships[1]
    ship.marineSquads = 2
    ship.boarders[BLUE] = 2
    setSabotageSquads(game, ship, BLUE, 1)
    runTo(game, 'boarding-combat')
    advanceSegment(game)
    expect(game.ops.sabotage).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// J6.2.5 — a captured ship
// ---------------------------------------------------------------------------

describe('a captured ship (J6.2.5)', () => {
  function captured(): { game: GameState; ship: ShipState } {
    const game = duel(7)
    const ship = game.ships[1]
    ship.marineSquads = 1
    ship.boarders[BLUE] = 6
    fightBoarders(game, ship, BLUE)
    // Keep fighting until it falls; six squads against one gets there fast.
    for (let i = 0; i < 20 && !ship.capturedBy; i += 1) {
      ship.boarders[BLUE] = Math.max(1, ship.boarders[BLUE] ?? 1)
      fightBoarders(game, ship, BLUE)
    }
    return { game, ship }
  }

  it('records who took it and when', () => {
    const { game, ship } = captured()
    expect(isCaptured(ship)).toBe(true)
    expect(ship.capturedBy).toBe(BLUE)
    expect(ship.capturedRound).toBe(game.round)
    expect(controllingSide(ship)).toBe(BLUE)
    expect(controllingSide(game.ships[0])).toBe(game.ships[0].side)
  })

  it('ceases to perform any actions or functions', () => {
    const { game, ship } = captured()
    expect(attackAllowed(game, ship, game.ships[0])).toMatch(/J6\.2\.5/)
    expect(performScan(game, ship, game.ships[0].id).refusal).toMatch(/J6\.2\.5/)
    expect(capturedRefusal(game.ships[0])).toBeNull()
  })

  it('may only fly straight or make Standard turns (item 1)', () => {
    const { ship } = captured()
    expect(maneuverAllowedWhenCaptured('straight')).toBe(true)
    expect(maneuverAllowedWhenCaptured('standard')).toBe(true)
    expect(maneuverAllowedWhenCaptured('hard')).toBe(false)
    expect(maneuverAllowedWhenCaptured('em-180')).toBe(false)

    const card = { speed: ship.speed, accel: 0, maneuver: 'hard' as const, direction: 'left' as const }
    const errors = validatePlot(ship, { ...card, sensors: ship.sensors } as never)
    expect(errors.some((e) => /J6\.2\.5/.test(e.message))).toBe(true)
  })

  it('may still change speed', () => {
    const { ship } = captured()
    const card = {
      speed: ship.speed,
      accel: 1,
      maneuver: 'straight' as const,
      direction: 'left' as const,
      sensors: ship.sensors,
    }
    const errors = validatePlot(ship, card as never)
    expect(errors.some((e) => /J6\.2\.5/.test(e.message))).toBe(false)
  })

  it('cannot reach FTL for ten rounds (item 2)', () => {
    const { ship } = captured()
    const taken = ship.capturedRound!
    expect(capturedFtlAvailable(ship, taken)).toBe(false)
    expect(capturedFtlAvailable(ship, taken + CAPTURED_FTL_LOCKOUT - 1)).toBe(false)
    expect(capturedFtlAvailable(ship, taken + CAPTURED_FTL_LOCKOUT)).toBe(true)
    expect(CAPTURED_FTL_LOCKOUT).toBe(10)
  })

  it('leaves an uncaptured ship alone', () => {
    const game = duel()
    expect(capturedFtlAvailable(game.ships[0], 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Getting aboard
// ---------------------------------------------------------------------------

describe('reaching an enemy hull (J6.1.2)', () => {
  it('counts squads from every side that has boarded', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.boarders[BLUE] = 2
    ship.boarders[RED] = 1
    expect(boardersAboard(ship)).toBe(3)
    expect(boardingSides(ship).sort()).toEqual([BLUE, RED].sort())
  })

  it('drops a side from the list once its squads are gone', () => {
    const game = duel()
    const ship = game.ships[1]
    ship.boarders[BLUE] = 0
    expect(boardingSides(ship)).toEqual([])
  })
})
