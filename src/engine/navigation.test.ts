import { describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'
import { autoChoices, newDeck, type DamageContext } from './damage'
import { Rng } from './dice'
import { commitAllocation, setAllocation } from './engineering'
import {
  accelerationStress,
  clampAccel,
  disengagementOptions,
  executeMovement,
  resolveStressCheck,
  validatePlot,
} from './navigation'
import { createShip, currentMaxSpeed, maxReverseSpeed, turnTemplateAt, type ShipState } from './shipState'
import type { CommandCard } from './types'

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

function ctx(seed = 42): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

describe('turn templates (C2.2.2)', () => {
  it('reads the TURN line for the ship\'s current speed', () => {
    const ship = makeShip()
    YORKTOWN.sublight.turnBySpeed.forEach((degrees, speed) => {
      expect(turnTemplateAt(ship, speed)).toBe(degrees)
    })
    // Tighter turns are available at lower speed, and none at the top.
    expect(turnTemplateAt(ship, 0)).toBeGreaterThan(turnTemplateAt(ship, YORKTOWN.sublight.maxSpeed - 1))
    expect(turnTemplateAt(ship, YORKTOWN.sublight.maxSpeed)).toBe(0)
  })
})

describe('plot validation (C1)', () => {
  it('enforces the per-phase acceleration limit (C1.2.5)', () => {
    const ship = makeShip()
    setAllocation(ship, 'accel', YORKTOWN.functions.find((l) => l.kind === 'accel')!.steps.length)
    commitAllocation(ship)
    const errors = validatePlot(ship, card({ accel: 3, speed: 7 }))
    expect(errors.some((e) => /per phase/.test(e.message))).toBe(true)
  })

  it('enforces the round acceleration budget (C1.2.3)', () => {
    const ship = makeShip()
    commitAllocation(ship) // free power only → 1 acceleration point
    ship.accelUsedThisRound = 1
    const errors = validatePlot(ship, card({ accel: 1, speed: 5 }))
    expect(errors.some((e) => /acceleration points remain/.test(e.message))).toBe(true)
  })

  it('caps speed at the ship maximum (C1.2.7)', () => {
    const ship = makeShip()
    setAllocation(ship, 'accel', YORKTOWN.functions.find((l) => l.kind === 'accel')!.steps.length)
    commitAllocation(ship)
    const errors = validatePlot(ship, card({ accel: 2, speed: YORKTOWN.sublight.maxSpeed + 2 }))
    expect(errors.some((e) => /exceeds current maximum/.test(e.message))).toBe(true)
  })

  it('caps reverse at half maximum speed, rounded down (C3.7.3)', () => {
    const ship = makeShip()
    expect(maxReverseSpeed(ship)).toBe(Math.floor(YORKTOWN.sublight.maxSpeed / 2))
    setAllocation(ship, 'accel', YORKTOWN.functions.find((l) => l.kind === 'accel')!.steps.length)
    commitAllocation(ship)
    const errors = validatePlot(ship, card({ accel: 2, speed: -(maxReverseSpeed(ship) + 1) }))
    expect(errors.some((e) => /Reverse speed limited/.test(e.message))).toBe(true)
  })

  it('requires EMER power for an emergency turn (C3.5.2)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    const errors = validatePlot(ship, card({ maneuver: 'em-90', direction: 'left' }))
    expect(errors.some((e) => /EMER/.test(e.message))).toBe(true)

    setAllocation(ship, 'emer', 1)
    commitAllocation(ship)
    expect(validatePlot(ship, card({ maneuver: 'em-90', direction: 'left' })).some((e) => /EMER/.test(e.message))).toBe(
      false,
    )
  })

  it('allows only one emergency turn per round (C3.5.4)', () => {
    const ship = makeShip()
    setAllocation(ship, 'emer', 1)
    commitAllocation(ship)
    ship.emergencyTurnUsed = true
    const errors = validatePlot(ship, card({ maneuver: 'em-180', direction: 'left' }))
    expect(errors.some((e) => /one emergency turn/.test(e.message))).toBe(true)
  })
})

/*
 * The clamp behind both the plot and the resolution. Validation alone was not
 * enough: the plot accepted any figure, the error sat in a list nothing read
 * at resolution, and the ship accelerated anyway — a card could end the round
 * reading "2 of 1 acceleration points used".
 */
describe('the acceleration clamp (C1.2.3, C1.2.5)', () => {
  it('cuts the plot to the points still unspent this round', () => {
    const ship = makeShip()
    commitAllocation(ship) // free power only → 1 acceleration point
    expect(clampAccel(ship, 2)).toBe(1)
    ship.accelUsedThisRound = 1
    expect(clampAccel(ship, 1)).toBe(0)
  })

  it('brakes on the same budget, sign preserved', () => {
    const ship = makeShip()
    commitAllocation(ship)
    expect(clampAccel(ship, -3)).toBe(-1)
  })

  it('cuts to the per-phase limit even with a full round budget', () => {
    const ship = makeShip()
    setAllocation(ship, 'accel', YORKTOWN.functions.find((l) => l.kind === 'accel')!.steps.length)
    commitAllocation(ship)
    const most = YORKTOWN.sublight.maxAccelPerPhase
    expect(clampAccel(ship, most + 2)).toBe(most)
  })

  it('never lets execution book more points than the round generated', () => {
    const ship = makeShip()
    commitAllocation(ship) // 1 point
    // An over-plotted card, as an old journal or a buggy client might carry.
    executeMovement(ship, card({ accel: 2, speed: 6 }))
    expect(ship.accelUsedThisRound).toBe(1)
    // The unpaid point never lands: speed rises by the single paid point.
    expect(ship.speed).toBe(5)
  })
})

