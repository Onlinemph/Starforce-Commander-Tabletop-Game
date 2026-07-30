import { beforeEach, describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'
import {
  applyVolley,
  autoChoices,
  newDeck,
  resolveCard,
  setDestructionOptions,
  STANDARD_DESTRUCTION,
  type DamageContext,
} from './damage'
import { Rng } from './dice'
import {
  blueShieldRemaining,
  createShip,
  damageControlRating,
  greenShieldRemaining,
  markStructure,
  structureRemaining,
  undamagedSystemBoxes,
  type ShipState,
} from './shipState'
import type { DamageCard } from './types'

function makeShip(): ShipState {
  return createShip({
    id: 'test',
    side: 'Blue',
    name: 'Test Ship',
    form: YORKTOWN,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 4,
  })
}

function makeContext(): DamageContext {
  const rng = new Rng(1234)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

const card = (primary: DamageCard['primary'], alt?: DamageCard['alt']): DamageCard => ({
  id: 'c',
  category: 'general',
  primary,
  alt,
  stressIcon: false,
})

beforeEach(() => setDestructionOptions(STANDARD_DESTRUCTION))

describe('shields and armor (G1.2, G2.2)', () => {
  it('absorbs damage on the struck shield only (G1.1.6)', () => {
    const ship = makeShip()
    applyVolley(ship, { standard: 5, leak: 0, structurePenetration: 0, side: 'F' }, makeContext())
    expect(blueShieldRemaining(ship, 'F')).toBe(11) // 16 − 5
    expect(blueShieldRemaining(ship, 'P')).toBe(12)
  })

  it('spends green reinforcement boxes before blue ones (G1.3.2)', () => {
    const ship = makeShip()
    ship.greenShieldActive.F = 3
    applyVolley(ship, { standard: 4, leak: 0, structurePenetration: 0, side: 'F' }, makeContext())
    expect(greenShieldRemaining(ship, 'F')).toBe(0)
    expect(blueShieldRemaining(ship, 'F')).toBe(15) // only 1 got through
  })

  it('passes damage to internal systems once shields are gone (G1.2.1)', () => {
    const ship = makeShip()
    ship.blueShieldDamage.A = 10 // aft shield stripped
    const outcome = applyVolley(ship, { standard: 4, leak: 0, structurePenetration: 0, side: 'A' }, makeContext())
    expect(outcome.internal).toBe(4)
  })

  it('applies damage as internal when the shield is lowered (G1.1.5)', () => {
    const ship = makeShip()
    ship.shieldsDown.F = true
    const outcome = applyVolley(ship, { standard: 3, leak: 0, structurePenetration: 0, side: 'F' }, makeContext())
    // The lowered shield soaks nothing; the whole volley becomes internal damage.
    expect(outcome.blueAbsorbed).toBe(0)
    expect(outcome.greenAbsorbed).toBe(0)
    expect(outcome.internal).toBe(3)
  })

  it('lets armor absorb after shields (G2.2.1)', () => {
    const ship = makeShip()
    ship.form = { ...YORKTOWN, armor: { F: 4, P: 0, S: 0, A: 0 } }
    ship.blueShieldDamage.F = 16
    const outcome = applyVolley(ship, { standard: 6, leak: 0, structurePenetration: 0, side: 'F' }, makeContext())
    expect(outcome.armorAbsorbed).toBe(4)
    expect(outcome.internal).toBe(2)
  })
})

describe('leak damage (E7.2.6)', () => {
  it('bypasses intact shields and still draws cards', () => {
    const ship = makeShip()
    let cardsResolved = 0
    const ctx = makeContext()
    ctx.log = () => {
      cardsResolved += 1
    }
    const outcome = applyVolley(ship, { standard: 4, leak: 2, structurePenetration: 0, side: 'F' }, ctx)
    // The shield stopped all four standard points, so nothing penetrated…
    expect(outcome.blueAbsorbed).toBe(4)
    expect(outcome.internal).toBe(0)
    // …but the two leak hits still caused internal damage.
    expect(outcome.leakCards).toBe(2)
    expect(cardsResolved).toBeGreaterThan(0)
  })
})

describe('STR +X special hits (F1.43)', () => {
  it('applies structure damage only when shields and armor are down', () => {
    const ship = makeShip()
    ship.blueShieldDamage.F = 16
    const before = structureRemaining(ship)
    const outcome = applyVolley(ship, { standard: 0, leak: 0, structurePenetration: 2, side: 'F' }, makeContext())
    expect(outcome.structureFromSpecial).toBe(2)
    expect(structureRemaining(ship)).toBe(before - 2)
  })

  it('is ignored while the shield still holds', () => {
    const ship = makeShip()
    const before = structureRemaining(ship)
    const outcome = applyVolley(ship, { standard: 1, leak: 0, structurePenetration: 2, side: 'F' }, makeContext())
    expect(outcome.structureFromSpecial).toBe(0)
    expect(structureRemaining(ship)).toBe(before)
  })
})

describe('alternate hits (E7.3.7)', () => {
  it('falls through to the alternate hit when the primary is unavailable', () => {
    const ship = makeShip()
    const ctx = makeContext()
    // Strip every science box so a Sciences hit has to fall through to Quarters.
    ship.systemDamage['SCNC'] = 4
    const quartersBefore = undamagedSystemBoxes(ship, 'QTRS')
    resolveCard(ship, card('sciences', 'quarters'), ctx)
    expect(undamagedSystemBoxes(ship, 'QTRS')).toBe(quartersBefore - 1)
  })

  it('falls through to structure when neither primary nor alternate is available', () => {
    const ship = makeShip()
    const ctx = makeContext()
    ship.systemDamage['SCNC'] = 4
    ship.systemDamage['QTRS'] = 6
    const before = structureRemaining(ship)
    resolveCard(ship, card('sciences', 'quarters'), ctx)
    expect(structureRemaining(ship)).toBe(before - 1)
  })

  it('loses the damage point instead under precision targeting (E9.1.4)', () => {
    const ship = makeShip()
    const ctx = makeContext()
    ctx.precision = { section: 'general', hand: [] }
    ship.systemDamage['SCNC'] = 4
    ship.systemDamage['QTRS'] = 6
    const before = structureRemaining(ship)
    resolveCard(ship, card('sciences', 'quarters'), ctx)
    expect(structureRemaining(ship)).toBe(before)
  })
})

describe('specific damage cards (E8)', () => {
  it('Shield Power Loss removes three boxes from one shield (E8.2.2)', () => {
    const ship = makeShip()
    resolveCard(ship, card('shield-power-loss'), makeContext())
    const total =
      blueShieldRemaining(ship, 'F') +
      blueShieldRemaining(ship, 'P') +
      blueShieldRemaining(ship, 'S') +
      blueShieldRemaining(ship, 'A')
    expect(total).toBe(16 + 12 + 12 + 10 - 3)
  })

  it('a fully damaged weapon mount loses its arming points (E8.3.1)', () => {
    const ship = makeShip()
    ship.mounts['lnc-447'][0].armed = 2
    const ctx = makeContext()
    // Force the choice onto the armed forward mount.
    ctx.choices = { ...autoChoices, weaponMount: () => ({ weaponId: 'lnc-447', index: 0 }) }
    resolveCard(ship, card('any-weapon'), ctx)
    expect(ship.mounts['lnc-447'][0].damage).toBe(1)
    expect(ship.mounts['lnc-447'][0].armed).toBe(0)
  })

  it('Casualties removes three marine squads (E8.4.2)', () => {
    const ship = makeShip()
    resolveCard(ship, card('casualties'), makeContext())
    expect(ship.marineSquads).toBe(1) // 4 − 3
  })

  it('destroying every sublight drive box forces an Emergency Stop (E8.5.4)', () => {
    const ship = makeShip()
    const ctx = makeContext()
    for (let i = 0; i < YORKTOWN.sublight.driveBoxes; i++) {
      resolveCard(ship, card('sublight-drive'), ctx)
    }
    expect(ship.speed).toBe(0)
    expect(ship.emergencyStopPhases).toBe(2)
  })

  it('a Main Engineering Hit adds two stress markers (E8.6.5)', () => {
    const ship = makeShip()
    resolveCard(ship, card('main-engineering-hit'), makeContext())
    expect(ship.stressMarkers).toBe(2)
  })

  it('a damaged battery loses the power it was holding (B2.4.2)', () => {
    const ship = makeShip()
    expect(ship.batteryCharged[0]).toBe(true)
    resolveCard(ship, card('battery'), makeContext())
    expect(ship.batteryDamaged[0]).toBe(true)
    expect(ship.batteryCharged[0]).toBe(false)
  })
})

describe('damage control rating decay (B3.1.2)', () => {
  it('drops as the structure track is consumed and never recovers', () => {
    const ship = makeShip()
    expect(damageControlRating(ship)).toBe(4)

    // Yorktown's track: 4 boxes at DC 4, then DC 3, 4 more, then DC 2, 2 more, DC 1.
    for (let i = 0; i < 4; i++) markStructure(ship)
    expect(damageControlRating(ship)).toBe(3)

    for (let i = 0; i < 4; i++) markStructure(ship)
    expect(damageControlRating(ship)).toBe(2)

    for (let i = 0; i < 2; i++) markStructure(ship)
    expect(damageControlRating(ship)).toBe(1)

    // Repairing a black box does not restore the rating (B3.3.3).
    ship.structureDamaged[0] = false
    expect(damageControlRating(ship)).toBe(1)
  })
})

describe('destruction (E11.1)', () => {
  it('removes a ship once its last structure box is marked', () => {
    const ship = makeShip()
    const ctx = makeContext()
    ship.blueShieldDamage.F = 16
    applyVolley(ship, { standard: 0, leak: 0, structurePenetration: 20, side: 'F' }, ctx)
    expect(ship.destroyed).toBe(true)
  })

  it('leaves a derelict instead when the optional rule is on (E11.2)', () => {
    setDestructionOptions({ derelicts: true, explosions: false })
    const ship = makeShip()
    const ctx = makeContext()
    ship.blueShieldDamage.F = 16
    applyVolley(ship, { standard: 0, leak: 0, structurePenetration: 10, side: 'F' }, ctx)
    expect(ship.derelict).toBe(true)
    expect(ship.destroyed).toBe(false)
    expect(ship.speed).toBe(0)
  })

  it('breaks a derelict apart at excess damage equal to its size class (E11.2.3)', () => {
    setDestructionOptions({ derelicts: true, explosions: false })
    const ship = makeShip()
    const ctx = makeContext()
    ship.blueShieldDamage.F = 16
    // 10 structure boxes plus 5 excess for a size class 5 ship.
    applyVolley(ship, { standard: 0, leak: 0, structurePenetration: 15, side: 'F' }, ctx)
    expect(ship.destroyed).toBe(true)
  })
})
