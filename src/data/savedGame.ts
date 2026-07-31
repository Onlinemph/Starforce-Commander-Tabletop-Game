import { applyAction, type GameAction } from '../engine/actions'
import type { GameState } from '../engine/game'
import type { ShipForm } from '../engine/types'
import { SHIP_FORMS, setEmbeddedForms, shipFormById } from './ships'
import { startScenario } from './scenarios'

/**
 * A battle is (setup + actions), nothing more.
 *
 * The engine is deterministic and the RNG is seeded, so replaying the same
 * actions over the same setup reconstructs the same game exactly. That single
 * fact is what powers save/resume, undo, replays — and, later, remote play,
 * where two browsers exchanging actions stay in step without a server.
 */

export interface GameSetup {
  scenarioId: string
  seed: number
  coordinatedFire?: boolean
  /** One form id per side — the ship builder's quick launch. */
  forms?: Partial<Record<string, string>>
  /** A whole force per side, one form id per hull (S2.5.1). */
  fleets?: Partial<Record<string, string[]>>
  /** Random asteroid terrain (K1.1): 'roll' or an exact counter count. */
  terrain?: 'roll' | number
  /** Sides the computer commands. Carried in the save so a resumed battle keeps playing itself. */
  aiSides?: string[]
  /**
   * Every non-canon form the fleets reference, embedded whole, so the battle
   * replays on a machine that has never seen the design.
   */
  customForms?: ShipForm[]
}

export interface SavedGame {
  /** Bumped only when a change breaks replay of older saves. */
  version: 1
  setup: GameSetup
  actions: GameAction[]
}

/** Build the round-zero game a setup describes. */
export function buildGame(setup: GameSetup): GameState {
  setEmbeddedForms(setup.customForms ?? [])
  return startScenario(setup.scenarioId, {
    seed: setup.seed,
    coordinatedFire: setup.coordinatedFire ?? false,
    forms: setup.forms,
    fleets: setup.fleets,
    terrain: setup.terrain,
  })
}

/**
 * Reconstruct a battle from its record. Action outcomes are discarded — every
 * handler re-derives its context from game state, so the mutations land
 * exactly as they did the first time.
 */
export function replayGame(saved: SavedGame): GameState {
  const game = buildGame(saved.setup)
  for (const action of saved.actions) applyAction(game, action)
  return game
}

/**
 * Fill in `customForms` for a setup: every referenced form that is not in the
 * canon roster travels with the save.
 */
export function withEmbeddedForms(setup: GameSetup): GameSetup {
  const ids = new Set<string>()
  for (const id of Object.values(setup.forms ?? {})) if (id) ids.add(id)
  for (const list of Object.values(setup.fleets ?? {})) for (const id of list ?? []) ids.add(id)

  const custom: ShipForm[] = []
  for (const id of ids) {
    if (SHIP_FORMS.some((f) => f.id === id)) continue
    // A form already riding in the setup may exist nowhere else on this
    // machine — an imported battle is exactly that — so it wins the lookup.
    const form = setup.customForms?.find((f) => f.id === id) ?? shipFormById(id)
    if (form) custom.push(structuredClone(form))
  }
  return custom.length > 0 ? { ...setup, customForms: custom } : { ...setup, customForms: undefined }
}

/** Parse a battle file, or say what is wrong with it. */
export function parseSavedGame(text: string): SavedGame | string {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'Not a StarForce battle file (invalid JSON).'
  }
  const saved = raw as Partial<SavedGame>
  if (saved?.version !== 1 || !saved.setup?.scenarioId || typeof saved.setup.seed !== 'number') {
    return 'Not a StarForce battle file (missing setup).'
  }
  if (!Array.isArray(saved.actions)) return 'Not a StarForce battle file (missing actions).'
  return saved as SavedGame
}
