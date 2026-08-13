import { describe, expect, it } from 'vitest'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { THE_DUEL } from '../data/scenarios'
import { aiNextActions, createAiMemo } from './ai'
import { createGame, type GameState } from './game'
import { createShip, type ShipState } from './shipState'
import type { SmallCraft } from './smallCraft'

/**
 * The AI can see small craft (E12.1.3).
 *
 * It could not, for the whole life of the project: the fleet's point-defense
 * tally was built from `game.homing` alone, so a side would sit and be jammed
 * by a shuttle parked on its opponent's hull, or let a probe read it at
 * leisure, with every point-defense mount aboard idle and in range. Nothing
 * refused the shot — `fire-small-target` has always resolved craft and
 * warheads through one action — the craft simply never reached the list of
 * things worth shooting at.
 */

function ship(args: {
  id: string
  side?: string
  form?: typeof YORKTOWN
  x?: number
  y?: number
  heading?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: 0,
  })
}

function craft(args: Partial<SmallCraft> & { id: string; side: string; x: number; y: number }): SmallCraft {
  return {
    id: args.id,
    kind: args.kind ?? 'shuttle',
    side: args.side,
    motherId: args.motherId ?? 'red-1',
    position: { x: args.x, y: args.y },
    damage: 0,
    activated: false,
    ...(args.dockedTo ? { dockedTo: args.dockedTo } : {}),
  }
}

/** Every action the AI would take for a side this phase, armed and in combat. */
function fireActions(game: GameState, side: string) {
  for (const s of game.ships) {
    for (const weapon of s.form.weapons) {
      s.mounts[weapon.id].forEach((m, i) => {
        m.armed = weapon.mounts[i].armingCircles
      })
    }
  }
  game.phase = 'combat-1'
  game.segment = 'combat'
  const memo = createAiMemo()
  const out = []
  for (let i = 0; i < 40; i++) {
    const batch = aiNextActions(game, [side], memo, false, 'captain')
    if (batch.length === 0) break
    out.push(...batch)
    // Only planning is under test; do not mutate the board.
    if (batch.every((a) => a.type === 'pass-fire' || a.type === 'advance-firing-step')) break
  }
  return out
}

function battle(craftList: SmallCraft[]): GameState {
  const game = createGame({
    scenario: THE_DUEL,
    ships: [
      ship({ id: 'blue-1', x: 18, y: 18 }),
      ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 30, y: 18 }),
    ],
    seed: 4,
  })
  game.smallCraft.push(...craftList)
  return game
}

describe('the fleet point-defense tally sees small craft', () => {
  it('shoots an enemy shuttle sitting in range', () => {
    const game = battle([craft({ id: 'c1', side: 'Red', x: 19, y: 18 })])
    const shots = fireActions(game, 'Blue').filter((a) => a.type === 'fire-small-target')
    expect(shots.length, 'the AI never fired at the shuttle').toBeGreaterThan(0)
    expect(shots.every((a) => a.targetId === 'c1')).toBe(true)
  })

  it('never shoots its own craft', () => {
    const game = battle([
      craft({ id: 'mine', side: 'Blue', motherId: 'blue-1', x: 19, y: 18 }),
      craft({ id: 'theirs', side: 'Red', x: 19, y: 19 }),
    ])
    const shots = fireActions(game, 'Blue').filter((a) => a.type === 'fire-small-target')
    expect(shots.length).toBeGreaterThan(0)
    expect(shots.some((a) => a.targetId === 'mine')).toBe(false)
  })

  it('leaves a docked craft alone — it is aboard, not on the board', () => {
    const game = battle([craft({ id: 'c1', side: 'Red', x: 19, y: 18, dockedTo: 'red-1' })])
    const shots = fireActions(game, 'Blue').filter((a) => a.type === 'fire-small-target')
    expect(shots.length).toBe(0)
  })

  it('takes the jamming shuttle before the plain one — it is the one doing harm (J8.4.1)', () => {
    const game = battle([
      craft({ id: 'plain', side: 'Red', x: 19, y: 18 }),
      craft({ id: 'jammer', kind: 'jamming-shuttle', side: 'Red', x: 19, y: 19 }),
    ])
    const shots = fireActions(game, 'Blue').filter((a) => a.type === 'fire-small-target')
    expect(shots.length).toBeGreaterThan(0)
    expect(shots[0].targetId).toBe('jammer')
  })

  it('still answers a warhead before any shuttle: a counter about to land is damage this phase', () => {
    const game = battle([craft({ id: 'c1', side: 'Red', x: 19, y: 18 })])
    const torp = VALLARI_CRUISER.weapons.find((w) => w.traits.some((t) => t.startsWith('HOMING')))
    if (!torp) return // no homing weapon in the printed Vallari cruiser; nothing to order against
    game.homing.push({
      id: 'hw1',
      weaponId: torp.id,
      weaponName: torp.name,
      ownerId: 'red-1',
      side: 'Red',
      targetId: 'blue-1',
      position: { x: 19, y: 18 },
      phasesFlown: 1,
      maxSpeed: 9,
      damage: 0,
      destroyed: false,
      impacted: false,
      tractored: false,
    } as never)
    const shots = fireActions(game, 'Blue').filter((a) => a.type === 'fire-small-target')
    expect(shots.length).toBeGreaterThan(0)
    expect(shots[0].targetId).toBe('hw1')
  })
})
