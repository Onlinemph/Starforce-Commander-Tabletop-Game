import { useSyncExternalStore } from 'react'
import { FILE_FORMS, registerCustomForms } from '../data/ships'
import type { ShipForm } from '../engine/types'

/**
 * Where custom designs live.
 *
 * The repository file `src/data/customShips.json` is the real home: it is
 * bundled with the site, so a design committed there reaches everyone who loads
 * the page, on any device, with nothing to import. The ship builder writes that
 * file for you.
 *
 * Browser storage is the scratch pad in front of it. A design you save while
 * building is a **draft** — it lives on this device only, and it shadows a file
 * design of the same id so you can edit a committed ship and see the change at
 * once. `downloadRosterFile` merges the two and hands back the file to commit,
 * at which point the draft and the file agree and the draft can be dropped.
 */

const KEY = 'sfc.custom-ships.v1'

let drafts: ShipForm[] = load()
let version = 0
const listeners = new Set<() => void>()

function load(): ShipForm[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as ShipForm[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // A corrupt or half-written entry should cost the player their drafts, not
    // the whole app — and never the designs committed to the repository.
    return []
  }
}

/** File designs, with any local draft of the same id taking precedence. */
export function customForms(): ShipForm[] {
  const merged = FILE_FORMS.filter((f) => !drafts.some((d) => d.id === f.id))
  return [...merged, ...drafts]
}

/** True when this design came from the repository file rather than this browser. */
export function isFileForm(id: string): boolean {
  return FILE_FORMS.some((f) => f.id === id)
}

/** True when a local draft differs from what the repository file holds. */
export function isUnsavedDraft(id: string): boolean {
  const draft = drafts.find((f) => f.id === id)
  if (!draft) return false
  const file = FILE_FORMS.find((f) => f.id === id)
  return !file || JSON.stringify(file) !== JSON.stringify(draft)
}

export function draftCount(): number {
  return drafts.filter((d) => isUnsavedDraft(d.id)).length
}

function commit(next: ShipForm[]): void {
  drafts = next
  registerCustomForms(customForms())
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts))
  } catch {
    // Quota or private-browsing failures leave the design usable this session.
  }
  version += 1
  for (const listener of listeners) listener()
}

registerCustomForms(customForms())

/** Insert or replace a draft by id. */
export function saveCustomForm(form: ShipForm): void {
  const index = drafts.findIndex((f) => f.id === form.id)
  const next = [...drafts]
  if (index >= 0) next[index] = form
  else next.push(form)
  commit(next)
}

/**
 * Drop a design. A draft of a file design reverts to the committed version;
 * anything else disappears. Removing a file design for good means editing
 * `src/data/customShips.json`.
 */
export function deleteCustomForm(id: string): void {
  commit(drafts.filter((f) => f.id !== id))
}

/** Merge an exported roster in as drafts, replacing designs that share an id. */
export function importCustomForms(incoming: ShipForm[]): number {
  const next = [...drafts]
  for (const form of incoming) {
    const index = next.findIndex((f) => f.id === form.id)
    if (index >= 0) next[index] = form
    else next.push(form)
  }
  commit(next)
  return incoming.length
}

/**
 * The contents of `src/data/customShips.json` as it would be with every design
 * currently in play — file designs plus local drafts.
 */
export function rosterFileContents(): string {
  return JSON.stringify(customForms(), null, 2) + '\n'
}

/** A fresh id from a class name, kept distinct from anything already known. */
export function customFormId(name: string): string {
  const known = customForms()
  const base =
    'custom-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ship')
  if (!known.some((f) => f.id === base)) return base
  let n = 2
  while (known.some((f) => f.id === `${base}-${n}`)) n += 1
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
  return customForms()
}
