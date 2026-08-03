import type { GameAction } from './actions'
import { firingOrder, selectBracket, traitValue } from './combat'
import { expectedValue } from './dice'
import {
  asteroidFieldsAt,
  attackAllowed,
  cloakOf,
  cloudStatus,
  currentFiringStep,
  homingWeaponDef,
  impactingHoming,
  shipsUnderBoarding,
  tractorableHoming,
  tacticalScanOf,
  isCombatPhase,
  reconProgress,
  terrainObstacles,
  tractorBeamsFree,
  victoryPoints,
  type GameState,
} from './game'
import { FIRING_STEPS, coordinatedStepFor, mayFireAlone, stepMatchesScan } from './coordinatedFire'
import { cloakFullyPowered, cloakOperational, isCloaked, mayDecloak } from './cloaking'
import {
  armingPointsAvailable,
  batterySpendError,
  powerRemaining,
  repairTargets,
  type RepairCategory,
} from './engineering'
import {
  actualRange,
  applyManeuver,
  effectiveRange,
  arcTo,
  canBearOn,
  hasLineOfSight,
  headingVector,
  relativeBearing,
  shieldsFacing,
} from './geometry'
import { disengagementOptions, plannedMovement, validatePlot, accelerationBudget } from './navigation'
import {
  armingCapacityThisRound,
  blueShieldRemaining,
  currentMaxSpeed,
  damageControlRating,
  damageLevel,
  greenShieldRemaining,
  lineValue,
  maxReverseSpeed,
  mountIsReady,
  batteryPower,
  sensorFunctionCap,
  shieldGeneratorRating,
  structureRemaining,
  type ShipState,
} from './shipState'
import { boardingSides } from './boarding'
import { endurance, isHoming, speedInPhase } from './homing'
import { transportCapacity, transporterRange } from './operations'
import { SHIELD_SIDES } from './shipState'
import type { CommandCard, Maneuver, Placement, Point, ShieldSide, TurnDirection, WeaponSystemDef } from './types'

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
 * — plus the AI's own ships in full. Enemy *classes* are read the way a
 * veteran reads the ship book: the class name is printed on the counter and
 * the firing charts are public print, so expected-damage estimates from them
 * are book knowledge, not espionage. Shield state is estimated from the
 * table's public record: every volley declares its struck side and narrates
 * its absorption in the open, and `game.shieldHitsSeen` is that tally —
 * secret repairs stay invisible, exactly a human's uncertainty. What stays
 * unread is the enemy's hidden current state — power allocation, arming,
 * which mounts are wrecked — approximated only from the public damage-level
 * marker (B1.9).
 *
 * Idempotence: planning duties (allocation, plotting) compare the computed
 * plan against the ship's current state and emit only differences, so being
 * asked twice does nothing twice. Dice-rolling duties (damage control,
 * boarding) are guarded by a per-segment memo.
 */

export interface AiMemo {
  done: Set<string>
  /** Highest Tactical Scan each enemy side has shown — the auction remembered. */
  scanSeen: Map<string, number>
  /** Log entries digested so far by the observation pass. */
  logSeen: number
  /** Consecutive under-book volleys observed per enemy ship: a power-starved read. */
  underPowered: Map<string, number>
}

export function createAiMemo(): AiMemo {
  return { done: new Set(), scanSeen: new Map(), logSeen: 0, underPowered: new Map() }
}

/**
 * The veteran's notebook: everything here is watched, not peeked. Enemy scan
 * bids are declared each phase; volleys resolve in the open with their damage
 * narrated. An enemy whose fire keeps landing far under its book strength is
 * running starved of power — press it. One whose scan bids keep winning the
 * auction has a habit — outbid the habit, not just this phase's number.
 */
function observe(game: GameState, memo: AiMemo, sides: string[]): void {
  for (const e of game.ships) {
    if (sides.includes(e.side) || e.destroyed || e.disengaged) continue
    const prev = memo.scanSeen.get(e.side) ?? 0
    if (e.sensors.tacticalScan > prev) memo.scanSeen.set(e.side, e.sensors.tacticalScan)
  }
  for (; memo.logSeen < game.log.length; memo.logSeen++) {
    const line = game.log[memo.logSeen].message
    const hit = /^(.+?) fires on .+? → (\d+) damage/.exec(line)
    if (!hit) continue
    const attacker = game.ships.find((s) => s.name === hit[1])
    if (!attacker || sides.includes(attacker.side)) continue
    const observed = Number(hit[2])
    // Book strength at the range its own charts prefer — a rough yardstick.
    const yardstick = estimatedVolleyDamage(
      attacker,
      { x: attacker.placement.position.x + preferredRange(attacker), y: attacker.placement.position.y },
      0,
    )
    const weak = yardstick > 0 && observed < yardstick * 0.35
    memo.underPowered.set(attacker.id, weak ? (memo.underPowered.get(attacker.id) ?? 0) + 1 : 0)
  }
}

/** Discount an enemy's estimated danger when the notebook says it is starved. */
function dangerScale(memo: AiMemo | null, enemyId: string): number {
  return memo && (memo.underPowered.get(enemyId) ?? 0) >= 2 ? 0.6 : 1
}

/**
 * How the battle stands, read off the public scoreboard (S2.8.4) — and what
 * that asks of this ship. Ahead and hurt: the lead is the thing to protect,
 * so kite harder, jam sooner, take the cripples home. Behind: points must be
 * taken, so close and accept the odds a level scoreboard would refuse. The
 * ensign plays every battle the same.
 */
export type Posture = 'balanced' | 'protect' | 'press'

/**
 * A named temperament, chosen at setup, that biases the posture without
 * touching the rules: the captain's read of the same scoreboard. Aggressive
 * treats a level board as a deficit — it presses unless clearly ahead, and
 * barely protects a lead. Cautious is the mirror: it protects early and
 * presses only from deep in the hole. Steady reads the board straight. Set
 * once per aiNextActions call from setup, so replays reproduce it exactly.
 */
export type AiPersonality = 'steady' | 'aggressive' | 'cautious'

let personality: AiPersonality = 'steady'

/** Setup switch: when false the AI never voluntarily disengages. */
let retreatsAllowed = true

/** How far the temperament shifts the scoreboard margin the posture reads. */
const PERSONALITY_BIAS: Record<AiPersonality, number> = {
  steady: 0,
  aggressive: -6,
  cautious: 6,
}

export function postureOf(
  game: GameState,
  ship: ShipState,
  difficulty: AiDifficulty,
  temperament: AiPersonality = personality,
): Posture {
  if (difficulty === 'ensign') return 'balanced'
  const score = victoryPoints(game)
  const mine = score[ship.side] ?? 0
  const theirs = Math.max(
    0,
    ...Object.entries(score)
      .filter(([side]) => side !== ship.side)
      .map(([, points]) => points),
  )
  const margin = mine - theirs + PERSONALITY_BIAS[temperament]
  const hurt = ['moderate', 'heavy', 'crippled'].includes(damageLevel(ship))
  if (margin > 3 && hurt) return 'protect'
  if (margin < -3) return 'press'
  return 'balanced'
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
  temperament: AiPersonality = 'steady',
  mayRetreat = true,
): GameAction[] {
  personality = temperament
  retreatsAllowed = mayRetreat
  const fleet = ownShips(game, sides)
  if (fleet.length === 0) return []
  observe(game, memo, sides)

  switch (game.segment) {
    case 'resource-allocation':
      return planAllocation(game, fleet, memo, difficulty)
    case 'damage-control':
      return planDamageControl(game, fleet, memo, difficulty)
    case 'command': {
      // Reserve power is plotted in the Command Segment (B2.5.2), before the
      // card it may change — a battery into the drive is acceleration the
      // helm can then actually plot.
      const reserve = planBatteries(game, fleet, memo, difficulty)
      if (reserve.length > 0) return reserve
      return planOrders(game, fleet, difficulty, memo)
    }
    case 'operations':
      return planOperations(game, fleet, memo, difficulty)
    case 'combat':
      return planFiring(game, fleet, memo, closing, difficulty)
    case 'boarding-combat':
      return planBoarding(game, sides, memo)
    case 'disengagement':
      return planDisengagement(game, fleet, difficulty)
    default:
      return []
  }
}

/**
 * Whether this hull intends to leave the battle (J9): a cripple always goes
 * home; a heavy hull goes when the scoreboard says the lead is worth more
 * than one more volley, or — admiral doctrine — when it faces twice its
 * numbers and staying only feeds the enemy the rest of its points (S2.8.4).
 * Shared by the disengagement plan and by Resource Allocation, because an
 * FTL departure needs a fully powered drive (J9.1.3) — intending to leave
 * without funding the drive is how cripples die at their posts.
 *
 * The whole behavior sits behind a setup switch: a player who wants the
 * battle fought to the last box unchecks "AI may retreat" and every hull
 * stands its ground, doctrine be damned.
 */
