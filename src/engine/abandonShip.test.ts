import { describe, expect, it } from 'vitest'
import { findShipForm, VALLARI_CRUISER } from '../data/ships'
import { THE_DUEL } from '../data/scenarios'
import { applyAction } from './actions'
import {
  crewComplement,
  crewVictoryPoints,
  podPosition,
  VICTORY_POINTS_PER_CREW,
  type EscapePod,
} from './abandonShip'
import {
  advanceSegment,
  createGame,
  resetPodIds,
  victoryPoints,
  type GameState,
} from './game'
import { createShip, type ShipState } from './shipState'

/**
 * Abandoning ship (E11.4 – E11.6, optional).
 *
 * The one part of Section E where a losing captain still has something to play
 * for: the hull is lost either way, but the people aboard are worth points to
 * whoever gets to them.
 */

const YORKTOWN = findShipForm('YORKTOWN IIIc-class Command Cruiser')!

function ship(id: string, side: string, form = YORKTOWN, x = 20, y = 20): ShipState {
  return createShip({
    id,
    side,
    name: id.toUpperCase(),
    form,
    placement: { position: { x, y }, heading: 0 },
    speed: 0,
  })
}

function battle(abandonShip = true, gap = 2): { game: GameState; dying: ShipState; friend: ShipState } {
  resetPodIds()
  const dying = ship('dying', 'Blue Force')
  const friend = ship('friend', 'Blue Force', VALLARI_CRUISER, 20, 20 + gap)
  const game = createGame({
    scenario: THE_DUEL,
    ships: [dying, friend],
    seed: 9,
    options: { derelicts: true, explosions: false, abandonShip, decelerationFromDamage: false },
  })
  // Emergency beaming takes the safeties off; it does not need the shields
  // down at either end, but the ordinary transporter checks do, and a ship
  // with its shields up is the realistic case here.
  return { game, dying, friend }
}

describe('the crew aboard (E11.5.4)', () => {
  it('is two units per size class', () => {
    const s = ship('a', 'Blue Force')
    expect(crewComplement(s)).toBe(s.form.sizeClass * 2)
    expect(s.crewUnits).toBe(crewComplement(s))
  })
})

describe('emergency transport (E11.5)', () => {
  it('rolls one green die per crew unit and moves the survivors across', () => {
    const { game, dying, friend } = battle()
    const aboard = dying.crewUnits
    expect(applyAction(game, { type: 'evacuate-crew', shipId: dying.id, toShipId: friend.id }).message)
      .toBeNull()

    expect(dying.crewUnits).toBe(0)
    const saved = game.crewRescued['Blue Force'] ?? 0
    expect(saved).toBeGreaterThan(0)
    expect(saved).toBeLessThanOrEqual(aboard)
    const line = game.log.find((l) => l.message.includes('emergency transport'))!
    expect(line.message).toContain('E11.5.4')
  })

  it('will not reach a ship outside transporter range (E11.5.1)', () => {
    const { game, dying, friend } = battle(true, 40)
    expect(
      applyAction(game, { type: 'evacuate-crew', shipId: dying.id, toShipId: friend.id }).message,
    ).toMatch(/E11\.5\.1/)
    expect(dying.crewUnits).toBeGreaterThan(0)
  })

  it('refuses a ship with nobody left aboard', () => {
    const { game, dying, friend } = battle()
    applyAction(game, { type: 'evacuate-crew', shipId: dying.id, toShipId: friend.id })
    expect(
      applyAction(game, { type: 'evacuate-crew', shipId: dying.id, toShipId: friend.id }).message,
    ).toMatch(/nobody left/)
  })

  it('is refused entirely when the optional rule is not in play', () => {
    const { game, dying, friend } = battle(false)
    expect(
      applyAction(game, { type: 'evacuate-crew', shipId: dying.id, toShipId: friend.id }).message,
    ).toMatch(/not in play/)
  })
})

describe('escape pods (E11.6)', () => {
  it('puts the whole crew into a counter two inches off the hull', () => {
    const { game, dying } = battle()
    const aboard = dying.crewUnits
    expect(
      applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false }).message,
    ).toBeNull()

    expect(game.escapePods).toHaveLength(1)
    expect(game.escapePods[0].crew).toBe(aboard)
    expect(game.escapePods[0].side).toBe('Blue Force')
    expect(dying.crewUnits).toBe(0)
    expect(podPosition(dying)).toEqual(game.escapePods[0].position)
  })

  it('lets the captain scuttle the ship on the way out, pods clear (E11.6.3)', () => {
    const { game, dying } = battle()
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: true })
    expect(dying.destroyed).toBe(true)
    expect(game.escapePods).toHaveLength(1)
    expect(game.escapePods[0].crew).toBeGreaterThan(0)
  })

  it('is too late once the hull has been blown apart (E11.6.1)', () => {
    const { game, dying } = battle()
    dying.destroyed = true
    expect(
      applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false }).message,
    ).toMatch(/E11\.6\.1/)
  })

  it('takes the crew down with a ship destroyed under fire (E11.6.1)', () => {
    const { game, dying } = battle()
    dying.destroyed = true
    advanceSegment(game)
    expect(dying.crewUnits).toBe(0)
    expect(game.crewRescued['Blue Force'] ?? 0).toBe(0)
    expect(game.log.some((l) => l.message.includes('E11.6.1'))).toBe(true)
  })
})

