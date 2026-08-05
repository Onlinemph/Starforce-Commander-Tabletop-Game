import { describe, expect, it } from 'vitest'
import { FILE_FORMS, findShipForm, shipFormById, SHIP_FORMS, VALLARI_CRUISER, YORKTOWN } from './ships'
import { validateDesign } from '../engine/shipBuilder'
import { createShip, damageControlRating, markStructure, structureBoxes } from '../engine/shipState'
import { armingCapacityThisRound } from '../engine/shipState'
import { ARC_ORDER } from '../engine/geometry'

/**
 * Integrity of the imported roster — the Master Ship Book plus the Expansion 5
 * Aurelian Starship Book.
 *
 * These are checks on the *data*, not the rules: they would catch an importer
 * regression that silently drops mounts, loses arcs, or mangles a firing chart.
 */

describe('roster', () => {
  it('imports all three factions in full', () => {
    // 72 from the Master Ship Book plus 21 Aurelians from Expansion 5.
    expect(SHIP_FORMS.length).toBe(93)
    const union = SHIP_FORMS.filter((f) => f.faction === 'Union of Federated Systems')
    const vallari = SHIP_FORMS.filter((f) => f.faction === 'Vallari Imperium')
    const aurelian = SHIP_FORMS.filter((f) => f.faction === 'Aurelian Empire')
    expect(union.length).toBe(37)
    expect(vallari.length).toBe(35)
    expect(aurelian.length).toBe(21)
  })

  it('gives every ship a unique id', () => {
    const ids = SHIP_FORMS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every ship the stats the engine needs', () => {
    for (const form of SHIP_FORMS) {
      expect(form.sizeClass, form.name).toBeGreaterThan(0)
      expect(form.stressRating, form.name).toBeGreaterThan(0)
      expect(form.damageControlRating, form.name).toBeGreaterThan(0)
      expect(form.pointValue, form.name).toBeGreaterThan(0)
      expect(form.reactors.length, form.name).toBeGreaterThan(0)
      expect(form.weapons.length, form.name).toBeGreaterThan(0)
      expect(form.systems.length, form.name).toBeGreaterThan(0)
      expect(structureBoxes(makeShip(form)).length, form.name).toBeGreaterThan(0)
      expect(form.sublight.maxSpeed, form.name).toBeGreaterThan(0)
      expect(form.sublight.maxSpeed, form.name).toBeLessThanOrEqual(8) // C1.2.7
    }
  })

  it('gives every weapon mount a firing arc and a firing chart', () => {
    for (const form of SHIP_FORMS) {
      for (const weapon of form.weapons) {
        expect(weapon.mounts.length, `${form.name} / ${weapon.name}`).toBeGreaterThan(0)
        expect(weapon.brackets.length, `${form.name} / ${weapon.name}`).toBeGreaterThan(0)

        for (const mount of weapon.mounts) {
          expect(mount.arcs.length, `${form.name} / ${weapon.name}`).toBeGreaterThan(0)
          for (const arc of mount.arcs) expect(ARC_ORDER).toContain(arc)
          expect(mount.armingCircles).toBeGreaterThan(0)
          expect(mount.hitBoxes).toBeGreaterThan(0)
        }

        // Brackets run left to right without gaps or overlaps, and each rolls
        // at least one die (E3.2.1).
        //
        // A homing weapon's chart is divided into red endurance boxes, one per
        // phase of flight, and "the homing weapon's range begins at zero during
        // each phase" (E5.1.5) — so continuity holds inside each box and every
        // box starts again at zero.
        let previousMax = -1
        let phase = weapon.brackets[0]?.endurancePhase
        for (const bracket of weapon.brackets) {
          if (bracket.endurancePhase !== phase) {
            phase = bracket.endurancePhase
            previousMax = -1
          }
          expect(bracket.min, `${form.name} / ${weapon.name}`).toBe(previousMax + 1)
          expect(bracket.max).toBeGreaterThanOrEqual(bracket.min)
          expect(bracket.dice.length).toBeGreaterThan(0)
          previousMax = bracket.max
        }
      }
    }
  })

  it('gives every weapon system exactly one arming line (E4.2.6)', () => {
    for (const form of SHIP_FORMS) {
      for (const weapon of form.weapons) {
        const lines = form.functions.filter((l) => l.weaponSystemId === weapon.id)
        expect(lines.length, `${form.name} / ${weapon.name}`).toBe(1)
      }
    }
  })

  it('keeps the sublight tables consistent (C2.2.2, E8.5.4)', () => {
    for (const form of SHIP_FORMS) {
      const { maxSpeed, turnBySpeed, dmgTopSpeed, driveBoxes } = form.sublight
      expect(turnBySpeed.length, form.name).toBe(maxSpeed + 1)
      // Turn rates are real templates (A2.5) or 0 for "may not turn".
      for (const degrees of turnBySpeed) {
        expect([0, 20, 25, 30, 35, 40, 45, 60], form.name).toContain(degrees)
      }
      expect(dmgTopSpeed.length, form.name).toBe(driveBoxes)
      // Drive damage never raises the top speed.
      let previous = maxSpeed
      for (const speed of dmgTopSpeed) {
        expect(speed, form.name).toBeLessThanOrEqual(previous)
        previous = speed
      }
    }
  })

  it('matches shield reinforcement to the shield generator rating (G1.1.2)', () => {
    for (const form of SHIP_FORMS) {
      for (const side of ['F', 'S', 'A', 'P'] as const) {
        expect(form.shields.green[side], form.name).toBe(form.shields.generatorBoxes)
        expect(form.shields.blue[side], form.name).toBeGreaterThan(0)
      }
    }
  })

  it('reaches the printed Damage Control Rating with an undamaged hull (B1.3.4)', () => {
    for (const form of SHIP_FORMS) {
      expect(damageControlRating(makeShip(form)), form.name).toBe(form.damageControlRating)
    }
  })

  it('drops the Damage Control Rating monotonically as structure is lost (B3.1.2)', () => {
    for (const form of SHIP_FORMS) {
      const ship = makeShip(form)
      let previous = damageControlRating(ship)
      while (markStructure(ship)) {
        const now = damageControlRating(ship)
        expect(now, form.name).toBeLessThanOrEqual(previous)
        previous = now
      }
      expect(previous, form.name).toBeGreaterThanOrEqual(1)
    }
  })

  it('lets every slow-arming mount finish arming over successive rounds (E4.2.8)', () => {
    for (const form of SHIP_FORMS) {
      const ship = makeShip(form)
      for (const weapon of form.weapons) {
        weapon.mounts.forEach((mount, index) => {
          const state = ship.mounts[weapon.id][index]
          let rounds = 0
          while (state.armed < mount.armingCircles && rounds < 10) {
            // A fresh Resource Allocation Segment each round (beginRound).
            state.armedThisRound = 0
            const capacity = armingCapacityThisRound(weapon, index, state)
            expect(capacity, `${form.name} / ${weapon.name}`).toBeGreaterThan(0)
            state.armed += capacity
            state.armedThisRound = capacity
            rounds += 1
          }
          expect(state.armed, `${form.name} / ${weapon.name}`).toBe(mount.armingCircles)
          // Slow-arming weapons take two or three rounds (E4.2.8).
          expect(rounds).toBeLessThanOrEqual(3)
        })
      }
    }
  })

  it('carries the canon victory table in ascending order (S2.8.3)', () => {
    for (const form of SHIP_FORMS) {
      const table = form.victoryTable
      expect(table, form.name).toBeDefined()
      expect(table!.length, form.name).toBe(5)
      for (let i = 1; i < table!.length; i++) {
        expect(table![i].damage, form.name).toBeGreaterThanOrEqual(table![i - 1].damage)
        expect(table![i].points, form.name).toBeGreaterThanOrEqual(table![i - 1].points)
      }
      // Crippling damage never exceeds the ship's structure.
      expect(table![4].damage, form.name).toBeLessThanOrEqual(structureBoxes(makeShip(form)).length)
    }
  })
})

