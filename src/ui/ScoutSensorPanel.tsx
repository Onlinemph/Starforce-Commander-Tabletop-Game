import { useState } from 'react'
import type { GameState } from '../engine/game'
import { actualRange } from '../engine/geometry'
import { scanCapability, scoutSensorsOn } from '../engine/scouting'
import { isScout, scoutSensorsIntact, scoutSensorsPowered, type ShipState } from '../engine/shipState'
import type { ScoutFunction } from '../engine/types'
import { dispatch } from './store'

/**
 * Scouting Sensors (H3). Functions are assigned during Resource Allocation and
 * hold for the round (H3.2.2); sensors are switched on and off during
 * Operations step 2.E (H3.3.2).
 */

interface Props {
  game: GameState
  ship: ShipState
  /** Assignment is only legal during Resource Allocation (H3.2.2). */
  assigning: boolean
}

const FUNCTION_LABEL: Record<ScoutFunction, string> = {
  targeting: 'Targeting',
  jamming: 'Area jamming',
  scan: 'Info scan',
}

export function ScoutSensorPanel({ game, ship, assigning }: Props) {
  const [error, setError] = useState<string | null>(null)
  if (!isScout(ship)) return null

  const block = ship.form.scoutSensor!
  const powered = scoutSensorsPowered(ship)
  const intact = scoutSensorsIntact(ship)
  const enemies = game.ships.filter((s) => s.side !== ship.side && !s.destroyed && !s.disengaged)
  const scan = scanCapability(ship)

  const assign = (index: number, fn: ScoutFunction, targetId: string | null) =>
    setError(dispatch({ type: 'scout-assign', shipId: ship.id, index, fn, targetId }).message)

  return (
    <div className="segment-help scout-panel">
      <h3>Scouting Sensors (H3)</h3>
      <p className="hint">
        {powered} of {intact} undamaged sensor{intact === 1 ? '' : 's'} powered by the SCOUT SEN line
        (H3.2.1) · targeting {block.targetingRange}&quot; · area jamming {block.jammingRange}&quot; ·
        info scan {block.scanRange}&quot;
      </p>

      {powered === 0 && (
        <p className="fire-error">
          No power on the SCOUT SEN line. Scout sensors never carry power between rounds (H3.3.3).
        </p>
      )}

      <table className="scout-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Function</th>
            <th>Illuminating</th>
            <th>2.E</th>
          </tr>
        </thead>
        <tbody>
          {ship.scoutAssignments.map((sensor, index) => {
            const unpowered = index >= powered
            return (
              <tr key={index} className={unpowered ? 'is-out' : ''}>
                <td>{index + 1}</td>
                <td>
                  <select
                    value={sensor.function}
                    disabled={!assigning}
                    onChange={(e) =>
                      assign(index, e.target.value as ScoutFunction, sensor.targetId)
                    }
                  >
                    {(['targeting', 'jamming', 'scan'] as ScoutFunction[]).map((fn) => (
                      <option key={fn} value={fn}>
                        {FUNCTION_LABEL[fn]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {sensor.function === 'targeting' ? (
                    <select
                      value={sensor.targetId ?? ''}
                      disabled={!assigning}
                      onChange={(e) => assign(index, 'targeting', e.target.value || null)}
                    >
                      <option value="">— choose a target —</option>
                      {enemies.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({actualRange(ship.placement.position, e.placement.position)}
                          &quot;)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <em>—</em>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={sensor.active}
                    disabled={unpowered}
                    title="Activate or deactivate during Operations step 2.E (H3.3.2)"
                    onChange={(e) =>
                      dispatch({
                        type: 'scout-active',
                        shipId: ship.id,
                        index,
                        active: e.target.checked,
                      })
                    }
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="hint">
        Illuminating a target gives <strong>every</strong> friendly ship shooting at it one extra
        targeting point per sensor (H3.4.1, H3.4.3). Area jamming covers friendly ships within{' '}
        {block.jammingRange}&quot;, including this one (H3.5.1).
        {scoutSensorsOn(ship, 'jamming').length > 0 &&
          ` Currently jamming with ${scoutSensorsOn(ship, 'jamming').length}.`}
        {scan && ` Info scans out to ${scan.range}" for +${scan.bonusPoints} information points (H3.6).`}
      </p>

      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}