describe('picking pods up (E11.6.5)', () => {
  it('lands a pod on a stopped ship within range 1', () => {
    const { game, dying, friend } = battle(true, 1)
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false })
    const pod = game.escapePods[0]
    friend.speed = 0
    friend.placement.position = { ...pod.position }

    expect(
      applyAction(game, { type: 'recover-pod', podId: pod.id, shipId: friend.id, method: 'land' })
        .message,
    ).toBeNull()
    expect(game.escapePods).toHaveLength(0)
    expect(game.crewRescued['Blue Force']).toBe(pod.crew)
  })

  it('refuses a landing to a ship still under way', () => {
    const { game, dying, friend } = battle(true, 1)
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false })
    const pod = game.escapePods[0]
    friend.placement.position = { ...pod.position }
    friend.speed = 3

    expect(
      applyAction(game, { type: 'recover-pod', podId: pod.id, shipId: friend.id, method: 'land' })
        .message,
    ).toMatch(/must be stopped/)
  })

  it('beams one crew unit per transporter per phase', () => {
    const { game, dying, friend } = battle(true, 1)
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false })
    const pod = game.escapePods[0]
    const before = pod.crew

    expect(
      applyAction(game, { type: 'recover-pod', podId: pod.id, shipId: friend.id, method: 'beam' })
        .message,
    ).toBeNull()
    expect(pod.crew).toBe(before - 1)
    expect(game.crewRescued['Blue Force']).toBe(1)
  })

  it('credits an enemy who captures the pod instead (E11.4.2)', () => {
    resetPodIds()
    const dying = ship('dying', 'Blue Force')
    const raider = ship('raider', 'Red Force', VALLARI_CRUISER, 20, 21)
    const game = createGame({
      scenario: THE_DUEL,
      ships: [dying, raider],
      seed: 4,
      options: { derelicts: true, explosions: false, abandonShip: true, decelerationFromDamage: false },
    })
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false })
    const pod = game.escapePods[0]
    raider.speed = 0
    raider.placement.position = { ...pod.position }

    applyAction(game, { type: 'recover-pod', podId: pod.id, shipId: raider.id, method: 'land' })
    expect(game.crewRescued['Red Force']).toBe(pod.crew)
    expect(game.crewRescued['Blue Force'] ?? 0).toBe(0)
    expect(game.log.some((l) => l.message.includes('captured'))).toBe(true)
  })
})

describe('what a crew is worth (E11.4.2)', () => {
  it('scores two points a unit for whoever holds them', () => {
    expect(crewVictoryPoints({ Blue: 3 }, [], ['Blue', 'Red']).Blue).toBe(3 * VICTORY_POINTS_PER_CREW)
  })

  it('gives pods still adrift to the side left holding the field', () => {
    const pod: EscapePod = {
      id: 'p1',
      side: 'Red',
      fromShipId: 'x',
      fromShipName: 'X',
      position: { x: 0, y: 0 },
      crew: 4,
    }
    expect(crewVictoryPoints({}, [pod], ['Blue']).Blue).toBe(4 * VICTORY_POINTS_PER_CREW)
  })

  it('scores them for nobody while both sides are still on the map', () => {
    const pod: EscapePod = {
      id: 'p1',
      side: 'Red',
      fromShipId: 'x',
      fromShipName: 'X',
      position: { x: 0, y: 0 },
      crew: 4,
    }
    expect(crewVictoryPoints({}, [pod], ['Blue', 'Red'])).toEqual({})
  })

  it('reaches the battle score, but only with the optional rule on', () => {
    const { game, dying, friend } = battle(true, 1)
    applyAction(game, { type: 'abandon-ship', shipId: dying.id, selfDestruct: false })
    const pod = game.escapePods[0]
    friend.speed = 0
    friend.placement.position = { ...pod.position }
    applyAction(game, { type: 'recover-pod', podId: pod.id, shipId: friend.id, method: 'land' })
    expect(victoryPoints(game)['Blue Force']).toBeGreaterThanOrEqual(
      pod.crew * VICTORY_POINTS_PER_CREW,
    )

    const off = battle(false, 1)
    expect(off.game.options.abandonShip).toBe(false)
    off.game.crewRescued['Blue Force'] = 5
    expect(victoryPoints(off.game)['Blue Force']).toBe(0)
  })
})
