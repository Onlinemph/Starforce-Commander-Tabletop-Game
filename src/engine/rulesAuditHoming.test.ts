import { beforeEach, describe, expect, it } from 'vitest'
import { findShipForm, VALLARI_CRUISER } from '../data/ships'
import { isPointDefense } from './combat'
import { Rng } from './dice'
import {
  advanceSegment,
  createGame,
  fireAtSmallTarget,
  impactingHoming,
  launchHoming,
  resolveHomingImpacts,
  type GameState,
  type Terrain,
} from './game'
import {
  defendingArcs,
  launchHomingWeapon,
  resetHomingIds,
  resolveHomingVolley,
  type HomingWeapon,
} from './homing'
import { canBearOn } from './geometry'
import { smallTargetDamage } from './smallCraft'
import { THE_DUEL } from '../data/scenarios'
import { createShip, type ShipState } from './shipState'
import type { WeaponSystemDef } from './types'

/**
 * Rules-audit fixes: homing weapons, small targets and probes (E5, E10, E12,
 * J7). See scratchpad/audit/E-homing.md and fix-homing.md.
 *
 * Every corrected behaviour below is reading 3+ only (`rulesVersion: 3`) — a
 * saved battle fought under an earlier reading replays with its old outcome,
 * so each `describe` also checks that the pre-3 behaviour survives untouched.
 */

const PASSER = findShipForm('PASSER I-class Frigate')!
const PLASMA = PASSER.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!

function ship(args: {
  id: string
  side?: string
  form?: typeof PASSER
  x?: number
  y?: number
  heading?: number
  speed?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? PASSER,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: args.speed ?? 0,
  })
}

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

beforeEach(() => resetHomingIds())

// ---------------------------------------------------------------------------
// E5.1.7 / E5.4 Step 3 / E5.4.1(4c) — mixed-source volleys
// ---------------------------------------------------------------------------

