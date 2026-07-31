import { useState } from 'react'
import { craftName, effectiveSpeed, maxSystemOf, tractorBeamsFree, type GameState } from '../engine/game'
import { undamagedSystemBoxes, type ShipState } from '../engine/shipState'
import {
  isShuttle,
  recoveryAllowance,
  shuttleCapacity,
  SHUTTLE_SPEED,
  type SmallCraft,
} from '../engine/smallCraft'
import { dispatch } from './store'

/**
 * The Flight Operations Segment (A3.3.5, J8.2). Shuttles launch in Step A and
 * activate in Step B, and each one moves, lands or docks once a phase.
 */

export function FlightOpsPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const bays = undamagedSystemBoxes(ship, 'SHTL')
  const mine = game.smallCraft.filter((c) => c.side === ship.side && isShuttle(c))
  const launched = game.ops.launchedThisPhase.has(ship.id)
  const recovered = game.ops.recoveredThisPhase[ship.id] ?? 0
  const allowance = recoveryAllowance(ship, maxSystemOf(game, ship), tractorBeamsFree(game, ship))

  return (
    <div className="segment-help ops-panel">
      <h3>Flight Operations (A3.3.5, J8)</h3>

      {bays === 0 ? (
        <p className="hint">{ship.name} has no shuttle bay (J8.1.1).</p>
      ) : (
        <>
          <p className="hint">
            {ship.shuttlesAboard} shuttle(s) aboard of {shuttleCapacity(ship)} the bay holds ·{' '}
            {recovered}/{allowance} recovered this phase (J8.1.2, J8.1.5).
          </p>
          <div className="builder-row wrap">
            <button
              type="button"
              className="chip"
              disabled={launched}
              onClick={() => setError(dispatch({ type: 'launch-shuttle', shipId: ship.id }).message)}
            >
              Launch shuttle
            </button>
            <button
              type="button"
              className="chip"
              disabled={launched || ship.marineSquads < 1}
              onClick={() =>
                setError(
                  dispatch({ type: 'launch-shuttle', shipId: ship.id, kind: 'shuttle', marines: 1 })
                    .message,
                )
              }
              title="J8.3.5 — a standard shuttle carries one marine squad or away team"
            >
              Launch with marines
            </button>
            <button
              type="button"
              className="chip"
              disabled={launched}
              onClick={() =>
                setError(
                  dispatch({ type: 'launch-shuttle', shipId: ship.id, kind: 'jamming-shuttle' })
                    .message,
                )
              }
              title="J8.4 — GEN SYS at MAX, mother ship at speed 3 or less"
            >
              Launch jammer
            </button>
          </div>
        </>
      )}

      {mine.length > 0 && (
        <table className="builder-table">
          <thead>
            <tr>
              <th>Craft</th>
              <th>Damage</th>
              <th>Move</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mine.map((craft) => (
              <CraftRow
                key={craft.id}
                game={game}
                craft={craft}
                ship={ship}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        A shuttle moves up to {SHUTTLE_SPEED}&quot; in any direction, ignoring its facing and
        ignoring stress (J8.2.3). Movement is not plotted — pick a bearing and go.
      </p>
    </div>
  )
}

/** Eight compass points, so a shuttle can be flown without a map click. */
const BEARINGS: Array<{ label: string; heading: number }> = [
  { label: '↑', heading: 0 },
  { label: '↗', heading: 45 },
  { label: '→', heading: 90 },
  { label: '↘', heading: 135 },
  { label: '↓', heading: 180 },
  { label: '↙', heading: 225 },
  { label: '←', heading: 270 },
  { label: '↖', heading: 315 },
]

function CraftRow({
  game,
  craft,
  ship,
  onError,
}: {
  game: GameState
  craft: SmallCraft
  ship: ShipState
  onError: (message: string | null) => void
}) {
  const [distance, setDistance] = useState(SHUTTLE_SPEED)

  const fly = (heading: number) => {
    const radians = (heading * Math.PI) / 180
    onError(
      dispatch({
        type: 'move-craft',
        craftId: craft.id,
        x: craft.position.x + Math.sin(radians) * distance,
        y: craft.position.y - Math.cos(radians) * distance,
      }).message,
    )
  }

  const nearby = game.ships.filter(
    (s) =>
      !s.destroyed &&
      !s.disengaged &&
      Math.hypot(s.placement.position.x - craft.position.x, s.placement.position.y - craft.position.y) < 2,
  )

  return (
    <tr className={craft.activated ? 'is-done' : ''}>
      <td>
        {craftName(craft)}
        {craft.kind === 'jamming-shuttle' && <em> jammer</em>}
        {craft.marines ? <em> · {craft.marines} marine(s)</em> : null}
        {craft.dockedTo && <em> · docked</em>}
      </td>
      <td>{craft.damage}/4</td>
      <td>
        <div className="builder-row wrap">
          <input
            type="number"
            min={0}
            max={SHUTTLE_SPEED}
            step={0.5}
            value={distance}
            onChange={(e) => setDistance(Math.min(SHUTTLE_SPEED, Number(e.target.value) || 0))}
          />
          {BEARINGS.map((b) => (
            <button
              key={b.label}
              type="button"
              className="chip"
              disabled={craft.activated || Boolean(craft.dockedTo)}
              onClick={() => fly(b.heading)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </td>
      <td>
        <div className="builder-row wrap">
          {nearby
            .filter((s) => s.side === craft.side)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                onClick={() =>
                  onError(dispatch({ type: 'recover-shuttle', craftId: craft.id, shipId: s.id }).message)
                }
              >
                land on {s.name.split(' ').pop()}
              </button>
            ))}
          {nearby
            .filter((s) => s.side !== craft.side)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                title={`J8.2.6 — ${s.name} is at speed ${effectiveSpeed(game, s)}`}
                onClick={() =>
                  onError(dispatch({ type: 'dock-shuttle', craftId: craft.id, shipId: s.id }).message)
                }
              >
                board {s.name.split(' ').pop()}
              </button>
            ))}
          {nearby.length === 0 && <em className="hint">nothing within range 1</em>}
        </div>
        {ship.id === craft.motherId && null}
      </td>
    </tr>
  )
}
