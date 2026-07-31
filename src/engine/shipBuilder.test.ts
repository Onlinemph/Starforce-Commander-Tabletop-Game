import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, shipFormById } from '../data/ships'
import {
  blankForm,
  blankWeapon,
  bracketDamage,
  impliedSpecialModifier,
  pointValue,
  redDieAverage,
  traitModifier,
  validateDesign,
  POWER_MULTIPLIER,
  REFERENCE_POWER,
} from './shipBuilder'
import type { ShipForm, WeaponSystemDef } from './types'

/**
 * The valuation model is a transcription of the designers' own spreadsheet
 * (`1. SHIP FORM MASTER FEDERATION V38`), so the tests fall into two halves:
 * one that pins the transcription against the sheet's arithmetic, and one that
 * checks the result lands on the point values the Ship Book actually prints.
 */

// ---------------------------------------------------------------------------
// The sheet's own worked example
// ---------------------------------------------------------------------------

/**
 * The spreadsheet ships with a part-built hull already entered — no weapons, a
 * size-7 reactor block, 40 shield boxes — and computes a Final Point Value of
 * 8.0809. Reproducing that number is the strongest single check on the
 * transcription: it exercises actual power, free power, the stress penalty, the
 * shield generator, the FTL trade-off and the maneuvering block all at once.
 */
function sheetExample(): ShipForm {
  const form = blankForm('sheet-example')
  form.sizeClass = 7
  form.stressRating = 5
  form.damageControlRating = 5
  form.marineSquads = 16
  form.reactors = [
    { id: 'l', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 'r', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 's', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }] },
    { id: 'a', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }] },
  ]
  form.batteries = 1
  form.ftlDriveBoxes = 2
  form.weapons = []
  form.systems = [
    { kind: 'SCNC', label: 'Sciences', boxes: 4 },
    { kind: 'SENS', label: 'Sensors', boxes: 3 },
  ]
  form.shields = {
    generatorBoxes: 3,
    blue: { F: 10, S: 10, A: 10, P: 10 },
    green: { F: 3, S: 3, A: 3, P: 3 },
  }
  form.armor = { F: 0, S: 0, A: 0, P: 0 }
  form.structure = [
    { kind: 'box', color: 'black' },
    { kind: 'box', color: 'red' },
    { kind: 'box', color: 'red' },
    { kind: 'box', color: 'red' },
    { kind: 'box', color: 'red' },
  ]
  form.sublight = {
    maxSpeed: 6,
    turnBySpeed: [45, 40, 35, 30, 25, 0, 0],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 4,
    driveBoxes: 5,
    // One box each at speeds 6, 5, 3, 1 and 0 — the sheet's `K47:K55` column.
    dmgTopSpeed: [6, 5, 3, 1, 0],
  }
  // FUNCTIONS: 1 free acceleration, no free SIF, max SIF 3, sensors 2/4/6.
  form.functions = form.functions.filter((l) => l.kind !== 'weapon')
  const line = (kind: string) => form.functions.find((l) => l.kind === kind)!
  line('accel').freeValue = 1
  line('accel').steps = [2, 3, 4].map((value) => ({ powerCost: 1, value }))
  line('sif').freeValue = 0
  line('sif').steps = [1, 2, 3].map((value) => ({ powerCost: 1, value }))
  line('sensor').freeValue = 2
  line('sensor').steps = [4, 6].map((value) => ({ powerCost: 1, value }))
  line('ftl-drive').freeValue = 0
  line('ftl-drive').steps = [1, 2, 3].map((value) => ({ powerCost: 1, value }))
  for (const l of form.functions) if (l.kind === 'shield-reinforce') l.freeValue = 0
  return form
}

describe('the designers’ spreadsheet', () => {
  const form = sheetExample()
  const cost = pointValue(form)

  it('reproduces the sheet’s Final Point Value', () => {
    expect(cost.points).toBeCloseTo(8.0809, 3)
  })

  it('reproduces actual power, free power included', () => {
    // O5 = 14 × 9 power boxes; O6 = (2/3 + 1) × 14 of free power.
    expect(cost.actualPower).toBeCloseTo(149.3333, 3)
    expect(POWER_MULTIPLIER[7] * 2).toBe(14)
  })

  it('counts every damage box on the form, not just the systems block', () => {
    // 7 general + 3 shield gen + 22 reactor + 1 battery + 2 FTL + 5 drive.
    expect(cost.systemBoxes).toBe(40)
  })

  it('reproduces the sheet’s component totals', () => {
    expect(cost.generalSystems).toBeCloseTo(4, 6) // marines only; sciences are free
    expect(cost.defence).toBeCloseTo(76.0498, 3)
    expect(cost.maneuver).toBeCloseTo(0.75, 6)
    expect(cost.sif).toBeCloseTo(0.009_46, 4)
  })

  it('prices a ship relative to the sheet’s reference hull', () => {
    expect(REFERENCE_POWER).toBe(118.39)
  })
})

// ---------------------------------------------------------------------------
// Weapon valuation
// ---------------------------------------------------------------------------

const TRAIT_PDMODE = 0.05

