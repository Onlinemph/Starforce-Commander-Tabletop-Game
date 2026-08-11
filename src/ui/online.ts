import { useSyncExternalStore } from 'react'
import type { SavedGame } from '../data/savedGame'
import type { GameAction } from '../engine/actions'
import { hangUp as rtcHangUp } from './net'
import {
  applyRemoteAction,
  applyRemoteSave,
  applyRemoteUndo,
  currentSave,
  currentSetup,
  currentStateHash,
  enableReadyGate,
  gateIsWaiting,
  journalLength,
  readyAbsentSides,
  setMatchPresence,
  setMatchSide,
  setNetHooks,
  suppressAi,
} from './store'
// The Supabase client is a substantial dependency and most battles never
// touch it, so it is fetched only when an online match actually needs it.
// The type import is erased at build time and costs nothing.
import type { MatchLink } from './supabaseMatch'

/**
 * Online matches: the copy-paste link, grown a memory.
 *
 * A tiny match service (server/) stores each battle as the same
 * (setup + actions) document the game saves locally, appends actions in
 * arrival order, and relays them to whoever is connected. This module is the
 * client: it mirrors the WebRTC layer's shape — same store hooks, same
 * corrective-sync convergence — but the ordering authority is the service,
 * and the match outlives everyone's tabs. Refresh, change devices, come back
 * tomorrow: the enrollment is remembered and the battle replays exactly.
 */

export type OnlinePhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

export interface OnlineState {
  phase: OnlinePhase
  server: string
  matchId: string | null
  matchName: string | null
  /** The side this player commands, once chosen. */
  side: string | null
  /** Sides of the battle, as the match records them. */
  sides: string[]
  /** Sides with someone connected right now. */
  present: string[]
  /** Whether this client created the match (it drives any AI sides). */
  creator: boolean
  error: string | null
}

/**
 * The first of these that was actually configured.
 *
 * A build variable that is declared but empty — which is exactly what a CI
 * step produces from a repository variable nobody set — is *not* a value to
 * fall back from with `??`, because an empty string is neither null nor
 * undefined. That distinction quietly cost a whole release its pre-filled
 * match service, so the emptiness is checked rather than the nullishness.
 */
export function firstConfigured(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed.length > 0) return trimmed
  }
  return ''
}

/**
 * The match service every browser on this site starts with, so nobody has to
 * type one: a Supabase project URL, or a deployed Worker's address. Set the
 * matching repository variables and the Pages build bakes them in; the Online
 * panel still lets a player point elsewhere.
 */
export const DEFAULT_MATCH_SERVER: string = firstConfigured(
  import.meta.env.VITE_SUPABASE_URL as string | undefined,
  import.meta.env.VITE_MATCH_SERVER as string | undefined,
)

/**
 * A Supabase project needs its publishable key alongside the URL. The key is
 * designed to be public — it ships in every client bundle — so it also rides
 * inside invite links, which is what lets a friend join a Supabase match
 * without configuring anything at all.
 */
export const DEFAULT_MATCH_KEY: string = firstConfigured(
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
)

const ENROLL_KEY = 'sfc.online-match.v1'

interface Enrollment {
  server: string
  /** Supabase anon key; absent for a Worker match service. */
  key?: string
  matchId: string
  password: string
  side: string | null
  creator: boolean
}

/** Does this address name a Supabase project rather than a Worker service? */
export function looksLikeSupabase(url: string): boolean {
  return /supabase\.(co|in|net)/i.test(url) || /^https?:\/\/[^/]*supabase/i.test(url)
}

/** Which backend an enrollment speaks to. */
function isSupabase(enrolled: Pick<Enrollment, 'server' | 'key'>): boolean {
  return Boolean(enrolled.key) && looksLikeSupabase(enrolled.server)
}

let state: OnlineState = {
  phase: 'idle',
  server: '',
  matchId: null,
  matchName: null,
  side: null,
  sides: [],
  present: [],
  creator: false,
  error: null,
}

let socket: WebSocket | null = null
let supabase: MatchLink | null = null
let enrollment: Enrollment | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 2000
/** Set while the *user* is leaving, so the close handler stays quiet. */
let leaving = false

let version = 0
const listeners = new Set<() => void>()
function set(next: Partial<OnlineState>): void {
  const before = state
  state = { ...state, ...next }
  /*
   * The store needs to know which side this console commands, because that is
   * what makes undo answerable to somebody. Routing it through the one setter
   * covers every path that can change it — enrolling, claiming a side mid-
   * match, and leaving, which nulls it and hands undo back its freedom.
   * Presence rides along for the damage-choice relay, which must tell a side
   * that can be asked from a chair that is empty.
   */
  if (state.present !== before.present || state.creator !== before.creator) {
    setMatchPresence(state.present, state.creator)
  }
  if (state.side !== before.side) setMatchSide(state.side)
  version += 1
  for (const l of listeners) l()
}

