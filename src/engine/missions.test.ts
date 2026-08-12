import { describe, expect, it } from 'vitest'
import { YORKTOWN, VALLARI_CRUISER } from '../data/ships'
import { THE_DUEL } from '../data/scenarios'
import { advanceSegment, createGame, victoryPoints, type GameState, type Scenario } from './game'
import { createShip, type ShipState } from './shipState'
import type { MissionDef } from './missions'

/**
 * Objectives other than killing (missions.ts).
 *
 * The design under test: missions pay victory points into the same S2.8
 * ledger the guns write, so the AI's posture, retreat and focus follow them
 * with no new machinery — and each mission's own mechanics live in the
 * sequence of play, not in the UI, so replays and remote consoles agree.
 */

function ship(args: {
  id: string
  side?: string
  form?: typeof YORKTOWN
  x?: number
  y?: number
  heading?: number
  speed?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: args.speed ?? 0,
  })
}

function battle(missions: MissionDef[], ships: ShipState[]): GameState {
  const scenario: Scenario = { ...THE_DUEL, missions }
  return createGame({ scenario, ships, seed: 5 })
}

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

const nextRound = (game: GameState) => {
  const round = game.round
  runTo(game, (g) => g.round === round + 1)
}

describe('hold the hill', () => {
  const HILL: MissionDef[] = [
    { kind: 'hold', id: 'hill', name: 'The Hill', center: { x: 18, y: 18 }, radius: 5, pointsPerRound: 3 },
  ]

  it('pays the side holding it alone at the end of each round', () => {
    const game = battle(HILL, [
      ship({ id: 'blue-1', x: 18, y: 18 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 33, y: 4 }),
    ])
    nextRound(game)
    expect(victoryPoints(game)['Blue']).toBe(3)
    expect(victoryPoints(game)['Red']).toBe(0)
    nextRound(game)
    expect(victoryPoints(game)['Blue']).toBe(6)
  })

  it('pays nobody while contested', () => {
    const game = battle(HILL, [
      ship({ id: 'blue-1', x: 17, y: 18 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 19, y: 18 }),
    ])
    nextRound(game)
    expect(victoryPoints(game)['Blue']).toBe(0)
    expect(victoryPoints(game)['Red']).toBe(0)
  })
})

describe('capture the flag', () => {
  const FLAG: MissionDef[] = [
    { kind: 'cargo', id: 'flag', name: 'The Codes', position: { x: 18, y: 18 }, radius: 2, points: 12 },
  ]

  it('is taken aboard after movement, and pays only when carried off the map', () => {
    const game = battle(FLAG, [
      ship({ id: 'blue-1', x: 18, y: 17 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 33, y: 4 }),
    ])
    // The pickup happens when the Navigation Segment ends, not on sight.
    expect(game.missions[0].carrierId).toBeNull()
    runTo(game, (g) => g.round === 2)
    expect(game.missions[0].carrierId).toBe('blue-1')
    expect(victoryPoints(game)['Blue']).toBe(0) // aboard is not home

    const carrier = game.ships.find((s) => s.id === 'blue-1')!
    carrier.disengaged = true
    nextRound(game)
    expect(game.missions[0].delivered).toBe(true)
    // 12 for the delivery, plus the S2.8.4 moderate-damage concession the
    // enemy books for any hull that leaves the battle.
    expect(victoryPoints(game)['Blue']).toBe(12)
    expect(victoryPoints(game)['Red']).toBe(carrier.form.pointValue * 0.5)
  })

  it('drops where the carrier dies, for anyone to take up', () => {
    const game = battle(FLAG, [
      ship({ id: 'blue-1', x: 18, y: 17 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 25, y: 25 }),
    ])
    runTo(game, (g) => g.round === 2)
    expect(game.missions[0].carrierId).toBe('blue-1')

    const carrier = game.ships.find((s) => s.id === 'blue-1')!
    carrier.placement.position = { x: 24, y: 24 }
    carrier.destroyed = true
    nextRound(game)
    expect(game.missions[0].carrierId).not.toBe('blue-1')
    // The Red cruiser was standing within reach of where it fell.
    expect(game.missions[0].carrierId).toBe('red-1')
  })
})

