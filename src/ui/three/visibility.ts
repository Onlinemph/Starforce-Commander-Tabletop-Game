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
import type { GameState, Terrain } from '../../engine/game'
import { hasLineOfSight } from '../../engine/geometry'
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

/**
 * The enemy hulls the selected ship cannot see, each with the planet or
 * moon in the way (E2.3.1). It is the rules' own line-of-sight check, so a
 * ship over a world sees and is seen (K3.1.3), and the answer does not
 * depend on where the camera is.
 */
export function blockedSightlines(
  game: GameState,
  selectedId: string | null,
  viewSide: string | null,
): Map<string, Terrain> {
  const out = new Map<string, Terrain>()
  const drawn = drawnShips(game, viewSide)
  const from = drawn.find((d) => d.ship.id === selectedId)?.ship
  if (!from) return out
  const worlds = game.scenario.terrain.filter((t) => t.kind === 'planet' || t.kind === 'moon')
  if (worlds.length === 0) return out
  for (const { ship } of drawn) {
    if (ship.side === from.side) continue
    const blocker = worlds.find(
      (w) =>
        !hasLineOfSight(from.placement.position, ship.placement.position, [
          { center: w.center, radius: w.radius, blocksLos: true },
        ]),
    )
    if (blocker) out.set(ship.id, blocker)
  }
  return out
}

/**
 * Where a sightline from `a` toward `b` first meets a world's circle, as a
 * fraction of the way along — or null if it does not (for drawing the line
 * cut off where the world blocks it).
 */
export function sightlineCut(
  a: { x: number; y: number },
  b: { x: number; y: number },
  world: { center: { x: number; y: number }; radius: number },
): number | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - world.center.x
  const fy = a.y - world.center.y
  const qa = dx * dx + dy * dy
  if (qa === 0) return null
  const qb = 2 * (fx * dx + fy * dy)
  const qc = fx * fx + fy * fy - world.radius * world.radius
  const disc = qb * qb - 4 * qa * qc
  if (disc < 0) return null
  const t = (-qb - Math.sqrt(disc)) / (2 * qa)
  return t >= 0 && t <= 1 ? t : null
}
