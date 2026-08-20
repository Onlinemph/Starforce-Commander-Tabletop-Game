import { beforeEach, describe, expect, it } from 'vitest'
import { THE_DUEL } from '../data/scenarios'
import { findShipForm, VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { resolveVolley } from './combat'
import {
  autoChoices,
  explosionCheck,
  newDeck,
  resolveCard,
  resolveExplosionDamage,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageContext,
} from './damage'
import { Rng } from './dice'
import {
  alignToLead,
  chooseLead,
  FORMATION_RANGE,
  formationOf,
  headingDelta,
  joinFormation,
  joinRequirements,
  leaveFormation,
  pruneFormations,
  type Formation,
} from './formation'
import { advanceSegment, createGame, scoutSupport, type GameState } from './game'
import {
  jammingFrom,
  mayReceiveScoutSupport,
  scanCapability,
  scoutSensorsOn,
  scoutSupportFor,
  setScoutAssignment,
  setScoutSensorActive,
  targetingFrom,
} from './scouting'
import {
  activeScoutSensors,
  createShip,
  isScout,
  scoutSensorsIntact,
  scoutSensorsPowered,
  undamagedSystemBoxes,
  type ShipState,
} from './shipState'
import type { DamageCard, ShipForm } from './types'

/**
 * Expansion 1: Formation Maneuvering (C5) and Scouting Sensors (H3).
 */

const HERMES = findShipForm('HERMES I-class Scout')!
const KNOX = findShipForm('KNOX II-class Survey Cruiser')!

function ship(args: {
  id: string
  side?: string
  form?: ShipForm
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
    speed: args.speed ?? 4,
  })
}

/** Power the SCOUT SEN line far enough to activate `count` sensors (H3.2.1). */
function powerScoutSensors(scout: ShipState, count: number): void {
  const line = scout.form.functions.find((l) => l.label.startsWith('SCOUT SEN'))!
  const step = line.steps.findIndex((s) => s.value >= count)
  scout.allocation[line.id] = step === -1 ? line.steps.length : step + 1
}

function ctx(seed = 21): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

beforeEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

// ---------------------------------------------------------------------------
// H3. Scouting sensors — canon data
// ---------------------------------------------------------------------------

