import { useSyncExternalStore } from 'react'
import type { SavedGame } from '../data/savedGame'
import type { GameAction } from '../engine/actions'
import { hangUp as rtcHangUp } from './net'
import {
  applyRemoteAction,
  applyRemoteSave,
  applyRemoteUndo,
  currentSave,
  setNetHooks,
  suppressAi,
} from './store'

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

const ENROLL_KEY = 'sfc.online-match.v1'

interface Enrollment {
  server: string
  matchId: string
  password: string
  side: string | null
  creator: boolean
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
let enrollment: Enrollment | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 2000
/** Set while the *user* is leaving, so the close handler stays quiet. */
let leaving = false

let version = 0
const listeners = new Set<() => void>()
function set(next: Partial<OnlineState>): void {
  state = { ...state, ...next }
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
  | { t: 'action'; seq: number; action: GameAction }
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
        onAction: (action, seq) => sendRaw({ t: 'action', seq, action }),
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
    case 'action':
      if (applyRemoteAction(msg.action, msg.seq, false) === 'mismatch') sendRaw({ t: 'syncreq' })
      return
    case 'undo':
      if (applyRemoteUndo(msg.lengthAfter, false) === 'mismatch') sendRaw({ t: 'syncreq' })
      return
    case 'sync':
      applyRemoteSave(msg.save)
      return
    case 'presence':
      set({ present: msg.present })
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
): Promise<string | null> {
  const save = currentSave()
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
export function joinMatch(server: string, matchId: string, password: string): void {
  rtcHangUp(null)
  enrollment = {
    server,
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
  sendRaw({ t: 'claim', side })
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

// Boot: a remembered enrollment reconnects by itself — the refresh answer.
enrollment = recall()
if (enrollment && typeof WebSocket !== 'undefined') {
  set({ server: enrollment.server, matchId: enrollment.matchId, creator: enrollment.creator, side: enrollment.side })
  queueMicrotask(connect)
}
