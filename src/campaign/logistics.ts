/**
 * Repair — slow, prioritized, and honest about what a yard is for (3.2).
 *
 * Two speeds by the designer's own note: system boxes are burnouts a crew
 * rewires; red structure boxes are physical damage. Underway a crew fixes one
 * system box a round and no structure at all. A colony fixes three systems a
 * round and one structure box every OTHER round; a fleet base's yard fixes
 * six and one. (These are the campaign repair limits the rulebook defers at
 * B3.5 — the README lists that rule as waiting for a campaign layer; this is
 * the campaign layer.)
 *
 * The player's lever is the priority queue: categories fixed first, in order,
 * set per unit by an ordinary intervention. The tick spends its budget down
 * the queue deterministically — no rng, so replay needs no draws here.
 */

import { shipFormById } from '../data/ships'
import { hexEquals } from './hexmap'
import { scarsAreEmpty, type ShipScars } from '../engine/shipState'
import {
  DEFAULT_REPAIR_QUEUE,
  type CampaignState,
  type RepairCategory,
  type ShipRecord,
  type Unit,
} from './types'

/** Hit points still marked on a scar record: internal once, structure double. */
export function scarHp(scars: ShipScars): number {
  const internal =
    Object.values(scars.reactors).reduce((n, g) => n + g.reduce((a, b) => a + b, 0), 0) +
    scars.batteries.filter(Boolean).length +
    scars.ftl +
    scars.scout +
    scars.shieldGenerator +
    Object.values(scars.systems).reduce((n, d) => n + d, 0) +
    Object.values(scars.mounts).reduce((n, g) => n + g.reduce((a, b) => a + b, 0), 0)
  return internal + 2 * scars.structure
}

/** Fraction of a hull's boxes marked, for the 3.2 operational bands. */
export function damageFraction(record: ShipRecord): number {
  if (!record.scars) return 0
  const form = shipFormById(record.formId)
  if (!form) return 0
  const internal =
    form.reactors.reduce((n, g) => n + g.points.reduce((b, p) => b + p.boxes, 0), 0) +
    form.batteries +
    form.ftlDriveBoxes +
    form.sublight.driveBoxes +
    form.systems.reduce((n, g) => n + g.boxes, 0) +
    form.weapons.reduce((n, w) => n + w.mounts.reduce((b, m) => b + m.hitBoxes, 0), 0) +
    (form.scoutSensor?.damageBoxes ?? 0) +
    form.shields.generatorBoxes
  const structure = form.structure.filter((e) => e.kind === 'box').length
  const total = internal + 2 * structure
  return total > 0 ? scarHp(record.scars) / total : 0
}

export type DamageBand = 'fresh' | 'damaged' | 'crippled'

/** Fresh under a quarter gone; crippled past sixty percent (3.2). */
export function damageBand(record: ShipRecord): DamageBand {
  const f = damageFraction(record)
  if (f > 0.6) return 'crippled'
  if (f >= 0.25) return 'damaged'
  return 'fresh'
}

/** The worst band aboard is the unit's band — one limping hull slows the flag. */
export function unitDamageBand(unit: Unit): DamageBand {
  let worst: DamageBand = 'fresh'
  for (const ship of unit.ships) {
    const band = damageBand(ship)
    if (band === 'crippled') return 'crippled'
    if (band === 'damaged') worst = 'damaged'
  }
  return worst
}

/** Where a unit ends the round decides its repair rate (3.2, 3.4). */
export type Berth = 'underway' | 'colony' | 'yard'

export function berthOf(state: CampaignState, unit: Unit): Berth {
  for (const infra of state.infrastructure) {
    if (infra.destroyed || infra.side !== unit.side) continue
    if (!hexEquals(infra.hex, unit.hex)) continue
    if (infra.kind === 'fleet-base') return 'yard'
    if (infra.kind === 'colony') return 'colony'
  }
  return 'underway'
}

/** Which categories a scar field belongs to, for the queue. */
function categoryTargets(scars: ShipScars, category: RepairCategory): Array<() => void> {
  const fixes: Array<() => void> = []
  // One fix per BOX, not per damaged slot: the budget is boxes a round (3.2),
  // and a mount with two hits takes two of them.
  const perBox = (count: number, fix: () => void) => {
    for (let i = 0; i < count; i++) fixes.push(fix)
  }
  const dec = (obj: Record<string, number>, key: string) => () => {
    obj[key] -= 1
  }
  switch (category) {
    case 'drive':
      perBox(scars.ftl, () => (scars.ftl -= 1))
      perBox(scars.systems['__sublight'] ?? 0, dec(scars.systems, '__sublight'))
      break
    case 'shields':
      perBox(scars.shieldGenerator, () => (scars.shieldGenerator -= 1))
      break
    case 'weapons':
      for (const [id, group] of Object.entries(scars.mounts).sort(([a], [b]) => (a < b ? -1 : 1))) {
        group.forEach((d, i) => perBox(d, () => (scars.mounts[id][i] -= 1)))
      }
      break
    case 'sensors':
      perBox(scars.systems['SENS'] ?? 0, dec(scars.systems, 'SENS'))
      perBox(scars.scout, () => (scars.scout -= 1))
      break
    case 'systems':
      // Everything the named categories don't claim, in a fixed order.
      for (const key of Object.keys(scars.systems).sort()) {
        if (key === 'SENS' || key === '__sublight') continue
        perBox(scars.systems[key], dec(scars.systems, key))
      }
      for (const [id, group] of Object.entries(scars.reactors).sort(([a], [b]) => (a < b ? -1 : 1))) {
        group.forEach((d, i) => perBox(d, () => (scars.reactors[id][i] -= 1)))
      }
      scars.batteries.forEach((broken, i) => {
        if (broken) fixes.push(() => (scars.batteries[i] = false))
      })
      // Armor is plate, not wiring: it repairs with structure, below.
      break
    case 'structure':
      break // structure has its own budget; handled by the tick directly
  }
  return fixes
}

/**
 * The round tick's repair pass (3.2). System boxes spend the berth's budget
 * down the unit's queue; structure repairs on its own slower clock, and armor
 * plate rides with it. A ship with no scars costs nothing.
 */
export function repairTick(state: CampaignState): void {
  for (const unit of state.units) {
    const berth = berthOf(state, unit)
    const queue = unit.order.repairPriority ?? [...DEFAULT_REPAIR_QUEUE]
    for (const ship of unit.ships) {
      if (!ship.scars) continue
      let budget = berth === 'yard' ? 6 : berth === 'colony' ? 3 : 1
      for (const category of queue) {
        if (budget <= 0) break
        if (category === 'structure') continue
        for (const fix of categoryTargets(ship.scars, category)) {
          if (budget <= 0) break
          fix()
          budget -= 1
        }
      }
      // Red boxes: never underway; one a round at a yard; one every second
      // round at a colony (the even rounds, deterministically).
      const structureBudget =
        berth === 'yard' ? 1 : berth === 'colony' && state.round % 2 === 0 ? 1 : 0
      if (structureBudget > 0 && ship.scars.structure > 0) {
        ship.scars.structure -= 1
        // Plate comes off the same crews: one armor face per structure box.
        for (const face of ['F', 'S', 'A', 'P'] as const) {
          if (ship.scars.armor[face] > 0) {
            ship.scars.armor[face] -= 1
            break
          }
        }
      }
      if (scarsAreEmpty(ship.scars)) delete ship.scars
    }
  }
}
