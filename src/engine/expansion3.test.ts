import { beforeEach, describe, expect, it } from 'vitest'
import { NEBULA_PATROL, startScenario, THE_DUEL } from '../data/scenarios'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { resolveVolley } from './combat'
import {
  applyVolley,
  autoChoices,
  newDeck,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageContext,
} from './damage'
import { Rng } from './dice'
import {
  advanceSegment,
  cloudConditions,
  cloudModifiers,
  cloudStatus,
  createGame,
  gasClouds,
  terrainObstacles,
  workingSystemBoxes,
  type GameState,
  type Scenario,
} from './game'
import { disengagementOptions } from './navigation'
import {
  cloudAt,
  degradedByClouds,
  ftlBlocked,
  GAS_CLOUD_SAFE_SPEED,
  insideCloud,
  losCrossesCloud,
  lowSpeedPenaltyNegated,
  NEBULA_SAFE_SPEED,
  overspeedDice,
  safeSpeed,
  shieldsInoperative,
  STANDARD_NEBULA_EFFECTS,
  systemIsHampered,
  turbulenceTurn,
  underCloudEffects,
  type CloudConditions,
} from './nebula'
import {
  blueShieldRemaining,
  createShip,
  findLine,
  SHIELD_SIDES,
  type ShipState,
} from './shipState'

/**
 * Expansion 3: Nebulae (K4) and Gas Clouds (K5).
 *
 * The rest of Expansion 3 — Sections B and E — is a Version 2.6 reprint of
 * chapters the base rulebook already carries, and is covered by the existing
 * engineering and combat suites.
 */

function ship(args: { id: string; side?: string; x?: number; y?: number; speed?: number }): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: (args.side ?? 'Blue') === 'Blue' ? YORKTOWN : VALLARI_CRUISER,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: 0 },
    speed: args.speed ?? 2,
  })
}

const CLOUD = { id: 'c1', name: 'Gas cloud 1', center: { x: 10, y: 10 }, radius: 4 }

function conditions(overrides: Partial<CloudConditions> = {}): CloudConditions {
  return { nebula: false, clouds: [], effects: STANDARD_NEBULA_EFFECTS, ...overrides }
}

function ctx(seed = 13): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

beforeEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

// ---------------------------------------------------------------------------
// Extent
// ---------------------------------------------------------------------------

