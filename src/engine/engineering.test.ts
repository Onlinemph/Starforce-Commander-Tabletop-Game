import { describe, expect, it } from 'vitest'
import { YORKTOWN } from '../data/ships'

const TORPEDO = YORKTOWN.weapons.find((w) => w.weaponClass === 'a-mat-torpedo')!
const PHASER = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!
const TORP_LINE = YORKTOWN.functions.find((l) => l.weaponSystemId === TORPEDO.id)!
const PHASER_LINE = YORKTOWN.functions.find((l) => l.weaponSystemId === PHASER.id)!
const reactorPoints = YORKTOWN.reactors.reduce((n, r) => n + r.points.length, 0)
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

/**
 * Fill FUNCTIONS circles until nothing legal can take another point, and return
 * the power left over. Lines that refuse the change are skipped rather than
 * retried, so this always terminates.
 */
function spendEverything(ship: ShipState): number {
  const lines = YORKTOWN.functions.filter((l) => l.kind !== 'shield-repair')
  let progressed = true
  while (progressed && powerRemaining(ship) > 0) {
    progressed = false
    for (const line of lines) {
      if (powerRemaining(ship) === 0) break
      const filled = ship.allocation[line.id] ?? 0
      if (filled >= line.steps.length) continue
      if (setAllocation(ship, line.id, filled + 1) === null) progressed = true
    }
  }
  return powerRemaining(ship)
}

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
  it('matches the TOTAL POWER printed on the form', () => {
    const ship = makeShip()
    expect(reactorPower(ship)).toBe(reactorPoints)
    expect(batteryPower(ship)).toBe(YORKTOWN.batteries)
    expect(totalPowerAvailable(ship)).toBe(reactorPoints + YORKTOWN.batteries)
  })

  it('loses a power point only when every box on it is damaged (E8.5.1)', () => {
    const ship = makeShip()
    const group = YORKTOWN.reactors[0]
    const boxes = group.points[0].boxes
    ship.reactorDamage[group.id][0] = boxes - 1
    expect(reactorPower(ship)).toBe(reactorPoints)
    ship.reactorDamage[group.id][0] = boxes
    expect(reactorPower(ship)).toBe(reactorPoints - 1)
  })
})

