import { useState } from 'react'
import {
  cloakFullyPowered,
  cloakOperational,
  cloakStrength,
  DETECTION_LABELS,
  detectionBy,
  hasCloak,
  isCloaked,
  mayDecloak,
  searchDice,
  searchRange,
  withinSearchRange,
  type DetectionLevel,
} from '../engine/cloaking'
import { cloakOf, type GameState } from '../engine/game'
import { actualRange } from '../engine/geometry'
import type { ShipState } from '../engine/shipState'
import { dispatch } from './store'

/**
 * Cloaking Systems (H6). The cloak is switched in Operations step 2A, and the
 * search rolls that hunt it happen in step 2E.
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function CloakPanel({ game, ship }: Props) {
  const [error, setError] = useState<string | null>(null)

  const own = cloakOf(game, ship)
  const enemyCloaks = game.ships.filter(
    (s) => s.side !== ship.side && !s.destroyed && !s.disengaged && isCloaked(cloakOf(game, s)),
  )
  if (!own && enemyCloaks.length === 0) return null

  return (
    <div className="segment-help cloak-panel">
      <h3>Cloaking Systems (H6)</h3>

      {own && hasCloak(ship) && (
        <>
          <p className="hint">
            {isCloaked(own)
              ? `${ship.name} is cloaked. Shields down, weapons locked, no scans or tractors (H6.4).`
              : `${ship.name} carries a cloaking system.`}
            {' '}Jamming becomes extra power to the cloak while it runs, and is what a searcher&apos;s
            targeting has to beat — currently {cloakStrength(ship)} (H6.4.5).
          </p>

          {!cloakOperational(ship) && (
            <p className="fire-error">The cloaking system is damaged and cannot be used (H6.1.4).</p>
          )}

          {isCloaked(own) ? (
            <>
              <ul className="cloak-detection">
                {game.ships
                  .filter((s) => s.side !== ship.side && !s.destroyed && !s.disengaged)
                  .map((hunter) => {
                    const level = detectionBy(own, hunter.id)
                    return (
                      <li key={hunter.id} className={`level-${level}`}>
                        {hunter.name}: <strong>{DETECTION_LABELS[level]}</strong>
                      </li>
                    )
                  })}
              </ul>
              <p className="hint">
                Cloaked for {own.phasesCloaked} phase{own.phasesCloaked === 1 ? '' : 's'} · speed log{' '}
                {own.speedLog.join(', ') || '—'} · datum at ({own.datum.position.x.toFixed(1)},{' '}
                {own.datum.position.y.toFixed(1)})
              </p>
              <div className="cloak-actions">
                <button
                  type="button"
                  onClick={() => setError(dispatch({ type: 'reduce-detection', shipId: ship.id }).message)}
                >
                  Attempt to reduce detection (H6.13)
                </button>
                <button
                  type="button"
                  disabled={!mayDecloak(own)}
                  title={mayDecloak(own) ? '' : 'The cloak must run for a full phase first (H6.6.7)'}
                  onClick={() => {
                    dispatch({ type: 'decloak', shipId: ship.id })
                    setError(null)
                  }}
                >
                  Decloak (H6.7)
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={!cloakOperational(ship) || !cloakFullyPowered(ship)}
              title={cloakFullyPowered(ship) ? '' : 'Fill every circle on the CLOAK line first (H6.3.1)'}
              onClick={() => setError(dispatch({ type: 'engage-cloak', shipId: ship.id }).message)}
            >
              Engage cloak (H6.6)
            </button>
          )}
        </>
      )}

      {enemyCloaks.length > 0 && (
        <div className="cloak-search">
          <h4>Search (step 2E)</h4>
          <p className="hint">
            {ship.name} searches out to {searchRange(ship)}&quot; — five inches per undamaged SCNC
            box (H6.9.1). One attempt per phase, and one level gained per segment (H6.9.2, H6.15.1).
          </p>
          {enemyCloaks.map((ghost) => {
            const state = cloakOf(game, ghost)!
            const level = detectionBy(state, ship.id)
            const { count, color } = searchDice(ship, ghost, state)
            const inRange = withinSearchRange(ship, ghost, state)
            const to = level === 0 ? state.datum.position : ghost.placement.position
            return (
              <div key={ghost.id} className="cloak-target">
                <span>
                  {ghost.name}: <strong>{DETECTION_LABELS[level as DetectionLevel]}</strong>
                  <em>
                    {' '}
                    {actualRange(ship.placement.position, to)}&quot; to{' '}
                    {level === 0 ? 'the datum' : 'the ship'}
                  </em>
                </span>
                <button
                  type="button"
                  disabled={!inRange || count === 0 || level >= 3}
                  title={
                    !inRange
                      ? 'Out of search range (H6.9.1)'
                      : count === 0
                        ? 'Targeting is below the cloaked ship’s jamming (H6.10.2)'
                        : `Roll ${count} ${color} ${count === 1 ? 'die' : 'dice'}`
                  }
                  onClick={() =>
                    setError(dispatch({ type: 'cloak-search', shipId: ship.id, ghostId: ghost.id }).message)
                  }
                >
                  Search · {count} {color}
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
