import { useEffect, useMemo, useState } from 'react'
import { allScenarioEntries } from '../data/scenarios'
import {
  activeShips,
  cloudStatus,
  isCombatPhase,
  PHASE_LABELS,
  PHASE_SEGMENTS,
  pendingArrivals,
  reconProgress,
  SEGMENT_LABELS,
  sidesAwaited,
  victoryPoints,
  type GameState,
} from '../engine/game'
import { disengagementOptions } from '../engine/navigation'
import { damageLevel, type ShipState } from '../engine/shipState'
import { AbandonShipPanel } from './AbandonShipPanel'
import { BoardingPanel } from './BoardingPanel'
import { ShipLibraryPanel } from './ShipLibraryPanel'
import { CloakPanel } from './CloakPanel'
import { CloudPanel } from './CloudPanel'
import { CombatPanel } from './CombatPanel'
import { CommandCardPanel } from './CommandCardPanel'
import { CommandSystemsPanel } from './CommandSystemsPanel'
import { FormationPanel } from './FormationPanel'
import { ScoutSensorPanel } from './ScoutSensorPanel'
import { DamageControlPanel } from './DamageControlPanel'
import { MapView, type RangeRing } from './MapView'
import { ScenarioDesigner } from './ScenarioDesigner'
import { ShipBuilder } from './ShipBuilder'
import { useCustomScenarios } from './customScenarios'
import { FleetPicker } from './FleetPicker'
import { TutorialPanel } from './TutorialPanel'
import { markTutorialSeen, tutorialSeen } from './tutorial'
import { sequenceOutline } from './sequence'
import { FlightOpsPanel } from './FlightOpsPanel'
import { IntelPanel } from './IntelPanel'
import { useNet } from './net'
import { claimSide, inMatch, useOnline } from './online'
import { setMuted, setVolume, useSound } from './sound'
import { OnlinePanel } from './OnlinePanel'
import { RemotePanel } from './RemotePanel'
import { ReplayTheater } from './ReplayTheater'
import { OperationsPanel } from './OperationsPanel'
import { DamageChoicePrompt } from './DamageChoicePrompt'
import { ShipFormPanel } from './ShipFormPanel'
import {
  activeFx,
  canUndo,
  undoRefusal,
  currentSave,
  currentSetup,
  dispatch,
  dispatchWithChoices,
  exportBattle,
  importBattle,
  newGame,
  unattendedSides,
  undo,
  useGame,
} from './store'

/** Which side's player is holding the console. Survives a refresh mid-handoff. */
const VIEW_KEY = 'sfc.view-side.v1'

/** What the tab is called when the battle is not waiting on this console. */
const BASE_TITLE = typeof document !== 'undefined' ? document.title : 'StarForce Commander'

/**
 * Why the setup controls stand down inside a match. The battle belongs to the
 * match ledger, not to this browser: rebuilding it here would put every other
 * commander's client onto a board that no longer replays.
 */
const LOCKED_HINT =
  'In a match the battle is fixed as its host created it — leave the match to change scenario, forces or options.'

