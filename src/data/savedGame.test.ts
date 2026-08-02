import { describe, expect, it } from 'vitest'
import { applyAction, type GameAction } from '../engine/actions'
import { activeShips, isCombatPhase, type GameState } from '../engine/game'
import { arcTo, canBearOn } from '../engine/geometry'
import { mountIsReady } from '../engine/shipState'
import type { ShipForm } from '../engine/types'
import {
  buildGame,
  parseSavedGame,
  replayGame,
  withEmbeddedForms,
  type GameSetup,
  type SavedGame,
} from './savedGame'
import { SHIP_FORMS, shipFormById } from './ships'

/**
 * The whole persistence story rests on one claim: (setup + journal) rebuilds
 * the game exactly, dice included. These tests script a real battle through
 * the action layer — allocation, plotting, movement, gunnery — and then hold
 * the replay to that claim.
 */

/** Everything observable that matters, flattened for comparison. */
function snapshot(game: GameState) {
  return {
    round: game.round,
    phase: game.phase,
    segment: game.segment,
    ships: game.ships.map((s) => ({
      id: s.id,
      position: s.placement.position,
      heading: s.placement.heading,
      speed: s.speed,
      stress: s.stressMarkers,
      destroyed: s.destroyed,
      disengaged: s.disengaged,
      allocation: s.allocation,
      mounts: s.mounts,
      blueShieldDamage: s.blueShieldDamage,
      greenShieldDamage: s.greenShieldDamage,
      armorDamage: s.armorDamage,
      reactorDamage: s.reactorDamage,
      batteryCharged: s.batteryCharged,
      structureDamaged: s.structureDamaged,
      systemDamage: s.systemDamage,
      excess: s.excessStructureDamage,
      marines: s.marineSquads,
      boarders: s.boarders,
    })),
    homing: game.homing,
    smallCraft: game.smallCraft,
    log: game.log.map((l) => l.message),
  }
}

/**
 * A scripted battle, driven entirely through actions so the journal is the
 * complete record. Round 1: full allocation, straight-ahead plots, and every
 * bearing gun fired once battle is joined.
 */
function scriptedBattle(): { setup: GameSetup; journal: GameAction[]; game: GameState } {
  const setup: GameSetup = { scenarioId: 's3.1-the-duel', seed: 1234 }
  const game = buildGame(setup)
  const journal: GameAction[] = []
  const play = (action: GameAction) => {
    journal.push(action)
    return applyAction(game, action)
  }

  // Resource Allocation: power the weapon lines and spend the arming points.
  for (const ship of activeShips(game)) {
    for (const line of ship.form.functions) {
      if (line.kind !== 'weapon' && line.kind !== 'sensor' && line.kind !== 'accel') continue
      play({
        type: 'allocate',
        shipId: ship.id,
        lineId: line.id,
        circles: line.kind === 'weapon' ? line.steps.length : 1,
      })
    }
    for (const weapon of ship.form.weapons) {
      // More attempts than circles: refusals are journaled too, deliberately.
      for (let i = 0; i < weapon.mounts.length * 4; i++) {
        play({ type: 'arm-mount', shipId: ship.id, weaponId: weapon.id, mountIndex: i % weapon.mounts.length })
      }
    }
  }

  // Walk the round, plotting closure and firing whatever bears.
  let guard = 0
  while (game.round === 1 && guard++ < 40) {
    if (isCombatPhase(game.phase) && game.segment === 'command') {
      for (const ship of activeShips(game)) {
        play({ type: 'plot-maneuver', shipId: ship.id, maneuver: 'straight', direction: null })
        play({ type: 'plot-sensor', shipId: ship.id, key: 'targeting', value: 1 })
        play({ type: 'plot-sensor', shipId: ship.id, key: 'tacticalScan', value: 1 })
      }
    }
    if (isCombatPhase(game.phase) && game.segment === 'combat') {
      for (const ship of activeShips(game)) {
        const enemy = activeShips(game).find((s) => s.side !== ship.side)
        if (!enemy) continue
        const arcs = arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position)
        const mounts = ship.form.weapons.flatMap((weapon) =>
          weapon.mounts
            .map((mount, mountIndex) => ({ weaponId: weapon.id, mountIndex, mount }))
            .filter(
              ({ mount, mountIndex }) =>
                canBearOn(mount.arcs, arcs) &&
                mountIsReady(weapon, mountIndex, ship.mounts[weapon.id][mountIndex]),
            )
            .map(({ weaponId, mountIndex }) => ({ weaponId, mountIndex })),
        )
        if (mounts.length > 0) {
          play({
            type: 'fire-volley',
            attackerId: ship.id,
            targetId: enemy.id,
            mounts,
            mode: 'standard',
            degraded: false,
          })
        } else {
          play({ type: 'pass-fire', shipId: ship.id })
        }
      }
    }
    play({ type: 'advance-segment' })
  }

  return { setup, journal, game }
}