export function useOnline(): OnlineState {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
    () => version,
  )
  return state
}

// ---------------------------------------------------------------------------
// Enrollment persistence — what makes a refresh survivable
// ---------------------------------------------------------------------------

function remember(): void {
  try {
    if (enrollment) localStorage.setItem(ENROLL_KEY, JSON.stringify(enrollment))
    else localStorage.removeItem(ENROLL_KEY)
  } catch {
    // Losing persistence costs auto-rejoin, never the live link.
  }
}

function recall(): Enrollment | null {
  try {
    const raw = localStorage.getItem(ENROLL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Enrollment
    return parsed.server && parsed.matchId ? parsed : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The service link
// ---------------------------------------------------------------------------

/** 'match.example.workers.dev' or a full URL, normalised to an http(s) origin. */
function origin(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, '')
  if (/^https?:\/\//.test(trimmed)) return trimmed
  if (/^wss?:\/\//.test(trimmed)) return trimmed.replace(/^ws/, 'http')
  return trimmed.includes('localhost') || trimmed.includes('127.0.0.1')
    ? `http://${trimmed}`
    : `https://${trimmed}`
}

function wsUrl(server: string, matchId: string): string {
  return `${origin(server).replace(/^http/, 'ws')}/api/matches/${matchId}/ws`
}

type ServerMessage =
  | { t: 'welcome'; name: string; sides: string[]; save: SavedGame; present: string[] }
  | { t: 'refused'; reason: string }
  | { t: 'action'; seq: number; action: GameAction; hash?: string }
  | { t: 'undo'; lengthAfter: number }
  | { t: 'sync'; save: SavedGame }
  | { t: 'presence'; present: string[] }

function sendRaw(msg: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

function connect(): void {
  if (!enrollment) return
  const enrolled = enrollment
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  socket?.close()
  supabase?.close()
  supabase = null

  if (isSupabase(enrolled)) {
    void connectSupabase(enrolled)
    return
  }

  let ws: WebSocket
  try {
    ws = new WebSocket(wsUrl(enrolled.server, enrolled.matchId))
  } catch {
    set({ phase: 'failed', error: 'That server address does not parse.' })
    return
  }
  socket = ws
  set({
    phase: state.phase === 'connected' ? 'reconnecting' : 'connecting',
    server: enrolled.server,
    matchId: enrolled.matchId,
    error: null,
  })

  ws.onopen = () => {
    sendRaw({ t: 'hello', password: enrolled.password, side: enrolled.side ?? undefined })
  }

  ws.onmessage = (event) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(event.data)) as ServerMessage
    } catch {
      return
    }
    receive(msg)
  }

  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    setNetHooks(null)
    if (leaving || !enrollment) return
    // The match outlives the link: keep trying, with a gentle backoff.
    set({ phase: 'reconnecting' })
    retryTimer = setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)
  }
}

/**
 * The Supabase path. Same three duties as the socket path — take the ledger
 * whole on arrival, hand the store somewhere to send its actions, and keep
 * trying when the link drops — with Postgres as the ordering authority and
 * Realtime as the relay.
 */
async function connectSupabase(enrolled: Enrollment): Promise<void> {
  set({
    phase: state.phase === 'connected' ? 'reconnecting' : 'connecting',
    server: enrolled.server,
    matchId: enrolled.matchId,
    error: null,
  })

  const retry = () => {
    if (leaving || enrollment !== enrolled) return
    set({ phase: 'reconnecting' })
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)
  }

  const { openSupabaseMatch } = await import('./supabaseMatch')
  const { opened, error } = await openSupabaseMatch(
    { url: enrolled.server, key: enrolled.key ?? '' },
    enrolled.matchId,
    enrolled.password,
    enrolled.side,
    {
      onAction: (action, seq) => {
        if (applyRemoteAction(action, seq, false) === 'mismatch') void supabase?.resync()
      },
      onResync: (save) => {
        applyRemoteSave(save)
      },
      onPresence: (present) => set({ present }),
      onDropped: retry,
    },
    journalLength,
  )

  // A wrong password or a missing match is final; a link that would not open
  // is worth another try.
  if (!opened) {
    if (enrollment !== enrolled) return
    if (/password|no match/i.test(error ?? '')) {
      leaveMatch()
      set({ phase: 'failed', error: error ?? 'That match could not be opened.' })
      return
    }
    set({ error: error ?? null })
    retry()
    return
  }
  if (enrollment !== enrolled || leaving) {
    opened.link.close()
    return
  }

  retryDelay = 2000
  supabase = opened.link

  const problem = applyRemoteSave(opened.save)
  if (problem) {
    leaveMatch()
    set({ phase: 'failed', error: problem })
    return
  }
  // One AI driver per match — the creator's client.
  suppressAi(!enrolled.creator)
  setNetHooks({
    onAction: (action, seq) => void supabase?.append(action, seq),
    onUndo: (lengthAfter) => void supabase?.undo(lengthAfter),
    onReplace: (saved) => void supabase?.replace(saved),
  })
  set({
    phase: 'connected',
    matchName: opened.name,
    sides: opened.sides,
    side: enrolled.side,
    creator: enrolled.creator,
    error: null,
  })
}

