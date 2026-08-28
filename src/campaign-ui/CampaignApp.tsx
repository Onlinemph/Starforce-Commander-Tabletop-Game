/**
 * Border Command — the campaign console, thin over `src/campaign/`.
 *
 * Everything a player sees comes from `viewFor(map, state, side)`; everything
 * they do becomes interventions on the next phase move. Hotseat hands the
 * console across a fully opaque blackout (the tactical game's own B1.9
 * discipline, one level up); solo play drives the other side with the
 * view-typed doctrine in `campaign/solo.ts`, quick-resolving the battles it
 * starts; online play binds this console to ONE seat of a persistent match
 * (onlineCampaign.ts) — the view is locked to that seat, phase moves ride the
 * ledger, and the other commander plays from their own browser. The local
 * campaign file autosaves and travels as JSON; an online campaign's ledger is
 * the match itself.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameSetup, SavedGame } from '../data/savedGame'
import { loadCampaign, newCampaign, saveCampaign } from '../campaign/file'
import { DEFAULT_MATCH_KEY, DEFAULT_MATCH_SERVER } from '../ui/online'
import {
  fileFromLedger,
  hostCampaignMatch,
  listCampaignMatches,
  loadEnrollment,
  openCampaignMatch,
  saveEnrollment,
  SEAT_LABEL,
  stateFingerprint,
  type CampaignLedgerDoc,
  type CampaignMatchLink,
} from './onlineCampaign'
import { battleFileFor, hashText, readback, SIDE_LABEL } from '../campaign/handoff'
import {
  damageBand,
  effectiveSpeedTier,
  orderSpeedCap,
  orderedSpeed,
  unitSpeedCap,
  unitSpeedTiers,
} from '../campaign/logistics'
import { shipFormById } from '../data/ships'
import { quickResolve } from '../campaign/quickResolve'
import { LAUNCH_SCENARIOS } from '../campaign/scenarios'
import { soloOrders } from '../campaign/solo'
import { PhaseError, resolvePhase, type DetectionContext } from '../campaign/turn'
import {
  CONTACT_ATTRIBUTES,
  sideToMove,
  type BattleRecord,
  type CampaignFile,
  type CampaignScenario,
  type Hex,
  type Intervention,
  type PhaseMove,
  type ShipRecord,
  type Side,
  type SpeedTier,
  type StandingOrder,
  type Unit,
} from '../campaign/types'
import { snapToHexLine } from '../campaign/hexmap'
import { viewFor } from '../campaign/views'
import { CampaignMap } from './CampaignMap'
import { ForceEditor } from './ForceEditor'
import { downloadText, routeEntryPhases, stageOrder, stagedOrderFor, waypointRounds } from './helpers'

const AUTOSAVE_KEY = 'sfc-campaign-autosave'
const SOLO_KEY = 'sfc-campaign-solo'
const OPEN_KEY = 'sfc-campaign-open'

interface Props {
  /** Load a campaign battle into the tactical table and switch to it. */
  onFightBattle: (setup: GameSetup) => void
  /** The tactical table's current save, for reading a fought battle back. */
  readTableSave: () => SavedGame
  onExit: () => void
}

type Mode = 'menu' | 'blackout' | 'console'

