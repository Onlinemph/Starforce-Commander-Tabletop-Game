import { afterEach, describe, expect, it } from 'vitest'
import { facingToHeading } from './scenarios'
import {
  registerCustomScenarios,
  scenarioSides,
  setEmbeddedScenario,
  startScenario,
  type CustomScenario,
} from './scenarios'
import { SCENARIOS } from './scenarios'
import { buildGame, parseSavedGame, replayGame, withEmbeddedForms, type SavedGame } from './savedGame'
import { applyAction, type GameAction } from '../engine/actions'
import { shipFormById } from './ships'
import fileScenarios from './customScenarios.json'

/**
 * Designed scenarios: the data format, its resolution through the same lookup
 * as the printed set, and the embed that lets a battle file carry its own
 * scenario to a machine that has never seen it.
 */

const KESSEL: CustomScenario = {
  id: 'scenario-kessel-run',
  name: 'The Kessel Run',
  background: 'A convoy dash through the rocks.',
  victory: 'Damage levels inflicted (S2.8.4).',
  specialRules: ['A designed scenario.'],
  bounds: { width: 30, height: 30, fixed: true },
  terrain: [
    {
      id: 'kessel-rocks',
      kind: 'asteroid-field',
      name: 'Asteroids #1',
      center: { x: 15, y: 15 },
      radius: 2,
      density: 'extreme',
      safeSpeed: 2,
      damageDie: 'red',
      cover: 4,
      scan: 6,
    },
  ],
  sides: [
    {
      side: 'Blue Force',
      objective: 'Get through.',
      facing: 2,
      speed: 3,
      anchor: { x: 4, y: 15 },
      spread: { x: 0, y: 2 },
      force: ['union-yorktown-i-class-heavy-cruiser'],
    },
    {
      side: 'Red Force',
      objective: 'Stop them.',
      facing: 6,
      speed: 3,
      anchor: { x: 26, y: 15 },
      spread: { x: 0, y: 2 },
      force: ['vallari-v-7c-raider-class-battlecruiser'],
    },
  ],
}

afterEach(() => {
  registerCustomScenarios([])
  setEmbeddedScenario(null)
})

describe('designed scenarios', () => {
  it('resolves through the same lookup as the printed set', () => {
    registerCustomScenarios([KESSEL])
    expect(scenarioSides('scenario-kessel-run')).toEqual(['Blue Force', 'Red Force'])

    const game = startScenario('scenario-kessel-run', { seed: 5 })
    expect(game.scenario.name).toBe('The Kessel Run')
    expect(game.scenario.bounds.width).toBe(30)
    expect(game.scenario.terrain.some((t) => t.id === 'kessel-rocks')).toBe(true)

    // Deployment: anchors, compass facings and announced speed all hold.
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    expect(blue.placement.position).toEqual({ x: 4, y: 15 })
    expect(blue.placement.heading).toBe(facingToHeading(2))
    expect(blue.speed).toBe(3)
    expect(blue.form.id).toBe('union-yorktown-i-class-heavy-cruiser')
  })

  it('travels inside a battle file and replays with no local registry', () => {
    registerCustomScenarios([KESSEL])
    const setup = withEmbeddedForms({ scenarioId: 'scenario-kessel-run', seed: 9 })
    expect(setup.customScenario?.id).toBe('scenario-kessel-run')

    // Play a few actions, save, then wipe the local registry — the other
    // machine has never seen this design.
    const game = buildGame(setup)
    const journal: GameAction[] = [{ type: 'advance-segment' }, { type: 'advance-segment' }]
    for (const a of journal) applyAction(game, a)
    const text = JSON.stringify({ version: 1, setup, actions: journal })

    registerCustomScenarios([])
    setEmbeddedScenario(null)
    const parsed = parseSavedGame(text)
    expect(typeof parsed).not.toBe('string')
    const rebuilt = replayGame(parsed as SavedGame)
    expect(rebuilt.scenario.name).toBe('The Kessel Run')
    expect(rebuilt.segment).toBe(game.segment)
    expect(JSON.stringify(rebuilt.ships.map((s) => s.placement))).toBe(
      JSON.stringify(game.ships.map((s) => s.placement)),
    )
  })

  it('the embedded scenario wins the lookup over a same-id local draft', () => {
    registerCustomScenarios([{ ...KESSEL, name: 'Edited Local Draft' }])
    setEmbeddedScenario(KESSEL)
    const game = startScenario('scenario-kessel-run', { seed: 1 })
    expect(game.scenario.name).toBe('The Kessel Run')
  })

  it('built-in scenarios never embed', () => {
    const setup = withEmbeddedForms({ scenarioId: 's3.1-the-duel', seed: 1 })
    expect(setup.customScenario).toBeUndefined()
  })

  it('the committed customScenarios.json stays honest', () => {
    // A bad hand-edit fails here instead of blanking the site.
    expect(Array.isArray(fileScenarios)).toBe(true)
    const list = fileScenarios as unknown as CustomScenario[]
    const ids = list.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of list) {
      expect(SCENARIOS.some((e) => e.scenario.id === s.id)).toBe(false)
      expect(s.sides.length).toBeGreaterThanOrEqual(2)
      for (const side of s.sides) {
        expect(side.force.length).toBeGreaterThan(0)
        for (const id of side.force) expect(shipFormById(id), `${s.id}: ${id}`).toBeTruthy()
      }
    }
  })
})
