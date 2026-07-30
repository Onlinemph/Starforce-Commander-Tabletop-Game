import { beforeEach, describe, expect, it } from 'vitest'
import { startScenario, THE_DUEL } from '../data/scenarios'
import { findShipForm, VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { resolveVolley } from './combat'
import {
  commandPointsAvailable,
  COMMAND_RANGE,
  hasCommandSystems,
  lentTacticalScan,
  newCommandState,
  revokeCommandPoint,
  setCommandAssignment,
  type CommandState,
} from './command'
import {
  checkOneAttackPerPhase,
  coordinatedStepFor,
  FIRING_STEPS,
  individualStepFor,
  mayFireAlone,
  validateCoordinatedFire,
} from './coordinatedFire'
import { autoChoices, newDeck, setDestructionOptions, STANDARD_DESTRUCTION, type DamageContext } from './damage'
import { Rng } from './dice'
import {
  advanceSegment,
  createGame,
  currentFiringStep,
  attackAllowed,
  recordAttack,
  tacticalScanOf,
  type GameState,
} from './game'
import { createShip, findLine, undamagedSystemBoxes, type ShipState } from './shipState'

/**
 * Expansion 2: Coordinated Fire (H4, optional) and Command Systems (H5).
 */

const DREADNOUGHT = findShipForm('UNION I-class Dreadnought')!

/** Buy GEN SYS up to MAX, which command systems require (H5.1.3). */
function setGenSysMax(ship: ShipState): void {
  const line = findLine(ship.form, 'gen-sys')!
  ship.allocation[line.id] = Math.max(0, 2 - line.freeValue)
}

function ship(args: {
  id: string
  side?: string
  form?: typeof YORKTOWN
  x?: number
  y?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: 0 },
    speed: 4,
  })
}

function ctx(seed = 7): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

beforeEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

// ---------------------------------------------------------------------------
// H5. Command Systems
// ---------------------------------------------------------------------------

