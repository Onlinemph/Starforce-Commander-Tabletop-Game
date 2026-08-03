import { useEffect, useState } from 'react'
import { journalLength, useGame } from './store'
import {
  browseMatches,
  claimSide,
  createMatch,
  DEFAULT_MATCH_KEY,
  DEFAULT_MATCH_SERVER,
  inviteLink,
  joinMatch,
  lastKey,
  leaveMatch,
  looksLikeSupabase,
  useOnline,
} from './online'
import type { MatchSummary } from './supabaseMatch'

/**
 * The online lobby. Host the battle on screen as a persistent match — it
 * lives on the match service, gated by a password, and survives everyone
 * closing their tabs — or join one by its code. Enrollment is remembered,
 * so a refresh reconnects by itself.
 */

const SERVER_KEY = 'sfc.match-server.v1'
const ANON_KEY = 'sfc.match-key.v1'

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function rememberServer(server: string, anonKey: string): void {
  try {
    localStorage.setItem(SERVER_KEY, server)
    localStorage.setItem(ANON_KEY, anonKey)
  } catch {
    // Only the pre-fill is lost.
  }
}

export function OnlinePanel({ onClose }: { onClose: () => void }) {
  const online = useOnline()
  const game = useGame()
  const sides = [...new Set(game.ships.map((s) => s.side))]

  const [server, setServer] = useState(
    () => online.server || remembered(SERVER_KEY) || DEFAULT_MATCH_SERVER,
  )
  const [anonKey, setAnonKey] = useState(
    () => lastKey() || remembered(ANON_KEY) || DEFAULT_MATCH_KEY,
  )
  // A Supabase project needs its publishable key as well as its URL; a Worker
  // service needs only the address.
  const needsKey = looksLikeSupabase(server)
  const ready = server.trim().length > 0 && (!needsKey || anonKey.trim().length > 0)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState(game.scenario.name)
  const [password, setPassword] = useState('')
  const [hostSide, setHostSide] = useState(sides[0] ?? '')
  const [code, setCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [listed, setListed] = useState(true)
  const [browse, setBrowse] = useState<MatchSummary[] | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)

  const enrolled = online.matchId !== null && online.phase !== 'idle' && online.phase !== 'failed'

  const host = async () => {
    if (!ready || !password) return
    setBusy(true)
    rememberServer(server.trim(), anonKey.trim())
    await createMatch(
      server.trim(),
      name.trim() || game.scenario.name,
      password,
      hostSide,
      sides,
      anonKey.trim() || undefined,
      listed,
    )
    setBusy(false)
  }

  const refreshBrowse = async () => {
    if (!ready || !needsKey) return
    setBrowsing(true)
    setBrowseError(null)
    const { matches, error } = await browseMatches(server.trim(), anonKey.trim())
    setBrowse(matches ?? [])
    setBrowseError(error ?? null)
    setBrowsing(false)
  }

  // The list is worth having ready the moment the panel opens.
  useEffect(() => {
    if (!enrolled && needsKey && ready && browse === null) void refreshBrowse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolled, needsKey, ready])

  const join = () => {
    if (!ready || !code.trim() || !joinPassword) return
    rememberServer(server.trim(), anonKey.trim())
    joinMatch(server.trim(), code, joinPassword, anonKey.trim() || undefined)
  }

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Online match">
      <div className="picker online-panel">
        <header>
          <h2>Online match</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="online-body">
          {!enrolled && (
            <>
              <p className="online-intro">
                A match lives on the match service and stays there when everyone leaves — refresh,
                switch devices, come back tomorrow and the battle picks up exactly where it stood.
                Both players need the code and the password.
              </p>

              <label className="field grow">
                <span>Match service</span>
                <input
                  placeholder="https://your-project.supabase.co"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
              </label>
              {needsKey && (
                <label className="field grow">
                  <span>Supabase API key</span>
                  <input
                    placeholder="sb_publishable_… or eyJhbGciOi…"
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                  />
                </label>
              )}
              <p className="online-hint">
                {needsKey
                  ? 'Supabase project — the Connect button at the top of your dashboard shows the URL and key together. Use the publishable (or legacy anon) key, never the secret one. Publishable keys are meant to be public, so an invite link carries it and your opponent configures nothing.'
                  : 'A Supabase project URL, or the address of a deployed Worker match service.'}
              </p>

              <div className="online-columns">
                <section className="online-card">
                  <h3>Host this battle</h3>
                  <p>The battle on screen — scenario, fleets, designs and all — becomes the match.</p>
                  <label className="field grow">
                    <span>Match name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="field grow">
                    <span>Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <label className="field grow">
                    <span>You command</span>
                    <select value={hostSide} onChange={(e) => setHostSide(e.target.value)}>
                      {sides.map((side) => (
                        <option key={side} value={side}>
                          {side}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="checkbox"
                    title="Listed matches appear in the browser for anyone using this project. The password is still required to join; unlisted matches are reachable only by their code or invite link."
                  >
                    <input
                      type="checkbox"
                      checked={listed}
                      onChange={(e) => setListed(e.target.checked)}
                    />
                    List in the match browser
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !ready || !password}
                    onClick={() => void host()}
                  >
                    Create match
                  </button>
                  <p className="hint">
                    The scenario, fleets, terrain and options are fixed into the match as it is
                    created — set the battle up before hosting, because nobody can change it
                    afterwards.
                  </p>
                  <p className="hint">
                    {journalLength() === 0
                      ? 'Each segment will close by agreement: both players say when they are finished, so nobody moves the battle on while the other is still plotting (B1.9.1).'
                      : 'This battle is already under way, so it will be hosted without ready checks — a segment closes as soon as either player says so. Start a fresh battle to host with them.'}
                  </p>
                </section>

                <section className="online-card">
                  <h3>Join a match</h3>
                  <p>Get the code and password from the host.</p>
                  <label className="field grow">
                    <span>Match code</span>
                    <input
                      placeholder="KJ4Q7N"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <label className="field grow">
                    <span>Password</span>
                    <input
                      type="password"
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={!ready || !code.trim() || !joinPassword}
                    onClick={join}
                  >
                    Join match
                  </button>
                </section>
              </div>

              {needsKey && (
                <section className="online-card match-browser">
                  <div className="browser-head">
                    <h3>Open matches</h3>
                    <button
                      type="button"
                      className="chip"
                      disabled={!ready || browsing}
                      onClick={() => void refreshBrowse()}
                    >
                      {browsing ? 'Looking…' : 'Refresh'}
                    </button>
                  </div>
                  {browseError && <p className="online-error">{browseError}</p>}
                  {browse !== null && browse.length === 0 && !browseError && (
                    <p className="hint">
                      Nothing listed yet. Host a battle above and it will appear here for
                      everyone using this project.
                    </p>
                  )}
                  {browse !== null && browse.length > 0 && (
                    <ul className="match-list">
                      {browse.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            className={`match-row${code.trim().toUpperCase() === m.id ? ' is-on' : ''}`}
                            title="Pick this match, then type its password above"
                            onClick={() => setCode(m.id)}
                          >
                            <span className="match-title">{m.name}</span>
                            <span className="match-meta">
                              {m.id} · {m.sides.join(' vs ') || 'unknown sides'} ·{' '}
                              {m.moves === 0 ? 'not started' : `${m.moves} moves`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="hint">
                    Picking a match fills its code in above. You still need the password its host
                    chose.
                  </p>
                </section>
              )}
            </>
          )}

          {enrolled && (
            <div className="online-status">
              <p className="online-code">
                Match <strong>{online.matchId}</strong>
                {online.matchName ? <> · {online.matchName}</> : null}
              </p>
              <p className="online-phase" data-phase={online.phase}>
                {online.phase === 'connected'
                  ? 'Linked to the match service.'
                  : online.phase === 'reconnecting'
                    ? 'Reconnecting…'
                    : 'Connecting…'}
              </p>

              {inviteLink() && (
                <div className="online-invite">
                  <label className="field grow">
                    <span>Invite link — one tap joins, no typing</span>
                    <input readOnly value={inviteLink() ?? ''} onFocus={(e) => e.target.select()} />
                  </label>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteLink() ?? '').then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      })
                    }}
                  >
                    {copied ? 'Copied ✓' : 'Copy link'}
                  </button>
                </div>
              )}

              <div className="online-sides">
                {(online.sides.length > 0 ? online.sides : sides).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`chip${online.side === side ? ' is-on' : ''}`}
                    title={
                      online.present.includes(side)
                        ? `${side} has a commander connected`
                        : `${side} is unclaimed right now`
                    }
                    onClick={() => claimSide(side)}
                  >
                    {online.present.includes(side) ? '●' : '○'} {side}
                    {online.side === side ? ' — you' : ''}
                  </button>
                ))}
              </div>
              <p className="online-hint">
                Share the invite link (it carries the code and password), or the code and password
                separately. Claiming a side shows the others who holds it
                {online.creator ? '; as the host, your device runs any AI sides' : ''}.
              </p>

              <button type="button" className="chip danger" onClick={leaveMatch}>
                Leave match
              </button>
            </div>
          )}

          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    </div>
  )
}