describe('resource allocation (B2.2)', () => {
  it('refuses to spend more power than the ship has', () => {
    const ship = makeShip()
    expect(spendEverything(ship)).toBe(0)

    // With every reactor point and battery committed, one more circle is refused.
    const spare = YORKTOWN.functions.find(
      (l) => l.kind === 'accel' && l.steps.length > (ship.allocation[l.id] ?? 0),
    )
    if (spare) {
      expect(setAllocation(ship, spare.id, (ship.allocation[spare.id] ?? 0) + 1)).not.toBeNull()
    }
  })

  it('reads capability off the sequential circles (B2.2.2)', () => {
    const ship = makeShip()
    const accel = YORKTOWN.functions.find((l) => l.kind === 'accel')!
    // Free power alone gives the printed free value…
    expect(lineValue(ship, accel.id)).toBe(accel.freeValue)
    // …and filling every circle gives the value printed beside the last one.
    setAllocation(ship, accel.id, accel.steps.length)
    expect(lineValue(ship, accel.id)).toBe(accel.steps[accel.steps.length - 1].value)
  })

  it('steps a weapon line through its printed arming points (E4.1)', () => {
    const ship = makeShip()
    expect(lineValue(ship, PHASER_LINE.id)).toBe(PHASER_LINE.freeValue)
    PHASER_LINE.steps.forEach((step, i) => {
      setAllocation(ship, PHASER_LINE.id, i + 1)
      expect(lineValue(ship, PHASER_LINE.id)).toBe(step.value)
    })
  })

  it('steps the sensor line through its printed values (H2.2.1)', () => {
    const ship = makeShip()
    const sensor = YORKTOWN.functions.find((l) => l.kind === 'sensor')!
    expect(lineValue(ship, sensor.id)).toBe(sensor.freeValue)
    sensor.steps.forEach((step, i) => {
      setAllocation(ship, sensor.id, i + 1)
      expect(lineValue(ship, sensor.id)).toBe(step.value)
    })
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
    const gen = YORKTOWN.shields.generatorBoxes
    ship.blueShieldDamage.F = 8
    setAllocation(ship, 'repr-F', 1)
    commitAllocation(ship)
    expect(blueShieldRemaining(ship, 'F')).toBe(YORKTOWN.shields.blue.F - (8 - gen))
  })

  it('activates green boxes equal to the generator rating when reinforcing (G1.3.2)', () => {
    const ship = makeShip()
    setAllocation(ship, 'rnfc-F', 1)
    commitAllocation(ship)
    expect(greenShieldRemaining(ship, 'F')).toBe(YORKTOWN.shields.generatorBoxes)
  })

  it('reinforces less when shield generators are damaged (G1.3.2)', () => {
    const ship = makeShip()
    ship.shieldGeneratorDamage = 1
    setAllocation(ship, 'rnfc-F', 1)
    commitAllocation(ship)
    expect(greenShieldRemaining(ship, 'F')).toBe(YORKTOWN.shields.generatorBoxes - 1)
  })

  it('drains a battery when allocation exceeds reactor output (B2.4.1)', () => {
    const ship = makeShip()
    expect(spendEverything(ship)).toBe(0)
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
    // Free power alone already generates the line's free arming points.
    expect(armingPointsAvailable(ship, PHASER.id)).toBe(PHASER_LINE.freeValue)
    setAllocation(ship, PHASER_LINE.id, PHASER_LINE.steps.length)
    expect(armingPointsAvailable(ship, PHASER.id)).toBe(
      PHASER_LINE.steps[PHASER_LINE.steps.length - 1].value,
    )
  })

  it('distributes arming points across mounts of the same system', () => {
    const ship = makeShip()
    setAllocation(ship, PHASER_LINE.id, PHASER_LINE.steps.length)
    const budget = armingPointsAvailable(ship, PHASER.id)

    let spent = 0
    for (let index = 0; index < PHASER.mounts.length && spent < budget; index++) {
      for (let c = 0; c < PHASER.mounts[index].armingCircles && spent < budget; c++) {
        expect(armMount(ship, PHASER.id, index)).toBeNull()
        spent += 1
      }
      if (spent <= budget) {
        expect(mountIsReady(PHASER, index, ship.mounts[PHASER.id][index])).toBe(true)
      }
    }
    // Spend any remainder across the mounts, then confirm the budget is closed.
    for (let i = 0; i < PHASER.mounts.length * 4; i++) {
      if (armingPointsAvailable(ship, PHASER.id) === 0) break
      armMount(ship, PHASER.id, i % PHASER.mounts.length)
    }
    expect(armingPointsAvailable(ship, PHASER.id)).toBe(0)
    expect(armMount(ship, PHASER.id, 0)).not.toBeNull()
  })

  it('will not transfer arming points between weapon systems (E4.2.6)', () => {
    const ship = makeShip()
    setAllocation(ship, PHASER_LINE.id, 1)
    // The torpedo line has no power, so only its own free points are available.
    expect(armingPointsAvailable(ship, TORPEDO.id)).toBe(TORP_LINE.freeValue)
  })

  it('will not pull power off a weapon line after its points are spent (E4.2.7)', () => {
    const ship = makeShip()
    setAllocation(ship, PHASER_LINE.id, PHASER_LINE.steps.length)
    const budget = armingPointsAvailable(ship, PHASER.id)
    for (let i = 0; i < budget; i++) armMount(ship, PHASER.id, i % PHASER.mounts.length)
    expect(setAllocation(ship, PHASER_LINE.id, 0)).not.toBeNull()
  })

  it('stops slow-arming weapons at the diamond (E4.2.8)', () => {
    const ship = makeShip()
    setAllocation(ship, TORP_LINE.id, TORP_LINE.steps.length)
    const mount = TORPEDO.mounts[0]
    expect(mount.roundGates?.some(Boolean)).toBe(true)

    // One circle fills; the diamond blocks the next until a later round.
    expect(armMount(ship, TORPEDO.id, 0)).toBeNull()
    expect(armMount(ship, TORPEDO.id, 0)).not.toBeNull()
    expect(ship.mounts[TORPEDO.id][0].armed).toBe(1)

    // Every mount may take its first circle in the same segment.
    for (let i = 1; i < TORPEDO.mounts.length; i++) {
      expect(armMount(ship, TORPEDO.id, i)).toBeNull()
    }

    // Next round the circle past the diamond may be filled.
    for (const state of ship.mounts[TORPEDO.id]) state.armedThisRound = 0
    setAllocation(ship, TORP_LINE.id, TORP_LINE.steps.length)
    expect(armMount(ship, TORPEDO.id, 0)).toBeNull()
    expect(ship.mounts[TORPEDO.id][0].armed).toBe(2)
  })

  it('refuses to arm a damaged mount', () => {
    const ship = makeShip()
    setAllocation(ship, PHASER_LINE.id, 1)
    ship.mounts[PHASER.id][0].damage = PHASER.mounts[0].hitBoxes
    expect(armMount(ship, PHASER.id, 0)).not.toBeNull()
  })
})