describe('scout sensor data (H3.1.1)', () => {
  it('imports the scout sensor block from the Master Ship Book', () => {
    expect(HERMES.scoutSensor).toEqual({
      sensors: 3,
      damageBoxes: 3,
      targetingRange: 21,
      jammingRange: 6,
      scanRange: 21,
    })
    expect(KNOX.scoutSensor).toEqual({
      sensors: 4,
      damageBoxes: 4,
      targetingRange: 24,
      jammingRange: 9,
      scanRange: 24,
    })
  })

  it('marks only scouts as scouts', () => {
    expect(isScout(ship({ id: 's', form: HERMES }))).toBe(true)
    expect(isScout(ship({ id: 'w' }))).toBe(false)
  })

  it('powers sensors from the SCOUT SEN line rather than one per point (H3.2.1)', () => {
    const scout = ship({ id: 's', form: HERMES })
    expect(scoutSensorsPowered(scout)).toBe(0)
    // The Hermes I's line reads ○2 ○3: one power point lights two sensors.
    powerScoutSensors(scout, 2)
    expect(scoutSensorsPowered(scout)).toBe(2)
    powerScoutSensors(scout, 3)
    expect(scoutSensorsPowered(scout)).toBe(3)
  })

  it('caps powered sensors at the undamaged ones (H3.1.1)', () => {
    const scout = ship({ id: 's', form: HERMES })
    powerScoutSensors(scout, 3)
    scout.scoutSensorDamage = 2
    expect(scoutSensorsIntact(scout)).toBe(1)
    expect(scoutSensorsPowered(scout)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// H3.2 / H3.3 assignment
// ---------------------------------------------------------------------------

describe('scout sensor assignment (H3.2, H3.3)', () => {
  function pair(distance = 10) {
    const scout = ship({ id: 'scout', form: HERMES })
    const enemy = ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, x: distance })
    powerScoutSensors(scout, 3)
    return { scout, enemy, ships: [scout, enemy] }
  }

  it('illuminates an enemy within the targeting range (H3.4.2)', () => {
    const { scout, ships } = pair(10)
    expect(setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)).toBeNull()
    expect(scout.scoutAssignments[0]).toMatchObject({ function: 'targeting', targetId: 'enemy' })
  })

  it('refuses to illuminate beyond the printed range (H3.4.2)', () => {
    const { scout, ships } = pair(30)
    expect(setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)).toMatch(/targeting range is 21/)
  })

  it('refuses to illuminate a friendly ship (H3.4.1)', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    const friend = ship({ id: 'friend', x: 5 })
    powerScoutSensors(scout, 3)
    expect(setScoutAssignment(scout, 0, 'targeting', 'friend', [scout, friend])).toMatch(/enemy ships/)
  })

  it('needs no target for jamming or scanning (H3.5, H3.6)', () => {
    const { scout, ships } = pair()
    expect(setScoutAssignment(scout, 1, 'jamming', null, ships)).toBeNull()
    expect(setScoutAssignment(scout, 2, 'scan', null, ships)).toBeNull()
    expect(scout.scoutAssignments[1].targetId).toBeNull()
  })

  it('gives different sensors different functions (H3.2.2)', () => {
    const { scout, ships } = pair()
    setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)
    setScoutAssignment(scout, 1, 'jamming', null, ships)
    setScoutAssignment(scout, 2, 'jamming', null, ships)
    expect(scoutSensorsOn(scout, 'targeting')).toHaveLength(1)
    expect(scoutSensorsOn(scout, 'jamming')).toHaveLength(2)
  })

  it('counts only powered, active sensors (H3.2.1, H3.3.2)', () => {
    const { scout, ships } = pair()
    for (let i = 0; i < 3; i++) setScoutAssignment(scout, i, 'jamming', null, ships)
    expect(activeScoutSensors(scout)).toHaveLength(3)

    // Switched off during Operations step 2.E.
    setScoutSensorActive(scout, 2, false)
    expect(activeScoutSensors(scout)).toHaveLength(2)

    // Powered down to two sensors: the third stops contributing.
    powerScoutSensors(scout, 2)
    expect(activeScoutSensors(scout)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// H3.4 / H3.5 fleet support
// ---------------------------------------------------------------------------

describe('scout fleet support (H3.4, H3.5)', () => {
  function force() {
    const scout = ship({ id: 'scout', form: HERMES })
    const consort = ship({ id: 'consort', x: 4 })
    const enemy = ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, x: 12 })
    powerScoutSensors(scout, 3)
    const ships = [scout, consort, enemy]
    return { scout, consort, enemy, ships }
  }

  it('adds one targeting point per sensor illuminating the target (H3.4.1)', () => {
    const { scout, consort, enemy, ships } = force()
    setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)
    setScoutAssignment(scout, 1, 'targeting', 'enemy', ships)
    expect(targetingFrom(scout, enemy)).toBe(2)

    const support = scoutSupportFor(consort, enemy, ships)
    expect(support.targeting).toBe(2)
    expect(support.targetingFrom).toBe('SCOUT')
  })

  it('supports every ship in the fleet, not just one (H3.4.3)', () => {
    const { scout, enemy, ships } = force()
    const second = ship({ id: 'second', x: 30, y: 30 })
    ships.push(second)
    setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)
    // Distance from the scout is irrelevant to the ships *receiving* the data.
    expect(scoutSupportFor(second, enemy, ships).targeting).toBe(1)
  })

  it('jams for friendly ships inside the jamming radius only (H3.5.2)', () => {
    const { scout, consort, ships } = force()
    setScoutAssignment(scout, 0, 'jamming', null, ships)
    setScoutAssignment(scout, 1, 'jamming', null, ships)
    // The Hermes I's area jamming range is 6 inches.
    expect(jammingFrom(scout, consort)).toBe(2)
    consort.placement.position.x = 8
    expect(jammingFrom(scout, consort)).toBe(0)
  })

  it('jams for itself too (H3.5.1)', () => {
    const { scout, ships } = force()
    setScoutAssignment(scout, 0, 'jamming', null, ships)
    expect(jammingFrom(scout, scout)).toBe(1)
  })

  it('takes support from only one scout (H3.4.4, H3.5.3)', () => {
    const { scout, consort, enemy, ships } = force()
    const second = findShipForm('KNOX II-class Survey Cruiser')!
    const bigger = ship({ id: 'knox', form: second, x: 2 })
    powerScoutSensors(bigger, 4)
    ships.push(bigger)

    setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)
    for (let i = 0; i < 3; i++) setScoutAssignment(bigger, i, 'targeting', 'enemy', ships)

    // Three from the Knox and one from the Hermes never add up to four.
    expect(scoutSupportFor(consort, enemy, ships).targeting).toBe(3)
  })

  it('denies a working scout support from another scout (H3.4.4, H3.5.3)', () => {
    const { scout, enemy, ships } = force()
    const other = ship({ id: 'other', form: HERMES, x: 3 })
    powerScoutSensors(other, 3)
    ships.push(other)
    setScoutAssignment(other, 0, 'targeting', 'enemy', ships)

    // While the Hermes is using its own sensors it is deaf to the other scout.
    setScoutAssignment(scout, 0, 'jamming', null, ships)
    expect(mayReceiveScoutSupport(scout)).toBe(false)
    expect(scoutSupportFor(scout, enemy, ships).targeting).toBe(0)

    // Shut its own sensors down and the data comes through.
    for (let i = 0; i < 3; i++) setScoutSensorActive(scout, i, false)
    expect(mayReceiveScoutSupport(scout)).toBe(true)
    expect(scoutSupportFor(scout, enemy, ships).targeting).toBe(1)
  })

  it('reports scan range and bonus information points (H3.6)', () => {
    const { scout, ships } = force()
    expect(scanCapability(scout)).toBeNull()
    setScoutAssignment(scout, 0, 'scan', null, ships)
    setScoutAssignment(scout, 1, 'scan', null, ships)
    expect(scanCapability(scout)).toEqual({ range: 21, bonusPoints: 2 })
  })

  it('shortens effective range for the ship it supports (H3.4.1)', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    const consort = ship({ id: 'consort', y: 0, x: 0 })
    const enemy = ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, y: -10 })
    powerScoutSensors(scout, 3)
    const ships = [scout, consort, enemy]
    setScoutAssignment(scout, 0, 'targeting', 'enemy', ships)
    setScoutAssignment(scout, 1, 'targeting', 'enemy', ships)

    const phaser = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!
    consort.mounts[phaser.id][0].armed = phaser.mounts[0].armingCircles
    const request = {
      attacker: consort,
      target: enemy,
      mounts: [{ weaponId: phaser.id, mountIndex: 0 }],
      mode: 'standard' as const,
    }

    const unaided = resolveVolley(request, ctx(), new Rng(4))
    // Rearm for the aided shot as a fresh phase would: circles back, and the
    // once-a-phase mark (E6.2 Step 6) cleared with the segment.
    consort.mounts[phaser.id][0].armed = phaser.mounts[0].armingCircles
    consort.mounts[phaser.id][0].firedSegment = false
    const aided = resolveVolley(
      { ...request, scoutSupport: scoutSupportFor(consort, enemy, ships) },
      ctx(),
      new Rng(4),
    )

    expect(unaided.ok && unaided.effectiveRange).toBe(10)
    expect(aided.ok && aided.effectiveRange).toBe(8)
  })

  it('lengthens effective range for the ship it jams (H3.5.2)', () => {
    const scout = ship({ id: 'scout', side: 'Red', form: HERMES, y: -10 })
    const guarded = ship({ id: 'guarded', side: 'Red', form: VALLARI_CRUISER, y: -10 })
    const attacker = ship({ id: 'attacker' })
    powerScoutSensors(scout, 3)
    const ships = [scout, guarded, attacker]
    for (let i = 0; i < 2; i++) setScoutAssignment(scout, i, 'jamming', null, ships)

    const phaser = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!
    attacker.mounts[phaser.id][0].armed = phaser.mounts[0].armingCircles
    const result = resolveVolley(
      {
        attacker,
        target: guarded,
        mounts: [{ weaponId: phaser.id, mountIndex: 0 }],
        mode: 'standard',
        scoutSupport: scoutSupportFor(attacker, guarded, ships),
      },
      ctx(),
      new Rng(4),
    )
    expect(result.ok && result.effectiveRange).toBe(12)
  })

  it('is reachable from the game state', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    const enemy = ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, x: 10 })
    const game = createGame({ scenario: THE_DUEL, ships: [scout, enemy], seed: 8 })
    // Power is applied during the Resource Allocation Segment, after the round
    // has begun and cleared the previous round's allocation.
    powerScoutSensors(scout, 3)
    setScoutAssignment(scout, 0, 'targeting', 'enemy', game.ships)
    expect(scoutSupport(game, scout, enemy).targeting).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// H3.1.1 damage
