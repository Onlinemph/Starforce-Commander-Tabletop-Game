import { beforeEach, describe, expect, it } from 'vitest'
import { BLUE, RED, startScenario } from '../data/scenarios'
import {
  advanceOperationsStep,
  advanceSegment,
  attemptTractorLock,
  contestTractor,
  craftLaunchedBy,
  damageSmallCraft,
  dockShuttle,
  gatherProbeInfo,
  launchProbe,
  launchShuttle,
  probeLaunchers,
  moveSmallCraft,
  performScan,
  performTransport,
  recoverShuttle,
  releaseTractor,
  scoutSupport,
  setMaxSystem,
  shuttleJamming,
  tractorBeamsFree,
  type GameState,
} from './game'
import {
  infoPoints,
  OPERATIONS_STEPS,
  scanYield,
  shieldsAllDown,
  systemPower,
  transportCapacity,
  transportRefusal,
  SCAN_RANGE,
} from './operations'
import { undamagedSystemBoxes, type ShipState } from './shipState'
import {
  isProbeCapableLauncher,
  isShuttle,
  jammingFromShuttles,
  launchRefusal,
  moveProbe,
  probeCapacity,
  recoveryAllowance,
  shuttleCapacity,
  PROBE_SPEED,
  PROBE_STANDOFF,
  SHUTTLE_SPEED,
  SHUTTLES_PER_BOX,
} from './smallCraft'
import {
  adjustedSpeed,
  displaceRefusal,
  ftlBlockedBy,
  displacedPosition,
  linkedGroup,
  lockOnSmall,
  lockOnStarship,
  LOCK_VALUE,
  pruneLinks,
  relativeSize,
  tractorBeams,
  TRACTOR_RANGE,
  type TractorLink,
} from './tractor'
import type { SystemKind } from './types'

/**
 * Section J: Operations.
 *
 * Setup note that bites every time: `createGame` runs `beginRound`, which
 * clears each ship's allocation, so GEN SYS has to be powered *after* the game
 * exists — power is spent in the Resource Allocation Segment, not before it.
 */

function duel(seed = 1): GameState {
  return startScenario('s3.1-the-duel', { seed })
}

/** Walk the sequence of play until the named segment comes round. */
function runTo(game: GameState, segment: string): void {
  for (let i = 0; i < 200 && game.segment !== segment; i += 1) advanceSegment(game)
}

/**
 * Ship forms are shared objects straight out of the roster, so every helper
 * here copies the form before touching it. Editing one in place would leak into
 * every other game built from the same class.
 */
function editForm(ship: ShipState, patch: Partial<ShipState['form']>): void {
  ship.form = { ...ship.form, ...patch }
}

/** Put GEN SYS at the given level by filling its circles (B2.2.10, J1.1). */
function setGenSys(ship: ShipState, level: 'off' | 'nrm' | 'max'): void {
  const line = ship.form.functions.find((l) => l.kind === 'gen-sys')!
  ship.allocation[line.id] = level === 'max' ? 1 : 0
  if (level === 'off') {
    editForm(ship, {
      functions: ship.form.functions.map((l) => (l.id === line.id ? { ...l, freeValue: 0 } : l)),
    })
  }
}

/** Give a ship system boxes it does not print, so a rule can be exercised. */
function grantSystem(ship: ShipState, kind: SystemKind, boxes: number): void {
  const systems = ship.form.systems.some((g) => g.kind === kind)
    ? ship.form.systems.map((g) => (g.kind === kind ? { ...g, boxes } : g))
    : [...ship.form.systems, { kind, label: kind, boxes }]
  editForm(ship, { systems })
  ship.systemDamage[kind] = 0
}

function place(ship: ShipState, x: number, y: number): void {
  ship.placement = { ...ship.placement, position: { x, y } }
}

function dropShields(ship: ShipState): void {
  for (const side of ['F', 'S', 'A', 'P'] as const) ship.shieldsDown[side] = true
}

// ---------------------------------------------------------------------------
// J1 — the segment framework
// ---------------------------------------------------------------------------

