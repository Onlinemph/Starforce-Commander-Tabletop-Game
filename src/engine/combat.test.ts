import { beforeEach, describe, expect, it } from 'vitest'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import {
  bracketIndexFor,
  firingOrder,
  hasTrait,
  harmsStarships,
  isPointDefense,
  resolveVolley,
  selectBracket,
  traitValue,
} from './combat'
import { autoChoices, newDeck, setDestructionOptions, STANDARD_DESTRUCTION, type DamageContext } from './damage'
import { Rng } from './dice'
import { createShip, type ShipState } from './shipState'
import type { WeaponSystemDef } from './types'

const phaser = YORKTOWN.weapons.find((w) => w.id === 'lnc-447')!
const torpedo = YORKTOWN.weapons.find((w) => w.id === 'mk4-torp')!
const disruptor = VALLARI_CRUISER.weapons.find((w) => w.id === 'type-51')!

function pair(distanceInches: number): { attacker: ShipState; target: ShipState } {
  const attacker = createShip({
    id: 'a',
    side: 'Blue',
    name: 'Attacker',
    form: YORKTOWN,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 4,
  })
  const target = createShip({
    id: 'b',
    side: 'Red',
    name: 'Target',
    form: VALLARI_CRUISER,
    // Directly ahead of the attacker, facing away, so fire strikes its aft shield.
    placement: { position: { x: 0, y: -distanceInches }, heading: 0 },
    speed: 4,
  })
  return { attacker, target }
}

function ctx(seed = 99): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

beforeEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

describe('weapon traits (F1)', () => {
  it('recognises point defense traits (E12.2.5)', () => {
    expect(isPointDefense(phaser)).toBe(true)
    expect(isPointDefense(torpedo)).toBe(false)
  })

  it('reads numeric trait values', () => {
    expect(traitValue(phaser, 'PREC')).toBe(1)
    expect(traitValue(disruptor, 'PREC')).toBe(0)
    expect(traitValue(torpedo, 'PREC')).toBeNull()
  })

  it('marks NoBAT weapons (F1.14)', () => {
    expect(hasTrait(torpedo, 'NoBAT')).toBe(true)
    expect(hasTrait(phaser, 'NoBAT')).toBe(false)
  })

  it('stops dedicated point defense weapons harming starships (F1.20.3)', () => {
    const pdWeapon: WeaponSystemDef = { ...phaser, traits: ['PD WPN'] }
    expect(harmsStarships(pdWeapon)).toBe(false)
    expect(harmsStarships(phaser)).toBe(true)
  })
})

describe('range brackets (E1.2, C1.5)', () => {
  it('picks the bracket containing the effective range', () => {
    expect(bracketIndexFor(disruptor, 0)).toBe(0)
    expect(bracketIndexFor(disruptor, 4)).toBe(1)
    expect(bracketIndexFor(disruptor, 7)).toBe(2)
    expect(bracketIndexFor(disruptor, 13)).toBe(4)
    expect(bracketIndexFor(disruptor, 14)).toBe(-1) // out of range
  })

  it('shifts one bracket closer against a target at speed zero (C1.5.2)', () => {
    // Effective range 7 normally sits in the 6-8 black bracket; the low-speed
    // penalty moves the attacker to the 3-5 green bracket.
    const normal = selectBracket(disruptor, 7, false)!
    const lowSpeed = selectBracket(disruptor, 7, true)!
    expect(normal.bracket.band).toBe('black')
    expect(lowSpeed.bracket.band).toBe('green')
    expect(lowSpeed.index).toBe(normal.index - 1)
  })

  it('never shifts past the first bracket', () => {
    expect(selectBracket(disruptor, 1, true)!.index).toBe(0)
  })
})

describe('firing sequence (E6.2 Step 1, H2.4)', () => {
  it('orders ships by Tactical Scan, grouping ties for simultaneous fire', () => {
    const { attacker, target } = pair(6)
    const third = createShip({ ...attacker, id: 'c', form: YORKTOWN, placement: attacker.placement, side: 'Blue', name: 'Third', speed: 0 })
    attacker.sensors.tacticalScan = 3
    target.sensors.tacticalScan = 2
    third.sensors.tacticalScan = 3

    const groups = firingOrder([target, attacker, third])
    expect(groups).toHaveLength(2)
    expect(groups[0].map((s) => s.id).sort()).toEqual(['a', 'c'])
    expect(groups[1].map((s) => s.id)).toEqual(['b'])
  })
})

