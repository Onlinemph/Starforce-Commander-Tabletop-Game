import type { GameAction } from './actions'
import { firingOrder, selectBracket } from './combat'
import {
  asteroidFieldsAt,
  cloakOf,
  cloudStatus,
  shipsUnderBoarding,
  tacticalScanOf,
  terrainObstacles,
  type GameState,
} from './game'
import { isCloaked } from './cloaking'
import {
  armingPointsAvailable,
  powerRemaining,
  repairTargets,
  type RepairCategory,
} from './engineering'
import {
  actualRange,
  effectiveRange,
  arcTo,
  canBearOn,
  hasLineOfSight,
  headingVector,
  relativeBearing,
} from './geometry'
import { disengagementOptions, plannedMovement, validatePlot, accelerationBudget } from './navigation'
import {
  armingCapacityThisRound,
  currentMaxSpeed,
  damageControlRating,
  damageLevel,
  lineValue,
  maxReverseSpeed,
  mountIsReady,
  sensorFunctionCap,
  type ShipState,
} from './shipState'
import { boardingSides } from './boarding'
import type { CommandCard, Maneuver, TurnDirection } from './types'

/**
 * A computer opponent, as a captain of sound doctrine rather than deep search.
 *
 * The AI is a pure function of game state: given the game and the sides it
 * commands, it returns the actions it owes right now. The store dispatches
 * them through the same journal as a human's clicks — so saves, undo, replay
 * and remote play treat an AI's orders exactly like anyone else's, and the AI
 * itself never needs to be re-run to reconstruct a battle.
 *
 * Honesty: decisions read only what a human opponent could see across the
 * table — positions, headings, speeds, announced shield states, damage levels
 * — plus the AI's own ships in full. It never reads an enemy's form, power
 * allocation or arming.
 *
 * Idempotence: planning duties (allocation, plotting) compare the computed
 * plan against the ship's current state and emit only differences, so being
 * asked twice does nothing twice. Dice-rolling duties (damage control,
 * boarding) are guarded by a per-segment memo.
 */

export interface AiMemo {
  done: Set<string>
}

export function createAiMemo(): AiMemo {
  return { done: new Set() }
}

/** Ships the AI commands that are still in the fight. */
function ownShips(game: GameState, sides: string[]): ShipState[] {
  return game.ships.filter(
    (s) => sides.includes(s.side) && !s.destroyed && !s.disengaged && !s.derelict && !s.capturedBy,
  )
}

function enemiesOf(game: GameState, ship: ShipState): ShipState[] {
  return game.ships.filter((s) => s.side !== ship.side && !s.destroyed && !s.disengaged)
}

/**
 * Everything the AI owes right now. `closing` is set when the human is about
 * to complete the segment: any duty that was waiting its turn (a firing slot
 * later in the Tactical Scan order) is settled immediately so the segment
 * never ends with the AI's guns silent.
 */
