import { afterEach, describe, expect, it } from 'vitest'
import { findShipForm } from '../data/ships'
import { Rng } from './dice'
import {
  autoChoices,
  checkDestruction,
  newDeck,
  resolveCard,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageContext,
} from './damage'
import { accelerationStress } from './navigation'
import { createShip, currentMaxSpeed, type ShipState } from './shipState'
import type { DamageCard } from './types'

/**
 * Deceleration from damage (C4.2, optional).
 *
 * A ship whose drive is shot below the speed it is making does not get to
 * choose whether to slow down, and the slowdown is charged to the same
 * per-round acceleration track a captain spends voluntarily — so it competes
 * with whatever they have already used, and everything past the green circles
 * comes back as stress at the check.
 *
 * The rulebook works the arithmetic through twice on the same ship. Those two
 * numbers are what these tests hold the engine to.
 */

const YORKTOWN = findShipForm('YORKTOWN IIIc-class Command Cruiser')!

const SUBLIGHT_CARD: DamageCard = {
  id: 'sublight',
  category: 'engineering',
  primary: 'sublight-drive',
  stressIcon: false,
}

function context(): DamageContext {
  const rng = new Rng(7)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

function ship(speed = 6): ShipState {
  return createShip({
    id: 'ship',
    side: 'Blue Force',
    name: 'U.S.S. TEST',
    form: YORKTOWN,
    placement: { position: { x: 20, y: 20 }, heading: 0 },
    speed,
  })
}

/** Land `n` sublight drive hits through the engine's own card resolution. */
function driveHits(target: ShipState, n: number): void {
  const ctx = context()
  for (let i = 0; i < n; i++) resolveCard(target, SUBLIGHT_CARD, ctx)
}

function withRule(on: boolean): void {
  setDestructionOptions({ ...STANDARD_DESTRUCTION, derelicts: true, decelerationFromDamage: on })
}

afterEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

describe('the rulebook’s worked example', () => {
  /*
   * "Our ship is traveling at a speed of 6. Later, our sublight drive is
   * damaged three times... the ship's new maximum speed is 2, resulting in the
   * ship slowing down from speed 6 to speed 2. The deceleration means that 4
   * circles are filled in the /ROUND portion... the ship suffers two stress
   * points."
   */
  it('slows 6 to 2 on three hits, and that is two stress', () => {
    withRule(true)
    const s = ship(6)
    // The example's ship has two green circles, which is what makes the
    // arithmetic come out at two stress rather than some other number.
    expect(s.form.sublight.safeAccelPerRound).toBe(2)

    driveHits(s, 3)

    expect(currentMaxSpeed(s)).toBe(2)
    expect(s.speed).toBe(2)
    expect(s.accelUsedThisRound).toBe(4)
    expect(accelerationStress(s)).toBe(2)
  })

  /*
   * "if the ship were to take 1 more point of damage to the sublight drive
   * during the same round, its new maximum speed would be 1... The ship would
   * slow from speed 6 to speed 1, suffering a total of 3 stress because it
   * decelerated by 5, and 2 of the circles were green."
   */
  it('a fourth hit the same round is 5 of deceleration and 3 stress in total', () => {
    withRule(true)
    const s = ship(6)
    driveHits(s, 4)

    expect(currentMaxSpeed(s)).toBe(1)
    expect(s.speed).toBe(1)
    // Cumulative across the round and measured from the original speed 6,
    // which is how the rulebook totals it.
    expect(s.accelUsedThisRound).toBe(5)
    expect(accelerationStress(s)).toBe(3)
  })
})

describe('when it does and does not bite', () => {
  it('does nothing at all with the optional rule switched off', () => {
    withRule(false)
    const s = ship(6)
    driveHits(s, 3)

    expect(currentMaxSpeed(s)).toBe(2)
    // The top speed still falls — that is E8.5.4, not optional — but the ship
    // is not charged for the slowdown and takes no stress for it.
    expect(s.accelUsedThisRound).toBe(0)
    expect(accelerationStress(s)).toBe(0)
  })

  it('leaves a ship already slower than its new maximum alone', () => {
    withRule(true)
    const s = ship(1)
    driveHits(s, 2) // top speed 4: the ship is well under it
    expect(currentMaxSpeed(s)).toBe(4)
    expect(s.speed).toBe(1)
    expect(s.accelUsedThisRound).toBe(0)
  })

  it('competes with acceleration the captain has already spent', () => {
    withRule(true)
    const s = ship(6)
    // Two points already burnt this round: the green circles are gone before
    // the drive is even hit, so every forced point is stress.
    s.accelUsedThisRound = 2
    driveHits(s, 3)
    expect(s.accelUsedThisRound).toBe(6)
    expect(accelerationStress(s)).toBe(4)
  })
})

describe('running backwards (C4.2.4)', () => {
  it('holds reverse to half the reduced maximum', () => {
    withRule(true)
    const s = ship(-3)
    driveHits(s, 1) // top speed 5, so reverse is capped at 2
    expect(s.speed).toBe(-2)
    expect(s.accelUsedThisRound).toBe(1)
  })
})

describe('a derelict coming to a stop (C4.2.3, E11.2.4)', () => {
  it('pays for the drop to zero like any other forced deceleration', () => {
    withRule(true)
    const s = ship(6)
    // Wreck the structure so the next check makes it a derelict.
    s.structureDamaged = s.structureDamaged.map(() => true)

    // checkDestruction runs off the same options this suite has set.
    checkDestruction(s, context())

    expect(s.derelict).toBe(true)
    expect(s.speed).toBe(0)
    expect(s.accelUsedThisRound).toBe(6)
    expect(accelerationStress(s)).toBe(4)
  })
})
