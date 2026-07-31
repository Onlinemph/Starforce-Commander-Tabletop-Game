import { useState } from 'react'
import { acceptReply, hangUp, hostInvite, joinInvite, useNet } from './net'

/**
 * Serverless remote play: the invitation and reply are copy-paste codes, so
 * the whole exchange can travel over any chat channel the players already
 * share. Once linked, every action syncs live in both directions.
 */
export function RemotePanel({ onClose }: { onClose: () => void }) {
  const net = useNet()
  const [reply, setReply] = useState('')
  const [invite, setInvite] = useState('')
  const [copied, setCopied] = useState(false)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // The textarea is selectable; manual copy still works.
    }
  }

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Remote play">
      <div className="picker remote-panel">
        <header>
          <h2>Remote play</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="remote-body">
          {net.phase === 'connected' ? (
            <div className="remote-status">
              <p>
                <strong>Linked.</strong> Every action now syncs live in both directions — the
                host&apos;s battle is the one you are both playing.
              </p>
              <p className="hint">
                Pick your side under <em>Viewing</em> below the map, and leave the other side to
                your opponent. Ship forms stay hidden exactly as across a real table.
              </p>
              <button type="button" onClick={() => hangUp('You ended the link.')}>
                End the link
              </button>
            </div>
          ) : (
            <div className="remote-columns">
              <section>
                <h3>Host a battle</h3>
                <p className="hint">
                  Your current battle — scenario, fleets, everything played so far — becomes the
                  shared one.
                </p>
                <button type="button" className="primary" onClick={() => void hostInvite()}>
                  Create invite
                </button>
                {net.role === 'host' && net.code && (
                  <>
                    <label className="field">
                      <span>1 · Send this invite to the other player</span>
                      <textarea readOnly value={net.code} rows={4} onFocus={(e) => e.target.select()} />
                    </label>
                    <button type="button" className="chip" onClick={() => void copy(net.code!)}>
                      {copied ? 'Copied' : 'Copy invite'}
                    </button>
                    <label className="field">
                      <span>2 · Paste their reply here</span>
                      <textarea
                        value={reply}
                        rows={4}
                        placeholder="Reply code…"
                        onChange={(e) => setReply(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      disabled={!reply.trim()}
                      onClick={() => void acceptReply(reply)}
                    >
                      Connect
                    </button>
                  </>
                )}
              </section>

              <section>
                <h3>Join a battle</h3>
                <label className="field">
                  <span>1 · Paste the invite you were sent</span>
                  <textarea
                    value={invite}
                    rows={4}
                    placeholder="Invite code…"
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={!invite.trim()}
                  onClick={() => void joinInvite(invite)}
                >
                  Make reply
                </button>
                {net.role === 'guest' && net.code && (
                  <>
                    <label className="field">
                      <span>2 · Send this reply back — the link opens when they connect</span>
                      <textarea readOnly value={net.code} rows={4} onFocus={(e) => e.target.select()} />
                    </label>
                    <button type="button" className="chip" onClick={() => void copy(net.code!)}>
                      {copied ? 'Copied' : 'Copy reply'}
                    </button>
                  </>
                )}
              </section>
            </div>
          )}

          {net.error && <p className="fire-error">{net.error}</p>}
          <p className="hint">
            Browser-to-browser, no server: the codes carry the connection details, and the battle
            itself never touches a third machine. Works across home networks in most cases; a very
            strict corporate NAT may refuse the direct path.
          </p>
        </div>
      </div>
    </div>
  )
}
