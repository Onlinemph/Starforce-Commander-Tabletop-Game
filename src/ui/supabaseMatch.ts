import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { SavedGame } from '../data/savedGame'
import type { GameAction } from '../engine/actions'

/**
 * The Supabase backend for persistent matches.
 *
 * Same bargain as the Worker service it stands beside: the battle is a setup
 * document plus an ordered list of actions, the service assigns the order,
 * and everyone converges. Here Postgres is the ledger — `sfc_append_action`
 * hands out the sequence numbers under a row lock — and Realtime is the
 * relay. Nothing is deployed: the SQL in supabase/schema.sql is the whole
 * server, and the browser talks to it with the public anon key.
 *
 * Passwords never leave as anything but an argument to a function that
 * bcrypt-checks them; no client can read a match row directly.
 */

export interface MatchHandlers {
  /**
   * One action arrived. `seq` is 1-based, matching the store's journal.
   * `hash` fingerprints the state the action produced on the sender's board,
   * when their build stamps one — compare after applying, and a mismatch
   * means the boards have drifted and the ledger should settle it.
   */
  onAction(action: GameAction, seq: number, hash?: string): void
  /** The ledger changed shape (an undo, a replacement) — take it whole. */
  onResync(save: SavedGame): void
  /** Sides with somebody connected right now. */
  onPresence(sides: string[]): void
  /** Transport trouble, worth showing and retrying past. */
  onDropped(): void
}

export interface MatchLink {
  /** `seq` is the store's 1-based journal position; `hash` fingerprints the state it produced. */
  append(action: GameAction, seq: number, hash?: string): Promise<void>
  undo(lengthAfter: number): Promise<void>
  replace(save: SavedGame): Promise<void>
  /**
   * Claim a side, with the ledger as referee. 'taken' means another console
   * holds a live claim on it; 'ok' covers success and projects on an older
   * schema, which cannot referee and fall back to presence-only claims.
   * Null releases this console's chair.
   */
  claim(side: string | null): Promise<'ok' | 'taken'>
  /** Tell the browser listing whose move it is. Best-effort. */
  setWaiting(sides: string[]): Promise<void>
  /** Take the ledger whole — the answer to any disagreement. */
  resync(): Promise<void>
  close(): void
}

export interface OpenedMatch {
  link: MatchLink
  name: string
  sides: string[]
  save: SavedGame
}

/** A Supabase project: its URL and the publishable anon key. */
export interface SupabaseConfig {
  url: string
  key: string
}

/** Clients are cached per project so a reconnect reuses one socket. */
const clients = new Map<string, SupabaseClient>()

function clientFor({ url, key }: SupabaseConfig): SupabaseClient {
  const normalised = url.trim().replace(/\/+$/, '')
  const cacheKey = `${normalised}|${key.slice(0, 12)}`
  let client = clients.get(cacheKey)
  if (!client) {
    client = createClient(normalised, key.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    })
    clients.set(cacheKey, client)
  }
  return client
}

/** Postgres raises carry their message through PostgREST; show it as written. */
function reasonFrom(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  // PostgREST wraps a raise as-is; strip the noise a stack adds.
  return message.replace(/^error:\s*/i, '').split('\n')[0]
}

/**
 * A function the database does not have (PostgREST's PGRST202). Always means
 * the same thing here: the project is running an older schema.sql than the
 * client expects.
 */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
}

const OUT_OF_DATE =
  'This Supabase project is running an older schema — re-run supabase/schema.sql in the SQL Editor.'

function saveFrom(setup: unknown, actions: unknown): SavedGame {
  return {
    version: 1,
    setup: setup as SavedGame['setup'],
    actions: (Array.isArray(actions) ? actions : []) as GameAction[],
  }
}

/** One line in the match browser: enough to choose by, nothing more. */
export interface MatchSummary {
  id: string
  name: string
  sides: string[]
  moves: number
  updatedAt: string
  /** Sides the battle is waiting on, as last reported by a connected client. */
  waiting: string[]
}

