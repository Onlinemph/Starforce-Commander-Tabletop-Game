import { applyAction, type ActionOutcome, type GameAction } from '../engine/actions'
import type { GameState } from '../engine/game'
import type { Point } from '../engine/types'

/**
 * Battle visuals, derived from the action stream.
 *
 * Nothing here touches the rules. Every volley is already a journaled action
 * with a full outcome, so the flash of a phaser strike is a pure function of
 * (game, action, outcome) — which means the same fire renders for the local
 * player, the AI, the remote opponent, and the replay theater, all from the
 * one derivation. Effects are cosmetic and ephemeral; they are never saved.
 */

export type WeaponFx = 'phaser' | 'torpedo' | 'disruptor' | 'generic'

export type BattleFx =
  | {
      id: number
      kind: 'shot'
      weapon: WeaponFx
      from: Point
      to: Point
      /** ms after the batch lands that this shot begins. */
      delay: number
    }
  | {
      id: number
      kind: 'impact'
      impact: 'shield' | 'hull'
      at: Point
      delay: number
    }

/** How a weapon looks in flight, read off its printed name. */
export function weaponFx(name: string): WeaponFx {
  const n = name.toUpperCase()
  if (n.includes('PHASER') || n.includes('LASER')) return 'phaser'
  if (n.includes('TORPEDO') || n.includes('MISSILE')) return 'torpedo'
  if (n.includes('DISRUPTOR')) return 'disruptor'
  return 'generic'
}

/** Stagger between shots of one volley, and a shot's flight time (ms). */
const STAGGER = 140
const TRAVEL = 380

let nextId = 1

/** Parallel mounts offset sideways a touch, so a broadside reads as one. */
function offsetShot(from: Point, to: Point, lane: number): { from: Point; to: Point } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const px = (-dy / len) * 0.22 * lane
  const py = (dx / len) * 0.22 * lane
  return { from: { x: from.x + px, y: from.y + py }, to: { x: to.x + px, y: to.y + py } }
}

/**
 * Effects that need the board as it stood *before* the action lands — point
 * defense targets and impacting homing counters are removed by resolution.
 */
export function fxBefore(game: GameState, action: GameAction): BattleFx[] {
  if (action.type === 'fire-small-target') {
    const attacker = game.ships.find((s) => s.id === action.attackerId)
    const target =
      game.homing.find((h) => h.id === action.targetId) ??
      game.smallCraft.find((c) => c.id === action.targetId)
    if (!attacker || !target) return []
    const weapon = attacker.form.weapons.find((w) => w.id === action.weaponId)
    return [
      {
        id: nextId++,
        kind: 'shot',
        weapon: weapon ? weaponFx(weapon.name) : 'phaser',
        from: attacker.placement.position,
        to: target.position,
        delay: 0,
      },
      { id: nextId++, kind: 'impact', impact: 'hull', at: target.position, delay: TRAVEL },
    ]
  }

  if (action.type === 'resolve-homing-impacts') {
    const ship = game.ships.find((s) => s.id === action.shipId)
    if (!ship) return []
    const arrived = game.homing.filter(
      (h) => h.targetId === ship.id && h.impacted && !h.destroyed,
    )
    const fx: BattleFx[] = arrived.map((h, i) => ({
      id: nextId++,
      kind: 'shot',
      weapon: 'torpedo',
      from: h.position,
      to: ship.placement.position,
      delay: i * STAGGER,
    }))
    if (arrived.length > 0) {
      fx.push({
        id: nextId++,
        kind: 'impact',
        impact: 'hull',
        at: ship.placement.position,
        delay: (arrived.length - 1) * STAGGER + TRAVEL,
      })
    }
    return fx
  }

  return []
}

/** Hull if anything got through, shield if the screens took it all. */
function impactKind(dealt: {
  internal: number
  leakCards: number
  structureFromSpecial: number
  greenAbsorbed: number
  blueAbsorbed: number
  armorAbsorbed: number
}): 'hull' | 'shield' | null {
  const throughShields = dealt.internal + dealt.leakCards + dealt.structureFromSpecial
  const absorbed = dealt.greenAbsorbed + dealt.blueAbsorbed + dealt.armorAbsorbed
  return throughShields > 0 ? 'hull' : absorbed > 0 ? 'shield' : null
}

/** Effects read off a resolved outcome — the volley, above all. */
export function fxAfter(game: GameState, action: GameAction, outcome: ActionOutcome): BattleFx[] {
  const fx: BattleFx[] = []

  if (action.type === 'fire-volley' && outcome.volley) {
    const attacker = game.ships.find((s) => s.id === action.attackerId)
    const target = game.ships.find((s) => s.id === action.targetId)
    if (attacker && target) {
      const { records, outcome: dealt } = outcome.volley
      records.forEach((record, i) => {
        const lane = i - (records.length - 1) / 2
        const { from, to } = offsetShot(attacker.placement.position, target.placement.position, lane)
        fx.push({
          id: nextId++,
          kind: 'shot',
          weapon: weaponFx(record.weaponName),
          from,
          to,
          delay: i * STAGGER,
        })
      })

      // A tied volley's damage is held (H2.4.2): the shots fly now, and the
      // impact arrives with the flush below — possibly on a later action.
      const impact = dealt ? impactKind(dealt) : null
      if (impact && records.length > 0) {
        fx.push({
          id: nextId++,
          kind: 'impact',
          impact,
          at: target.placement.position,
          delay: (records.length - 1) * STAGGER + TRAVEL,
        })
      }
    }
  }

  // Held volleys landing together: every impact flashes at once, which is
  // exactly what simultaneous damage should look like.
  for (const landed of outcome.flushed ?? []) {
    const target = game.ships.find((s) => s.id === landed.targetId)
    const impact = impactKind(landed.outcome)
    if (!target || !impact) continue
    fx.push({ id: nextId++, kind: 'impact', impact, at: target.placement.position, delay: TRAVEL })
  }

  return fx
}

/**
 * Advance a replay's cached game forward, deriving the fire drawn on the way.
 *
 * Any forward jump — auto-play's single step, the recorder's stop-to-stop
 * stride, a short scrub — is a replay of the actions in between, so their
 * effects are derived exactly as the live table derived them. The theater
 * used to do this only for single steps; every bigger jump rebuilt from
 * scratch and dropped the effects, which is why exported videos had no
 * weapon fire in them: the volley's own action was always the far side of a
 * stop-to-stop jump.
 *
 * Only the last `fxTail` actions of the jump speak. Scrubbing three hundred
 * actions ahead should not land every volley in between at once — but every
 * shot near where the playhead comes to rest still fires.
 */
export function fxAcross(
  game: GameState,
  actions: GameAction[],
  from: number,
  to: number,
  fxTail = 6,
): BattleFx[] {
  const fx: BattleFx[] = []
  for (let i = from; i < to; i++) {
    const action = actions[i]
    const pre = fxBefore(game, action)
    const outcome = applyAction(game, action)
    if (to - i <= fxTail) fx.push(...pre, ...fxAfter(game, action, outcome))
  }
  return fx
}
