import { useSyncExternalStore } from 'react'
import {
  buildGame,
  parseSavedGame,
  replayGame,
  withEmbeddedForms,
  type GameSetup,
  type SavedGame,
} from '../data/savedGame'
import { applyAction, type ActionOutcome, type GameAction } from '../engine/actions'
import type { GameState } from '../engine/game'

/**
 * The store journals every action it applies, so the battle on screen is
 * always (setup + journal) — and that record is what autosave writes, what
 * undo rewinds through, and what an exported battle file contains. The engine
 * still mutates in place; the UI subscribes to a version counter.
 */

const SAVE_KEY = 'sfc.saved-game.v1'

const DEFAULT_SETUP: GameSetup = { scenarioId: 's3.1-the-duel', seed: 0x5f04ce }

let setup: GameSetup = DEFAULT_SETUP
let journal: GameAction[] = []
let game: GameState = restore()

let version = 0
const listeners = new Set<() => void>()

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saved(): SavedGame {
  return { version: 1, setup, actions: journal }
}

function autosave(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved()))
  } catch {
    // Quota or private browsing: the battle still plays, it just won't survive
    // a refresh. Not worth interrupting the game over.
  }
}

/** Boot: pick the autosaved battle back up, or open on the default duel. */
function restore(): GameState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SAVE_KEY)
    if (raw) {
      const parsed = parseSavedGame(raw)
      if (typeof parsed !== 'string') {
        const rebuilt = replayGame(parsed)
        setup = parsed.setup
        journal = parsed.actions
        return rebuilt
      }
    }
  } catch {
    // A save that no longer replays (or corrupt storage) is discarded rather
    // than wedging the app shut.
  }
  setup = DEFAULT_SETUP
  journal = []
  return buildGame(setup)
}

// ---------------------------------------------------------------------------
// The mutation boundary
// ---------------------------------------------------------------------------

/** Apply an action, journal it, autosave, notify. The only way state changes. */
export function dispatch(action: GameAction): ActionOutcome {
  const outcome = applyAction(game, action)
  journal.push(action)
  autosave()
  emit()
  return outcome
}

/** Start a fresh battle from a setup. Custom designs are embedded into it. */
export function newGame(next: GameSetup): void {
  setup = withEmbeddedForms(next)
  journal = []
  game = buildGame(setup)
  autosave()
  emit()
}

/** The setup of the battle in progress — what "Rematch" rolls a new seed for. */
export function currentSetup(): GameSetup {
  return setup
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export function canUndo(): boolean {
  return journal.length > 0
}

/**
 * Take back the last action by replaying everything before it. The engine is
 * deterministic, so this is exact — dice included.
 */
export function undo(): void {
  if (journal.length === 0) return
  journal = journal.slice(0, -1)
  game = replayGame(saved())
  autosave()
  emit()
}

// ---------------------------------------------------------------------------
// Battle files
// ---------------------------------------------------------------------------

/** The battle as a file: setup, journal, and any custom designs it needs. */
export function exportBattle(): string {
  return JSON.stringify(saved(), null, 2) + '\n'
}

/** Load a battle file. Returns an error to show, or null on success. */
export function importBattle(text: string): string | null {
  const parsed = parseSavedGame(text)
  if (typeof parsed === 'string') return parsed
  try {
    game = replayGame(parsed)
  } catch {
    return 'That battle file does not replay — it may be from an incompatible version.'
  }
  setup = parsed.setup
  journal = parsed.actions
  autosave()
  emit()
  return null
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

export function getGame(): GameState {
  return game
}

/** Re-renders whenever the game mutates. */
export function useGame(): GameState {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  )
  return game
}
