import { describe, expect, it } from 'vitest'
import { startScenario } from '../../data/scenarios'
import type { GameState } from '../../engine/game'
import { MAX_WINDOWS, boardWindows } from './backdrop'
import { blockedSightlines, sightlineCut } from './visibility'

/** The orbital ambush, with its first ship either side of the colony world. */
function aroundThePlanet(offsetOfFirst: (planet: { x: number; y: number; r: number }) => { x: number; y: number }): {
  game: GameState
  firstId: string
  secondId: string
} {
  const game = startScenario('s3.3-orbital-ambush', { seed: 2 })
  const world = game.scenario.terrain.find((t) => t.kind === 'planet')!
  const planet = { x: world.center.x, y: world.center.y, r: world.radius }
  const first = game.ships[0]
  const second = game.ships.find((s) => s.side !== first.side)!
  first.placement = { ...first.placement, position: offsetOfFirst(planet) }
  second.placement = { ...second.placement, position: { x: planet.x + planet.r + 3, y: planet.y } }
  return { game, firstId: first.id, secondId: second.id }
}

describe('blockedSightlines', () => {
  it('names the world between the selected ship and an enemy behind it (E2.3.1)', () => {
    const { game, firstId, secondId } = aroundThePlanet((p) => ({ x: p.x - p.r - 3, y: p.y }))
    const hidden = blockedSightlines(game, firstId, null)
    expect(hidden.get(secondId)?.kind).toBe('planet')
  })

  it('lets a ship over the world see past it (K3.1.3)', () => {
    const { game, firstId, secondId } = aroundThePlanet((p) => ({ x: p.x - p.r * 0.5, y: p.y }))
    expect(blockedSightlines(game, firstId, null).has(secondId)).toBe(false)
  })

  it('says nothing with no ship selected', () => {
    const { game } = aroundThePlanet((p) => ({ x: p.x - p.r - 3, y: p.y }))
    expect(blockedSightlines(game, null, null).size).toBe(0)
  })
})

describe('sightlineCut', () => {
  const world = { center: { x: 10, y: 0 }, radius: 2 }

  it('finds where the line first meets the circle', () => {
    expect(sightlineCut({ x: 0, y: 0 }, { x: 20, y: 0 }, world)).toBeCloseTo(0.4)
  })

  it('is null for a line that misses', () => {
    expect(sightlineCut({ x: 0, y: 5 }, { x: 20, y: 5 }, world)).toBeNull()
  })
})

describe('boardWindows', () => {
  it('opens the board over planets and moons only', () => {
    const game = startScenario('s3.3-orbital-ambush', { seed: 2 })
    const windows = boardWindows(game.scenario.terrain)
    const worlds = game.scenario.terrain.filter((t) => t.kind === 'planet' || t.kind === 'moon')
    expect(windows).toHaveLength(MAX_WINDOWS)
    expect(windows.filter((w) => w.z > 0)).toHaveLength(worlds.length)
    expect(windows[0].toArray()).toEqual([worlds[0].center.x, worlds[0].center.y, worlds[0].radius])
  })
})
