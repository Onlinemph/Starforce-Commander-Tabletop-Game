/**
 * The match service: a tiny, dumb, ordered ledger.
 *
 * A StarForce battle is (setup + action journal) — a few kilobytes of JSON
 * that replays deterministically. So an online match needs no game logic on
 * the server at all: one Durable Object per match stores the battle, appends
 * actions in arrival order, and pushes them to whoever is connected. The
 * clients hold the engine; the server holds the truth of what order things
 * happened in. A player who refreshes, switches devices, or comes back a day
 * later fetches the record and replays it — the same mechanism as the game's
 * own save files.
 *
 * Matches are password-gated (casual gatekeeping, not authentication) and
 * expire after MATCH_TTL_MS without a single action or connection, enforced
 * by the object's alarm.
 */

export interface Env {
  MATCH: DurableObjectNamespace
}

/** Idle time before a match is deleted. One constant to taste. */
const MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Everything the service will hold for one match. */
interface Meta {
  name: string
  passwordHash: string
  sides: string[]
  createdAt: number
}

interface SavedGame {
  version: 1
  setup: { scenarioId: string; seed: number }
  actions: unknown[]
}

type ClientMessage =
  | { t: 'hello'; password: string; side?: string }
  | { t: 'claim'; side: string }
  | { t: 'action'; seq: number; action: unknown; hash?: string }
  | { t: 'undo'; lengthAfter: number }
  | { t: 'replace'; save: SavedGame }
  | { t: 'syncreq' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Match codes read aloud well: no 0/O or 1/I, grouped like KJ4-Q7N. */
function newMatchId(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length])
  return chars.join('')
}

function looksLikeSave(save: unknown): save is SavedGame {
  const s = save as Partial<SavedGame> | null
  return (
    s?.version === 1 &&
    typeof s.setup?.scenarioId === 'string' &&
    typeof s.setup?.seed === 'number' &&
    Array.isArray(s.actions)
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(request.url)

    // POST /api/matches — create a match from a battle file.
    if (url.pathname === '/api/matches' && request.method === 'POST') {
      let body: { name?: string; password?: string; sides?: string[]; save?: unknown }
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Bad JSON.' }, 400)
      }
      if (!body.password || !looksLikeSave(body.save)) {
        return json({ error: 'A match needs a password and a battle.' }, 400)
      }
      const id = newMatchId()
      const stub = env.MATCH.get(env.MATCH.idFromName(id))
      const res = await stub.fetch('https://match/init', {
        method: 'POST',
        body: JSON.stringify({
          name: String(body.name ?? 'A StarForce battle').slice(0, 80),
          passwordHash: await sha256(body.password),
          sides: Array.isArray(body.sides) ? body.sides.map(String).slice(0, 6) : [],
          save: body.save,
        }),
      })
      if (!res.ok) return json({ error: 'Could not create the match.' }, 500)
      return json({ id })
    }

    // /api/matches/:id/ws — the live link into a match.
    const ws = url.pathname.match(/^\/api\/matches\/([A-Za-z0-9]{4,12})\/ws$/)
    if (ws) {
      const stub = env.MATCH.get(env.MATCH.idFromName(ws[1].toUpperCase()))
      return stub.fetch(request)
    }

    // GET /api/matches/:id — does it exist, and what is it called?
    const info = url.pathname.match(/^\/api\/matches\/([A-Za-z0-9]{4,12})$/)
    if (info && request.method === 'GET') {
      const stub = env.MATCH.get(env.MATCH.idFromName(info[1].toUpperCase()))
      const res = await stub.fetch('https://match/info')
      return json(await res.json(), res.status)
    }

    return json({ error: 'Not found.' }, 404)
  },
}

