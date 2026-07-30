import { useMemo, useState } from 'react'
import { BLUE, RED, SCENARIOS } from '../data/scenarios'
import {
  activeShips,
  advanceSegment,
  isCombatPhase,
  PHASE_LABELS,
  PHASE_SEGMENTS,
  pushLog,
  SEGMENT_LABELS,
  setShieldDown,
  victoryPoints,
  type GameState,
} from '../engine/game'
import { disengagementOptions } from '../engine/navigation'
import { damageLevel, type ShipState } from '../engine/shipState'
import type { ShieldSide } from '../engine/types'
import { CombatPanel } from './CombatPanel'
import { CommandCardPanel } from './CommandCardPanel'
import { CommandSystemsPanel } from './CommandSystemsPanel'
import { FormationPanel } from './FormationPanel'
import { ScoutSensorPanel } from './ScoutSensorPanel'
import { DamageControlPanel } from './DamageControlPanel'
import { MapView, type RangeRing } from './MapView'
import { ShipPicker } from './ShipPicker'
import { ShipFormPanel } from './ShipFormPanel'
import { act, resetGame, useGame } from './store'

export function App() {
  const game = useGame()
  const ships = activeShips(game)
  const [selectedId, setSelectedId] = useState<string>(ships[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [showArcs, setShowArcs] = useState(true)
  const [showRings, setShowRings] = useState(false)
  const [picking, setPicking] = useState(false)

  const selected = game.ships.find((s) => s.id === selectedId) ?? ships[0] ?? null

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
      <header className="topbar">
        <div className="brand">
          <h1>StarForce Commander</h1>
          <span className="subtitle">Digital tabletop · Standard rules · hot-seat</span>
        </div>

        <label className="field inline">
          <span>Scenario</span>
          <select
            value={game.scenario.id}
            onChange={(e) => {
              resetGame(e.target.value)
              setTargetId(null)
            }}
          >
            {SCENARIOS.map(({ scenario }) => (
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
            onChange={(e) =>
              act((g) => {
                g.coordinatedFire = e.target.checked
                g.firingStepIndex = 0
                g.coordinatedGroup = null
                g.attackedThisPhase.clear()
                pushLog(g, `Coordinated Fire (H4) ${e.target.checked ? 'in force' : 'switched off'}.`)
              })
            }
          />
          Coordinated Fire
        </label>

        <button type="button" className="primary" onClick={() => setPicking(true)}>
          Choose forces
        </button>
        <button type="button" onClick={() => resetGame(game.scenario.id, { seed: Math.floor(Math.random() * 1e9) })}>
          Rematch
        </button>
      </header>

      {picking && (
        <ShipPicker
          scenarioId={game.scenario.id}
          current={{
            [BLUE]: game.ships.find((s) => s.side === BLUE)?.form.id,
            [RED]: game.ships.find((s) => s.side === RED)?.form.id,
          }}
          onClose={() => {
            setPicking(false)
            setTargetId(null)
          }}
        />
      )}

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
          />

          <div className="map-controls">
            <label className="checkbox">
              <input type="checkbox" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} />
              Firing arcs
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={showRings} onChange={(e) => setShowRings(e.target.checked)} />
              Range rings
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
          {selected && <SegmentControls game={game} ship={selected} />}
          {selected && <ShipFormPanel game={game} ship={selected} />}
        </section>
      </main>
    </div>
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
      <button type="button" className="primary" onClick={() => act((g) => advanceSegment(g))}>
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
            <FormationPanel game={game} ship={ship} />
            <CommandCardPanel game={game} ship={ship} />
          </>
        )
      case 'operations':
        return (
          <>
            <OperationsPanel game={game} ship={ship} />
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
        return (
          <div className="segment-help">
            <h3>Flight Operations (A3.3.5)</h3>
            <p>Small craft launch and activate here. Shuttle operations are not yet implemented.</p>
          </div>
        )
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
    case 'disengagement':
      return <DisengagementPanel game={game} ship={ship} />
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
function OperationsPanel({ ship }: { game: GameState; ship: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="segment-help">
      <h3>Operations (A3.3.2)</h3>
      <ol className="ops-steps">
        <li>A — Activate systems with an activation delay (none in the Standard rules).</li>
        <li>
          B — Raise or lower shields:
          <div className="shield-toggles">
            {(['F', 'P', 'S', 'A'] as ShieldSide[]).map((side) => (
              <button
                key={side}
                type="button"
                className={`shield-toggle${ship.shieldsDown[side] ? ' is-down' : ''}`}
                onClick={() =>
                  act((g) => setError(setShieldDown(g, ship, side, !ship.shieldsDown[side])))
                }
              >
                {side} {ship.shieldsDown[side] ? 'down' : 'up'}
              </button>
            ))}
          </div>
        </li>
        <li>C — Activate or deactivate tractor beams (J3).</li>
        <li>D — Activate transporters (J5).</li>
        <li>E — Other systems, including informational scans (J4.2).</li>
      </ol>
      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        A shield may be raised or lowered once per phase, but never both in the same phase (G1.1.5).
      </p>
    </div>
  )
}

function DisengagementPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const enemies = game.ships.filter((s) => s.side !== ship.side && !s.destroyed && !s.disengaged)
  const options = disengagementOptions(ship, enemies, game.scenario.bounds)

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
            onClick={() =>
              act((g) => {
                ship.disengaged = true
                pushLog(g, `${ship.name} disengages from the battle.`)
              })
            }
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