describe('cloud extent (K4.1, K5.1)', () => {
  it('covers the whole play area for a nebula (K4.1.1)', () => {
    const c = conditions({ nebula: true })
    expect(underCloudEffects(c, ship({ id: 'a', x: 0, y: 0 }))).toBe(true)
    expect(underCloudEffects(c, ship({ id: 'b', x: 35, y: 35 }))).toBe(true)
  })

  it('counts a ship as inside once its base overlaps the counter (K5.1.2)', () => {
    // The counter is 1.5 inches, so half of it reaches past the printed radius.
    expect(insideCloud(CLOUD, { x: 14, y: 10 })).toBe(true)
    expect(insideCloud(CLOUD, { x: 14.75, y: 10 })).toBe(true)
    expect(insideCloud(CLOUD, { x: 15, y: 10 })).toBe(false)
  })

  it('finds the cloud a ship is sitting in', () => {
    const c = conditions({ clouds: [CLOUD] })
    expect(cloudAt(c.clouds, { x: 10, y: 10 })?.id).toBe('c1')
    expect(cloudAt(c.clouds, { x: 30, y: 30 })).toBeNull()
  })

  it('detects a line of sight crossing a cloud (K5.2.5)', () => {
    expect(losCrossesCloud([CLOUD], { x: 0, y: 10 }, { x: 20, y: 10 })).toBe(true)
    expect(losCrossesCloud([CLOUD], { x: 0, y: 30 }, { x: 20, y: 30 })).toBe(false)
  })

  it('does not block line of sight the way a planet does (K3.1.3, K5.2.5)', () => {
    const obstacles = terrainObstacles(NEBULA_PATROL.terrain)
    expect(obstacles).toHaveLength(2)
    for (const o of obstacles) expect(o.blocksLos).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// K4.2.2 / K5.2.1 speed
// ---------------------------------------------------------------------------

describe('safe speed (K4.2.2, K5.2.1)', () => {
  it('is 2 in a nebula and 1 in a gas cloud', () => {
    const c = conditions({ nebula: true, clouds: [CLOUD] })
    expect(safeSpeed(c, { x: 30, y: 30 })).toBe(NEBULA_SAFE_SPEED)
    expect(safeSpeed(c, { x: 10, y: 10 })).toBe(GAS_CLOUD_SAFE_SPEED)
    // Clear space has no limit at all.
    expect(safeSpeed(conditions(), { x: 0, y: 0 })).toBe(Infinity)
  })

  it('rolls one blue die per point of speed over the limit', () => {
    const c = conditions({ nebula: true, clouds: [CLOUD] })
    expect(overspeedDice(c, ship({ id: 'a', x: 30, y: 30, speed: 2 }))).toBe(0)
    expect(overspeedDice(c, ship({ id: 'b', x: 30, y: 30, speed: 5 }))).toBe(3)
    // Inside the denser cloud the same speed costs one more die.
    expect(overspeedDice(c, ship({ id: 'c', x: 10, y: 10, speed: 5 }))).toBe(4)
    // Reverse is just as rough.
    expect(overspeedDice(c, ship({ id: 'd', x: 30, y: 30, speed: -4 }))).toBe(2)
  })

  it('damages a ship running too fast during the Navigation Segment (K4.2.2)', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 4 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    const before = damageFootprint(blue)

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    game.orders['blue-1'].accel = 4
    game.orders['blue-1'].speed = 6
    advanceSegment(game) // command
    advanceSegment(game) // operations
    advanceSegment(game) // navigation resolves movement and cloud damage

    expect(damageFootprint(blue)).toBeGreaterThan(before)
    expect(game.log.some((e) => /inside the nebula \(K4\.2\.2\)/.test(e.message))).toBe(true)
  })

  it('leaves a ship at the safe speed alone', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 4 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'combat')
    expect(blue.speed).toBe(2)
    expect(damageFootprint(blue)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// K4.2 common effects
// ---------------------------------------------------------------------------

describe('common nebula effects (K4.2)', () => {
  it('ignores blue and green shield boxes (K4.2.1)', () => {
    const target = ship({ id: 't' })
    const before = blueShieldRemaining(target, 'F')
    expect(before).toBeGreaterThan(0)

    const outcome = applyVolley(
      target,
      { standard: 4, leak: 0, structurePenetration: 0, side: 'F', shieldsInoperative: true },
      ctx(),
    )
    expect(blueShieldRemaining(target, 'F')).toBe(before)
    // The shield absorbed nothing; armor took what it could and the rest went
    // straight inside.
    expect(outcome.blueAbsorbed + outcome.greenAbsorbed).toBe(0)
    expect(outcome.armorAbsorbed + outcome.internal).toBe(4)
    expect(outcome.internal).toBeGreaterThan(0)
  })

  it('still lets shields work outside a cloud', () => {
    const target = ship({ id: 't' })
    const before = blueShieldRemaining(target, 'F')
    applyVolley(target, { standard: 4, leak: 0, structurePenetration: 0, side: 'F' }, ctx())
    expect(blueShieldRemaining(target, 'F')).toBe(before - 4)
  })

  it('reports shields inoperative only for ships inside (K4.2.1)', () => {
    const c = conditions({ clouds: [CLOUD] })
    expect(shieldsInoperative(c, ship({ id: 'in', x: 10, y: 10 }))).toBe(true)
    expect(shieldsInoperative(c, ship({ id: 'out', x: 30, y: 30 }))).toBe(false)
  })

  it('negates the low-speed penalty (K4.2.3)', () => {
    const c = conditions({ nebula: true })
    expect(lowSpeedPenaltyNegated(c, ship({ id: 't', speed: 0 }))).toBe(true)
    expect(lowSpeedPenaltyNegated(conditions(), ship({ id: 't', speed: 0 }))).toBe(false)
  })

  it('switches SCNC, TRAN and TRAC off below GEN SYS MAX (K4.2.4)', () => {
    const c = conditions({ nebula: true })
    const target = ship({ id: 't' })

    for (const kind of ['SCNC', 'TRAN', 'TRAC'] as const) {
      expect(systemIsHampered(c, target, kind), kind).toBe(true)
    }
    // Sensors and the rest are untouched.
    expect(systemIsHampered(c, target, 'SENS')).toBe(false)

    target.genSysLevel = 'max'
    expect(systemIsHampered(c, target, 'SCNC')).toBe(false)
  })

  it('zeroes hampered system boxes at the game level (K4.2.4)', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 2 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    expect(workingSystemBoxes(game, blue, 'SCNC')).toBe(0)
    expect(workingSystemBoxes(game, blue, 'SENS')).toBeGreaterThan(0)

    blue.genSysLevel = 'max'
    expect(workingSystemBoxes(game, blue, 'SCNC')).toBeGreaterThan(0)
  })

  it('degrades all weapon fire in a nebula (K4.2.6)', () => {
    const c = conditions({ nebula: true })
    expect(degradedByClouds(c, ship({ id: 'a' }), ship({ id: 'b', side: 'Red', x: 5 }))).toBe(true)
  })

  it('degrades fire in all four gas cloud cases (K5.2.5)', () => {
    const c = conditions({ clouds: [CLOUD] })
    const inside = ship({ id: 'in', x: 10, y: 10 })
    const insideToo = ship({ id: 'in2', side: 'Red', x: 11, y: 11 })
    const outside = ship({ id: 'out', side: 'Red', x: 30, y: 10 })
    const farAway = ship({ id: 'far', x: 30, y: 30 })
    const opposite = ship({ id: 'opp', side: 'Red', x: -10, y: 10 })

    expect(degradedByClouds(c, inside, insideToo)).toBe(true) // both in
    expect(degradedByClouds(c, inside, outside)).toBe(true) // firing out
    expect(degradedByClouds(c, outside, inside)).toBe(true) // firing in
    expect(degradedByClouds(c, outside, opposite)).toBe(true) // line of sight crosses
    expect(degradedByClouds(c, farAway, ship({ id: 'x', side: 'Red', x: 33, y: 33 }))).toBe(false)
  })

  it('blocks FTL, including to disengage (K4.2.7)', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 9 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    // Fully power the FTL drive, which would otherwise offer FTL disengagement.
    const ftl = findLine(blue.form, 'ftl-drive')!
    blue.allocation[ftl.id] = ftl.steps.length

    expect(ftlBlocked(cloudConditions(game.scenario), blue)).toBe(true)
    const withNebula = disengagementOptions(blue, [], game.scenario.bounds, false)
    const without = disengagementOptions(blue, [], game.scenario.bounds, true)
    expect(without.some((o) => o.startsWith('FTL'))).toBe(true)
    expect(withNebula.some((o) => o.startsWith('FTL'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// K4.2.5 turbulence (optional)
// ---------------------------------------------------------------------------

describe('turbulence (K4.2.5, optional)', () => {
  it('turns 30 degrees on exactly one MISS, and not at all on two or none', () => {
    // Red misses on 1 face of 6 and green on 1 of 6, so over many rolls all
    // three outcomes appear and every turn is exactly 30 degrees.
    const rng = new Rng(17)
    const seen = new Set<number>()
    for (let i = 0; i < 400; i++) seen.add(turbulenceTurn(rng))
    expect([...seen].sort((a, b) => a - b)).toEqual([-30, 0, 30])
  })

  it('is off unless the scenario asks for it (K4.2.5)', () => {
    expect(STANDARD_NEBULA_EFFECTS.turbulence).toBe(false)
    expect(cloudConditions(NEBULA_PATROL).effects.turbulence).toBe(false)
  })

  it('pushes ships off course in Phase 3 only', () => {
    const scenario: Scenario = {
      ...NEBULA_PATROL,
      id: 'turbulent',
      nebulaEffects: { turbulence: true },
    }
    const blue = ship({ id: 'blue-1', x: 30, y: 8 })
    const red = ship({ id: 'red-1', side: 'Red', x: 5, y: 28 })
    const game = createGame({ scenario, ships: [blue, red], seed: 3 })

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    expect(game.log.some((e) => /turbulence/.test(e.message))).toBe(false)

    runTo(game, (g) => g.phase === 'combat-3' && g.segment === 'navigation')
    advanceSegment(game)
    const pushed = game.log.filter((e) => /turbulence \(K4\.2\.5\)/.test(e.message))
    // With two ships and a 1-in-3 chance each, at least one is very likely; the
    // headings that did change must have moved exactly 30 degrees.
    for (const entry of pushed) expect(entry.message).toMatch(/pushed 30° (left|right)/)
    for (const s of [blue, red]) expect(s.placement.heading % 30).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Volley integration
// ---------------------------------------------------------------------------

describe('firing inside a nebula', () => {
  it('applies degraded fire control, no low-speed penalty and no shields', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 6 })
    const attacker = game.ships.find((s) => s.id === 'blue-1')!
    const target = game.ships.find((s) => s.id === 'red-1')!
    const mods = cloudModifiers(game, attacker, target)
    expect(mods).toEqual({
      degradedFireControl: true,
      lowSpeedNegated: true,
      targetShieldsInoperative: true,
    })
  })

  it('halves damage and skips the target’s shields (E10.2.3, K4.2.1)', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 6 })
    const attacker = game.ships.find((s) => s.id === 'blue-1')!
    const target = game.ships.find((s) => s.id === 'red-1')!
    // Put them nose to nose so the phasers reach.
    attacker.placement = { position: { x: 10, y: 10 }, heading: 180 }
    target.placement = { position: { x: 10, y: 14 }, heading: 0 }

    const phaser = attacker.form.weapons.find((w) => w.weaponClass === 'phaser')!
    attacker.mounts[phaser.id][0].armed = phaser.mounts[0].armingCircles
    const shieldBefore = blueShieldRemaining(target, 'F')

    const result = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: phaser.id, mountIndex: 0 }],
        mode: 'standard',
        ...cloudModifiers(game, attacker, target),
      },
      ctx(),
      new Rng(2),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Degraded fire control halves standard damage and discards leak (E10.2).
      expect(result.damage.standard).toBe(Math.floor(result.rawStandard / 2))
      expect(result.damage.leak).toBe(0)
      // The shield absorbed nothing (K4.2.1).
      expect(result.outcome?.blueAbsorbed).toBe(0)
      expect(blueShieldRemaining(target, 'F')).toBe(shieldBefore)
    }
  })
})

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

describe('Nebula Patrol scenario', () => {
  it('is a nebula holding two gas clouds (K4.1.2)', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 1 })
    expect(game.scenario.nebula).toBe(true)
    expect(gasClouds(game.scenario).map((c) => c.id)).toEqual(['cloud-1', 'cloud-2'])
    expect(gasClouds(game.scenario)[0].scan).toBe(3)
  })

  it('reports each ship’s cloud status', () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 1 })
    const blue = game.ships.find((s) => s.id === 'blue-1')!
    const status = cloudStatus(game, blue)
    expect(status.inside).toBe(true)
    expect(status.cloud).toBeNull() // in the nebula, not in a cloud
    expect(status.safeSpeed).toBe(2)
    expect(status.overspeedDice).toBe(0)
    expect(status.shieldsInoperative).toBe(true)
    expect(status.hamperedSystems.sort()).toEqual(['SCNC', 'TRAC', 'TRAN'])
    expect(status.ftlBlocked).toBe(true)

    // Drop it into a cloud and the limit tightens.
    blue.placement.position = { x: 13, y: 14 }
    const inCloud = cloudStatus(game, blue)
    expect(inCloud.cloud?.id).toBe('cloud-1')
    expect(inCloud.safeSpeed).toBe(1)
    expect(inCloud.overspeedDice).toBe(1)
  })

  it('leaves clear-space scenarios untouched', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const blue = game.ships[0]
    const status = cloudStatus(game, blue)
    expect(status.inside).toBe(false)
    expect(status.safeSpeed).toBe(Infinity)
    expect(status.shieldsInoperative).toBe(false)
    expect(status.hamperedSystems).toEqual([])
    expect(cloudModifiers(game, game.ships[0], game.ships[1])).toEqual({
      degradedFireControl: false,
      lowSpeedNegated: false,
      targetShieldsInoperative: false,
    })
    expect(cloudConditions(THE_DUEL).nebula).toBe(false)
  })
})

/**
 * Every mark a ship carries. Cloud damage goes to armor and then internal,
 * where damage cards scatter it across systems, weapons and reactors — so a
 * single total is the only stable way to say "it was hurt".
 */
function damageFootprint(ship: ShipState): number {
  const sides = ship.armorDamage.F + ship.armorDamage.S + ship.armorDamage.A + ship.armorDamage.P
  const systems = Object.values(ship.systemDamage).reduce((a, b) => a + b, 0)
  const reactors = Object.values(ship.reactorDamage).flat().reduce((a, b) => a + b, 0)
  const mounts = Object.values(ship.mounts)
    .flat()
    .reduce((a, m) => a + m.damage, 0)
  const shields =
    ship.shieldGeneratorDamage +
    SHIELD_SIDES.reduce((a, side) => a + ship.blueShieldDamage[side], 0)
  return (
    sides + systems + reactors + mounts + shields + ship.structureDamaged.filter(Boolean).length
  )
}

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}
