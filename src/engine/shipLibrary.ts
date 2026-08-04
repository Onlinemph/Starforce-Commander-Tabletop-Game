/**
 * The shared library of fan-made ships: the rules half.
 *
 * A published design is *immutable*, and that is not a policy choice — it
 * falls out of how this game stores a battle. A save is a setup plus a journal
 * of actions, and custom forms travel inside it so a battle replays on a
 * machine that has never seen the design. If a library entry could be edited
 * in place, every saved battle and every online match that named it would
 * quietly replay into a different board the next time someone opened it.
 *
 * So an entry is addressed by the content of the design itself. Publishing the
 * same design twice is the same entry; publishing an edited one is a new
 * entry, and the old battles go on meaning what they meant. Nothing here
 * changes how saves work — they still embed the whole form, which is what
 * makes a battle survive the library going away entirely.
 *
 * This module is deliberately free of any network: it decides what a design's
 * identity is, whether it is fit to publish, and how a downloaded one is
 * folded into the local roster. The transport lives in `src/ui/shipLibrary.ts`.
 */

import { pointValue, validateDesign, type DesignProblem } from './shipBuilder'
import type { ShipForm } from './types'

/**
 * The tags a design may be published under.
 *
 * The three printed factions plus an escape hatch, because a fan design is
 * usually meant to fly one of the canon flags — a Union cruiser somebody built
 * is for fielding beside the printed Union ships — while some are their own
 * thing entirely. The tag is what the library filters on; it is never what
 * tells canon from fan, since a design is free to claim any flag it likes.
 */
export const LIBRARY_FACTIONS = [
  'Union of Federated Systems',
  'Vallari Imperium',
  'Aurelian Empire',
  'Independent',
] as const

export type LibraryFaction = (typeof LIBRARY_FACTIONS)[number]

/** A design's declared faction, pinned to a tag the library can filter on. */
export function libraryFaction(form: ShipForm): LibraryFaction {
  const declared = (form.faction ?? '').trim()
  return (LIBRARY_FACTIONS as readonly string[]).includes(declared)
    ? (declared as LibraryFaction)
    : 'Independent'
}

/** Anything larger than this is not a ship design; it is someone testing us. */
export const MAX_DESIGN_BYTES = 64 * 1024

/** Free text a publisher may attach, capped so the browser stays readable. */
export const MAX_AUTHOR_CHARS = 40
export const MAX_NOTES_CHARS = 500

/**
 * A design's identity: a hash of the design itself, with the fields that carry
 * no rules meaning stripped out first.
 *
 * Two people who build the same ship should land on the same entry even though
 * their local ids differ, and renaming a design *should* make a new entry —
 * the name is printed on the counter, so a battle that used "Vindicator" did
 * not use "Vindicator II". Only `id` is excluded, because it is bookkeeping.
 */
export function designFingerprint(form: ShipForm): string {
  const { id: _ignored, ...rules } = form
  return fnv1a64(stableStringify(rules))
}

/**
 * JSON with object keys in a fixed order, so two designs that differ only in
 * the order their fields were written hash the same.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * FNV-1a widened to 64 bits by running two independent 32-bit passes. Not
 * cryptographic: this is an identity for deduplication, not a defence. A
 * collision would merge two designs in the browser, which is why the full form
 * travels with every entry and is what actually gets imported.
 */
function fnv1a64(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export interface PublishCheck {
  ok: boolean
  /** Why it cannot be published, if it cannot. */
  refusal: string | null
  /** Structural problems from the builder's own validator (E8.5.4 and friends). */
  problems: DesignProblem[]
  /** The designers' point model, so the library can show and sort by cost. */
  points: number
  fingerprint: string
}

/**
 * Whether a design may go into the library, and what to record about it.
 *
 * The bar is *structural*, not aesthetic: a design has to be something the
 * engine can actually field. An expensive ship is a legal ship — the point
 * model prices it and the fleet picker enforces budgets — so cost is recorded
 * and never used to refuse. What gets refused is a form that would break a
 * battle: a sublight ladder that does not match its drive boxes, a turn table
 * with missing rows, a homing weapon with no endurance.
 */
export function checkPublishable(
  form: ShipForm,
  author: string,
  notes: string,
): PublishCheck {
  const problems = validateDesign(form)
  const fingerprint = designFingerprint(form)
  const points = Math.round(pointValue(form).points * 10) / 10

  const fail = (refusal: string): PublishCheck => ({
    ok: false,
    refusal,
    problems,
    points,
    fingerprint,
  })

  if (!form.name?.trim()) return fail('A design needs a name before it can be shared.')
  if (author.length > MAX_AUTHOR_CHARS) {
    return fail(`Author names are limited to ${MAX_AUTHOR_CHARS} characters.`)
  }
  if (notes.length > MAX_NOTES_CHARS) {
    return fail(`Notes are limited to ${MAX_NOTES_CHARS} characters.`)
  }
  if (JSON.stringify(form).length > MAX_DESIGN_BYTES) {
    return fail('That design is far larger than any ship form; it will not be accepted.')
  }
  const errors = problems.filter((p) => p.severity === 'error')
  if (errors.length > 0) {
    return fail(
      `The design has ${errors.length} problem(s) the engine could not field: ${errors[0].message}`,
    )
  }
  return { ok: true, refusal: null, problems, points, fingerprint }
}

/** One entry as the library stores and serves it. */
export interface LibraryEntry {
  fingerprint: string
  form: ShipForm
  author: string
  notes: string
  points: number
  faction: string
  sizeClass: number
  publishedAt: string
  downloads: number
}

/**
 * Fold a downloaded design into the local roster.
 *
 * The entry keeps its own id so two libraries — or a library and a local draft
 * — cannot collide, and so a battle saved with it names something stable. A
 * design already present under the same fingerprint is not imported twice.
 */
export function importedForm(entry: LibraryEntry): ShipForm {
  return { ...entry.form, id: `lib-${entry.fingerprint}` }
}

/** Whether this design is already in a roster, by content rather than by id. */
export function alreadyHave(entry: LibraryEntry, roster: readonly ShipForm[]): boolean {
  return roster.some((f) => designFingerprint(f) === entry.fingerprint)
}
