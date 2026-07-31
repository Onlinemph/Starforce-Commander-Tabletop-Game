import { useSyncExternalStore } from 'react'
import customScenarioData from '../data/customScenarios.json'
import { registerCustomScenarios, type CustomScenario } from '../data/scenarios'

/**
 * Where designed scenarios live — the same two-tier home as custom ships.
 *
 * The repository file `src/data/customScenarios.json` is the real one: it is
 * bundled with the site, so a scenario committed there reaches everyone who
 * loads the page. Browser storage holds local **drafts** in front of it; a
 * draft shadows a file scenario of the same id so edits show at once.
 * `rosterFileContents` merges the two into the file to commit.
 */

const KEY = 'sfc.custom-scenarios.v1'

export const FILE_SCENARIOS: CustomScenario[] = customScenarioData as unknown as CustomScenario[]

let drafts: CustomScenario[] = load()
let version = 0
const listeners = new Set<() => void>()

function load(): CustomScenario[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as CustomScenario[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** File scenarios, with any local draft of the same id taking precedence. */
export function customScenarios(): CustomScenario[] {
  const merged = FILE_SCENARIOS.filter((f) => !drafts.some((d) => d.id === f.id))
  return [...merged, ...drafts]
}

export function isUnsavedScenarioDraft(id: string): boolean {
  const draft = drafts.find((d) => d.id === id)
  if (!draft) return false
  const file = FILE_SCENARIOS.find((f) => f.id === id)
  return !file || JSON.stringify(file) !== JSON.stringify(draft)
}

function commit(next: CustomScenario[]): void {
  drafts = next
  registerCustomScenarios(customScenarios())
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts))
  } catch {
    // Quota failures leave the scenario usable this session.
  }
  version += 1
  for (const listener of listeners) listener()
}

registerCustomScenarios(customScenarios())

export function saveCustomScenario(scenario: CustomScenario): void {
  const index = drafts.findIndex((d) => d.id === scenario.id)
  const next = [...drafts]
  if (index >= 0) next[index] = scenario
  else next.push(scenario)
  commit(next)
}

/** A draft of a file scenario reverts to the committed version; others vanish. */
export function deleteCustomScenario(id: string): void {
  commit(drafts.filter((d) => d.id !== id))
}

export function importCustomScenarios(incoming: CustomScenario[]): number {
  const next = [...drafts]
  for (const scenario of incoming) {
    const index = next.findIndex((d) => d.id === scenario.id)
    if (index >= 0) next[index] = scenario
    else next.push(scenario)
  }
  commit(next)
  return incoming.length
}

/** `src/data/customScenarios.json` as it would be with every design in play. */
export function scenarioFileContents(): string {
  return JSON.stringify(customScenarios(), null, 2) + '\n'
}

/** A fresh id from a scenario name, distinct from anything already known. */
export function customScenarioId(name: string): string {
  const known = customScenarios()
  const base =
    'scenario-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'battle')
  if (!known.some((s) => s.id === base)) return base
  let n = 2
  while (known.some((s) => s.id === `${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function useCustomScenarios(): CustomScenario[] {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => version,
  )
  return customScenarios()
}