function wantsToLeave(game: GameState, ship: ShipState, difficulty: AiDifficulty): boolean {
  /**
   * A recon mission ends by leaving, not by winning (S3.2): the information
   * is worth nothing aboard a ship that stays to fight, and the destroyers
   * are coming. This one outranks the retreat toggle — going home *is* the
   * mission, not a decision to abandon it.
   */
  const recon = reconProgress(game)
  if (recon && ship.side === recon.side && recon.gathered >= recon.required) return true
  if (!retreatsAllowed) return false
  const level = damageLevel(ship)
  if (level === 'crippled') return true
  const enemies = enemiesOf(game, ship)
  const own = game.ships.filter((s) => s.side === ship.side && !s.destroyed && !s.disengaged)
  /**
   * Hopeless odds are refused outright, whole hull and all. Measured to the
   * bone: at three-to-one and beyond, no doctrine on offer wins or even
   * escapes once engaged — kiting is enveloped (the board is six moves
   * across), diving kills a third of a frigate before dying, and a flight
   * begun at half health ends under the guns 22 times in 24. The scoreboard
   * itself prices the refusal at half value and the stand at all of it
   * (S2.8.4), so the admiral declines the battle while declining is free.
   */
  if (difficulty === 'admiral' && enemies.length >= own.length * 3 && enemies.length >= 3) {
    return true
  }
  if (level !== 'heavy' && level !== 'moderate') return false
  if (level === 'heavy' && postureOf(game, ship, difficulty) === 'protect') return true
  if (difficulty !== 'admiral') return false
  const outnumbered = enemies.length >= own.length * 2 && enemies.length >= 2
  if (!outnumbered) return false
  // Against twice the numbers a heavy hull always cuts its losses, and a
  // moderate one already losing on points calls the sortie failed — half
  // the hull conceded now beats all of it conceded three rounds from now.
  return level === 'heavy' || postureOf(game, ship, difficulty) === 'press'
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
    /**
     * Under the optional battery rules the reserve is only worth having if it
     * survives Resource Allocation. The printed allocation spends into the
     * batteries without noticing — they are simply part of the total — so a
     * captain who means to keep one has to hold the line here, and plan the
     * round on reactor power alone.
     */
    const doctrine = game.optionalBatteries && difficulty !== 'ensign'
    const reserve = doctrine ? batteryPower(ship) : 0
    let budget = powerRemaining(ship) - reserve

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
    // A ship that intends to leave powers the drive that leaves (J9.1.3) —
    // before the guns, because a departing hull's volley is worth less than
    // the points its escape denies.
    if (difficulty !== 'ensign' && wantsToLeave(game, ship, difficulty)) {
      const ftlLine = ship.form.functions.find((l) => l.kind === 'ftl-drive')
      if (ftlLine) fill(ftlLine.id, ftlLine.steps.length)
    }

    /**
     * Read the round before spending on it. When the nearest enemy sits far
     * beyond every battery's reach, nothing fires this round no matter what
     * the allocation says — so a trained captain powers the long game: the
     * slow-arming heavies (diamond gates, E4.2.8) start their multi-round
     * charge now, ahead of the fast batteries that can fill in a single
     * round once the enemy is close enough to matter.
     */
    const slowArming = (line: { weaponSystemId?: string }) => {
      const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)
      return !!weapon?.mounts.some((m) => (m.roundGates ?? []).some(Boolean))
    }
    const nearestEnemy = nearest(
      ship,
      enemiesOf(game, ship).filter((e) => !positionHidden(game, e)),
    )
    const reach = Math.max(0, ...ship.form.weapons.flatMap((w) => w.brackets.map((b) => b.max)))
    const closingRound =
      difficulty !== 'ensign' &&
      nearestEnemy !== null &&
      actualRange(ship.placement.position, nearestEnemy.placement.position) > reach + 6

    if (closingRound) {
      for (const line of byKind('weapon')) {
        if (weaponAlive(line) && slowArming(line)) fill(line.id, line.steps.length)
      }
      // The admiral also floors the throttle: two drive points now, before
      // the sensors take theirs, buys the merge a round early. Measured as
      // an admiral-only edge — when every rank races, the closings get so
      // fast that dice swamp doctrine and the rank gap flattens; held back
      // for the admiral it keeps the season won at every level.
      if (difficulty === 'admiral') {
        for (const line of byKind('accel')) fill(line.id, 2)
      }
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
    // Turning hard is doctrine now, and SIF is what makes it survivable — a
    // practiced captain powers it before the stress arrives, not after.
    if (difficulty !== 'ensign' || ship.stressMarkers > 0) {
      for (const line of byKind('sif')) fill(line.id, 1)
    }
    /**
     * The shield the fire will come from matters most. The threat axis —
     * enemies weighted by proximity and how bow-on they sit, all public
     * table information — names the sides about to be hit: repair those
     * first (G1.3.3), and a trained captain also puts a reinforcement point
     * there before the volley, the game's way of angling a strong shield
     * into the attack (G1.3.2).
     */
    const threat = difficulty === 'ensign' ? null : threatPoint(game, ship)
    const threatened = threat
      ? shieldsFacing(threat, ship.placement.position, ship.placement.heading)
      : []
    const repairs = byKind('shield-repair').filter(
      (line) => line.shieldSide && ship.blueShieldDamage[line.shieldSide] > 0,
    )
    repairs.sort((a, b) => {
      const at = threatened.includes(a.shieldSide!) ? 0 : 1
      const bt = threatened.includes(b.shieldSide!) ? 0 : 1
      return at - bt
    })
    for (const line of repairs) fill(line.id, 1)
    for (const line of byKind('shield-reinforce')) {
      if (line.shieldSide && threatened.includes(line.shieldSide)) fill(line.id, 1)
    }
    // Spare change: deeper sensors, then a second acceleration point.
    for (const line of byKind('sensor')) fill(line.id, line.steps.length)
    for (const line of byKind('accel')) fill(line.id, 2)
    /**
     * Last, put an empty battery back on charge (B2.4.3): it buys nothing
     * this round by design — the point arrives next round, as a reserve — so
     * it takes only power the round had no other use for.
     *
     * Measured against the opposite ordering, ahead of the spare change, and
     * the two are indistinguishable: on the hulls in the season the reactors
     * are fully committed by the guns and the eyes, so neither placement ever
     * finds a spare point. The conservative one is kept for the hull that
     * does — a ship with its weapons shot away has power going begging.
     */
    if (doctrine) {
      const empty = ship.batteryCharged.filter((c, i) => !c && !ship.batteryDamaged[i]).length
      if (empty > 0) for (const line of byKind('battery-recharge')) fill(line.id, empty)
    }
  }

  if (actions.length > 0) return actions

  // Second pass, after the allocations landed: leftover arming points, scout
  // orders, and the fleet's command-point assignments (H5.2.1).
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
      arming.push(...armingPlan(ship, weapon))
    }
  }
  return arming
}

/**
 * Spend a weapon's scarce arming points. A mount fires only when *fully*
 * armed, so spreading points round-robin can leave every battery half-charged
 * and the ship silent — the classic way to waste a turn's power. Instead,
 * concentrate: finish the mounts closest to ready first (which also favors
 * heavy weapons already partway through a multi-round arm), and pour into
 * each until its this-round capacity is spent before starting the next.
 * Exported for tests.
 */
export function armingPlan(ship: ShipState, weapon: WeaponSystemDef): GameAction[] {
  return spendArmingPoints(ship, weapon, armingPointsAvailable(ship, weapon.id))
}

/**
 * The same concentration, over a stated number of points rather than the ones
 * on hand — so points a battery is about to buy can be spent in the same
 * batch, before the engine has applied the purchase.
 */
function spendArmingPoints(ship: ShipState, weapon: WeaponSystemDef, budget: number): GameAction[] {
  let points = budget
  if (points <= 0) return []
  const order = weapon.mounts
    .map((mount, index) => {
      const state = ship.mounts[weapon.id][index]
      return {
        index,
        capacity: armingCapacityThisRound(weapon, index, state),
        toReady: Math.max(0, mount.armingCircles - state.armed),
      }
    })
    .filter((m) => m.capacity > 0 && m.toReady > 0)
    .sort((a, b) => a.toReady - b.toReady || a.index - b.index)

  const actions: GameAction[] = []
  for (const mount of order) {
    const pour = Math.min(points, mount.capacity)
    for (let i = 0; i < pour; i++) {
      actions.push({ type: 'arm-mount', shipId: ship.id, weaponId: weapon.id, mountIndex: mount.index })
    }
    points -= pour
    if (points === 0) break
  }
  return actions
}

// ---------------------------------------------------------------------------
// Reserve power (B2.5, optional): what a battery is worth mid-round
// ---------------------------------------------------------------------------

/**
 * Under the optional rules a battery is a decision rather than an accounting
 * detail, and the doctrine is the same one a good captain plays: keep it until
 * it buys something the round cannot buy any other way, then spend it on the
 * thing that changes what happens next.
 *
 * The order is worth stating, because it is not obvious. A volley comes first:
 * a mount one circle short of ready is worth nothing at all this phase and a
 * whole battery's damage the moment it is finished, which is the largest
 * swing a single point of power can buy anywhere in the game. Only then the
 * shield the fire is coming from — a repair equal to the generator rating,
 * landed *now* rather than next round, is a volley's worth of blue boxes.
 * Then the legs, but only for a hull whose plan is distance and whose
 * acceleration is already spent; for anyone else a point of speed changes
 * nothing this phase.
 *
 * Everything here is public: our own ship, the enemy's printed charts, the
 * range between them.
 */
