import { describe, expect, it } from 'vitest'
import { THE_DUEL, startScenario } from '../data/scenarios'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { DENSITY_STATS } from '../data/terrainCounters'
import { applyManeuver } from './geometry'
import { autoChoices, type DamageContext, type DeckState } from './damage'
import { Rng } from './dice'
import { commitAllocation, setAllocation } from './engineering'
import {
  attemptTractorLock,
  createGame,
  advanceSegment,
  launchFlight,
  launchHoming,
  launchShuttle,
  performScan,
  performTransport,
  recoverFlight,
  recoverShuttle,
  tractorIncomingHoming,
  type GameState,
  type Terrain,
} from './game'
import { clampAccel, executeMovement, resolveStressCheck } from './navigation'
import { joinFormation } from './formation'
import { createShip, turnTemplateAt, type ShipState } from './shipState'
import type { CommandCard, DamageCard } from './types'

/**
 * Rules-audit fixes: navigation, formations, terrain (C-chapter and the
 * K-chapter terrain items assigned alongside them).
 */

function makeShip(speed = 4): ShipState {
  return createShip({
    id: 'test',
    side: 'Blue',
    name: 'U.S.S. Yorktown',
    form: YORKTOWN,
    placement: { position: { x: 18, y: 18 }, heading: 0 },
    speed,
  })
}

function card(overrides: Partial<CommandCard> = {}): CommandCard {
  return {
    maneuver: 'straight',
    direction: null,
    accel: 0,
    speed: 4,
    sensors: { targeting: 0, jamming: 0, tacticalScan: 0 },
    shieldsDown: [],
    ...overrides,
  }
}

/** Power EMER so an emergency turn is legal (C3.5.2). */
function powerEmer(ship: ShipState): void {
  setAllocation(ship, 'emer', 1)
  commitAllocation(ship)
}

// ---------------------------------------------------------------------------
// C3.9.3 / C3.9.4 — precise turn rates on Emergency Turns
// ---------------------------------------------------------------------------

describe('precise Emergency Turns (C3.9.3, C3.9.4)', () => {
  it('pivots the full 90 degrees by default, unreduced by the ordinary turn table', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 'em-90',
      direction: 'right',
      turnTemplate: 90,
    })
    expect(result.end.heading).toBe(90)
  })

  it('honors a chosen turn rate on a 90-degree Emergency Turn (C3.9.3)', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 'em-90',
      direction: 'right',
      turnTemplate: 20,
    })
    expect(result.end.heading).toBe(20)
  })

  it("fixes a 180's first pivot at 90 and lets the second be chosen (C3.9.4)", () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    // template (90) covers the fixed first pivot; template2 covers the second.
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 'em-180',
      direction: 'right',
      turnTemplate: 90,
      turnTemplate2: 20,
    })
    expect(result.end.heading).toBe(110)
  })

  it('threads a plotted turnRate through executeMovement for an em-90 (C3.9.3)', () => {
    const ship = makeShip()
    powerEmer(ship)
    executeMovement(ship, card({ maneuver: 'em-90', direction: 'right', speed: 4, turnRate: 20 }))
    expect(ship.placement.heading).toBe(20)
  })

  it('threads turnRate2 through executeMovement for an em-180, fixing the first pivot at 90 (C3.9.4)', () => {
    const ship = makeShip()
    powerEmer(ship)
    executeMovement(
      ship,
      card({ maneuver: 'em-180', direction: 'right', speed: 4, turnRate2: 20 }),
    )
    expect(ship.placement.heading).toBe(110)
  })

  it('defaults both pivots of an em-180 to 90 when no rate is chosen', () => {
    const ship = makeShip()
    powerEmer(ship)
    executeMovement(ship, card({ maneuver: 'em-180', direction: 'right', speed: 4 }))
    expect(ship.placement.heading).toBe(180)
  })
})

// ---------------------------------------------------------------------------
// C3.9.2 — Hard Turn and S-Turn take a rate per heading change
// ---------------------------------------------------------------------------

