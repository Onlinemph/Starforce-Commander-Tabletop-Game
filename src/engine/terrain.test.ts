import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { ASTEROID_COUNTERS, DENSITY_STATS } from '../data/terrainCounters'
import { asteroidCoverRerolls, asteroidFieldsAt, BASE_OVERLAP, type GameState, type Terrain } from './game'

/**
 * Section K2 — asteroids from the printed counter sheet, and the K1.1/K1.2
 * random terrain that places them.
 */

const FIELD: Terrain = {
  id: 'asteroid-test',
  kind: 'asteroid-field',
  name: 'Asteroids #1',
  center: { x: 18, y: 18 },
  radius: 2,
  density: 'extreme',
  safeSpeed: DENSITY_STATS.extreme.spd,
  damageDie: DENSITY_STATS.extreme.dmgDie,
  cover: DENSITY_STATS.extreme.cover,
  scan: DENSITY_STATS.extreme.scan,
}

/** A duel with one known field, without touching the shared scenario object. */
function gameWithField(): GameState {
  const game = startScenario('s3.1-the-duel', { seed: 5 })
  game.scenario = { ...game.scenario, terrain: [...game.scenario.terrain, FIELD] }
  return game
}

describe('printed counter set', () => {
  it('carries the 26 counters at the printed density mix', () => {
    expect(ASTEROID_COUNTERS).toHaveLength(26)
    const byDensity = (d: string) => ASTEROID_COUNTERS.filter((c) => c.density === d).length
    expect(byDensity('extreme')).toBe(4)
    expect(byDensity('high')).toBe(6)
    expect(byDensity('medium')).toBe(10)
    expect(byDensity('light')).toBe(6)
    // Every id 1..26 exactly once.
    expect([...new Set(ASTEROID_COUNTERS.map((c) => c.id))].length).toBe(26)
  })

  it('statlines match the sheet: harder fields are slower, hit harder, hide better', () => {
    expect(DENSITY_STATS.extreme).toMatchObject({ spd: 2, dmgDie: 'red', cover: 4, scan: 6 })
    expect(DENSITY_STATS.high).toMatchObject({ spd: 3, dmgDie: 'yellow', cover: 3, scan: 5 })
    expect(DENSITY_STATS.medium).toMatchObject({ spd: 3, dmgDie: 'green', cover: 2, scan: 4 })
    expect(DENSITY_STATS.light).toMatchObject({ spd: 3, dmgDie: 'blue', cover: 1, scan: 3 })
  })
})

describe('asteroid cover (K2.1.8)', () => {
  it('grants cover when the defender overlaps the field', () => {
    const game = gameWithField()
    const [a, b] = game.ships
    a.placement.position = { x: 5, y: 5 }
    b.placement.position = { x: 18, y: 18 }
    expect(asteroidCoverRerolls(game, a, b)).toBe(4)
  })

  it('grants cover when the attacker overlaps, and when only the line of sight crosses', () => {
    const game = gameWithField()
    const [a, b] = game.ships
    a.placement.position = { x: 18, y: 17 }
    b.placement.position = { x: 30, y: 30 }
    expect(asteroidCoverRerolls(game, a, b)).toBe(4)

    // Straight across the field, both ships well outside it.
    a.placement.position = { x: 10, y: 18 }
    b.placement.position = { x: 26, y: 18 }
    expect(asteroidCoverRerolls(game, a, b)).toBe(4)
  })

  it('grants none when the field is uninvolved, and adds fields together', () => {
    const game = gameWithField()
    const [a, b] = game.ships
    a.placement.position = { x: 4, y: 4 }
    b.placement.position = { x: 10, y: 4 }
    expect(asteroidCoverRerolls(game, a, b)).toBe(0)

    game.scenario = {
      ...game.scenario,
      terrain: [
        ...game.scenario.terrain,
        { ...FIELD, id: 'asteroid-test-2', center: { x: 22, y: 18 }, cover: 1 },
      ],
    }
    a.placement.position = { x: 14, y: 18 }
    b.placement.position = { x: 24, y: 18 }
    expect(asteroidCoverRerolls(game, a, b)).toBe(5)
  })

  it('counts the base overlap allowance (K2.1.4)', () => {
    const game = gameWithField()
    const ship = game.ships[0]
    ship.placement.position = { x: 18 + FIELD.radius + BASE_OVERLAP - 0.01, y: 18 }
    expect(asteroidFieldsAt(game.scenario.terrain, ship.placement.position)).toHaveLength(1)
    ship.placement.position = { x: 18 + FIELD.radius + BASE_OVERLAP + 0.1, y: 18 }
    expect(asteroidFieldsAt(game.scenario.terrain, ship.placement.position)).toHaveLength(0)
  })
})

describe('random terrain (K1.1, K1.2)', () => {
  it('places the asked-for number of printed counters, 3 inches apart', () => {
    const game = startScenario('s3.1-the-duel', { seed: 77, terrain: 6 })
    const fields = game.scenario.terrain.filter((t) => t.kind === 'asteroid-field')
    expect(fields.length).toBe(6)
    for (const f of fields) {
      // Values come from the printed counter, not defaults.
      expect(f.density).toBeDefined()
      expect(f.safeSpeed).toBe(DENSITY_STATS[f.density!].spd)
      expect(f.cover).toBe(DENSITY_STATS[f.density!].cover)
    }
    for (const f of fields) {
      for (const g of fields) {
        if (f === g) continue
        const gap = Math.hypot(f.center.x - g.center.x, f.center.y - g.center.y) - f.radius - g.radius
        expect(gap).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('is deterministic from the seed — a save or a peer rebuilds the same field', () => {
    const a = startScenario('s3.1-the-duel', { seed: 123, terrain: 'roll' })
    const b = startScenario('s3.1-the-duel', { seed: 123, terrain: 'roll' })
    expect(JSON.stringify(a.scenario.terrain)).toBe(JSON.stringify(b.scenario.terrain))
    // And rolling on the K1.1 chart only ever yields 0, 4, 6 or 8 counters.
    for (let seed = 0; seed < 12; seed++) {
      const g = startScenario('s3.1-the-duel', { seed, terrain: 'roll' })
      const n = g.scenario.terrain.filter((t) => t.kind === 'asteroid-field').length
      expect([0, 4, 6, 8]).toContain(n)
    }
  })

  it('leaves the game dice untouched — same seed, same rolls, terrain or not', () => {
    const bare = startScenario('s3.1-the-duel', { seed: 9 })
    const rocky = startScenario('s3.1-the-duel', { seed: 9, terrain: 4 })
    expect(bare.rng.next()).toBe(rocky.rng.next())
  })

  it('does not pollute the shared scenario definition', () => {
    const rocky = startScenario('s3.1-the-duel', { seed: 11, terrain: 8 })
    expect(rocky.scenario.terrain.length).toBeGreaterThan(0)
    const clean = startScenario('s3.1-the-duel', { seed: 12 })
    expect(clean.scenario.terrain.filter((t) => t.kind === 'asteroid-field')).toHaveLength(0)
  })
})