function batteryPlan(
  game: GameState,
  ship: ShipState,
  difficulty: AiDifficulty,
): GameAction[] {
  const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  if (enemies.length === 0) return []
  const closest = nearest(ship, enemies)
  if (!closest) return []
  const range = actualRange(ship.placement.position, closest.placement.position)

  const spend = (lineId: string, extra: GameAction[] = []): GameAction[] => [
    { type: 'spend-battery', shipId: ship.id, lineId },
    ...extra,
  ]

  // 1. A mount one circle short of firing. The points the purchase buys are
  //    spent in the same batch, so the volley is ready this phase.
  for (const line of ship.form.functions) {
    if (line.kind !== 'weapon' || !line.weaponSystemId) continue
    if (batterySpendError(ship, line.id) !== null) continue
    const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)
    if (!weapon) continue
    // Out of reach is out of the question: the round would end with the
    // points unspent and the battery gone.
    const reach = Math.max(0, ...weapon.brackets.map((b) => b.max))
    if (range > reach) continue
    const filled = ship.allocation[line.id] ?? 0
    const gain = (line.steps[filled]?.value ?? 0) - lineValue(ship, line.id)
    if (gain <= 0) continue
    // Only worth it if the gain actually finishes a mount — a half-charged
    // battery fires exactly as often as an empty one (E4.2.3).
    const short = weapon.mounts
      .map((mount, index) => ({
        index,
        need: Math.max(0, mount.armingCircles - ship.mounts[weapon.id][index].armed),
        capacity: armingCapacityThisRound(weapon, index, ship.mounts[weapon.id][index]),
      }))
      .filter((m) => m.need > 0 && m.capacity > 0)
      .sort((a, b) => a.need - b.need)[0]
    if (!short || short.need > Math.min(gain, short.capacity)) continue
    return spend(line.id, spendArmingPoints(ship, weapon, gain))
  }

  // 2. The shield the fire is coming from, repaired on the spot (B2.5.8).
  const rating = shieldGeneratorRating(ship)
  if (rating > 0 && estimatedVolleyDamage(closest, ship.placement.position, ship.sensors.jamming) > 0) {
    const threatened = shieldsFacing(
      threatPoint(game, ship) ?? closest.placement.position,
      ship.placement.position,
      ship.placement.heading,
    )
    for (const line of ship.form.functions) {
      if (line.kind !== 'shield-repair' || !line.shieldSide) continue
      if (!threatened.includes(line.shieldSide)) continue
      if (batterySpendError(ship, line.id) !== null) continue
      // Repairing one box with a whole battery is a bad trade; repairing a
      // generator's worth of them is the reason the rule exists.
      if (ship.blueShieldDamage[line.shieldSide] < rating) continue
      return spend(line.id)
    }
  }

  // 3. Legs, for a hull whose plan is distance and whose budget is spent.
  const running = wantsToLeave(game, ship, difficulty) || kiteBand(game, ship, enemies) !== null
  if (running && ship.accelUsedThisRound >= accelerationBudget(ship)) {
    const accel = ship.form.functions.find((l) => l.kind === 'accel')
    if (accel && batterySpendError(ship, accel.id) === null) return spend(accel.id)
  }

  return []
}

function planBatteries(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  difficulty: AiDifficulty,
): GameAction[] {
  // An ensign does not touch the exotic systems, and this is one.
  if (!game.optionalBatteries || difficulty === 'ensign') return []
  if (!isCombatPhase(game.phase)) return []
  for (const ship of fleet) {
    if (batteryPower(ship) === 0 || ship.derelict) continue
    // One considered spend per hull per phase; the reserve is small and the
    // decision does not improve by being asked twice.
    const key = `battery:${game.round}:${game.phase}:${ship.id}`
    if (memo.done.has(key)) continue
    const plan = batteryPlan(game, ship, difficulty)
    if (plan.length === 0) continue
    memo.done.add(key)
    return plan
  }
  return []
}

// ---------------------------------------------------------------------------
// Damage Control (B3.2): what gets fixed depends on what the battle asks
// ---------------------------------------------------------------------------

const REPAIR_PRIORITY: RepairCategory[] = ['weapons', 'engineering', 'systems', 'shields', 'structure']

/** A ship running for home fixes the legs and the umbrella before the guns. */
const PROTECT_PRIORITY: RepairCategory[] = ['engineering', 'shields', 'weapons', 'systems', 'structure']