export function App() {
  const game = useGame()
  const ships = activeShips(game)
  const [selectedId, setSelectedId] = useState<string>(ships[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [showArcs, setShowArcs] = useState(true)
  const [showRings, setShowRings] = useState(false)
  const [rulerMode, setRulerMode] = useState(false)
  const [picking, setPicking] = useState(false)
  const [building, setBuilding] = useState(false)
  const [library, setLibrary] = useState(false)
  const [designing, setDesigning] = useState(false)
  const [linking, setLinking] = useState(false)
  const [lobby, setLobby] = useState(false)
  const [replaying, setReplaying] = useState(false)
  // The guided battle. Offered unprompted the first time, because someone who
  // has never seen a command card will not go looking for a tutorial button.
  const [teaching, setTeaching] = useState(() => !tutorialSeen())
  const net = useNet()
  const online = useOnline()
  // Subscribing keeps the scenario dropdown live as designs are saved.
  useCustomScenarios()

  /**
   * Hidden information (B1.9): "Open table" shows everything — right for solo
   * play and refereeing — while a side view hides enemy ship forms, redacts
   * their counters, and offers a blackout handoff between players. Hot-seat is
   * honor-system by nature; the view makes honesty the path of least effort.
   */
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const [rawView, setRawView] = useState<string | null>(
    () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(VIEW_KEY)) || null,
  )
  /**
   * In a match the view is not a preference. A commander sees their own
   * fleet's forms and the enemy's public face only, and cannot switch to the
   * other chair or to the referee's overview — the choice is made by which
   * side they claimed. (The battle still replays in full in every browser, as
   * it must for the rules to run locally, so this is the tabletop's own
   * honour system rather than a cryptographic one: it makes honesty the path
   * of least effort, exactly as B1.9 intends.)
   */
  const enrolledInMatch = inMatch(online)
  const lockedView = enrolledInMatch && online.side && sides.includes(online.side) ? online.side : null
  const viewSide =
    lockedView ?? (rawView !== null && sides.includes(rawView) ? rawView : null)
  const setViewSide = (side: string | null) => {
    setRawView(side)
    try {
      if (side) localStorage.setItem(VIEW_KEY, side)
      else localStorage.removeItem(VIEW_KEY)
    } catch {
      // Storage failures only cost persistence of the view, never the game.
    }
  }
  /** A blackout while the device changes hands, so nothing leaks in passing. */
  const [handoff, setHandoff] = useState<string | null>(null)

  /*
   * The tab knows whose move it is. A persistent match is played like
   * correspondence chess — the other player answers when they answer — so
   * the title grows a dot when this console is what the battle waits on:
   * a segment it has not readied, or a staged volley waiting on its
   * damage-card answers. Visible from a pinned tab without switching to it.
   */
  useEffect(() => {
    const mySide = online.side
    const myMove =
      enrolledInMatch &&
      mySide !== null &&
      (game.stagedAction?.awaiting === mySide ||
        (game.readyGate &&
          sidesAwaited(game).includes(mySide) &&
          !game.readySides.includes(mySide)))
    document.title = myMove ? `● Your move — ${BASE_TITLE}` : BASE_TITLE
  })

  const selected = game.ships.find((s) => s.id === selectedId) ?? ships[0] ?? null
  const enemySelected = viewSide !== null && selected !== null && selected.side !== viewSide

  /**
   * Two rings per weapon rather than one per bracket: the outer edge of its
   * optimum (green) range, where the attacker gets rerolls (E1.2.1), and its
   * maximum range. Nine bracket rings was unreadable clutter.
   */
  const rangeRings = useMemo<RangeRing[]>(() => {
    if (!selected || !showRings) return []
    const rings: RangeRing[] = []
    for (const weapon of selected.form.weapons) {
      const green = [...weapon.brackets].reverse().find((b) => b.band === 'green')
      if (green) rings.push({ range: green.max, label: `${weapon.name} optimum`, band: 'green' })
      const max = weapon.brackets[weapon.brackets.length - 1]
      if (max) rings.push({ range: max.max, label: `${weapon.name} max`, band: 'max' })
    }
    return rings
  }, [selected, showRings])

  const onSelect = (id: string) => {
    if (selected && id !== selected.id && selected.side !== game.ships.find((s) => s.id === id)?.side) {
      setTargetId(id)
    } else {
      setSelectedId(id)
      setTargetId(null)
    }
  }

  return (
    <div className="app">
      {/*
        An LCARS-style frame: a rounded elbow joins a vertical status rail to
        the header bar. The shapes are borrowed; the numbers on the rail are the
        game's own, so the chrome earns its space.
      */}
      <div className="lcars-elbow" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <h1>StarForce Commander</h1>
          <span className="subtitle">Digital tabletop · Standard rules · hot-seat &amp; remote</span>
        </div>

        <label className="field inline" title={enrolledInMatch ? LOCKED_HINT : undefined}>
          <span>Scenario</span>
          <select
            disabled={enrolledInMatch}
            value={game.scenario.id}
            onChange={(e) => {
              newGame({
                scenarioId: e.target.value,
                seed: Math.floor(Math.random() * 1e9),
                coordinatedFire: game.coordinatedFire,
              })
              setTargetId(null)
            }}
          >
            {allScenarioEntries().map(({ scenario }) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>

        <label
          className="checkbox"
          title="Expansion 2, H4: ships may fire first or fire together, never both"
        >
          <input
            type="checkbox"
            disabled={enrolledInMatch}
            checked={game.coordinatedFire}
            onChange={(e) => dispatch({ type: 'set-coordinated-fire', on: e.target.checked })}
          />
          Coordinated Fire
        </label>

        <button
          type="button"
          className="primary"
          disabled={enrolledInMatch}
          title={enrolledInMatch ? LOCKED_HINT : undefined}
          onClick={() => setPicking(true)}
        >
          Choose forces
        </button>
        <button
          type="button"
          className={teaching ? 'primary' : undefined}
          onClick={() => {
            markTutorialSeen()
            setTeaching((on) => !on)
          }}
          title="Walk through a battle a step at a time"
        >
          {teaching ? 'Hide tutorial' : 'Tutorial'}
        </button>
        <button
          type="button"
          disabled={enrolledInMatch}
          onClick={() => setLibrary(true)}
          title="Browse ships and scenarios other players have designed and take a copy"
        >
          Library
        </button>
        <button
          type="button"
          disabled={enrolledInMatch}
          onClick={() => setBuilding(true)}
          title={enrolledInMatch ? LOCKED_HINT : "Design a ship on the designers' own point model"}
        >
          Ship builder
        </button>
        <button
          type="button"
          disabled={enrolledInMatch}
          onClick={() => setDesigning(true)}
          title={enrolledInMatch ? LOCKED_HINT : 'Lay out a battle of your own: map, terrain, sides and fleets'}
        >
          Scenario designer
        </button>
        <button
          type="button"
          disabled={enrolledInMatch}
          title={enrolledInMatch ? LOCKED_HINT : 'Same scenario and forces, fresh dice'}
          onClick={() => newGame({ ...currentSetup(), seed: Math.floor(Math.random() * 1e9) })}
        >
          Rematch
        </button>
        <button
          type="button"
          className={net.phase === 'connected' ? 'is-linked' : ''}
          disabled={enrolledInMatch}
          title={
            enrolledInMatch
              ? 'Already in an online match — leave it to use a direct browser link instead.'
              : 'Play this battle against another browser — no server, invite by copy-paste'
          }
          onClick={() => setLinking(true)}
        >
          {net.phase === 'connected' ? '● Linked' : 'Remote play'}
        </button>
        <button
          type="button"
          className={online.phase === 'connected' ? 'is-linked' : ''}
          title="Persistent online matches: password-gated, they survive everyone leaving and reconnect after a refresh"
          onClick={() => setLobby(true)}
        >
          {online.phase === 'connected'
            ? `● ${online.matchId}`
            : online.phase === 'reconnecting' || online.phase === 'connecting'
              ? '… Online'
              : 'Online'}
        </button>
        <BattleMenu game={game} locked={enrolledInMatch} onReplay={() => setReplaying(true)} />
      </header>

      {library && <ShipLibraryPanel onClose={() => setLibrary(false)} />}

      {picking && (
        <FleetPicker
          scenarioId={game.scenario.id}
          onClose={() => {
            setPicking(false)
            setTargetId(null)
          }}
        />
      )}

      {building && <ShipBuilder onClose={() => setBuilding(false)} />}
      {designing && <ScenarioDesigner onClose={() => setDesigning(false)} />}
      {replaying && <ReplayTheater initial={currentSave()} onClose={() => setReplaying(false)} />}
      {lobby && <OnlinePanel onClose={() => setLobby(false)} />}
      {/* Sits above everything: a volley stops here until the captain answers. */}
      <DamageChoicePrompt />
      {linking && <RemotePanel onClose={() => setLinking(false)} />}

      {/*
        The handoff blackout: fully opaque, covering everything, so passing
        the device between players shows the incoming commander nothing of the
        outgoing one's screen.
      */}
      {/*
        A match with no side claimed is not a state to play from: the view
        would fall back to the referee's open table (or a stale local
        preference), which is how a joiner once found themselves apparently
        commanding the host's fleet. The claim is forced before anything else
        happens — full blackout, same as the hot-seat handoff, because until a
        side is chosen this player is nobody and should see nothing.
      */}
      {enrolledInMatch && !online.side && (
        <div className="handoff-backdrop" role="dialog" aria-label="Choose your side">
          <div className="handoff-card">
            <h2>Take command</h2>
            <p>
              You have joined <strong>{online.matchName ?? online.matchId}</strong>. Choose the
              side you command — your view locks to it, and the other players see the claim.
            </p>
            <div className="claim-sides">
              {(() => {
                const matchSides = online.sides.length > 0 ? online.sides : sides
                // An occupied side is not on offer — unless every side is
                // occupied, in which case refusing them all would strand the
                // joiner with no way in at all.
                const allTaken = matchSides.every((s) => online.present.includes(s))
                return matchSides.map((side) => {
                  const occupied = online.present.includes(side)
                  return (
                    <button
                      key={side}
                      type="button"
                      className={occupied ? 'is-occupied' : 'primary'}
                      disabled={occupied && !allTaken}
                      title={
                        occupied
                          ? `${side} already has a commander connected — pick the other side`
                          : `${side} has no commander yet`
                      }
                      onClick={() => void claimSide(side)}
                    >
                      {occupied ? `● ${side} — occupied` : `○ Take command of ${side}`}
                    </button>
                  )
                })
              })()}
            </div>
            {/* The claim referee's refusal ("that chair is held") lands here. */}
            {online.error && <p className="online-error">{online.error}</p>}
          </div>
        </div>
      )}

      {handoff && (
        <div className="handoff-backdrop" role="dialog" aria-label="Console handoff">
          <div className="handoff-card">
            <h2>Console passing to {handoff}</h2>
            <p>
              Hand the device over. {handoff}&apos;s commander takes the console when ready — the
              previous view is gone until it is chosen again.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setViewSide(handoff)
                setHandoff(null)
              }}
            >
              Take command as {handoff}
            </button>
          </div>
        </div>
      )}

      <StatusRail game={game} />

      <div className="lcars-stage">
        <SequenceBar game={game} mySide={lockedView} />
        <MissionStatus game={game} />

        <main className="layout">
          <section className="map-column">
            <MapView
              game={game}
              selectedId={selected?.id ?? null}
              targetId={targetId}
              onSelect={onSelect}
              showArcs={showArcs}
              rangeRings={rangeRings}
              viewSide={viewSide}
              rulerMode={rulerMode}
              fx={activeFx()}
            />

            <div className="map-controls">
              <div className="view-chips" title="B1.9 — ship forms are hidden information. A side view shows only what that commander may see.">
                <span>Viewing</span>
                {lockedView ? (
                  <>
                    <span className="chip is-on is-locked" title="In a match you see your own fleet's forms and the enemy's public face only. Claim a different side in the Online panel to change chairs.">
                      🔒 {lockedView}
                    </span>
                    <span className="hint">your command</span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`chip${viewSide === null ? ' is-on' : ''}`}
                      onClick={() => setViewSide(null)}
                    >
                      Open table
                    </button>
                    {sides.map((side) => (
                      <button
                        key={side}
                        type="button"
                        className={`chip${viewSide === side ? ' is-on' : ''}`}
                        onClick={() => setViewSide(side)}
                      >
                        {side}
                      </button>
                    ))}
                    {viewSide !== null &&
                      sides
                        .filter((side) => side !== viewSide)
                        .map((side) => (
                          <button
                            key={`pass-${side}`}
                            type="button"
                            className="chip"
                            title="Blank the screen, hand the device over, and let the next player take command"
                            onClick={() => setHandoff(side)}
                          >
                            ⇄ pass to {side}
                          </button>
                        ))}
                  </>
                )}
              </div>
              <label className="checkbox">
                <input type="checkbox" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} />
                Firing arcs
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={showRings} onChange={(e) => setShowRings(e.target.checked)} />
                Range rings
              </label>
              <label className="checkbox" title="Drag on the map to measure in rulebook inches (E1.1)">
                <input type="checkbox" checked={rulerMode} onChange={(e) => setRulerMode(e.target.checked)} />
                Ruler
              </label>
              <SoundControl />
              <div className="ship-tabs">
                {game.ships.map((ship) => (
                  <button
                    key={ship.id}
                    type="button"
                    className={`ship-tab${ship.id === selected?.id ? ' is-current' : ''}${
                      ship.destroyed || ship.disengaged ? ' is-out' : ''
                    }`}
                    onClick={() => {
                      setSelectedId(ship.id)
                      setTargetId(null)
                    }}
                  >
                    {ship.name}
                    <em>{ship.destroyed ? 'destroyed' : ship.disengaged ? 'disengaged' : damageLevel(ship)}</em>
                  </button>
                ))}
              </div>
            </div>

            <ScenarioBrief game={game} />
            <LogPanel game={game} />
          </section>

          <section className="control-column">
            {teaching && (
              <TutorialPanel game={game} viewSide={viewSide} onClose={() => setTeaching(false)} />
            )}
            {selected && enemySelected && viewSide && (
              <IntelPanel game={game} ship={selected} viewSide={viewSide} />
            )}
            {selected && !enemySelected && (
              <>
                <SegmentControls game={game} ship={selected} />
                <ShipFormPanel game={game} ship={selected} />
              </>
            )}
          </section>
        </main>

        <footer className="lcars-foot">
          <span className="foot-cap" aria-hidden="true" />
          <span>
            StarForce Commander is a game of tactical starship combat by Patrick Doyle, published by
            Mariner Games. Rules as printed, v2.6.
          </span>
          <span className="foot-code" aria-hidden="true">
            LCARS 47174-B
          </span>
        </footer>
      </div>
    </div>
  )
}

