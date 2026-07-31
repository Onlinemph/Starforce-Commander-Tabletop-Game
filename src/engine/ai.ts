import type { GameAction } from './actions'
import { firingOrder, selectBracket } from './combat'
import {
  asteroidFieldsAt,
  cloakOf,
  cloudStatus,
  impactingHoming,
  shipsUnderBoarding,
  tractorableHoming,
  tacticalScanOf,
  terrainObstacles,
  tractorBeamsFree,
  type GameState,
} from './game'
import { cloakFullyPowered, cloakOperational, isCloaked, mayDecloak } from './cloaking'
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
import { endurance, isHoming, speedInPhase } from './homing'
import { transportCapacity, transporterRange } from './operations'
import { SHIELD_SIDES } from './shipState'
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

/**
 * How sharp the captain is. Lower settings are not dumber doctrine so much as
 * a fallible officer: the ensign does not lead targets, sometimes takes the
 * second-best plot, shoots whatever is closest, and never touches the exotic
 * systems. The admiral uses everything the fleet carries.
 */
export type AiDifficulty = 'ensign' | 'captain' | 'admiral'

/**
 * Deterministic noise for the fallible officer: a hash of the decision point,
 * not a die roll — the game's RNG is never consumed, so a battle with an AI
 * rolls the same combat dice as one without, and replays stay exact.
 */
function jitter(...parts: Array<string | number>): number {
  const text = parts.join('|')
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
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
  difficulty: AiDifficulty = 'captain',
): GameAction[] {
  const fleet = ownShips(game, sides)
  if (fleet.length === 0) return []

  switch (game.segment) {
    case 'resource-allocation':
      return planAllocation(game, fleet, memo, difficulty)
    case 'damage-control':
      return planDamageControl(game, fleet, memo)
    case 'command':
      return planOrders(game, fleet, difficulty)
    case 'operations':
      return planOperations(game, fleet, memo, difficulty)
    case 'combat':
      return planFiring(game, fleet, memo, closing, difficulty)
    case 'boarding-combat':
      return planBoarding(game, sides, memo)
    case 'disengagement':
      return planDisengagement(game, fleet)
    default:
      return []
  }
}

/** Cloak doctrine (H6): vanish to cross the gulf or to nurse wounds. */
function wantsCloak(game: GameState, ship: ShipState, difficulty: AiDifficulty): boolean {
  if (difficulty === 'ensign' || !cloakOperational(ship)) return false
  const enemy = nearest(ship, enemiesOf(game, ship).filter((e) => !positionHidden(game, e)))
  const hurt = ['moderate', 'heavy', 'crippled'].includes(damageLevel(ship))
  const far = !enemy || actualRange(ship.placement.position, enemy.placement.position) > preferredRange(ship) + 8
  return hurt || far
}

// ---------------------------------------------------------------------------
// Resource Allocation (B2): weapons first, then eyes, then legs
// ---------------------------------------------------------------------------

