import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, VALLARI_CRUISER, YORKTOWN } from './ships'
import { createShip, damageControlRating, markStructure, structureBoxes } from '../engine/shipState'
import { armingCapacityThisRound } from '../engine/shipState'
import { ARC_ORDER } from '../engine/geometry'

/**
 * Integrity of the imported Master Ship Book roster.
 *
 * These are checks on the *data*, not the rules: they would catch an importer
 * regression that silently drops mounts, loses arcs, or mangles a firing chart.
 */

describe('roster', () => {
  it('imports both factions in full', () => {
    expect(SHIP_FORMS.length).toBe(72)
    const union = SHIP_FORMS.filter((f) => f.faction === 'Union of Federated Systems')
    const vallari = SHIP_FORMS.filter((f) => f.faction === 'Vallari Imperium')
    expect(union.length).toBe(37)
    expect(vallari.length).toBe(35)
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
        let previousMax = -1
        for (const bracket of weapon.brackets) {
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
