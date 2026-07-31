import { useSyncExternalStore } from 'react'
import { registerCustomForms } from '../data/ships'
import type { ShipForm } from '../engine/types'

/**
 * Storage for designs made in the ship builder.
 *
 * The game has no server, so a custom roster lives in the browser and travels
 * as a JSON file. Saved designs are registered with the data layer on load, so
 * `shipFormById` finds them and a scenario can be started with one.
 */

const KEY = 'sfc.custom-ships.v1'

let forms: ShipForm[] = load()
let version = 0
const listeners = new Set<() => void>()

function load(): ShipForm[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as ShipForm[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // A corrupt or half-written entry should cost the player their custom
    // ships, not the whole app.
    return []
  }
}

function commit(next: ShipForm[]): void {
  forms = next
  registerCustomForms(forms)
  try {
    localStorage.setItem(KEY, JSON.stringify(forms))
  } catch {
    // Quota or private-browsing failures leave the design usable this session.
  }
  version += 1
  for (const listener of listeners) listener()
}

registerCustomForms(forms)

export function customForms(): ShipForm[] {
  return forms
}

/** Insert or replace a design by id. */
export function saveCustomForm(form: ShipForm): void {
  const index = forms.findIndex((f) => f.id === form.id)
  const next = [...forms]
  if (index >= 0) next[index] = form
  else next.push(form)
  commit(next)
}

export function deleteCustomForm(id: string): void {
  commit(forms.filter((f) => f.id !== id))
}

/** Merge an exported roster in, replacing designs that share an id. */
export function importCustomForms(incoming: ShipForm[]): number {
  const next = [...forms]
  for (const form of incoming) {
    const index = next.findIndex((f) => f.id === form.id)
    if (index >= 0) next[index] = form
    else next.push(form)
  }
  commit(next)
  return incoming.length
}

export function exportCustomForms(): string {
  return JSON.stringify(forms, null, 2)
}

/** A fresh id from a class name, kept distinct from anything already saved. */
export function customFormId(name: string): string {
  const base =
    'custom-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ship')
  if (!forms.some((f) => f.id === base)) return base
  let n = 2
  while (forms.some((f) => f.id === `${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function useCustomForms(): ShipForm[] {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => version,
  )
  return forms
}