export class Match implements DurableObject {
  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/init' && request.method === 'POST') {
      const body = (await request.json()) as Meta & { save: SavedGame }
      if (await this.state.storage.get('meta')) {
        return json({ error: 'exists' }, 409)
      }
      const meta: Meta = {
        name: body.name,
        passwordHash: body.passwordHash,
        sides: body.sides,
        createdAt: Date.now(),
      }
      await this.state.storage.put('meta', meta)
      await this.state.storage.put('save', body.save)
      await this.touch()
      return json({ ok: true })
    }

    if (url.pathname === '/info') {
      const meta = await this.state.storage.get<Meta>('meta')
      if (!meta) return json({ error: 'No such match.' }, 404)
      const save = await this.state.storage.get<SavedGame>('save')
      return json({
        name: meta.name,
        sides: meta.sides,
        actions: save?.actions.length ?? 0,
        present: this.presentSides(),
      })
    }

    // The websocket upgrade. Authentication happens in the hello message.
    if (request.headers.get('Upgrade') === 'websocket') {
      const meta = await this.state.storage.get<Meta>('meta')
      if (!meta) return json({ error: 'No such match.' }, 404)
      const pair = new WebSocketPair()
      // Hibernation API: the object may sleep between messages and the
      // sockets survive it — an idle match costs nothing to keep.
      this.state.acceptWebSocket(pair[1])
      pair[1].serializeAttachment({ authed: false, side: null })
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    return json({ error: 'Not found.' }, 404)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw)) as ClientMessage
    } catch {
      return
    }
    const attachment = (ws.deserializeAttachment() ?? { authed: false, side: null }) as {
      authed: boolean
      side: string | null
    }

    if (msg.t === 'hello') {
      const meta = await this.state.storage.get<Meta>('meta')
      if (!meta || (await sha256(msg.password ?? '')) !== meta.passwordHash) {
        ws.send(JSON.stringify({ t: 'refused', reason: 'Wrong password.' }))
        ws.close(4001, 'refused')
        return
      }
      ws.serializeAttachment({ authed: true, side: msg.side ?? null })
      const save = await this.state.storage.get<SavedGame>('save')
      ws.send(
        JSON.stringify({
          t: 'welcome',
          name: meta.name,
          sides: meta.sides,
          save,
          present: this.presentSides(),
        }),
      )
      await this.touch()
      this.broadcastPresence()
      return
    }

    if (!attachment.authed) {
      ws.close(4001, 'hello first')
      return
    }

    switch (msg.t) {
      case 'claim': {
        ws.serializeAttachment({ authed: true, side: String(msg.side) })
        this.broadcastPresence()
        return
      }
      case 'action': {
        const save = (await this.state.storage.get<SavedGame>('save'))!
        if (msg.seq === save.actions.length + 1) {
          save.actions.push(msg.action)
          await this.state.storage.put('save', save)
          await this.touch()
          // The hash rides along untouched: it is the sender's fingerprint of
          // the state this action produced, and the receiving client compares
          // it against its own. The service never interprets it.
          this.broadcast(ws, { t: 'action', seq: msg.seq, action: msg.action, hash: msg.hash })
        } else {
          // The sender's record disagrees with the ledger: the ledger wins.
          ws.send(JSON.stringify({ t: 'sync', save }))
        }
        return
      }
      case 'undo': {
        const save = (await this.state.storage.get<SavedGame>('save'))!
        if (msg.lengthAfter === save.actions.length - 1) {
          save.actions.pop()
          await this.state.storage.put('save', save)
          await this.touch()
          this.broadcast(ws, { t: 'undo', lengthAfter: msg.lengthAfter })
        } else {
          ws.send(JSON.stringify({ t: 'sync', save }))
        }
        return
      }
      case 'replace': {
        // A rematch or an imported battle: the match moves on wholesale.
        if (!looksLikeSave(msg.save)) return
        await this.state.storage.put('save', msg.save)
        await this.touch()
        this.broadcast(ws, { t: 'sync', save: msg.save })
        return
      }
      case 'syncreq': {
        const save = await this.state.storage.get<SavedGame>('save')
        ws.send(JSON.stringify({ t: 'sync', save }))
        return
      }
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcastPresence()
  }

  async webSocketError(): Promise<void> {
    this.broadcastPresence()
  }

  /** Idle matches expire; every touch pushes the deadline out. */
  private async touch(): Promise<void> {
    await this.state.storage.put('activity', Date.now())
    await this.state.storage.setAlarm(Date.now() + MATCH_TTL_MS)
  }

  async alarm(): Promise<void> {
    const activity = (await this.state.storage.get<number>('activity')) ?? 0
    if (Date.now() - activity >= MATCH_TTL_MS && this.state.getWebSockets().length === 0) {
      await this.state.storage.deleteAll()
    } else {
      await this.state.storage.setAlarm(activity + MATCH_TTL_MS)
    }
  }

  private presentSides(): string[] {
    const sides = new Set<string>()
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as { authed: boolean; side: string | null } | null
      if (a?.authed && a.side) sides.add(a.side)
    }
    return [...sides]
  }

  private broadcast(from: WebSocket | null, msg: unknown): void {
    const text = JSON.stringify(msg)
    for (const ws of this.state.getWebSockets()) {
      if (ws === from) continue
      const a = ws.deserializeAttachment() as { authed: boolean } | null
      if (!a?.authed) continue
      try {
        ws.send(text)
      } catch {
        // A socket mid-close; presence will settle on the close event.
      }
    }
  }

  private broadcastPresence(): void {
    this.broadcast(null, { t: 'presence', present: this.presentSides() })
  }
}
