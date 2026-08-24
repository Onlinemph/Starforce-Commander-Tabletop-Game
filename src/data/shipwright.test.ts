import { describe, expect, it } from 'vitest'
import {
  addCatalogWeapon,
  buildChassis,
  catalogFor,
  chassisOptions,
  hullEnvelope,
  removeWeapon,
  shipwrightBudget,
  shipwrightViolations,
  TECH_LEVELS,
  techLevelOfYear,
  weaponCatalog,
  weaponFloor,
} from './shipwright'
import { SHIP_FORMS } from './ships'
import type { ShipForm } from '../engine/types'

const canon = SHIP_FORMS.filter((f) => !f.id.startsWith('fan-'))

describe('the permanent property: every canon ship is a legal Shipwright design', () => {
  it('passes its own envelope at its own generation, faction-locked', () => {
    for (const form of canon) {
      const violations = shipwrightViolations(form, { techLevel: techLevelOfYear(form.year) })
      expect(violations, `${form.name} (${form.id}): ${violations.map((v) => v.message).join(' | ')}`).toEqual([])
    }
  })
})

describe('tech levels ride the in-universe timeline', () => {
  it('the Yorktown marks land one per generation', () => {
    expect(techLevelOfYear(3645)).toBe(1) // Yorktown I
    expect(techLevelOfYear(3655)).toBe(2) // Yorktown II
    expect(techLevelOfYear(3662)).toBe(3) // Yorktown III
    expect(techLevelOfYear(3667)).toBe(4) // Yorktown IV
    expect(techLevelOfYear(3672)).toBe(5) // Yorktown V
    expect(TECH_LEVELS).toHaveLength(5)
  })

  it('an early generation shops a smaller catalog and yard', () => {
    const faction = 'Union of Federated Systems'
    const early = catalogFor({ faction, sizeClass: 7, techLevel: 1 })
    const late = catalogFor({ faction, sizeClass: 7, techLevel: 5 })
    expect(early.length).toBeGreaterThan(0)
    expect(late.length).toBeGreaterThan(early.length)
    expect(chassisOptions(faction, 1).length).toBeLessThan(chassisOptions(faction, 5).length)
    for (const entry of early) expect(entry.introYear).toBeLessThanOrEqual(3654)
  })
})

describe('the envelope binds', () => {
  it('grows with the hull, and the missing size 6 interpolates', () => {
    const s2 = hullEnvelope(2)
    const s5 = hullEnvelope(5)
    const s6 = hullEnvelope(6)
    const s7 = hullEnvelope(7)
    expect(s5.powerBudget).toBeGreaterThan(s2.powerBudget)
    expect(s5.maxHeavyMounts).toBeGreaterThan(s2.maxHeavyMounts)
    expect(s6.powerBudget).toBeGreaterThan(s5.powerBudget)
    expect(s6.powerBudget).toBeLessThanOrEqual(s7.powerBudget)
  })

  it('the size-2 torpedo boat the freeform builder allowed is refused here', () => {
    const donor = chassisOptions('Union of Federated Systems', 5).find((c) => c.sizeClass === 2)!
    const hull = buildChassis(donor.donorId, 'Silly Torpedo Boat')
    expect(typeof hull).not.toBe('string')
    const form = hull as ShipForm
    const torpedo = weaponCatalog().find((e) => e.heavy && e.factions.includes(form.faction))!
    addCatalogWeapon(form, torpedo, 20)
    const violations = shipwrightViolations(form, { techLevel: 5 })
    const rules = violations.map((v) => v.rule)
    expect(rules).toContain('mounts')
    expect(rules).toContain('heavy-mounts')
  })
})

