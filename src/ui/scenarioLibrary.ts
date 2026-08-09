import type { CustomScenario } from '../data/scenarios'
import type { ScenarioLibraryEntry, ScenarioPackage } from '../engine/scenarioLibrary'
import type { ShipForm } from '../engine/types'
import { libraryCall } from './shipLibrary'

/**
 * The shared scenario library: the wire half.
 *
 * Same Supabase project, same posture as the ship library — the SQL in
 * `supabase/scenario-library.sql` denies direct table access and these four
 * RPCs are the whole surface. The rules — packaging, fingerprints, what may
 * be published — live in `src/engine/scenarioLibrary.ts`.
 */

/** Rows as the browse function returns them, widened into entries. */
interface Row {
  fingerprint: string
  scenario: CustomScenario
  forms: ShipForm[]
  name: string
  author: string
  notes: string
  sides: number
  hulls: number
  downloads: number
  published_at: string
}

export async function browseScenarios(
  search = '',
  limit = 50,
  offset = 0,
): Promise<ScenarioLibraryEntry[]> {
  const rows = (await libraryCall('sfc_browse_scenarios', {
    p_search: search,
    p_limit: limit,
    p_offset: offset,
  })) as Row[] | null
  return (rows ?? []).map((r) => ({
    fingerprint: r.fingerprint,
    scenario: r.scenario,
    forms: r.forms ?? [],
    author: r.author,
    notes: r.notes,
    sides: r.sides,
    hulls: r.hulls,
    publishedAt: r.published_at,
    downloads: r.downloads,
  }))
}

/** Publish a packaged scenario. Idempotent by fingerprint, like ships. */
export async function publishScenario(args: {
  fingerprint: string
  pack: ScenarioPackage
  author: string
  notes: string
  sides: number
  hulls: number
}): Promise<string> {
  return (await libraryCall('sfc_publish_scenario', {
    p_fingerprint: args.fingerprint,
    p_scenario: args.pack.scenario,
    p_forms: args.pack.forms,
    p_name: args.pack.scenario.name,
    p_author: args.author,
    p_notes: args.notes,
    p_sides: args.sides,
    p_hulls: args.hulls,
  })) as string
}

/** Count an import — "somebody set this battle up", not "somebody scrolled by". */
export async function recordScenarioDownload(fingerprint: string): Promise<void> {
  await libraryCall('sfc_record_scenario_download', { p_fingerprint: fingerprint })
}

export async function reportScenario(fingerprint: string): Promise<void> {
  await libraryCall('sfc_report_scenario', { p_fingerprint: fingerprint })
}