/**
 * The left-hand rail. LCARS fills these blocks with reference codes; this one
 * fills them with the state a commander actually wants at a glance.
 */
function StatusRail({ game }: { game: GameState }) {
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const tones = ['sky', 'salmon', 'lilac']

  return (
    <aside className="lcars-rail">
      <div className="rail-block rail-orange">
        <b>{game.round}</b>
        <span>Round</span>
      </div>
      <div className="rail-block rail-sand">
        <b>{PHASE_CODES[game.phase]}</b>
        <span>Phase</span>
      </div>
      {sides.map((side, i) => (
        <div key={side} className={`rail-block rail-${tones[i % tones.length]}`}>
          <b>{activeShips(game).filter((s) => s.side === side).length}</b>
          <span>
            {side}
            {(currentSetup().aiSides ?? []).includes(side) ? ' · AI' : ''}
          </span>
        </div>
      ))}
      {/*
        The round, where the decorative filler used to be. A3 runs five phases
        in a fixed order and nearly every rule is anchored to one of them, so
        knowing what is behind you and what is still to come is worth more than
        four invented LCARS part numbers.
      */}
      <ol className="rail-sequence" aria-label="Sequence of play">
        {sequenceOutline(game.phase, game.segment).map((row) => (
          <li
            key={row.key}
            className={`seq-${row.kind} is-${row.state}`}
            /* The segment is the step you are on; the phase containing it is
               current in a looser sense, so it says so in a looser way. */
            aria-current={
              row.state !== 'now' ? undefined : row.kind === 'segment' ? 'step' : 'true'
            }
          >
            {row.label}
          </li>
        ))}
      </ol>
      <div className="rail-cap" aria-hidden="true" />
    </aside>
  )
}

