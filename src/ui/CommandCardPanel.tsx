import { lentScanPoints, type GameState } from '../engine/game'
import { accelerationBudget, validatePlot } from '../engine/navigation'
import { currentMaxSpeed, lineValue, maxReverseSpeed, sensorFunctionCap, turnTemplateAt, type ShipState } from '../engine/shipState'
import type { Maneuver, ShieldSide, TurnDirection } from '../engine/types'
import { act } from './store'

/**
 * The command card (A2.3, C1). Orders are plotted here during the Command
 * Segment and revealed at the start of the Navigation Segment (B1.9.1).
 */

const MANEUVERS: Array<{ id: Maneuver; label: string; directional: boolean; rule: string }> = [
  { id: 'slide', label: 'SLIDE', directional: true, rule: 'C2.4' },
  { id: 'easy', label: 'EASY', directional: true, rule: 'C2.3 — always 20°' },
  { id: 'straight', label: 'STRAIGHT', directional: false, rule: 'C2.1' },
  { id: 'standard', label: 'STND', directional: true, rule: 'C2.2' },
  { id: 's-turn', label: 'S-TURN', directional: true, rule: 'C3.3 — 1 stress' },
  { id: 'snap', label: 'SNAP', directional: true, rule: 'C3.4 — 1 stress' },
  { id: 'hard', label: 'HARD', directional: true, rule: 'C3.2 — 1 stress' },
  { id: 'em-90', label: 'EM-90', directional: true, rule: 'C3.5 — stress = speed' },
  { id: 'em-180', label: 'EM-180', directional: true, rule: 'C3.5 — stress = 2× speed' },
]

interface Props {
  game: GameState
  ship: ShipState
}

export function CommandCardPanel({ game, ship }: Props) {
  const card = game.orders[ship.id]
  if (!card) return null

  const errors = validatePlot(ship, card)
  const budget = accelerationBudget(ship)
  const sensorPoints = lineValue(ship, ship.form.functions.find((l) => l.kind === 'sensor')?.id ?? '')
  const sensorsUsed = card.sensors.targeting + card.sensors.jamming + card.sensors.tacticalScan
  const cap = sensorFunctionCap(ship)
  const lent = lentScanPoints(game)[ship.id] ?? 0

  const setManeuver = (maneuver: Maneuver, direction: TurnDirection | null) =>
    act(() => {
      card.maneuver = maneuver
      card.direction = direction
    })

  const setAccel = (delta: number) =>
    act(() => {
      const next = card.accel + delta
      card.accel = next
      card.speed = ship.speed + next
    })

  const setSensor = (key: keyof typeof card.sensors, value: number) =>
    act(() => {
      card.sensors[key] = Math.max(0, Math.min(value, cap))
    })

  const toggleShield = (side: ShieldSide) =>
    act(() => {
      card.shieldsDown = card.shieldsDown.includes(side)
        ? card.shieldsDown.filter((s) => s !== side)
        : [...card.shieldsDown, side]
    })

  return (
    <div className="command-card">
      <h3>Command Card — {ship.name}</h3>

      <div className="cc-block">
        <h4>Helm</h4>
        <div className="maneuver-grid">
          {MANEUVERS.map((entry) => {
            const isCurrent = card.maneuver === entry.id
            if (!entry.directional) {
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`maneuver${isCurrent ? ' is-current' : ''}`}
                  title={entry.rule}
                  onClick={() => setManeuver(entry.id, null)}
                >
                  {entry.label}
                </button>
              )
            }
            return (
              <div key={entry.id} className="maneuver-pair" title={entry.rule}>
                <button
                  type="button"
                  className={`maneuver${isCurrent && card.direction === 'left' ? ' is-current' : ''}`}
                  onClick={() => setManeuver(entry.id, 'left')}
                >
                  ◀
                </button>
                <span className="maneuver-name">{entry.label}</span>
                <button
                  type="button"
                  className={`maneuver${isCurrent && card.direction === 'right' ? ' is-current' : ''}`}
                  onClick={() => setManeuver(entry.id, 'right')}
                >
                  ▶
                </button>
              </div>
            )
          })}
        </div>
        <p className="hint">
          Turn template at speed {card.speed}: {turnTemplateAt(ship, card.speed) || 'no turn'}
          {turnTemplateAt(ship, card.speed) ? '°' : ''} (C2.2.2)
        </p>
      </div>

      <div className="cc-block">
        <h4>Sublight Drive</h4>
        <div className="accel-row">
          <button type="button" onClick={() => setAccel(-1)}>
            −
          </button>
          <span className="accel-value">
            ACCEL {card.accel >= 0 ? '+' : ''}
            {card.accel}
          </span>
          <button type="button" onClick={() => setAccel(1)}>
            +
          </button>
          <span className="speed-value">SPEED {card.speed}</span>
        </div>
        <p className="hint">
          {ship.accelUsedThisRound} of {budget} acceleration points used this round · max{' '}
          {ship.form.sublight.maxAccelPerPhase}/phase · safe {ship.form.sublight.safeAccelPerRound}/round ·
          speed range {-maxReverseSpeed(ship)} to {currentMaxSpeed(ship)}
        </p>
      </div>

      <div className="cc-block">
        <h4>Sensors</h4>
        <div className="sensor-grid">
          {(['targeting', 'jamming', 'tacticalScan'] as const).map((key) => (
            <label key={key}>
              <span>{key === 'tacticalScan' ? 'Tactical Scan' : key[0].toUpperCase() + key.slice(1)}</span>
              <input
                type="number"
                min={0}
                max={cap}
                value={card.sensors[key]}
                onChange={(e) => setSensor(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className={`hint${sensorsUsed > sensorPoints ? ' is-error' : ''}`}>
          {sensorsUsed} of {sensorPoints} sensor points allocated · max {cap} per function (H2.2.3)
        </p>
        {lent > 0 && (
          <p className="hint">
            Plus {lent} tactical scan point{lent === 1 ? '' : 's'} on loan from the command ship, which may
            take the ship past its sensor cap (H5.2.2) — effective Tactical Scan{' '}
            {card.sensors.tacticalScan + lent}.
          </p>
        )}
      </div>

      <div className="cc-block">
        <h4>Shields</h4>
        <div className="shield-toggles">
          {(['F', 'P', 'S', 'A'] as ShieldSide[]).map((side) => (
            <button
              key={side}
              type="button"
              className={`shield-toggle${card.shieldsDown.includes(side) ? ' is-down' : ''}`}
              onClick={() => toggleShield(side)}
              title="Mark a shield to be lowered during the Operations Segment (G1.1.5)"
            >
              {side} {card.shieldsDown.includes(side) ? 'down' : 'up'}
            </button>
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="plot-errors">
          {errors.map((e, i) => (
            <li key={i} className={e.fallbackToStraight ? 'is-warn' : 'is-error'}>
              {e.message}
              {e.fallbackToStraight ? ' The ship will move straight instead (C1.1.2).' : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
