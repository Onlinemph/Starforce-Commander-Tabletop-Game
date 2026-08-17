import { applyAction, type GameAction } from '../engine/actions'
import type { AiDifficulty, AiPersonality } from '../engine/ai'
import type { GameState } from '../engine/game'
import type { ShipForm } from '../engine/types'
import { SHIP_FORMS, setEmbeddedForms, shipFormById } from './ships'
import {
  customScenarioById,
  SCENARIOS,
  setEmbeddedScenario,
  startScenario,
  type CustomScenario,
} from './scenarios'

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
  /** Optional batteries (B2.5): stored power spendable mid-round. */
  optionalBatteries?: boolean
  /** E11.2 — a gutted hull becomes a derelict instead of leaving the map. */
  derelicts?: boolean
  /** E11.3 — excess structure damage may set off the main reactor. */
  explosions?: boolean
  /** E11.4–E11.6 — crews may be got off a dying ship, and are worth points. */
  abandonShip?: boolean
  /** C4.2 — drive damage forces a slowdown that costs acceleration and stress. */
  decelerationFromDamage?: boolean
  /** Online matches: a segment closes only when every side says so. */
  readyGate?: boolean
  /** One form id per side — the ship builder's quick launch. */
  forms?: Partial<Record<string, string>>
  /** A whole force per side, one form id per hull (S2.5.1). */
  fleets?: Partial<Record<string, string[]>>
  /** Random asteroid terrain (K1.1): 'roll' or an exact counter count. */
  terrain?: 'roll' | number
  /** Battlefield multiplier: 2 doubles the printed map (36" → 72"). Default 1. */
  mapScale?: number
  /** House rule: every weapon arrives fully armed instead of charging up. */
  armedStart?: boolean
  /** Hulls priced at their measured battle values instead of the printed list. */
  balancedPoints?: boolean
  /** Sides the computer commands. Carried in the save so a resumed battle keeps playing itself. */
  aiSides?: string[]
  /** How sharp the computer's captains are. Default 'admiral'. */
  aiDifficulty?: AiDifficulty
  /** The computer captains' temperament — how they read the scoreboard. Default 'steady'. */
  aiPersonality?: AiPersonality
  /** Whether the AI may disengage and refuse hopeless battles. Default true. */
  aiRetreats?: boolean
  /**
   * A designed scenario, embedded whole when `scenarioId` names one — so the
   * battle replays on a machine that has never seen the design.
   */
  customScenario?: CustomScenario
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
  setEmbeddedScenario(setup.customScenario ?? null)
  return startScenario(setup.scenarioId, {
    seed: setup.seed,
    coordinatedFire: setup.coordinatedFire ?? false,
    optionalBatteries: setup.optionalBatteries ?? false,
    readyGate: setup.readyGate ?? false,
    forms: setup.forms,
    fleets: setup.fleets,
    terrain: setup.terrain,
    mapScale: setup.mapScale,
    armedStart: setup.armedStart,
    balancedPoints: setup.balancedPoints,
    derelicts: setup.derelicts ?? false,
    explosions: setup.explosions ?? false,
    abandonShip: setup.abandonShip ?? false,
    decelerationFromDamage: setup.decelerationFromDamage ?? false,
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
 * Fill in everything a save must carry to replay elsewhere: every referenced
 * non-canon ship form, and the designed scenario itself when the setup names
 * one — embedded whole, exactly like the forms.
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

  const builtIn = SCENARIOS.some((s) => s.scenario.id === setup.scenarioId)
  const scenario = builtIn
    ? undefined
    : setup.customScenario?.id === setup.scenarioId
      ? setup.customScenario
      : customScenarioById(setup.scenarioId)

  return {
    ...setup,
    customForms: custom.length > 0 ? custom : undefined,
    customScenario: scenario ? structuredClone(scenario) : undefined,
  }
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
