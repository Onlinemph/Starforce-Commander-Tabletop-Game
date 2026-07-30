import { describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'
import {
  armingPointsAvailable,
  armMount,
  commitAllocation,
  powerRemaining,
  repairTargets,
  resolveDamageControl,
  setAllocation,
  totalPowerAvailable,
} from './engineering'
import { Rng } from './dice'
import {
  batteryPower,
  blueShieldRemaining,
  createShip,
  greenShieldRemaining,
  lineValue,
  mountIsReady,
  reactorPower,
  type ShipState,
} from './shipState'

function makeShip(): ShipState {
  return createShip({
    id: 'test',
    side: 'Blue',
    name: 'U.S.S. Yorktown',
    form: YORKTOWN,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 4,
  })
}

describe('power totals (B2.2.1)', () => {
  it('reports TOTAL POWER 8+1 for an undamaged Yorktown', () => {
    const ship = makeShip()
    expect(reactorPower(ship)).toBe(8)
    expect(batteryPower(ship)).toBe(1)
    expect(totalPowerAvailable(ship)).toBe(9)
  })

  it('loses a power point only when every box on it is damaged (E8.5.1)', () => {
    const ship = makeShip()
    ship.reactorDamage['l-main'][0] = 1 // one of two boxes
    expect(reactorPower(ship)).toBe(8)
    ship.reactorDamage['l-main'][0] = 2
    expect(reactorPower(ship)).toBe(7)
  })
})

describe('resource allocation (B2.2)', () => {
  it('refuses to spend more power than the ship has', () => {
    const ship = makeShip()
    expect(setAllocation(ship, 'accel', 3)).toBeNull()
    expect(setAllocation(ship, 'f-lnc447', 3)).toBeNull()
    expect(setAllocation(ship, 'sensor', 2)).toBeNull()
    expect(setAllocation(ship, 'sif', 1)).toBeNull() // 9 of 9 spent
    const overspend = setAllocation(ship, 'gensys', 1)
    expect(overspend).not.toBeNull()
    expect(powerRemaining(ship)).toBe(0)
  })

  it('reads capability off the sequential circles (B2.2.2)', () => {
    const ship = makeShip()
    // Free power gives 1 acceleration point; three circles give 4 (B2.2.2 example).
    expect(lineValue(ship, 'accel')).toBe(1)
    setAllocation(ship, 'accel', 3)
    expect(lineValue(ship, 'accel')).toBe(4)
  })

  it('generates the documented phaser arming points (E4.1 Arming Example 1)', () => {
    const ship = makeShip()
    expect(lineValue(ship, 'f-lnc447')).toBe(1) // free power
    setAllocation(ship, 'f-lnc447', 1)
    expect(lineValue(ship, 'f-lnc447')).toBe(4)
    setAllocation(ship, 'f-lnc447', 2)
    expect(lineValue(ship, 'f-lnc447')).toBe(6)
    setAllocation(ship, 'f-lnc447', 3)
    expect(lineValue(ship, 'f-lnc447')).toBe(8)
  })

  it('generates the documented sensor points (H2.2.1)', () => {
    const ship = makeShip()
    expect(lineValue(ship, 'sensor')).toBe(2)
    setAllocation(ship, 'sensor', 1)
    expect(lineValue(ship, 'sensor')).toBe(4)
    setAllocation(ship, 'sensor', 2)
    expect(lineValue(ship, 'sensor')).toBe(6)
  })

  it('will not power a repair line for an undamaged shield', () => {
    const ship = makeShip()
    expect(setAllocation(ship, 'repr-F', 1)).not.toBeNull()
    ship.blueShieldDamage.F = 4
    expect(setAllocation(ship, 'repr-F', 1)).toBeNull()
  })

  it('will not power a damaged FTL drive (J9.1.3)', () => {
    const ship = makeShip()
    ship.ftlDriveDamage = YORKTOWN.ftlDriveBoxes
    expect(setAllocation(ship, 'ftl', 1)).not.toBeNull()
  })
})

describe('commit (B2.4, G1.3)', () => {
  it('repairs blue shield boxes equal to the generator rating (G1.3.3)', () => {
    const ship = makeShip()
    ship.blueShieldDamage.F = 8
    setAllocation(ship, 'repr-F', 1)
    commitAllocation(ship)
    // Generator rating 3 → three boxes restored.
    expect(blueShieldRemaining(ship, 'F')).toBe(16 - 5)
  })

  it('activates green boxes equal to the generator rating when reinforcing (G1.3.2)', () => {
    const ship = makeShip()
    setAllocation(ship, 'rnfc-F', 1)
    commitAllocation(ship)
    expect(greenShieldRemaining(ship, 'F')).toBe(3)
  })

  it('reinforces less when shield generators are damaged (G1.3.2)', () => {
    const ship = makeShip()
    ship.shieldGeneratorDamage = 1
    setAllocation(ship, 'rnfc-F', 1)
    commitAllocation(ship)
    expect(greenShieldRemaining(ship, 'F')).toBe(2)
  })

  it('drains a battery when allocation exceeds reactor output (B2.4.1)', () => {
    const ship = makeShip()
    // Spend all 8 reactor points plus the battery.
    setAllocation(ship, 'accel', 3)
    setAllocation(ship, 'f-lnc447', 3)
    setAllocation(ship, 'sensor', 2)
    setAllocation(ship, 'sif', 1)
    commitAllocation(ship)
    expect(batteryPower(ship)).toBe(0)
  })

  it('recharges an empty battery (B2.4.3)', () => {
    const ship = makeShip()
    ship.batteryCharged[0] = false
    setAllocation(ship, 'bat-rech', 1)
    commitAllocation(ship)
    expect(batteryPower(ship)).toBe(1)
  })

  it('sets GEN SYS to MAX only when a circle is purchased (J1.1.2)', () => {
    const ship = makeShip()
    commitAllocation(ship)
    expect(ship.genSysLevel).toBe('nrm') // free power covers NRM
    setAllocation(ship, 'gensys', 1)
    commitAllocation(ship)
    expect(ship.genSysLevel).toBe('max')
  })
})

describe('weapon arming (E4.2)', () => {
  it('makes arming points available inside the same segment (E4.2.1)', () => {
    const ship = makeShip()
    // Free power alone gives the LNC-447 one arming point.
    expect(armingPointsAvailable(ship, 'lnc-447')).toBe(1)
    setAllocation(ship, 'f-lnc447', 2)
    expect(armingPointsAvailable(ship, 'lnc-447')).toBe(6)
  })

  it('distributes arming points across mounts of the same system', () => {
    const ship = makeShip()
    setAllocation(ship, 'f-lnc447', 2) // 6 arming points

    // Fully arm three mounts (E4.2 Arming Example 2, option one).
    for (const index of [0, 1, 2]) {
      expect(armMount(ship, 'lnc-447', index)).toBeNull()
      expect(armMount(ship, 'lnc-447', index)).toBeNull()
      expect(mountIsReady(YORKTOWN.weapons[0], index, ship.mounts['lnc-447'][index])).toBe(true)
    }
    expect(armingPointsAvailable(ship, 'lnc-447')).toBe(0)
    expect(armMount(ship, 'lnc-447', 3)).not.toBeNull()
  })

  it('will not transfer arming points between weapon systems (E4.2.6)', () => {
    const ship = makeShip()
    setAllocation(ship, 'f-lnc447', 1)
    expect(armingPointsAvailable(ship, 'mk4-torp')).toBe(0)
    expect(armMount(ship, 'mk4-torp', 0)).not.toBeNull()
  })

  it('will not pull power off a weapon line after its points are spent (E4.2.7)', () => {
    const ship = makeShip()
    setAllocation(ship, 'f-lnc447', 2) // 6 points
    for (let i = 0; i < 5; i++) armMount(ship, 'lnc-447', i % 4)
    // Dropping to 4 points would strand a spent point.
    expect(setAllocation(ship, 'f-lnc447', 1)).not.toBeNull()
  })

  it('stops slow-arming weapons at the diamond (E4.2.8)', () => {
    const ship = makeShip()
    setAllocation(ship, 'f-mk4', 2) // 4 arming points

    // The first circle fills; the diamond blocks the second this round.
    expect(armMount(ship, 'mk4-torp', 0)).toBeNull()
    expect(armMount(ship, 'mk4-torp', 0)).not.toBeNull()
    expect(ship.mounts['mk4-torp'][0].armed).toBe(1)

    // All four mounts may be armed simultaneously, one circle each.
    for (const index of [1, 2, 3]) expect(armMount(ship, 'mk4-torp', index)).toBeNull()

    // Next round the second circle may be filled.
    for (const state of ship.mounts['mk4-torp']) state.armedThisRound = 0
    setAllocation(ship, 'f-mk4', 2)
    expect(armMount(ship, 'mk4-torp', 0)).toBeNull()
    expect(ship.mounts['mk4-torp'][0].armed).toBe(2)
    expect(mountIsReady(YORKTOWN.weapons[1], 0, ship.mounts['mk4-torp'][0])).toBe(true)
  })

  it('refuses to arm a damaged mount', () => {
    const ship = makeShip()
    setAllocation(ship, 'f-lnc447', 1)
    ship.mounts['lnc-447'][0].damage = 1
    expect(armMount(ship, 'lnc-447', 0)).not.toBeNull()
  })
})

describe('damage control (B3)', () => {
  it('lists only repairable damage', () => {
    const ship = makeShip()
    expect(repairTargets(ship)).toHaveLength(0)

    ship.systemDamage['SENS'] = 1
    ship.shieldGeneratorDamage = 1
    ship.mounts['lnc-447'][0].damage = 1
    ship.reactorDamage['l-main'][0] = 1

    const targets = repairTargets(ship)
    expect(targets.map((t) => t.category).sort()).toEqual(['engineering', 'shields', 'systems', 'weapons'])
  })

  it('will not offer red structure boxes for repair (B3.3.4)', () => {
    const ship = makeShip()
    // Damage every black box, leaving only red ones.
    const boxes = YORKTOWN.structure.filter((e) => e.kind === 'box') as Array<{ kind: 'box'; color: string }>
    boxes.forEach((box, i) => {
      if (box.color === 'black') ship.structureDamaged[i] = true
    })
    expect(repairTargets(ship).some((t) => t.category === 'structure')).toBe(true)

    boxes.forEach((_, i) => {
      ship.structureDamaged[i] = true
    })
    // With black boxes all repaired-away… mark only red as damaged.
    boxes.forEach((box, i) => {
      ship.structureDamaged[i] = box.color === 'red'
    })
    expect(repairTargets(ship).some((t) => t.category === 'structure')).toBe(false)
  })

  it('never spends more dice than the Damage Control Rating (B3.1.1)', () => {
    const ship = makeShip()
    ship.systemDamage['SENS'] = 1
    ship.shieldGeneratorDamage = 1
    const outcomes = resolveDamageControl(
      ship,
      [
        { category: 'systems', dice: 3, targetKey: 'system:SENS' },
        { category: 'shields', dice: 3, targetKey: 'shield-gen' },
      ],
      new Rng(1),
      () => {},
    )
    const totalDice = outcomes.reduce((sum, o) => sum + o.dice, 0)
    expect(totalDice).toBeLessThanOrEqual(4)
  })

  it('repairs at most one box per category (B3.2 Step 3)', () => {
    const ship = makeShip()
    ship.systemDamage['SENS'] = 2
    // Force success by giving the whole budget to one category and rolling many.
    let repairs = 0
    for (let seed = 0; seed < 40 && repairs === 0; seed++) {
      const fresh = makeShip()
      fresh.systemDamage['SENS'] = 2
      const outcomes = resolveDamageControl(
        fresh,
        [{ category: 'systems', dice: 4, targetKey: 'system:SENS' }],
        new Rng(seed),
        () => {},
      )
      if (outcomes[0].success) {
        expect(fresh.systemDamage['SENS']).toBe(1) // exactly one box repaired
        repairs += 1
      }
    }
    expect(repairs).toBe(1)
  })

  it('recharges nothing when a battery is repaired (B2.4.4)', () => {
    const ship = makeShip()
    ship.batteryDamaged[0] = true
    ship.batteryCharged[0] = false
    for (let seed = 0; seed < 40; seed++) {
      const fresh = makeShip()
      fresh.batteryDamaged[0] = true
      fresh.batteryCharged[0] = false
      const outcomes = resolveDamageControl(
        fresh,
        [{ category: 'engineering', dice: 4, targetKey: 'battery:0' }],
        new Rng(seed),
        () => {},
      )
      if (outcomes[0].success) {
        expect(fresh.batteryDamaged[0]).toBe(false)
        expect(fresh.batteryCharged[0]).toBe(false)
        return
      }
    }
    throw new Error('no successful repair in 40 seeds')
  })
})