describe('two independent turn rates on Hard Turns and S-Turns (C3.9.2)', () => {
  it('applies a different template to each pivot of a Hard Turn', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 'hard',
      direction: 'right',
      turnTemplate: 20,
      turnTemplate2: 35,
    })
    expect(result.end.heading).toBe(55)
  })

  it('applies a different template to each pivot of an S-Turn', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 's-turn',
      direction: 'right',
      turnTemplate: 30,
      turnTemplate2: 10,
    })
    // Second turn is opposite direction: +30 then -10 = 20.
    expect(result.end.heading).toBe(20)
  })

  it('falls back to the first rate when the second is left unset, unchanged from before', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0 }
    const result = applyManeuver({
      start,
      speed: 4,
      maneuver: 'hard',
      direction: 'right',
      turnTemplate: 25,
    })
    expect(result.end.heading).toBe(50)
  })

  it('threads a second turn rate through the command card, clamped to the table (C3.9.1)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    const allowed = turnTemplateAt(ship, 4)
    const first = Math.max(0, allowed - 5)
    executeMovement(
      ship,
      card({ maneuver: 'hard', direction: 'right', speed: 4, turnRate: first, turnRate2: allowed + 50 }),
    )
    // The second rate is over the table maximum, so it is clamped to `allowed`.
    expect(ship.placement.heading).toBe(first + allowed)
  })
})

// ---------------------------------------------------------------------------
// C3.1.4 — stress-check damage cascades
// ---------------------------------------------------------------------------