export function CampaignApp({ onFightBattle, readTableSave, onExit }: Props) {
  const [file, setFile] = useState<CampaignFile | null>(() => {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY)
      if (!text) return null
      const loaded = loadCampaign(text)
      return typeof loaded === 'string' ? null : loaded
    } catch {
      return null
    }
  })
  const [soloB, setSoloB] = useState<boolean>(() => localStorage.getItem(SOLO_KEY) === '1')
  /**
   * Open table (the designer's testing ask): no blackout between commanders,
   * and a view switcher to look through EITHER side's sensors at any time —
   * for watching when ships are detected from both perspectives. Orders can
   * only be staged while viewing the side whose phase it is.
   */
  const [openTable, setOpenTable] = useState<boolean>(() => localStorage.getItem(OPEN_KEY) === '1')
  const [viewSide, setViewSide] = useState<Side>('A')
  /** A launch scenario opened for force editing, before any campaign exists. */
  const [editing, setEditing] = useState<{ id: string; scenario: CampaignScenario } | null>(null)
  // The blackout interstitial only serves two humans at one screen: solo and
  // the open table go straight to the console — including on the way BACK
  // from a tactical battle, which re-mounts this component.
  const [mode, setMode] = useState<Mode>(
    file ? (soloB || openTable ? 'console' : 'blackout') : 'menu',
  )
  const [pending, setPending] = useState<Intervention[]>([])
  const [stagedBattles, setStagedBattles] = useState<BattleRecord[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /** The online session, when this console is one seat of a hosted match. */
  const [online, setOnline] = useState<{
    link: CampaignMatchLink
    matchId: string
    name: string
    seat: Side
    present: string[]
    status: 'connected' | 'reconnecting'
  } | null>(null)
  const [joinForm, setJoinForm] = useState({ code: '', password: '', seat: 'B' as Side })
  const [hostForm, setHostForm] = useState({ name: '', password: '', isPublic: true })
  const [server, setServer] = useState(DEFAULT_MATCH_SERVER)
  const [serverKey, setServerKey] = useState(DEFAULT_MATCH_KEY)
  const [browse, setBrowse] = useState<Array<{ id: string; name: string; waiting: string[] }> | null>(null)
  const [busy, setBusy] = useState(false)
  // The live handlers need the latest file without re-opening the socket.
  const fileRef = useRef<CampaignFile | null>(null)
  fileRef.current = file
  const onlineRef = useRef<typeof online>(null)
  onlineRef.current = online

  const ctx: DetectionContext | null = useMemo(
    () => (file ? { map: file.map, scenario: file.scenario } : null),
    [file],
  )
  // Online, the console IS one seat; local, it is whoever's phase it is —
  // except at an open table, where the VIEW flips freely and only the moving
  // side's orders count.
  const moverSide: Side = file ? sideToMove(file.state.phase) : 'A'
  const side: Side = online ? online.seat : openTable ? viewSide : moverSide
  const myTurn = !file || !online || sideToMove(file.state.phase) === online.seat
  const view = useMemo(
    () => (file && ctx ? viewFor(file.map, file.state, side) : null),
    [file, ctx, side],
  )

  useEffect(() => {
    // An online campaign's persistence is the ledger, not this browser.
    if (file && !online) localStorage.setItem(AUTOSAVE_KEY, saveCampaign(file))
  }, [file, online])
  useEffect(() => {
    // Tell the match browser whose phase the campaign waits on. Best-effort.
    if (file && online) void online.link.setWaiting(SEAT_LABEL[sideToMove(file.state.phase)])
  }, [file, online])
  // Solo owns side B. If a file arrives mid-B (a hotseat save loaded with solo
  // on), the doctrine finishes B's turn before the human sees anything.
  useEffect(() => {
    if (online) return // online, the other seat is a person, never the doctrine
    if (soloB && mode === 'console' && file && !file.state.finished && sideToMove(file.state.phase) === 'B') {
      setFile(runSolo(file))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloB, mode, file, online])
  useEffect(() => {
    localStorage.setItem(SOLO_KEY, soloB ? '1' : '0')
  }, [soloB])
  useEffect(() => {
    localStorage.setItem(OPEN_KEY, openTable ? '1' : '0')
  }, [openTable])

  /** The staged (or current) order for a unit, for the console to edit. */
  const orderOf = (unitId: string): StandingOrder | null => {
    const staged = stagedOrderFor(pending, unitId)
    if (staged) return staged
    const unit = view?.units.find((u) => u.id === unitId)
    return unit ? structuredClone(unit.order) : null
  }

  const editOrder = (unitId: string, patch: Partial<StandingOrder>) => {
    // At an open table, the view flips freely but only the moving commander
    // gives orders — staging through the other side's window would be
    // refused at End Phase anyway.
    if (openTable && !online && side !== moverSide) return
    const base = orderOf(unitId)
    if (!base) return
    setPending((p) => stageOrder(p, unitId, { ...base, ...patch }))
  }

  /** Resolve one phase move; returns the new file, or stages an error note. */
  const resolveMove = (f: CampaignFile, move: PhaseMove): CampaignFile | null => {
    try {
      const state = resolvePhase({ map: f.map, scenario: f.scenario }, f.state, move)
      return { ...f, state, journal: [...f.journal, move] }
    } catch (e) {
      setNote(e instanceof PhaseError ? e.message : String(e))
      return null
    }
  }

  /** The solo doctrine plays its side until the human is up again. */
  const runSolo = (f: CampaignFile): CampaignFile => {
    let current = f
    for (let guard = 0; guard < 24; guard++) {
      if (current.state.finished || sideToMove(current.state.phase) !== 'B') break
      const battles: BattleRecord[] = []
      for (const pendingBattle of current.state.pendingBattles) {
        const quick = quickResolve(
          { map: current.map, scenario: current.scenario },
          current.state,
          current.campaignId,
          pendingBattle,
          // The doc's own difficulty: the admiral fights it for real, and the
          // clock extends until the battle actually happened (playEngagement).
          { difficulty: 'admiral' },
        )
        if (typeof quick === 'string') break
        battles.push(quick.record)
      }
      const soloView = viewFor(current.map, current.state, 'B')
      const move: PhaseMove = {
        round: current.state.round,
        phase: current.state.phase,
        side: 'B',
        interventions: soloOrders(soloView),
        ...(battles.length > 0 ? { battles } : {}),
      }
      const next = resolveMove(current, move)
      if (!next) break
      current = next
    }
    return current
  }

  const endPhase = () => {
    if (!file || !view) return
    if (online && !myTurn) return // the ledger would refuse it anyway
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: moverSide,
      interventions: pending,
      ...(stagedBattles.length > 0 ? { battles: stagedBattles } : {}),
    }
    let next = resolveMove(file, move)
    if (!next) return
    setPending([])
    setStagedBattles([])
    setSelectedUnit(null)
    setSelectedContact(null)
    setNote(null)
    if (online) {
      // The ledger orders the moves; a conflict resyncs us to it.
      void online.link.appendMove(move, next.journal.length, stateFingerprint(next.state))
      setFile(next)
      return
    }
    if (soloB) next = runSolo(next)
    setFile(next)
    // The blackout is the wall between two humans at one screen; an open
    // table drops it on purpose — that is what the mode is for.
    if (!soloB && !openTable && !next.state.finished) setMode('blackout')
  }

  /** Open a fresh local campaign from a (possibly force-edited) scenario. */
  const launchScenario = (id: string, scenario: CampaignScenario) => {
    try {
      const fresh = newCampaign(scenario, `${id}-${Date.now().toString(36)}`)
      setFile(fresh)
      setMode(soloB || openTable ? 'console' : 'blackout')
      setPending([])
      setStagedBattles([])
      setEditing(null)
      setViewSide('A')
      setNote(null)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const stageBattleRecord = (record: BattleRecord) => {
    setStagedBattles((s) => [...s.filter((r) => r.engagementId !== record.engagementId), record])
  }

  const readBattleText = (text: string) => {
    if (!file) return
    const save = JSON.parse(text) as SavedGame & { setup: { campaignRef?: { engagementId: string } } }
    const ref = save.setup?.campaignRef
    const engagement = file.state.pendingBattles.find((p) => p.id === ref?.engagementId)
    if (!engagement) {
      setNote('That battle does not belong to a pending engagement of this campaign.')
      return
    }
    const battle = battleFileFor({ map: file.map, scenario: file.scenario }, file.state, file.campaignId, engagement)
    const result = readback(file.state, engagement, text)
    if (typeof result === 'string') {
      setNote(result)
      return
    }
    stageBattleRecord({ engagementId: engagement.id, fileHash: hashText(JSON.stringify(battle)), result })
    setNote(`Battle ${engagement.id} read back — end the phase to record it.`)
  }

  // ── The online seat ─────────────────────────────────────────────────────

  const config = () => ({ url: server.trim(), key: serverKey.trim() })
  const serverReady = server.trim().length > 0 && serverKey.trim().length > 0

  /** One remote phase move lands: fold it, check the sender's fingerprint. */
  const applyRemoteMove = (move: PhaseMove, seq: number, hash?: string) => {
    setFile((prev) => {
      if (!prev) return prev
      if (seq <= prev.journal.length) return prev // our own move, echoed back
      if (seq !== prev.journal.length + 1) {
        void onlineRef.current?.link.resync() // a gap: the ledger settles it
        return prev
      }
      try {
        const state = resolvePhase({ map: prev.map, scenario: prev.scenario }, prev.state, move)
        if (hash && stateFingerprint(state) !== hash) void onlineRef.current?.link.resync()
        return { ...prev, state, journal: [...prev.journal, move] }
      } catch {
        void onlineRef.current?.link.resync()
        return prev
      }
    })
  }

  /** The whole ledger arrives — the answer to any disagreement. */
  const applyLedger = (doc: CampaignLedgerDoc, journal: PhaseMove[]) => {
    const current = fileRef.current
    if (current && journal.length < current.journal.length) return // stale read-back of our own past
    const rebuilt = fileFromLedger(doc, journal)
    if (typeof rebuilt === 'string') setNote(rebuilt)
    else setFile(rebuilt)
  }

  const connect = async (matchId: string, password: string, seat: Side): Promise<boolean> => {
    setBusy(true)
    setNote(null)
    const result = await openCampaignMatch(config(), matchId, password, seat, {
      onMove: applyRemoteMove,
      onLedger: applyLedger,
      onPresence: (labels) => setOnline((o) => (o ? { ...o, present: labels } : o)),
      onDropped: () => setOnline((o) => (o ? { ...o, status: 'reconnecting' } : o)),
    }, () => fileRef.current?.journal.length ?? 0)
    setBusy(false)
    if (!result.opened) {
      setNote(result.error ?? 'Could not open the campaign.')
      return false
    }
    const { link, name, doc, journal } = result.opened
    const rebuilt = fileFromLedger(doc, journal)
    if (typeof rebuilt === 'string') {
      link.close()
      setNote(rebuilt)
      return false
    }
    onlineRef.current?.link.close()
    setFile(rebuilt)
    setOnline({ link, matchId: matchId.toUpperCase(), name, seat, present: [], status: 'connected' })
    saveEnrollment({ server: server.trim(), key: serverKey.trim(), matchId: matchId.toUpperCase(), password, seat, name })
    setPending([])
    setStagedBattles([])
    setMode('console')
    return true
  }

  const hostOnline = async (scenarioId: string, build: () => Parameters<typeof newCampaign>[0]) => {
    if (!hostForm.password) {
      setNote('An online campaign needs a password — it is half of the invite.')
      return
    }
    setBusy(true)
    const fresh = newCampaign(build(), `${scenarioId}-${Date.now().toString(36)}`)
    const name = hostForm.name || `Campaign: ${fresh.scenario.name}`
    const hosted = await hostCampaignMatch(config(), name, hostForm.password, fresh, hostForm.isPublic)
    setBusy(false)
    if (!hosted.id) {
      setNote(hosted.error ?? 'The project refused the campaign.')
      return
    }
    await connect(hosted.id, hostForm.password, 'A')
  }

  const leaveOnline = () => {
    online?.link.close()
    setOnline(null)
    saveEnrollment(null)
    setFile(null)
    setMode('menu')
  }

  // A remembered enrollment reconnects by itself when the console opens.
  const reconnectTried = useRef(false)
  useEffect(() => {
    if (reconnectTried.current || online) return
    const e = loadEnrollment()
    if (!e) return
    reconnectTried.current = true
    setServer(e.server)
    setServerKey(e.key)
    void openCampaignMatch({ url: e.server, key: e.key }, e.matchId, e.password, e.seat, {
      onMove: applyRemoteMove,
      onLedger: applyLedger,
      onPresence: (labels) => setOnline((o) => (o ? { ...o, present: labels } : o)),
      onDropped: () => setOnline((o) => (o ? { ...o, status: 'reconnecting' } : o)),
    }, () => fileRef.current?.journal.length ?? 0).then((result) => {
      if (!result.opened) {
        setNote(result.error ?? 'The online campaign could not be reopened.')
        return
      }
      const rebuilt = fileFromLedger(result.opened.doc, result.opened.journal)
      if (typeof rebuilt === 'string') {
        result.opened.link.close()
        setNote(rebuilt)
        return
      }
      setFile(rebuilt)
      setOnline({
        link: result.opened.link,
        matchId: e.matchId,
        name: result.opened.name,
        seat: e.seat,
        present: [],
        status: 'connected',
      })
      setMode('console')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Release the seat when the console unmounts; the enrollment re-claims it.
  useEffect(() => () => onlineRef.current?.link.close(), [])

  // ── Screens ─────────────────────────────────────────────────────────────

  if (!file || mode === 'menu') {
    return (
      <div className="picker campaign-menu">
        <header>
          <h2>StarForce: Border Command</h2>
          <button type="button" onClick={onExit}>Back</button>
        </header>
        <p className="hint">
          The operational campaign: a contested border, sensors instead of sight, and every battle
          fought on the real table. Hotseat hands the console over; solo pits you against a scripted
          opponent that sees only its own fog.
        </p>
        {!online && (
          <label className="checkbox">
            <input type="checkbox" checked={soloB} onChange={(e) => setSoloB(e.target.checked)} />
            Solo — the computer commands side B
          </label>
        )}
        {!online && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={openTable}
              onChange={(e) => setOpenTable(e.target.checked)}
            />
            Open table — no blackout; flip between both commanders&apos; views (for testing
            movement and detection)
          </label>
        )}
        {!online && editing && (
          <ForceEditor
            scenario={editing.scenario}
            onLaunch={(edited) => launchScenario(editing.id, edited)}
            onCancel={() => setEditing(null)}
          />
        )}
        {!online &&
          !editing &&
          LAUNCH_SCENARIOS.map(({ id, build }) => {
            const scenario = build()
            return (
              <div key={id} className="campaign-launch-row">
                <button
                  type="button"
                  className="title-item"
                  onClick={() => launchScenario(id, scenario)}
                >
                  {scenario.name}
                  <span className="title-detail">{scenario.rounds} rounds</span>
                </button>
                <button
                  type="button"
                  className="campaign-launch-edit"
                  onClick={() => setEditing({ id, scenario })}
                  title="Add, remove or re-hull the units on either side before launch"
                >
                  Edit forces
                </button>
              </div>
            )
          })}
        {!online && (
          <label className="title-item title-load">
            Load campaign
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                void f.text().then((text) => {
                  const loaded = loadCampaign(text)
                  if (typeof loaded === 'string') setNote(loaded)
                  else {
                    setFile(loaded)
                    setMode(soloB || openTable ? 'console' : 'blackout')
                  }
                })
                e.target.value = ''
              }}
            />
          </label>
        )}
        {file && !online && (
          <button
            type="button"
            className="title-item"
            onClick={() => setMode(soloB || openTable ? 'console' : 'blackout')}
          >
            Continue — {file.scenario.name}, round {file.state.round}
          </button>
        )}
        {online && (
          <button type="button" className="title-item primary" onClick={() => setMode('console')}>
            Back to the online campaign — {online.name} ({online.matchId})
          </button>
        )}

        <section className="campaign-panel campaign-online">
          <h3>Online campaign</h3>
          {!serverReady && (
            <>
              <p className="hint">
                Point at the same Supabase project the tactical Online matches use — the campaign
                rides the very same tables, nothing new to deploy.
              </p>
              <label className="field">
                <span>Project URL</span>
                <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://….supabase.co" />
              </label>
              <label className="field">
                <span>Publishable key</span>
                <input value={serverKey} onChange={(e) => setServerKey(e.target.value)} />
              </label>
            </>
          )}
          {serverReady && !online && (
            <>
              <p className="hint">
                Host a campaign as a persistent match — each commander plays their own seat from
                their own browser, and the border waits between sessions.
              </p>
              <label className="field">
                <span>Campaign name</span>
                <input
                  value={hostForm.name}
                  onChange={(e) => setHostForm({ ...hostForm, name: e.target.value })}
                  placeholder="Campaign: The Border Watch"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  value={hostForm.password}
                  onChange={(e) => setHostForm({ ...hostForm, password: e.target.value })}
                  placeholder="share it with your opponent"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={hostForm.isPublic}
                  onChange={(e) => setHostForm({ ...hostForm, isPublic: e.target.checked })}
                />
                Listed in the browser (joining still needs the password)
              </label>
              <div className="campaign-battle-actions">
                {LAUNCH_SCENARIOS.map(({ id, build }) => (
                  <button key={id} type="button" disabled={busy} onClick={() => void hostOnline(id, build)}>
                    Host — {build().name}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Join by code</span>
                <input
                  value={joinForm.code}
                  onChange={(e) => setJoinForm({ ...joinForm, code: e.target.value })}
                  placeholder="match code"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  value={joinForm.password}
                  onChange={(e) => setJoinForm({ ...joinForm, password: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Seat</span>
                <select
                  value={joinForm.seat}
                  onChange={(e) => setJoinForm({ ...joinForm, seat: e.target.value as Side })}
                >
                  <option value="A">{SEAT_LABEL.A}</option>
                  <option value="B">{SEAT_LABEL.B}</option>
                </select>
              </label>
              <div className="campaign-battle-actions">
                <button
                  type="button"
                  disabled={busy || !joinForm.code || !joinForm.password}
                  onClick={() => void connect(joinForm.code, joinForm.password, joinForm.seat)}
                >
                  Join campaign
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void listCampaignMatches(config()).then((r) => {
                      setBusy(false)
                      if (r.error) setNote(r.error)
                      setBrowse(r.matches ?? [])
                    })
                  }}
                >
                  Find campaigns
                </button>
              </div>
              {browse && browse.length === 0 && <p className="hint">No campaigns on offer right now.</p>}
              {browse?.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="title-item"
                  onClick={() => setJoinForm({ ...joinForm, code: m.id })}
                >
                  {m.name}
                  <span className="title-detail">
                    {m.id}
                    {m.waiting.length > 0 && ` — waiting on ${m.waiting.join(', ')}`}
                  </span>
                </button>
              ))}
            </>
          )}
          {online && (
            <div className="campaign-battle-actions">
              <button type="button" onClick={leaveOnline}>
                Leave the online campaign
              </button>
            </div>
          )}
        </section>
        {note && <p className="fire-error">{note}</p>}
      </div>
    )
  }

  if (file.state.finished) {
    return (
      <div className="picker campaign-menu">
        <header>
          <h2>Campaign over</h2>
          <button type="button" onClick={onExit}>Back</button>
        </header>
        <p>
          {file.state.winner === 'draw'
            ? 'A draw — the ledgers are level.'
            : `Commander ${file.state.winner} takes the border, ${file.state.vp.A} points to ${file.state.vp.B}.`}
        </p>
        <button type="button" onClick={() => downloadText('campaign.json', saveCampaign(file))}>
          Download the campaign file
        </button>
        <button
          type="button"
          onClick={() => {
            if (online) {
              leaveOnline()
              return
            }
            localStorage.removeItem(AUTOSAVE_KEY)
            setFile(null)
            setMode('menu')
          }}
        >
          New campaign
        </button>
      </div>
    )
  }

  if (mode === 'blackout' && !online) {
    return (
      <div className="handoff-backdrop">
        <div className="handoff-card">
          <h2>Commander {side}</h2>
          <p>
            Round {file.state.round}, phase {file.state.phase} of 16 is yours. Nobody else should be
            looking at the screen.
          </p>
          <button type="button" className="primary" onClick={() => setMode('console')}>
            Take the console
          </button>
        </div>
      </div>
    )
  }

  // Solo's side never renders — not even for the frame before the doctrine
  // catches up. At an open table the human may WATCH through B's window while
  // the doctrine is not mid-turn, so the gate is the moving side, not the view.
  if (soloB && !online && moverSide === 'B') {
    return (
      <div className="handoff-backdrop">
        <div className="handoff-card">
          <h2>Opposing command</h2>
          <p>The computer is taking its turn…</p>
        </div>
      </div>
    )
  }

  // ── The console ─────────────────────────────────────────────────────────
  const unit = selectedUnit ? view!.units.find((u) => u.id === selectedUnit) : null
  const order = unit ? orderOf(unit.id) : null
  const contact = selectedContact ? view!.contacts.find((c) => c.id === selectedContact) : null

  return (
    <div className="campaign-shell">
      <header className="campaign-topbar">
        <strong>StarForce: Border Command</strong>
        {openTable && !online && (
          <div className="campaign-viewswitch" role="group" aria-label="View side">
            {(['A', 'B'] as Side[]).map((s) => (
              <button
                key={s}
                type="button"
                className={s === side ? 'primary' : ''}
                onClick={() => {
                  setViewSide(s)
                  setSelectedUnit(null)
                  setSelectedContact(null)
                }}
              >
                Cmdr {s}
              </button>
            ))}
          </div>
        )}
        <span>
          Commander {side} — round {file.state.round}, phase {file.state.phase}/16 · VP A {view!.vp.A} · B{' '}
          {view!.vp.B} {!online && soloB && '· solo'}
          {openTable && !online && side !== moverSide && ` · viewing only — phase ${file.state.phase} is Commander ${moverSide}'s`}
          {online &&
            ` · ${online.name} (${online.matchId})${
              online.status === 'reconnecting' ? ' · connection lost' : ''
            }${
              online.present.includes(SEAT_LABEL[side === 'A' ? 'B' : 'A'])
                ? ' · opponent connected'
                : ' · opponent away'
            }`}
        </span>
        <button type="button" onClick={() => downloadText('campaign.json', saveCampaign(file))}>
          Save
        </button>
        <button type="button" onClick={() => setMode('menu')}>Menu</button>
        <button type="button" className="primary" onClick={endPhase} disabled={Boolean(online) && !myTurn}>
          {online && !myTurn
            ? `${SEAT_LABEL[side === 'A' ? 'B' : 'A']} is moving…`
            : `End phase ${pending.length > 0 ? `(${pending.length} orders)` : ''}`}
        </button>
      </header>

      <div className="campaign-body">
        <CampaignMap
          view={view!}
          selectedUnitId={selectedUnit}
          selectedContactId={selectedContact}
          plannedWaypoints={unit && order ? [unit.hex, ...order.waypoints] : []}
          waypointEtas={
            unit && order
              ? waypointRounds(file.map, unit.hex, order.waypoints, orderedSpeed({ ...unit, order }))
              : []
          }
          routeSteps={
            unit && order
              ? routeEntryPhases(
                  file.map,
                  unit,
                  order.waypoints,
                  orderedSpeed({ ...unit, order }),
                  file.state.phase,
                )
              : []
          }
          onClickHex={(hex: Hex) => {
            // A map click with a unit selected appends a waypoint — snapped to
            // the nearest straight hex line from the leg's start, because
            // plotted legs run straight only (a zigzag is several waypoints).
            if (unit && order) {
              const from = order.waypoints[order.waypoints.length - 1] ?? unit.hex
              const snapped = snapToHexLine(from, hex, file.map.width, file.map.height)
              if (!snapped) return // clicked the leg's own start: nothing to plot
              editOrder(unit.id, {
                waypoints: [...order.waypoints, snapped],
                ...(order.speed === 'hold' ? { speed: 'cruise' as const } : {}),
              })
            }
          }}
          onClickUnit={(id) => {
            setSelectedUnit(id)
            setSelectedContact(null)
          }}
          onClickContact={(id) => setSelectedContact(id)}
        />

        <aside className="campaign-sidebar">
          {note && <p className="fire-error">{note}</p>}

          {view!.engagements.length > 0 && (
            <section className="campaign-panel">
              <h3>Battles waiting</h3>
              {view!.engagements.map((engagement) => {
                const pendingBattle = file.state.pendingBattles.find((p) => p.id === engagement.id)!
                const staged = stagedBattles.some((r) => r.engagementId === engagement.id)
                const battle = () =>
                  battleFileFor({ map: file.map, scenario: file.scenario }, file.state, file.campaignId, pendingBattle)
                return (
                  <div key={engagement.id} className="campaign-battle">
                    <p>
                      <strong>{engagement.id}</strong> at {engagement.hex.q},{engagement.hex.r}
                      {engagement.youAmbush && ' — your ambush'}
                      {engagement.youWereCaughtRetreating && ' — caught retreating'}
                      {staged && ' ✓ resolved, end the phase'}
                    </p>
                    {!staged && !myTurn && (
                      <p className="hint">
                        The moving commander resolves this battle — it rides their phase move.
                      </p>
                    )}
                    {!staged && myTurn && (
                      <div className="campaign-battle-actions">
                        {!online && (
                          <button
                            type="button"
                            onClick={() =>
                              onFightBattle(
                                // In solo the other commander must ALSO show up at
                                // the table: hand its side to the tactical AI, the
                                // same admiral who quick-resolves it.
                                soloB
                                  ? { ...battle().setup, aiSides: [SIDE_LABEL.B], aiDifficulty: 'admiral' }
                                  : battle().setup,
                              )
                            }
                          >
                            {soloB ? 'Fight the computer on the tabletop' : 'Fight on the tabletop'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const save = readTableSave()
                            readBattleText(JSON.stringify(save))
                          }}
                        >
                          Read back from the table
                        </button>
                        <label className="title-load">
                          Read back from a battle save
                          <input
                            type="file"
                            accept="application/json,.json"
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (!f) return
                              void f.text().then(readBattleText)
                              e.target.value = ''
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setNote('The admiral is fighting it…')
                            setTimeout(() => {
                              const quick = quickResolve(
                                { map: file.map, scenario: file.scenario },
                                file.state,
                                file.campaignId,
                                pendingBattle,
                                // The admiral, for real — the button has said
                                // so all along. A few seconds per battle.
                                { difficulty: 'admiral' },
                              )
                              if (typeof quick === 'string') setNote(quick)
                              else {
                                stageBattleRecord(quick.record)
                                setNote(`${engagement.id} quick-resolved — end the phase to record it.`)
                              }
                            }, 30)
                          }}
                        >
                          Quick resolve
                        </button>
                        <button type="button" onClick={() => downloadText(`${engagement.id}.json`, JSON.stringify(battle()))}>
                          Download battle file
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )}

          {view!.events.length > 0 && (
            <section className="campaign-panel">
              <h3>Dispatches</h3>
              <ul className="campaign-dispatches">
                {[...view!.events].reverse().map((e, i) => (
                  <li key={`${e.round}-${e.hex.q}-${e.hex.r}-${i}`}>
                    <strong>R{e.round}</strong> · {e.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unit && order && (
            <section className="campaign-panel">
              <h3>{unit.ships[0]?.name ?? unit.id}</h3>
              {openTable && !online && side !== moverSide && (
                <p className="hint">
                  You are looking through Commander {side}&apos;s sensors; phase{' '}
                  {file.state.phase} belongs to Commander {moverSide}, so orders here are locked
                  until you flip the view.
                </p>
              )}
              <FleetStatus unit={unit} order={order} />
              <label className="field">
                <span>Speed</span>
                <select
                  value={order.speed}
                  onChange={(e) => {
                    const speed = e.target.value as SpeedTier
                    // Lowering the tier reins the throttle in with it.
                    const cap = orderSpeedCap(unit, { ...order, speed })
                    editOrder(unit.id, {
                      speed,
                      ...(order.exactSpeed != null && order.exactSpeed > cap ? { exactSpeed: cap } : {}),
                    })
                  }}
                >
                  <option value="hold">Hold</option>
                  <option value="cruise">Cruise ({unitSpeedTiers(unit).cruise}/round)</option>
                  <option value="max-cruise">Max cruise ({unitSpeedTiers(unit).maxCruise}/round)</option>
                  <option value="maximum">Maximum ({unitSpeedTiers(unit).maximum}/round) — thirsty, loud</option>
                  <option value="emergency">
                    Emergency ({unitSpeedTiers(unit).emergency}/round) — risks the drives
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Exact speed</span>
                <input
                  type="number"
                  min={0}
                  max={unitSpeedCap(unit)}
                  step={1}
                  value={order.exactSpeed ?? ''}
                  placeholder={`hexes/round (≤ ${unitSpeedCap(unit)})`}
                  onChange={(e) => {
                    if (e.target.value === '') {
                      editOrder(unit.id, { exactSpeed: undefined })
                      return
                    }
                    const value = Math.max(0, Math.min(unitSpeedCap(unit), Math.round(Number(e.target.value))))
                    // The tier follows the throttle: pick the smallest tier
                    // that authorizes this pace, so the pair never conflicts.
                    const tiers = unitSpeedTiers(unit)
                    const speed: SpeedTier =
                      value <= 0
                        ? 'hold'
                        : value <= tiers.cruise
                          ? 'cruise'
                          : value <= tiers.maxCruise
                            ? 'max-cruise'
                            : value <= tiers.maximum
                              ? 'maximum'
                              : 'emergency'
                    editOrder(unit.id, { exactSpeed: value, speed })
                  }}
                />
              </label>
              <label className="field">
                <span>Sensors</span>
                <select
                  value={order.sensorPower}
                  onChange={(e) => editOrder(unit.id, { sensorPower: Number(e.target.value) as 0 | 1 | 2 })}
                >
                  <option value={0}>Silent (0)</option>
                  <option value={1}>Normal (1)</option>
                  <option value={2}>Full power (2)</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={order.activeSensors ?? false}
                  onChange={(e) => editOrder(unit.id, { activeSensors: e.target.checked })}
                />
                Active sensors — sharp inside range 2, but every enemy scope hears the ping
              </label>
              <label className="field">
                <span>Formation</span>
                <select
                  value={order.formation === 'close' ? 'close' : 'standard'}
                  onChange={(e) => editOrder(unit.id, { formation: e.target.value as 'close' | 'standard' })}
                >
                  <option value="standard">Standard — every ship scans</option>
                  <option value="close">Close — read as one target, lead ship scans, slight collision risk</option>
                </select>
              </label>
              <label className="field">
                <span>If engaged</span>
                <select
                  value={order.engagement ?? 'fight'}
                  onChange={(e) =>
                    editOrder(unit.id, { engagement: e.target.value as 'fight' | 'withdraw' | 'silent' })
                  }
                >
                  <option value="fight">Fight</option>
                  <option value="withdraw">Withdraw</option>
                  <option value="silent">Stay silent while unseen</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={order.cloaked}
                  onChange={(e) => editOrder(unit.id, { cloaked: e.target.checked })}
                />
                Cloaked
              </label>
              <p className="hint">
                Click the map to add waypoints ({order.waypoints.length} plotted). Legs run straight
                — an off-line click snaps to the nearest straight course; zigzag with more waypoints.
                Each hex of the route shows how many phases until the ship enters it, live against
                the ordered speed.
              </p>
              <div className="campaign-battle-actions">
                <button type="button" onClick={() => editOrder(unit.id, { waypoints: [], mission: undefined })}>
                  Clear route
                </button>
                {contact && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        editOrder(unit.id, {
                          mission: { type: 'intercept', contactId: contact.id },
                          ...(order.speed === 'hold' ? { speed: 'cruise' as const } : {}),
                        })
                      }
                    >
                      Intercept contact
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        editOrder(unit.id, {
                          mission: { type: 'shadow', contactId: contact.id },
                          ...(order.speed === 'hold' ? { speed: 'cruise' as const } : {}),
                        })
                      }
                    >
                      Shadow contact
                    </button>
                  </>
                )}
              </div>
              {order.mission && (
                <p className="hint">
                  Mission: {order.mission.type} {order.mission.contactId}
                </p>
              )}
            </section>
          )}

          {contact && (
            <section className="campaign-panel">
              <h3>Contact {contact.id}</h3>
              <p className="hint">
                {contact.positionEstimated ? 'Position estimated' : 'Firm fix'}
                {contact.uncertainty > 0 && ` · drift ±${contact.uncertainty}`}
                {contact.collapsed && ' · gone cold'}
              </p>
              <ul className="campaign-dossier">
                {CONTACT_ATTRIBUTES.filter((a) => contact.attributes[a]).map((a) => (
                  <li key={a} className={contact.attributes[a]!.stale ? 'stale' : undefined}>
                    <span>{a}</span> {contact.attributes[a]!.value}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view!.incoming.length > 0 && (
            <section className="campaign-panel">
              <h3>Reinforcements</h3>
              {view!.incoming.map((r) => (
                <p key={r.unitId} className="hint">
                  {r.unitId}: {r.shipCount} hull{r.shipCount === 1 ? '' : 's'}, round {r.arrivesRound}
                </p>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

/** The scars aboard one hull, as short chips — only what is actually marked. */
function scarChips(ship: ShipRecord): string[] {
  const sc = ship.scars
  if (!sc) return []
  const chips: string[] = []
  const add = (label: string, n: number) => {
    if (n > 0) chips.push(`${label} ${n}`)
  }
  add('FTL', sc.ftl)
  add('Sublight', sc.systems['__sublight'] ?? 0)
  add('Sensors', (sc.systems['SENS'] ?? 0) + sc.scout)
  add(
    'Weapons',
    Object.values(sc.mounts).reduce((n, g) => n + g.reduce((a, b) => a + b, 0), 0),
  )
  add('Shield gen', sc.shieldGenerator)
  add(
    'Reactors',
    Object.values(sc.reactors).reduce((n, g) => n + g.reduce((a, b) => a + b, 0), 0),
  )
  add('Batteries', sc.batteries.filter(Boolean).length)
  add(
    'Systems',
    Object.entries(sc.systems)
      .filter(([k]) => k !== 'SENS' && k !== '__sublight')
      .reduce((n, [, d]) => n + d, 0),
  )
  add('Armor', (['F', 'S', 'A', 'P'] as const).reduce((n, f) => n + sc.armor[f], 0))
  return chips
}

/**
 * The fleet's makeup and state, in full — these are your own ships, so the
 * wall has nothing to hide: class, damage band, structure, marked systems,
 * the wing, and the pace the staged order will actually make.
 */
function FleetStatus({ unit, order }: { unit: Unit; order: StandingOrder }) {
  const staged: Unit = { ...unit, order }
  const pace = orderedSpeed(staged)
  const tier = effectiveSpeedTier(staged)
  const tiers = unitSpeedTiers(unit)
  const points = unit.ships.reduce((n, s) => n + (shipFormById(s.formId)?.pointValue ?? 0), 0)
  return (
    <div className="campaign-fleet">
      <p className="hint">
        {unit.kind} · {unit.ships.length} hull{unit.ships.length === 1 ? '' : 's'} · {points} pts ·
        endurance {unit.endurance}/{unit.enduranceMax} · making {pace}/round ({tier}) · speeds{' '}
        {tiers.cruise}/{tiers.maxCruise}/{tiers.maximum}/{tiers.emergency}
      </p>
      <ul className="campaign-fleet-list">
        {unit.ships.map((ship) => {
          const form = shipFormById(ship.formId)
          const band = damageBand(ship)
          const structTotal = form ? form.structure.filter((e) => e.kind === 'box').length : 0
          const structLeft = Math.max(0, structTotal - (ship.scars?.structure ?? 0))
          const chips = scarChips(ship)
          return (
            <li key={ship.id}>
              <strong>{ship.name}</strong>
              <span className="fleet-class">{form?.name ?? ship.formId}</span>
              <span className={`fleet-band fleet-band-${band}`}>{band}</span>
              <span className="fleet-struct">
                structure {structLeft}/{structTotal}
              </span>
              {chips.length > 0 && <span className="fleet-scars">{chips.join(' · ')}</span>}
              {ship.wing && (
                <span className="fleet-wing">
                  wing {ship.wing.readiness}
                  {ship.wing.readiness === 'rearming' ? ` (${ship.wing.rearmRounds})` : ''}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
