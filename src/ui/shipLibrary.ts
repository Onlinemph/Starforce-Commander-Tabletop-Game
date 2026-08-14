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

/**
 * The SQL file that defines each family of functions. The libraries are
 * separate optional installs on the same project, so "the function does not
 * exist" is not an outage — it is a file the operator has not pasted into
 * the SQL Editor yet, and the error should say which one.
 */
function sqlFileFor(fn: string): string {
  return /scenario/.test(fn) ? 'scenario-library.sql' : 'ship-library.sql'
}

/** One RPC against the configured library project — the scenario library shares it. */
export async function libraryCall(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = await connect()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    /*
     * PostgREST's "Could not find the function public.sfc_… in the schema
     * cache" reached a playtester verbatim, right after the builder told
     * them the design was ready to fly. It means the Supabase project has
     * never run (or has an outdated copy of) the SQL file that defines the
     * function — a setup step, not a bug — so say that, name the file, and
     * say the design is safe: everything built locally stays in the roster
     * whether or not the shared library exists.
     */
    if (/could not find the function/i.test(error.message)) {
      throw new Error(
        `This site's library is not fully set up: its Supabase project is missing ${fn}. ` +
          `Whoever runs the site needs to paste supabase/${sqlFileFor(fn)} into the project's SQL Editor ` +
          `(safe to re-run; see supabase/README.md). Nothing is lost — your work is saved in this browser's roster.`,
      )
    }
    throw new Error(error.message)
  }
  return data
}
const call = libraryCall

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
/**
 * What publishing did, as against merely that it did not throw.
 *
 * `created` false means the library already held this exact design and nothing
 * was written — which is a success, but a different one, and the person who
 * just pressed Publish deserves to be told which they got.
 */
export interface PublishResult {
  fingerprint: string
  /** `null` when the library is too old a copy to say. Not a guess. */
  created: boolean | null
  /** When the entry actually went up. Not bumped by a re-publish. */
  publishedAt: string | null
  /** Who got the credit — the *first* publisher, which may not be this one. */
  author: string
}

export async function publishDesign(args: {
  fingerprint: string
  form: ShipForm
  faction: string
  points: number
  author: string
  notes: string
}): Promise<PublishResult> {
  const raw = await call('sfc_publish_design', {
    p_fingerprint: args.fingerprint,
    p_form: args.form,
    p_name: args.form.name,
    p_faction: args.faction,
    p_size_class: args.form.sizeClass ?? 1,
    p_points: args.points,
    p_author: args.author,
    p_notes: args.notes,
  })
  /*
   * An older install of `ship-library.sql` returns the bare fingerprint. The
   * library is a separate optional install that the operator pastes in by
   * hand, so a client newer than the SQL is the normal state of the world for
   * a while after any change here — and a publish that worked must not read as
   * a failure because the project has not been updated yet. Unknown provenance
   * is reported honestly rather than guessed at.
   */
  if (typeof raw === 'string') {
    return { fingerprint: raw, created: null, publishedAt: null, author: args.author }
  }
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    fingerprint: String(row.fingerprint ?? args.fingerprint),
    created: typeof row.created === 'boolean' ? row.created : null,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
    author: typeof row.author === 'string' ? row.author : args.author,
  }
}

/** Count an import — "somebody put this in a fleet", not "somebody scrolled past". */
export async function recordDownload(fingerprint: string): Promise<void> {
  await call('sfc_record_download', { p_fingerprint: fingerprint })
}

export async function reportDesign(fingerprint: string): Promise<void> {
  await call('sfc_report_design', { p_fingerprint: fingerprint })
}
