import { useState } from 'react'
import { joinRequirements } from '../engine/formation'
import { formationFor, type GameState } from '../engine/game'
import { distance } from '../engine/geometry'
import { turnTemplateAt, type ShipState } from '../engine/shipState'
import { dispatch } from './store'

/**
 * Formation Maneuvering (C5). Ships join at the beginning of the Command
 * Segment, before plotting (C5.1.3), and the formation then plots one set of
 * helm orders for everyone.
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function FormationPanel({ game, ship }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const formation = formationFor(game, ship)
  const fleet = game.ships.filter(
    (s) => s.side === ship.side && !s.destroyed && !s.disengaged && !s.derelict,
  )
  if (fleet.length < 2) return null

  const others = fleet.filter((s) => s.id !== ship.id)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const formUp = () => {
    const joining = others.filter((s) => picked.has(s.id))
    if (joining.length === 0) {
      setError('Pick at least one ship to form up with.')
      return
    }
    // The lead is chosen inside the action handler (C5.1.1), so the journal
    // records the request, not a conclusion that could drift.
    setError(dispatch({ type: 'form-up', shipIds: [ship.id, ...joining.map((s) => s.id)] }).message)
    setPicked(new Set())
  }

  return (
    <div className="segment-help formation-panel">
      <h3>Formation (C5)</h3>

      {formation ? (
        <>
          <p className="hint">
            {formation.leadId === ship.id
              ? `${ship.name} is leading. Its plot is the whole formation's plot (C5.1.3).`
              : `Flying on ${game.ships.find((s) => s.id === formation.leadId)?.name}'s wing — helm orders come from the lead ship (C5.2). Sensors, shields and weapons stay independent.`}
          </p>
          <ul className="formation-list">
            {[formation.leadId, ...formation.memberIds].map((id) => {
              const member = game.ships.find((s) => s.id === id)!
              return (
                <li key={id} className={id === formation.leadId ? 'is-lead' : ''}>
                  {member.name}
                  {id === formation.leadId && <em> lead</em>}
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => dispatch({ type: 'leave-formation', shipId: ship.id })}
          >
            {formation.leadId === ship.id ? 'Disband formation' : `Detach ${ship.name}`}
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Joining needs range 1, the same speed, and a heading within 45° of the lead (C5.1.2).
            The least maneuverable ship at the formation&apos;s speed leads (C5.1.1).
          </p>
          <div className="formation-candidates">
            {others.map((other) => {
              const problem = joinRequirements(ship, other)
              const gap = distance(ship.placement.position, other.placement.position)
              return (
                <label key={other.id} className={`checkbox${problem ? ' is-disabled' : ''}`} title={problem ?? ''}>
                  <input
                    type="checkbox"
                    checked={picked.has(other.id)}
                    disabled={problem !== null}
                    onChange={() => toggle(other.id)}
                  />
                  {other.name}{' '}
                  <em>
                    {gap.toFixed(1)}&quot; · speed {other.speed} · turn{' '}
                    {turnTemplateAt(other, other.speed)}°
                  </em>
                </label>
              )
            })}
          </div>
          <button type="button" onClick={formUp} disabled={picked.size === 0}>
            Form up
          </button>
        </>
      )}

      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}
