import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { batteryPower, blueShieldRemaining, lineValue, type ShipState } from './shipState'
import { armingPointsAvailable } from './engineering'
import { accelerationBudget } from './navigation'
import type { GameState } from './game'

/**
 * Optional batteries (B2.5): stored power spent in the middle of a round.
 *
 * Under the printed rules a battery is only ever extra power at Resource
 * Allocation. These let a captain hold it back and spend it on something the
 * plan did not foresee — which is what a reserve is for.
 */

function battle(optionalBatteries = true): { game: GameState; ship: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed: 3, optionalBatteries })
  return { game, ship: game.ships[0] }
}

/** Wind the sequence on to the Command Segment of the first combat phase. */
function toCombatCommand(game: GameState): void {
  for (let i = 0; i < 20; i++) {
    if (game.phase === 'combat-1' && game.segment === 'command') return
    applyAction(game, { type: 'advance-segment' })
  }
  throw new Error('never reached a combat phase')
}

const lineOfKind = (ship: ShipState, kind: string) =>
  ship.form.functions.find((l) => l.kind === kind)!

describe('when battery power may be spent', () => {
  it('not at all unless the optional rules are in play', () => {
    const { game, ship } = battle(false)
    toCombatCommand(game)
    const refused = applyAction(game, {
      type: 'spend-battery',
      shipId: ship.id,
      lineId: lineOfKind(ship, 'accel').id,
    })
    expect(refused.message).toContain('B2.5')
    expect(batteryPower(ship)).toBeGreaterThan(0)
  })

  it('only during a combat phase’s Command Segment (B2.5.2)', () => {
    const { game, ship } = battle()
    // Still in the Engineering Phase: batteries are ordinary power here.
    const refused = applyAction(game, {
      type: 'spend-battery',
      shipId: ship.id,
      lineId: lineOfKind(ship, 'accel').id,
    })
    expect(refused.message).toContain('Command Segment')

    toCombatCommand(game)
    const allowed = applyAction(game, {
      type: 'spend-battery',
      shipId: ship.id,
      lineId: lineOfKind(ship, 'accel').id,
    })
    expect(allowed.message).toBeNull()
  })

  it('not from a battery that is already empty', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const accel = lineOfKind(ship, 'accel').id
    for (let i = 0; i < ship.batteryCharged.length; i++) {
      expect(applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: accel }).message)
        .toBeNull()
    }
    expect(batteryPower(ship)).toBe(0)
    expect(
      applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: accel }).message,
    ).toContain('No charged battery')
  })
})

describe('what the power does', () => {
  it('buys acceleration the round did not plan for (B2.5.4)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const before = accelerationBudget(ship)
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: lineOfKind(ship, 'accel').id })
    expect(accelerationBudget(ship)).toBeGreaterThan(before)
    expect(batteryPower(ship)).toBe(0)
  })

  it('rearms a weapon mid-round, which is the point of the rule (B2.5.6)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const line = ship.form.functions.find(
      (l) => l.kind === 'weapon' && l.steps.length > 0 &&
        !(ship.form.weapons.find((w) => w.id === l.weaponSystemId)?.traits ?? []).includes('NoBAT'),
    )!
    const before = armingPointsAvailable(ship, line.weaponSystemId!)
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: line.id })
    expect(armingPointsAvailable(ship, line.weaponSystemId!)).toBeGreaterThan(before)
  })

  it('repairs a shield on the spot, not at the next commit (B2.5.8)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const repair = ship.form.functions.find((l) => l.kind === 'shield-repair' && l.shieldSide === 'F')!
    ship.blueShieldDamage.F = 6
    const before = blueShieldRemaining(ship, 'F')
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: repair.id })
    expect(blueShieldRemaining(ship, 'F')).toBeGreaterThan(before)
  })

  it('reinforces a shield that has not been reinforced already (B2.5.7)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const rnfc = ship.form.functions.find((l) => l.kind === 'shield-reinforce' && l.shieldSide === 'F')!
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: rnfc.id })
    expect(ship.greenShieldActive.F).toBeGreaterThan(0)

    // A circle is never filled twice (B2.5.3, B2.5.7) — even with power to spare.
    ship.batteryCharged[0] = true
    const twice = applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: rnfc.id })
    expect(twice.message).toContain('already')
  })

  it('brings general systems to MAX (B2.5.10)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const gen = lineOfKind(ship, 'gen-sys')
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: gen.id })
    expect(ship.genSysLevel).toBe('max')
  })
})