describe('the catalog', () => {
  it('carries every canon weapon once, with floor, year, factions and template', () => {
    const entries = weaponCatalog()
    expect(entries.length).toBeGreaterThanOrEqual(60)
    for (const entry of entries) {
      expect(entry.weapon.brackets.length).toBeGreaterThan(0)
      expect(entry.armingLine.kind).toBe('weapon')
      expect(entry.factions.length).toBeGreaterThan(0)
      expect(weaponFloor(entry)).toBeGreaterThanOrEqual(1)
      expect(entry.introYear).toBeGreaterThan(3600)
    }
  })

  it('size floors and faction locks filter the shop', () => {
    const faction = 'Vallari Imperium'
    const small = catalogFor({ faction, sizeClass: 2, techLevel: 5 })
    const large = catalogFor({ faction, sizeClass: 7, techLevel: 5 })
    expect(large.length).toBeGreaterThan(small.length)
    for (const entry of small) expect(weaponFloor(entry)).toBeLessThanOrEqual(2)
    for (const entry of small) expect(entry.factions).toContain(faction)
    const open = catalogFor({ faction, sizeClass: 7, techLevel: 5, openCatalog: true })
    expect(open.length).toBeGreaterThan(large.length) // the toggle opens the borders
  })
})

describe('laying down and arming a hull', () => {
  function laidDown(): ShipForm {
    const donor = chassisOptions('Union of Federated Systems', 3).find((c) => c.sizeClass === 4)!
    return buildChassis(donor.donorId, 'PATHFINDER-class Test Cruiser') as ShipForm
  }

  it('a chassis is the donor with the guns removed, marked provisional', () => {
    const form = laidDown()
    expect(form.weapons).toEqual([])
    expect(form.functions.some((l) => l.kind === 'weapon')).toBe(false)
    expect(form.functions.some((l) => l.kind === 'sensor')).toBe(true) // the hull remains
    expect(form.provisional).toBe(true)
    expect(form.name).toBe('PATHFINDER-class Test Cruiser')
  })

  it('arming from the catalog stays within budget and validates clean', () => {
    const form = laidDown()
    const shop = catalogFor({ faction: form.faction, sizeClass: form.sizeClass, techLevel: 3 })
    expect(shop.length).toBeGreaterThan(0)
    const phaser = shop.find((e) => !e.heavy)!
    addCatalogWeapon(form, phaser, 2, 'forward')
    expect(form.weapons).toHaveLength(1)
    expect(form.weapons[0].mounts).toHaveLength(2)
    expect(form.weapons[0].mounts[0].arcs).toEqual(['FP', 'FS'])
    expect(form.functions.filter((l) => l.kind === 'weapon')).toHaveLength(1)
    expect(shipwrightViolations(form, { techLevel: 3 })).toEqual([])

    const budget = shipwrightBudget(form)
    expect(budget.power).toBeLessThanOrEqual(budget.envelope.powerBudget)
    expect(budget.mounts).toBe(2)

    removeWeapon(form, form.weapons[0].id)
    expect(form.weapons).toEqual([])
    expect(form.functions.some((l) => l.kind === 'weapon')).toBe(false)
  })

  it('the discipline catches what the fiction never fielded', () => {
    const form = laidDown()
    // A weapon from beyond this hull's generation.
    const future = weaponCatalog().find(
      (e) => e.factions.includes(form.faction) && e.introYear > 3666 && weaponFloor(e) <= form.sizeClass,
    )!
    addCatalogWeapon(form, future, 1)
    expect(shipwrightViolations(form, { techLevel: 3 }).map((v) => v.rule)).toContain('tech-level')
    removeWeapon(form, form.weapons[0].id)

    // Another faction's hardware, closed and open catalog.
    const foreign = weaponCatalog().find(
      (e) => !e.factions.includes(form.faction) && weaponFloor(e) <= form.sizeClass && e.introYear <= 3666,
    )!
    addCatalogWeapon(form, foreign, 1)
    expect(shipwrightViolations(form, { techLevel: 3 }).map((v) => v.rule)).toContain('faction')
    expect(
      shipwrightViolations(form, { techLevel: 3, openCatalog: true }).map((v) => v.rule),
    ).not.toContain('faction')

    // A made-up weapon is not in the catalog at all.
    removeWeapon(form, form.weapons[0].id)
    form.weapons.push({
      id: 'homebrew-1',
      name: 'HOMEBREW DOOM CANNON',
      weaponClass: 'custom',
      mounts: [{ id: 'homebrew-1-m1', arcs: ['FS'], armingCircles: 1, hitBoxes: 1 }],
      brackets: [{ min: 0, max: 5, band: 'green', dice: ['red'] }],
      traits: [],
    })
    expect(shipwrightViolations(form, { techLevel: 5 }).map((v) => v.rule)).toContain('catalog')
  })
})
