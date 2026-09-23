import { describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import {
  autoChoices,
  checkDestruction,
  newDeck,
  scriptedChoices,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  decisionFor,
  hitIsAvailable,
  resolveCard,
  type DamageContext,
} from './damage'
import { Rng } from './dice'
import {
  commitAllocation,
  repairTargets,
  resolveDamageControl,
  setAllocation,
  validateAllocation,
  type RepairAssignment,
} from './engineering'
import { advanceSegment, fullDisengagementOptions, type GameState } from './game'
import { disengagementOptions } from './navigation'
import { createShip, findLine, mainReactorBoxes, markStructure, undamagedSystemBoxes, type ShipState } from './shipState'
import type { DamageCard } from './types'

/**
 * Findings from the rules-conformance audit (audit/B.md, audit/E-damage.md,
 * audit/JK.md) that touch player-action validation, engineering and damage.
 *
 * Every fix here that turns a previously *accepted* action into a refusal,
 * or changes a resolution outcome, is gated to `rulesVersion >= 3` — a
 * saved battle is a journal of actions (including refused ones), and it
 * replays under the reading it was fought at (see CURRENT_RULES_VERSION in
 * savedGame.ts). Tests that exercise the new behaviour build their game at
 * rulesVersion 3; a sibling test usually confirms the old reading still
 * replays unchanged.
 */

function makeShip(overrides: Partial<Parameters<typeof createShip>[0]> = {}): ShipState {
  return createShip({
    id: 'test',
    side: 'Blue',
    name: 'Test Ship',
    form: YORKTOWN,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 4,
    ...overrides,
  })
}

function makeContext(rulesVersion?: number): DamageContext {
  const rng = new Rng(1234)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {}, rulesVersion }
}

const card = (primary: DamageCard['primary'], alt?: DamageCard['alt']): DamageCard => ({
  id: 'c',
  category: 'general',
  primary,
  alt,
  stressIcon: false,
})

function toSegment(game: GameState, phase: string, segment: string): void {
  for (let i = 0; i < 200 && !(game.phase === phase && game.segment === segment); i++) {
    advanceSegment(game)
  }
  expect(game.phase).toBe(phase)
  expect(game.segment).toBe(segment)
}

// ---------------------------------------------------------------------------
// A3/B2 — allocate and arm-mount need the Resource Allocation Segment
// ---------------------------------------------------------------------------

describe('allocate is scoped to Resource Allocation (A3.2.1, B2.1.1)', () => {
  it('refuses a mid-round allocation at rules reading 3', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 3 })
    const ship = game.ships[0]
    const line = ship.form.functions.find((l) => l.kind === 'accel')!
    toSegment(game, 'combat-1', 'navigation')
    const before = ship.allocation[line.id] ?? 0
    const result = applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: before + 1 })
    expect(result.message).toMatch(/resource allocation/i)
    expect(ship.allocation[line.id] ?? 0).toBe(before)
  })

  it('still allows it outside the segment under the old reading, so old journals replay unchanged', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 2 })
    const ship = game.ships[0]
    const line = ship.form.functions.find((l) => l.kind === 'accel')!
    toSegment(game, 'combat-1', 'navigation')
    const before = ship.allocation[line.id] ?? 0
    const result = applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: before + 1 })
    expect(result.message).toBeNull()
    expect(ship.allocation[line.id]).toBe(before + 1)
  })
})

describe('arm-mount is scoped the same way, with the battery carve-out (B2.2, B2.5.6)', () => {
  it('refuses arming outside Resource Allocation or a battery Command Segment', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 3, optionalBatteries: false })
    const ship = game.ships[0]
    const weapon = ship.form.weapons[0]
    toSegment(game, 'combat-1', 'navigation')
    const result = applyAction(game, {
      type: 'arm-mount',
      shipId: ship.id,
      weaponId: weapon.id,
      mountIndex: 0,
    })
    expect(result.message).toMatch(/Resource Allocation/)
  })
})

// ---------------------------------------------------------------------------
// A3/B3 — damage-control needs the Damage Control Segment
// ---------------------------------------------------------------------------