/**
 * What is on offer. Deliberately thin — no battle, no setup, no password
 * hash — so listing a match reveals nothing but that it exists. Joining
 * still costs the password.
 */
export async function listSupabaseMatches(
  config: SupabaseConfig,
  limit = 40,
): Promise<{ matches?: MatchSummary[]; error?: string }> {
  const client = clientFor(config)
  const { data, error } = await client.rpc('sfc_list_matches', { p_limit: limit })
  // A project set up before the browser existed simply has nothing to list.
  if (isMissingFunction(error)) return { matches: [], error: OUT_OF_DATE }
  if (error) return { error: reasonFrom(error, 'Could not list matches.') }
  const rows = Array.isArray(data) ? data : []
  return {
    matches: rows.map((row) => {
      const r = row as Partial<MatchSummary> & { updatedAt?: string }
      return {
        id: String(r.id ?? ''),
        name: String(r.name ?? 'A StarForce battle'),
        sides: Array.isArray(r.sides) ? r.sides.map(String) : [],
        moves: Number(r.moves ?? 0),
        updatedAt: String(r.updatedAt ?? ''),
        waiting: Array.isArray(r.waiting) ? r.waiting.map(String) : [],
      }
    }),
  }
}

/** Host the battle on screen as a persistent match. Resolves to its code. */
export async function createSupabaseMatch(
  config: SupabaseConfig,
  name: string,
  password: string,
  sides: string[],
  save: SavedGame,
  isPublic = true,
): Promise<{ id?: string; error?: string }> {
  const client = clientFor(config)
  const core = {
    p_name: name,
    p_password: password,
    p_sides: sides,
    p_setup: save.setup,
  }
  let { data, error } = await client.rpc('sfc_create_match', { ...core, p_public: isPublic })
  /**
   * A project still on the first schema has the four-argument version, and
   * PostgREST matches functions by their exact argument names — so the call
   * lands nowhere rather than defaulting. Hosting still works there; only the
   * public/private choice does not exist yet, so fall back rather than fail.
   */
  if (isMissingFunction(error)) {
    ;({ data, error } = await client.rpc('sfc_create_match', core))
  }
  if (error || typeof data !== 'string') {
    return { error: reasonFrom(error, 'The project refused the match.') }
  }
  const id = data
  // The battle in progress becomes the ledger's opening actions.
  if (save.actions.length > 0) {
    const { error: seedError } = await client.rpc('sfc_replace_match', {
      p_id: id,
      p_password: password,
      p_setup: save.setup,
      p_actions: save.actions,
    })
    if (seedError) return { error: reasonFrom(seedError, 'The battle could not be stored.') }
  }
  return { id }
}

/**
 * Open a match and stay open: fetches the whole ledger, then subscribes to
 * the action feed. Returns the battle as it stands plus the live link.
 */