describe('weapon valuation', () => {
  it('averages a red die from its own Special hit', () => {
    // (M 3 + H 5 + three Special faces worth 4 + 1 leak + 1 structure × 1.5) / 6.
    const weapon = { special: { damage: 4, leak: 1, structure: 1 } } as WeaponSystemDef
    expect(redDieAverage(weapon)).toBeCloseTo((3 + 5 + 6.5 * 3) / 6, 6)
  })

  it('adds bonus damage per die, discounted on a blue die', () => {
    const weapon = {
      brackets: [{ min: 0, max: 3, band: 'black' as const, dice: ['blue' as const], bonus: 3 }],
      traits: [],
    } as unknown as WeaponSystemDef
    expect(bracketDamage(weapon, 0)).toBeCloseTo(1.5 + 3 * 0.666 + 0.001, 6)
  })

  it('reads trait names however they are spelled on the form', () => {
    expect(traitModifier('PD MODE')).toBe(TRAIT_PDMODE)
    expect(traitModifier('PDMODE')).toBe(TRAIT_PDMODE)
    expect(traitModifier('NoBAT')).toBe(-0.1)
    // An unlisted step falls to the next one the sheet prints.
    expect(traitModifier('AMMO 5')).toBe(traitModifier('AMMO 6'))
    expect(traitModifier('WARP BUBBLE')).toBe(0)
  })

  it('discounts a weapon that takes several rounds to arm', () => {
    const torpedo = shipFormById('union-yorktown-i-class-heavy-cruiser')!.weapons.find((w) =>
      w.name.includes('A/MAT'),
    )!
    // Two arming circles with a slow-arming diamond between them (E4.2.8).
    expect(torpedo.mounts[0].roundGates).toEqual([true])
    const value = pointValue(shipFormById('union-yorktown-i-class-heavy-cruiser')!).weapons.find(
      (w) => w.name.includes('A/MAT'),
    )!
    expect(value.armingMultiplier).toBe(0.75)
  })
})

// ---------------------------------------------------------------------------
// Against the printed roster
// ---------------------------------------------------------------------------

describe('against the printed point values', () => {
  const rows = SHIP_FORMS.map((form) => ({
    form,
    ratio: pointValue(form).points / form.pointValue,
  }))

  it('is unbiased across the whole roster', () => {
    const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)]
    expect(median).toBeGreaterThan(0.95)
    expect(median).toBeLessThan(1.05)
  })

  it('puts most printed ships within a tenth of their point value', () => {
    const close = rows.filter((r) => Math.abs(r.ratio - 1) <= 0.1)
    expect(close.length / rows.length).toBeGreaterThan(0.7)
  })

  it('is unbiased within each faction', () => {
    for (const faction of [...new Set(SHIP_FORMS.map((f) => f.faction))]) {
      const group = rows.filter((r) => r.form.faction === faction)
      const mean = group.reduce((n, r) => n + r.ratio, 0) / group.length
      expect(mean, faction).toBeGreaterThan(0.9)
      expect(mean, faction).toBeLessThan(1.1)
    }
  })

  it('recovers the special modifier the designers applied to each ship', () => {
    const yorktown = shipFormById('union-yorktown-i-class-heavy-cruiser')!
    const modifier = impliedSpecialModifier(yorktown)
    expect(modifier).toBeGreaterThan(0.8)
    expect(modifier).toBeLessThan(1.25)
  })
})

// ---------------------------------------------------------------------------
// Design validation
// ---------------------------------------------------------------------------

describe('design validation', () => {
  it('passes every printed ship', () => {
    for (const form of SHIP_FORMS) {
      const errors = validateDesign(form).filter((p) => p.severity === 'error')
      expect(errors, `${form.name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('passes a blank hull, but warns that it cannot shoot', () => {
    const form = blankForm('x')
    const problems = validateDesign(form)
    expect(problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(problems.some((p) => /no weapons/.test(p.message))).toBe(true)
  })

  it('catches a shield over its printed maximum', () => {
    const form = blankForm('x')
    form.shields.blue.F = 40
    expect(validateDesign(form).some((p) => p.message.includes('G1.1.3'))).toBe(true)
  })

  it('catches a drive whose damage table does not match its boxes', () => {
    const form = blankForm('x')
    form.sublight.driveBoxes = 5
    expect(validateDesign(form).some((p) => p.message.includes('E8.5.4'))).toBe(true)
  })

  it('catches a weapon with no arming line', () => {
    const form = blankForm('x')
    const { weapon } = blankWeapon('w1')
    form.weapons.push(weapon)
    expect(validateDesign(form).some((p) => p.message.includes('E4.2.6'))).toBe(true)
  })

  it('accepts a weapon added with its arming line', () => {
    const form = blankForm('x')
    const { weapon, line } = blankWeapon('w1')
    form.weapons.push(weapon)
    form.functions.push(line)
    expect(validateDesign(form).filter((p) => p.severity === 'error')).toEqual([])
    // And it is now worth something.
    expect(pointValue(form).totalOffense).toBeGreaterThan(0)
  })

  it('flags a trait the designers never priced', () => {
    const form = blankForm('x')
    const { weapon, line } = blankWeapon('w1')
    weapon.traits = ['CHRONITON']
    form.weapons.push(weapon)
    form.functions.push(line)
    expect(validateDesign(form).some((p) => p.message.includes('CHRONITON'))).toBe(true)
  })

  it('does not complain about a homing weapon’s restarting firing chart', () => {
    const homing = SHIP_FORMS.flatMap((f) => f.weapons).find((w) =>
      w.traits.some((t) => t.startsWith('HOMING')),
    )
    expect(homing).toBeDefined()
    const form = blankForm('x')
    const { line } = blankWeapon(homing!.id)
    form.weapons.push(structuredClone(homing!))
    form.functions.push({ ...line, id: 'f-h', weaponSystemId: homing!.id })
    expect(validateDesign(form).some((p) => /firing chart has a gap/.test(p.message))).toBe(false)
  })
})