describe('replayGame (deterministic reconstruction)', () => {
  it('rebuilds a scripted battle exactly, dice included', () => {
    const { setup, journal, game } = scriptedBattle()
    // The script must actually have fought: dice were rolled and logged.
    expect(game.log.some((l) => /fires on/.test(l.message))).toBe(true)

    const rebuilt = replayGame({ version: 1, setup, actions: journal })
    expect(snapshot(rebuilt)).toEqual(snapshot(game))
  })

  it('survives a JSON round trip — the battle-file path', () => {
    const { setup, journal, game } = scriptedBattle()
    const text = JSON.stringify({ version: 1, setup, actions: journal })
    const parsed = parseSavedGame(text)
    expect(typeof parsed).not.toBe('string')
    const rebuilt = replayGame(parsed as SavedGame)
    expect(snapshot(rebuilt)).toEqual(snapshot(game))
  })

  it('replaying all but the last action is exact undo', () => {
    const { setup, journal } = scriptedBattle()
    // Live-play the prefix as its own game, then compare against a rewind.
    const prefix = journal.slice(0, -1)
    const live = buildGame(setup)
    for (const action of prefix) applyAction(live, action)

    const rewound = replayGame({ version: 1, setup, actions: prefix })
    expect(snapshot(rewound)).toEqual(snapshot(live))
  })
})

describe('battle files', () => {
  it('rejects things that are not battle files, with a reason', () => {
    expect(typeof parseSavedGame('not json')).toBe('string')
    expect(typeof parseSavedGame('{}')).toBe('string')
    expect(typeof parseSavedGame('{"version":2,"setup":{},"actions":[]}')).toBe('string')
  })

  it('embeds referenced non-canon designs so a save travels whole', () => {
    const donor = structuredClone(SHIP_FORMS[0]) as ShipForm
    donor.id = 'custom-test-embed'
    donor.name = 'TEST-class Embed'
    donor.faction = 'Custom'

    // The design exists only inside the setup, as it would on another machine.
    const setup = withEmbeddedForms({
      scenarioId: 's3.1-the-duel',
      seed: 7,
      fleets: { 'Blue Force': ['custom-test-embed'], 'Red Force': [SHIP_FORMS[1].id] },
      customForms: [donor],
    })
    expect(setup.customForms?.some((f) => f.id === 'custom-test-embed')).toBe(true)

    const game = buildGame(setup)
    expect(game.ships.some((s) => s.form.id === 'custom-test-embed')).toBe(true)
    // Embedding must not leak the design into the canon roster.
    expect(SHIP_FORMS.some((f) => f.id === 'custom-test-embed')).toBe(false)
  })

  it('does not embed canon forms', () => {
    const setup = withEmbeddedForms({
      scenarioId: 's3.1-the-duel',
      seed: 7,
      fleets: { 'Blue Force': [SHIP_FORMS[0].id] },
    })
    expect(setup.customForms).toBeUndefined()
    expect(shipFormById(SHIP_FORMS[0].id)).toBeDefined()
  })
})

/**
 * The armed-start house rule is part of the setup, so it has to survive the
 * round trip like any other: a battle recorded with cold guns must not replay
 * with hot ones.
 */
describe('weapons armed at start', () => {
  const everyMountReady = (game: ReturnType<typeof buildGame>) =>
    game.ships.every((ship) =>
      ship.form.weapons.every((weapon) =>
        weapon.mounts.every((_, i) => mountIsReady(weapon, i, ship.mounts[weapon.id][i])),
      ),
    )

  it('deploys every mount charged, where the printed game opens cold', () => {
    const cold = buildGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    const hot = buildGame({ scenarioId: 's3.1-the-duel', seed: 5, armedStart: true })
    expect(everyMountReady(cold)).toBe(false)
    expect(everyMountReady(hot)).toBe(true)
  })

  it('rides in the save, so a replay opens the same way', () => {
    const saved: SavedGame = {
      version: 1,
      setup: { scenarioId: 's3.1-the-duel', seed: 5, armedStart: true },
      actions: [],
    }
    const round = parseSavedGame(JSON.stringify(saved))
    expect(typeof round).not.toBe('string')
    expect(everyMountReady(replayGame(round as SavedGame))).toBe(true)
  })
})