describe('command systems (H5)', () => {
  it('identifies command ships from their CMND boxes (H5.1.1, H5.1.2)', () => {
    expect(hasCommandSystems(ship({ id: 'flag', form: DREADNOUGHT }))).toBe(true)
    expect(hasCommandSystems(ship({ id: 'line' }))).toBe(false)
    expect(undamagedSystemBoxes(ship({ id: 'flag', form: DREADNOUGHT }), 'CMND')).toBe(4)
  })

  it('generates one point per box, but only at GEN SYS MAX (H5.1.3, H5.1.4)', () => {
    const flag = ship({ id: 'flag', form: DREADNOUGHT })
    expect(commandPointsAvailable(flag)).toBe(0)
    setGenSysMax(flag)
    expect(commandPointsAvailable(flag)).toBe(4)
  })

  it('lends nothing once the command ship is out of the battle (H4.7)', () => {
    const flag = ship({ id: 'flag', form: DREADNOUGHT })
    setGenSysMax(flag)
    flag.destroyed = true
    expect(commandPointsAvailable(flag)).toBe(0)
    flag.destroyed = false
    flag.derelict = true
    expect(commandPointsAvailable(flag)).toBe(0)
  })

  function force(): { ships: ShipState[]; state: CommandState } {
    const flag = ship({ id: 'flag', form: DREADNOUGHT })
    setGenSysMax(flag)
    const ships = [flag, ship({ id: 'a', x: 10 }), ship({ id: 'b', x: 20 }), ship({ id: 'c', x: 30 })]
    const state = newCommandState()
    state.commandShipId = 'flag'
    return { ships, state }
  }

  it('lends tactical scan to friendly ships in range (H5.2.1)', () => {
    const { ships, state } = force()
    expect(setCommandAssignment(state, ships, 'a', 2)).toBeNull()
    expect(setCommandAssignment(state, ships, 'b', 1)).toBeNull()
    expect(lentTacticalScan(state, ships)).toEqual({ a: 2, b: 1 })
  })

  it('refuses to lend more points than the ship generates (H5.1.4)', () => {
    const { ships, state } = force()
    expect(setCommandAssignment(state, ships, 'a', 3)).toBeNull()
    expect(setCommandAssignment(state, ships, 'b', 2)).toMatch(/only 4 command points/)
    // The rejected assignment left the state untouched.
    expect(lentTacticalScan(state, ships)).toEqual({ a: 3 })
  })

  it('lends itself at most one point (H5.2.3)', () => {
    const { ships, state } = force()
    expect(setCommandAssignment(state, ships, 'flag', 2)).toMatch(/maximum of one/)
    expect(setCommandAssignment(state, ships, 'flag', 1)).toBeNull()
    expect(lentTacticalScan(state, ships)).toEqual({ flag: 1 })
  })

  it('lends only within 36 inches (H5.1.5)', () => {
    const { ships, state } = force()
    const far = ship({ id: 'far', x: COMMAND_RANGE + 1 })
    ships.push(far)
    expect(setCommandAssignment(state, ships, 'far', 1)).toMatch(/command range is 36/)
    far.placement.position.x = COMMAND_RANGE
    expect(setCommandAssignment(state, ships, 'far', 1)).toBeNull()
  })

  it('lends only to units of the same faction (H5.2.4)', () => {
    const { ships, state } = force()
    ships.push(ship({ id: 'enemy', side: 'Red', form: VALLARI_CRUISER, x: 5 }))
    expect(setCommandAssignment(state, ships, 'enemy', 1)).toMatch(/same faction/)
  })

  it('withdraws lent points when the command ship dies (H4.7)', () => {
    const { ships, state } = force()
    setCommandAssignment(state, ships, 'a', 1)
    setCommandAssignment(state, ships, 'b', 1)
    expect(lentTacticalScan(state, ships)).toEqual({ a: 1, b: 1 })

    ships[0].destroyed = true
    expect(lentTacticalScan(state, ships)).toEqual({})
  })

  it('withdraws one point per damaged CMND box, owner’s choice (H4.7)', () => {
    const { ships, state } = force()
    for (const id of ['a', 'b', 'c']) setCommandAssignment(state, ships, id, 1)
    setCommandAssignment(state, ships, 'flag', 1)
    expect(lentTacticalScan(state, ships)).toEqual({ a: 1, b: 1, c: 1, flag: 1 })

    // One CMND box is knocked out: capacity drops to 3, and the tail of the
    // assignment list loses its point unless the owner names another ship.
    ships[0].systemDamage['CMND'] = 1
    expect(lentTacticalScan(state, ships)).toEqual({ a: 1, b: 1, c: 1 })

    revokeCommandPoint(state, 'a')
    expect(lentTacticalScan(state, ships)).toEqual({ b: 1, c: 1, flag: 1 })
  })

  it('lets a receiving ship exceed its own sensor cap (H5.2.2)', () => {
    const flag = ship({ id: 'flag', form: DREADNOUGHT })
    const consort = ship({ id: 'a', x: 10 })
    const game = createGame({ scenario: THE_DUEL, ships: [flag, consort], seed: 3 })
    // GEN SYS is bought during the Resource Allocation Segment, after the round
    // has begun and cleared the previous round's allocation.
    setGenSysMax(flag)
    game.command['Blue'].commandShipId = 'flag'
    setCommandAssignment(game.command['Blue'], game.ships, 'a', 2)

    consort.sensors.tacticalScan = 3
    expect(tacticalScanOf(game, consort)).toBe(5)
  })

  it('clears lent points at the start of a new round (H5.2.1)', () => {
    const flag = ship({ id: 'flag', form: DREADNOUGHT })
    const consort = ship({ id: 'a', x: 10 })
    const game = createGame({ scenario: THE_DUEL, ships: [flag, consort], seed: 3 })
    setGenSysMax(flag)
    game.command['Blue'].commandShipId = 'flag'
    setCommandAssignment(game.command['Blue'], game.ships, 'a', 1)
    expect(tacticalScanOf(game, consort)).toBe(1)

    for (let i = 0; i < 40 && game.round === 1; i++) advanceSegment(game)
    expect(game.round).toBe(2)
    expect(game.command['Blue'].assignments).toEqual([])
    expect(tacticalScanOf(game, consort)).toBe(0)
  })

  it('lets exactly one ship per side lend at a time (H5.1.6)', () => {
    const first = ship({ id: 'flag', form: DREADNOUGHT })
    const second = ship({ id: 'flag2', form: DREADNOUGHT, x: 5 })
    setGenSysMax(first)
    // The second command ship never bought GEN SYS MAX, so designating it
    // leaves the force with no lent points at all.
    const ships = [first, second, ship({ id: 'a', x: 10 })]
    const state = newCommandState()
    state.commandShipId = 'flag'
    setCommandAssignment(state, ships, 'a', 2)
    expect(lentTacticalScan(state, ships)).toEqual({ a: 2 })

    state.commandShipId = 'flag2'
    expect(lentTacticalScan(state, ships)).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// H4. Coordinated Fire
// ---------------------------------------------------------------------------

describe('coordinated fire sequence (H4.2)', () => {
  it('prints ten steps: six individual descending, four coordinated ascending (H4.2.3)', () => {
    expect(FIRING_STEPS).toHaveLength(10)
    const individual = FIRING_STEPS.filter((s) => s.kind === 'individual')
    const coordinated = FIRING_STEPS.filter((s) => s.kind === 'coordinated')
    expect(individual.map((s) => s.scan)).toEqual([5, 4, 3, 2, 1, 0])
    expect(coordinated.map((s) => s.scan)).toEqual([2, 3, 4, 5])
    expect(coordinated.map((s) => s.index)).toEqual([7, 8, 9, 10])
  })

  it('places a ship on the individual step matching its scan level (H4.4)', () => {
    expect(individualStepFor(3).index).toBe(3)
    expect(individualStepFor(0).index).toBe(6)
    // Step 1 is "5 or more".
    expect(individualStepFor(5).index).toBe(1)
    expect(individualStepFor(9).index).toBe(1)
  })

  it('is off unless the optional rule is switched on (H4.1)', () => {
    const game = createGame({ scenario: THE_DUEL, ships: [ship({ id: 'a' })], seed: 1 })
    expect(game.coordinatedFire).toBe(false)
    expect(currentFiringStep(game).index).toBe(1)
  })
})

describe('coordinated fire eligibility (H4.5)', () => {
  const entries = (scans: number[], side = 'Blue') =>
    scans.map((scan, i) => ({ ship: ship({ id: `s${i}`, side }), scan }))

  it('needs one scan point per ship firing together (H4.5.1)', () => {
    const step7 = FIRING_STEPS[6]
    expect(validateCoordinatedFire(entries([2, 2]), step7)).toBeNull()

    const step8 = FIRING_STEPS[7]
    expect(validateCoordinatedFire(entries([3, 3, 3]), step8)).toBeNull()
    // Three ships at Tactical Scan 2 cannot coordinate at all.
    expect(validateCoordinatedFire(entries([2, 2, 2]), FIRING_STEPS[6])).toMatch(/at most 2 ships/)
    expect(validateCoordinatedFire(entries([2, 2, 2]), step8)).toMatch(/Tactical Scan 2; 3 is required/)
  })

  it('fires on the step set by the group’s highest scan level (H4.5.5)', () => {
    // The worked example: ship A at 2 and ship B at 3 fire together on step 8.
    expect(validateCoordinatedFire(entries([2, 3]), FIRING_STEPS[7])).toBeNull()
    expect(validateCoordinatedFire(entries([2, 3]), FIRING_STEPS[6])).toMatch(/fires on step 8/)
  })

  it('never lets a group fire earlier than its plotted level (H4.5.4)', () => {
    // Two ships at Tactical Scan 3 wait for step 8; they may not take step 7.
    expect(validateCoordinatedFire(entries([3, 3]), FIRING_STEPS[6])).toMatch(/fires on step 8/)
    expect(validateCoordinatedFire(entries([3, 3]), FIRING_STEPS[7])).toBeNull()
  })

  it('bars coordinated fire from the individual steps (H4.2.4)', () => {
    expect(validateCoordinatedFire(entries([3, 3]), FIRING_STEPS[2])).toMatch(/Individual Offensive Fire steps/)
  })

  it('lets a lone ship take a coordinated step (H4.2.4)', () => {
    expect(validateCoordinatedFire(entries([3]), FIRING_STEPS[7])).toBeNull()
    expect(mayFireAlone(FIRING_STEPS[7], 3)).toBe(true)
    // …but only on the step matching its own level.
    expect(mayFireAlone(FIRING_STEPS[6], 3)).toBe(false)
    // A ship with fewer than two scan points has no coordinated step at all.
    expect(mayFireAlone(FIRING_STEPS[6], 1)).toBe(false)
    expect(coordinatedStepFor(1)).toBeNull()
  })

  it('refuses to coordinate ships of different factions (H4.5)', () => {
    const mixed = [
      { ship: ship({ id: 'blue', side: 'Blue' }), scan: 2 },
      { ship: ship({ id: 'red', side: 'Red' }), scan: 2 },
    ]
    expect(validateCoordinatedFire(mixed, FIRING_STEPS[6])).toMatch(/same faction/)
  })

  it('caps step 10 by the scan-per-ship requirement rather than a ship count (H4.5.3)', () => {
    expect(validateCoordinatedFire(entries([5, 5, 5, 5, 5]), FIRING_STEPS[9])).toBeNull()
    // A sixth ship needs six points each, which step 10 still covers.
    expect(validateCoordinatedFire(entries([5, 5, 5, 5, 5, 5]), FIRING_STEPS[9])).toMatch(/6 is required/)
    expect(validateCoordinatedFire(entries([6, 6, 6, 6, 6, 6]), FIRING_STEPS[9])).toBeNull()
  })
})

describe('one attack per phase (H4.3)', () => {
  it('lets one faction attack a ship only once per combat phase (H4.3.1)', () => {
    const target = ship({ id: 'target', side: 'Red' })
    const attacked = new Set<string>()
    expect(checkOneAttackPerPhase('Blue', target, attacked)).toBeNull()
    attacked.add('Blue->target')
    expect(checkOneAttackPerPhase('Blue', target, attacked)).toMatch(/already been attacked/)
    // A different faction is unaffected.
    expect(checkOneAttackPerPhase('Green', target, attacked)).toBeNull()
  })

  it('forbids firing on your own ships (H4.3.2)', () => {
    const friend = ship({ id: 'friend', side: 'Blue' })
    expect(checkOneAttackPerPhase('Blue', friend, new Set())).toMatch(/own ships/)
  })

  it('clears attack markers when the Combat Segment ends (H4.3.1)', () => {
    const blue = ship({ id: 'blue-1' })
    const red = ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 10 })
    const game = createGame({
      scenario: THE_DUEL,
      ships: [blue, red],
      seed: 5,
      coordinatedFire: true,
    })
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'combat')

    expect(attackAllowed(game, blue, red)).toBeNull()
    recordAttack(game, blue, red)
    expect(attackAllowed(game, blue, red)).toMatch(/already been attacked/)

    advanceSegment(game) // end the Combat Segment
    expect(game.attackedThisPhase.size).toBe(0)
    expect(attackAllowed(game, blue, red)).toBeNull()
  })

  it('imposes no such limit when the optional rule is off (H4.1)', () => {
    const blue = ship({ id: 'blue-1' })
    const red = ship({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 10 })
    const game = createGame({ scenario: THE_DUEL, ships: [blue, red], seed: 5 })
    recordAttack(game, blue, red)
    expect(attackAllowed(game, blue, red)).toBeNull()
  })
})

describe('coordinated volleys (H4.6)', () => {
  it('refuses precision targeting to a coordinating ship (H4.6.2)', () => {
    const attacker = ship({ id: 'a' })
    const target = ship({ id: 'b', side: 'Red', form: VALLARI_CRUISER, y: -4 })
    const phaser = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!
    const index = 0
    attacker.mounts[phaser.id][index].armed = phaser.mounts[index].armingCircles

    const request = {
      attacker,
      target,
      mounts: [{ weaponId: phaser.id, mountIndex: index }],
      mode: 'precision' as const,
      precisionSection: 'weapons' as const,
    }
    // The same volley is legal on its own and illegal as part of a group.
    expect(resolveVolley({ ...request, coordinated: true }, ctx(), new Rng(1)).ok).toBe(false)
    expect(resolveVolley(request, ctx(), new Rng(1)).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The worked example from H4.7
// ---------------------------------------------------------------------------

describe('H4.7 worked example', () => {
  /**
   * "Ken has four ships labeled A, B, C, and D. His ships have a sensor rating
   * of three. Ship A is a dreadnought with 4 Command Points."
   */
  function kensForce(): { game: GameState; flag: ShipState; consorts: ShipState[] } {
    const flag = ship({ id: 'A', form: DREADNOUGHT })
    const consorts = [ship({ id: 'B', x: 6 }), ship({ id: 'C', x: 12 }), ship({ id: 'D', x: 18 })]
    const game = createGame({
      scenario: THE_DUEL,
      ships: [flag, ...consorts],
      seed: 11,
      coordinatedFire: true,
    })

    // Resource Allocation: GEN SYS to MAX, then one command point to each of
    // the four ships.
    setGenSysMax(flag)
    game.command['Blue'].commandShipId = 'A'
    for (const id of ['A', 'B', 'C', 'D']) setCommandAssignment(game.command['Blue'], game.ships, id, 1)
    // Command Segment: three sensor points to Tactical Scan on every ship.
    for (const s of game.ships) s.sensors.tacticalScan = 3

    return { game, flag, consorts }
  }

  it('puts all four ships at Tactical Scan 4, firing together on step 9', () => {
    const { game } = kensForce()
    for (const s of game.ships) expect(tacticalScanOf(game, s)).toBe(4)

    const entries = game.ships.map((s) => ({ ship: s, scan: tacticalScanOf(game, s) }))
    expect(coordinatedStepFor(4)!.index).toBe(9)
    expect(validateCoordinatedFire(entries, FIRING_STEPS[8])).toBeNull()
  })

  it('still fires the group on step 9 when one of the four is destroyed', () => {
    const { game, consorts } = kensForce()
    consorts[2].destroyed = true

    const survivors = game.ships
      .filter((s) => !s.destroyed)
      .map((s) => ({ ship: s, scan: tacticalScanOf(game, s) }))
    expect(survivors.map((e) => e.scan)).toEqual([4, 4, 4])
    expect(validateCoordinatedFire(survivors, FIRING_STEPS[8])).toBeNull()
  })

  it('drops the survivors to Tactical Scan 3 and step 8 when the dreadnought dies', () => {
    const { game, flag, consorts } = kensForce()
    flag.destroyed = true

    for (const s of consorts) expect(tacticalScanOf(game, s)).toBe(3)
    const entries = consorts.map((s) => ({ ship: s, scan: tacticalScanOf(game, s) }))
    expect(coordinatedStepFor(3)!.index).toBe(8)
    expect(validateCoordinatedFire(entries, FIRING_STEPS[7])).toBeNull()
    // "the three remaining ships can fire sooner than expected" — but not on 9.
    expect(validateCoordinatedFire(entries, FIRING_STEPS[8])).toMatch(/fires on step 8/)
  })

  it('costs one named ship its point when a CMND box is damaged', () => {
    const { game, flag, consorts } = kensForce()
    flag.systemDamage['CMND'] = 1
    // Ken names ship D as the one that loses the lent point.
    revokeCommandPoint(game.command['Blue'], 'D')

    expect(tacticalScanOf(game, consorts[2])).toBe(3)
    for (const s of [flag, consorts[0], consorts[1]]) expect(tacticalScanOf(game, s)).toBe(4)

    // D may now fire alone on step 3 or step 8; it may not join the step-9 group.
    expect(individualStepFor(3).index).toBe(3)
    expect(mayFireAlone(FIRING_STEPS[7], 3)).toBe(true)
    const mixed = [flag, consorts[0], consorts[1], consorts[2]].map((s) => ({
      ship: s,
      scan: tacticalScanOf(game, s),
    }))
    expect(validateCoordinatedFire(mixed, FIRING_STEPS[8])).toMatch(/4 is required/)
  })
})

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

// ---------------------------------------------------------------------------
// Squadron Engagement setup
// ---------------------------------------------------------------------------

describe('squadron engagement scenario', () => {
  it('fields three ships a side, each led by a command ship', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 2 })
    expect(game.ships.filter((s) => s.side === 'Blue Force')).toHaveLength(3)
    expect(game.ships.filter((s) => s.side === 'Red Force')).toHaveLength(3)
    for (const side of ['Blue Force', 'Red Force']) {
      const flagship = game.ships.find((s) => s.id === game.command[side].commandShipId)!
      expect(hasCommandSystems(flagship), side).toBe(true)
    }
  })

  it('designates the side’s largest command ship as flagship (H5.1.6)', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 2 })
    // The consorts carry no CMND boxes, so the lead ship is the only candidate.
    expect(game.command['Blue Force'].commandShipId).toBe('blue-1')
    expect(game.command['Red Force'].commandShipId).toBe('red-1')
  })

  it('carries the Coordinated Fire option into the game (H4.1)', () => {
    expect(startScenario('exp2-squadron-engagement', { seed: 2 }).coordinatedFire).toBe(false)
    expect(
      startScenario('exp2-squadron-engagement', { seed: 2, coordinatedFire: true }).coordinatedFire,
    ).toBe(true)
  })

  it('lets the flagship lend scan across the squadron once GEN SYS is at MAX (H5)', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 2, coordinatedFire: true })
    const [flag, second, third] = game.ships.filter((s) => s.side === 'Blue Force')

    expect(commandPointsAvailable(flag)).toBe(0)
    setGenSysMax(flag)
    expect(commandPointsAvailable(flag)).toBe(3)

    const state = game.command['Blue Force']
    expect(setCommandAssignment(state, game.ships, second.id, 1)).toBeNull()
    expect(setCommandAssignment(state, game.ships, third.id, 1)).toBeNull()
    for (const s of [second, third]) s.sensors.tacticalScan = 1
    expect(tacticalScanOf(game, second)).toBe(2)
    expect(tacticalScanOf(game, third)).toBe(2)

    // Both consorts can now coordinate on step 7 (H4.5.1).
    const entries = [second, third].map((s) => ({ ship: s, scan: tacticalScanOf(game, s) }))
    expect(validateCoordinatedFire(entries, FIRING_STEPS[6])).toBeNull()
  })
})
