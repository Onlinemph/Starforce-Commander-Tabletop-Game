import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { defaultCommandCard, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { structureRemaining, type ShipState } from './shipState'

/**
 * Split fire (rules reading 2), straight from the Union III vs four
 * Yorktowns playtest: "I can only fire on one ship per phase. After I fire on
 * a ship, then if I go to try to FIRE VOLLEY at another, I get 'Already Fired
 * or Passed This Phase'."
 *
 * A ship's opportunity is now one CONTIGUOUS turn at the guns: several
 * volleys at different targets, each mount speaking once (E6.2 Step 6),
 * closed by its own pass or anyone else's action. Old journals — which
 * recorded those refused second volleys — carry no version stamp and replay
 * under reading 1, where the refusal stands exactly as it did.
 */

const DREADNOUGHT = 'union-union-iii-class-dreadnought'
const CRUISER = 'union-yorktown-i-class-heavy-cruiser'

interface Fixture {
  game: GameState
  blue: ShipState
  red1: ShipState
  red2: ShipState
}

function fleetFight(options: { rulesVersion?: number; coordinatedFire?: boolean; scan?: number } = {}): Fixture {
  const game = startScenario('s3.1-the-duel', {
    seed: 7,
    rulesVersion: options.rulesVersion ?? 2,
    coordinatedFire: options.coordinatedFire ?? false,
    derelicts: true,
    fleets: {
      'Blue Force': [DREADNOUGHT],
      'Red Force': [CRUISER, CRUISER],
    },
  })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const [red1, red2] = game.ships.filter((s) => s.side === 'Red Force')
  // The dreadnought between two cruisers, both dead ahead-ish, knife range.
  blue.placement = { position: { x: 15, y: 20 }, heading: 0 }
  red1.placement = { position: { x: 13, y: 15 }, heading: 180 }
  red2.placement = { position: { x: 17, y: 15 }, heading: 180 }

  for (const ship of [blue, red1, red2]) {
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        ship.mounts[weapon.id][i].armed = mount.armingCircles
      })
    }
    game.orders[ship.id] = defaultCommandCard(ship)
  }
  // Blue outranks the cruisers on the firing ladder, so it fires first and
  // nothing here is a Tactical Scan tie unless a test wants one.
  blue.sensors = { targeting: 0, jamming: 0, tacticalScan: options.scan ?? 3 }
  red1.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
  red2.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
  game.phase = 'combat-1'
  game.segment = 'combat'
  return { game, blue, red1, red2 }
}

/** Armed, unfired mounts that bear on the target from here. */
function bearingMounts(attacker: ShipState, target: ShipState) {
  const arcs = arcTo(
    attacker.placement.position,
    attacker.placement.heading,
    target.placement.position,
  )
  return attacker.form.weapons.flatMap((weapon) =>
    weapon.mounts.flatMap((mount, mountIndex) => {
      const state = attacker.mounts[weapon.id][mountIndex]
      if (state.armed === 0 || state.firedSegment) return []
      if (!canBearOn(mount.arcs, arcs)) return []
      return [{ weaponId: weapon.id, mountIndex }]
    }),
  )
}

function fire(game: GameState, attacker: ShipState, target: ShipState, mounts = bearingMounts(attacker, target)) {
  return applyAction(game, {
    type: 'fire-volley',
    attackerId: attacker.id,
    targetId: target.id,
    mounts,
    mode: 'standard',
    degraded: false,
  })
}