describe('E5.1.7 / E5.4.1(4c) — a mixed volley resolves each weapon on its own rules', () => {
  function mixedImpact(rulesVersion: number) {
    const missileDef: WeaponSystemDef = { ...PLASMA, id: 'test-msl', name: 'TEST MISSILE', traits: ['HOMING 3', 'MISL 4'] }
    // One launcher carrying both a missile and the stock particle torpedo, so
    // `homingWeaponDef` resolves either weaponId off the same form.
    const launcher = ship({ id: 'aur', form: { ...PASSER, weapons: [...PASSER.weapons, missileDef] } })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -5 })

    // Missile first in the array — the old code took `group[0]`'s weapon
    // definition for the whole shield, so a particle weapon behind a missile
    // was resolved with `isMissile(def) === true` and could hit MISL X's
    // threshold and be destroyed outright, which F1.16.1 forbids.
    const missile = launchHomingWeapon({ launcher, weapon: missileDef, target, arc: 'FS' })
    const particle = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    missile.impacted = true
    particle.impacted = true
    missile.forcedShield = 'F'
    particle.forcedShield = 'F'
    missile.position = { ...target.placement.position }
    particle.position = { ...target.placement.position }

    const game = createGame({ scenario: THE_DUEL, ships: [launcher, target], seed: 1, rulesVersion })
    game.homing.push(missile, particle)
    // Far more than either weapon needs, so a defender spending it all on one
    // sub-group still leaves plenty for the other under the old bug.
    resolveHomingImpacts(game, target, { F: 100 })
    return { missile, particle }
  }

  it('never destroys a particle weapon outright just because a missile shares its shield', () => {
    const { missile, particle } = mixedImpact(3)
    expect(missile.destroyed).toBe(true)
    // F1.16.1: a particle weapon is only ever worn down, never destroyed.
    expect(particle.destroyed).toBe(false)
  })

  it('reading 1/2: replays the old group[0]-definition behaviour, particle weapon included', () => {
    // Under the old code every weapon in the shield's group is resolved with
    // `isMissile(group[0]'s def)`, so a particle weapon caught behind a
    // missile absorbs the same threshold-kill logic and is destroyed too.
    const { missile, particle } = mixedImpact(2)
    expect(missile.destroyed).toBe(true)
    expect(particle.destroyed).toBe(true)
  })

  it('logs a separate strike for each weapon type in the mixed volley', () => {
    const missileDef: WeaponSystemDef = { ...PLASMA, id: 'test-msl-2', name: 'TEST MISSILE TWO', traits: ['HOMING 3', 'MISL 40'] }
    const launcher = ship({ id: 'aur', form: { ...PASSER, weapons: [...PASSER.weapons, missileDef] } })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -5 })
    const missile = launchHomingWeapon({ launcher, weapon: missileDef, target, arc: 'FS' })
    const particle = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    for (const hw of [missile, particle]) {
      hw.impacted = true
      hw.forcedShield = 'F'
      hw.position = { ...target.placement.position }
    }

    const game = createGame({ scenario: THE_DUEL, ships: [launcher, target], seed: 2, rulesVersion: 3 })
    game.homing.push(missile, particle)
    resolveHomingImpacts(game, target)

    const strikes = game.log.filter((e) => /strikes .* shield for|worn down to nothing/.test(e.message))
    expect(strikes.some((e) => e.message.includes(missileDef.name))).toBe(true)
    expect(strikes.some((e) => e.message.includes(PLASMA.name))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E5.3.5(5) / E10.3 / E10.4 — nebula/gas cloud degrade the impact
// ---------------------------------------------------------------------------

describe('E5.3.5(5) / E10.3 / E10.4 — a nebula degrades the homing impact', () => {
  /*
   * Placed straight at the target and impacted by hand, bypassing
   * `moveHomingWeapon` — a nebula also rolls E5.3.5(2) overspeed damage on
   * the flight leg (a second, separate fix in this same changeset), which
   * would otherwise draw from the same seeded RNG and desync the "same
   * dice" comparison below from the clear-space run.
   */
  function strikeDamage(nebula: boolean, rulesVersion: number): number {
    const launcher = ship({ id: 'ghost', y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: { ...THE_DUEL, nebula }, ships: [launcher, foe], seed: 4, rulesVersion })
    const torp = launcher.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    const hw = launchHomingWeapon({ launcher, weapon: torp, target: foe, arc: 'FS' })
    hw.phasesFlown = 1
    hw.impacted = true
    hw.forcedShield = 'F'
    hw.position = { ...foe.placement.position }
    game.homing.push(hw)
    resolveHomingImpacts(game, foe)
    const line = game.log.find((e) => /strikes .* shield for \d+ damage/.test(e.message))
    return line ? Number(line.message.match(/for (\d+) damage/)![1]) : 0
  }

  it('halves standard damage, round down, with the same dice as clear space', () => {
    const clear = strikeDamage(false, 3)
    const nebula = strikeDamage(true, 3)
    expect(clear).toBeGreaterThan(0)
    expect(nebula).toBe(Math.floor(clear / 2))
  })

  it('reading 1/2: an old journal takes the un-halved impact inside a nebula', () => {
    const clear = strikeDamage(false, 2)
    const nebula = strikeDamage(true, 2)
    expect(nebula).toBe(clear)
  })
})

// ---------------------------------------------------------------------------
// E5.4.1(4b) — a Heavy Hit is worth 5 against a homing weapon
// ---------------------------------------------------------------------------

describe('E5.4.1(4b) — a Heavy Hit counts its leak point against a homing weapon', () => {
  it('adds one point per H to the raw total, only for a homing target', () => {
    const ship = smallTargetDamage(['H', 'H'], 0, true, false, false)
    const homing = smallTargetDamage(['H', 'H'], 0, true, false, true)
    expect(ship.raw).toBe(8) // 4 + 4
    expect(homing.raw).toBe(10) // (4+1) + (4+1)
  })

  function fireHeldTorpedo(rulesVersion: number) {
    const attacker = ship({ id: 'att', x: 0, y: 0 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, x: 20, y: 20 })
    const game = createGame({ scenario: THE_DUEL, ships: [attacker, foe], seed: 1, rulesVersion })
    const torp = attacker.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    attacker.mounts[torp.id][0].armed = torp.mounts[0].armingCircles

    const hw = launchHomingWeapon({ launcher: foe, weapon: torp, target: attacker, arc: 'FS' })
    hw.phasesFlown = 1 // E12.3.2 — a counter is only a target once it has flown
    hw.position = { ...attacker.placement.position }
    game.homing.push(hw)
    // Held in the attacker's own tractor beam: every die shows its own
    // maximum, yellow -> H (J3.2.5), with no roll to seed.
    game.ops.links.push({ id: 'lock', sourceId: attacker.id, targetId: hw.id, targetKind: 'small', beams: 1, power: 'nrm' })

    return fireAtSmallTarget(game, attacker, hw.id, torp.id, 0)
  }

  it('carries the extra point through real fire at a homing weapon (J3.2.5 held target)', () => {
    const result = fireHeldTorpedo(3)
    expect(result.refusal).toBeNull()
    // PLASMA's chart is two yellow dice -> H, H. Against a homing weapon
    // that is (4+1) apiece, 10 raw, halved by degraded fire control to 5 —
    // not the 4 a Heavy Hit would ordinarily be worth.
    expect(result.volley!.raw).toBe(10)
    expect(result.volley!.damage).toBe(5)
  })

  it('reading 1/2: an old journal still counts H as the ordinary 4', () => {
    const result = fireHeldTorpedo(2)
    expect(result.refusal).toBeNull()
    expect(result.volley!.raw).toBe(8)
    expect(result.volley!.damage).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// E12.2.4 / E12.2.5 / E12.2.6 / E12.4.4 — only PD weapons answer an impact
// ---------------------------------------------------------------------------

describe('E12.2.4 / E12.2.5 / E12.2.6 — defensive fire needs the PD trait', () => {
  function fireStandardAtImpact(rulesVersion: number) {
    const attacker = ship({ id: 'ghost', y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: THE_DUEL, ships: [attacker, foe], seed: 8, rulesVersion })
    const torp = attacker.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    attacker.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    launchHoming(game, attacker, torp, 0, foe)
    attacker.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)

    const counter = impactingHoming(game, foe)[0]
    expect(counter.impacted).toBe(true)

    const answering = defendingArcs(counter, foe)
    const standard = foe.form.weapons.flatMap((weapon) =>
      !isPointDefense(weapon)
        ? weapon.mounts.flatMap((mount, index) => (canBearOn(mount.arcs, answering) ? [{ weapon, index }] : []))
        : [],
    )
    expect(standard.length, 'need a standard weapon bearing on the impact to test with').toBeGreaterThan(0)
    const { weapon, index } = standard[0]
    foe.mounts[weapon.id][index].armed = weapon.mounts[index].armingCircles

    return fireAtSmallTarget(game, foe, counter.id, weapon.id, index)
  }

  it('refuses a standard weapon at a homing weapon that has already struck', () => {
    expect(fireStandardAtImpact(3).refusal).toMatch(/Point Defense trait/)
  })

  it('reading 1/2: an old journal\'s standard-weapon shot at an impact still lands', () => {
    expect(fireStandardAtImpact(2).refusal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// E5.3.5(2) — terrain overspeed damage to homing weapons
// ---------------------------------------------------------------------------

describe('E5.3.5(2) — terrain punishes a homing weapon\'s speed too', () => {
  function flyThroughField(rulesVersion: number): GameState {
    const attacker = ship({ id: 'ghost', y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const field: Terrain = {
      id: 'field-1',
      kind: 'asteroid-field',
      name: 'Test Field',
      center: { x: 0, y: 1.5 },
      radius: 1,
      safeSpeed: 0,
      damageDie: 'green',
    }
    const game = createGame({ scenario: { ...THE_DUEL, terrain: [field] }, ships: [attacker, foe], seed: 4, rulesVersion })
    const torp = attacker.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    attacker.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    launchHoming(game, attacker, torp, 0, foe)
    attacker.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    return game
  }

  it('rolls asteroid overspeed damage for a leg that crosses the field', () => {
    const game = flyThroughField(3)
    expect(game.log.some((e) => /transiting Test Field \(E5.3.5\(2\), K2.1.6\)/.test(e.message))).toBe(true)
  })

  it('reading 1/2: an old journal\'s counter flies the same field unscathed', () => {
    const game = flyThroughField(2)
    expect(game.log.some((e) => /transiting Test Field/.test(e.message))).toBe(false)
  })

  it('rolls nebula overspeed damage for a leg flown above the nebula safe speed', () => {
    const attacker = ship({ id: 'ghost', y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: { ...THE_DUEL, nebula: true }, ships: [attacker, foe], seed: 2, rulesVersion: 3 })
    const torp = attacker.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    attacker.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    launchHoming(game, attacker, torp, 0, foe)
    attacker.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)

    // PLASMA's first-phase leg (3") flies well past the nebula's safe speed
    // of 2 (K4.2.2), so it owes one blue die of overspeed damage — this seed
    // rolls a face that isn't a miss.
    expect(game.log.some((e) => /through the nebula \(E5.3.5\(2\), K4.2.2\)/.test(e.message))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E5.3.5(4) — asteroid cover rerolls a homing volley
// ---------------------------------------------------------------------------

describe('E5.3.5(4) — asteroid cover rerolls the impact\'s dice', () => {
  function flight(count: number, def: WeaponSystemDef): HomingWeapon[] {
    const launcher = ship({ id: 'aur', form: PASSER })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -5 })
    return Array.from({ length: count }, () => launchHomingWeapon({ launcher, weapon: def, target, arc: 'FS' }))
  }

  it('spends rerolls on the volley the same way direct fire\'s cover does', () => {
    const missileDef: WeaponSystemDef = { ...PLASMA, id: 'test-msl-3', name: 'TEST MISSILE THREE', traits: ['HOMING 3', 'MISL 4'] }
    const volley = resolveHomingVolley(flight(3, missileDef), missileDef, 'F', 1, 2, new Rng(3), 2)
    const rerolled = volley.rolls.filter((r) => r.rerolls > 0)
    expect(rerolled.length).toBeGreaterThan(0)
    expect(rerolled.length).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// J7.3.2 — a probe moves in the Combat Segment, not Navigation
// ---------------------------------------------------------------------------

describe('J7.3.2 — a probe moves at the head of Combat, reading 3+', () => {
  it('still closes to standoff range and starts transmitting under the corrected timing', () => {
    const mother = ship({ id: 'mother', y: 0 })
    const subject = ship({ id: 'subject', side: 'Red', y: 18 })
    const game = createGame({ scenario: THE_DUEL, ships: [mother, subject], seed: 1, rulesVersion: 3 })
    game.smallCraft.push({
      id: 'probe-1',
      kind: 'probe',
      side: mother.side,
      motherId: mother.id,
      position: { x: 0, y: 0 },
      damage: 0,
      activated: true,
      targetId: subject.id,
      transmitting: false,
    })
    mother.speed = 0
    subject.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    const probe = game.smallCraft.find((c) => c.id === 'probe-1')!
    expect(probe.transmitting).toBe(true)
  })
})
