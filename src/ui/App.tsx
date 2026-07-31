import { useMemo, useState } from 'react'
import { allScenarioEntries } from '../data/scenarios'
import {
  activeShips,
  cloudStatus,
  isCombatPhase,
  PHASE_LABELS,
  PHASE_SEGMENTS,
  SEGMENT_LABELS,
  victoryPoints,
  type GameState,
} from '../engine/game'
import { disengagementOptions } from '../engine/navigation'
import { damageLevel, type ShipState } from '../engine/shipState'
import { BoardingPanel } from './BoardingPanel'
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
import { FlightOpsPanel } from './FlightOpsPanel'
import { IntelPanel } from './IntelPanel'
import { useNet } from './net'
import { RemotePanel } from './RemotePanel'
import { OperationsPanel } from './OperationsPanel'
import { ShipFormPanel } from './ShipFormPanel'
import {
  canUndo,
  currentSetup,
  dispatch,
  exportBattle,
  importBattle,
  newGame,
  undo,
  useGame,
} from './store'

/** Which side's player is holding the console. Survives a refresh mid-handoff. */
const VIEW_KEY = 'sfc.view-side.v1'

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
  const [designing, setDesigning] = useState(false)
  const [linking, setLinking] = useState(false)
  const net = useNet()
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
  const viewSide = rawView !== null && sides.includes(rawView) ? rawView : null
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

        <label className="field inline">
          <span>Scenario</span>
          <select
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
            checked={game.coordinatedFire}
            onChange={(e) => dispatch({ type: 'set-coordinated-fire', on: e.target.checked })}
          />
          Coordinated Fire
        </label>

        <button type="button" className="primary" onClick={() => setPicking(true)}>
          Choose forces
        </button>
        <button type="button" onClick={() => setBuilding(true)} title="Design a ship on the designers' own point model">
          Ship builder
        </button>
        <button
          type="button"
          onClick={() => setDesigning(true)}
          title="Lay out a battle of your own: map, terrain, sides and fleets"
        >
          Scenario designer
        </button>
        <button
          type="button"
          title="Same scenario and forces, fresh dice"
          onClick={() => newGame({ ...currentSetup(), seed: Math.floor(Math.random() * 1e9) })}
        >
          Rematch
        </button>
        <button
          type="button"
          className={net.phase === 'connected' ? 'is-linked' : ''}
          title="Play this battle against another browser — no server, invite by copy-paste"
          onClick={() => setLinking(true)}
        >
          {net.phase === 'connected' ? '● Linked' : 'Remote play'}
        </button>
        <BattleMenu game={game} />
      </header>

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
      {linking && <RemotePanel onClose={() => setLinking(false)} />}

      {/*
        The handoff blackout: fully opaque, covering everything, so passing
        the device between players shows the incoming commander nothing of the
        outgoing one's screen.
      */}
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
        <SequenceBar game={game} />

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
            />

            <div className="map-controls">
              <div className="view-chips" title="B1.9 — ship forms are hidden information. A side view shows only what that commander may see.">
                <span>Viewing</span>
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
          <b>{game.ships.filter((s) => s.side === side && !s.destroyed && !s.disengaged).length}</b>
          <span>
            {side}
            {(currentSetup().aiSides ?? []).includes(side) ? ' · AI' : ''}
          </span>
        </div>
      ))}
      <div className="rail-fill" aria-hidden="true">
        <span>A3·1</span>
        <span>E7·2</span>
        <span>J3·2</span>
        <span>G1·1</span>
      </div>
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
function BattleMenu({ game }: { game: GameState }) {
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
      <label className="chip file-chip" title="Resume a battle from a downloaded file">
        Load file
        <input
          type="file"
          accept=".json,application/json"
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
function SequenceBar({ game }: { game: GameState }) {
  const segments = PHASE_SEGMENTS[game.phase]
  return (
    <div className="sequence-bar">
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
        title="Take back the last action — dice included, the replay is exact"
      >
        ↶ Undo
      </button>
      <button type="button" className="primary" onClick={() => dispatch({ type: 'advance-segment' })}>
        Complete {SEGMENT_LABELS[game.segment]} →
      </button>
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

function LogPanel({ game }: { game: GameState }) {
  const recent = game.log.slice(-60).reverse()
  return (
    <div className="log">
      <h3>Battle log</h3>
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
    </div>
  )
}