function planDamageControl(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  difficulty: AiDifficulty,
): GameAction[] {
  const actions: GameAction[] = []
  for (const ship of fleet) {
    const key = `dc:${game.round}:${ship.id}`
    if (memo.done.has(key)) continue
    memo.done.add(key)

    const budget = damageControlRating(ship)
    const targets = repairTargets(ship)
    if (budget === 0 || targets.length === 0) continue

    // The repair queue answers to the posture: pressing or level, guns first
    // (the current doctrine); protecting a lead on a hurt hull, the drive
    // that carries the points home and the shields that keep them come first.
    // The ensign's crews just follow the book's order.
    const priority =
      difficulty !== 'ensign' && postureOf(game, ship, difficulty) === 'protect'
        ? PROTECT_PRIORITY
        : REPAIR_PRIORITY
    const present = priority.filter((c) => targets.some((t) => t.category === c))
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

/**
 * How hard to weave (C3.6), and the arithmetic behind it — most of which was
 * settled by measurement rather than by argument, because the obvious readings
 * of the rule are wrong.
 *
 * On paper evasive looks like a bargain for the outnumbered: the rerolls come
 * against *each* incoming volley (C3.6.3), while the matching penalty applies
 * only to this ship's own fire, so the trade scales with the number of guns
 * pointed at you. Played out, a lone capital that weaves against a swarm gains
 * nothing — 8W-16L weaving hard against 11W-13L not weaving at all, over the
 * same twenty-four mirrored games. The side that actually profits from the rule
 * is the swarm, which converts the same doctrine into a six-win swing: its
 * hulls fire one small volley each, so the penalty they pay is trivial beside
 * the rerolls they take off a heavy cruiser's broadsides.
 *
 * What is left, and what this plans for, is the free case: a phase where the
 * plot leaves no shot at anybody. Even that has a hidden price. Acceleration
 * spent weaving counts against the round (C3.6.2), so weaving in the first
 * combat phase quietly disarms the helm for the two that follow — worth five
 * wins in sixty-four squadron games. Weaving in the last phase of the round
 * costs nothing that round can still use.
 *
 * Hence: weave only in the final combat phase, only when the plot has no shot
 * to spoil, never with acceleration the maneuver or the safe limit wants, and
 * never at all when the plan is distance — a kite band or an FTL window is
 * bought with the same points.
 */
export function evasivePlan(
  game: GameState,
  ship: ShipState,
  difficulty: AiDifficulty,
  end: Placement,
  ownFirepower: number,
  plannedAccel: number,
): number {
  if (difficulty === 'ensign') return 0
  // Acceleration spent now is acceleration the rest of the round cannot spend.
  if (game.phase !== 'combat-3') return 0
  // A shot to spoil is a shot worth more than the weave.
  if (ownFirepower > 0) return 0
  if (wantsToLeave(game, ship, difficulty)) return 0
  if (kiteBand(game, ship, enemiesOf(game, ship).filter((e) => !positionHidden(game, e))) !== null) {
    return 0
  }
  /**
   * Only what the plot did not want, and only up to the safe line: evasive
   * acceleration counts against the round like any other (C3.6.2), so past that
   * line each point buys a reroll and a stress marker.
   */
  const spare =
    Math.min(accelerationBudget(ship), ship.form.sublight.safeAccelPerRound) -
    ship.accelUsedThisRound -
    Math.abs(plannedAccel) +
    ship.evasive
  if (spare <= 0) return 0

  const threats = enemiesOf(game, ship)
    .filter((e) => !positionHidden(game, e))
    .filter((e) => estimatedVolleyDamage(e, end.position, ship.sensors.jamming) > 0).length
  if (threats === 0) return 0

  const protecting = postureOf(game, ship, difficulty) === 'protect'
  // Two or three points take most of what is on offer; the value flattens fast,
  // because a volley only holds a few dice worth rerolling.
  return Math.min(spare, threats >= 3 || protecting ? 3 : 2)
}

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

/**
 * The outnumbered hull's only winning geometry. Numbers beat tonnage in
 * close battle — five volleys and five repair parties against one is not a
 * fight doctrine can fix — so when the enemy brings twice the hulls AND
 * every one of them is out-reached by this ship's longest chart, the fight
 * moves to the band the enemy cannot answer from: stand just past the
 * farthest bracket any of them can strike (their reach, stretched by their
 * declared targeting, shrunk by our jamming — H2.3.3) and let the long guns
 * grind. Returns the actual-range inches to hold, or null when the geometry
 * offers no such band. Admiral doctrine: the read takes the whole table.
 * Exported for tests.
 */
export function kiteBand(game: GameState, ship: ShipState, enemies: ShipState[]): number | null {
  if (enemies.length < 2) return null
  const own = game.ships.filter((s) => s.side === ship.side && !s.destroyed && !s.disengaged)
  if (enemies.length < own.length * 2) return null
  const reachOf = (s: ShipState) =>
    Math.max(
      0,
      ...s.form.weapons.filter((w) => !isHoming(w)).flatMap((w) => w.brackets.map((b) => b.max)),
    )
  const myReach = reachOf(ship)
  const theirReach = Math.max(0, ...enemies.map(reachOf))
  if (myReach < theirReach + 4) return null
  const theirTargeting = Math.max(0, ...enemies.map((e) => e.sensors.targeting))
  const safe = theirReach + theirTargeting - ship.sensors.jamming + 1
  return Math.min(Math.max(safe, theirReach - ship.sensors.jamming + 1), myReach - 1)
}

function planOrders(
  game: GameState,
  fleet: ShipState[],
  difficulty: AiDifficulty,
  memo: AiMemo | null = null,
): GameAction[] {
  const actions: GameAction[] = []

  for (const ship of fleet) {
    const card = game.orders[ship.id]
    if (!card) continue
    const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
    /**
     * The helm and the guns hunt the same ship. Trained ranks steer at the
     * squadron's focus target — the kill the whole side is converging on —
     * not merely whatever is closest, so a fleet herds its chosen prey
     * instead of drifting into three private duels. The ensign chases the
     * nearest counter.
     */
    const focusId = difficulty === 'ensign' ? null : focusTargetFor(game, ship, difficulty)
    const enemy = enemies.find((e) => e.id === focusId) ?? nearest(ship, enemies)

    const plan = enemy ? bestPlot(game, ship, card, enemy, difficulty, memo) : { maneuver: 'straight' as Maneuver, direction: null, accel: 0 }
    if (card.maneuver !== plan.maneuver || card.direction !== plan.direction) {
      actions.push({ type: 'plot-maneuver', shipId: ship.id, maneuver: plan.maneuver, direction: plan.direction })
    }
    if (card.accel !== plan.accel) {
      actions.push({ type: 'plot-accel', shipId: ship.id, delta: plan.accel - card.accel })
    }

    /**
     * Sensor split (H2.2.2). Tactical Scan decides firing order, and under
     * the one-opportunity rule (E6.2) the ship that shoots first may leave
     * the other unable to answer — initiative beats brackets. The ensign
     * splits evenly, by the book and behind the fight; the captain bids
     * Tactical Scan first; the admiral reads the enemy's declared scan off
     * the table and outbids it by exactly one, spending the rest on
     * targeting.
     *
     * Unless the ship will not be shooting this phase. A crippled hull, or
     * one whose planned position offers no shot worth taking — nothing
     * bears, nothing reaches, or only red brackets that fire discipline
     * would hold anyway — gets nothing from initiative or brackets.
     * Jamming, though, pushes enemy effective range out and can deny
     * long-range fire entirely (H2.3.7). Trained ranks go dark and
     * defensive on their quiet phases; the ensign never jams.
     */
    const sensorLine = ship.form.functions.find((l) => l.kind === 'sensor')
    const available = sensorLine ? lineValue(ship, sensorLine.id) : 0
    const cap = sensorFunctionCap(ship)

    // The aggressive split, computed first so the quiet-phase probe can ask
    // "with this targeting, would my planned position give me a real shot?"
    let tacticalScan: number
    if (difficulty === 'ensign') {
      tacticalScan = Math.min(cap, Math.floor(available / 2))
    } else if (difficulty === 'admiral') {
      // Outbid the habit, not just this phase's number: the notebook holds
      // the highest bid each enemy side has ever shown.
      const enemyScan = Math.max(
        0,
        ...enemies.map((e) => e.sensors.tacticalScan),
        ...enemies.map((e) => memo?.scanSeen.get(e.side) ?? 0),
      )
      tacticalScan = Math.min(cap, available, enemyScan + 1)
      // Nobody scanning? Keep the habit of initiative anyway.
      if (enemyScan === 0) tacticalScan = Math.min(cap, available)
    } else {
      tacticalScan = Math.min(cap, available)
    }
    let targeting = Math.min(cap, available - tacticalScan)
    let jamming = Math.min(cap, available - tacticalScan - targeting)

    /**
     * Where this plot puts the ship, and whether it will have a shot worth
     * taking from there — the answer drives both the sensor split below and
     * how hard the helm weaves.
     */
    const plannedEnd = (() => {
      const plannedCard: CommandCard = {
        maneuver: plan.maneuver,
        direction: plan.direction,
        accel: plan.accel,
        speed: ship.speed + plan.accel,
        sensors: card.sensors,
        shieldsDown: [],
      }
      return plannedMovement(ship, plannedCard).end
    })()
    const plannedFirepower =
      enemy === null
        ? 0
        : firepowerAt(
            { ...ship, sensors: { targeting, jamming: 0, tacticalScan } } as ShipState,
            plannedEnd,
            enemy.placement.position,
            enemy.speed === 0,
            false, // Red brackets do not count: fire discipline would hold that volley.
          )
    const quiet = difficulty !== 'ensign' && enemy !== null && plannedFirepower === 0

    /**
     * Whether the plot leaves this ship a shot at *anybody*. The focus target's
     * bracket answers a different question — a ship with several enemies in
     * reach can be out of range of the kill the squadron is converging on and
     * still have a broadside for someone else — and the weave below has to know
     * whether there is a volley of its own to spoil.
     */
    const plannedFirepowerAny = enemies.reduce(
      (most, e) =>
        Math.max(
          most,
          firepowerAt(
            { ...ship, sensors: { targeting, jamming: 0, tacticalScan } } as ShipState,
            plannedEnd,
            e.placement.position,
            e.speed === 0,
            false,
          ),
        ),
      0,
    )

    // Evasive maneuvers (C3.6): weave with acceleration the round has no other
    // use for. See evasivePlan for why that is the only case worth taking.
    const weave = evasivePlan(game, ship, difficulty, plannedEnd, plannedFirepowerAny, plan.accel)
    if ((card.evasive ?? ship.evasive) !== weave) {
      actions.push({ type: 'plot-evasive', shipId: ship.id, points: weave })
    }

    if (
      difficulty !== 'ensign' &&
      enemy !== null &&
      (damageLevel(ship) === 'crippled' || quiet || postureOf(game, ship, difficulty) === 'protect')
    ) {
      jamming = Math.min(cap, available)
      tacticalScan = Math.min(cap, available - jamming)
      targeting = Math.min(cap, available - jamming - tacticalScan)
    }
    // Kiting an out-reached swarm, the sensors ARE the moat: jamming widens
    // the band the swarm cannot cross (H2.3.7), targeting pulls our own long
    // shots down-bracket (H2.3.3), and initiative is worthless against ships
    // that cannot answer at all.
    if (difficulty === 'admiral' && enemy !== null && kiteBand(game, ship, enemies) !== null) {
      jamming = Math.min(cap, Math.ceil(available / 2))
      targeting = Math.min(cap, available - jamming)
      tacticalScan = Math.min(cap, available - jamming - targeting)
    }
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

/**
 * Book knowledge: what a volley from this enemy would be expected to do to a
 * ship standing at `targetPos`. The class and its printed firing charts are
 * public — the name is on the counter and the ship book is on the shelf —
 * so a veteran reads dice-expectation off the enemy's own charts at the
 * bracket the current range, their declared targeting and our jamming give.
 * What is NOT public — their power, arming, which mounts are wrecked — is
 * approximated by the one damage fact the table does show: the damage-level
 * marker (B1.9), which scales the estimate down as the enemy breaks up.
 */
export function estimatedVolleyDamage(
  enemy: ShipState,
  targetPos: Point,
  myJamming: number,
  from: Point = enemy.placement.position,
): number {
  const actual = actualRange(from, targetPos)
  const effective = effectiveRange(actual, myJamming, enemy.sensors.targeting)
  let total = 0
  for (const weapon of enemy.form.weapons) {
    if (isHoming(weapon)) continue
    const found = selectBracket(weapon, effective, false)
    if (!found) continue
    const special = weapon.special?.damage ?? 0
    const bonus = found.bracket.bonus ?? 0
    const perMount = found.bracket.dice.reduce(
      (sum, color) => sum + expectedValue(color, special, bonus),
      0,
    )
    total += perMount * weapon.mounts.length
  }
  const level = damageLevel(enemy)
  const scale =
    level === 'crippled' ? 0.35 : level === 'heavy' ? 0.6 : level === 'moderate' ? 0.85 : 1
  return total * scale
}

/**
 * What the table's record says is left of an enemy shield: printed strength
 * (book knowledge) minus the absorption everyone has watched that facing
 * soak. Secret repairs are invisible, so this can underestimate — exactly
 * the educated guess a human makes from the same seat.
 */
export function estimatedShieldRemaining(game: GameState, enemy: ShipState, side: ShieldSide): number {
  const printed = enemy.form.shields.blue[side] + enemy.form.shields.green[side]
  const seen = game.shieldHitsSeen[enemy.id]?.[side] ?? 0
  return Math.max(0, printed - seen)
}

/**
 * How broken the shield this position attacks into is, 0 (fresh) to 1
 * (stripped). On an arc boundary the attacker picks the shield, so the most
 * broken option counts (E6.2 Step 4).
 */
export function facingWeakness(
  game: GameState,
  enemy: ShipState,
  attackerPos: Point,
  enemyPos: Point,
  enemyHeading: number = enemy.placement.heading,
): number {
  const struck = shieldsFacing(attackerPos, enemyPos, enemyHeading)
  let weakness = 0
  for (const side of struck) {
    const printed = Math.max(1, enemy.form.shields.blue[side] + enemy.form.shields.green[side])
    weakness = Math.max(weakness, 1 - Math.min(1, estimatedShieldRemaining(game, enemy, side) / printed))
  }
  return weakness
}

/**
 * Model the opponent as a player. Plotting is simultaneous and secret
 * (B1.9.1), so the right prediction is not "where their nose points" but
 * "the plot their seat would choose off the current board": enumerate their
 * maneuver and speed candidates with pure geometry and the book's own turn
 * template table — never their hidden allocation — and score each from
 * their perspective: bow on us, the range their charts want, the damage
 * they would threaten, the board edge they must not cross. The best of
 * those is where the admiral aims. Exported for tests.
 */
export function predictEnemyPlot(
  game: GameState,
  enemy: ShipState,
  viewer: ShipState,
  start: { position: Point; heading: number } = enemy.placement,
  startSpeed: number = enemy.speed,
): { position: Point; heading: number; speed: number } {
  const maneuvers: Array<[Maneuver, TurnDirection | null]> = [
    ['straight', null],
    ['easy', 'left'],
    ['easy', 'right'],
    ['standard', 'left'],
    ['standard', 'right'],
  ]
  const ideal = preferredRange(enemy) // their charts: book knowledge
  const { width, height } = game.scenario.bounds

  let best = { position: start.position, heading: start.heading, speed: startSpeed }
  let bestScore = -Infinity
  for (const accel of [-2, -1, 0, 1, 2]) {
    if (Math.abs(accel) > enemy.form.sublight.maxAccelPerPhase) continue
    const speed = startSpeed + accel
    if (speed < 0 || speed > enemy.form.sublight.maxSpeed) continue
    for (const [maneuver, direction] of maneuvers) {
      const result = applyManeuver({
        start: { position: start.position, heading: start.heading },
        speed,
        maneuver,
        direction,
        turnTemplate: enemy.form.sublight.turnBySpeed[Math.abs(speed)] ?? 0,
      })
      const end = result.end
      const range = actualRange(end.position, viewer.placement.position)
      const bearing = relativeBearing(end.position, end.heading, viewer.placement.position)
      const offBow = Math.min(bearing, 360 - bearing)
      let score = -Math.abs(range - ideal) * 0.5 + ((180 - offBow) / 180) * 3
      if (offBow < 45) score += 1.5
      score += estimatedVolleyDamage(enemy, viewer.placement.position, 0, end.position) * 0.4
      // They dodge our guns the way we dodge theirs — the viewer's charts
      // are book knowledge to them too.
      score -= estimatedVolleyDamage(viewer, end.position, 0, viewer.placement.position) * 0.15
      if (end.position.x < 2 || end.position.y < 2 || end.position.x > width - 2 || end.position.y > height - 2) {
        score -= 8
      }
      if (score > bestScore) {
        bestScore = score
        best = { position: end.position, heading: end.heading, speed }
      }
    }
  }
  return best
}

/**
 * The table's own threat picture: where the incoming fire will come from,
 * weighted by how much of it each enemy is good for. Each visible enemy
 * contributes its estimated volley damage at the current range, times how
 * bow-on it sits — a ship pointed at you is a ship about to have you in
 * arc. Public surface only.
 */
function threatPoint(game: GameState, ship: ShipState): Point | null {
  const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  if (enemies.length === 0) return null
  let wx = 0
  let wy = 0
  let total = 0
  for (const e of enemies) {
    const bearing = relativeBearing(e.placement.position, e.placement.heading, ship.placement.position)
    const offBow = Math.min(bearing, 360 - bearing)
    const aim = 1 + (180 - offBow) / 180 // 2 when bow-on … 1 when pointed away
    const danger = estimatedVolleyDamage(e, ship.placement.position, ship.sensors.jamming)
    // A floor keeps a currently-harmless enemy on the map: it can still close.
    const range = actualRange(ship.placement.position, e.placement.position)
    const weight = aim * (danger + 4 / (range + 4))
    wx += e.placement.position.x * weight
    wy += e.placement.position.y * weight
    total += weight
  }
  return { x: wx / total, y: wy / total }
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

/**
 * Dice-weighted worth of this ship's ready direct-fire batteries against a
 * point, were it standing at `placement` — the movement planner's real
 * objective. A plot is good exactly insofar as the guns it brings to bear:
 * each bearing, ready mount contributes its bracket's dice at that range,
 * worth more in green (attacker rerolls, E1.2.1) and less in red. Only the
 * ship's own form is read; the enemy stays a counter on the table.
 */
function firepowerAt(
  ship: ShipState,
  placement: { position: Point; heading: number },
  targetPos: Point,
  targetLowSpeed: boolean,
  includeRed = true,
): number {
  const arcs = arcTo(placement.position, placement.heading, targetPos)
  const actual = actualRange(placement.position, targetPos)
  const effective = effectiveRange(actual, 0, ship.sensors.targeting)
  let value = 0
  for (const weapon of ship.form.weapons) {
    if (isHoming(weapon)) continue
    weapon.mounts.forEach((mount, mountIndex) => {
      const state = ship.mounts[weapon.id][mountIndex]
      if (!mountIsReady(weapon, mountIndex, state)) return
      if (!canBearOn(mount.arcs, arcs)) return
      const found = selectBracket(weapon, effective, targetLowSpeed)
      if (!found) return
      // Red brackets can be excluded: fire discipline holds those volleys,
      // so for "will I actually shoot?" they are worth nothing.
      if (found.bracket.band === 'red' && !includeRed) return
      const weight = found.bracket.band === 'green' ? 1.3 : found.bracket.band === 'red' ? 0.6 : 1
      value += (found.bracket.dice.length + (found.bracket.bonus ?? 0)) * weight
    })
  }
  return value
}

function bestPlot(
  game: GameState,
  ship: ShipState,
  card: CommandCard,
  enemy: ShipState,
  difficulty: AiDifficulty,
  memo: AiMemo | null = null,
): Candidate {
  const post = postureOf(game, ship, difficulty)
  /**
   * The guns aim at the chosen enemy, but the hull answers to every enemy on
   * the table: the shield you angle away from one attacker you may be
   * angling toward another. Facing decisions score against the aggregate
   * threat axis, not just the target of the moment.
   */
  const threat = threatPoint(game, ship)
  const visibleEnemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  // Against a longer-reached swarm the ideal range is not the green band's
  // middle — it is the band the swarm cannot answer from.
  const kite = difficulty === 'admiral' ? kiteBand(game, ship, visibleEnemies) : null
  const ideal = kite ?? preferredRange(ship)
  /**
   * A ship that has resolved to leave stops flying like a ship that means
   * to fight. Measured before this existed: goliaths that "decided" to
   * disengage at heavy damage still steered their bows at the enemy while
   * the drive charged, and died at their posts in 48 of 48 sorties. A
   * leaver's helm has two goals only: distance from every gun, and the
   * board edge — which is not a wall but the door (J9.2.2).
   */
  const fleeing = difficulty !== 'ensign' && wantsToLeave(game, ship, difficulty)
  /**
   * A survey still to finish (S3.2). The raider's helm answers to the planet
   * rather than to the picket: a scan needs eight inches, and a ship that
   * flies at the enemy instead never gets them. Once the survey is done
   * `wantsToLeave` turns it for home, and `fleeing` takes over.
   */
  const survey = (() => {
    if (difficulty === 'ensign' || fleeing) return null
    const recon = reconProgress(game)
    if (!recon || ship.side !== recon.side || recon.gathered >= recon.required) return null
    return game.scenario.terrain.find((t) => t.id === recon.target)?.center ?? null
  })()
  const losObstacles = terrainObstacles(game.scenario.terrain)
  /**
   * Lead the target — knowing the target is fighting back. The enemy's
   * captain wants their bow on us just as we want ours on them, so a
   * straight-line lead is systematically wrong the moment they start coming
   * about. From public information only (position, heading, speed): assume
   * they turn toward us by up to a standard turn, then run their speed. On a
   * head-on approach that reduces to the straight-line lead; in a circling
   * fight it cuts the corner instead of chasing where they will not be. The
   * ensign aims at where the enemy is, not where it will be.
   */
  const toUs = relativeBearing(enemy.placement.position, enemy.placement.heading, ship.placement.position)
  const signed = toUs > 180 ? toUs - 360 : toUs
  const ev = headingVector(enemy.placement.heading + Math.max(-45, Math.min(45, signed)))
  const sifLine = ship.form.functions.find((l) => l.kind === 'sif')
  const sifCover = sifLine ? lineValue(ship, sifLine.id) : 0
  // Half the enemy's speed: a full-speed lead overshoots the moment the
  // enemy maneuvers, and in a turning fight the enemy is always maneuvering.
  const lead = enemy.speed * 0.5
  /**
   * The admiral does not guess the lead — it plays the enemy's turn. One
   * prediction per enemy per phase (plotting is simultaneous, so their best
   * plot does not depend on which of our candidates we weigh), and a second
   * prediction from the first for the lookahead's far phase.
   */
  const enemyPlan = difficulty === 'admiral' ? predictEnemyPlot(game, enemy, ship) : null
  const enemyPlan2 = enemyPlan
    ? predictEnemyPlot(game, enemy, ship, enemyPlan, enemyPlan.speed)
    : null
  /**
   * The model earns its keep where the heuristic is silent. Position: the
   * hedged half-speed lead measured better than the model's point guess
   * (a confident miss aims worse than a humble average), so the lead stays.
   * Heading: the heuristic has none — facing math previously used the
   * enemy's STALE current heading — and there the modeled plot is the only
   * informed guess on offer.
   */
  const predicted =
    difficulty === 'ensign'
      ? enemy.placement.position
      : {
          x: enemy.placement.position.x + ev.x * lead,
          y: enemy.placement.position.y + ev.y * lead,
        }
  const predictedHeading = enemyPlan?.heading ?? enemy.placement.heading

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
      /**
       * Range discipline. Normally the price is symmetric around the guns'
       * best band. Kiting, it is not: the distance is held against the
       * NEAREST enemy hull, not the chosen target, and slipping inside the
       * band costs triple what overshooting it does — an inch too far is a
       * weaker die, an inch too close is five answering volleys.
       */
      const nearestRange =
        visibleEnemies.length > 0
          ? Math.min(...visibleEnemies.map((e) => actualRange(end.position, e.placement.position)))
          : Infinity
      let score: number
      if (fleeing) {
        // Every inch from the nearest gun is the whole plan.
        score = nearestRange === Infinity ? 40 : nearestRange
      } else if (survey) {
        // Close to scanning range and hold there — the mission is the planet,
        // and the picket is only in the way (J4.2.1 wants eight inches).
        score = -Math.abs(actualRange(end.position, survey) - 5)
      } else if (kite !== null && visibleEnemies.length > 0) {
        score = -(kite - nearestRange > 0 ? (kite - nearestRange) * 1.5 : (nearestRange - kite) * 0.5)
      } else {
        score = -Math.abs(range - ideal) * 0.5
      }

      /**
       * Keep the bow turning toward the enemy — and pay for every degree of
       * progress, not just for arriving. An easy or standard turn moves the
       * full distance and then pivots (C2.2.3), so its end position matches
       * flying straight and only the heading differs: with a threshold
       * bonus, the first turn of a comeback from dead astern scored level
       * with sailing on forever. The continuous reward is the gradient that
       * makes coming about win on its own merits at every rank.
       */
      if (!fleeing) {
        const bearing = relativeBearing(end.position, end.heading, predicted)
        const offBow = Math.min(bearing, 360 - bearing) // 0 dead ahead … 180 dead astern
        score += ((180 - offBow) / 180) * 3
        if (offBow < 45) score += 1.5
      }

      // Rank is what the officer optimises. The ensign flies by feel —
      // bearing and range — while trained captains read their own firing
      // charts and steer for the position their batteries are worth most
      // from, and present their healthiest shield to the fire coming back:
      // when one side is stripped, showing it to the enemy is hull damage
      // volunteered.
      if (difficulty !== 'ensign' && !fleeing) {
        const fp = firepowerAt(ship, end, predicted, enemy.speed === 0)
        /**
         * Deep maneuver: the same guns are worth up to double pointed at a
         * battered facing. Which enemy shield this position attacks into is
         * geometry; how much of it is left is the table's public record —
         * so a ship works its way around onto the flank it has been
         * hammering, instead of trading into a fresh screen.
         */
        const weakness = facingWeakness(game, enemy, end.position, predicted, predictedHeading)
        score += fp * 0.4 * (1 + weakness)
        // On an arc boundary the attacker picks the shield (E6.2 Step 4),
        // so the weakest facing side is the one that will be hit. With a
        // shot on the board the guns come first; on a quiet approach the
        // hull angles its strongest shield into the incoming fire instead.
        const facing = shieldsFacing(threat ?? predicted, end.position, end.heading)
        const weakest = Math.min(
          ...facing.map((s) => blueShieldRemaining(ship, s) + greenShieldRemaining(ship, s)),
        )
        score += weakest * (fp > 0 ? 0.15 : 0.4)

        /**
         * And the fire coming the other way: each enemy's expected volley at
         * this end position, by book knowledge. Standing where the enemy's
         * charts are rich while yours are poor is how ships die — this term
         * is what makes range control emerge: kite the heavy batteries,
         * crowd the light ones.
         */
        const incoming = visibleEnemies.reduce(
          (sum, e) =>
            sum + estimatedVolleyDamage(e, end.position, ship.sensors.jamming) * dangerScale(memo, e.id),
          0,
        )
        // The scoreboard sets the appetite for risk: a lead worth keeping
        // kites harder; a deficit closes and accepts the fire.
        score -= incoming * (post === 'protect' ? 0.25 : post === 'press' ? 0.08 : 0.15)

        /**
         * Terrain is a tool, not just a hazard. A field entered at legal
         * speed grants cover rerolls against everything inbound (K2.1.8),
         * and a world between you and every gun is better than any shield —
         * both sought in proportion to how much this ship currently wants
         * to not be hit.
         */
        const defensiveNeed = post === 'protect' ? 1 : fp === 0 ? 0.6 : 0.15
        for (const field of asteroidFieldsAt(game.scenario.terrain, end.position)) {
          if (Math.abs(candidate.speed) <= (field.safeSpeed ?? 0)) {
            score += (field.cover ?? 0) * defensiveNeed
          }
        }
        if (losObstacles.length > 0 && defensiveNeed > 0.5 && visibleEnemies.length > 0) {
          const hidden = visibleEnemies.every(
            (e) => !hasLineOfSight(e.placement.position, end.position, losObstacles),
          )
          if (hidden) score += 5 * defensiveNeed
        }
      }

      /**
       * Stress the SIF will cancel is cheap; stress beyond it draws damage
       * cards (C3.1.4), and no firing angle is worth flying the ship apart —
       * an aggressive circler must not out-damage the enemy's guns with its
       * own helm. Price the two very differently.
       */
      const covered = Math.max(0, sifCover - ship.stressMarkers)
      const uncovered = Math.max(0, planned.stress - covered)
      score -= (planned.stress - uncovered) * 0.5 + uncovered * 4

      // The board edge is disengagement (S2.2.1) — a wall to a ship that
      // means to fight, the door itself to one that means to leave (J9.2.2).
      const { width, height } = game.scenario.bounds
      if (fleeing) {
        if (
          end.position.x < 0 ||
          end.position.y < 0 ||
          end.position.x > width ||
          end.position.y > height
        ) {
          score += 30
        }
      } else if (
        end.position.x < 2 ||
        end.position.y < 2 ||
        end.position.x > width - 2 ||
        end.position.y > height - 2
      ) {
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

      /**
       * Rank is search depth. The admiral looks one phase further: from this
       * candidate's end, what does the best follow-up maneuver achieve? A
       * greedy plotter turns toward the enemy; the admiral plans the turn
       * *sequence* that brings the batteries to bear, and knows a plot that
       * looks level now can be the one that wins the next phase.
       */
      if (difficulty === 'admiral' && !fleeing) {
        const afterEnemy = {
          x: predicted.x + ev.x * enemy.speed,
          y: predicted.y + ev.y * enemy.speed,
        }
        const future: ShipState = {
          ...ship,
          placement: end,
          speed: planned.speed,
          stressMarkers: ship.stressMarkers + planned.stress,
        }
        let bestNext = -Infinity
        for (const [m2, d2, s2] of maneuvers) {
          if (s2 > 0 && future.stressMarkers + s2 >= ship.form.stressRating) continue
          const followUp: CommandCard = {
            maneuver: m2,
            direction: d2,
            accel: 0,
            speed: future.speed,
            sensors: card.sensors,
            shieldsDown: [],
          }
          const then = plannedMovement(future, followUp)
          if (then.illegal) continue
          const r2 = actualRange(then.end.position, afterEnemy)
          const b2 = relativeBearing(then.end.position, then.end.heading, afterEnemy)
          const off2 = Math.min(b2, 360 - b2)
          let s = -Math.abs(r2 - ideal) * 0.5 + ((180 - off2) / 180) * 3 - then.stress * 1.5
          if (off2 < 45) s += 1.5
          const fp2 = firepowerAt(ship, then.end, afterEnemy, enemy.speed === 0)
          s +=
            fp2 *
            0.4 *
            (1 +
              facingWeakness(
                game,
                enemy,
                then.end.position,
                afterEnemy,
                enemyPlan2?.heading ?? predictedHeading,
              ))
          const facing2 = shieldsFacing(threat ?? afterEnemy, then.end.position, then.end.heading)
          const weakest2 = Math.min(
            ...facing2.map((sd) => blueShieldRemaining(ship, sd) + greenShieldRemaining(ship, sd)),
          )
          s += weakest2 * (fp2 > 0 ? 0.15 : 0.4)
          s -=
            visibleEnemies.reduce(
              (sum, e) => sum + estimatedVolleyDamage(e, then.end.position, ship.sensors.jamming),
              0,
            ) * 0.15
          if (s > bestNext) bestNext = s
        }
        if (bestNext > -Infinity) score += bestNext * 0.5
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
  /**
   * The recon mission (S3.2) is the one scenario where shooting is not the
   * job. The raider's orders are to read the planet and leave with what it
   * read, so it scans every phase it can until the survey is complete — and
   * `wantsToLeave` takes it home from there.
   */
  const recon = reconProgress(game)
  if (recon && !recon.succeeded && recon.gathered < recon.required) {
    for (const ship of fleet) {
      if (ship.side !== recon.side || ship.derelict) continue
      actions.push({ type: 'scan', shipId: ship.id, targetId: recon.target })
    }
  }

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
  // Defensive duties come first, whoever holds the firing slot. Point defense
  // intercepts torpedoes in FLIGHT — E12.3.2 bars fire only during the launch
  // phase, and a counter that has already impacted is no longer a small
  // target at all — so the shots are taken on the way in, and then the
  // impacts are resolved (E5.4); an unresolved impact would simply wait
  // forever. The interception is fleet-coordinated: one deterministic
  // assignment every ship of the side computes identically, most urgent
  // counter first, each counter covered once before any is covered twice —
  // a wave is beaten by splitting the defense across it, not by three ships
  // proudly killing the same torpedo.
  const defensive: GameAction[] = difficulty === 'ensign' ? [] : fleetPointDefense(game, fleet, memo)
  for (const ship of fleet) {
    if (impactingHoming(game, ship).length === 0) continue
    const key = `pd:${game.round}:${game.phase}:${ship.id}`
    if (memo.done.has(key)) continue
    memo.done.add(key)
    defensive.push({ type: 'resolve-homing-impacts', shipId: ship.id, pointDefense: {} })
  }
  if (defensive.length > 0) return defensive

  // Coordinated Fire (H4) has its own strict step machine, played in full.
  if (game.coordinatedFire) {
    return planCoordinatedFiring(game, fleet, memo, closing, difficulty)
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
    if (difficulty !== 'ensign') actions.push(...homingLaunches(game, ship, memo, difficulty))
    const volley = bestVolley(game, ship, difficulty, focusTargetFor(game, ship, difficulty))
    if (volley) {
      memo.done.add(attemptKey)
      actions.push(volley)
    } else {
      actions.push({ type: 'pass-fire', shipId: ship.id })
    }
  }
  return actions
}

/**
 * The optional H4 step machine, played rather than passed. One attack per
 * faction per target per phase is the rule's whole geometry (H4.3.1): a
 * squadron firing individually burns its single attack on the focus target
 * with one ship's volley, so trained ranks hold their scan-2+ hulls off the
 * individual steps and bring them in together on the coordinated step their
 * best scan calls (H4.5), while the rest pick off secondary hulls on the
 * way down. The ensign knows only its own printed step. The step clock is
 * advanced only when this AI owns every hull on the table — in a mixed game
 * that button belongs to the human.
 */
function planCoordinatedFiring(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  closing: boolean,
  difficulty: AiDifficulty,
): GameAction[] {
  const unfired = fleet.filter((s) => !game.firedThisSegment.has(s.id))
  if (closing) {
    return unfired.map((s) => ({ type: 'pass-fire', shipId: s.id }) as GameAction)
  }
  if (unfired.length === 0) return []

  const step = currentFiringStep(game)
  const actions: GameAction[] = []
  const scanOf = (s: ShipState) => tacticalScanOf(game, s)

  // A declared group of ours fires now: each member a separate volley at the
  // group's target (H4.6.1), never precision (H4.6.2).
  const group = game.coordinatedGroup
  if (group && group.step === step.index) {
    for (const ship of unfired) {
      if (!group.shipIds.includes(ship.id)) continue
      const attemptKey = `vol:${game.round}:${game.phase}:${ship.id}`
      if (memo.done.has(attemptKey)) continue
      memo.done.add(attemptKey)
      if (difficulty !== 'ensign') actions.push(...homingLaunches(game, ship, memo, difficulty))
      const volley = bestVolley(game, ship, difficulty, group.targetId, {
        onlyTargetId: group.targetId,
        noPrecision: true,
      })
      actions.push(volley ?? { type: 'pass-fire', shipId: ship.id })
    }
    if (actions.length > 0) return actions
  }

  // Each side's intended group, recomputed off the open board every call so
  // a fallen partner or a dead target reshapes the plan instead of wedging it.
  const plans = new Map<string, { shipIds: string[]; targetId: string; stepIndex: number }>()
  if (difficulty !== 'ensign') {
    for (const side of [...new Set(unfired.map((s) => s.side))].sort()) {
      const plan = plannedCoordinatedGroup(
        game,
        unfired.filter((s) => s.side === side),
        difficulty,
      )
      if (plan) plans.set(side, plan)
    }
  }
  const reserved = new Set(
    [...plans.values()].flatMap((p) => (p.stepIndex >= step.index ? p.shipIds : [])),
  )

  // One volley per call: H4.3.1's one-attack-per-target ledger only advances
  // when an action lands, so a second ship plans against the board the first
  // ship's volley has already changed — the drive loop brings it back around.
  const fireIndividually = (ship: ShipState): boolean => {
    if (positionHidden(game, ship)) return false
    const attemptKey = `vol:${game.round}:${game.phase}:${ship.id}`
    if (memo.done.has(attemptKey)) return false
    if (difficulty !== 'ensign') actions.push(...homingLaunches(game, ship, memo, difficulty))
    const volley = bestVolley(game, ship, difficulty, focusTargetFor(game, ship, difficulty))
    if (volley) {
      memo.done.add(attemptKey)
      actions.push(volley)
      return true
    }
    return false
  }

  if (step.kind === 'individual') {
    for (const ship of unfired) {
      if (!stepMatchesScan(step, scanOf(ship))) continue
      if (reserved.has(ship.id)) continue // holding for the coordinated step
      if (fireIndividually(ship)) break
    }
  } else {
    // Declare when a plan's step has come and the table is clear of groups —
    // a still-firing group finishes before the next faction declares over it.
    const groupDone = !group || group.shipIds.every((id) => game.firedThisSegment.has(id))
    for (const [side, plan] of plans) {
      if (!groupDone || plan.stepIndex !== step.index) continue
      const declKey = `decl:${game.round}:${game.phase}:${side}:${step.index}`
      if (memo.done.has(declKey)) continue
      memo.done.add(declKey)
      actions.push({ type: 'declare-coordinated', shipIds: plan.shipIds, targetId: plan.targetId })
    }
    // A ship whose partners fell through still fires alone on its step (H4.2.4).
    if (actions.length === 0) {
      for (const ship of unfired) {
        if (!mayFireAlone(step, scanOf(ship))) continue
        if (group && group.side === ship.side && !groupDone) continue
        if (reserved.has(ship.id)) continue
        if (fireIndividually(ship)) break
      }
    }
  }
  if (actions.length > 0) return actions

  const active = game.ships.filter((s) => !s.destroyed && !s.disengaged)
  const ownsTable = active.every((s) => fleet.some((f) => f.id === s.id))
  if (ownsTable && game.firingStepIndex < FIRING_STEPS.length - 1) {
    return [{ type: 'advance-firing-step' }]
  }
  return []
}

/**
 * The group this side intends to bring in on a coordinated step: unfired
 * scan-2+ hulls with a live shot at the squadron's focus target, at the
 * largest head count every member's scan can cover (H4.5.1), fired on the
 * step the group's best scan calls (H4.5.5).
 */
function plannedCoordinatedGroup(
  game: GameState,
  own: ShipState[],
  difficulty: AiDifficulty,
): { shipIds: string[]; targetId: string; stepIndex: number } | null {
  if (own.length === 0) return null
  const focusId = focusTargetFor(game, own[0], difficulty)
  const target = focusId ? game.ships.find((s) => s.id === focusId) : null
  if (!target) return null
  if (attackAllowed(game, own[0], target)) return null // the faction's attack is spent
  const candidates = own
    .filter((s) => !positionHidden(game, s) && tacticalScanOf(game, s) >= 2)
    .filter(
      (s) =>
        bestVolley(game, s, difficulty, focusId, { onlyTargetId: focusId!, noPrecision: true }) !==
        null,
    )
    .sort((a, b) => tacticalScanOf(game, b) - tacticalScanOf(game, a) || (a.id < b.id ? -1 : 1))
  let size = 0
  while (size < candidates.length && tacticalScanOf(game, candidates[size]) >= size + 1) size++
  if (size < 2) return null
  let members = candidates.slice(0, size)
  const stepFor = coordinatedStepFor(tacticalScanOf(game, members[0]))
  if (!stepFor) return null
  if (stepFor.maxShips !== null && members.length > stepFor.maxShips) {
    members = members.slice(0, stepFor.maxShips)
  }
  return { shipIds: members.map((s) => s.id), targetId: target.id, stepIndex: stepFor.index }
}

/**
 * The side's shared point-defense tally. Every ship of a side computes the
 * same list: enemy homing counters in flight against the side's hulls, most
 * urgent first (closest to landing, then by id), and each is assigned at
 * most one ready PD mount per pass — the pass re-runs as the drive loop
 * turns, so survivors draw second shots only after every counter has drawn
 * its first. Both warhead types reward the spread: a missile's kill
 * threshold accumulates across hits (F13.2), a particle warhead is worn
 * down point by point (F1.16.2).
 *
 * Every PD weapon in the book is a main gun with a point-defense mode, and
 * an interception discharges the mount like any shot — so only IDLE guns
 * intercept: mounts with no firing solution on any visible enemy hull this
 * phase. Measured the other way first: eagerly trading main-battery volleys
 * for warhead wear turned a +26 Union margin into −16 across the raid
 * season. Free shots only — which is most of them, since the launch window
 * is exactly when the raiders sit cloaked or out of reach.
 */
function fleetPointDefense(game: GameState, fleet: ShipState[], memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []
  for (const side of [...new Set(fleet.map((s) => s.side))].sort()) {
    const own = fleet.filter((s) => s.side === side)
    const ownIds = new Set(own.map((s) => s.id))
    const incoming = game.homing
      .filter(
        (hw) =>
          !hw.destroyed &&
          !hw.impacted &&
          !hw.tractored &&
          hw.phasesFlown >= 1 &&
          ownIds.has(hw.targetId),
      )
      .filter((hw) => {
        // Only counters that will actually land are worth the arming: a
        // seeker still chasing a maneuvering hull may simply run out of
        // endurance (E5.3), and warhead points worn off a torpedo that
        // would have expired anyway are main-battery rounds thrown away.
        // "Will land" ≈ its next leg covers the gap.
        const def = homingWeaponDef(game, hw)
        const target = game.ships.find((s) => s.id === hw.targetId)
        if (!def || !target) return false
        return (
          actualRange(hw.position, target.placement.position) <=
          Math.min(speedInPhase(def, hw.phasesFlown + 1), hw.maxSpeed)
        )
      })
      .sort((a, b) => {
        const ta = game.ships.find((s) => s.id === a.targetId)!
        const tb = game.ships.find((s) => s.id === b.targetId)!
        const da = actualRange(a.position, ta.placement.position)
        const db = actualRange(b.position, tb.placement.position)
        return da - db || (a.id < b.id ? -1 : 1)
      })
    if (incoming.length === 0) continue

    const mounts = own.flatMap((ship) => {
      const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
      const idle = (mount: WeaponSystemDef['mounts'][number], weapon: WeaponSystemDef) =>
        !enemies.some((enemy) => {
          const range = actualRange(ship.placement.position, enemy.placement.position)
          if (!weapon.brackets.some((b) => range >= b.min && range <= b.max)) return false
          return canBearOn(
            mount.arcs,
            arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position),
          )
        })
      return ship.form.weapons.flatMap((weapon) =>
        weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
          ? weapon.mounts.flatMap((mount, mountIndex) =>
              mountIsReady(weapon, mountIndex, ship.mounts[weapon.id][mountIndex]) &&
              idle(mount, weapon)
                ? [{ ship, weapon, mount, mountIndex }]
                : [],
            )
          : [],
      )
    })

    const spent = new Set<string>()
    for (const hw of incoming) {
      const shot = mounts.find(({ ship, weapon, mount, mountIndex }) => {
        const key = `${ship.id}|${weapon.id}|${mountIndex}`
        if (spent.has(key)) return false
        // One attempt per mount per counter per phase: a refusal the doctrine
        // did not foresee must not be re-argued every drive iteration.
        if (memo.done.has(`pdshot:${game.round}:${game.phase}:${key}:${hw.id}`)) return false
        const range = actualRange(ship.placement.position, hw.position)
        if (!weapon.brackets.some((b) => range >= b.min && range <= b.max)) return false
        return canBearOn(
          mount.arcs,
          arcTo(ship.placement.position, ship.placement.heading, hw.position),
        )
      })
      if (!shot) continue
      const key = `${shot.ship.id}|${shot.weapon.id}|${shot.mountIndex}`
      spent.add(key)
      memo.done.add(`pdshot:${game.round}:${game.phase}:${key}:${hw.id}`)
      actions.push({
        type: 'fire-small-target',
        attackerId: shot.ship.id,
        targetId: hw.id,
        weaponId: shot.weapon.id,
        mountIndex: shot.mountIndex,
      })
    }
  }
  return actions
}

/** Total distance a homing weapon covers over its whole endurance (E5.3). */
function totalFlight(weapon: Parameters<typeof endurance>[0]): number {
  let total = 0
  for (let phase = 1; phase <= endurance(weapon); phase++) total += speedInPhase(weapon, phase)
  return total
}

/**
 * Launch armed homing mounts — as a wave, not a dribble. A lone seeker is
 * the easiest thing on the board to kill: point defense concentrates on it,
 * a tractor beam snags it (E5.6), and the shot is wasted. Two arriving
 * together split the defense. So when exactly one mount is ready but another
 * is partway through its arming, a trained captain holds the shot a round
 * and lets the salvo form — unless the target is already broken and any hit
 * might finish it, or the scoreboard says waiting is losing.
 */
function homingLaunches(
  game: GameState,
  ship: ShipState,
  memo: AiMemo,
  difficulty: AiDifficulty,
): GameAction[] {
  const actions: GameAction[] = []
  const homing = ship.form.weapons.filter(isHoming)

  let ready = 0
  let forming = 0
  for (const weapon of homing) {
    weapon.mounts.forEach((mount, i) => {
      const state = ship.mounts[weapon.id][i]
      if (state.damage >= mount.hitBoxes) return
      if (mountIsReady(weapon, i, state)) ready++
      else if (state.armed > 0) forming++
    })
  }

  for (const weapon of homing) {
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
      const level = damageLevel(target)
      const holdForWave =
        ready === 1 &&
        forming > 0 &&
        level !== 'heavy' &&
        level !== 'crippled' &&
        postureOf(game, ship, difficulty) !== 'press'
      if (holdForWave) return
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

/**
 * The squadron's kill priority: one ship, brought down together. A half-dead
 * enemy still shoots at full effect, so spreading a fleet's fire is the
 * classic amateur error — the focus target is the enemy whose destruction
 * buys the most safety soonest: highest estimated threat over least
 * remaining structure. Pure and deterministic, so every ship of the side
 * computes the same answer without needing to talk.
 */
function focusTargetFor(game: GameState, ship: ShipState, difficulty: AiDifficulty): string | null {
  if (difficulty === 'ensign') return null
  const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  if (enemies.length === 0) return null
  const own = game.ships.filter((s) => s.side === ship.side && !s.destroyed && !s.disengaged)
  let best: string | null = null
  let bestScore = -Infinity
  for (const enemy of enemies) {
    const nearestOwn = nearest(enemy, own)
    if (!nearestOwn) continue
    const danger = estimatedVolleyDamage(enemy, nearestOwn.placement.position, 0)
    const score = danger / (structureRemaining(enemy) + 4)
    if (score > bestScore || (score === bestScore && best !== null && enemy.id < best)) {
      bestScore = score
      best = enemy.id
    }
  }
  return best
}

function bestVolley(
  game: GameState,
  ship: ShipState,
  difficulty: AiDifficulty,
  focusId: string | null = null,
  opts: { onlyTargetId?: string; noPrecision?: boolean } = {},
): GameAction | null {
  const obstacles = terrainObstacles(game.scenario.terrain)
  /**
   * Untouchable: kiting an out-reached swarm from a band where no enemy's
   * expected volley registers at all. From there every rule of fire
   * discipline inverts — red dice the defender rerolls are still free
   * damage when nothing answers, and a slow-armed heavy discharged into a
   * red bracket costs nothing it would otherwise be doing.
   */
  const visibleForKite = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  const untouchable =
    difficulty === 'admiral' &&
    kiteBand(game, ship, visibleForKite) !== null &&
    visibleForKite.every(
      (e) => estimatedVolleyDamage(e, ship.placement.position, ship.sensors.jamming) === 0,
    )
  let best: {
    targetId: string
    mounts: Array<{ weaponId: string; mountIndex: number }>
    score: number
    allRed: boolean
    range: number
    level: ReturnType<typeof damageLevel>
    effective: number
  } | null = null

  for (const enemy of enemiesOf(game, ship)) {
    if (positionHidden(game, enemy)) continue
    if (opts.onlyTargetId && enemy.id !== opts.onlyTargetId) continue
    // H4.3.1: a faction attacks each target once per phase. A group member
    // fires under its group's declared attack; everyone else must pick a
    // hull the faction has not spent its attack on.
    if (game.coordinatedFire && !opts.onlyTargetId && attackAllowed(game, ship, enemy)) continue
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
        /**
         * A slow-arming heavy (diamond gates: multiple rounds to charge) is
         * held out of red-bracket volleys — spending rounds of arming on
         * dice the defender rerolls is the worst trade on the ship. It
         * waits for its green window, unless the target is broken and any
         * dice will do. The ensign has no such patience.
         */
        if (
          difficulty !== 'ensign' &&
          !untouchable &&
          bracket.bracket.band === 'red' &&
          (mount.roundGates ?? []).some(Boolean) &&
          damageLevel(enemy) !== 'heavy' &&
          damageLevel(enemy) !== 'crippled'
        ) {
          return
        }
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
    // The squadron kills one ship at a time (fleet focus): a worthwhile
    // volley on the shared target beats a slightly better one elsewhere.
    if (enemy.id === focusId) score += 4

    const better =
      difficulty === 'ensign'
        ? // The ensign shoots whatever is closest and calls it gunnery.
          !best || actual < best.range || (actual === best.range && enemy.id < best.targetId)
        : !best || score > best.score || (score === best.score && enemy.id < best.targetId)
    if (better) {
      best = { targetId: enemy.id, mounts, score, allRed, range: actual, level, effective }
    }
  }

  if (!best) return null

  /**
   * Fire discipline is rank. An all-red volley hands the defender rerolls
   * (E1.2.3), and the discharged batteries cost next round's arming points —
   * a phase of patience usually converts those dice to yellow or green. The
   * ensign bangs away regardless; a trained captain holds the long shot
   * unless the target is already broken and worth finishing at any odds —
   * or the scoreboard says holding is losing, and any dice beat none.
   */
  if (
    difficulty !== 'ensign' &&
    !opts.onlyTargetId && // a declared group's attack is already spent — take the shot
    !untouchable && // free damage is never held
    best.allRed &&
    best.level !== 'heavy' &&
    best.level !== 'crippled' &&
    postureOf(game, ship, difficulty) !== 'press'
  ) {
    return null
  }

  const target = game.ships.find((s) => s.id === best!.targetId)!

  /**
   * Land the damage on the weak shield. When the geometry sits on an arc
   * boundary the attacker nominates which facing shield is struck (E6.2
   * Step 4). Weak means what the table knows: printed strength minus the
   * absorption everyone has watched that side soak — so a facing this ship
   * has been hammering stays the target of choice even when its printed
   * strength matches its neighbour's. The ensign takes what it is given.
   */
  let chosenShield: ShieldSide | undefined
  if (difficulty !== 'ensign') {
    const options = shieldsFacing(
      ship.placement.position,
      target.placement.position,
      target.placement.heading,
    )
    if (options.length > 1) {
      chosenShield = [...options].sort(
        (a, b) =>
          estimatedShieldRemaining(game, target, a) - estimatedShieldRemaining(game, target, b),
      )[0]
    }
  }

  /**
   * The admiral's scalpel: a broken ship at knife range, engaged by an
   * all-PREC battery, takes precision fire on its weapons section (E9) —
   * the kill matters less than the silence.
   */
  const precision =
    !opts.noPrecision && // no member of a coordinated group may use it (H4.6.2)
    difficulty === 'admiral' &&
    (best.level === 'heavy' || best.level === 'crippled') &&
    best.effective <= 8 &&
    best.mounts.length > 0 &&
    best.mounts.every((m) => {
      const weapon = ship.form.weapons.find((w) => w.id === m.weaponId)!
      return traitValue(weapon, 'PREC') !== null
    })

  return {
    type: 'fire-volley',
    attackerId: ship.id,
    targetId: best.targetId,
    mounts: best.mounts,
    // At extreme range the admiral fires proximity-fused: rerolled blanks and
    // half damage beat full damage that never lands (E3.3).
    mode: precision ? 'precision' : difficulty === 'admiral' && best.allRed ? 'proximity' : 'standard',
    precisionSection: precision ? 'weapons' : undefined,
    degraded: false,
    chosenShield,
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

function planDisengagement(
  game: GameState,
  fleet: ShipState[],
  difficulty: AiDifficulty = 'captain',
): GameAction[] {
  const actions: GameAction[] = []
  for (const ship of fleet) {
    if (!wantsToLeave(game, ship, difficulty)) continue
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