export function aiNextActions(
  game: GameState,
  sides: string[],
  memo: AiMemo,
  closing = false,
): GameAction[] {
  const fleet = ownShips(game, sides)
  if (fleet.length === 0) return []

  switch (game.segment) {
    case 'resource-allocation':
      return planAllocation(game, fleet, memo)
    case 'damage-control':
      return planDamageControl(game, fleet, memo)
    case 'command':
      return planOrders(game, fleet)
    case 'combat':
      return planFiring(game, fleet, memo, closing)
    case 'boarding-combat':
      return planBoarding(game, sides, memo)
    case 'disengagement':
      return planDisengagement(game, fleet)
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Resource Allocation (B2): weapons first, then eyes, then legs
// ---------------------------------------------------------------------------

function planAllocation(game: GameState, fleet: ShipState[], memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []

  for (const ship of fleet) {
    let budget = powerRemaining(ship)

    /**
     * Fill a line to `circles`, if the difference is affordable. Each exact
     * request is attempted once — a refusal the doctrine did not foresee
     * (B2 has many) must not become an argument held every render.
     */
    const fill = (lineId: string, circles: number) => {
      const line = ship.form.functions.find((l) => l.id === lineId)
      if (!line) return
      const current = ship.allocation[line.id] ?? 0
      const target = Math.min(circles, line.steps.length)
      if (target <= current) return
      const attemptKey = `alloc:${game.round}:${ship.id}:${line.id}:${target}`
      if (memo.done.has(attemptKey)) return
      const cost = line.steps
        .slice(current, target)
        .reduce((sum, step) => sum + step.powerCost, 0)
      if (cost > budget) return
      budget -= cost
      memo.done.add(attemptKey)
      actions.push({ type: 'allocate', shipId: ship.id, lineId: line.id, circles: target })
    }

    const byKind = (kind: string) => ship.form.functions.filter((l) => l.kind === kind)

    /** Power for a dead battery is power wasted (and B2.2.7 refuses it). */
    const weaponAlive = (line: { weaponSystemId?: string }) => {
      const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)
      if (!weapon) return false
      return weapon.mounts.some((_, i) => {
        const state = ship.mounts[weapon.id][i]
        return state.damage < weapon.mounts[i].hitBoxes
      })
    }

    // Weapons full — the auto-arm rule then spends the points (E4.2.2).
    for (const line of byKind('weapon')) if (weaponAlive(line)) fill(line.id, line.steps.length)
    // The special line powers a scout sensor block or a cloak; cloak doctrine
    // is not this captain's yet, but scout sensors earn their power.
    for (const line of byKind('sensor')) fill(line.id, Math.min(2, line.steps.length))
    for (const line of byKind('accel')) fill(line.id, 1)
    if (ship.stressMarkers > 0) for (const line of byKind('sif')) fill(line.id, 1)
    // A damaged shield is worth a repair point (G1.3.3).
    for (const line of byKind('shield-repair')) {
      if (!line.shieldSide) continue
      if (ship.blueShieldDamage[line.shieldSide] > 0) fill(line.id, 1)
    }
    // Spare change: deeper sensors, then a second acceleration point.
    for (const line of byKind('sensor')) fill(line.id, line.steps.length)
    for (const line of byKind('accel')) fill(line.id, 2)
  }

  if (actions.length > 0) return actions

  // Second pass, after the allocations landed: any arming points the auto-arm
  // rule could not place (scarce power) are spent round-robin.
  const key = `ra-arm:${game.round}:${fleet[0].side}`
  if (memo.done.has(key)) return []
  memo.done.add(key)

  const arming: GameAction[] = []
  for (const ship of fleet) {
    for (const weapon of ship.form.weapons) {
      let points = armingPointsAvailable(ship, weapon.id)
      let index = 0
      let guard = 0
      while (points > 0 && guard++ < 60) {
        const mount = index % weapon.mounts.length
        const state = ship.mounts[weapon.id][mount]
        if (armingCapacityThisRound(weapon, mount, state) > 0) {
          arming.push({ type: 'arm-mount', shipId: ship.id, weaponId: weapon.id, mountIndex: mount })
          points -= 1
        }
        index += 1
        if (index > weapon.mounts.length * 8) break
      }
    }
  }
  return arming
}

// ---------------------------------------------------------------------------
// Damage Control (B3.2): guns before hull
// ---------------------------------------------------------------------------

const REPAIR_PRIORITY: RepairCategory[] = ['weapons', 'engineering', 'systems', 'shields', 'structure']

function planDamageControl(game: GameState, fleet: ShipState[], memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []
  for (const ship of fleet) {
    const key = `dc:${game.round}:${ship.id}`
    if (memo.done.has(key)) continue
    memo.done.add(key)

    const budget = damageControlRating(ship)
    const targets = repairTargets(ship)
    if (budget === 0 || targets.length === 0) continue

    const present = REPAIR_PRIORITY.filter((c) => targets.some((t) => t.category === c))
    const assignments = present.slice(0, 2).map((category, i) => ({
      category,
      dice: i === 0 ? Math.max(1, budget - (present.length > 1 ? 1 : 0)) : 1,
      targetKey: targets.find((t) => t.category === category)!.key,
    }))
    if (assignments.length > 0) {
      actions.push({ type: 'damage-control', shipId: ship.id, assignments })
    }
  }
  return actions
}

// ---------------------------------------------------------------------------
// Command (C1): close to the guns' best range, keep the bow on the enemy
// ---------------------------------------------------------------------------

/** The range this ship's heaviest battery most wants to fight at. */
function preferredRange(ship: ShipState): number {
  let best = 6
  let bestWeight = 0
  for (const weapon of ship.form.weapons) {
    const green = [...weapon.brackets].reverse().find((b) => b.band === 'green')
    if (!green) continue
    const weight = weapon.mounts.length * green.dice.length
    if (weight > bestWeight) {
      bestWeight = weight
      best = (green.min + green.max) / 2
    }
  }
  return best
}

interface Candidate {
  maneuver: Maneuver
  direction: TurnDirection | null
  accel: number
}

function planOrders(game: GameState, fleet: ShipState[]): GameAction[] {
  const actions: GameAction[] = []

  for (const ship of fleet) {
    const card = game.orders[ship.id]
    if (!card) continue
    const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
    const enemy = nearest(ship, enemies)

    const plan = enemy ? bestPlot(game, ship, card, enemy) : { maneuver: 'straight' as Maneuver, direction: null, accel: 0 }
    if (card.maneuver !== plan.maneuver || card.direction !== plan.direction) {
      actions.push({ type: 'plot-maneuver', shipId: ship.id, maneuver: plan.maneuver, direction: plan.direction })
    }
    if (card.accel !== plan.accel) {
      actions.push({ type: 'plot-accel', shipId: ship.id, delta: plan.accel - card.accel })
    }

    // Sensor split (H2.2.2): targeting first, then tactical scan, then jamming.
    const sensorLine = ship.form.functions.find((l) => l.kind === 'sensor')
    const available = sensorLine ? lineValue(ship, sensorLine.id) : 0
    const cap = sensorFunctionCap(ship)
    const targeting = Math.min(cap, Math.ceil(available / 2))
    const tacticalScan = Math.min(cap, available - targeting)
    const jamming = Math.min(cap, available - targeting - tacticalScan)
    const want = { targeting, tacticalScan, jamming } as const
    for (const k of ['targeting', 'tacticalScan', 'jamming'] as const) {
      if (card.sensors[k] !== want[k]) {
        actions.push({ type: 'plot-sensor', shipId: ship.id, key: k, value: want[k] })
      }
    }
  }
  return actions
}

function positionHidden(game: GameState, ship: ShipState): boolean {
  const cloak = cloakOf(game, ship)
  return Boolean(cloak && isCloaked(cloak))
}

function nearest(ship: ShipState, enemies: ShipState[]): ShipState | null {
  let best: ShipState | null = null
  let bestDist = Infinity
  for (const e of enemies) {
    const d = actualRange(ship.placement.position, e.placement.position)
    if (d < bestDist || (d === bestDist && best && e.id < best.id)) {
      best = e
      bestDist = d
    }
  }
  return best
}

function bestPlot(game: GameState, ship: ShipState, card: CommandCard, enemy: ShipState): Candidate {
  const ideal = preferredRange(ship)
  // Assume the enemy holds course — the same guess a human plotter makes.
  const ev = headingVector(enemy.placement.heading)
  const predicted = {
    x: enemy.placement.position.x + ev.x * enemy.speed,
    y: enemy.placement.position.y + ev.y * enemy.speed,
  }

  const maneuvers: Array<[Maneuver, TurnDirection | null, number]> = [
    ['straight', null, 0],
    ['easy', 'left', 0],
    ['easy', 'right', 0],
    ['standard', 'left', 0],
    ['standard', 'right', 0],
    ['hard', 'left', 1],
    ['hard', 'right', 1],
  ]
  const accelBudget = accelerationBudget(ship) - ship.accelUsedThisRound
  const accels = [-2, -1, 0, 1, 2].filter((a) => {
    if (Math.abs(a) > ship.form.sublight.maxAccelPerPhase) return false
    if (Math.abs(a) > accelBudget) return false
    const speed = ship.speed + a
    return speed <= currentMaxSpeed(ship) && speed >= -maxReverseSpeed(ship)
  })

  let best: Candidate = { maneuver: 'straight', direction: null, accel: 0 }
  let bestScore = -Infinity

  for (const [maneuver, direction, stressCost] of maneuvers) {
    // Stress the ship cannot cancel is a real cost; near the rating, avoid it.
    if (stressCost > 0 && ship.stressMarkers + stressCost >= ship.form.stressRating) continue
    for (const accel of accels) {
      const candidate: CommandCard = {
        maneuver,
        direction,
        accel,
        speed: ship.speed + accel,
        sensors: card.sensors,
        shieldsDown: [],
      }
      // A plot the rules would refuse outright is not a plan.
      if (validatePlot(ship, candidate).some((e) => !e.fallbackToStraight)) continue
      const planned = plannedMovement(ship, candidate)
      if (planned.illegal) continue

      const end = planned.end
      const range = actualRange(end.position, predicted)
      let score = -Math.abs(range - ideal)

      // Keep the bow on the enemy so the forward batteries bear.
      const bearing = relativeBearing(end.position, end.heading, predicted)
      if (bearing < 45 || bearing > 315) score += 2.5
      else if (bearing < 90 || bearing > 270) score += 1

      score -= planned.stress * 1.5

      // The board edge is disengagement (S2.2.1) — do not back into it.
      const { width, height } = game.scenario.bounds
      if (end.position.x < 2 || end.position.y < 2 || end.position.x > width - 2 || end.position.y > height - 2) {
        score -= 8
      }

      // Rocks tear hulls above the safe speed (K2.1.6).
      for (const p of planned.path) {
        const over = Math.abs(candidate.speed)
        const fields = asteroidFieldsAt(game.scenario.terrain, p)
        for (const f of fields) {
          if (over > (f.safeSpeed ?? 99)) score -= 3 * (over - (f.safeSpeed ?? 0))
        }
        if (fields.length > 0) break
      }

      if (score > bestScore) {
        bestScore = score
        best = { maneuver, direction, accel }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Combat (E6.2): fire in Tactical Scan order, focus the hurt
// ---------------------------------------------------------------------------

function planFiring(game: GameState, fleet: ShipState[], memo: AiMemo, closing: boolean): GameAction[] {
  // Coordinated Fire (H4) has its own strict step machine; this captain plays
  // the base game's sequence and simply passes under H4 rather than misfire.
  if (game.coordinatedFire) {
    if (!closing) return []
    return fleet
      .filter((s) => !game.firedThisSegment.has(s.id))
      .map((s) => ({ type: 'pass-fire', shipId: s.id }) as GameAction)
  }

  const unfired = fleet.filter((s) => !game.firedThisSegment.has(s.id))
  if (unfired.length === 0) return []

  let due: ShipState[]
  if (closing) {
    due = unfired
  } else {
    // The first group with anyone left to fire is up (E6.2). AI ships in that
    // group fire now; if the slot belongs to the human, wait for them.
    const groups = firingOrder(game.ships, (s) => tacticalScanOf(game, s))
    const current = groups.find((g) => g.some((s) => !game.firedThisSegment.has(s.id)))
    due = current ? current.filter((s) => unfired.includes(s)) : []
  }

  const actions: GameAction[] = []
  for (const ship of due) {
    // One attempt per ship per segment: if a volley came back refused for a
    // reason doctrine did not foresee, pass rather than argue in a loop.
    const attemptKey = `vol:${game.round}:${game.phase}:${ship.id}`
    if (memo.done.has(attemptKey) || positionHidden(game, ship)) {
      actions.push({ type: 'pass-fire', shipId: ship.id })
      continue
    }
    const volley = bestVolley(game, ship)
    if (volley) {
      memo.done.add(attemptKey)
      actions.push(volley)
    } else {
      actions.push({ type: 'pass-fire', shipId: ship.id })
    }
  }
  return actions
}

function bestVolley(game: GameState, ship: ShipState): GameAction | null {
  const obstacles = terrainObstacles(game.scenario.terrain)
  let best: { targetId: string; mounts: Array<{ weaponId: string; mountIndex: number }>; score: number } | null = null

  for (const enemy of enemiesOf(game, ship)) {
    if (positionHidden(game, enemy)) continue
    if (!hasLineOfSight(ship.placement.position, enemy.placement.position, obstacles)) continue

    const arcs = arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position)
    const actual = actualRange(ship.placement.position, enemy.placement.position)
    const effective = effectiveRange(actual, enemy.sensors.jamming, ship.sensors.targeting)

    const mounts: Array<{ weaponId: string; mountIndex: number }> = []
    let score = 0
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, mountIndex) => {
        const state = ship.mounts[weapon.id][mountIndex]
        if (!mountIsReady(weapon, mountIndex, state)) return
        if (!canBearOn(mount.arcs, arcs)) return
        const bracket = selectBracket(weapon, effective, enemy.speed === 0)
        if (!bracket) return
        mounts.push({ weaponId: weapon.id, mountIndex })
        score += bracket.bracket.dice.length + (bracket.bracket.bonus ?? 0)
      })
    }
    if (mounts.length === 0) continue

    // Prefer finishing what is already burning.
    const level = damageLevel(enemy)
    score += level === 'crippled' ? 3 : level === 'heavy' ? 2 : level === 'moderate' ? 1 : 0

    if (!best || score > best.score || (score === best.score && enemy.id < best.targetId)) {
      best = { targetId: enemy.id, mounts, score }
    }
  }

  if (!best) return null
  return {
    type: 'fire-volley',
    attackerId: ship.id,
    targetId: best.targetId,
    mounts: best.mounts,
    mode: 'standard',
    degraded: false,
  }
}

// ---------------------------------------------------------------------------
// Final Phase: press boarding actions, save what cannot fight
// ---------------------------------------------------------------------------

function planBoarding(game: GameState, sides: string[], memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []
  for (const target of shipsUnderBoarding(game)) {
    for (const side of boardingSides(target)) {
      if (!sides.includes(side)) continue
      const key = `board:${game.round}:${target.id}:${side}`
      if (memo.done.has(key)) continue
      memo.done.add(key)
      actions.push({ type: 'fight-boarders', targetId: target.id, side })
    }
  }
  return actions
}

function planDisengagement(game: GameState, fleet: ShipState[]): GameAction[] {
  const actions: GameAction[] = []
  for (const ship of fleet) {
    if (damageLevel(ship) !== 'crippled') continue
    const enemies = enemiesOf(game, ship)
    const options = disengagementOptions(
      ship,
      enemies,
      game.scenario.bounds,
      !cloudStatus(game, ship).ftlBlocked,
    )
    if (options.length > 0) actions.push({ type: 'disengage', shipId: ship.id })
  }
  return actions
}