describe('damage control (B3)', () => {
  it('lists only repairable damage', () => {
    const ship = makeShip()
    expect(repairTargets(ship)).toHaveLength(0)

    ship.systemDamage['SENS'] = 1
    ship.shieldGeneratorDamage = 1
    ship.mounts[PHASER.id][0].damage = 1
    ship.reactorDamage[YORKTOWN.reactors[0].id][0] = 1

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

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Every one of these turns a click down. The UI shows the message, because a
 * button that silently does nothing reads as a broken game rather than a rule —
 * which is exactly how weapon allocation looked before the messages existed.
 */
describe('why an allocation is refused', () => {
  it('says so when the ship has no power left (B2.2.1)', () => {
    const ship = makeShip()
    expect(spendEverything(ship)).toBe(0)
    const line = YORKTOWN.functions.find((l) => (ship.allocation[l.id] ?? 0) < l.steps.length)!
    const error = setAllocation(ship, line.id, (ship.allocation[line.id] ?? 0) + 1)
    expect(error?.message).toBe('Not enough power available.')
    // And the refusal leaves the allocation exactly as it was.
    expect(powerRemaining(ship)).toBe(0)
  })

  it('says so when arming points are already spent on mounts (E4.2.7)', () => {
    const ship = makeShip()
    expect(setAllocation(ship, PHASER_LINE.id, 1)).toBeNull()
    expect(armMount(ship, PHASER.id, 0)).toBeNull()
    expect(armMount(ship, PHASER.id, 1)).toBeNull()

    const error = setAllocation(ship, PHASER_LINE.id, 0)
    expect(error?.message).toMatch(/2 arming point\(s\) already spent/)
    // The power stays on the line rather than half-reverting.
    expect(ship.allocation[PHASER_LINE.id]).toBe(1)
  })

  it('says so when a slow-arming diamond blocks the next circle (E4.2.8)', () => {
    const ship = makeShip()
    expect(TORPEDO.mounts[0].roundGates?.[0]).toBe(true)
    expect(setAllocation(ship, TORP_LINE.id, 1)).toBeNull()

    expect(armMount(ship, TORPEDO.id, 0)).toBeNull()
    const error = armMount(ship, TORPEDO.id, 0)
    expect(error?.message).toMatch(/E4\.2\.8/)
  })

  it('says so when the mount is already full', () => {
    const ship = makeShip()
    setAllocation(ship, PHASER_LINE.id, 2)
    const circles = PHASER.mounts[0].armingCircles
    for (let i = 0; i < circles; i += 1) expect(armMount(ship, PHASER.id, 0)).toBeNull()
    expect(armMount(ship, PHASER.id, 0)?.message).toMatch(/already fully armed/)
  })

  it('says so when the weapon has no arming points left', () => {
    const ship = makeShip()
    // Free power alone gives this line one arming point.
    expect(armingPointsAvailable(ship, PHASER.id)).toBe(PHASER_LINE.freeValue)
    expect(armMount(ship, PHASER.id, 0)).toBeNull()
    expect(armMount(ship, PHASER.id, 1)?.message).toMatch(/No arming points remaining/)
  })

  it('never refuses without leaving the ship untouched', () => {
    const ship = makeShip()
    const before = JSON.stringify({ alloc: ship.allocation, mounts: ship.mounts })
    setAllocation(ship, PHASER_LINE.id, 99)
    armMount(ship, PHASER.id, 99)
    armMount(ship, 'no-such-weapon', 0)
    expect(JSON.stringify({ alloc: ship.allocation, mounts: ship.mounts })).toBe(before)
  })
})
