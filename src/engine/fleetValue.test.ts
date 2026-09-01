import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, shipFormById } from '../data/ships'
import { startScenario } from '../data/scenarios'
import { replayGame } from '../data/savedGame'
import { pointsAgainst } from './game'
import { balancedPointValue } from './fleetValue'
import { fleetPoints } from './fleet'
import { hitPointDamage, hitPointTotal } from './shipState'
import { woundToFraction } from './testWounds'
import type { ShipForm } from './types'

/**
 * The balanced point scale: measured battle values as an opt-in pricing for
 * fleet building, threaded through the setup so the battle itself scores in
 * the same currency the fleets were bought in.
 */

const UNION_III = 'union-union-iii-class-dreadnought'
const YORKTOWN_I = 'union-yorktown-i-class-heavy-cruiser'

describe('balancedPointValue', () => {
  it('prices every printed hull from the measured table', () => {
    for (const form of SHIP_FORMS) {
      const value = balancedPointValue(form)
      expect(value, form.name).toBeGreaterThan(0)
      expect(Number.isFinite(value), form.name).toBe(true)
    }
  })

  it('keeps the yardstick and re-prices the top: YORKTOWN I holds 23, UNION III drops to 97', () => {
    expect(balancedPointValue(shipFormById(YORKTOWN_I)!)).toBe(23)
    expect(balancedPointValue(shipFormById(UNION_III)!)).toBe(97)
  })

  it('compresses the scale: every big hull gets relatively cheaper, no small hull explodes', () => {
    for (const form of SHIP_FORMS) {
      // Stations and satellites sit out the sanity band: the measured table
      // was fitted to fleets that maneuver, and a 3.5-point CUTLASS landing
      // at 5.5 is a two-point wobble, not an explosion.
      if (form.sublight.maxSpeed === 0) continue
      const ratio = balancedPointValue(form) / form.pointValue
      if (form.pointValue >= 60) expect(ratio, form.name).toBeLessThan(1)
      expect(ratio, form.name).toBeGreaterThan(0.4)
      expect(ratio, form.name).toBeLessThan(1.6)
    }
  })

  it('falls back to the fitted curve for a design the sweeps never measured', () => {
    const fan: ShipForm = { ...shipFormById(YORKTOWN_I)!, id: 'fan-test-cruiser', pointValue: 92 }
    // value = 23 * (92/23)^0.745 — the curve, anchored at the YORKTOWN I.
    expect(balancedPointValue(fan)).toBeCloseTo(23 * (92 / 23) ** 0.745, 0)
  })

  it('prices the carrier from its own titration, not the gunship curve', () => {
    // Half its price is fighter wing — already a swarm, owed none of the
    // concentration discount. Measured: the wing that fights a lone heavy
    // cruiser dead even melts against the massed PD of a cruiser screen.
    const carrier = shipFormById('fan-union-ark-royal-fleet-carrier')!
    expect(balancedPointValue(carrier)).toBe(61)
  })

  it('leaves an unmeasured hangar hull at its printed price', () => {
    const base = shipFormById('fan-union-ark-royal-fleet-carrier')!
    const fanCarrier: ShipForm = { ...base, id: 'fan-test-carrier', pointValue: 120 }
    expect(balancedPointValue(fanCarrier)).toBe(120)
  })
})

describe('a battle built on balanced points', () => {
  const setup = {
    seed: 11,
    balancedPoints: true,
    fleets: { 'Blue Force': [UNION_III], 'Red Force': [YORKTOWN_I, YORKTOWN_I, YORKTOWN_I, YORKTOWN_I] },
  }

  it('prices every hull at its measured value, and the ledger follows', () => {
    const game = startScenario('s3.1-the-duel', setup)
    const big = game.ships.find((s) => s.form.id === UNION_III)!
    expect(big.pointValue).toBe(97)
    // Destroying the re-priced dreadnought pays its balanced value, not the
    // printed 158.5 — the scoreboard pays in the currency the fleet was
    // bought in.
    big.destroyed = true
    expect(pointsAgainst(big)).toBe(97)
  })

  it('scores partial damage by the S2.8.4 fractions of the balanced value', () => {
    const game = startScenario('s3.1-the-duel', setup)
    const big = game.ships.find((s) => s.form.id === UNION_III)!
    woundToFraction(big, 0.55)
    expect(hitPointDamage(big)).toBeGreaterThanOrEqual(hitPointTotal(big) / 2)
    expect(pointsAgainst(big)).toBeCloseTo(97 * 0.5, 1)
  })

  it('leaves the printed scale untouched when the option is off', () => {
    const game = startScenario('s3.1-the-duel', { seed: 11, fleets: setup.fleets })
    const big = game.ships.find((s) => s.form.id === UNION_III)!
    expect(big.pointValue).toBe(big.form.pointValue)
  })

  it('replays from a save with the same prices', () => {
    const replayed = replayGame({
      version: 1,
      setup: { scenarioId: 's3.1-the-duel', ...setup },
      actions: [],
    })
    expect(replayed.ships.find((s) => s.form.id === UNION_III)!.pointValue).toBe(97)
  })
})

describe('fleetPoints on the balanced scale', () => {
  it('calls the dreadnought and four Yorktowns an even match', () => {
    const forms = new Map(SHIP_FORMS.map((f) => [f.id, f]))
    const big = fleetPoints([{ formId: UNION_III, count: 1 }], forms, balancedPointValue)
    const swarm = fleetPoints([{ formId: YORKTOWN_I, count: 4 }], forms, balancedPointValue)
    expect(big).toBe(97)
    expect(swarm).toBe(92)
    // Under printed prices the same pair reads as 158.5 against 92 — the
    // mismatch the whole measurement campaign was about.
  })
})