/** Short codes for the rail, where a full phase name will not fit. */
const PHASE_CODES: Record<GameState['phase'], string> = {
  engineering: 'ENG',
  'combat-1': 'C-1',
  'combat-2': 'C-2',
  'combat-3': 'C-3',
  final: 'FIN',
}

/**
 * The battle so far, written up: forces, the running score, and the log the
 * engine has been keeping all along — grouped by round, ready to paste into
 * a forum thread or keep as the campaign record.
 */
function battleReport(game: GameState): string {
  const lines: string[] = []
  lines.push(`# ${game.scenario.name} — battle report`)
  lines.push('')
  lines.push(`Round ${game.round}, ${PHASE_LABELS[game.phase]}, ${SEGMENT_LABELS[game.segment]}.`)
  lines.push('')

  lines.push('## Forces')
  lines.push('')
  for (const side of [...new Set(game.ships.map((s) => s.side))]) {
    lines.push(`### ${side}`)
    lines.push('')
    for (const ship of game.ships.filter((s) => s.side === side)) {
      const status = ship.destroyed
        ? 'destroyed'
        : ship.disengaged
          ? 'disengaged'
          : ship.capturedBy
            ? `captured by ${ship.capturedBy}`
            : damageLevel(ship) === 'none'
              ? 'undamaged'
              : `${damageLevel(ship)} damage`
      lines.push(`- **${ship.name}** — ${ship.form.name} (${status})`)
    }
    lines.push('')
  }

  lines.push('## Score')
  lines.push('')
  lines.push('| Side | Victory points |')
  lines.push('| --- | --- |')
  for (const [side, points] of Object.entries(victoryPoints(game))) {
    lines.push(`| ${side} | ${points} |`)
  }
  lines.push('')

  lines.push('## Log')
  let round = 0
  for (const entry of game.log) {
    if (entry.round !== round) {
      round = entry.round
      lines.push('')
      lines.push(`### Round ${round}`)
      lines.push('')
    }
    lines.push(`- *${SEGMENT_LABELS[entry.segment]}* — ${entry.message}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * The battle file, in and out. A battle is (setup + action journal), so the
 * file is small, replays exactly, and carries any custom designs it needs —
 * hand it to another player and they resume your game to the die roll.
 */
/**
 * Sound, and the two things a player wants from it: off, and quieter.
 *
 * Off is the default — a game that starts making noise the moment it loads is
 * a bad guest — and the choice is remembered. The slider only appears once
 * sound is on, because a volume control for silence is furniture.
 */
function SoundControl() {
  const sound = useSound()
  return (
    <span className="sound-control">
      <button
        type="button"
        className={`chip${sound.muted ? '' : ' is-on'}`}
        aria-pressed={!sound.muted}
        title={
          sound.muted
            ? 'Turn on weapon fire and impact sounds'
            : 'Mute weapon fire and impact sounds'
        }
        onClick={() => setMuted(!sound.muted)}
      >
        {sound.muted ? '🔇 Sound off' : '🔊 Sound on'}
      </button>
      {!sound.muted && (
        <input
          className="sound-volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(sound.volume * 100)}
          aria-label="Sound volume"
          title="Volume"
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
      )}
    </span>
  )
}

function BattleMenu({
  game,
  locked,
  onReplay,
}: {
  game: GameState
  /** In a match: saving and reading stay, loading a different battle does not. */
  locked: boolean
  onReplay: () => void
}) {
  const [note, setNote] = useState<string | null>(null)

  const download = (contents: string, filename: string, type: string) => {
    const blob = new Blob([contents], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const save = () => download(exportBattle(), 'starforce-battle.json', 'application/json')

  const load = async (file: File) => {
    setNote(importBattle(await file.text()) ?? 'Battle loaded.')
  }

  return (
    <>
      <button type="button" onClick={save} title="Download this battle as a file — setup, every action, and any custom ship designs">
        Save file
      </button>
      <button
        type="button"
        onClick={() => download(battleReport(game), 'starforce-report.md', 'text/markdown')}
        title="The battle so far as a readable report — forces, score, and the full log"
      >
        Report
      </button>
      <button
        type="button"
        onClick={onReplay}
        title="Watch this battle back from deployment — every action, every die, scrubbed like a tape"
      >
        Replay
      </button>
      <label
        className={`chip file-chip${locked ? ' is-disabled' : ''}`}
        title={
          locked
            ? 'In a match the battle comes from the match ledger — leave the match to load a file.'
            : 'Resume a battle from a downloaded file'
        }
      >
        Load file
        <input
          type="file"
          accept=".json,application/json"
          disabled={locked}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void load(file)
            e.target.value = ''
          }}
        />
      </label>
      {note && (
        <span className="hint" role="status">
          {note}
        </span>
      )}
    </>
  )
}

/** The Sequence of Play strip (A3.1). */
function SequenceBar({ game, mySide }: { game: GameState; mySide: string | null }) {
  const segments = PHASE_SEGMENTS[game.phase]
  /*
   * A side nobody is commanding is a silent walkover: it never plots, never
   * fires, and is shot to pieces while the game says nothing, because giving
   * no orders is legal. It is one missed checkbox away in Choose Forces, and
   * it makes every battle after it read as a crushing win for a ship that was
   * never really tested.
   */
  const unattended = unattendedSides()
  return (
    <div className="sequence-bar">
      {unattended.length > 0 && (
        <span className="unattended" role="status">
          ⚠ {unattended.join(' and ')} {unattended.length === 1 ? 'has' : 'have'} given no orders all
          battle — {unattended.length === 1 ? 'it is' : 'they are'} not set to AI, so{' '}
          {unattended.length === 1 ? 'its' : 'their'} ships will not fight back. Turn AI on in Choose
          Forces, or command {unattended.length === 1 ? 'it' : 'them'} yourself.
        </span>
      )}
      <div className="round">Round {game.round}</div>
      <div className="phase">{PHASE_LABELS[game.phase]}</div>
      <ol className="segments">
        {segments.map((segment) => (
          <li key={segment} className={segment === game.segment ? 'is-current' : ''}>
            {SEGMENT_LABELS[segment]}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => undo()}
        disabled={!canUndo()}
        title={
          undoRefusal() ??
          'Take back the last action — dice included, the replay is exact'
        }
      >
        ↶ Undo
      </button>
      {game.readyGate ? (
        <ReadyCheck game={game} mySide={mySide} />
      ) : (
        <button
          type="button"
          className="primary"
          onClick={() => void dispatchWithChoices({ type: 'advance-segment' })}
        >
          Complete {SEGMENT_LABELS[game.segment]} →
        </button>
      )}
    </div>
  )
}

/** Segment-appropriate controls for the selected ship. */
function SegmentControls({ game, ship }: { game: GameState; ship: ShipState }) {
  if (game.phase === 'engineering') {
    if (game.segment === 'resource-allocation') {
      return (
        <>
          <div className="segment-help">
            <h3>Resource Allocation (B2)</h3>
            <p>
              Allocate reactor and battery power on the ship form below, then spend the arming points it generates on
              individual weapon mounts. Unassigned arming points are lost when the segment ends (E4.2.10).
            </p>
          </div>
          <CloudPanel game={game} ship={ship} />
          <CommandSystemsPanel game={game} ship={ship} />
          <ScoutSensorPanel game={game} ship={ship} assigning />
        </>
      )
    }
    return <DamageControlPanel game={game} ship={ship} />
  }

  if (isCombatPhase(game.phase)) {
    switch (game.segment) {
      case 'command':
        return (
          <>
            <CloudPanel game={game} ship={ship} />
            <FormationPanel game={game} ship={ship} />
            <CommandCardPanel game={game} ship={ship} />
          </>
        )
      case 'operations':
        return (
          <>
            <OperationsPanel game={game} ship={ship} />
            <AbandonShipPanel game={game} ship={ship} />
            <CloakPanel game={game} ship={ship} />
            <ScoutSensorPanel game={game} ship={ship} assigning={false} />
          </>
        )
      case 'navigation':
        return (
          <div className="segment-help">
            <h3>Navigation (A3.3.3)</h3>
            <p>
              Command cards are revealed. Completing this segment moves every ship simultaneously from its plot and
              applies maneuver stress.
            </p>
          </div>
        )
      case 'combat':
        return <CombatPanel game={game} attacker={ship} />
      case 'flight-operations':
        return <FlightOpsPanel game={game} ship={ship} />
      default:
        return (
          <div className="segment-help">
            <h3>Delayed Action (A3.3.6)</h3>
            <p>
              Systems announced in Step A of the Operations Segment take effect now. No Standard-rules system currently
              uses an activation delay (J1.3.2).
            </p>
          </div>
        )
    }
  }

  // Final Phase
  switch (game.segment) {
    case 'stress-check':
      return (
        <div className="segment-help">
          <h3>Stress Check (A3.4.1)</h3>
          <p>
            {ship.name} carries {ship.stressMarkers} stress marker{ship.stressMarkers === 1 ? '' : 's'} and has used{' '}
            {ship.accelUsedThisRound} acceleration point{ship.accelUsedThisRound === 1 ? '' : 's'} (safe limit{' '}
            {ship.form.sublight.safeAccelPerRound}). Completing this segment cancels stress with the SIF and resolves
            the rest.
          </p>
        </div>
      )
    case 'boarding-combat':
      return <BoardingPanel game={game} ship={ship} />
    case 'disengagement':
      return (
        <>
          <CloudPanel game={game} ship={ship} />
          <DisengagementPanel game={game} ship={ship} />
        </>
      )
    case 'final-activity':
      return <ScorePanel game={game} />
    default:
      return (
        <div className="segment-help">
          <h3>{SEGMENT_LABELS[game.segment]}</h3>
          <p>Nothing to resolve for {ship.name} in this segment.</p>
        </div>
      )
  }
}

/** Operations Segment steps A–E (A3.3.2). */
function DisengagementPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const enemies = game.ships.filter((s) => s.side !== ship.side && !s.destroyed && !s.disengaged)
  // A nebula shuts the FTL drive down, including as a way out (K4.2.7).
  const options = disengagementOptions(
    ship,
    enemies,
    game.scenario.bounds,
    !cloudStatus(game, ship).ftlBlocked,
  )

  return (
    <div className="segment-help">
      <h3>Disengagement (J9)</h3>
      {options.length === 0 ? (
        <p>{ship.name} has no route out of the battle this round.</p>
      ) : (
        <>
          <ul>
            {options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => dispatch({ type: 'disengage', shipId: ship.id })}
          >
            Disengage {ship.name}
          </button>
        </>
      )}
    </div>
  )
}

function ScorePanel({ game }: { game: GameState }) {
  const points = victoryPoints(game)
  return (
    <div className="segment-help">
      <h3>Final Activity (A3.4.5)</h3>
      <p>Ship forms are revealed to verify damage and power use (B1.9.2).</p>
      <table className="score">
        <tbody>
          {Object.entries(points).map(([side, value]) => (
            <tr key={side}>
              <th>{side}</th>
              <td>{value} VP</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Victory points reflect the current damage level of enemy ships (S2.8.4).</p>
    </div>
  )
}

function ScenarioBrief({ game }: { game: GameState }) {
  return (
    <details className="scenario-brief">
      <summary>{game.scenario.name}</summary>
      <p>{game.scenario.background}</p>
      <dl>
        {Object.entries(game.scenario.objectives).map(([side, text]) => (
          <div key={side}>
            <dt>{side}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      {game.scenario.specialRules && (
        <ul>
          {game.scenario.specialRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
      <p>
        <strong>Victory:</strong> {game.scenario.victory}
      </p>
    </details>
  )
}

/**
 * The scenario's own scoreboard, for the two that keep score by something
 * other than damage: a survey to finish and get away with (S3.2), and the
 * reinforcements whose arrival is the clock (S3.2 again).
 */
function MissionStatus({ game }: { game: GameState }) {
  const recon = reconProgress(game)
  const coming = pendingArrivals(game)
  if (!recon && coming.length === 0) return null
  return (
    <div className="mission-status">
      {recon && (
        <p className={recon.succeeded ? 'is-done' : ''}>
          <strong>{recon.side}</strong> survey: {recon.gathered} of {recon.required} information
          points
          {recon.gathered >= recon.required
            ? recon.away
              ? ' — gathered and away. Mission complete.'
              : ' — gathered. Now get it home (J9).'
            : ' — scan the objective during Operations (J4.2.2).'}
        </p>
      )}
      {coming.length > 0 && (
        <p>
          {coming.length} reinforcement{coming.length === 1 ? '' : 's'} arrive Round{' '}
          {coming[0].arrivesRound} ({coming[0].side}).
        </p>
      )}
    </div>
  )
}

/**
 * The battle log lives pinned under the board, and a busy battle writes a lot
 * of it — every card, every ready check — until the board is paying for the
 * prose. Compact mode shrinks it to its latest line; the preference is
 * remembered, because a player who wants the board big wants it big every
 * session.
 */
const LOG_COMPACT_KEY = 'sfc.log-compact.v1'

function LogPanel({ game }: { game: GameState }) {
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem(LOG_COMPACT_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCompact((prev) => {
      const next = !prev
      try {
        localStorage.setItem(LOG_COMPACT_KEY, next ? '1' : '0')
      } catch {
        // Only the remembered preference is lost.
      }
      return next
    })
  }
  const recent = game.log.slice(-60).reverse()
  const latest = recent[0]
  return (
    <div className={`log${compact ? ' is-compact' : ''}`}>
      <header className="log-head">
        <h3>Battle log</h3>
        <button
          type="button"
          className="chip"
          onClick={toggle}
          title={
            compact
              ? 'Show the full battle log again'
              : 'Shrink the log to its latest line and give the board the room'
          }
        >
          {compact ? 'Expand' : 'Compact'}
        </button>
      </header>
      {compact ? (
        latest && (
          <p className="log-latest">
            <span className="log-where">
              R{latest.round} {SEGMENT_LABELS[latest.segment]}
            </span>
            {latest.message}
          </p>
        )
      ) : (
        <ol>
          {recent.map((entry, i) => (
            <li key={i}>
              <span className="log-where">
                R{entry.round} {SEGMENT_LABELS[entry.segment]}
              </span>
              {entry.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * The ready check that closes a segment in an online match.
 *
 * A shared table enforces simultaneity by itself: nobody reveals until both
 * pencils are down. Two browsers do not, so the segment closes on agreement
 * instead — you say you are finished, and when the last side does, the
 * engine moves the battle on. Nobody presses "next" for anybody else.
 */
function ReadyCheck({ game, mySide }: { game: GameState; mySide: string | null }) {
  const awaited = sidesAwaited(game)
  const waiting = awaited.filter((side) => !game.readySides.includes(side))
  const iAmReady = mySide !== null && game.readySides.includes(mySide)
  const others = waiting.filter((side) => side !== mySide)

  return (
    <div className="ready-check">
      <span className="ready-tally">
        {awaited.map((side) => (
          <span key={side} className={game.readySides.includes(side) ? 'is-ready' : ''}>
            {side}
            {game.readySides.includes(side) ? ' ✓' : ' …'}
          </span>
        ))}
      </span>
      <button
        type="button"
        className={iAmReady ? 'chip is-on' : 'primary'}
        disabled={mySide === null}
        title={
          mySide === null
            ? 'Only the players commanding a side may close the segment.'
            : iAmReady
              ? 'Change your mind while the others are still working.'
              : `Finished with ${SEGMENT_LABELS[game.segment]}. The segment closes when everyone is.`
        }
        onClick={() =>
          mySide && void dispatchWithChoices({ type: 'signal-ready', side: mySide, ready: !iAmReady })
        }
      >
        {iAmReady
          ? others.length > 0
            ? `Ready — waiting for ${others.join(' and ')}`
            : 'Ready ✓'
          : `Ready — ${SEGMENT_LABELS[game.segment]} done`}
      </button>
    </div>
  )
}