// ---------------------------------------------------------------------------

describe('damaging scout sensors (H3.1.1)', () => {
  const card = (primary: DamageCard['primary'], alt?: DamageCard['alt']): DamageCard => ({
    id: 'c',
    category: 'general',
    primary,
    alt,
    stressIcon: false,
  })

  it('marks scout sensors off with a Special System hit', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    powerScoutSensors(scout, 3)
    // The Hermes carries no SPCL, PROB or CMND boxes, so a Special System hit
    // has nowhere else to land.
    expect(scout.form.systems.some((g) => ['SPCL', 'PROB', 'CMND'].includes(g.kind))).toBe(false)

    resolveCard(scout, card('special-system', 'quarters'), ctx())
    expect(scoutSensorsIntact(scout)).toBe(2)
  })

  it('takes a Sensor Hit on the scout sensors once they outnumber the normal ones', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    powerScoutSensors(scout, 3)

    // SENS 3 against 3 scout sensors: the normal sensors go first.
    resolveCard(scout, card('sensors', 'quarters'), ctx())
    expect(scoutSensorsIntact(scout)).toBe(3)
    expect(undamagedSystemBoxes(scout, 'SENS')).toBe(2)

    // Now the scout sensors are the larger pool, so they take the next one.
    resolveCard(scout, card('sensors', 'quarters'), ctx())
    expect(scoutSensorsIntact(scout)).toBe(2)
    expect(undamagedSystemBoxes(scout, 'SENS')).toBe(2)
  })

  it('switches off sensors the SCOUT SEN line can no longer power', () => {
    const scout = ship({ id: 'scout', form: HERMES })
    powerScoutSensors(scout, 3)
    for (let i = 0; i < 3; i++) setScoutAssignment(scout, i, 'jamming', null, [scout])
    expect(activeScoutSensors(scout)).toHaveLength(3)

    resolveCard(scout, card('special-system', 'quarters'), ctx())
    expect(activeScoutSensors(scout)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// C5. Formation maneuvering
// ---------------------------------------------------------------------------

describe('joining a formation (C5.1)', () => {
  it('requires range 1 of the lead ship (C5.1.2)', () => {
    const lead = ship({ id: 'lead' })
    const near = ship({ id: 'near', x: 1.5 })
    const far = ship({ id: 'far', x: FORMATION_RANGE })
    expect(joinRequirements(lead, near)).toBeNull()
    expect(joinRequirements(lead, far)).toMatch(/range 1/)
  })

  it('requires the same speed (C5.1.2)', () => {
    const lead = ship({ id: 'lead', speed: 4 })
    const slower = ship({ id: 'slower', x: 1, speed: 3 })
    expect(joinRequirements(lead, slower)).toMatch(/speed 3, the formation at 4/)
  })

  it('requires a heading within 45 degrees (C5.1.2)', () => {
    const lead = ship({ id: 'lead', heading: 0 })
    expect(joinRequirements(lead, ship({ id: 'a', x: 1, heading: 15 }))).toBeNull()
    expect(joinRequirements(lead, ship({ id: 'b', x: 1, heading: 45 }))).toBeNull()
    expect(joinRequirements(lead, ship({ id: 'c', x: 1, heading: 60 }))).toMatch(/more than 45/)
    // The turn is measured the short way round.
    expect(headingDelta(350, 20)).toBe(30)
    expect(joinRequirements(lead, ship({ id: 'd', x: 1, heading: 330 }))).toBeNull()
  })

  it('refuses ships of another faction (C5.1)', () => {
    const lead = ship({ id: 'lead' })
    const enemy = ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, x: 1 })
    expect(joinRequirements(lead, enemy)).toMatch(/same faction/)
  })

  it('leads with the least maneuverable ship at the formation speed (C5.1.1)', () => {
    const DREADNOUGHT = findShipForm('UNION I-class Dreadnought')!
    // At speed 5 the Hermes turns on a 25° template and the dreadnought on 20°,
    // so the dreadnought is the one everybody has to follow.
    const nimble = ship({ id: 'nimble', form: HERMES, speed: 5 })
    const heavy = ship({ id: 'heavy', form: DREADNOUGHT, speed: 5 })
    expect(chooseLead([nimble, heavy])!.id).toBe('heavy')
    expect(chooseLead([heavy, nimble])!.id).toBe('heavy')

    // At speed 4 both turn on 30°, and C5.1.1 leaves the tie to the player —
    // here, the first candidate offered.
    nimble.speed = 4
    heavy.speed = 4
    expect(chooseLead([nimble, heavy])!.id).toBe('nimble')
  })

  it('forms up and reports the ships that could not join', () => {
    const formations: Formation[] = []
    const lead = ship({ id: 'lead' })
    const ok = ship({ id: 'ok', x: 1 })
    const tooFar = ship({ id: 'far', x: 9 })

    const { formation, rejected } = joinFormation(formations, lead, [ok, tooFar])
    expect(formation?.memberIds).toEqual(['ok'])
    expect(rejected.map((r) => r.ship.id)).toEqual(['far'])
    expect(formationOf(formations, 'ok')?.leadId).toBe('lead')
    expect(formationOf(formations, 'far')).toBeNull()
  })
})

describe('flying in formation (C5.2)', () => {
  function squadron() {
    const formations: Formation[] = []
    const lead = ship({ id: 'lead' })
    const wing1 = ship({ id: 'wing1', x: 1 })
    const wing2 = ship({ id: 'wing2', x: -1 })
    joinFormation(formations, lead, [wing1, wing2])
    return { formations, lead, wing1, wing2, ships: [lead, wing1, wing2] }
  }

  it('puts every member on the lead ship’s counter (C5.1.3)', () => {
    const { formations, lead, wing1, wing2, ships } = squadron()
    lead.placement = { position: { x: 10, y: 4 }, heading: 90 }
    lead.speed = 5
    alignToLead(formations[0], ships)

    for (const wing of [wing1, wing2]) {
      expect(wing.placement.position).toEqual({ x: 10, y: 4 })
      expect(wing.placement.heading).toBe(90)
      expect(wing.speed).toBe(5)
    }
  })

  it('disbands when a member leaves, and when the lead leaves (C5.2)', () => {
    const { formations } = squadron()
    leaveFormation(formations, 'wing1')
    expect(formations[0].memberIds).toEqual(['wing2'])
    leaveFormation(formations, 'lead')
    expect(formations).toHaveLength(0)
  })

  it('drops ships that leave the battle', () => {
    const { formations, wing1, wing2, ships } = squadron()
    wing1.destroyed = true
    pruneFormations(formations, ships)
    expect(formations[0].memberIds).toEqual(['wing2'])
    wing2.disengaged = true
    pruneFormations(formations, ships)
    expect(formations).toHaveLength(0)
  })

  it('plots one set of movement orders for the whole formation (C5.1.3)', () => {
    const game = createGame({
      scenario: THE_DUEL,
      ships: [ship({ id: 'lead' }), ship({ id: 'wing', x: 1 }), ship({ id: 'red', side: 'Red', form: VALLARI_CRUISER, x: 20 })],
      seed: 6,
    })
    const [lead, wing] = game.ships
    joinFormation(game.formations, lead, [wing])

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    game.orders['lead'].maneuver = 'standard'
    game.orders['lead'].direction = 'right'
    // The wing ship plots something else entirely; the formation overrides it.
    game.orders['wing'].maneuver = 'slide'
    game.orders['wing'].direction = 'left'
    // Sensors stay independent (C5.2).
    game.orders['wing'].sensors = { targeting: 2, jamming: 0, tacticalScan: 0 }

    advanceSegment(game) // leave the Command Segment
    expect(game.orders['wing'].maneuver).toBe('standard')
    expect(game.orders['wing'].direction).toBe('right')
    expect(wing.sensors.targeting).toBe(2)

    advanceSegment(game) // operations
    advanceSegment(game) // navigation resolves movement
    expect(wing.placement.position).toEqual(lead.placement.position)
    expect(wing.placement.heading).toBe(lead.placement.heading)
  })
})

// ---------------------------------------------------------------------------
// E11.3 explosions — the price of flying in formation (C5)
// ---------------------------------------------------------------------------

describe('ship explosions (E11.3)', () => {
  it('catches every ship within range 1 (E11.3.2)', () => {
    setDestructionOptions({ derelicts: true, explosions: true, abandonShip: false, decelerationFromDamage: false })
    const doomed = ship({ id: 'doomed', form: VALLARI_CRUISER, side: 'Red' })
    const near = ship({ id: 'near', x: 1 })
    const far = ship({ id: 'far', x: 5 })
    const ships = [doomed, near, far]
    const context: DamageContext = { ...ctx(3), ships }

    const nearBefore = near.blueShieldDamage.P + near.blueShieldDamage.F + near.blueShieldDamage.A + near.blueShieldDamage.S
    resolveExplosionDamage(doomed, context)
    const nearAfter = near.blueShieldDamage.P + near.blueShieldDamage.F + near.blueShieldDamage.A + near.blueShieldDamage.S
    const farAfter = far.blueShieldDamage.P + far.blueShieldDamage.F + far.blueShieldDamage.A + far.blueShieldDamage.S

    expect(nearAfter).toBeGreaterThan(nearBefore)
    expect(farAfter).toBe(0)
  })

  it('strikes the aft shield of ships sharing the wreck’s counter (E11.3.4)', () => {
    setDestructionOptions({ derelicts: true, explosions: true, abandonShip: false, decelerationFromDamage: false })
    const formations: Formation[] = []
    const lead = ship({ id: 'lead' })
    const wing = ship({ id: 'wing', x: 0.5 })
    joinFormation(formations, lead, [wing])

    const ships = [lead, wing]
    const context: DamageContext = { ...ctx(5), ships, formations }
    resolveExplosionDamage(lead, context)

    // Aft, not the port or forward shield the geometry would otherwise pick.
    expect(wing.blueShieldDamage.A).toBeGreaterThan(0)
    expect(wing.blueShieldDamage.F + wing.blueShieldDamage.P + wing.blueShieldDamage.S).toBe(0)
  })

  it('rolls one red die per point of excess damage, and only with the rule on (E11.3.1)', () => {
    const doomed = ship({ id: 'doomed' })
    const context: DamageContext = { ...ctx(), ships: [doomed] }

    setDestructionOptions(STANDARD_DESTRUCTION)
    expect(explosionCheck(doomed, 3, context)).toBe(false)

    // Half a red die's faces are Special, so three dice explode almost always.
    setDestructionOptions({ derelicts: true, explosions: true, abandonShip: false, decelerationFromDamage: false })
    expect(explosionCheck(doomed, 3, { ...context, rng: new Rng(1) })).toBe(true)
    expect(doomed.destroyed).toBe(true)

    // No excess damage, no check.
    const intact = ship({ id: 'intact' })
    expect(explosionCheck(intact, 0, context)).toBe(false)
  })
})

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}