describe('scenario ships', () => {
  it('resolves the built-in duel ships', () => {
    expect(YORKTOWN.name).toContain('YORKTOWN')
    expect(VALLARI_CRUISER.name).toContain('RAIDER')
    expect(YORKTOWN.faction).toBe('Union of Federated Systems')
    expect(VALLARI_CRUISER.faction).toBe('Vallari Imperium')
  })

  it('matches the rulebook worked example for the Yorktown structure track (B3.1.2)', () => {
    // "3 black and 1 red" before the first Damage Control marker.
    const boxes = structureBoxes(makeShip(YORKTOWN))
    expect(boxes.slice(0, 4).map((b) => b.color)).toEqual(['black', 'black', 'black', 'red'])
    expect(YORKTOWN.damageControlRating).toBe(4)
  })
})

function makeShip(form: (typeof SHIP_FORMS)[number]) {
  return createShip({
    id: 'x',
    side: 'test',
    name: form.name,
    form,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 0,
  })
}

// ---------------------------------------------------------------------------
// Expansion 5: the Aurelian Empire
// ---------------------------------------------------------------------------

describe('Aurelian roster (Expansion 5)', () => {
  const aurelian = SHIP_FORMS.filter((f) => f.faction === 'Aurelian Empire')

  it('gives every Aurelian ship a cloaking system (H6.1.4)', () => {
    for (const form of aurelian) {
      const cloak = form.systems.find((g) => g.kind === 'CLOAK')
      expect(cloak, form.name).toBeTruthy()
      expect(cloak!.boxes, form.name).toBeGreaterThan(0)
      // A cloak needs a power line to charge it (H6.3.1).
      const line = form.functions.find((l) => l.label === 'CLOAK')
      expect(line, form.name).toBeTruthy()
      expect(line!.steps.length, form.name).toBeGreaterThan(0)
    }
  })

  it('imports the plasma torpedo as a homing particle weapon (F5.1.2, F5.4)', () => {
    const passer = findShipForm('PASSER I-class Frigate')!
    const torp = passer.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    expect(torp.name).toBe('RP-F SMALL PLASMA TORP')
    expect(torp.traits).toEqual(['HOMING 3', 'PARTCL', 'NoBAT', 'FTL'])
  })

  it('reads the red endurance boxes off the firing chart (E5.1.5)', () => {
    const torp = findShipForm('PASSER I-class Frigate')!.weapons.find(
      (w) => w.weaponClass === 'plasma-torpedo',
    )!
    // Three red boxes: 3 inches in phase one, 6 in phase two, 9 in phase three,
    // with bonus damage falling off as the plasma dissipates.
    expect(
      torp.brackets.map((b) => [b.endurancePhase, b.min, b.max, b.bonus]),
    ).toEqual([
      [1, 0, 3, 4],
      [2, 0, 6, 3],
      [3, 0, 9, 2],
    ])
  })

  it('gives every plasma torpedo an endurance and a homing trait', () => {
    for (const form of aurelian) {
      for (const weapon of form.weapons) {
        if (weapon.weaponClass !== 'plasma-torpedo') continue
        expect(weapon.traits.some((t) => t.startsWith('HOMING')), weapon.name).toBe(true)
        expect(weapon.traits, weapon.name).toContain('PARTCL')
        const phases = weapon.brackets.map((b) => b.endurancePhase ?? 0)
        expect(Math.max(...phases), `${form.name} / ${weapon.name}`).toBeGreaterThan(0)
        // Endurance boxes are numbered from one with no gaps.
        expect([...new Set(phases)].sort()).toEqual(
          Array.from({ length: Math.max(...phases) }, (_, i) => i + 1),
        )
      }
    }
  })

  it('leaves direct-fire weapons without endurance boxes', () => {
    for (const form of SHIP_FORMS) {
      for (const weapon of form.weapons) {
        const homing = weapon.traits.some((t) => t.startsWith('HOMING'))
        for (const bracket of weapon.brackets) {
          if (!homing) expect(bracket.endurancePhase, weapon.name).toBeUndefined()
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Designs committed to the repository
// ---------------------------------------------------------------------------

describe('customShips.json', () => {
  it('is a JSON array, so the app can always boot', () => {
    // A malformed file here would take the whole site down at load, and it is
    // hand-edited by whoever commits a design.
    expect(Array.isArray(FILE_FORMS)).toBe(true)
  })

  it('never shadows a canon ship', () => {
    const canon = new Set(SHIP_FORMS.map((f) => f.id))
    for (const form of FILE_FORMS) {
      expect(canon.has(form.id), `${form.id} collides with a printed ship`).toBe(false)
    }
  })

  it('holds no duplicate ids', () => {
    expect(new Set(FILE_FORMS.map((f) => f.id)).size).toBe(FILE_FORMS.length)
  })

  it('holds only designs that are legal to play', () => {
    for (const form of FILE_FORMS) {
      const errors = validateDesign(form).filter((p) => p.severity === 'error')
      expect(errors, `${form.name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('is reachable by id like any other form', () => {
    for (const form of FILE_FORMS) {
      expect(shipFormById(form.id)?.name).toBe(form.name)
    }
  })
})

/**
 * Guards against a whole-faction extraction failure, which is how twenty-one
 * Aurelian hulls came to carry their marine squads in the shuttle field.
 *
 * Their ship book draws a taller rocket badge than the master book — 38x65
 * against 28x51 — so it fell outside the extractor's size filter, only one
 * badge survived the page, and it was taken as the shuttle count by position.
 * Every Aurelian ship read as zero marines and a wildly inflated small-craft
 * complement: an assault cruiser with twenty-eight shuttles and no troops.
 *
 * No single ship looked impossible, which is exactly why it survived. The
 * shape of the bug is per-faction, so the check has to be too.
 */
describe('the printed roster, faction by faction', () => {
  const factions = [...new Set(FILE_FORMS.map((f) => f.faction))]

  it('gives every faction some ships that carry marines', () => {
    for (const faction of factions) {
      const hulls = FILE_FORMS.filter((f) => f.faction === faction)
      const armed = hulls.filter((f) => (f.marineSquads ?? 0) > 0)
      expect(armed.length, `${faction}: ${hulls.length} hulls, none with marines`).toBeGreaterThan(0)
    }
  })

  it('never gives a hull more shuttles than marine squads', () => {
    // True of every printed ship in every book, and the inversion is the
    // signature of the two badges being read the wrong way round.
    for (const form of FILE_FORMS) {
      const shuttles = form.shuttles ?? 0
      const marines = form.marineSquads ?? 0
      if (marines === 0) continue
      expect(shuttles, `${form.name} carries ${shuttles} shuttles to ${marines} squads`).toBeLessThanOrEqual(marines)
    }
  })
})