describe('movement execution', () => {
  it('applies the plotted speed and records maneuver stress (C3.2.3)', () => {
    const ship = makeShip()
    setAllocation(ship, 'accel', YORKTOWN.functions.find((l) => l.kind === 'accel')!.steps.length)
    commitAllocation(ship)
    const result = executeMovement(ship, card({ maneuver: 'hard', direction: 'right', accel: 0, speed: 4 }))
    expect(result.stress).toBe(1)
    expect(ship.stressMarkers).toBe(1)
    // A hard turn is two standard turns in the same direction (C3.2.2).
    expect(ship.placement.heading).toBe(YORKTOWN.sublight.turnBySpeed[4] * 2)
  })

  it('clamps speed to the damaged drive maximum (C4.2.1)', () => {
    const ship = makeShip(YORKTOWN.sublight.maxSpeed)
    ship.systemDamage['__sublight'] = 3
    const capped = YORKTOWN.sublight.dmgTopSpeed[2]
    expect(currentMaxSpeed(ship)).toBe(capped)
    executeMovement(ship, card({ speed: YORKTOWN.sublight.maxSpeed }))
    expect(ship.speed).toBe(capped)
  })

  it('holds the ship still during an emergency stop (C3.8.2)', () => {
    const ship = makeShip()
    ship.emergencyStopPhases = 2
    executeMovement(ship, card({ speed: 4, maneuver: 'standard', direction: 'right' }))
    expect(ship.speed).toBe(0)
    expect(ship.placement.position).toEqual({ x: 18, y: 18 })
    expect(ship.emergencyStopPhases).toBe(1)
  })
})

describe('acceleration stress (C1.2.6)', () => {
  it('charges one stress per point past the safe limit', () => {
    const ship = makeShip()
    const safe = YORKTOWN.sublight.safeAccelPerRound
    ship.accelUsedThisRound = safe
    expect(accelerationStress(ship)).toBe(0)
    ship.accelUsedThisRound = safe + 1
    expect(accelerationStress(ship)).toBe(1)
    ship.accelUsedThisRound = safe + 2
    expect(accelerationStress(ship)).toBe(2)
  })
})

describe('stress check (C3.1.3)', () => {
  it('cancels stress with the SIF before rolling (C3.1.1)', () => {
    const ship = makeShip()
    setAllocation(ship, 'sif', 2) // two circles → SIF cancels 2 stress
    commitAllocation(ship)
    ship.stressMarkers = 3

    const result = resolveStressCheck(ship, ctx())
    expect(result.markersBefore).toBe(3)
    expect(result.canceledBySif).toBe(2)
    expect(result.checksResolved).toBe(1)
    expect(ship.stressMarkers).toBe(0)
  })

  it('draws cards equal to the Stress Rating for each check (C3.1.3 Step 4)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    ship.stressMarkers = 2
    const result = resolveStressCheck(ship, ctx(7))
    expect(result.checks).toHaveLength(2)
    for (const check of result.checks) {
      expect(check.cards).toHaveLength(YORKTOWN.stressRating)
    }
  })

  it('folds acceleration stress into the check (C1.2.6)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    ship.accelUsedThisRound = YORKTOWN.sublight.safeAccelPerRound + 2
    const result = resolveStressCheck(ship, ctx())
    expect(result.markersBefore).toBe(2)
  })

  it('applies exactly one Stress Damage card per check, or none (C3.1.4)', () => {
    // Sweep seeds so both outcomes — icon drawn and not drawn — are exercised.
    let sawDamage = 0
    let sawClean = 0
    for (let seed = 0; seed < 30; seed++) {
      const ship = makeShip()
      commitAllocation(ship)
      ship.stressMarkers = 1
      const check = resolveStressCheck(ship, ctx(seed)).checks[0]
      const iconCards = check.cards.filter((c) => c.stressIcon)

      if (iconCards.length === 0) {
        expect(check.stressCard).toBeNull()
        sawClean += 1
      } else {
        // Exactly one of the drawn icon cards is applied, never more (C3.1.4).
        expect(check.stressCard).not.toBeNull()
        expect(iconCards).toContain(check.stressCard)
        sawDamage += 1
      }
    }
    expect(sawDamage).toBeGreaterThan(0)
    expect(sawClean).toBeGreaterThan(0)
  })
})

describe('disengagement (J9)', () => {
  it('offers FTL disengagement only with a fully powered drive (J9.1.3)', () => {
    const ship = makeShip()
    const enemy = makeShip()
    enemy.placement = { position: { x: 20, y: 18 }, heading: 0 }

    commitAllocation(ship)
    expect(disengagementOptions(ship, [enemy], { width: 36, height: 36, fixed: true })).toHaveLength(0)

    setAllocation(ship, 'ftl', YORKTOWN.functions.find((l) => l.kind === 'ftl-drive')!.steps.length)
    commitAllocation(ship)
    expect(disengagementOptions(ship, [enemy], { width: 36, height: 36, fixed: true })).toContain(
      'FTL disengagement (J9.1)',
    )
  })

  it('offers sublight disengagement at range 36 or more (J9.2.5)', () => {
    const ship = makeShip()
    const enemy = makeShip()
    enemy.placement = { position: { x: 18, y: -20 }, heading: 0 } // 38 inches away
    const options = disengagementOptions(ship, [enemy], { width: 36, height: 36, fixed: false })
    expect(options.some((o) => /distance/.test(o))).toBe(true)
  })

  it('disengages a ship that leaves a fixed map (J9.2.2)', () => {
    const ship = makeShip()
    ship.placement = { position: { x: -1, y: 18 }, heading: 0 }
    const enemy = makeShip()
    const options = disengagementOptions(ship, [enemy], { width: 36, height: 36, fixed: true })
    expect(options.some((o) => /Left the map/.test(o))).toBe(true)
  })
})
