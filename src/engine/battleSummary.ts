import { health } from './battleScore'
import { victoryPoints, type GameState } from './game'
import { damageLevel, structureRemaining, structureTotal, type ShipState } from './shipState'

/**
 * The battle, summed up: who holds the field, the score, and what each hull
 * did and suffered — the screen a table of players looks over when the last
 * volley lands, and the numbers a campaign record wants to keep.
 *
 * Everything here is derived; nothing is tracked. The status and score come
 * from the game state, and the deeds come from the battle log, read the same
 * way the AI's observer already reads it (volleys and damage cards are logged
 * in a fixed shape). One caveat inherited from that approach: a ship renamed
 * mid-battle keeps only the deeds logged under its current name.
 */

export interface ShipTally {
  id: string
  name: string
  formName: string
  side: string
  /** 'fighting' | 'destroyed' | 'disengaged' | 'captured' */
  status: string
  structureLeft: number
  structureTotal: number
  damage: string
  /** Volleys this ship fired, per the log. */
  volleys: number
  /** Total standard damage those volleys rolled, before shields and armor. */
  damageRolled: number
  /** Damage cards drawn against this ship. */
  cardsTaken: number
}

export interface SideTally {
  side: string
  points: number
  /** Fleet condition, 1 untouched to -1 wrecked (battleScore.health). */
  health: number
  ships: ShipTally[]
}

export interface VolleyRecord {
  attacker: string
  target: string
  damage: number
}

export interface BattleSummary {
  rounds: number
  /** One side (or none) has anything left to fight with. */
  over: boolean
  /** The headline, written for the top of the screen. */
  outcome: string
  sides: SideTally[]
  biggestVolley: VolleyRecord | null
  totalVolleys: number
  totalCards: number
}

/** `X fires on Y at effective range … → N damage` — combat.ts's fire line. */
const FIRE_LINE = /^(.+) fires on (.+) at effective range .+→ (\d+) damage/
/** `X: N internal + M leak = K damage card(s)` — damage.ts's card line. */
const CARDS_LINE = /^(.+): \d+ internal \+ \d+ leak = (\d+) damage cards?$/

function statusOf(ship: ShipState): string {
  if (ship.destroyed) return 'destroyed'
  if (ship.disengaged) return 'disengaged'
  if (ship.capturedBy) return `captured by ${ship.capturedBy}`
  // Before 'fighting', because a derelict is anything but: it drifts, gives
  // no orders, and used to be reported as the nonsense "destroyed damage" —
  // and, worse, counted as a reason the battle was still in progress.
  if (ship.derelict) return 'derelict'
  return 'fighting'
}

/** Still able to fight: on the map, under its own flag, with a crew answering. */
function fighting(ship: ShipState): boolean {
  return !ship.destroyed && !ship.disengaged && !ship.capturedBy && !ship.derelict
}

export function battleSummary(game: GameState): BattleSummary {
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const points = victoryPoints(game)

  // The deeds, mined from the log by ship name.
  const volleys = new Map<string, number>()
  const rolled = new Map<string, number>()
  const cards = new Map<string, number>()
  let biggest: VolleyRecord | null = null
  for (const entry of game.log) {
    const fire = FIRE_LINE.exec(entry.message)
    if (fire) {
      const [, attacker, target, damage] = fire
      volleys.set(attacker, (volleys.get(attacker) ?? 0) + 1)
      rolled.set(attacker, (rolled.get(attacker) ?? 0) + Number(damage))
      if (!biggest || Number(damage) > biggest.damage) {
        biggest = { attacker, target, damage: Number(damage) }
      }
      continue
    }
    const drawn = CARDS_LINE.exec(entry.message)
    if (drawn) cards.set(drawn[1], (cards.get(drawn[1]) ?? 0) + Number(drawn[2]))
  }

  const tallies: SideTally[] = sides.map((side) => ({
    side,
    points: points[side] ?? 0,
    health: Math.round(health(game, side) * 100) / 100,
    ships: game.ships
      .filter((s) => s.side === side)
      .map((ship) => ({
        id: ship.id,
        name: ship.name,
        formName: ship.form.name,
        side,
        status: statusOf(ship),
        structureLeft: structureRemaining(ship),
        structureTotal: structureTotal(ship),
        damage: ship.destroyed ? 'destroyed' : damageLevel(ship),
        volleys: volleys.get(ship.name) ?? 0,
        damageRolled: rolled.get(ship.name) ?? 0,
        cardsTaken: cards.get(ship.name) ?? 0,
      })),
  }))

  const standing = sides.filter((side) =>
    game.ships.some((s) => s.side === side && fighting(s)),
  )
  const over = sides.length > 1 && standing.length <= 1

  // The headline. Points settle arguments; the field settles the battle.
  let outcome: string
  const ranked = [...tallies].sort((a, b) => b.points - a.points)
  const lead = ranked[0]
  const tied = ranked.length > 1 && ranked[1].points === lead.points
  if (!over) {
    outcome = tied
      ? `Battle in progress — level on points.`
      : `Battle in progress — ${lead.side} leads on points.`
  } else if (standing.length === 0) {
    outcome = 'Mutual destruction. Nobody holds the field.'
  } else {
    const field = standing[0]
    outcome =
      tied || field === lead.side
        ? `${field} holds the field.`
        : `${field} holds the field — but ${lead.side} wins on points.`
  }

  return {
    rounds: game.round,
    over,
    outcome,
    sides: tallies,
    biggestVolley: biggest,
    totalVolleys: [...volleys.values()].reduce((a, b) => a + b, 0),
    totalCards: [...cards.values()].reduce((a, b) => a + b, 0),
  }
}