export async function openSupabaseMatch(
  config: SupabaseConfig,
  matchId: string,
  password: string,
  side: string | null,
  handlers: MatchHandlers,
  journalLength: () => number,
  /** This browser's opaque claim key — what a side claim names as its holder. */
  claimKey = '',
): Promise<{ opened?: OpenedMatch; error?: string }> {
  const client = clientFor(config)
  const id = matchId.trim().toUpperCase()

  const { data, error } = await client.rpc('sfc_open_match', { p_id: id, p_password: password })
  if (error || !data) {
    return { error: reasonFrom(error, 'That match could not be opened.') }
  }
  const record = data as {
    name?: string
    sides?: string[]
    setup?: unknown
    actions?: unknown
  }

  /** Re-read the whole ledger — the answer to any gap or reordering. */
  const resync = async (): Promise<void> => {
    const { data: fresh } = await client.rpc('sfc_open_match', { p_id: id, p_password: password })
    if (!fresh) return
    const r = fresh as { setup?: unknown; actions?: unknown }
    handlers.onResync(saveFrom(r.setup, r.actions))
  }

  const channel: RealtimeChannel = client.channel(`sfc:${id}`, {
    config: { presence: { key: `${id}:${Math.random().toString(36).slice(2, 10)}` } },
  })

  channel
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sfc_actions', filter: `match_id=eq.${id}` },
      (payload) => {
        const row = payload.new as { seq?: number; action?: GameAction; hash?: string | null }
        if (typeof row?.seq !== 'number' || !row.action) return
        // The ledger counts from zero; the store's journal counts from one.
        const seq = row.seq + 1
        // Our own action, echoed back — already applied when it was taken.
        if (seq <= journalLength()) return
        handlers.onAction(row.action, seq, row.hash ?? undefined)
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'sfc_actions', filter: `match_id=eq.${id}` },
      () => {
        // An undo or a replacement rewrote history: take the ledger whole
        // rather than guess which tail went missing.
        void resync()
      },
    )
    .on('presence', { event: 'sync' }, () => {
      const seen = new Set<string>()
      for (const entries of Object.values(channel.presenceState())) {
        for (const entry of entries as Array<{ side?: string | null }>) {
          if (entry?.side) seen.add(entry.side)
        }
      }
      handlers.onPresence([...seen])
    })

  let claimed: string | null = side
  const subscribed = await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ side: claimed })
        finish(true)
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        finish(false)
        handlers.onDropped()
        return
      }
      if (status === 'CLOSED') handlers.onDropped()
    })
    setTimeout(() => finish(false), 15000)
  })
  if (!subscribed) {
    void client.removeChannel(channel)
    return { error: 'Could not open the live link to the project.' }
  }

  // Anything that landed between the read and the subscription is caught up
  // by one more read — cheap insurance against a gap at the seam.
  void resync()

  const link: MatchLink = {
    async append(action, seq, hash) {
      let { data: placed, error: appendError } = await client.rpc('sfc_append_action', {
        p_id: id,
        p_password: password,
        // The store counts from one; the ledger counts from zero.
        p_seq: seq - 1,
        p_action: action,
        p_hash: hash ?? null,
      })
      // A project on the pre-hash schema knows only the four-argument
      // function; the action still matters more than its fingerprint.
      if (isMissingFunction(appendError)) {
        ;({ data: placed, error: appendError } = await client.rpc('sfc_append_action', {
          p_id: id,
          p_password: password,
          p_seq: seq - 1,
          p_action: action,
        }))
      }
      // -1 means the ledger moved while we were deciding: it wins, we re-read.
      if (appendError || placed === -1) await resync()
    },
    async undo(lengthAfter) {
      const { data: undone, error: undoError } = await client.rpc('sfc_undo', {
        p_id: id,
        p_password: password,
        p_length_after: lengthAfter,
      })
      if (undoError || undone === -1) await resync()
    },
    async replace(save) {
      await client.rpc('sfc_replace_match', {
        p_id: id,
        p_password: password,
        p_setup: save.setup,
        p_actions: save.actions,
      })
    },
    async claim(next) {
      /*
       * The ledger referees first: presence can only report that two players
       * sat in the same chair, the claim function refuses the second one.
       * A project on an older schema has no referee — the claim proceeds on
       * presence alone there, exactly as before the function existed.
       */
      if (claimKey) {
        const { data, error } = await client.rpc('sfc_claim_side', {
          p_id: id,
          p_password: password,
          p_side: next,
          p_key: claimKey,
        })
        if (!error && data === 'taken') return 'taken'
        // Any other failure — older schema, transient network — falls back
        // to the presence-only claim this always was. Refusing here would
        // read as "side taken" to a player whose wifi blinked.
      }
      claimed = next
      await channel.track({ side: next })
      return 'ok'
    },
    async setWaiting(sides) {
      const { error } = await client.rpc('sfc_set_waiting', {
        p_id: id,
        p_password: password,
        p_waiting: sides,
      })
      // Best-effort: an older schema simply has no whose-move column.
      void error
    },
    resync,
    close() {
      void client.removeChannel(channel)
    },
  }

  return {
    opened: {
      link,
      name: String(record.name ?? 'A StarForce battle'),
      sides: Array.isArray(record.sides) ? record.sides.map(String) : [],
      save: saveFrom(record.setup, record.actions),
    },
  }
}

