/**
 * The shared library of designed scenarios: the rules half.
 *
 * Everything the ship library learned carries over — entries are immutable,
 * addressed by their own content, and the whole design travels with the entry
 * so a download owes nothing to the library staying up. See
 * `src/engine/shipLibrary.ts` for why that follows from how battles are saved.
 *
 * Scenarios add one problem ships do not have: a scenario's force lists are
 * *references* — form ids — and a designed scenario is free to field fan
 * ships that exist only in its author's browser. Published as-is, those
 * references would dangle on every other machine and the hulls would silently
 * vanish from the deployment (toScenarioEntry drops unresolvable ids). So a
 * scenario is published as a package: the scenario plus every non-canon form
 * it fields, with the references rewritten to the forms' content-addressed
 * library ids (`lib-<fingerprint>`), exactly the ids the ship library itself
 * mints on import. Two nice consequences fall out for free: a scenario that
 * fields an already-imported library ship packages it unchanged, and importing
 * the same scenario on two machines lands identical ids everywhere, so battle
 * files that name them travel too.
 *
 * This module is deliberately free of any network. The transport lives in
 * `src/ui/scenarioLibrary.ts`.
 */

import { isCanonForm } from '../data/ships'
import type { CustomScenario } from '../data/scenarios'
import {
  contentFingerprint,
  designFingerprint,
  MAX_AUTHOR_CHARS,
  MAX_NOTES_CHARS,
} from './shipLibrary'
import type { ShipForm } from './types'

/**
 * A package is a scenario plus fan hulls; forms alone cap at 64K each and a
 * scenario can field several, so the cap is wider than the ship library's.
 */
export const MAX_SCENARIO_BYTES = 256 * 1024

/** The published unit: the scenario and every non-canon form it fields. */
export interface ScenarioPackage {
  scenario: CustomScenario
  forms: ShipForm[]
}

/**
 * Rewrite a scenario for travel: every non-canon form it fields is embedded
 * whole under its content-addressed id, and the force lists point at those
 * ids. Returns the ids that could not be resolved at all — a scenario whose
 * hulls cannot be found has no business being published.
 */
export function packageScenario(
  scenario: CustomScenario,
  roster: readonly ShipForm[],
): { pack: ScenarioPackage; missing: string[] } {
  const byId = new Map(roster.map((f) => [f.id, f]))
  const embedded = new Map<string, ShipForm>()
  const missing = new Set<string>()

  const next = structuredClone(scenario) as CustomScenario
  for (const side of next.sides) {
    side.force = side.force.map((id) => {
      if (isCanonForm(id)) return id
      const form = byId.get(id)
      if (!form) {
        missing.add(id)
        return id
      }
      const libId = `lib-${designFingerprint(form)}`
      if (!embedded.has(libId)) embedded.set(libId, { ...form, id: libId })
      return libId
    })
  }

  return {
    pack: { scenario: next, forms: [...embedded.values()] },
    missing: [...missing],
  }
}

/**
 * A package's identity. The scenario's local id is bookkeeping and excluded —
 * the same design drafted on two machines should land on the same entry — but
 * the name stays in, as it does for ships: a battle fought under "Ambush at
 * Karnath Station" was not fought under "Ambush II".
 */
export function scenarioFingerprint(pack: ScenarioPackage): string {
  const { id: _ignored, ...rest } = pack.scenario
  return contentFingerprint({ scenario: rest, forms: pack.forms })
}

export interface ScenarioPublishCheck {
  ok: boolean
  refusal: string | null
  fingerprint: string
  pack: ScenarioPackage
  /** For the browse listing: how big a battle this is. */
  sides: number
  hulls: number
}

/**
 * Whether a scenario may go into the library. The bar is the same as for
 * ships — *structural*, not aesthetic: it has to be a battle the engine can
 * actually deal out. One-sided maps, empty forces and dangling form ids are
 * refused; everything else is somebody's idea of a good time.
 */
export function checkScenarioPublishable(
  scenario: CustomScenario,
  roster: readonly ShipForm[],
  author: string,
  notes: string,
): ScenarioPublishCheck {
  const { pack, missing } = packageScenario(scenario, roster)
  const fingerprint = scenarioFingerprint(pack)
  const sides = pack.scenario.sides.length
  const hulls = pack.scenario.sides.reduce((sum, s) => sum + s.force.length, 0)
  const fail = (refusal: string): ScenarioPublishCheck => ({
    ok: false,
    refusal,
    fingerprint,
    pack,
    sides,
    hulls,
  })

  if (!scenario.name?.trim()) return fail('A scenario needs a name before it can be shared.')
  if (author.length > MAX_AUTHOR_CHARS) {
    return fail(`Author names are limited to ${MAX_AUTHOR_CHARS} characters.`)
  }
  if (notes.length > MAX_NOTES_CHARS) {
    return fail(`Notes are limited to ${MAX_NOTES_CHARS} characters.`)
  }
  if (sides < 2) return fail('A battle needs at least two sides.')
  if (pack.scenario.sides.some((s) => s.force.length === 0)) {
    return fail('Every side needs at least one ship.')
  }
  if (missing.length > 0) {
    return fail(
      `The force lists name ships this browser does not have: ${missing.join(', ')}. ` +
        'A published scenario carries its fan ships inside it, so they have to be here to pack.',
    )
  }
  if (
    !(pack.scenario.bounds?.width > 0) ||
    !(pack.scenario.bounds?.height > 0) ||
    pack.scenario.bounds.width > 144 ||
    pack.scenario.bounds.height > 144
  ) {
    return fail('The map bounds are not a battlefield the engine can deal out.')
  }
  if (JSON.stringify(pack).length > MAX_SCENARIO_BYTES) {
    return fail('That scenario is far larger than any battle; it will not be accepted.')
  }
  return { ok: true, refusal: null, fingerprint, pack, sides, hulls }
}

/** One entry as the library stores and serves it. */
export interface ScenarioLibraryEntry {
  fingerprint: string
  scenario: CustomScenario
  forms: ShipForm[]
  author: string
  notes: string
  sides: number
  hulls: number
  publishedAt: string
  downloads: number
}

/**
 * The scenario as it lands in a local collection: under its content-addressed
 * id, so the same entry imports to the same id on every machine — which is
 * what lets a battle file reference it and still replay elsewhere. The forms
 * travel separately into the roster; their ids already match the rewritten
 * force lists.
 */
export function importedScenario(entry: ScenarioLibraryEntry): CustomScenario {
  return { ...entry.scenario, id: `scenario-lib-${entry.fingerprint}` }
}

/** Whether this entry is already in a local collection. */
export function alreadyHaveScenario(
  entry: ScenarioLibraryEntry,
  scenarios: readonly CustomScenario[],
): boolean {
  const id = `scenario-lib-${entry.fingerprint}`
  return scenarios.some(
    (s) =>
      s.id === id ||
      scenarioFingerprint({ scenario: s, forms: entry.forms }) === entry.fingerprint,
  )
}
