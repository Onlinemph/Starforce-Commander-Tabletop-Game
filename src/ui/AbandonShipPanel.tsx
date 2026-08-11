import { useState } from 'react'
import { crewComplement, POD_LANDING_RANGE, VICTORY_POINTS_PER_CREW } from '../engine/abandonShip'
import { type GameState } from '../engine/game'
import { actualRange } from '../engine/geometry'
import type { ShipState } from '../engine/shipState'
import { dispatch, dispatchWithChoices } from './store'

/**
 * Abandoning ship (E11.4 – E11.6, optional).
 *
 * The panel only appears when the optional rule is switched on and there is
 * something to do: people still aboard this hull, or a pod within reach of it.
 * It is the one control in the game a captain uses when they have already lost
 * the ship, so it says plainly what each way off costs.
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function AbandonShipPanel({ game, ship }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [destination, setDestination] = useState<string>('')
  const [scuttle, setScuttle] = useState(false)

  if (!game.options.abandonShip) return null

  const podsInReach = game.escapePods.filter(
    (pod) => actualRange(pod.position, ship.placement.position) <= 8,
  )
  const aboard = ship.crewUnits
  if (aboard === 0 && podsInReach.length === 0) return null

  const others = game.ships.filter(
    (s) => s.id !== ship.id && !s.destroyed && !s.disengaged,
  )
  const target = destination || others[0]?.id || ''

  return (
    <div className="segment-help abandon-panel">
      <h3>Abandon Ship (E11.4)</h3>

      {aboard > 0 && (
        <>
          <p className="hint">
            {aboard} of {crewComplement(ship)} crew unit(s) still aboard. A unit saved — or captured
            — is worth {VICTORY_POINTS_PER_CREW} victory points at the end of the battle (E11.4.2).
          </p>

          <div className="abandon-option">
            <h4>Emergency transport (E11.5)</h4>
            <p className="hint">
              Fast, and the only way off a ship that is about to go. The safety protocols come off:
              one green die per crew unit, and a Miss is a unit that did not survive the trip.
            </p>
            <div className="abandon-controls">
              <label className="field inline">
                <span>To</span>
                <select value={target} onChange={(e) => setDestination(e.target.value)}>
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {actualRange(ship.placement.position, s.placement.position)}&quot;
                      {s.side === ship.side ? '' : ' (enemy)'}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!target}
                onClick={() =>
                  setError(
                    dispatch({ type: 'evacuate-crew', shipId: ship.id, toShipId: target }).message,
                  )
                }
              >
                Beam out
              </button>
            </div>
          </div>

          <div className="abandon-option">
            <h4>Escape pods (E11.6)</h4>
            <p className="hint">
              Everyone gets off, but the pods sit where they are dropped until somebody comes for
              them — and a hull blown apart under fire takes its crew with it, so this only works
              while the ship is still there to leave (E11.6.1).
            </p>
            <div className="abandon-controls">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={scuttle}
                  onChange={(e) => setScuttle(e.target.checked)}
                />
                Self-destruct on the way out (E11.6.3)
              </label>
              <button
                type="button"
                onClick={() =>
                  // A scuttled hull explodes, and the blast draws damage
                  // cards on every neighbour (E11.3.3) — their choices go
                  // through the probe like any volley's.
                  void dispatchWithChoices({
                    type: 'abandon-ship',
                    shipId: ship.id,
                    selfDestruct: scuttle,
                  }).then((outcome) => setError(outcome.message))
                }
              >
                Take to the pods
              </button>
            </div>
          </div>
        </>
      )}

      {podsInReach.length > 0 && (
        <div className="abandon-option">
          <h4>Pods within reach (E11.6.5)</h4>
          {podsInReach.map((pod) => {
            const range = actualRange(pod.position, ship.placement.position)
            const mine = pod.side === ship.side
            return (
              <div key={pod.id} className="abandon-pod">
                <span>
                  {pod.fromShipName}&apos;s pod · {pod.crew} crew · {range}&quot;
                  {mine ? '' : ' · enemy crew'}
                </span>
                <button
                  type="button"
                  disabled={ship.speed !== 0 || range > POD_LANDING_RANGE}
                  title={
                    ship.speed !== 0
                      ? 'The ship must be stopped to take a pod aboard (E11.6.5)'
                      : range > POD_LANDING_RANGE
                        ? `A landing needs ${POD_LANDING_RANGE}" (E11.6.5)`
                        : mine
                          ? 'Bring them aboard'
                          : 'Take them prisoner'
                  }
                  onClick={() =>
                    setError(
                      dispatch({ type: 'recover-pod', podId: pod.id, shipId: ship.id, method: 'land' })
                        .message,
                    )
                  }
                >
                  Land it
                </button>
                <button
                  type="button"
                  title="One transporter beams one crew unit aboard per phase (E11.6.5)"
                  onClick={() =>
                    setError(
                      dispatch({ type: 'recover-pod', podId: pod.id, shipId: ship.id, method: 'beam' })
                        .message,
                    )
                  }
                >
                  Beam one
                </button>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}
