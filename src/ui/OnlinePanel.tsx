import { useState } from 'react'
import { useGame } from './store'
import { claimSide, createMatch, joinMatch, leaveMatch, useOnline } from './online'

/**
 * The online lobby. Host the battle on screen as a persistent match — it
 * lives on the match service, gated by a password, and survives everyone
 * closing their tabs — or join one by its code. Enrollment is remembered,
 * so a refresh reconnects by itself.
 */

const SERVER_KEY = 'sfc.match-server.v1'

function rememberedServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberServer(server: string): void {
  try {
    localStorage.setItem(SERVER_KEY, server)
  } catch {
    // Only the pre-fill is lost.
  }
}

export function OnlinePanel({ onClose }: { onClose: () => void }) {
  const online = useOnline()
  const game = useGame()
  const sides = [...new Set(game.ships.map((s) => s.side))]

  const [server, setServer] = useState(() => online.server || rememberedServer())
  const [name, setName] = useState(game.scenario.name)
  const [password, setPassword] = useState('')
  const [hostSide, setHostSide] = useState(sides[0] ?? '')
  const [code, setCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const enrolled = online.matchId !== null && online.phase !== 'idle' && online.phase !== 'failed'

  const host = async () => {
    if (!server.trim() || !password) return
    setBusy(true)
    rememberServer(server.trim())
    await createMatch(server.trim(), name.trim() || game.scenario.name, password, hostSide, sides)
    setBusy(false)
  }

  const join = () => {
    if (!server.trim() || !code.trim() || !joinPassword) return
    rememberServer(server.trim())
    joinMatch(server.trim(), code, joinPassword)
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
                <span>Match server</span>
                <input
                  placeholder="sfc-matches.your-name.workers.dev"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
              </label>

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
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !server.trim() || !password}
                    onClick={() => void host()}
                  >
                    Create match
                  </button>
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
                    disabled={!server.trim() || !code.trim() || !joinPassword}
                    onClick={join}
                  >
                    Join match
                  </button>
                </section>
              </div>
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
                Share the code and password with the other commander. Claiming a side shows the
                others who holds it{online.creator ? '; as the host, your device runs any AI sides' : ''}.
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