/**
 * Cover for a side that has nobody at its console.
 *
 * Only the creator's client does it — the same one that drives the AI — so two
 * consoles cannot both volunteer the same absent side and journal it twice.
 * And only while the gate is actually holding: readying an absent side that
 * nothing is waiting on would just be noise in the log.
 */
function coverAbsentSides(present: string[]): void {
  if (!enrollment?.creator) return
  if (!gateIsWaiting()) return
  readyAbsentSides(present, currentSetup().aiSides ?? [])
}

function receive(msg: ServerMessage): void {
  switch (msg.t) {
    case 'welcome': {
      retryDelay = 2000
      // The ledger is the truth of the match; the local battle becomes it.
      const problem = applyRemoteSave(msg.save)
      if (problem) {
        leaveMatch()
        set({ phase: 'failed', error: problem })
        return
      }
      // One AI driver per match — the creator's client.
      suppressAi(!(enrollment?.creator ?? false))
      setNetHooks({
        // The hash is of the state this action just produced, so the peer can
        // check that applying the same action left it in the same place.
        onAction: (action, seq) =>
          sendRaw({ t: 'action', seq, action, hash: currentStateHash() }),
        onUndo: (lengthAfter) => sendRaw({ t: 'undo', lengthAfter }),
        onReplace: (saved) => sendRaw({ t: 'replace', save: saved }),
      })
      set({
        phase: 'connected',
        matchName: msg.name,
        sides: msg.sides,
        present: msg.present,
        side: enrollment?.side ?? null,
        creator: enrollment?.creator ?? false,
        error: null,
      })
      return
    }
    case 'refused':
      leaveMatch()
      set({ phase: 'failed', error: msg.reason })
      return
    case 'action': {
      if (applyRemoteAction(msg.action, msg.seq, false) === 'mismatch') {
        sendRaw({ t: 'syncreq' })
        return
      }
      /*
       * Same journal, different board. The sequence check above cannot see
       * this: both clients agree about every action ever taken and disagree
       * about the result, which happens when the two are running different
       * builds or the engine has read something outside the seeded RNG.
       * Neither side can tell which of them is wrong, so the ledger settles
       * it — and the player is told, because a silent correction that moves
       * their ships is worse than no correction at all.
       */
      if (msg.hash && msg.hash !== currentStateHash()) {
        set({ error: 'The two boards had drifted apart — resynchronising from the match record.' })
        sendRaw({ t: 'syncreq' })
      }
      return
    }
    case 'undo':
      if (applyRemoteUndo(msg.lengthAfter, false) === 'mismatch') sendRaw({ t: 'syncreq' })
      return
    case 'sync':
      applyRemoteSave(msg.save)
      return
    case 'presence':
      set({ present: msg.present })
      coverAbsentSides(msg.present)
      return
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Host the battle on screen as a persistent match. Resolves to the code. */
export async function createMatch(
  server: string,
  name: string,
  password: string,
  side: string | null,
  sides: string[],
  key?: string,
  isPublic = true,
): Promise<string | null> {
  /**
   * A match plots in two places at once, so the segment has to close by
   * agreement rather than by whoever clicks first (B1.9.1). Turned on before
   * the save is published, so the guest's copy arrives already gated.
   */
  enableReadyGate()
  const save = currentSave()

  if (key && looksLikeSupabase(server)) {
    const { createSupabaseMatch } = await import('./supabaseMatch')
    const { id, error } = await createSupabaseMatch(
      { url: server, key },
      name,
      password,
      sides,
      save,
      isPublic,
    )
    if (!id) {
      set({ phase: 'failed', error: error ?? 'The project refused the match.' })
      return null
    }
    rtcHangUp(null)
    enrollment = { server, key, matchId: id, password, side, creator: true }
    remember()
    retryDelay = 2000
    connect()
    return id
  }

  let res: Response
  try {
    res = await fetch(`${origin(server)}/api/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password, sides, save }),
    })
  } catch {
    set({ phase: 'failed', error: 'Could not reach the match server.' })
    return null
  }
  const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
  if (!res.ok || !body?.id) {
    set({ phase: 'failed', error: body?.error ?? 'The server refused the match.' })
    return null
  }
  rtcHangUp(null)
  enrollment = { server, matchId: body.id, password, side, creator: true }
  remember()
  connect()
  return body.id
}

/** Join a match by code and password. The battle arrives over the link. */
export function joinMatch(server: string, matchId: string, password: string, key?: string): void {
  rtcHangUp(null)
  enrollment = {
    server,
    key: key || undefined,
    matchId: matchId.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
    password,
    side: null,
    creator: false,
  }
  remember()
  retryDelay = 2000
  connect()
}

/** Take command of a side (shown to the other players as presence). */
export function claimSide(side: string): void {
  if (!enrollment) return
  enrollment.side = side
  remember()
  set({ side })
  if (supabase) void supabase.claim(side)
  else sendRaw({ t: 'claim', side })
}

/** Leave for good: forget the enrollment and stop reconnecting. */
export function leaveMatch(): void {
  leaving = true
  enrollment = null
  remember()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  socket?.close()
  socket = null
  supabase?.close()
  supabase = null
  setNetHooks(null)
  suppressAi(false)
  set({
    phase: 'idle',
    matchId: null,
    matchName: null,
    side: null,
    sides: [],
    present: [],
    creator: false,
    error: null,
  })
  leaving = false
}

/** The last server used, for pre-filling the panel. */
export function lastServer(): string {
  return recall()?.server ?? state.server
}

/** The last Supabase key used, for pre-filling the panel. */
export function lastKey(): string {
  return recall()?.key ?? ''
}

/**
 * Enrolled in a match — connected, connecting or reconnecting. While this
 * holds, the battle belongs to the match rather than to this browser: its
 * setup is fixed, and the controls that would rebuild it stand down.
 */
export function inMatch(state: OnlineState): boolean {
  return state.matchId !== null && state.phase !== 'idle' && state.phase !== 'failed'
}

/** Browse the matches a project is offering. Supabase backend only. */
export async function browseMatches(
  server: string,
  key: string,
): Promise<{ matches?: import('./supabaseMatch').MatchSummary[]; error?: string }> {
  if (!key || !looksLikeSupabase(server)) {
    return { error: 'The match browser needs a Supabase project.' }
  }
  const { listSupabaseMatches } = await import('./supabaseMatch')
  return listSupabaseMatches({ url: server, key })
}

// ---------------------------------------------------------------------------
// Invite links — the whole join, in one tap
// ---------------------------------------------------------------------------

/**
 * One link carries server, code and password, so a joiner opens it and only
 * picks a side. The payload rides in the URL fragment, which browsers never
 * send to any server — the same tavern-door security as the password itself,
 * traveling the same private channel the password would have.
 */
export function inviteLink(): string | null {
  if (!enrollment) return null
  const payload = {
    s: enrollment.server,
    m: enrollment.matchId,
    p: enrollment.password,
    // The anon key is public by design, and carrying it means a joiner needs
    // nothing configured — the link is the whole setup.
    ...(enrollment.key ? { k: enrollment.key } : {}),
  }
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${location.origin}${location.pathname}#join=${encoded}`
}

function joinFromHash(): boolean {
  const match = /[#&]join=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (!match) return false
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      s?: string
      m?: string
      p?: string
      k?: string
    }
    // The invite is consumed: a refresh reconnects via the enrollment, not
    // by replaying the link.
    history.replaceState(null, '', location.pathname + location.search)
    if (!payload.s || !payload.m || typeof payload.p !== 'string') return false
    joinMatch(payload.s, payload.m, payload.p, payload.k)
    return true
  } catch {
    return false
  }
}

// Boot: an invite link in the URL joins its match; otherwise a remembered
// enrollment reconnects by itself — the refresh answer.
if (typeof WebSocket !== 'undefined' && typeof location !== 'undefined') {
  if (!joinFromHash()) {
    enrollment = recall()
    if (enrollment) {
      set({
        server: enrollment.server,
        matchId: enrollment.matchId,
        creator: enrollment.creator,
        side: enrollment.side,
      })
      queueMicrotask(connect)
    }
  }
}
