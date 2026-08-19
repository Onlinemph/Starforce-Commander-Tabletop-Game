/**
 * Border Command — the campaign console, thin over `src/campaign/`.
 *
 * Everything a player sees comes from `viewFor(map, state, side)`; everything
 * they do becomes interventions on the next phase move. Hotseat hands the
 * console across a fully opaque blackout (the tactical game's own B1.9
 * discipline, one level up); solo play drives the other side with the
 * view-typed doctrine in `campaign/solo.ts`, quick-resolving the battles it
 * starts. The campaign file autosaves locally and travels as JSON.
 */

import { useEffect, useMemo, useState } from 'react'
import type { GameSetup, SavedGame } from '../data/savedGame'
import { loadCampaign, newCampaign, saveCampaign } from '../campaign/file'
import { battleFileFor, hashText, readback } from '../campaign/handoff'
import { damageBand, unitSpeedTiers } from '../campaign/logistics'
import { quickResolve } from '../campaign/quickResolve'
import { LAUNCH_SCENARIOS } from '../campaign/scenarios'
import { soloOrders } from '../campaign/solo'
import { PhaseError, resolvePhase, type DetectionContext } from '../campaign/turn'
import {
  CONTACT_ATTRIBUTES,
  sideToMove,
  type BattleRecord,
  type CampaignFile,
  type Hex,
  type Intervention,
  type PhaseMove,
  type Side,
  type SpeedTier,
  type StandingOrder,
} from '../campaign/types'
import { viewFor } from '../campaign/views'
import { CampaignMap } from './CampaignMap'
import { downloadText, stageOrder, stagedOrderFor } from './helpers'

const AUTOSAVE_KEY = 'sfc-campaign-autosave'
const SOLO_KEY = 'sfc-campaign-solo'

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
  const [mode, setMode] = useState<Mode>(file ? 'blackout' : 'menu')
  const [pending, setPending] = useState<Intervention[]>([])
  const [stagedBattles, setStagedBattles] = useState<BattleRecord[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const ctx: DetectionContext | null = useMemo(
    () => (file ? { map: file.map, scenario: file.scenario } : null),
    [file],
  )
  const side: Side = file ? sideToMove(file.state.phase) : 'A'
  const view = useMemo(
    () => (file && ctx ? viewFor(file.map, file.state, side) : null),
    [file, ctx, side],
  )

  useEffect(() => {
    if (file) localStorage.setItem(AUTOSAVE_KEY, saveCampaign(file))
  }, [file])
  // Solo owns side B. If a file arrives mid-B (a hotseat save loaded with solo
  // on), the doctrine finishes B's turn before the human sees anything.
  useEffect(() => {
    if (soloB && mode === 'console' && file && !file.state.finished && sideToMove(file.state.phase) === 'B') {
      setFile(runSolo(file))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloB, mode, file])
  useEffect(() => {
    localStorage.setItem(SOLO_KEY, soloB ? '1' : '0')
  }, [soloB])

  /** The staged (or current) order for a unit, for the console to edit. */
  const orderOf = (unitId: string): StandingOrder | null => {
    const staged = stagedOrderFor(pending, unitId)
    if (staged) return staged
    const unit = view?.units.find((u) => u.id === unitId)
    return unit ? structuredClone(unit.order) : null
  }

  const editOrder = (unitId: string, patch: Partial<StandingOrder>) => {
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
          { difficulty: 'captain', rounds: 12 },
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
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side,
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
    if (soloB) next = runSolo(next)
    setFile(next)
    if (!soloB && !next.state.finished) setMode('blackout')
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
        <label className="checkbox">
          <input type="checkbox" checked={soloB} onChange={(e) => setSoloB(e.target.checked)} />
          Solo — the computer commands side B
        </label>
        {LAUNCH_SCENARIOS.map(({ id, build }) => {
          const scenario = build()
          return (
            <button
              key={id}
              type="button"
              className="title-item"
              onClick={() => {
                const fresh = newCampaign(scenario, `${id}-${Date.now().toString(36)}`)
                setFile(fresh)
                setMode(soloB ? 'console' : 'blackout')
                setPending([])
                setStagedBattles([])
              }}
            >
              {scenario.name}
              <span className="title-detail">{scenario.rounds} rounds</span>
            </button>
          )
        })}
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
                  setMode(soloB ? 'console' : 'blackout')
                }
              })
              e.target.value = ''
            }}
          />
        </label>
        {file && (
          <button type="button" className="title-item" onClick={() => setMode(soloB ? 'console' : 'blackout')}>
            Continue — {file.scenario.name}, round {file.state.round}
          </button>
        )}
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

  if (mode === 'blackout') {
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
  // catches up. The human sees only Commander A's window.
  if (soloB && side === 'B') {
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
        <span>
          Commander {side} — round {file.state.round}, phase {file.state.phase}/16 · VP {view!.vp.A}
          –{view!.vp.B} {soloB && '· solo'}
        </span>
        <button type="button" onClick={() => downloadText('campaign.json', saveCampaign(file))}>
          Save
        </button>
        <button type="button" onClick={() => setMode('menu')}>Menu</button>
        <button type="button" className="primary" onClick={endPhase}>
          End phase {pending.length > 0 && `(${pending.length} orders)`}
        </button>
      </header>

      <div className="campaign-body">
        <CampaignMap
          view={view!}
          selectedUnitId={selectedUnit}
          selectedContactId={selectedContact}
          plannedWaypoints={unit && order ? [unit.hex, ...order.waypoints] : []}
          onClickHex={(hex: Hex) => {
            // A map click with a unit selected appends a waypoint.
            if (unit && order) {
              editOrder(unit.id, {
                waypoints: [...order.waypoints, hex],
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
                    {!staged && (
                      <div className="campaign-battle-actions">
                        <button type="button" onClick={() => onFightBattle(battle().setup)}>
                          Fight on the tabletop
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const save = readTableSave()
                            readBattleText(JSON.stringify(save))
                          }}
                        >
                          Read back from the table
                        </button>
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
                                { difficulty: 'captain', rounds: 12 },
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

          {unit && order && (
            <section className="campaign-panel">
              <h3>{unit.ships[0]?.name ?? unit.id}</h3>
              <p className="hint">
                {unit.kind} · {unit.ships.length} hull{unit.ships.length === 1 ? '' : 's'} · endurance{' '}
                {unit.endurance}/{unit.enduranceMax}
                {unit.ships.map((s) => {
                  const band = damageBand(s)
                  return band !== 'fresh' ? ` · ${s.name}: ${band}` : ''
                })}
              </p>
              <label className="field">
                <span>Speed</span>
                <select
                  value={order.speed}
                  onChange={(e) => editOrder(unit.id, { speed: e.target.value as SpeedTier })}
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
              <label className="field">
                <span>Formation</span>
                <select
                  value={order.formation}
                  onChange={(e) => editOrder(unit.id, { formation: e.target.value as 'close' | 'standard' | 'wide' })}
                >
                  <option value="close">Close — hide the count</option>
                  <option value="standard">Standard</option>
                  <option value="wide">Wide — search line</option>
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
              <p className="hint">Click the map to add waypoints ({order.waypoints.length} plotted).</p>
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