function planAllocation(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  difficulty: AiDifficulty,
): GameAction[] {
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

    // A cloak is all or nothing (H6.3.1), and it comes before the guns it
    // will lock anyway (H6.4.2).
    if (wantsCloak(game, ship, difficulty)) {
      const cloakLine = ship.form.functions.find((l) => l.label === 'CLOAK')
      if (cloakLine) fill(cloakLine.id, cloakLine.steps.length)
    }
    // Weapons full — the auto-arm rule then spends the points (E4.2.2).
    for (const line of byKind('weapon')) if (weaponAlive(line)) fill(line.id, line.steps.length)
    // Scout sensors earn their power: they illuminate for the whole fleet (H3.4).
    if (difficulty !== 'ensign' && ship.form.scoutSensor) {
      const scoutLine = ship.form.functions.find(
        (l) => l.kind === 'special' && /SCOUT/i.test(l.label),
      )
      if (scoutLine) fill(scoutLine.id, scoutLine.steps.length)
    }
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
    // Scout sensors are assigned during Resource Allocation and hold for the
    // round (H3.2.2): first sensor illuminates the nearest enemy, the rest jam.
    if (ship.form.scoutSensor && ship.scoutAssignments.length > 0) {
      const enemy = nearest(ship, enemiesOf(game, ship).filter((e) => !positionHidden(game, e)))
      ship.scoutAssignments.forEach((assignment, index) => {
        const fn = index === 0 && enemy ? 'targeting' : 'jamming'
        const targetId = fn === 'targeting' ? (enemy?.id ?? null) : null
        if (assignment.function !== fn || assignment.targetId !== targetId) {
          arming.push({ type: 'scout-assign', shipId: ship.id, index, fn, targetId })
        }
      })
    }
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

function planOrders(game: GameState, fleet: ShipState[], difficulty: AiDifficulty): GameAction[] {
  const actions: GameAction[] = []

  for (const ship of fleet) {
    const card = game.orders[ship.id]
    if (!card) continue
    const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
    const enemy = nearest(ship, enemies)

    const plan = enemy ? bestPlot(game, ship, card, enemy, difficulty) : { maneuver: 'straight' as Maneuver, direction: null, accel: 0 }
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

function bestPlot(
  game: GameState,
  ship: ShipState,
  card: CommandCard,
  enemy: ShipState,
  difficulty: AiDifficulty,
): Candidate {
  const ideal = preferredRange(ship)
  // Assume the enemy holds course — the same guess a human plotter makes.
  // The ensign aims at where the enemy is, not where it will be.
  const ev = headingVector(enemy.placement.heading)
  const predicted =
    difficulty === 'ensign'
      ? enemy.placement.position
      : {
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
  let second: Candidate = best
  let secondScore = -Infinity

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
        second = best
        secondScore = bestScore
        bestScore = score
        best = { maneuver, direction, accel }
      } else if (score > secondScore) {
        secondScore = score
        second = { maneuver, direction, accel }
      }
    }
  }
  // The fallible officer: sometimes the second-best plot looked right.
  if (difficulty === 'ensign' && secondScore > -Infinity) {
    if (jitter('plot', game.round, game.phase, ship.id) < 0.4) return second
  }
  return best
}

// ---------------------------------------------------------------------------
// Operations (J1, H6): cloaks, searches, beams, and the marines' commute
// ---------------------------------------------------------------------------

function planOperations(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  difficulty: AiDifficulty,
): GameAction[] {
  const key = `ops:${game.round}:${game.phase}:${fleet[0].side}`
  if (memo.done.has(key)) return []
  memo.done.add(key)
  if (difficulty === 'ensign') return []

  const actions: GameAction[] = []
  for (const ship of fleet) {
    const cloak = cloakOf(game, ship)
    const cloaked = Boolean(cloak && isCloaked(cloak))
    const enemy = nearest(ship, enemiesOf(game, ship).filter((e) => !positionHidden(game, e)))
    const range = enemy ? actualRange(ship.placement.position, enemy.placement.position) : Infinity

    // Cloak doctrine (H6.6, H6.7): vanish while crossing or wounded; come out
    // shooting once the guns are in their bracket.
    if (cloak && !cloaked && cloakFullyPowered(ship) && wantsCloak(game, ship, difficulty)) {
      actions.push({ type: 'engage-cloak', shipId: ship.id })
    } else if (cloak && cloaked && mayDecloak(cloak)) {
      const hurt = ['moderate', 'heavy', 'crippled'].includes(damageLevel(ship))
      if (!hurt && range <= preferredRange(ship) + 2) {
        actions.push({ type: 'decloak', shipId: ship.id })
      }
    }

    // Hunt the ghosts: one search attempt per ship per phase (H6.9.2).
    if (!cloaked) {
      const ghost = enemiesOf(game, ship).find((e) => positionHidden(game, e))
      if (ghost) actions.push({ type: 'cloak-search', shipId: ship.id, ghostId: ghost.id })
    }

    // A missile in the tractor beam's reach is a missile that never lands (J3.2.2).
    if (game.homing.length > 0 && tractorBeamsFree(game, ship) > 0) {
      const missile = tractorableHoming(game, ship)[0]
      if (missile) {
        actions.push({ type: 'catch-missile', shipId: ship.id, homingId: missile.id, beams: 1 })
      }
    }

    // Assigned scout sensors switch on in step 2.E (H3.3.2).
    if (ship.form.scoutSensor) {
      ship.scoutAssignments.forEach((assignment, index) => {
        if (!assignment.active) {
          actions.push({ type: 'scout-active', shipId: ship.id, index, active: true })
        }
      })
    }

    if (difficulty !== 'admiral') continue

    // The admiral's tricks. A crippled enemy alongside is a prize: drag it
    // with the beams (J3), or drop shields and put the marines aboard (J5).
    const cripple = enemiesOf(game, ship).find(
      (e) => !positionHidden(game, e) && damageLevel(e) === 'crippled',
    )
    if (cripple) {
      const captureRange = actualRange(ship.placement.position, cripple.placement.position)
      const beams = tractorBeamsFree(game, ship)
      if (beams > 0 && captureRange <= 1) {
        actions.push({ type: 'tractor-lock', shipId: ship.id, targetId: cripple.id, beams })
      }
      if (
        !cloaked &&
        transportCapacity(ship) > 0 &&
        ship.marineSquads >= 2 &&
        captureRange <= transporterRange(ship, null)
      ) {
        // Beaming needs every own shield down (J5.1.3) — a risk worth a hull.
        for (const side of SHIELD_SIDES) {
          if (!ship.shieldsDown[side]) {
            actions.push({ type: 'set-shield-down', shipId: ship.id, side, down: true })
          }
        }
        actions.push({
          type: 'transport',
          shipId: ship.id,
          targetId: cripple.id,
          squads: Math.min(transportCapacity(ship), ship.marineSquads - 1),
        })
        continue
      }
    }

    // Housekeeping: shields dropped for last phase's business go back up.
    if (!cloaked) {
      for (const side of SHIELD_SIDES) {
        if (ship.shieldsDown[side]) {
          actions.push({ type: 'set-shield-down', shipId: ship.id, side, down: false })
        }
      }
    }
  }
  return actions
}

// ---------------------------------------------------------------------------
// Combat (E6.2): fire in Tactical Scan order, focus the hurt
// ---------------------------------------------------------------------------

function planFiring(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  closing: boolean,
  difficulty: AiDifficulty,
): GameAction[] {
  // Defensive duties come first, whoever holds the firing slot: incoming
  // homing weapons are shot at by the point defense (E12.4) and then resolved
  // (E5.4) — an unresolved impact would simply wait forever.
  const defensive: GameAction[] = []
  for (const ship of fleet) {
    const incoming = impactingHoming(game, ship)
    if (incoming.length === 0) continue
    const key = `pd:${game.round}:${game.phase}:${ship.id}`
    if (memo.done.has(key)) continue
    memo.done.add(key)

    if (difficulty !== 'ensign') {
      const used = new Set<string>()
      for (const hw of incoming) {
        const pd = readyPointDefenseMount(ship, used)
        if (!pd) break
        used.add(`${pd.weaponId}|${pd.mountIndex}`)
        defensive.push({
          type: 'fire-small-target',
          attackerId: ship.id,
          targetId: hw.id,
          weaponId: pd.weaponId,
          mountIndex: pd.mountIndex,
        })
      }
    }
    defensive.push({ type: 'resolve-homing-impacts', shipId: ship.id, pointDefense: {} })
  }
  if (defensive.length > 0) return defensive

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
    // Armed homing weapons go out first (E5.2): they fly on their own and the
    // direct-fire batteries still get their volley.
    if (difficulty !== 'ensign') actions.push(...homingLaunches(game, ship, memo))
    const volley = bestVolley(game, ship, difficulty)
    if (volley) {
      memo.done.add(attemptKey)
      actions.push(volley)
    } else {
      actions.push({ type: 'pass-fire', shipId: ship.id })
    }
  }
  return actions
}

