import type { LibraryEntry } from '../engine/shipLibrary'
import type { ShipForm } from '../engine/types'

/**
 * The shared ship library: the wire half.
 *
 * Four function calls against the same Supabase project the online matches
 * use, and nothing else — the SQL in `supabase/ship-library.sql` denies direct
 * table access outright, so this module could not read a hidden entry or edit
 * anybody's design if it tried. The client library is a substantial dependency
 * and most sessions never open the library, so it is fetched on first use the
 * same way the match client is.
 *
 * The library is entirely optional. With no project configured the panel says
 * so and everything else in the game carries on; a battle saved with a
 * downloaded design keeps working whether or not the library still exists,
 * because the design travels inside the save.
 */

export interface LibraryConfig {
  url: string
  key: string
}

/** Where the library lives, if anywhere: build-time config, then local override. */
export function libraryConfig(): LibraryConfig | null {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as LibraryConfig
      if (parsed.url && parsed.key) return parsed
    } catch {
      // A corrupt override should fall back to the build's own config, not
      // take the library down.
    }
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return url && key ? { url, key } : null
}

const KEY = 'sfc.ship-library.v1'

export function setLibraryConfig(config: LibraryConfig | null): void {
  if (typeof localStorage === 'undefined') return
  if (config) localStorage.setItem(KEY, JSON.stringify(config))
  else localStorage.removeItem(KEY)
}

type Client = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }

let client: Client | null = null
let clientFor = ''

async function connect(): Promise<Client> {
  const config = libraryConfig()
  if (!config) throw new Error('No ship library is configured.')
  const signature = `${config.url}|${config.key}`
  if (client && clientFor === signature) return client
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(config.url, config.key) as unknown as Client
  clientFor = signature
  return client
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = await connect()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** Rows as the browse function returns them, widened into entries. */
interface Row {
  fingerprint: string
  form: ShipForm
  name: string
  faction: string
  size_class: number
  points: number
  author: string
  notes: string
  downloads: number
  published_at: string
}

export async function browseLibrary(
  search = '',
  faction = '',
  limit = 50,
  offset = 0,
): Promise<LibraryEntry[]> {
  const rows = (await call('sfc_browse_designs', {
    p_search: search,
    p_faction: faction,
    p_limit: limit,
    p_offset: offset,
  })) as Row[] | null
  return (rows ?? []).map((r) => ({
    fingerprint: r.fingerprint,
    form: r.form,
    author: r.author,
    notes: r.notes,
    points: Number(r.points),
    faction: r.faction,
    sizeClass: r.size_class,
    publishedAt: r.published_at,
    downloads: r.downloads,
  }))
}

/**
 * Publish a design. Idempotent by fingerprint, so a second attempt at the same
 * ship is not an error and not a duplicate — it simply returns the entry that
 * is already there.
 */
export async function publishDesign(args: {
  fingerprint: string
  form: ShipForm
  points: number
  author: string
  notes: string
}): Promise<string> {
  return (await call('sfc_publish_design', {
    p_fingerprint: args.fingerprint,
    p_form: args.form,
    p_name: args.form.name,
    p_faction: args.form.faction ?? 'Custom',
    p_size_class: args.form.sizeClass ?? 1,
    p_points: args.points,
    p_author: args.author,
    p_notes: args.notes,
  })) as string
}

/** Count an import — "somebody put this in a fleet", not "somebody scrolled past". */
export async function recordDownload(fingerprint: string): Promise<void> {
  await call('sfc_record_download', { p_fingerprint: fingerprint })
}

export async function reportDesign(fingerprint: string): Promise<void> {
  await call('sfc_report_design', { p_fingerprint: fingerprint })
}