describe('split fire across targets (rules reading 2)', () => {
  it('a ship fires at one target, then its remaining weapons at another, in one phase', () => {
    const { game, blue, red1, red2 } = fleetFight()
    const first = bearingMounts(blue, red1)
    expect(first.length).toBeGreaterThan(1)

    // Volley one: half the battery at the first cruiser.
    const opening = fire(game, blue, red1, first.slice(0, Math.ceil(first.length / 2)))
    expect(opening.message).toBeNull()
    expect(opening.volley?.ok).toBe(true)
    expect(game.openFireShip).toBe(blue.id)
    expect(game.firedThisSegment.has(blue.id)).toBe(true)

    // Volley two: the rest at the second cruiser — the playtest's exact ask.
    const followup = fire(game, blue, red2)
    expect(followup.message).toBeNull()
    expect(followup.volley?.ok).toBe(true)
  })

  it('each mount speaks once a phase — a fired mount refuses to ride in a second volley', () => {
    const { game, blue, red1, red2 } = fleetFight()
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    const again = fire(game, blue, red2, [first[0]])
    expect(again.message).toMatch(/already fired this phase/i)
  })

  it("the opportunity is contiguous: anyone else's action closes it", () => {
    const { game, blue, red1, red2 } = fleetFight()
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    expect(game.openFireShip).toBe(blue.id)

    // The first cruiser answers — blue's window closes with it.
    expect(fire(game, red1, blue).message).toBeNull()
    expect(game.openFireShip).not.toBe(blue.id)
    expect(fire(game, blue, red2).message).toMatch(/already fired or passed/i)
  })

  it('the captain may close the window: pass reads as done firing', () => {
    const { game, blue, red1, red2 } = fleetFight()
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    applyAction(game, { type: 'pass-fire', shipId: blue.id })
    expect(game.openFireShip).toBeNull()
    expect(fire(game, blue, red2).message).toMatch(/already fired or passed/i)
  })

  it('rules reading 1 keeps the old refusal, so old journals replay unchanged', () => {
    const { game, blue, red1, red2 } = fleetFight({ rulesVersion: 1 })
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    expect(game.openFireShip).toBeNull()
    expect(fire(game, blue, red2).message).toMatch(/already fired or passed/i)
  })

  it('H4 keeps one attack per ship — the step machine owns the sequence (H4.1.1)', () => {
    const { game, blue, red1, red2 } = fleetFight({ coordinatedFire: true })
    const first = bearingMounts(blue, red1)
    const opening = fire(game, blue, red1, [first[0]])
    expect(opening.volley?.ok).toBe(true)
    expect(game.openFireShip).toBeNull()
    expect(fire(game, blue, red2).message).toMatch(/already fired or passed/i)
  })

  it('a split opportunity inside a Tactical Scan tie holds every volley for the reveal (H2.4.2)', () => {
    const { game, blue, red1, red2 } = fleetFight({ scan: 2 }) // everyone tied
    const before1 = structureRemaining(red1)
    const first = bearingMounts(blue, red1)

    fire(game, blue, red1, first.slice(0, 1))
    const second = fire(game, blue, red2)
    expect(second.message).toBeNull()
    // Both of blue's volleys are held — nothing lands while tie-mates still owe theirs.
    expect(game.pendingVolleys.length).toBe(2)
    expect(structureRemaining(red1)).toBe(before1)

    // The cruisers answer and pass; the whole reveal lands together.
    fire(game, red1, blue)
    const closing = applyAction(game, { type: 'pass-fire', shipId: red2.id })
    expect(game.pendingVolleys).toHaveLength(0)
    expect(closing.flushed?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('derelict lockout (E11.2.4, rules reading 2)', () => {
  function adrift(rulesVersion = 2): Fixture {
    const fixture = fleetFight({ rulesVersion })
    const { red1 } = fixture
    red1.derelict = true
    red1.speed = 0
    return fixture
  }

  it('a derelict answers no helm orders, repairs nothing, arms nothing', () => {
    const { game, red1 } = adrift()
    expect(
      applyAction(game, { type: 'plot-maneuver', shipId: red1.id, maneuver: 'hard', direction: 'left' })
        .message,
    ).toMatch(/derelict/i)
    expect(
      applyAction(game, { type: 'damage-control', shipId: red1.id, assignments: [] }).message,
    ).toMatch(/derelict/i)
    const weapon = red1.form.weapons[0]
    expect(
      applyAction(game, { type: 'arm-mount', shipId: red1.id, weaponId: weapon.id, mountIndex: 0 })
        .message,
    ).toMatch(/derelict/i)
  })

  it('reading 1 stays permissive, so old journals replay unchanged', () => {
    const { game, red1 } = adrift(1)
    expect(
      applyAction(game, { type: 'plot-maneuver', shipId: red1.id, maneuver: 'hard', direction: 'left' })
        .message,
    ).toBeNull()
  })

  it('a derelict may still be fired upon — it is a target, not a ghost', () => {
    const { game, blue, red1 } = adrift()
    expect(fire(game, blue, red1).message).toBeNull()
  })
})