/** A ready mount whose weapon carries a point-defense trait (E12.4.3). */
function readyPointDefenseMount(
  ship: ShipState,
  used: Set<string>,
): { weaponId: string; mountIndex: number } | null {
  for (const weapon of ship.form.weapons) {
    if (!weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))) continue
    for (let i = 0; i < weapon.mounts.length; i++) {
      if (used.has(`${weapon.id}|${i}`)) continue
      if (mountIsReady(weapon, i, ship.mounts[weapon.id][i])) {
        return { weaponId: weapon.id, mountIndex: i }
      }
    }
  }
  return null
}

/** Total distance a homing weapon covers over its whole endurance (E5.3). */
function totalFlight(weapon: Parameters<typeof endurance>[0]): number {
  let total = 0
  for (let phase = 1; phase <= endurance(weapon); phase++) total += speedInPhase(weapon, phase)
  return total
}

/** Launch every armed homing mount at the best target within flight range. */
function homingLaunches(game: GameState, ship: ShipState, memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []
  for (const weapon of ship.form.weapons.filter(isHoming)) {
    const reach = totalFlight(weapon)
    weapon.mounts.forEach((_, mountIndex) => {
      const key = `hl:${game.round}:${game.phase}:${ship.id}:${weapon.id}:${mountIndex}`
      if (memo.done.has(key)) return
      if (!mountIsReady(weapon, mountIndex, ship.mounts[weapon.id][mountIndex])) return
      const target = nearest(
        ship,
        enemiesOf(game, ship).filter(
          (e) =>
            !positionHidden(game, e) &&
            actualRange(ship.placement.position, e.placement.position) <= reach,
        ),
      )
      if (!target) return
      memo.done.add(key)
      actions.push({
        type: 'launch-homing',
        shipId: ship.id,
        weaponId: weapon.id,
        mountIndex,
        targetId: target.id,
      })
    })
  }
  return actions
}