describe('the Operations Segment (J1)', () => {
  it('walks Steps A to E in order', () => {
    const game = duel()
    expect(game.ops.step).toBe(OPERATIONS_STEPS[0])
    const seen = [game.ops.step]
    while (advanceOperationsStep(game)) seen.push(game.ops.step)
    expect(seen).toEqual(OPERATIONS_STEPS)
    expect(advanceOperationsStep(game)).toBe(false)
  })

  it('runs one system at MAX and everything else at normal (J1.1.2)', () => {
    const game = duel()
    const ship = game.ships[0]
    setGenSys(ship, 'max')
    grantSystem(ship, 'TRAC', 2)
    grantSystem(ship, 'SCNC', 3)

    setMaxSystem(game, ship, 'TRAC')
    expect(systemPower(ship, 'TRAC', 'TRAC')).toBe('max')
    expect(systemPower(ship, 'SCNC', 'TRAC')).toBe('nrm')
  })

  it('gives nothing MAX power when GEN SYS is only at normal', () => {
    const game = duel()
    const ship = game.ships[0]
    setGenSys(ship, 'nrm')
    grantSystem(ship, 'TRAC', 2)
    expect(systemPower(ship, 'TRAC', 'TRAC')).toBe('nrm')
  })

  it('switches a system off when its boxes are gone', () => {
    const game = duel()
    const ship = game.ships[0]
    grantSystem(ship, 'TRAC', 1)
    ship.systemDamage.TRAC = 1
    expect(systemPower(ship, 'TRAC', null)).toBe('off')
  })

  it('starts each phase with the step back at A and no system at MAX', () => {
    const game = duel()
    setMaxSystem(game, game.ships[0], 'TRAC')
    runTo(game, 'operations')
    advanceOperationsStep(game)
    runTo(game, 'command')
    runTo(game, 'operations')
    expect(game.ops.step).toBe(OPERATIONS_STEPS[0])
    expect(game.ops.maxSystem[game.ships[0].id] ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// J3 — tractor beams
// ---------------------------------------------------------------------------

describe('tractor beams (J3)', () => {
  let game: GameState
  let attacker: ShipState
  let defender: ShipState

  beforeEach(() => {
    game = duel()
    attacker = game.ships[0]
    defender = game.ships[1]
    grantSystem(attacker, 'TRAC', 3)
    setGenSys(attacker, 'nrm')
    place(attacker, 10, 10)
    place(defender, 10, 11)
  })

  it('counts one beam per undamaged TRAC box (J3.1.2)', () => {
    expect(tractorBeams(attacker)).toBe(3)
    attacker.systemDamage.TRAC = 2
    expect(tractorBeams(attacker)).toBe(1)
  })

  it('reaches 1 inch at normal power and 2 at maximum (J3.1.3)', () => {
    expect(TRACTOR_RANGE.nrm).toBe(1)
    expect(TRACTOR_RANGE.max).toBe(2)
  })

  it('scores a blue die as miss 0, light 2, medium 3 (J3.3.1)', () => {
    expect(LOCK_VALUE['-']).toBe(0)
    expect(LOCK_VALUE.L).toBe(2)
    expect(LOCK_VALUE.M).toBe(3)
  })

  it('locks a starship when the total beats its size class', () => {
    const good = lockOnStarship({ int: () => 1 } as never, 3, 'nrm', 5)
    expect(good.total).toBeGreaterThanOrEqual(good.required)
    expect(good.locked).toBe(true)
  })

  it('doubles the roll at MAX power (J3.3.1)', () => {
    const rng = { int: () => 1 } as never
    const normal = lockOnStarship(rng, 2, 'nrm', 99)
    const maximum = lockOnStarship(rng, 2, 'max', 99)
    expect(maximum.total).toBe(normal.total * 2)
  })

  it('locks a small target on any single L or M (J3.2.1)', () => {
    const faces = lockOnSmall({ int: () => 0 } as never, 4)
    // Whatever the dice, the rule is "any one of them", not a total.
    expect(faces.required).toBe(0)
    expect(faces.locked).toBe(faces.faces.some((f) => f === 'L' || f === 'M'))
  })

  it('refuses a lock beyond the beam’s reach', () => {
    place(defender, 10, 14)
    const result = attemptTractorLock(game, attacker, defender.id, 1)
    expect(result.refusal).toMatch(/J3\.1\.3/)
  })

  it('refuses to commit more beams than are free (J3.2.4)', () => {
    attacker.systemDamage.TRAC = 2
    const result = attemptTractorLock(game, attacker, defender.id, 2)
    expect(result.refusal).toMatch(/free tractor beam/)
  })

  it('cannot lock a size-5 hull with a single beam, whatever it rolls', () => {
    // A blue die is worth at most 3, so one beam can never reach size class 5.
    expect(defender.form.sizeClass).toBeGreaterThan(3)
    for (let i = 0; i < 50; i += 1) {
      expect(attemptTractorLock(game, attacker, defender.id, 1).locked).toBe(false)
    }
  })

  it('holds a lock across phases and ties up its beams', () => {
    // Three beams can reach size class 5; roll until one lands, so the test is
    // about the bookkeeping rather than the dice.
    let locked = false
    for (let i = 0; i < 200 && !locked; i += 1) {
      locked = attemptTractorLock(game, attacker, defender.id, 3).locked ?? false
    }
    expect(locked).toBe(true)
    expect(game.ops.links).toHaveLength(1)
    expect(tractorBeamsFree(game, attacker)).toBe(0)
    releaseTractor(game, attacker.id, defender.id)
    expect(game.ops.links).toHaveLength(0)
    expect(tractorBeamsFree(game, attacker)).toBe(3)
  })
})

describe('speed while linked (J3.3.4)', () => {
  const chartLink = (sourceId: string, targetId: string): TractorLink => ({
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    targetKind: 'ship',
    beams: 1,
    power: 'nrm',
  })

  function pair(sizeA: number, sizeB: number, speed: number) {
    const game = duel()
    const [a, b] = game.ships
    editForm(a, { sizeClass: sizeA })
    editForm(b, { sizeClass: sizeB })
    a.speed = speed
    const links = [chartLink(a.id, b.id)]
    return { a, b, links, ships: game.ships }
  }

  it('reads the chart for a similar-size partner', () => {
    // Similar column: speeds 0-8 give 0,0,1,1,2,2,3,3,4.
    for (const [speed, expected] of [[0, 0], [1, 0], [2, 1], [4, 2], [6, 3], [8, 4]] as const) {
      const { a, links, ships } = pair(5, 5, speed)
      expect(adjustedSpeed(a, links, ships), `speed ${speed}`).toBe(expected)
    }
  })

  it('barely slows a ship towing something much smaller', () => {
    const { a, links, ships } = pair(7, 3, 8)
    expect(adjustedSpeed(a, links, ships)).toBe(5)
  })

  it('cripples a ship linked to something much larger', () => {
    const { a, links, ships } = pair(3, 7, 8)
    expect(adjustedSpeed(a, links, ships)).toBe(3)
  })

  it('classifies relative size within one class as similar', () => {
    expect(relativeSize(5, 5)).toBe('similar')
    expect(relativeSize(5, 6)).toBe('similar')
    expect(relativeSize(5, 7)).toBe('larger')
    expect(relativeSize(5, 3)).toBe('smaller')
  })

  it('takes another point off for every further ship in the chain (step 5)', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 3 })
    const [a, b, c] = game.ships.filter((s) => s.side === BLUE)
    for (const ship of [a, b, c]) editForm(ship, { sizeClass: 5 })
    a.speed = 8
    const links = [chartLink(a.id, b.id), chartLink(b.id, c.id)]
    expect(linkedGroup(a.id, links)).toHaveLength(3)
    // Similar-size at speed 8 is 4, less one for the third ship.
    expect(adjustedSpeed(a, links, game.ships)).toBe(3)
  })

  it('leaves an unlinked ship at its own speed', () => {
    const { a, ships } = pair(5, 5, 6)
    expect(adjustedSpeed(a, [], ships)).toBe(6)
  })

  it('moves the ship at its adjusted speed but keeps its true speed (J3.4.5)', () => {
    const game = duel()
    const [a, b] = game.ships
    place(a, 10, 10)
    place(b, 10, 11)
    grantSystem(a, 'TRAC', 3)
    game.ops.links.push(chartLink(a.id, b.id))

    runTo(game, 'command')
    const before = { ...b.placement.position }
    b.speed = 6
    game.orders[b.id] = { ...game.orders[b.id], speed: 6, accel: 0, maneuver: 'straight' }
    const accelBefore = b.accelUsedThisRound

    runTo(game, 'navigation')
    advanceSegment(game)

    const travelled = Math.hypot(
      b.placement.position.x - before.x,
      b.placement.position.y - before.y,
    )
    // Similar size at speed 6 is adjusted to 3.
    expect(travelled).toBeCloseTo(3, 5)
    expect(b.speed).toBe(6)
    expect(b.accelUsedThisRound).toBe(accelBefore)
  })
})

describe('breaking a tractor lock (J3.6)', () => {
  it('lapses when the ships drift out of range (J3.6.2)', () => {
    const game = duel()
    const [a, b] = game.ships
    grantSystem(a, 'TRAC', 2)
    place(a, 10, 10)
    place(b, 10, 20)
    game.ops.links.push({
      id: 'x',
      sourceId: a.id,
      targetId: b.id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    })
    const report = pruneLinks(game.ops.links, game.ships, (id) =>
      game.ships.find((s) => s.id === id)?.placement.position,
    )
    expect(report.broken).toHaveLength(1)
    expect(report.reasons[0]).toMatch(/J3\.6\.2/)
    expect(game.ops.links).toHaveLength(0)
  })

  it('lets go the moment the last tractor beam is shot away (J3.6.4)', () => {
    const game = duel()
    const [a, b] = game.ships
    grantSystem(a, 'TRAC', 1)
    place(a, 10, 10)
    place(b, 10, 11)
    game.ops.links.push({
      id: 'x',
      sourceId: a.id,
      targetId: b.id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    })
    a.systemDamage.TRAC = 1
    const report = pruneLinks(game.ops.links, game.ships, (id) =>
      game.ships.find((s) => s.id === id)?.placement.position,
    )
    expect(report.reasons[0]).toMatch(/J3\.6\.4/)
    expect(game.ops.links).toHaveLength(0)
  })

  it('lets the held ship force a fresh lock-on roll (J3.6.1)', () => {
    const game = duel()
    const [a, b] = game.ships
    grantSystem(a, 'TRAC', 1)
    place(a, 10, 10)
    place(b, 10, 11)
    game.ops.links.push({
      id: 'x',
      sourceId: a.id,
      targetId: b.id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    })
    const result = contestTractor(game, b.id)
    expect(result.refusal).toBeNull()
    expect(game.ops.links.length).toBe(result.locked ? 1 : 0)
  })

  it('stops a held ship going to FTL (J3.4.4)', () => {
    const game = duel()
    const [a, b] = game.ships
    grantSystem(a, 'TRAC', 1)
    // Fully power the FTL drive so the only thing stopping it is the beam.
    const ftl = b.form.functions.find((l) => l.kind === 'ftl-drive')!
    b.allocation[ftl.id] = ftl.steps.length
    place(a, 10, 10)
    place(b, 10, 11)

    runTo(game, 'disengagement')
    expect(b.disengaged).toBe(false)
    game.ops.links.push({
      id: 'x',
      sourceId: a.id,
      targetId: b.id,
      targetKind: 'ship',
      beams: 1,
      power: 'nrm',
    })
    // The option is gone while the beam holds.
    expect(ftlBlockedBy(b.id, game.ops.links)).toBe(true)
    expect(ftlBlockedBy(a.id, game.ops.links)).toBe(false)
  })
})

describe('displacing a towed ship (J3.5)', () => {
  function setup(sourceSize: number, targetSize: number) {
    const game = duel()
    const [a, b] = game.ships
    editForm(a, { sizeClass: sourceSize })
    editForm(b, { sizeClass: targetSize })
    const links: TractorLink[] = [
      { id: 'x', sourceId: a.id, targetId: b.id, targetKind: 'ship', beams: 1, power: 'max' },
    ]
    return { a, b, links }
  }

  it('needs MAX power (J3.5.1)', () => {
    const { a, b, links } = setup(5, 5)
    expect(displaceRefusal(a, b, links, 'nrm')).toMatch(/MAX power/)
    expect(displaceRefusal(a, b, links, 'max')).toBeNull()
  })

  it('refuses when the tractoring ship is much smaller', () => {
    const { a, b, links } = setup(3, 6)
    expect(displaceRefusal(a, b, links, 'max')).toMatch(/too small/)
  })

  it('locks two similar ships in place when both have each other (J3.5.1)', () => {
    const { a, b, links } = setup(5, 5)
    links.push({ id: 'y', sourceId: b.id, targetId: a.id, targetKind: 'ship', beams: 1, power: 'max' })
    expect(displaceRefusal(a, b, links, 'max')).toMatch(/neither may displace/)
  })

  it('moves the target one inch in the chosen direction (J3.5.2)', () => {
    const game = duel()
    const target = game.ships[1]
    target.placement = { position: { x: 10, y: 10 }, heading: 0 }
    expect(displacedPosition(target, 'F').y).toBeCloseTo(9, 5)
    expect(displacedPosition(target, 'A').y).toBeCloseTo(11, 5)
    expect(displacedPosition(target, 'S').x).toBeCloseTo(11, 5)
    expect(displacedPosition(target, 'P').x).toBeCloseTo(9, 5)
  })
})

// ---------------------------------------------------------------------------
// J4 — informational scans
// ---------------------------------------------------------------------------

describe('informational scans (J4)', () => {
  let game: GameState
  let scanner: ShipState
  let subject: ShipState

  beforeEach(() => {
    game = duel()
    ;[scanner, subject] = game.ships
    grantSystem(scanner, 'SCNC', 4)
    setGenSys(scanner, 'nrm')
    place(scanner, 10, 10)
    place(subject, 10, 14)
    scanner.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
  })

  it('pays a point per science box at normal power (J4.2.2)', () => {
    expect(scanYield(scanner, null, 0).total).toBe(4)
  })

  it('pays two a box at maximum power', () => {
    setGenSys(scanner, 'max')
    expect(scanYield(scanner, 'SCNC', 0).total).toBe(8)
  })

  it('adds a point per sensor point on Tactical Scan', () => {
    const result = scanYield(scanner, null, 3)
    expect(result.fromSciences).toBe(4)
    expect(result.fromSensors).toBe(3)
    expect(result.total).toBe(7)
  })

  it('gathers points and accumulates them across phases (J4.2.3)', () => {
    const first = performScan(game, scanner, subject.id)
    expect(first.refusal).toBeNull()
    expect(first.gained).toBe(4)
    game.ops.scannedThisPhase.clear()
    const second = performScan(game, scanner, subject.id)
    expect(second.total).toBe(8)
    expect(infoPoints(game.ops.info, scanner.side, subject.id)).toBe(8)
  })

  it('accumulates points from every friendly unit on the same object', () => {
    const game3 = startScenario('exp2-squadron-engagement', { seed: 5 })
    const blues = game3.ships.filter((s) => s.side === BLUE)
    const red = game3.ships.find((s) => s.side === RED)!
    place(red, 20, 20)
    for (const ship of blues) {
      grantSystem(ship, 'SCNC', 2)
      setGenSys(ship, 'nrm')
      ship.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
      place(ship, 20, 22)
      performScan(game3, ship, red.id)
    }
    expect(infoPoints(game3.ops.info, BLUE, red.id)).toBe(blues.length * 2)
  })

  it('refuses a target beyond effective range 8 (J4.2.1)', () => {
    place(subject, 10, 30)
    expect(performScan(game, scanner, subject.id).refusal).toMatch(/effective range/)
    expect(SCAN_RANGE).toBe(8)
  })

  it('lets targeting pull a distant object into range (J4.2.1)', () => {
    place(subject, 10, 22)
    expect(performScan(game, scanner, subject.id).refusal).toMatch(/effective range/)
    scanner.sensors = { targeting: 6, jamming: 0, tacticalScan: 0 }
    expect(performScan(game, scanner, subject.id).refusal).toBeNull()
  })

  it('refuses a second scan of the same object in one phase', () => {
    expect(performScan(game, scanner, subject.id).refusal).toBeNull()
    expect(performScan(game, scanner, subject.id).refusal).toMatch(/already scanned/)
  })

  it('scans terrain as readily as ships', () => {
    const ambush = startScenario('s3.3-orbital-ambush', { seed: 2 })
    const ship = ambush.ships[0]
    grantSystem(ship, 'SCNC', 2)
    setGenSys(ship, 'nrm')
    ship.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    const planet = ambush.scenario.terrain[0]
    place(ship, planet.center.x, planet.center.y + 3)
    expect(performScan(ambush, ship, planet.id).refusal).toBeNull()
    expect(infoPoints(ambush.ops.info, ship.side, planet.id)).toBe(2)
  })

  it('refuses when the sciences have nothing to work with', () => {
    scanner.systemDamage.SCNC = 4
    expect(performScan(game, scanner, subject.id).refusal).toMatch(/no undamaged SCNC/)
  })
})

// ---------------------------------------------------------------------------
// J5 — transporters
// ---------------------------------------------------------------------------

describe('transporters (J5)', () => {
  let game: GameState
  let from: ShipState
  let to: ShipState

  beforeEach(() => {
    game = duel()
    ;[from, to] = game.ships
    grantSystem(from, 'TRAN', 2)
    setGenSys(from, 'nrm')
    place(from, 10, 10)
    place(to, 10, 11)
    from.marineSquads = 6
    dropShields(from)
    dropShields(to)
  })

  it('carries one squad per undamaged TRAN box a phase (J5.2.2)', () => {
    expect(transportCapacity(from)).toBe(2)
    expect(performTransport(game, from, to, 2).refusal).toBeNull()
    expect(performTransport(game, from, to, 1).refusal).toMatch(/a phase/)
  })

  it('reaches 2 inches normally and 4 at MAX (J5.1.2)', () => {
    place(to, 10, 13)
    expect(performTransport(game, from, to, 1).refusal).toMatch(/transporter reaches 2/)
    setGenSys(from, 'max')
    setMaxSystem(game, from, 'TRAN')
    expect(performTransport(game, from, to, 1).refusal).toBeNull()
  })

  it('needs the shields down at both ends (J5.1.3)', () => {
    from.shieldsDown.F = false
    expect(performTransport(game, from, to, 1).refusal).toMatch(/must drop its shields/)
    from.shieldsDown.F = true
    to.shieldsDown.A = false
    expect(performTransport(game, from, to, 1).refusal).toMatch(/shields are up/)
  })

  it('lands squads on an enemy hull as boarders, not passengers (J6)', () => {
    expect(from.side).not.toBe(to.side)
    performTransport(game, from, to, 1)
    expect(to.boarders[from.side]).toBe(1)
    expect(to.marineSquads).toBe(to.form.marineSquads)
    expect(from.marineSquads).toBe(5)
  })

  it('reinforces a friendly ship instead', () => {
    const squadron = startScenario('exp2-squadron-engagement', { seed: 7 })
    const [a, b] = squadron.ships.filter((s) => s.side === BLUE)
    grantSystem(a, 'TRAN', 1)
    setGenSys(a, 'nrm')
    place(a, 10, 10)
    place(b, 10, 11)
    dropShields(a)
    dropShields(b)
    a.marineSquads = 3
    const before = b.marineSquads
    expect(performTransport(squadron, a, b, 1).refusal).toBeNull()
    expect(b.marineSquads).toBe(before + 1)
    expect(b.boarders[a.side] ?? 0).toBe(0)
  })

  it('cannot beam squads it does not have', () => {
    from.marineSquads = 0
    expect(performTransport(game, from, to, 1).refusal).toMatch(/only 0 marine squad/)
  })

  it('reports every shield being down', () => {
    expect(shieldsAllDown(to)).toBe(true)
    to.shieldsDown.S = false
    expect(shieldsAllDown(to)).toBe(false)
  })

  it('refuses when the transporters are wrecked', () => {
    from.systemDamage.TRAN = 2
    expect(
      transportRefusal({ from, to, squads: 1, usedThisPhase: 0, maxSystem: null }),
    ).toMatch(/no undamaged TRAN/)
  })
})

// ---------------------------------------------------------------------------
// J7 — probes
// ---------------------------------------------------------------------------

describe('probes (J7)', () => {
  let game: GameState
  let ship: ShipState
  let subject: ShipState

  beforeEach(() => {
    game = duel()
    ;[ship, subject] = game.ships
    grantSystem(ship, 'PROB', 1)
    setGenSys(ship, 'max')
    setMaxSystem(game, ship, 'PROB')
    place(ship, 10, 10)
    place(subject, 10, 28)
  })

  it('carries one probe per size class (J7.2.2)', () => {
    expect(probeCapacity(ship)).toBe(ship.form.sizeClass)
  })

  it('flies from a torpedo tube when the ship has no launcher (J7.1.3)', () => {
    // No printed ship in the roster carries a dedicated PROB launcher, so this
    // is the path that actually gets used.
    const plain = duel(9)
    const [firing, mark] = plain.ships
    place(firing, 10, 10)
    place(mark, 10, 20)
    expect(undamagedSystemBoxes(firing, 'PROB')).toBe(0)

    const tube = firing.form.weapons.find((w) => isProbeCapableLauncher(w.weaponClass))!
    const state = firing.mounts[tube.id][0]
    expect(launchProbe(plain, firing, mark.id, { weaponId: tube.id, mountIndex: 0 })).toMatch(
      /full arming time/,
    )

    state.armed = tube.mounts[0].armingCircles
    expect(probeLaunchers(firing).some((l) => l.weaponId === tube.id)).toBe(true)
    expect(launchProbe(plain, firing, mark.id, { weaponId: tube.id, mountIndex: 0 })).toBeNull()
    // Loading the probe costs the tube its arming (J7.2.2).
    expect(state.armed).toBe(0)
    expect(plain.smallCraft).toHaveLength(1)
  })

  it('refuses a phaser as a probe launcher (J7.1.3)', () => {
    const plain = duel(11)
    const [firing, mark] = plain.ships
    const phaser = firing.form.weapons.find((w) => !isProbeCapableLauncher(w.weaponClass))!
    firing.mounts[phaser.id][0].armed = phaser.mounts[0].armingCircles
    expect(launchProbe(plain, firing, mark.id, { weaponId: phaser.id, mountIndex: 0 })).toMatch(
      /torpedo or missile launcher/,
    )
  })

  it('needs the launcher at MAX power (J7.2.1)', () => {
    setMaxSystem(game, ship, null)
    expect(launchProbe(game, ship, subject.id)).toMatch(/MAX/)
    setMaxSystem(game, ship, 'PROB')
    expect(launchProbe(game, ship, subject.id)).toBeNull()
  })

  it('allows one launch per launcher per round (J7.2.1)', () => {
    expect(launchProbe(game, ship, subject.id)).toBeNull()
    expect(launchProbe(game, ship, subject.id)).toMatch(/one probe per launcher/)
  })

  it('flies up to 16 inches and stops 4 short (J7.3.2)', () => {
    const step = moveProbe(
      { id: 'p', kind: 'probe', side: BLUE, motherId: 'x', position: { x: 0, y: 0 }, damage: 0, activated: false },
      { x: 0, y: 10 },
    )
    expect(step.position.y).toBeCloseTo(10 - PROBE_STANDOFF, 5)
    expect(step.arrived).toBe(true)
  })

  it('is lost when it cannot close in one flight', () => {
    const step = moveProbe(
      { id: 'p', kind: 'probe', side: BLUE, motherId: 'x', position: { x: 0, y: 0 }, damage: 0, activated: false },
      { x: 0, y: 40 },
    )
    expect(step.position.y).toBeCloseTo(PROBE_SPEED, 5)
    expect(step.lost).toBe(true)
  })

  it('arrives and then feeds back a point a phase (J7.3.3)', () => {
    launchProbe(game, ship, subject.id)
    runTo(game, 'navigation')
    advanceSegment(game)
    const probe = game.smallCraft.find((c) => c.kind === 'probe')!
    expect(probe.transmitting).toBe(true)

    const before = infoPoints(game.ops.info, ship.side, subject.id)
    gatherProbeInfo(game)
    expect(infoPoints(game.ops.info, ship.side, subject.id)).toBe(before + 1)
  })

  it('dies to a single hit (J7.3.3)', () => {
    launchProbe(game, ship, subject.id)
    const probe = game.smallCraft.find((c) => c.kind === 'probe')!
    damageSmallCraft(game, probe.id, 1)
    expect(game.smallCraft).toHaveLength(0)
  })

  it('stops working when its target slips out of the standoff bubble', () => {
    launchProbe(game, ship, subject.id)
    runTo(game, 'navigation')
    advanceSegment(game)
    expect(game.smallCraft).toHaveLength(1)
    place(subject, 10, 2)
    runTo(game, 'navigation')
    advanceSegment(game)
    expect(game.smallCraft).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// J8 — shuttles
// ---------------------------------------------------------------------------

describe('shuttles (J8)', () => {
  let game: GameState
  let ship: ShipState

  beforeEach(() => {
    game = duel()
    ship = game.ships[0]
    grantSystem(ship, 'SHTL', 2)
    setGenSys(ship, 'nrm')
    ship.shuttlesAboard = 4
    place(ship, 18, 18)
    ship.speed = 2
  })

  it('holds two shuttles per undamaged SHTL box (J8.1.5)', () => {
    expect(shuttleCapacity(ship)).toBe(2 * SHUTTLES_PER_BOX)
  })

  it('launches one a phase, into the aft arc (J8.1.2, J8.2.1)', () => {
    expect(launchShuttle(game, ship)).toBeNull()
    expect(launchShuttle(game, ship)).toMatch(/already launched/)
    const craft = craftLaunchedBy(game, ship)[0]
    expect(isShuttle(craft)).toBe(true)
    // Aft of a ship heading 270 (west) is to its east.
    expect(craft.position.x).toBeGreaterThan(ship.placement.position.x)
    // A launched shuttle has used its activation (J8.2.1).
    expect(craft.activated).toBe(true)
    expect(ship.shuttlesAboard).toBe(3)
  })

  it('refuses to launch from a wrecked bay', () => {
    ship.systemDamage.SHTL = 2
    expect(launchRefusal(ship, game.smallCraft, false)).toMatch(/no undamaged SHTL/)
  })

  it('moves at most 3 inches a phase, in any direction (J8.2.3, J8.3.1)', () => {
    launchShuttle(game, ship)
    const craft = craftLaunchedBy(game, ship)[0]
    craft.activated = false
    const far = { x: craft.position.x + SHUTTLE_SPEED + 1, y: craft.position.y }
    expect(moveSmallCraft(game, craft.id, far)).toMatch(/a shuttle moves 3/)
    const near = { x: craft.position.x + SHUTTLE_SPEED, y: craft.position.y }
    expect(moveSmallCraft(game, craft.id, near)).toBeNull()
    expect(moveSmallCraft(game, craft.id, near)).toMatch(/already activated/)
  })

  it('lands back aboard a slow ship holding its speed (J8.2.4)', () => {
    launchShuttle(game, ship)
    const craft = craftLaunchedBy(game, ship)[0]
    craft.position = { ...ship.placement.position }
    expect(recoverShuttle(game, craft.id, ship)).toBeNull()
    expect(ship.shuttlesAboard).toBe(4)
  })

  it('refuses to land on a ship going too fast', () => {
    launchShuttle(game, ship)
    const craft = craftLaunchedBy(game, ship)[0]
    craft.position = { ...ship.placement.position }
    ship.speed = SHUTTLE_SPEED
    expect(recoverShuttle(game, craft.id, ship)).toMatch(/recovery needs less than 3/)
  })

  it('recovers two a phase at MAX with a spare tractor beam (J8.1.3)', () => {
    expect(recoveryAllowance(ship, null, 0)).toBe(1)
    setGenSys(ship, 'max')
    expect(recoveryAllowance(ship, 'SHTL', 0)).toBe(1)
    expect(recoveryAllowance(ship, 'SHTL', 1)).toBe(2)
  })

  it('docks with an enemy ship to deliver marines (J8.2.6)', () => {
    const enemy = game.ships[1]
    enemy.speed = 1
    place(enemy, 18, 18)
    dropShields(enemy)
    ship.marineSquads = 3
    launchShuttle(game, ship, 'shuttle', 2)
    const craft = craftLaunchedBy(game, ship)[0]
    craft.position = { ...enemy.placement.position }

    expect(dockShuttle(game, craft.id, enemy)).toBeNull()
    expect(enemy.boarders[ship.side]).toBe(2)
    expect(craft.dockedTo).toBe(enemy.id)
  })

  it('needs a shield down to board (J8.2.6 step 5)', () => {
    const enemy = game.ships[1]
    enemy.speed = 1
    place(enemy, 18, 18)
    for (const side of ['F', 'S', 'A', 'P'] as const) enemy.shieldsDown[side] = false
    launchShuttle(game, ship, 'shuttle', 1)
    const craft = craftLaunchedBy(game, ship)[0]
    craft.position = { ...enemy.placement.position }
    expect(dockShuttle(game, craft.id, enemy)).toMatch(/one down to board/)
  })

  it('takes only its size class in shuttles a phase (J8.2.6)', () => {
    const enemy = game.ships[1]
    enemy.speed = 1
    editForm(enemy, { sizeClass: 1 })
    place(enemy, 18, 18)
    dropShields(enemy)
    ship.marineSquads = 4

    launchShuttle(game, ship, 'shuttle', 1)
    const first = craftLaunchedBy(game, ship)[0]
    first.position = { ...enemy.placement.position }
    expect(dockShuttle(game, first.id, enemy)).toBeNull()

    game.ops.launchedThisPhase.clear()
    launchShuttle(game, ship, 'shuttle', 1)
    const second = craftLaunchedBy(game, ship).find((c) => c.id !== first.id)!
    second.position = { ...enemy.placement.position }
    expect(dockShuttle(game, second.id, enemy)).toMatch(/one per size class/)
  })

  it('takes four points of damage to destroy (J8.3.3)', () => {
    launchShuttle(game, ship)
    const craft = craftLaunchedBy(game, ship)[0]
    damageSmallCraft(game, craft.id, 3)
    expect(game.smallCraft).toHaveLength(1)
    damageSmallCraft(game, craft.id, 1)
    expect(game.smallCraft).toHaveLength(0)
  })
})

describe('jamming shuttles (J8.4)', () => {
  let game: GameState
  let ship: ShipState

  beforeEach(() => {
    game = duel()
    ship = game.ships[0]
    grantSystem(ship, 'SHTL', 1)
    ship.shuttlesAboard = 2
    ship.speed = 2
  })

  it('needs GEN SYS at MAX and speed 3 or less (J8.4.1, J8.4.2)', () => {
    setGenSys(ship, 'nrm')
    expect(launchShuttle(game, ship, 'jamming-shuttle')).toMatch(/GEN SYS set to MAX/)
    setGenSys(ship, 'max')
    ship.speed = 5
    expect(launchShuttle(game, ship, 'jamming-shuttle')).toMatch(/speed 3 or less/)
    ship.speed = 3
    expect(launchShuttle(game, ship, 'jamming-shuttle')).toBeNull()
  })

  it('lends its mother ship one point of jamming (J8.4.1)', () => {
    setGenSys(ship, 'max')
    launchShuttle(game, ship, 'jamming-shuttle')
    expect(shuttleJamming(game, ship)).toBe(1)
    expect(scoutSupport(game, game.ships[1], ship).jamming).toBe(1)
  })

  it('gives only one point however many are flying', () => {
    setGenSys(ship, 'max')
    launchShuttle(game, ship, 'jamming-shuttle')
    game.ops.launchedThisPhase.clear()
    launchShuttle(game, ship, 'jamming-shuttle')
    expect(game.smallCraft).toHaveLength(2)
    expect(jammingFromShuttles(game.smallCraft, ship)).toBe(1)
  })

  it('stops helping and scuttles itself once its ship outruns it (J8.4.2)', () => {
    setGenSys(ship, 'max')
    launchShuttle(game, ship, 'jamming-shuttle')
    ship.speed = 6
    expect(shuttleJamming(game, ship)).toBe(0)
    runTo(game, 'navigation')
    advanceSegment(game)
    expect(game.smallCraft).toHaveLength(0)
  })
})