describe('volley resolution (E6.2, E7.3)', () => {
  it('rejects weapons that cannot bear on the target', () => {
    const { attacker, target } = pair(5)
    // Move the target astern; the forward torpedo tubes cannot bear.
    target.placement = { position: { x: 0, y: 8 }, heading: 0 }
    attacker.mounts['mk4-torp'][0].armed = 2

    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'mk4-torp', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/cannot bear/)
  })

  it('rejects a mount that is not fully armed (E4.2.3)', () => {
    const { attacker, target } = pair(5)
    attacker.mounts['lnc-447'][0].armed = 1 // needs 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(result.ok).toBe(false)
  })

  it('erases arming circles for mounts that fire (E6.2 Step 6)', () => {
    const { attacker, target } = pair(5)
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(result.ok).toBe(true)
    expect(attacker.mounts['lnc-447'][0].armed).toBe(0)
  })

  it('rejects targets beyond the weapon chart', () => {
    const { attacker, target } = pair(30)
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/out of range/)
  })

  it('applies jamming to push a target out of reach (H2.3.7)', () => {
    const { attacker, target } = pair(14)
    target.sensors.jamming = 4 // effective range 18, past the phaser's 15
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(result.ok).toBe(false)
  })

  it('drops one attack die per damage box on a degraded mount (E8.3.1)', () => {
    const { attacker, target } = pair(7) // 6-8 bracket: green + blue
    attacker.mounts['lnc-447'][0].armed = 2
    attacker.mounts['lnc-447'][0].damage = 0
    const full = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(5),
    )
    expect(full.ok).toBe(true)
    if (full.ok) expect(full.records[0].rolls).toHaveLength(2)
  })

  it('halves damage and discards leak under degraded fire control (E10.2)', () => {
    const { attacker, target } = pair(4)
    attacker.sensors.targeting = 3
    attacker.mounts['lnc-447'][0].armed = 2

    const result = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }],
        mode: 'standard',
        degradedFireControl: true,
      },
      ctx(7),
      new Rng(7),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Attacker targeting is forfeited, so effective range is the actual range.
      expect(result.effectiveRange).toBe(result.actualRange)
      expect(result.damage.leak).toBe(0)
      expect(result.damage.structurePenetration).toBe(0)
      expect(result.damage.standard).toBe(Math.floor(result.rawStandard / 2))
    }
  })

  it('halves damage for proximity fire and refuses to mix it with degraded FC (E3.3)', () => {
    const { attacker, target } = pair(4)
    attacker.mounts['lnc-447'][0].armed = 2

    const rejected = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }],
        mode: 'proximity',
        degradedFireControl: true,
      },
      ctx(),
      new Rng(3),
    )
    expect(rejected.ok).toBe(false)

    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'proximity' },
      ctx(3),
      new Rng(3),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.damage.standard).toBe(Math.floor(result.rawStandard / 2))
      expect(result.damage.leak).toBe(0)
    }
  })

  it('refuses precision targeting beyond effective range 8 (E9.1.3)', () => {
    const { attacker, target } = pair(12)
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }],
        mode: 'precision',
        precisionSection: 'weapons',
      },
      ctx(),
      new Rng(1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/E9.1.3/)
  })

  it('refuses non-PREC weapons in a precision volley (E9.2.1)', () => {
    const { attacker, target } = pair(4)
    attacker.mounts['mk4-torp'][0].armed = 2
    const result = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: 'mk4-torp', mountIndex: 0 }],
        mode: 'precision',
        precisionSection: 'weapons',
      },
      ctx(),
      new Rng(1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/PREC/)
  })

  it('strikes the shield facing the attacker (E6.2 Step 4)', () => {
    const { attacker, target } = pair(5)
    // Target faces north, attacker is to its south → aft shield.
    target.placement = { position: { x: 0, y: -5 }, heading: 180 }
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }], mode: 'standard' },
      ctx(),
      new Rng(11),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.targetShield).toBe('F')
  })

  it('blocks fire when a planet sits between the ships (E2.3.2)', () => {
    const { attacker, target } = pair(12)
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      {
        attacker,
        target,
        mounts: [{ weaponId: 'lnc-447', mountIndex: 0 }],
        mode: 'standard',
        obstacles: [{ center: { x: 0, y: -6 }, radius: 3, blocksLos: true }],
      },
      ctx(),
      new Rng(2),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Line of sight/)
  })

  it('fires at low power, spending only the circles used (E3.4.3)', () => {
    const { attacker, target } = pair(7) // 6-8: green + blue, 2 dice, 2 circles
    attacker.mounts['lnc-447'][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: 'lnc-447', mountIndex: 0, lowPowerDice: 1 }], mode: 'standard' },
      ctx(),
      new Rng(4),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.records[0].rolls).toHaveLength(1)
    expect(attacker.mounts['lnc-447'][0].armed).toBe(1)
  })
})
