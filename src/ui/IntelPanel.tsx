import type { GameState } from '../engine/game'
import { infoPoints } from '../engine/operations'
import {
  armorRemaining,
  blueShieldRemaining,
  damageLevel,
  greenShieldRemaining,
  SHIELD_SIDES,
  type ShipState,
} from '../engine/shipState'

/**
 * What an enemy commander legitimately knows about a ship.
 *
 * Ship forms are hidden until the Final Activity Segment (B1.9.1, B1.9.2), so
 * when a side-view player selects an enemy vessel this panel stands in for the
 * form. It shows only what the table itself shows — the counter, its speed and
 * stress markers, announced shield states — plus whatever information points
 * this side's scans have earned (J4).
 */
export function IntelPanel({
  game,
  ship,
  viewSide,
}: {
  game: GameState
  ship: ShipState
  viewSide: string
}) {
  const intel = infoPoints(game.ops.info, viewSide, ship.id)

  return (
    <div className="segment-help intel-panel">
      <h3>Enemy vessel — {ship.name}</h3>
      <p className="ship-class">
        {ship.form.name} · {ship.form.faction}
      </p>

      <dl className="intel-facts">
        <div>
          <dt>Size</dt>
          <dd>{ship.form.sizeClass}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{ship.speed}</dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd>{Math.round(ship.placement.heading)}°</dd>
        </div>
        <div>
          <dt>Stress</dt>
          <dd>{ship.stressMarkers}</dd>
        </div>
        <div>
          <dt>Damage</dt>
          <dd>{ship.destroyed ? 'destroyed' : damageLevel(ship)}</dd>
        </div>
      </dl>

      {/*
        Shield strength is public on this table — house rule, by playtest
        request. Same numbers the counter prints: blue boxes, +green while
        reinforcement holds, and the armour where a facing carries plate.
      */}
      <p className="hint">
        Shields:{' '}
        {SHIELD_SIDES.map((side) => {
          const armor = armorRemaining(ship, side)
          if (ship.shieldsDown[side]) return `${side} down${armor > 0 ? ` (${armor} armor)` : ''}`
          const blue = blueShieldRemaining(ship, side)
          const green = greenShieldRemaining(ship, side)
          const strength = green > 0 ? `${blue}+${green}` : `${blue}`
          return `${side} ${strength}${armor > 0 ? ` (+${armor} armor)` : ''}`
        }).join(' · ')}
      </p>

      {ship.derelict && <p className="hint">Derelict — no crew answers.</p>}
      {ship.capturedBy && <p className="hint">Captured by {ship.capturedBy}.</p>}

      <p className="hint">
        {viewSide} holds <strong>{intel}</strong> information point{intel === 1 ? '' : 's'} on this
        ship. Its full form stays hidden until the Final Activity Segment (B1.9.2) — scan it during
        Operations step E to learn more (J4).
      </p>
    </div>
  )
}