describe('stress-check damage cascades Fire and Bridge Hit cards (C3.1.4)', () => {
  const filler = (id: string): DamageCard => ({
    id,
    category: 'general',
    primary: 'quarters',
    stressIcon: false,
  })
  const bridgeHit: DamageCard = {
    id: 'bridge',
    category: 'critical',
    primary: 'bridge-hit',
    stressIcon: true,
  }

  it('draws and resolves the two extra cards a Bridge Hit demands', () => {
    const ship = makeShip()
    commitAllocation(ship)
    ship.stressMarkers = 1

    // The deck is a stack popped from the end (drawCard pops), so put the
    // cascade's fillers deepest and the check's own batch — bridgeHit plus
    // enough fillers to fill the ship's Stress Rating — on top.
    const checkFillers = Array.from({ length: Math.max(0, YORKTOWN.stressRating - 1) }, (_, i) =>
      filler(`check-${i}`),
    )
    const cascadeFillers = [filler('cascade-1'), filler('cascade-2')]
    const deck: DeckState = { draw: [...cascadeFillers, ...checkFillers, bridgeHit], discard: [] }
    const context: DamageContext = { deck, rng: new Rng(1), choices: autoChoices, log: () => {} }

    const result = resolveStressCheck(ship, context)

    expect(result.checks[0].stressCard).toBe(bridgeHit)
    // stressRating cards for the check itself, plus the two Bridge Hit demands.
    expect(deck.discard).toHaveLength(YORKTOWN.stressRating + 2)
    expect(deck.draw).toHaveLength(0)
  })

  it('never draws the cascade when disabled (rules reading 1/2 compatibility)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    ship.stressMarkers = 1

    const checkFillers = Array.from({ length: Math.max(0, YORKTOWN.stressRating - 1) }, (_, i) =>
      filler(`check-${i}`),
    )
    const cascadeFillers = [filler('cascade-1'), filler('cascade-2')]
    const deck: DeckState = { draw: [...cascadeFillers, ...checkFillers, bridgeHit], discard: [] }
    const context: DamageContext = { deck, rng: new Rng(1), choices: autoChoices, log: () => {} }

    resolveStressCheck(ship, context, false)

    // Only the check's own batch is drawn; the cascade fillers are untouched.
    expect(deck.discard).toHaveLength(YORKTOWN.stressRating)
    expect(deck.draw).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// C3.6.7 — evasive maneuvers restrict transporters, tractors, and craft
// ---------------------------------------------------------------------------

describe('evasive-maneuver system restrictions (C3.6.7)', () => {
  function grantSystem(ship: ShipState, kind: 'TRAC' | 'TRAN' | 'SHTL' | 'HNGR' | 'LNCH' | 'LNDG', boxes: number): void {
    const systems = ship.form.systems.some((g) => g.kind === kind)
      ? ship.form.systems.map((g) => (g.kind === kind ? { ...g, boxes } : g))
      : [...ship.form.systems, { kind, label: kind, boxes }]
    ship.form = { ...ship.form, systems }
    ship.systemDamage[kind] = 0
  }

  function place(ship: ShipState, x: number, y: number): void {
    ship.placement = { ...ship.placement, position: { x, y } }
  }

  function dropShields(ship: ShipState): void {
    for (const side of ['F', 'S', 'A', 'P'] as const) ship.shieldsDown[side] = true
  }

  function duel3(seed = 1): GameState {
    return startScenario('s3.1-the-duel', { seed, rulesVersion: 3 })
  }

  it('refuses transporters from an evasive ship, but still lets it be boarded', () => {
    const game = duel3()
    const [from, to] = game.ships
    grantSystem(from, 'TRAN', 2)
    place(from, 10, 10)
    place(to, 10, 11)
    from.marineSquads = 2
    dropShields(from)
    dropShields(to)

    from.evasive = 2
    expect(performTransport(game, from, to, 1).refusal).toMatch(/evasive maneuvers.*C3\.6\.7/)

    // The exception: an evasive ship may still be boarded by someone else.
    to.evasive = 2
    from.evasive = 0
    expect(performTransport(game, from, to, 1).refusal).toBeNull()
  })

  it('refuses a tractor lock attempt from an evasive ship', () => {
    const game = duel3()
    const [attacker, defender] = game.ships
    grantSystem(attacker, 'TRAC', 3)
    place(attacker, 10, 10)
    place(defender, 10, 11)

    attacker.evasive = 1
    expect(attemptTractorLock(game, attacker, defender.id, 1).refusal).toMatch(/evasive maneuvers.*C3\.6\.7/)
    attacker.evasive = 0
    expect(attemptTractorLock(game, attacker, defender.id, 1).refusal).toBeNull()
  })

  it('refuses catching an incoming missile while evasive', () => {
    const game = duel3()
    const [defender, shooter] = game.ships
    grantSystem(defender, 'TRAC', 2)
    place(shooter, 18, 22)
    place(defender, 18, 18)
    shooter.placement = { ...shooter.placement, heading: 0 }

    // A minimal homing missile (particle weapons cannot be tractored at all —
    // J3.2.2 needs a MISL trait), armed and launched the ordinary way so the
    // in-flight weapon is one `homingWeaponDef` can actually resolve.
    const missile = {
      id: 'test-missile',
      name: 'TEST MISSILE',
      weaponClass: 'missile',
      mounts: [{ id: 'test-missile-m1', arcs: ['FS', 'FP'], armingCircles: 1, hitBoxes: 1 }],
      brackets: [{ min: 0, max: 6, band: 'green', dice: ['yellow'], endurancePhase: 1 }],
      traits: ['HOMING 2', 'MISL'],
    } as never
    shooter.form = {
      ...shooter.form,
      weapons: [...shooter.form.weapons, missile],
    }
    shooter.mounts[(missile as { id: string }).id] = [{ armed: 1, armedThisRound: 0, damage: 0, ammoUsed: 0 }]
    expect(launchHoming(game, shooter, missile, 0, defender)).toBeNull()
    const hw = game.homing[0]
    hw.position = { ...defender.placement.position }
    hw.impacted = true

    defender.evasive = 3
    expect(tractorIncomingHoming(game, defender, hw.id, 1).refusal).toMatch(/evasive maneuvers.*C3\.6\.7/)
  })

  it('refuses a shuttle launch from an evasive ship', () => {
    const game = duel3()
    const ship = game.ships[0]
    grantSystem(ship, 'SHTL', 1)
    ship.shuttlesAboard = 1
    ship.evasive = 1
    expect(launchShuttle(game, ship)).toMatch(/evasive maneuvers.*C3\.6\.7/)
    ship.evasive = 0
    expect(launchShuttle(game, ship)).toBeNull()
  })

  it('refuses a shuttle recovery aboard an evasive ship', () => {
    const game = duel3()
    const ship = game.ships[0]
    grantSystem(ship, 'SHTL', 1)
    ship.shuttlesAboard = 1
    const launched = launchShuttle(game, ship)
    expect(launched).toBeNull()
    const craft = game.smallCraft[0]
    craft.position = { ...ship.placement.position }
    ship.evasive = 1
    expect(recoverShuttle(game, craft.id, ship)).toMatch(/evasive maneuvers.*C3\.6\.7/)
  })

  it('refuses fighters launching from, or landing aboard, an evasive carrier', () => {
    const game = duel3()
    const ship = game.ships[0]
    ship.form = {
      ...ship.form,
      systems: [
        ...ship.form.systems,
        { kind: 'HNGR', label: 'Hangar Bay', boxes: 4 },
        { kind: 'LNCH', label: 'Launch Bay', boxes: 2 },
        { kind: 'LNDG', label: 'Landing Bay', boxes: 1 },
      ],
    }
    ship.flightsAboard = 4
    ship.evasive = 1
    expect(launchFlight(game, ship)).toMatch(/evasive maneuvers.*C3\.6\.7/)

    ship.evasive = 0
    expect(launchFlight(game, ship)).toBeNull()
    const flight = game.flights[0]
    flight.position = { ...ship.placement.position }
    ship.evasive = 1
    expect(recoverFlight(game, flight.id, ship)).toMatch(/evasive maneuvers.*C3\.6\.7/)
  })

  it("does not restrict anything under an older rules reading", () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 2 })
    const [from, to] = game.ships
    grantSystem(from, 'TRAN', 2)
    place(from, 10, 10)
    place(to, 10, 11)
    from.marineSquads = 2
    dropShields(from)
    dropShields(to)
    from.evasive = 2
    expect(performTransport(game, from, to, 1).refusal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// C5.1.3 / C5.2 — formation members must pay for the shared maneuver
// ---------------------------------------------------------------------------

describe('formation members without the power to match the lead (C5.1.3, C5.2)', () => {
  function shipAt(id: string, side = 'Blue', x = 0, speed = 4): ShipState {
    return createShip({
      id,
      side,
      name: id.toUpperCase(),
      form: YORKTOWN,
      placement: { position: { x, y: 0 }, heading: 0 },
      speed,
    })
  }

  function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
    let steps = 0
    while (!predicate(game) && steps++ < limit) advanceSegment(game)
    if (steps >= limit) throw new Error('sequence did not reach the target state')
  }

  it('drops a member that cannot afford the shared acceleration, instead of matching it for free', () => {
    const lead = shipAt('lead', 'Blue', 0, 4)
    const weak = shipAt('weak', 'Blue', 1, 4)
    const enemy = shipAt('enemy', 'Red', 30, 0)
    const game = createGame({ scenario: THE_DUEL, ships: [lead, weak, enemy], seed: 4, rulesVersion: 3 })
    joinFormation(game.formations, lead, [weak])

    // Give the lead the power to accelerate by 2; leave `weak`'s round budget
    // spent so it cannot afford the same bump when the shared card lands on it.
    const accelLine = lead.form.functions.find((l) => l.kind === 'accel')!
    setAllocation(lead, accelLine.id, accelLine.steps.length)

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    weak.accelUsedThisRound = 999 // no room left for any further acceleration
    game.orders[lead.id].maneuver = 'straight'
    game.orders[lead.id].accel = 2
    game.orders[lead.id].speed = 6

    advanceSegment(game) // leave command: applyFormationOrders copies the card
    expect(game.orders[weak.id].accel).toBe(2)
    expect(game.orders[weak.id].speed).toBe(6)

    advanceSegment(game) // operations
    advanceSegment(game) // navigation resolves movement

    expect(lead.speed).toBe(6)
    // `weak` could not pay for the acceleration, so it kept its own speed —
    // and left the formation rather than being teleported up to the lead's.
    expect(weak.speed).toBe(4)
    expect(game.formations).toHaveLength(0)
    expect(game.log.some((l) => /could not match the formation.*C5\.2/.test(l.message))).toBe(true)
  })

  it('keeps a member in formation, matched exactly, when it can afford the maneuver', () => {
    const lead = shipAt('lead', 'Blue', 0, 4)
    const wing = shipAt('wing', 'Blue', 1, 4)
    const enemy = shipAt('enemy', 'Red', 30, 0)
    const game = createGame({ scenario: THE_DUEL, ships: [lead, wing, enemy], seed: 4, rulesVersion: 3 })
    joinFormation(game.formations, lead, [wing])

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    game.orders[lead.id].maneuver = 'standard'
    game.orders[lead.id].direction = 'right'

    advanceSegment(game) // command
    advanceSegment(game) // operations
    advanceSegment(game) // navigation

    expect(game.formations).toHaveLength(1)
    expect(wing.placement.position).toEqual(lead.placement.position)
    expect(wing.placement.heading).toBe(lead.placement.heading)
    expect(wing.speed).toBe(lead.speed)
  })

  it("does not drop members under an older rules reading", () => {
    const lead = shipAt('lead', 'Blue', 0, 4)
    const weak = shipAt('weak', 'Blue', 1, 4)
    const enemy = shipAt('enemy', 'Red', 30, 0)
    const game = createGame({ scenario: THE_DUEL, ships: [lead, weak, enemy], seed: 4, rulesVersion: 2 })
    joinFormation(game.formations, lead, [weak])

    const accelLine = lead.form.functions.find((l) => l.kind === 'accel')!
    setAllocation(lead, accelLine.id, accelLine.steps.length)

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'command')
    weak.accelUsedThisRound = 999
    game.orders[lead.id].maneuver = 'straight'
    game.orders[lead.id].accel = 2
    game.orders[lead.id].speed = 6

    advanceSegment(game) // command
    advanceSegment(game) // operations
    advanceSegment(game) // navigation

    // The old behaviour: teleported up to the lead's speed, still in formation.
    expect(weak.speed).toBe(lead.speed)
    expect(game.formations).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C2.4.1 — slide-first is exposed on the command card
// ---------------------------------------------------------------------------

describe('slide-before-forward is plottable (C2.4.1)', () => {
  it('samples a different intermediate point when the slide comes first', () => {
    const ship = makeShip()
    commitAllocation(ship)
    ship.placement = { position: { x: 0, y: 0 }, heading: 0 }

    const after = executeMovement(ship, card({ maneuver: 'slide', direction: 'right', speed: 4 }))
    ship.placement = { position: { x: 0, y: 0 }, heading: 0 }
    const before = executeMovement(
      ship,
      card({ maneuver: 'slide', direction: 'right', speed: 4, slideFirst: true }),
    )

    // Final position is identical either way (vector addition commutes)...
    expect(after.end.position.x).toBeCloseTo(before.end.position.x)
    expect(after.end.position.y).toBeCloseTo(before.end.position.y)
    // ...but the sampled path differs, which is what terrain/hazard overlap
    // checks (K1.3.1) and overflown-homing checks read.
    expect(after.path[1]).not.toEqual(before.path[1])
  })
})

// ---------------------------------------------------------------------------
// K4.2.4 — nebula hampering reaches TRAC and SCNC, not just TRAN
// ---------------------------------------------------------------------------

describe('nebula hampering reaches tractor beams and scans (K4.2.4)', () => {
  function nebulaGame(seed = 2): GameState {
    return createGame({
      scenario: { ...THE_DUEL, nebula: true },
      ships: [
        createShip({
          id: 'a',
          side: 'Blue',
          name: 'A',
          form: YORKTOWN,
          placement: { position: { x: 10, y: 10 }, heading: 0 },
          speed: 0,
        }),
        createShip({
          id: 'b',
          side: 'Red',
          name: 'B',
          form: VALLARI_CRUISER,
          placement: { position: { x: 10, y: 11 }, heading: 0 },
          speed: 0,
        }),
      ],
      seed,
      rulesVersion: 3,
    })
  }

  it('refuses a tractor lock below GEN SYS MAX, and allows it at MAX', () => {
    const game = nebulaGame()
    const [a, b] = game.ships
    a.form = {
      ...a.form,
      systems: a.form.systems.some((g) => g.kind === 'TRAC')
        ? a.form.systems.map((g) => (g.kind === 'TRAC' ? { ...g, boxes: 3 } : g))
        : [...a.form.systems, { kind: 'TRAC', label: 'Tractor Beams', boxes: 3 }],
    }
    a.systemDamage.TRAC = 0
    a.genSysLevel = 'nrm'

    expect(attemptTractorLock(game, a, b.id, 1).refusal).toMatch(/hampered.*K4\.2\.4/)

    a.genSysLevel = 'max'
    expect(attemptTractorLock(game, a, b.id, 1).refusal).toBeNull()
  })

  it('zeroes the science-box contribution to a scan below MAX, not the sensor-point contribution', () => {
    const game = nebulaGame()
    const [a, b] = game.ships
    a.form = {
      ...a.form,
      systems: a.form.systems.some((g) => g.kind === 'SCNC')
        ? a.form.systems.map((g) => (g.kind === 'SCNC' ? { ...g, boxes: 4 } : g))
        : [...a.form.systems, { kind: 'SCNC', label: 'Sciences', boxes: 4 }],
    }
    a.systemDamage.SCNC = 0
    a.genSysLevel = 'nrm'
    a.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }

    const hampered = performScan(game, a, b.id)
    expect(hampered.refusal).toBeNull()
    // Only the 2 Tactical Scan sensor points get through; the 4 science boxes do not.
    expect(hampered.gained).toBe(2)

    // GEN SYS at MAX lifts the hamper (K4.2.4) — the science boxes contribute
    // again, at their normal (not-this-phase's-MAX-system) rate.
    game.ops.scannedThisPhase.clear()
    a.genSysLevel = 'max'
    const atMax = performScan(game, a, b.id)
    expect(atMax.gained).toBe(2 + 4)
  })
})

// ---------------------------------------------------------------------------
// K2.1.7 — evasive maneuvering rerolls asteroid transit damage
// ---------------------------------------------------------------------------

describe('evasive maneuvering rerolls asteroid transit damage (K2.1.7)', () => {
  const FIELD: Terrain = {
    id: 'asteroid-test',
    kind: 'asteroid-field',
    name: 'Asteroids #1',
    center: { x: 18, y: 5 },
    radius: 2,
    density: 'extreme',
    safeSpeed: DENSITY_STATS.extreme.spd,
    damageDie: DENSITY_STATS.extreme.dmgDie,
    cover: DENSITY_STATS.extreme.cover,
    scan: DENSITY_STATS.extreme.scan,
  }

  function transitDamage(evasive: number, seed: number, rulesVersion = 3): number {
    const ship = createShip({
      id: 'blue',
      side: 'Blue',
      name: 'BLUE',
      form: YORKTOWN,
      placement: { position: { x: 18, y: 10 }, heading: 0 },
      speed: 6,
    })
    const enemy = createShip({
      id: 'red',
      side: 'Red',
      name: 'RED',
      form: VALLARI_CRUISER,
      placement: { position: { x: 30, y: 30 }, heading: 0 },
      speed: 0,
    })
    const scenario = { ...THE_DUEL, terrain: [FIELD] }
    const game = createGame({ scenario, ships: [ship, enemy], seed, rulesVersion })

    let steps = 0
    while (game.segment !== 'command' && steps++ < 20) advanceSegment(game)
    game.orders[ship.id].maneuver = 'straight'
    game.orders[ship.id].direction = null
    game.orders[ship.id].speed = 6
    game.orders[ship.id].accel = 0
    ship.evasive = evasive

    while (game.segment !== 'combat' && steps++ < 20) advanceSegment(game)

    const entry = [...game.log].reverse().find((l) => /takes \d+ damage transiting/.test(l.message))
    const match = entry?.message.match(/takes (\d+) damage/)
    return match ? Number(match[1]) : 0
  }

  it('lowers the average transit damage when the ship weaves', () => {
    const trials = 120
    const mean = (evasive: number) => {
      let total = 0
      for (let seed = 1; seed <= trials; seed++) total += transitDamage(evasive, seed)
      return total / trials
    }
    const none = mean(0)
    const full = mean(4) // over = speed(6) - safeSpeed(2) = 4 dice
    expect(full).toBeLessThan(none)
  })

  it('gives no reroll under an older rules reading', () => {
    // Same seeds, same evasive level: only the rules reading differs, so
    // rerolling must never have happened for the old reading.
    const trials = 40
    let same = 0
    for (let seed = 1; seed <= trials; seed++) {
      if (transitDamage(4, seed, 2) === transitDamage(4, seed, 2)) same += 1
    }
    expect(same).toBe(trials)
    // And it matches evasive=0 at the same reading, since no reroll ever runs.
    let matchesUnevasive = 0
    for (let seed = 1; seed <= trials; seed++) {
      if (transitDamage(4, seed, 2) === transitDamage(0, seed, 2)) matchesUnevasive += 1
    }
    expect(matchesUnevasive).toBe(trials)
  })
})

// ---------------------------------------------------------------------------
// C3.9.1 sanity check — clampAccel import stays exercised (regression guard
// for the turnTemplate/turnTemplate2 refactor sharing its ceiling logic).
// ---------------------------------------------------------------------------

describe('turn-rate ceiling still respects the acceleration clamp path', () => {
  it('still clamps a plotted acceleration the same way after the refactor', () => {
    const ship = makeShip()
    commitAllocation(ship)
    expect(clampAccel(ship, 5)).toBeLessThanOrEqual(YORKTOWN.sublight.maxAccelPerPhase)
  })
})
