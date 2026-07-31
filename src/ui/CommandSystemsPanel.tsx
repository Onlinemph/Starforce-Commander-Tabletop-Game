import { useState } from 'react'
import {
  commandPointsAvailable,
  commandSystemBoxes,
  COMMAND_RANGE,
  hasCommandSystems,
  lentTacticalScan,
  totalAssigned,
} from '../engine/command'
import { commandStateFor, type GameState } from '../engine/game'
import { actualRange } from '../engine/geometry'
import { genSysSetting, type ShipState } from '../engine/shipState'
import { dispatch } from './store'

/**
 * Command Systems (H5). Lending is done during the Resource Allocation Segment
 * and the points last the whole round (H5.2.1).
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function CommandSystemsPanel({ game, ship }: Props) {
  const [error, setError] = useState<string | null>(null)

  const state = commandStateFor(game, ship.side)
  const fleet = game.ships.filter((s) => s.side === ship.side && !s.destroyed && !s.disengaged)
  const candidates = fleet.filter(hasCommandSystems)
  if (candidates.length === 0) return null

  const commandShip = fleet.find((s) => s.id === state.commandShipId) ?? null
  const available = commandShip ? commandPointsAvailable(commandShip) : 0
  const lent = lentTacticalScan(state, game.ships)
  const spent = totalAssigned(state)

  const assign = (targetId: string, points: number) =>
    setError(dispatch({ type: 'assign-command', side: ship.side, targetId, points }).message)

  return (
    <div className="segment-help command-systems">
      <h3>Command Systems (H5)</h3>

      <label className="field">
        <span>Command ship for {ship.side} this round (H5.1.6)</span>
        <select
          value={state.commandShipId ?? ''}
          onChange={(e) => {
            dispatch({ type: 'set-command-ship', side: ship.side, shipId: e.target.value || null })
            setError(null)
          }}
        >
          <option value="">— none —</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({commandSystemBoxes(s)} CMND)
            </option>
          ))}
        </select>
      </label>

      {commandShip && genSysSetting(commandShip) !== 'max' && (
        <p className="fire-error">
          {commandShip.name} must set its GEN SYS line to MAX before its command systems function (H5.1.3).
        </p>
      )}

      {commandShip && (
        <>
          <p className="hint">
            {spent} of {available} command point{available === 1 ? '' : 's'} lent. Each functioning CMND box
            generates one tactical scan point (H5.1.4); a point lasts the whole round and cannot be
            reallocated (H5.2.1).
          </p>

          <table className="command-table">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Range</th>
                <th>Lent</th>
                <th>TacScan</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((s) => {
                const range = actualRange(commandShip.placement.position, s.placement.position)
                const held = lent[s.id] ?? 0
                // H5.2.3 caps self-lending at one point.
                const max = s.id === commandShip.id ? 1 : available
                const out = range > COMMAND_RANGE
                return (
                  <tr key={s.id} className={out ? 'is-out' : ''}>
                    <td>
                      {s.name}
                      {s.id === commandShip.id && <em> (flag)</em>}
                    </td>
                    <td>{range}&quot;</td>
                    <td>
                      <div className="command-points">
                        <button type="button" disabled={held === 0} onClick={() => assign(s.id, held - 1)}>
                          −
                        </button>
                        <span>{held}</span>
                        <button
                          type="button"
                          disabled={held >= max || spent >= available || out}
                          onClick={() => assign(s.id, held + 1)}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td>{s.sensors.tacticalScan + held}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="hint">
            Lending range is {COMMAND_RANGE}&quot; (H5.1.5). Ships receiving command points may exceed the
            tactical scan limit their own sensors impose (H5.2.2).
          </p>
        </>
      )}

      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}
