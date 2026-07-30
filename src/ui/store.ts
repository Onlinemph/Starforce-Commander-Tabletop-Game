import { useSyncExternalStore } from 'react'
import { startScenario, type SetupOptions } from '../data/scenarios'
import type { GameState } from '../engine/game'

/**
 * A tiny mutable store. The rules engine mutates ship state in place — which
 * keeps the engine straightforward and testable — so the UI subscribes to a
 * version counter rather than diffing immutable trees.
 */

let game: GameState = startScenario('s3.1-the-duel')
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

export function getGame(): GameState {
  return game
}

/** Run a mutation against the game and notify subscribers. */
export function act<T>(mutator: (g: GameState) => T): T {
  const result = mutator(game)
  emit()
  return result
}

export function resetGame(scenarioId: string, options?: SetupOptions): void {
  // Optional rules in force carry across a scenario change or a rematch.
  game = startScenario(scenarioId, { coordinatedFire: game.coordinatedFire, ...options })
  emit()
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