describe('what the power may not do', () => {
  it('arm a slow-loading heavy during a combat phase (B2.5.6)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const torpedo = ship.form.functions.find((l) => {
      const weapon = ship.form.weapons.find((w) => w.id === l.weaponSystemId)
      return l.kind === 'weapon' && weapon && weapon.traits.includes('NoBAT')
    })
    if (!torpedo) return
    const refused = applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: torpedo.id })
    expect(refused.message).toMatch(/NoBAT|more than a round/)
  })

  it('recharge a battery — that is reactor work, at Step A (B2.5.1)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const recharge = ship.form.functions.find((l) => l.kind === 'battery-recharge')
    if (!recharge) return
    const refused = applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: recharge.id })
    expect(refused.message).toContain('reactor power')
    expect(batteryPower(ship)).toBeGreaterThan(0)
  })

  it('overfill a line that is already at full power (B2.5.3)', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const accel = lineOfKind(ship, 'accel')
    ship.allocation[accel.id] = accel.steps.length
    const refused = applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: accel.id })
    expect(refused.message).toContain('full power')
  })
})

describe('the battery ledger', () => {
  it('stays spent until it is recharged, and the round’s reset does not refill it', () => {
    const { game, ship } = battle()
    toCombatCommand(game)
    const accel = lineOfKind(ship, 'accel')
    applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: accel.id })
    expect(batteryPower(ship)).toBe(0)
    expect(lineValue(ship, accel.id)).toBeGreaterThan(0)

    // Round the sequence over into the next Engineering Phase.
    for (let i = 0; i < 40 && game.round === 1; i++) applyAction(game, { type: 'advance-segment' })
    expect(game.round).toBe(2)
    // The circle is gone with the round; the battery is still empty (B2.4.1).
    expect(ship.allocation[accel.id] ?? 0).toBe(0)
    expect(batteryPower(ship)).toBe(0)
  })

  it('replays exactly from the journal', () => {
    const spend = (game: GameState, ship: ShipState) => {
      toCombatCommand(game)
      applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: lineOfKind(ship, 'sif').id })
    }
    const a = battle()
    spend(a.game, a.ship)
    const b = battle()
    spend(b.game, b.ship)
    expect(b.ship.allocation).toEqual(a.ship.allocation)
    expect(b.ship.batteryCharged).toEqual(a.ship.batteryCharged)
  })
})

describe('rearming a fired weapon (B2.5.6)', () => {
  const phaserOf = (ship: ShipState) => ship.form.weapons.find((w) => w.weaponClass === 'phaser')!
  const lineFor = (ship: ShipState, weaponId: string) =>
    ship.form.functions.find((l) => l.weaponSystemId === weaponId)!

  it('arming points left unspent die with the Resource Allocation Segment (E4.2.10)', () => {
    const { game, ship } = battle()
    const weapon = phaserOf(ship)
    // The line's free points exist while the segment is open…
    expect(armingPointsAvailable(ship, weapon.id)).toBeGreaterThan(0)
    toCombatCommand(game)
    // …and are gone once it closes: the captain declined to spend them, and
    // they must not resurface when the battery rules open the arming controls.
    expect(armingPointsAvailable(ship, weapon.id)).toBe(0)
  })

  it('a battery buys fresh points mid-round and the mount spends them — the playtester’s phaser', () => {
    const { game, ship } = battle()
    const weapon = phaserOf(ship)
    const line = lineFor(ship, weapon.id)
    // Resource Allocation: one circle of power to the phasers, mount 0 armed.
    applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line.id, circles: 1 })
    for (let guard = 0; ship.mounts[weapon.id][0].armed < weapon.mounts[0].armingCircles; guard++) {
      if (guard > 8) throw new Error('mount never armed')
      applyAction(game, { type: 'arm-mount', shipId: ship.id, weaponId: weapon.id, mountIndex: 0 })
    }
    toCombatCommand(game)
    // The phaser fired — stand in for the volley by emptying the circles the
    // shot consumed.
    ship.mounts[weapon.id][0].armed = 0

    // B2.5.2: battery power to the phaser line during a Command Segment…
    expect(
      applyAction(game, { type: 'spend-battery', shipId: ship.id, lineId: line.id }).message,
    ).toBeNull()
    // …buys points that are spendable right now (B2.5.6: "a weapon that has
    // been fired may even be rearmed and potentially fired again")…
    expect(armingPointsAvailable(ship, weapon.id)).toBeGreaterThan(0)
    expect(
      applyAction(game, { type: 'arm-mount', shipId: ship.id, weaponId: weapon.id, mountIndex: 0 })
        .message,
    ).toBeNull()
    expect(ship.mounts[weapon.id][0].armed).toBe(1)
  })
})