describe('damage-control is scoped to the Damage Control Segment (A3.2.2, B3.2)', () => {
  it('refuses a roll taken after seeing a later Combat Phase, at rules reading 3', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 3 })
    const ship = game.ships[0]
    markStructure(ship)
    toSegment(game, 'combat-1', 'navigation')
    const result = applyAction(game, { type: 'damage-control', shipId: ship.id, assignments: [] })
    expect(result.message).toMatch(/Damage control/)
    expect(result.message).toMatch(/B3\.2/)
  })

  it('still accepts it outside the segment under the old reading', () => {
    const game = startScenario('s3.1-the-duel', { seed: 1, rulesVersion: 2 })
    const ship = game.ships[0]
    toSegment(game, 'combat-1', 'navigation')
    const result = applyAction(game, { type: 'damage-control', shipId: ship.id, assignments: [] })
    expect(result.message).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// B3.2 Step 3 — one repair per category, however the dice are split
// ---------------------------------------------------------------------------

describe('resolveDamageControl caps repairs to one target per category (B3.2 Step 3)', () => {
  function twoWoundedMounts(): { ship: ShipState; weaponId: string } {
    const ship = makeShip()
    const weapon = ship.form.weapons.find((w) => (ship.mounts[w.id]?.length ?? 0) >= 2)!
    ship.mounts[weapon.id][0].damage = 1
    ship.mounts[weapon.id][1].damage = 1
    return { ship, weaponId: weapon.id }
  }

  it('repairs only one of two same-category assignments at rules reading 3', () => {
    let sawSuccess = false
    for (let seed = 0; seed < 60 && !sawSuccess; seed++) {
      const { ship, weaponId } = twoWoundedMounts()
      const targets = repairTargets(ship).filter((t) => t.category === 'weapons')
      const assignments: RepairAssignment[] = targets.map((t) => ({
        category: 'weapons',
        dice: 2,
        targetKey: t.key,
      }))
      const outcomes = resolveDamageControl(ship, assignments, new Rng(seed), () => {}, 3)
      const stillDamaged = [0, 1].filter((i) => ship.mounts[weaponId][i].damage > 0).length
      if (outcomes.some((o) => o.success)) {
        sawSuccess = true
        // Two mounts started damaged; at most one may come back (B3.2 Step 3).
        expect(stillDamaged).toBeGreaterThanOrEqual(1)
      }
    }
    expect(sawSuccess).toBe(true)
  })

  it('the pre-reading-3 engine has the gap: both can repair from one call', () => {
    let sawBoth = false
    for (let seed = 0; seed < 200 && !sawBoth; seed++) {
      const { ship, weaponId } = twoWoundedMounts()
      const targets = repairTargets(ship).filter((t) => t.category === 'weapons')
      const assignments: RepairAssignment[] = targets.map((t) => ({
        category: 'weapons',
        dice: 2,
        targetKey: t.key,
      }))
      // No rulesVersion passed — defaults to the old (uncapped) behaviour.
      resolveDamageControl(ship, assignments, new Rng(seed), () => {})
      const stillDamaged = [0, 1].filter((i) => ship.mounts[weaponId][i].damage > 0).length
      if (stillDamaged === 0) sawBoth = true
    }
    expect(sawBoth).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B2.2.10 — dead "GEN SYS must reach NRM before MAX" branch
// ---------------------------------------------------------------------------

describe('validateAllocation and General Systems (B2.2.10)', () => {
  it('never flags a validly-powered GEN SYS line (the removed branch was unreachable dead code)', () => {
    const ship = makeShip()
    const gen = findLine(ship.form, 'gen-sys')!
    expect(setAllocation(ship, gen.id, gen.steps.length)).toBeNull()
    expect(validateAllocation(ship).some((e) => e.lineId === gen.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E11.2.4 — arming points and stored power are lost on going derelict
// ---------------------------------------------------------------------------

describe('going derelict clears arming and battery charge (E11.2.4)', () => {
  function crippledShip(): ShipState {
    const ship = makeShip()
    const weapon = ship.form.weapons[0]
    ship.mounts[weapon.id][0].armed = 1
    ship.batteryCharged[0] = true
    for (let i = 0; i < 40; i++) if (!markStructure(ship)) break
    return ship
  }

  it('zeroes armed mounts and charged batteries at rules reading 3', () => {
    setDestructionOptions({ ...STANDARD_DESTRUCTION, derelicts: true })
    const ship = crippledShip()
    checkDestruction(ship, makeContext(3))
    expect(ship.derelict).toBe(true)
    expect(ship.mounts[ship.form.weapons[0].id][0].armed).toBe(0)
    expect(ship.batteryCharged[0]).toBe(false)
    setDestructionOptions(STANDARD_DESTRUCTION)
  })

  it('leaves them alone under the old reading, so old journals replay unchanged', () => {
    setDestructionOptions({ ...STANDARD_DESTRUCTION, derelicts: true })
    const ship = crippledShip()
    checkDestruction(ship, makeContext())
    expect(ship.derelict).toBe(true)
    expect(ship.mounts[ship.form.weapons[0].id][0].armed).toBe(1)
    expect(ship.batteryCharged[0]).toBe(true)
    setDestructionOptions(STANDARD_DESTRUCTION)
  })
})

// ---------------------------------------------------------------------------
// E8.4.10 — Quarters: QTRS is the default, but CRGO/SPCL are a real choice
// ---------------------------------------------------------------------------

describe('a Quarters hit offers CRGO/SPCL alongside QTRS (E8.4.10)', () => {
  it('lists every undamaged target as a legal answer', () => {
    const ship = makeShip()
    // The Yorktown carries no SPCL box, so only QTRS and CRGO are legal here.
    const decision = decisionFor(ship, 'quarters')
    expect(decision.options.map((o) => (o.choice.kind === 'quarters' ? o.choice.target : null)).sort()).toEqual([
      'CRGO',
      'QTRS',
    ])
    // The doctrine still defaults to QTRS — no ship gets worse play by default.
    expect(decision.options.find((o) => o.recommended)?.label).toBe('QTRS')
  })

  it('honours a scripted CRGO pick even with QTRS boxes free, at rules reading 3', () => {
    const ship = makeShip()
    expect(undamagedSystemBoxes(ship, 'QTRS')).toBeGreaterThan(0)
    const ctx: DamageContext = {
      ...makeContext(3),
      choices: scriptedChoices([{ kind: 'quarters', target: 'CRGO' }]),
    }
    const before = { QTRS: undamagedSystemBoxes(ship, 'QTRS'), CRGO: undamagedSystemBoxes(ship, 'CRGO') }
    resolveCard(ship, card('quarters'), ctx)
    expect(undamagedSystemBoxes(ship, 'QTRS')).toBe(before.QTRS) // untouched
    expect(undamagedSystemBoxes(ship, 'CRGO')).toBe(before.CRGO - 1)
  })

  it('always marks QTRS first under the old reading, ignoring any script', () => {
    const ship = makeShip()
    const ctx: DamageContext = {
      ...makeContext(),
      choices: scriptedChoices([{ kind: 'quarters', target: 'CRGO' }]),
    }
    const before = undamagedSystemBoxes(ship, 'QTRS')
    resolveCard(ship, card('quarters'), ctx)
    expect(undamagedSystemBoxes(ship, 'QTRS')).toBe(before - 1)
  })
})

// ---------------------------------------------------------------------------
// J11.2.2 — a Special System Hit may fall on Cargo
// ---------------------------------------------------------------------------

describe('a Special System Hit can reach Cargo once SPCL/PROB/CMND are gone (J11.2.2)', () => {
  it('is available against CRGO at rules reading 3', () => {
    const ship = makeShip()
    // The Yorktown carries no SPCL, PROB or CMND boxes.
    expect(ship.form.systems.some((g) => ['SPCL', 'PROB', 'CMND'].includes(g.kind))).toBe(false)
    const before = undamagedSystemBoxes(ship, 'CRGO')
    expect(before).toBeGreaterThan(0)
    const ctx = makeContext(3)
    expect(hitIsAvailable(ship, 'special-system', ctx)).toBe(true)
    resolveCard(ship, card('special-system'), ctx)
    expect(undamagedSystemBoxes(ship, 'CRGO')).toBe(before - 1)
  })

  it('has nowhere to land under the old reading', () => {
    const ship = makeShip()
    const ctx = makeContext()
    expect(hitIsAvailable(ship, 'special-system', ctx)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// J9 — the disengage action now enforces every J9 condition
// ---------------------------------------------------------------------------

describe('the disengage action is validated against J9 (rules reading 3)', () => {
  it('refuses a disengage outside the Disengagement Segment', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2, rulesVersion: 3 })
    const ship = game.ships[0]
    const result = applyAction(game, { type: 'disengage', shipId: ship.id })
    expect(result.message).toMatch(/Disengagement/)
    expect(ship.disengaged).toBe(false)
  })

  it('refuses a disengage with no legal J9 route', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2, rulesVersion: 3 })
    const ship = game.ships[0]
    toSegment(game, 'final', 'disengagement')
    // Freshly deployed, close together, FTL unpowered: nothing qualifies.
    expect(fullDisengagementOptions(game, ship)).toHaveLength(0)
    const result = applyAction(game, { type: 'disengage', shipId: ship.id })
    expect(result.message).toMatch(/no route out/)
    expect(ship.disengaged).toBe(false)
  })

  it('accepts a disengage once a J9 route is actually open', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2, rulesVersion: 3 })
    const ship = game.ships[0]
    const enemy = game.ships.find((s) => s.side !== ship.side)!
    toSegment(game, 'final', 'disengagement')
    // J9.2.5: 36 inches or more from the nearest enemy.
    ship.placement.position = { x: enemy.placement.position.x + 100, y: enemy.placement.position.y }
    expect(fullDisengagementOptions(game, ship).length).toBeGreaterThan(0)
    const result = applyAction(game, { type: 'disengage', shipId: ship.id })
    expect(result.message).toBeNull()
    expect(ship.disengaged).toBe(true)
  })

  it('still lets the old reading disengage on request, in any segment', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2, rulesVersion: 2 })
    const ship = game.ships[0]
    const result = applyAction(game, { type: 'disengage', shipId: ship.id })
    expect(result.message).toBeNull()
    expect(ship.disengaged).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// J9.1.3 — FTL disengagement re-checked against current reactor boxes
// ---------------------------------------------------------------------------

describe('FTL disengagement re-checks main reactor boxes (J9.1.3)', () => {
  function poweredForFtl(): ShipState {
    const ship = makeShip()
    const ftl = findLine(ship.form, 'ftl-drive')!
    setAllocation(ship, ftl.id, ftl.steps.length)
    commitAllocation(ship)
    return ship
  }

  it('is offered while enough main reactor boxes remain', () => {
    const ship = poweredForFtl()
    const options = disengagementOptions(ship, [], { width: 100, height: 100, fixed: false }, true, true)
    expect(options).toContain('FTL disengagement (J9.1)')
  })

  it('is withdrawn once combat damage takes reactors below the filled FTL circles', () => {
    const ship = poweredForFtl()
    const filled = ship.allocation[findLine(ship.form, 'ftl-drive')!.id]!
    // Damage every main reactor point but one — fewer boxes than filled circles.
    for (const group of ship.form.reactors) {
      if (group.hitKind !== 'left-main' && group.hitKind !== 'right-main') continue
      ship.reactorDamage[group.id] = group.points.map((p) => p.boxes)
    }
    ship.reactorDamage[ship.form.reactors.find((g) => g.hitKind === 'left-main')!.id][0] = 0
    expect(mainReactorBoxes(ship)).toBeLessThan(filled)
    const options = disengagementOptions(ship, [], { width: 100, height: 100, fixed: false }, true, true)
    expect(options).not.toContain('FTL disengagement (J9.1)')
  })

  it('is not checked unless a caller opts in, so old callers are unaffected', () => {
    const ship = poweredForFtl()
    for (const group of ship.form.reactors) {
      ship.reactorDamage[group.id] = group.points.map((p) => p.boxes)
    }
    expect(mainReactorBoxes(ship)).toBe(0)
    // checkReactorPower defaults to false.
    const options = disengagementOptions(ship, [], { width: 100, height: 100, fixed: false })
    expect(options).toContain('FTL disengagement (J9.1)')
  })
})
