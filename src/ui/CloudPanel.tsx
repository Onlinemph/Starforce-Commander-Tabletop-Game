import { cloudStatus, type GameState } from '../engine/game'
import type { ShipState } from '../engine/shipState'

/**
 * What a nebula (K4) or gas cloud (K5) is currently doing to a ship. Rendered
 * wherever the player is making a decision the clouds affect — plotting speed,
 * allocating power, or choosing to disengage.
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function CloudPanel({ game, ship }: Props) {
  const status = cloudStatus(game, ship)
  if (!status.inside) return null

  const where = status.cloud ? status.cloud.name : 'the nebula'
  const rule = status.cloud ? 'K5' : 'K4'

  return (
    <div className="segment-help cloud-panel">
      <h3>
        {status.cloud ? 'Gas Cloud' : 'Nebula'} ({rule})
      </h3>
      <p className="hint">
        {ship.name} is inside {where}.
      </p>
      <ul className="cloud-effects">
        <li className={status.overspeedDice > 0 ? 'is-warn' : ''}>
          Safe speed {status.safeSpeed} — at speed {Math.abs(ship.speed)} the ship rolls{' '}
          <strong>{status.overspeedDice}</strong> blue damage {status.overspeedDice === 1 ? 'die' : 'dice'}{' '}
          each Navigation Segment ({status.cloud ? 'K5.2.2' : 'K4.2.2'}).
        </li>
        {status.shieldsInoperative && (
          <li className="is-warn">
            Blue and green shield boxes are ignored; damage strikes armor and then goes internal
            (K4.2.1).
          </li>
        )}
        <li>All weapon fire uses degraded fire control, and slow targets are no easier to hit (K4.2.6, K4.2.3).</li>
        {status.hamperedSystems.length > 0 && (
          <li className="is-warn">
            {status.hamperedSystems.join(', ')} {status.hamperedSystems.length === 1 ? 'is' : 'are'} offline
            until GEN SYS is set to MAX (K4.2.4).
          </li>
        )}
        {status.ftlBlocked && <li>No FTL travel or FTL disengagement from inside (K4.2.7).</li>}
        {status.cloud?.scan !== undefined && (
          <li>
            A hidden unit in this cloud takes {status.cloud.scan} information points to find (K5.2.3).
          </li>
        )}
      </ul>
    </div>
  )
}
