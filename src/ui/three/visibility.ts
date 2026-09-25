/**
 * Which hulls a view may draw — the same rules as the 2D map, in one place
 * the 3D layers can share.
 *
 * Destroyed and departed ships are gone; reinforcements are not on the board
 * before their round (S3.2); a cloaked, undetected ship is off the table
 * (H6.2.2) except to its own commander; and in formation only the lead's
 * counter is on the map (C5.1.3), carrying the formation's size.
 */
import { positionIsHidden } from '../../engine/cloaking'
import { formationOf } from '../../engine/formation'
import type { GameState } from '../../engine/game'
import type { ShipState } from '../../engine/shipState'

export interface DrawnShip {
  ship: ShipState
  formationSize: number
  /** Cloaked and undetected, drawn only because this is its own side's view. */
  ghosted: boolean
}

export function drawnShips(game: GameState, viewSide: string | null): DrawnShip[] {
  const out: DrawnShip[] = []
  for (const ship of game.ships) {
    if (ship.destroyed || ship.disengaged) continue
    if (ship.arrivesRound > game.round) continue
    const cloak = game.cloaks[ship.id]
    const hidden = Boolean(cloak && positionIsHidden(cloak))
    if (hidden && ship.side !== viewSide) continue
    const formation = formationOf(game.formations, ship.id)
    if (formation && formation.leadId !== ship.id) continue
    out.push({
      ship,
      formationSize: (formation?.memberIds.length ?? 0) + 1,
      ghosted: hidden,
    })
  }
  return out
}