describe('the rescue', () => {
  const SOULS: MissionDef[] = [
    { kind: 'rescue', id: 'station', name: 'Stricken Station', position: { x: 18, y: 18 }, souls: 5, pointsPerSoul: 2 },
  ]

  it('beams souls out by transporter capacity each Operations Segment, paying on the spot', () => {
    // The Yorktown carries 2 transporter boxes and stands inside the 2-inch
    // normal-power reach; the site drains 2 souls per Operations Segment.
    const game = battle(SOULS, [
      ship({ id: 'blue-1', x: 18, y: 17 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 33, y: 4 }),
    ])
    runTo(game, (g) => g.missions[0].soulsLeft < 5)
    expect(game.missions[0].soulsLeft).toBe(3)
    expect(victoryPoints(game)['Blue']).toBe(4)
    runTo(game, (g) => g.missions[0].soulsLeft === 0)
    expect(victoryPoints(game)['Blue']).toBe(10)
  })

  it('is open to either side — a rescue denied to the enemy is a rescue all the same', () => {
    const game = battle(SOULS, [
      ship({ id: 'blue-1', x: 33, y: 4 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 18, y: 17 }),
    ])
    runTo(game, (g) => g.missions[0].soulsLeft === 0)
    expect(victoryPoints(game)['Red']).toBe(10)
    expect(victoryPoints(game)['Blue']).toBe(0)
  })

  it('a ship out of transporter reach lifts nobody', () => {
    const game = battle(SOULS, [
      ship({ id: 'blue-1', x: 18, y: 12 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 33, y: 4 }),
    ])
    nextRound(game)
    expect(game.missions[0].soulsLeft).toBe(5)
  })
})

describe('the AI runs the errand', () => {
  /**
   * A whole battle rather than a fixture, like the point-defense tests, and
   * for the same reason: the first draft of the steering was defeated by a
   * composition no unit could see. The plot scorer's mission term read end
   * positions only — but an easy or standard turn ends exactly where flying
   * straight ends (C2.2.3), so the term could not prefer turning, and a V-7C
   * flew dead straight past its hill and off the far edge of the map. The
   * errand's own bearing term is what this test guards.
   */
  it('captains converge on the hill and someone banks it', async () => {
    const { registerCustomScenarios: reg, startScenario: start } = await import('../data/scenarios')
    const { aiNextActions, createAiMemo } = await import('./ai')
    const { applyAction } = await import('./actions')
    const { activeShips } = await import('./game')
    reg([
      {
        id: 'test-hill-ai',
        name: 'Hill',
        background: '',
        victory: '',
        bounds: { width: 48, height: 48, fixed: true },
        terrain: [],
        missions: [
          { kind: 'hold', id: 'h', name: 'Hill', center: { x: 24, y: 10 }, radius: 5, pointsPerRound: 3 },
        ],
        sides: [
          { side: 'Blue Fleet', objective: '', facing: 2, speed: 4, anchor: { x: 6, y: 24 }, spread: { x: 0, y: 5 }, force: ['union-yorktown-i-class-heavy-cruiser'] },
          { side: 'Red Fleet', objective: '', facing: 6, speed: 4, anchor: { x: 42, y: 24 }, spread: { x: 0, y: 5 }, force: ['vallari-v-7c-raider-class-battlecruiser'] },
        ],
      },
    ])
    const game = start('test-hill-ai', { seed: 31 })
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const memos = new Map(sides.map((x) => [x, createAiMemo()]))
    const drive = (closing: boolean) => {
      for (let pass = 0; pass < 50; pass++) {
        const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
        for (const side of sides) {
          for (let g = 0; g < 400; g++) {
            const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, 'captain', 'steady', false)
            if (batch.length === 0) break
            for (const a of batch) applyAction(game, a)
          }
        }
        if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
      }
    }
    drive(false)
    for (let step = 0; step < 1200; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 8) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    const banked = Object.values(game.missions[0].earned).reduce((a, b) => a + b, 0)
    expect(banked, 'nobody ever held the hill').toBeGreaterThan(0)
    reg([])
  }, 120000)
})