function bestVolley(game: GameState, ship: ShipState, difficulty: AiDifficulty): GameAction | null {
  const obstacles = terrainObstacles(game.scenario.terrain)
  let best: {
    targetId: string
    mounts: Array<{ weaponId: string; mountIndex: number }>
    score: number
    allRed: boolean
    range: number
  } | null = null

  for (const enemy of enemiesOf(game, ship)) {
    if (positionHidden(game, enemy)) continue
    if (!hasLineOfSight(ship.placement.position, enemy.placement.position, obstacles)) continue

    const arcs = arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position)
    const actual = actualRange(ship.placement.position, enemy.placement.position)
    const effective = effectiveRange(actual, enemy.sensors.jamming, ship.sensors.targeting)

    const mounts: Array<{ weaponId: string; mountIndex: number }> = []
    let score = 0
    let allRed = true
    for (const weapon of ship.form.weapons) {
      // Homing weapons launch (E5.2); they are not part of a volley.
      if (isHoming(weapon)) continue
      weapon.mounts.forEach((mount, mountIndex) => {
        const state = ship.mounts[weapon.id][mountIndex]
        if (!mountIsReady(weapon, mountIndex, state)) return
        if (!canBearOn(mount.arcs, arcs)) return
        const bracket = selectBracket(weapon, effective, enemy.speed === 0)
        if (!bracket) return
        mounts.push({ weaponId: weapon.id, mountIndex })
        score += bracket.bracket.dice.length + (bracket.bracket.bonus ?? 0)
        if (bracket.bracket.band !== 'red') allRed = false
      })
    }
    if (mounts.length === 0) continue

    // Prefer finishing what is already burning. The admiral leans harder.
    const level = damageLevel(enemy)
    const focus = difficulty === 'admiral' ? 2 : 1
    score += focus * (level === 'crippled' ? 3 : level === 'heavy' ? 2 : level === 'moderate' ? 1 : 0)

    const better =
      difficulty === 'ensign'
        ? // The ensign shoots whatever is closest and calls it gunnery.
          !best || actual < best.range || (actual === best.range && enemy.id < best.targetId)
        : !best || score > best.score || (score === best.score && enemy.id < best.targetId)
    if (better) {
      best = { targetId: enemy.id, mounts, score, allRed, range: actual }
    }
  }

  if (!best) return null
  return {
    type: 'fire-volley',
    attackerId: ship.id,
    targetId: best.targetId,
    mounts: best.mounts,
    // At extreme range the admiral fires proximity-fused: rerolled blanks and
    // half damage beat full damage that never lands (E3.3).
    mode: difficulty === 'admiral' && best.allRed ? 'proximity' : 'standard',
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
