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
  commandStateFor,
  shipUnderCloakRestrictions,
  terrainObstacles,
  tractorBeamsFree,
  tractorBeamsReady,
  maxSystemOf,
  victoryPoints,
  type GameState,
} from './game'
import {
  displaceRefusal,
  displacedPosition,
  linkBetween,
  relativeSize,
  tractorBeams,
  tractorPower,
  tractorReach,
  TRACTOR_RANGE,
} from './tractor'
import { FIRING_STEPS, coordinatedStepFor, mayFireAlone, stepMatchesScan } from './coordinatedFire'
import {
  assignedPoints,
  COMMAND_RANGE,
  commandPointsAvailable,
  commandSystemBoxes,
} from './command'
import {
  cloakFullyPowered,
  cloakOperational,
  cloakStrength,
  isCloaked,
  maneuverAllowedWhileCloaked,
  mayDecloak,
  positionIsHidden,
} from './cloaking'
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
  genSysSetting,
  sensorFunctionCap,
  crewIsArmed,
  shieldGeneratorRating,
  structureRemaining,
  turnTemplateAt,
  type ShipState,
} from './shipState'
import {
  boardersAboard,
  boardingSides,
  isCaptured,
  MAX_ATTACKERS_PER_SQUAD,
} from './boarding'
import { endurance, isHoming, speedInPhase } from './homing'
import { shieldsAllDown, transportCapacity, transporterRange } from './operations'
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
  difficulty: AiDifficulty = 'admiral',
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
    case 'delayed-action':
      // The tractor shove waits until everyone has moved (J3.5.2), which in
      // this engine is the far side of the Navigation Segment.
      return difficulty === 'admiral' ? planDisplacement(game, fleet, memo) : []
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
  // Never go dark on a phase we could be shooting: H6.4.2 locks the weapons of
  // a cloaked ship completely, so a cloak engaged over a live firing solution
  // is a volley thrown away.
  if (firingSolution(game, ship)) return false
  const enemy = nearest(ship, enemiesOf(game, ship).filter((e) => !positionHidden(game, e)))
  const hurt = ['moderate', 'heavy', 'crippled'].includes(damageLevel(ship))
  const far = !enemy || actualRange(ship.placement.position, enemy.placement.position) > preferredRange(ship) + 8
  return hurt || far
}

/**
 * Is there something worth decloaking for — a charged gun and a target it can
 * actually reach?
 *
 * The old test was "is the nearest *visible* enemy inside preferred range",
 * which failed twice over. It never asked whether the guns were charged, so a
 * ship could come out of the dark with nothing loaded; and it read the nearest
 * enemy that was *not* itself hidden, so two cloaked ships each saw an empty
 * table, each stayed dark, and neither ever fired. Measured, that is exactly
 * what happened: an INVICTUS against an IMPERATOR went forty games without
 * either side scoring a single kill.
 */
function firingSolution(game: GameState, ship: ShipState): boolean {
  const loaded = ship.form.weapons.some((w) =>
    (ship.mounts[w.id] ?? []).some((m) => m.armed > 0),
  )
  if (!loaded) return false
  // A ghost we have detected counts as a target; one still hidden does not,
  // because there is nothing on the table to shoot at (H6.2.2).
  const targets = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
  if (targets.length === 0) return false
  const closest = nearest(ship, targets)!
  const range = actualRange(ship.placement.position, closest.placement.position)
  /*
   * The envelope of a loaded gun, not its favourite range — and the margin is
   * what breaks a deadlock the first draft walked straight into.
   *
   * A cloaked ship's targeting is zeroed by the rules (H6.4.4), and the
   * captain reads its own targeting when it asks whether a plot leaves it a
   * shot. So a cloaked ship scores every position on the board as worthless
   * and stops closing — while a gate that only opens at short range waits for
   * a closure that will never come. It will not decloak until it is close and
   * it cannot get close until it decloaks; measured, an Aurelian raider held
   * that stalemate for twelve rounds at fourteen inches with full tubes.
   *
   * Coming out at the edge of the envelope is also the better doctrine: the
   * cloak covers the long crossing, and the ship fights the last stretch with
   * its eyes open and its guns live.
   */
  const reach = Math.max(
    0,
    ...ship.form.weapons
      .filter((w) => (ship.mounts[w.id] ?? []).some((m) => m.armed > 0))
      .map((w) => Math.max(...w.brackets.map((b) => b.max))),
  )
  return range <= reach + 6
}

/**
 * The ghost this fleet should all be hunting.
 *
 * Detection is recorded per searcher (H6.9.3) and the ship's exposure is the
 * best any one of them holds, so spreading searches across several ghosts
 * gains nothing that concentrating on one does not gain faster. Nearest
 * first — search range is finite (H6.11) and the near one is the one about to
 * be a problem.
 */
function huntedGhost(game: GameState, ship: ShipState): ShipState | null {
  const ghosts = enemiesOf(game, ship).filter((e) => positionHidden(game, e))
  return ghosts.length > 0 ? nearest(ship, ghosts) : null
}

// ---------------------------------------------------------------------------
// Resource Allocation (B2): weapons first, then eyes, then legs
// ---------------------------------------------------------------------------

/**
 * The order a captain spends its reactor in.
 *
 * This is the most-executed decision the AI makes — a few thousand `allocate`
 * actions in a handful of battles — and it is a strict priority list rather
 * than an optimisation: each step takes what it wants and the next step sees
 * what is left. So the *order* is the doctrine, and moving one entry is a real
 * change. The flag bridge (H5.1.3) was worth ten games a season purely by
 * being bought before the small change instead of after it.
 *
 * Kept as data so the sweep harness can permute it (`setAllocationOrder`)
 * without the order being retyped in prose each time it moves.
 */
export type AllocationStep =
  | 'cloak'
  | 'ftl-escape'
  | 'slow-arming'
  | 'closing-accel'
  | 'weapons'
  | 'scout'
  | 'sensors-2'
  | 'flag-gen-sys'
  | 'accel-1'
  | 'sif'
  | 'shield-repair'
  | 'shield-reinforce'
  | 'sensors-full'
  | 'accel-2'
  | 'battery-recharge'

/*
 * Searched, not chosen. The starvation telemetry said the reactor runs dry
 * long before the list ends — shield repair drew four points of power across
 * thirty battles and was refused five thousand times — so the sweep asked what
 * happens if the unfunded defensive steps come up past the marginal offensive
 * ones. Holding the opponent fixed and moving only the admiral (`npm run
 * sweep`, three seasons, 576 games a candidate):
 *
 *     baseline                    355/576
 *     sif-last                    374
 *     repair-before-sensors2      386
 *     shields-before-sensors2     397
 *     shields-before-accel1       403
 *     repair-early+reinforce-last 412   ← this order
 *     shields-before-weapons      329
 *     accel1-before-sensors2      328
 *
 * Two things fall out of it. Repairing a shot-away shield box (G1.3.3) is
 * worth more than the second sensor point or the first drive point, by a
 * margin nothing else measured here comes close to. And it is specifically the
 * *repairs*: moving reinforcement (G1.3.2) up with them scored 403, moving it
 * to the very back scored 412, so the temporary point was diluting the
 * permanent one. Guns still come first — putting shields ahead of the weapons
 * lost 26 games, which is the sanity check that this is a priority list and
 * not a preference for defence.
 */
export const DEFAULT_ALLOCATION_ORDER: AllocationStep[] = [
  'cloak',
  'ftl-escape',
  'slow-arming',
  'closing-accel',
  'weapons',
  'scout',
  'sensors-2',
  'flag-gen-sys',
  'shield-repair',
  'accel-1',
  'sif',
  'sensors-full',
  'accel-2',
  'battery-recharge',
  'shield-reinforce',
]

let allocationOrder: AllocationStep[] = DEFAULT_ALLOCATION_ORDER

/**
 * Sweep hook: install an order to measure, or `null` for the standing one.
 *
 * It binds to the admiral alone, and that is the measurement rather than a
 * doctrine choice. A season is the admiral against a fixed lower rank; change
 * both sides and a real improvement shows up as no change at all, because both
 * captains got it. Every other trick in this file is admiral-gated for the
 * same reason.
 */
export function setAllocationOrder(order: AllocationStep[] | null): void {
  allocationOrder = order ?? DEFAULT_ALLOCATION_ORDER
}

/**
 * Sweep hook: while set, records `<step>:spent` and `<step>:starved` so a run
 * can show which steps actually compete for the reactor. A step that is never
 * starved cannot be improved by moving it earlier, which is most of them.
 */
let allocationTelemetry: Record<string, number> | null = null
export function setAllocationTelemetry(sink: Record<string, number> | null): void {
  allocationTelemetry = sink
}

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
    let step: AllocationStep = 'cloak'
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
        .reduce((sum, sub) => sum + sub.powerCost, 0)
      if (cost > budget) {
        if (allocationTelemetry) {
          allocationTelemetry[`${step}:starved`] = (allocationTelemetry[`${step}:starved`] ?? 0) + 1
        }
        return
      }
      budget -= cost
      if (allocationTelemetry) {
        allocationTelemetry[`${step}:spent`] = (allocationTelemetry[`${step}:spent`] ?? 0) + cost
      }
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

    /*
     * The same point would buy a tractor beam that can actually be used — MAX
     * doubles its reach from one inch to two and doubles the lock-on roll
     * (J3.1.3, J3.3.1) — and it is deliberately *not* bought here.
     *
     * Measured: buying it whenever an enemy was within eight inches declared
     * TRAC as the phase's maximum system 235 times across 48 games and landed
     * exactly one lock, at a cost of eight games a season on the duel. Eight
     * inches is a round's travel, but a round's travel is also how a pass
     * works — the ships that are eight inches apart at allocation are usually
     * six inches apart at their closest. The power point belongs to the guns.
     *
     * Tightening the horizon does not rescue it. At three inches — genuine
     * knife range, where a grab during the round is close to certain — the
     * three seasons read 96W-96L, 120W-72L and 116W-76L against baselines of
     * 105, 126 and 122. The power point is worth more in the guns than the
     * beam can ever return, at any horizon.
     *
     * A flagship that bought GEN SYS MAX for its command bridge (H5.1.3) still
     * gets the beam at MAX, because that point is already spent: `planTractors`
     * names TRAC as the maximum system when there is something in reach.
     */

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

    const steps: Record<AllocationStep, () => void> = {
      // A cloak is all or nothing (H6.3.1), and it comes before the guns it
      // will lock anyway (H6.4.2).
      cloak: () => {
        if (!wantsCloak(game, ship, difficulty)) return
        const line = ship.form.functions.find((l) => l.label === 'CLOAK')
        if (line) fill(line.id, line.steps.length)
      },
      // A ship that intends to leave powers the drive that leaves (J9.1.3) —
      // before the guns, because a departing hull's volley is worth less than
      // the points its escape denies.
      'ftl-escape': () => {
        if (difficulty === 'ensign' || !wantsToLeave(game, ship, difficulty)) return
        const line = ship.form.functions.find((l) => l.kind === 'ftl-drive')
        if (line) fill(line.id, line.steps.length)
      },
      'slow-arming': () => {
        if (!closingRound) return
        for (const line of byKind('weapon')) {
          if (weaponAlive(line) && slowArming(line)) fill(line.id, line.steps.length)
        }
      },
      // The admiral also floors the throttle: two drive points now, before
      // the sensors take theirs, buys the merge a round early. Measured as
      // an admiral-only edge — when every rank races, the closings get so
      // fast that dice swamp doctrine and the rank gap flattens; held back
      // for the admiral it keeps the season won at every level.
      'closing-accel': () => {
        if (!closingRound || difficulty !== 'admiral') return
        for (const line of byKind('accel')) fill(line.id, 2)
      },
      // Weapons full — the auto-arm rule then spends the points (E4.2.2).
      weapons: () => {
        for (const line of byKind('weapon')) if (weaponAlive(line)) fill(line.id, line.steps.length)
      },
      // Scout sensors earn their power: they illuminate for the whole fleet (H3.4).
      scout: () => {
        if (difficulty === 'ensign' || !ship.form.scoutSensor) return
        const line = ship.form.functions.find(
          (l) => l.kind === 'special' && /SCOUT/i.test(l.label),
        )
        if (line) fill(line.id, line.steps.length)
      },
      'sensors-2': () => {
        for (const line of byKind('sensor')) fill(line.id, Math.min(2, line.steps.length))
      },
      /*
       * The flag bridge (H5.1.3), bought before the small change rather than
       * after it. CMND boxes produce nothing at all unless the ship's GEN SYS
       * line is at MAX, so a squadron flagship has to spend a power point on it
       * deliberately or carry the boxes as decoration — and left at the end of
       * the queue it never got one, because the guns and the eyes had already
       * taken everything. Measured that way the whole system stayed dark: the
       * squadron season did not move by a single game out of 192.
       *
       * Only where there is somebody in range to lend to, and only above ensign.
       */
      'flag-gen-sys': () => {
        if (difficulty === 'ensign' || commandSystemBoxes(ship) === 0) return
        if (genSysSetting(ship) === 'max') return
        const consorts = fleet.filter(
          (s) =>
            s.id !== ship.id &&
            s.side === ship.side &&
            !s.destroyed &&
            !s.disengaged &&
            actualRange(ship.placement.position, s.placement.position) <= COMMAND_RANGE,
        )
        if (consorts.length > 0) for (const line of byKind('gen-sys')) fill(line.id, line.steps.length)
      },
      'accel-1': () => {
        for (const line of byKind('accel')) fill(line.id, 1)
      },
      // Turning hard is doctrine now, and SIF is what makes it survivable — a
      // practiced captain powers it before the stress arrives, not after.
      sif: () => {
        if (difficulty === 'ensign' && ship.stressMarkers === 0) return
        for (const line of byKind('sif')) fill(line.id, 1)
      },
      'shield-repair': () => {
        const repairs = byKind('shield-repair').filter(
          (line) => line.shieldSide && ship.blueShieldDamage[line.shieldSide] > 0,
        )
        repairs.sort((a, b) => {
          const at = threatened.includes(a.shieldSide!) ? 0 : 1
          const bt = threatened.includes(b.shieldSide!) ? 0 : 1
          return at - bt
        })
        for (const line of repairs) fill(line.id, 1)
      },
      'shield-reinforce': () => {
        for (const line of byKind('shield-reinforce')) {
          if (line.shieldSide && threatened.includes(line.shieldSide)) fill(line.id, 1)
        }
      },
      // Spare change: deeper sensors, then a second acceleration point.
      'sensors-full': () => {
        for (const line of byKind('sensor')) fill(line.id, line.steps.length)
      },
      'accel-2': () => {
        for (const line of byKind('accel')) fill(line.id, 2)
      },
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
      'battery-recharge': () => {
        if (!doctrine) return
        const empty = ship.batteryCharged.filter((c, i) => !c && !ship.batteryDamaged[i]).length
        if (empty > 0) for (const line of byKind('battery-recharge')) fill(line.id, empty)
      },
    }

    const order = difficulty === 'admiral' ? allocationOrder : DEFAULT_ALLOCATION_ORDER
    for (const name of order) {
      step = name
      steps[name]()
    }
  }

  /*
   * Command systems (H5), plotted here because the assignment is made during
   * Resource Allocation (H5.2.1) and the command ship is re-designated every
   * round (H5.1.6).
   *
   * This is the one system the captain used to pay for and never switch on.
   * A command ship lends tactical scan to its squadron, and H5.2.2 lets a
   * lent point push a ship *past* the cap its own sensor rating imposes —
   * which is the only way in the game to buy initiative a hull cannot buy for
   * itself. Firing order decides who shoots first, and under the
   * one-opportunity rule that often decides who shoots at all.
   */
  if (difficulty !== 'ensign' && actions.length === 0) {
    for (const side of new Set(fleet.map((s) => s.side))) {
      const ours = fleet.filter((s) => s.side === side && !s.destroyed && !s.disengaged)
      const state = commandStateFor(game, side)

      // The best flag available: most points on offer, flagship staff
      // included, and never a cloaked one — H6.4.10 puts its command systems
      // out with the cloak.
      const candidates = ours.filter(
        (s) => !shipUnderCloakRestrictions(game, s) && (commandSystemBoxes(s) > 0 || s.flagship),
      )
      if (candidates.length === 0) continue
      const flag = candidates.reduce((best, s) =>
        commandSystemBoxes(s) + (s.flagship ? 2 : 0) > commandSystemBoxes(best) + (best.flagship ? 2 : 0)
          ? s
          : best,
      )
      if (state.commandShipId !== flag.id) {
        actions.push({ type: 'set-command-ship', side, shipId: flag.id })
        continue // the designation clears the assignments; lend next pass
      }

      const budget = commandPointsAvailable(flag)
      if (budget <= 0) continue

      /*
       * Who gets them. A point is worth most to a ship that is about to
       * shoot and cannot bid higher on its own — so the queue is by how
       * badly the hull is capped: sensor rating first, then the guns it
       * would fire. The flag keeps at most one for itself (H5.2.3).
       */
      const receivers = ours
        .filter(
          (s) =>
            !shipUnderCloakRestrictions(game, s) &&
            actualRange(flag.placement.position, s.placement.position) <= COMMAND_RANGE,
        )
        .sort((a, b) => {
          const cap = (x: ShipState) => sensorFunctionCap(x)
          const guns = (x: ShipState) => x.form.weapons.reduce((n, w) => n + w.mounts.length, 0)
          return cap(a) - cap(b) || guns(b) - guns(a)
        })

      let left = budget
      for (const s of receivers) {
        if (left <= 0) break
        const most = s.id === flag.id ? 1 : left
        const points = Math.min(most, left)
        if (assignedPoints(state, s.id) === points) {
          left -= points
          continue
        }
        actions.push({ type: 'assign-command', side, targetId: s.id, points })
        left -= points
      }
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
  /** C3.9.1 — turn at less than the table allows. Undefined means full rate. */
  turnRate?: number
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
    // C3.9.1: a turn may be taken at any rate up to the one the table allows,
    // and the captain now shops among them rather than always swinging the
    // full template. `null` puts the card back on the full rate.
    if ((card.turnRate ?? null) !== (plan.turnRate ?? null)) {
      actions.push({ type: 'plot-turn-rate', shipId: ship.id, rate: plan.turnRate ?? null })
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
    /*
     * Cloak sensor doctrine (H6.4.4, H6.16.2), which the rules make blunt.
     *
     * A cloaked ship's jamming *is* its cloak strength: `cloakStrength` reads
     * the jamming figure straight off the card, and a searcher whose targeting
     * is below it may not attempt a search at all (H6.10.2). Meanwhile H6.4.4
     * says targeting points do nothing while cloaked, and H6.4.2 says the ship
     * cannot fire — so Tactical Scan, which buys nothing but firing order, is
     * equally dead weight. Every available point therefore belongs in jamming,
     * and any point anywhere else is thrown away twice.
     */
    const myCloak = cloakOf(game, ship)
    if (myCloak && isCloaked(myCloak)) {
      /*
       * Jamming takes first call, up to the per-function cap, and the rest
       * falls through to targeting.
       *
       * Not zero targeting, which was the first draft and was wrong twice.
       * The card is plotted in the Command Segment, the cloak comes off during
       * Operations, and the volley is fired in Combat — so targeting bought
       * while dark is targeting the ship shoots with a segment later. And the
       * captain reads its own targeting when it asks "would this plot give me
       * a shot": zero it and every position on the board scores as worthless,
       * which is exactly what happened. An Aurelian raider sat cloaked at
       * fourteen inches with both plasma tubes charged 6 of 6 and never closed,
       * because with no targeting there was nothing to close for.
       */
      jamming = Math.min(cap, available)
      targeting = Math.min(cap, Math.max(0, available - jamming))
      tacticalScan = Math.min(cap, Math.max(0, available - jamming - targeting))
    } else {
      /*
       * The hunter's side of the same rule. Targeting below the ghost's
       * jamming forbids a search outright, equal targeting rolls a single
       * die, and only targeting *above* it rolls in numbers
       * (targeting - jamming). So against a ghost the first call on the
       * sensor line is to outbid its jamming — initiative and brackets are
       * worth nothing against a ship that cannot be shot at in the first
       * place (H6.2.2).
       */
      const ghost = huntedGhost(game, ship)
      if (ghost && difficulty !== 'ensign') {
        const theirJamming = cloakStrength(ghost)
        const bid = Math.min(cap, available, theirJamming + 2)
        if (bid > targeting) {
          targeting = bid
          tacticalScan = Math.min(cap, Math.max(0, available - targeting))
          jamming = Math.min(cap, Math.max(0, available - targeting - tacticalScan))
        }
      }
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

  /*
   * H6.8.5(3): a cloaked ship that is still hidden may only fly straight,
   * slide, easy or standard — anything sharper is refused.
   *
   * The filter has to be here and not only in the rules, because the captain
   * cannot see a refusal. `plot-maneuver` returns its objection to the caller
   * and the driver throws the message away, so an AI that wants a hard turn
   * while cloaked re-plots the same illegal turn forever and the batch never
   * empties — a hung game, not a bad move. Found on an Aurelian hull, whose
   * plasma torpedoes die at nine inches and so want a hard turn badly, but it
   * was never that ship's fault: the printed INVICTUS I is cloaked and armed
   * the same way and will do it too.
   */
  const darkCloak = cloakOf(game, ship)
  const dark = !!darkCloak && positionIsHidden(darkCloak)
  const maneuvers: Array<[Maneuver, TurnDirection | null, number]> = (
    [
      ['straight', null, 0],
      ['easy', 'left', 0],
      ['easy', 'right', 0],
      ['standard', 'left', 0],
      ['standard', 'right', 0],
      ['hard', 'left', 1],
      ['hard', 'right', 1],
    ] as Array<[Maneuver, TurnDirection | null, number]>
  ).filter(([maneuver]) => !dark || maneuverAllowedWhileCloaked(maneuver))
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

  /*
   * Turn rates (C3.9.1). A turn may be taken at *any* rate up to the one the
   * table allows, and the captain used to take the full template every time —
   * so its only choices were "swing as hard as the ship can" or "fly
   * straight", with nothing in between. The printed counters offer 20 through
   * 60 degrees; the ones below this ship's allowance are real plots and the
   * scorer can now shop among them, which is what lets a battery be walked
   * onto a target instead of swept past it.
   *
   * Admiral only. It roughly triples the candidate space, and rank is meant
   * to be search depth.
   */
  const RATES = [20, 25, 30, 35, 40, 45, 60]
  const rateChoices = (maneuver: Maneuver, speed: number): Array<number | undefined> => {
    if (difficulty !== 'admiral' || maneuver === 'straight' || maneuver === 'slide') return [undefined]
    const allowed = turnTemplateAt(ship, speed)
    if (allowed <= 0) return [undefined]
    /*
     * Every printed template below the allowance, and the whole set is worth
     * the search. Trimming it to two — the gentlest and the next one down —
     * was tried to buy back the runtime, and it was worse than having no
     * rates at all: the squadron season fell to 102W-88L against 120W-72L
     * without the feature and 122W-68L with the full set. A partial menu is
     * not a cheaper version of the choice, it is a different and worse one.
     */
    return [undefined, ...RATES.filter((r) => r < allowed)]
  }

  for (const [maneuver, direction, stressCost] of maneuvers) {
    // Stress the ship cannot cancel is a real cost; near the rating, avoid it.
    if (stressCost > 0 && ship.stressMarkers + stressCost >= ship.form.stressRating) continue
    for (const accel of accels) {
     for (const turnRate of rateChoices(maneuver, ship.speed + accel)) {
      const candidate: CommandCard = {
        maneuver,
        direction,
        accel,
        turnRate,
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

      /*
       * The board edge is disengagement (S2.2.1) — a wall to a ship that means
       * to fight, the door itself to one that means to leave (J9.2.2).
       *
       * A ship that means to fight has to start turning away from it while it
       * still can, and how early that is depends entirely on the hull. This
       * used to be a flat penalty inside two inches of the boundary, which is
       * fine for something nimble and useless for something that is not: a
       * UNION dreadnought has no free acceleration at all, so it sheds one
       * point of speed a round and needs twenty inches to come to a stop. By
       * the time such a ship is two inches out it has already left; it just
       * does not know yet. It flew off the map in nearly every duel it did not
       * win outright, at full structure, with the enemy nearly dead — which
       * reads as a ship losing fights it was in fact winning.
       *
       * So the margin is the ship's own stopping distance, and the penalty
       * grows as the plot eats into it.
       *
       * That alone did not fix the dreadnought, because it asks the wrong
       * question: where does this plot *end*. A plot can end somewhere
       * perfectly safe and still be the one that dooms the ship, if it leaves
       * her at a speed the helm cannot answer at. C2.2.2 prints a `0` in the
       * turn row for the speeds at which a hull may not turn at all, and the
       * UNION dreadnoughts have one at their best speed — so the captain
       * accelerated into it while closing, then flew six phases of heading 270
       * through the enemy and out the far side at full structure. By the time
       * any single plot looked bad, every candidate was equally bad.
       *
       * So the second test looks a round further on: how far must this ship
       * travel before she can come about at all, and is there board left when
       * she gets there. That is the commitment a plot is really making, and it
       * is made several rounds before the edge arrives.
       *
       * Three things that did not work, recorded so nobody re-runs them.
       * Penalising a can't-turn speed outright fixes the dreadnought and costs
       * the admiral the duel season, 39W-24L to 22W-40L — sprinting where
       * there is room to sprint is good doctrine, so the cost has to attach to
       * the room and not to the speed. Folding the blind rounds into the
       * stopping margin lost baseline and changed nothing. A hard veto on
       * plots that leave the board did almost nothing, for the reason above.
       */
      const { width, height } = game.scenario.bounds
      const offBoard = (p: { x: number; y: number }) =>
        p.x < 0 || p.y < 0 || p.x > width || p.y > height
      if (fleeing) {
        if (offBoard(end.position)) score += 30
      } else {
        const brake = Math.max(1, accelerationBudget(ship))
        const speed = Math.abs(candidate.speed)

        /*
         * Where this plot commits her to. If the helm answers at this speed
         * that is the plot's own end; if it does not, she must first shed
         * speed to one that does, flying straight the whole way — three
         * phases to a round, at `speed` inches a phase.
         */
        let turnable = speed
        while (turnable > 0 && turnTemplateAt(ship, turnable) === 0) turnable -= 1
        const blindRounds = Math.ceil(Math.max(0, speed - turnable) / brake)
        const heading = headingVector(end.heading)
        const committed = {
          x: end.position.x + heading.x * blindRounds * speed * 3,
          y: end.position.y + heading.y * blindRounds * speed * 3,
        }
        // Ablated over eight printed-board duels: without this a UNION III
        // leaves in 7 of 8, with it in 4. Half the problem, and the half that
        // was costing the ship battles it was winning.
        if (blindRounds > 0 && offBoard(committed)) score -= 12

        // And the stopping distance proper: rounds to shed this speed, then
        // the ground covered doing it at an average of half of it.
        const rounds = Math.ceil(speed / brake)
        const margin = Math.max(2, (speed * rounds) / 2)
        const room = Math.min(
          end.position.x,
          end.position.y,
          width - end.position.x,
          height - end.position.y,
        )
        if (room < margin) {
          // Linear from nothing at the edge of the margin to a hard refusal
          // at the boundary itself, so a fast heavy turns early and a nimble
          // ship can still use the whole board.
          score -= 8 * (1 - Math.max(0, room) / margin)
        }
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

      /*
       * No speed discipline under cloak, deliberately, and it was tried.
       *
       * H6.4.6 gives a hidden ship's hunters a free search die for every point
       * of speed over CLOAK_SAFE_SPEED, so creeping looks like obvious cover.
       * Scored against the plot, it is a trap: penalising speed made *stopping*
       * the highest-scoring plot on the board, and an Aurelian raider spent
       * twelve rounds parked at speed 0, fully cloaked, with both plasma tubes
       * charged 6 of 6, fourteen inches from a target it never closed on.
       * Scoping the penalty to the final approach only moved the distance at
       * which it parked. A ship that never arrives never fires, and the search
       * dice it saved bought nothing. The cloak is for crossing; cross.
       */

      if (score > bestScore) {
        second = best
        secondScore = bestScore
        bestScore = score
        best = { maneuver, direction, accel, turnRate }
      } else if (score > secondScore) {
        secondScore = score
        second = { maneuver, direction, accel, turnRate }
      }
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
    // Cloak doctrine (H6.6, H6.7): vanish while crossing or wounded; come out
    // shooting once the guns are in their bracket.
    if (cloak && !cloaked && cloakFullyPowered(ship) && wantsCloak(game, ship, difficulty)) {
      actions.push({ type: 'engage-cloak', shipId: ship.id })
    } else if (cloak && cloaked && mayDecloak(cloak)) {
      /*
       * Come off the cloak for the shot, not for the range band. A cloaked
       * ship cannot fire at all (H6.4.2), so every phase spent dark with the
       * guns charged and a target in reach is a volley given away — and the
       * old rule, which only looked at distance, let a ship sit hidden beside
       * a target it could have killed. A wounded ship still hides, because a
       * wounded ship is trying to live.
       */
      const hurt = ['moderate', 'heavy', 'crippled'].includes(damageLevel(ship))
      if (!hurt && firingSolution(game, ship)) {
        actions.push({ type: 'decloak', shipId: ship.id })
      }
    }

    /*
     * Shake the hunters (H6.13). One blue die per enemy holding a Contact,
     * Track or Target Lock, and an 'M' drops that enemy a level — free upside
     * with no cost but the asking, so a hidden ship that has been found always
     * asks. H6.13.2 allows it once per Operations Segment, which the engine
     * now enforces; before that it was an unlimited reroll, and a captain
     * taught to try until it worked would have hung the game.
     *
     * It matters most at Track, which is the level where the ship can be
     * fired on at all (H6.14.3) — dropping back to Contact puts it out of
     * reach of the guns again.
     */
    if (cloak && cloaked && !cloak.evadedThisSegment) {
      const found = Object.values(cloak.detection).some((level) => level > 0)
      if (found) actions.push({ type: 'reduce-detection', shipId: ship.id })
    }

    // Hunt the ghosts: one search attempt per ship per phase (H6.9.2), and
    // the whole fleet hunts the same one — detection is per searcher and the
    // ship's exposure is the best of them, so concentration finds it sooner.
    if (!cloaked) {
      const ghost = huntedGhost(game, ship)
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

    // Breaking out of a beam is seamanship, not a trick: every rank resists.
    // Only the admiral goes looking for something to grab.
    actions.push(...planTractors(game, ship, difficulty))

    if (difficulty !== 'admiral') continue

    // The admiral's other trick with a cripple alongside: drop shields and put
    // the marines aboard (J5).
    const cripple = enemiesOf(game, ship).find(
      (e) => !positionHidden(game, e) && damageLevel(e) === 'crippled',
    )
    if (cripple) {
      const captureRange = actualRange(ship.placement.position, cripple.placement.position)
      if (
        !cloaked &&
        transportCapacity(ship) > 0 &&
        ship.marineSquads >= 2 &&
        captureRange <= transporterRange(ship, null) &&
        // J5.1.3 wants the shields down at *both* ends, and an enemy does not
        // oblige. Checking the far end first matters: without it this ship
        // stripped its own four shields to attempt a beam the rule was always
        // going to refuse, and stood there naked for a phase to do it.
        shieldsAllDown(cripple)
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
// J3 — the tractor beam as a weapon
// ---------------------------------------------------------------------------

/**
 * Tractor doctrine (J3), which is not "grab whatever is in reach".
 *
 * A lock does no damage. What it does is take speed away, and J3.3.4 takes it
 * away from *both* ships — so the beam is only a weapon when the fight it
 * freezes is one this ship is winning. The chart's asymmetry is the whole
 * tactic: a hull tied to something two classes larger crawls (speed 6 drops to
 * 2) while the larger one barely notices (6 drops to 4). Grab down the size
 * chart, never up it.
 *
 * The second use is the door: a ship held in a beam may not go to FTL
 * (J3.4.4). A cripple that has decided to go home does not get to, and a
 * cripple that stays is a cripple the guns finish — which is worth more than
 * the speed the beam costs to hold it.
 *
 * The reverse duty is here too. A ship caught in someone else's beam makes it
 * prove itself every phase (J3.6.1) — a free roll that costs the defender
 * nothing but the asking, so it is always asked.
 *
 * What this is worth, honestly: nothing measurable. The duel read 210W-174L
 * over 384 games against a 210W-174L baseline rate — the same number to the
 * game. The reason is geometry rather than doctrine. At NRM a beam reaches one
 * inch, which is less than a ship travels in a phase, so of 31 locks landed
 * across 48 battles, 25 lapsed by range (J3.6.2) in the same Navigation
 * Segment that made them. They are worth one phase of halved speed each and
 * then they are gone. The one thing that would fix it — GEN SYS at MAX, for
 * two inches and a doubled roll — costs a power point measured at eight games
 * a season, which is far more than the beam returns (see `planAllocation`).
 *
 * It stays because it is right rather than because it wins: three actions the
 * engine understood and no player ever sent are now sent, so a human who tows
 * one of these ships meets a captain that fights the beam instead of accepting
 * the tow.
 */
function planTractors(game: GameState, ship: ShipState, difficulty: AiDifficulty): GameAction[] {
  const actions: GameAction[] = []
  const beams = tractorBeams(ship)

  /*
   * Break out first. The attacker has to make its lock-on roll again, and a
   * failed roll ends the tow there and then — nothing is risked by asking, and
   * the engine allows the one attempt a phase (J3.6.1) that stops this from
   * being an unlimited reroll.
   */
  const captor = game.ops.links.find(
    (l) =>
      l.targetId === ship.id &&
      l.targetKind === 'ship' &&
      game.ships.find((s) => s.id === l.sourceId)?.side !== ship.side,
  )
  if (captor && !game.ops.contestedThisPhase.has(ship.id)) {
    actions.push({ type: 'contest-tractor', shipId: ship.id })
  }

  if (beams === 0 || difficulty !== 'admiral') return actions

  /*
   * Name the beam as this phase's one maximum system (J1.1.2) when there is
   * something close enough to be worth grabbing. It is worth naming: MAX
   * doubles the reach from one inch to two and doubles the lock-on roll
   * (J3.1.3, J3.3.1), and at NRM a beam that only reaches an inch almost never
   * gets to be used at all. It costs nothing the ship was otherwise spending —
   * the GEN SYS point is bought in allocation or it is not, and if it is not,
   * naming the system does nothing.
   */
  if (
    genSysSetting(ship) === 'max' &&
    maxSystemOf(game, ship) !== 'TRAC' &&
    enemiesOf(game, ship).some(
      (e) =>
        !positionHidden(game, e) &&
        actualRange(ship.placement.position, e.placement.position) <= TRACTOR_RANGE.max,
    )
  ) {
    actions.push({ type: 'set-max-system', shipId: ship.id, kind: 'TRAC' })
    // Plan the grab itself on the next pass, once the beam is at the power the
    // reach and the roll will actually be measured at.
    return actions
  }

  const power = tractorPower(ship, maxSystemOf(game, ship))
  const reach = tractorReach(power)

  /*
   * Let go when the tow stops paying. Two ways it can: the ship has decided to
   * leave, and a tow is the one thing a departing hull cannot afford to be in;
   * or the fight has turned, and the enemy this ship pinned to trade broadsides
   * with is now the one winning the trade. A cripple is never let go — that
   * lock is holding the door shut on its escape, not buying a firing position.
   */
  for (const link of game.ops.links) {
    if (link.sourceId !== ship.id || link.targetKind !== 'ship') continue
    const held = game.ships.find((s) => s.id === link.targetId)
    if (!held || held.side === ship.side) continue
    if (damageLevel(held) === 'crippled') continue
    const leaving = wantsToLeave(game, ship, difficulty)
    const losing = tradeAt(ship, held) < 0
    if (leaving || losing) {
      actions.push({ type: 'release-tractor', shipId: ship.id, targetId: link.targetId })
    }
  }

  // Beams that have not had their attempt this segment (J3.3.1). A lock this
  // ship cannot possibly roll is a wasted segment, so the reach test is the
  // honest one: three per blue die, doubled at MAX.
  const ready = tractorBeamsReady(game, ship)
  if (ready === 0) return actions
  const ceiling = ready * 3 * (power === 'max' ? 2 : 1)

  let prize: ShipState | null = null
  let best = -Infinity
  // H6.4.7 bars the beam in both directions while this ship is dark.
  if (shipUnderCloakRestrictions(game, ship)) return actions

  for (const enemy of enemiesOf(game, ship)) {
    if (positionHidden(game, enemy)) continue
    if (linkBetween(game.ops.links, ship.id, enemy.id)) continue
    if (game.ops.brokenThisPhase.has(`${ship.id}->${enemy.id}`)) continue
    if (actualRange(ship.placement.position, enemy.placement.position) > reach) continue
    if (enemy.form.sizeClass > ceiling) continue

    const crippled = damageLevel(enemy) === 'crippled'
    const relative = relativeSize(ship.form.sizeClass, enemy.form.sizeClass)
    // Tying this hull to something two classes larger hands the enemy the
    // better half of J3.3.4. The one thing worth that is a prize that would
    // otherwise jump out (J3.4.4).
    if (relative === 'larger' && !crippled) continue

    const trade = tradeAt(ship, enemy)
    // A hull that hurt is a hull leaving; the beam is what stops it.
    const running = crippled || damageLevel(enemy) === 'heavy'
    /*
     * The size chart decides this, not the gunnery. Two classes down, the
     * beam costs this ship a little and the other one most of its speed, and
     * that is worth taking whatever the guns are doing. At similar size the
     * cost is shared, so there has to be a reason: a hull trying to leave, or
     * a firing position this ship is currently winning.
     *
     * The gunnery read alone was the first version of this and it grabbed
     * nothing in 48 games — at the moment Operations runs, both sides' mounts
     * are usually still arming, so the trade reads a dead 0-0 and a gate of
     * "only when winning" rejects every candidate.
     */
    if (!(crippled || running || relative === 'smaller' || trade > 0)) continue

    const score = (crippled ? 100 : 0) + (running ? 20 : 0) + (relative === 'smaller' ? 10 : 0) + trade
    if (score > best) {
      best = score
      prize = enemy
    }
  }
  if (!prize) return actions

  /*
   * Commit everything that still has an attempt. J3.3.3 hands the excess back
   * at the end of the phase — only one beam is needed to hold a lock once it is
   * made — so there is nothing to save them for except an incoming missile,
   * and one beam is kept back for that when the sky has one in it and the roll
   * can still be made without it.
   */
  const spare = game.homing.length > 0 && (ready - 1) * 3 * (power === 'max' ? 2 : 1) >= prize.form.sizeClass
  actions.push({
    type: 'tractor-lock',
    shipId: ship.id,
    targetId: prize.id,
    beams: spare ? ready - 1 : ready,
  })
  return actions
}

/**
 * How the gunnery trade stands where these two are standing: this ship's
 * bearing, ready firepower on that one, less what it can answer with. Positive
 * means freezing the range with a beam freezes a fight this ship is winning.
 */
function tradeAt(ship: ShipState, enemy: ShipState): number {
  const mine = firepowerAt(ship, ship.placement, enemy.placement.position, enemy.speed <= 1)
  const theirs = firepowerAt(enemy, enemy.placement, ship.placement.position, ship.speed <= 1)
  return mine - theirs
}

/**
 * The shove (J3.5), taken after everyone has moved. One inch is not much, but
 * it is an inch chosen by the wrong side: put the towed ship where its own guns
 * bear worst and this fleet's bear best. Needs MAX on the beam and at least a
 * similar size class (J3.5.1), so it is rare — and it will not be used to push
 * a ship out of the beam that is holding it.
 */
function planDisplacement(game: GameState, fleet: ShipState[], memo: AiMemo): GameAction[] {
  const actions: GameAction[] = []
  for (const ship of fleet) {
    for (const link of game.ops.links) {
      if (link.sourceId !== ship.id || link.targetKind !== 'ship') continue
      const held = game.ships.find((s) => s.id === link.targetId)
      if (!held || held.side === ship.side) continue
      if (displaceRefusal(ship, held, game.ops.links, tractorPower(ship, maxSystemOf(game, ship)))) continue
      const key = `displace:${game.round}:${game.phase}:${link.id}`
      if (memo.done.has(key)) continue

      let bestDirection: 'F' | 'A' | 'P' | 'S' | null = null
      let best = 0
      for (const direction of ['F', 'A', 'P', 'S'] as const) {
        const to = displacedPosition(held, direction)
        // An inch that breaks this ship's own lock is an inch given away.
        if (actualRange(ship.placement.position, to) > tractorReach(link.power)) continue
        const theirs = firepowerAt(held, { position: to, heading: held.placement.heading }, ship.placement.position, false)
        const ours = fleet.reduce(
          (n, friend) => n + firepowerAt(friend, friend.placement, to, held.speed <= 1),
          0,
        )
        const score = ours - theirs
        if (bestDirection === null || score > best) {
          best = score
          bestDirection = direction
        }
      }
      if (!bestDirection) continue
      memo.done.add(key)
      actions.push({ type: 'displace-tractored', shipId: ship.id, targetId: held.id, direction: bestDirection })
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
/**
 * Whether the captain declares coordinated groups (H4.5).
 *
 * Off by default because it measures worse than firing individually — see the
 * note on `plans` in `planCoordinatedFiring`. The machinery is kept and kept
 * tested rather than deleted: the rule is optional, the doctrine is the part
 * that is wrong, and a future pass that works out when a group is worth the
 * wait wants the code it is fixing to still be here and still be correct.
 */
let coordinatedGroupsEnabled = false
export function setCoordinatedGroups(enabled: boolean): void {
  coordinatedGroupsEnabled = enabled
}

function planCoordinatedFiring(
  game: GameState,
  fleet: ShipState[],
  memo: AiMemo,
  closing: boolean,
  difficulty: AiDifficulty,
): GameAction[] {
  const unfired = fleet.filter((s) => !game.firedThisSegment.has(s.id))
  if (unfired.length === 0) return []
  /*
   * `closing` used to make every ship that had not fired pass on the spot.
   * Everywhere else in the AI it means the opposite — the segment is about to
   * end, so take the shot now rather than waiting for your slot in the firing
   * order — and under H4 it was a mass forfeit: in a squadron the whole fleet
   * gave up its volley on the first call of every combat segment. Six games
   * fired three shots between them, against 367 with the rule switched off.
   *
   * There is nothing left for it to do now that the step clock runs on its
   * own: the clock reaches the last step inside the same drive loop, so every
   * ship that has a step reaches it. So the flag is simply not consulted here.
   */
  void closing

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
  /*
   * Coordinated groups are planned by nobody, for now.
   *
   * The machinery below works and is left in place, but declaring groups
   * measures worse than firing individually: the squadron admiral under H4
   * reads 20W-76L against an ensign with groups and 37W-59L without them.
   * Waiting for a later step to fire together costs more than the
   * concentration gains — H4.2.4 lets a lone ship fire on any step it
   * qualifies for, so the waiting buys only the shared target, and H4.3.1
   * already caps a faction at one attack per target per phase.
   *
   * Note the admiral still loses under H4 either way. The rule is playable
   * now, which it was not, but the AI is not good at it.
   */
  const plans = new Map<string, { shipIds: string[]; targetId: string; stepIndex: number }>()
  if (coordinatedGroupsEnabled && difficulty !== 'ensign') {
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
    memo.done.add(attemptKey)
    /*
     * A ship whose step has come and has nothing to shoot passes, exactly as
     * it would without the step machine. It has to: `firedThisSegment` is what
     * says a ship is finished, and a ship that neither fires nor passes stays
     * on the board forever holding its step open — which is half of why no
     * shot was ever fired with H4 switched on.
     */
    actions.push(volley ?? { type: 'pass-fire', shipId: ship.id })
    return true
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

  /*
   * Wind the step clock on when this step is spent.
   *
   * It used to be wound only by a captain who commanded every ship on the
   * table — which is true in one self-play test and false everywhere else: in
   * a season each side is driven separately, against a human it is never true,
   * and in remote play it is never true. So the clock stopped at step one and
   * the battle stood there. Measured, the duel with H4 on fired zero shots in
   * six games and ran to the round limit with 432 passes.
   *
   * The condition that replaces it is a fact about the whole table rather than
   * about who is asking: nobody still on the board can act on this step. A
   * ship counts as able if it has not fired and either its Tactical Scan calls
   * this step or a declared group of its is firing on it — all public, all on
   * the face-up cards. So a side cannot wind the clock past an opponent who
   * still has a shot coming, which is the thing the old guard was protecting
   * and the reason it cannot simply be dropped.
   *
   * A human who is entitled to fire on this step and would rather hold still
   * stops the clock; that is what the "Next firing step" button is for.
   */
  const active = game.ships.filter((s) => !s.destroyed && !s.disengaged)
  /*
   * A ship of scan 2 answers to the Individual step for scan 2 *and* to the
   * Coordinated step for scan 2, five steps later (H4.2.3). One held back for
   * its group is therefore still a match for the earlier step it is choosing
   * to skip — and reading it as "somebody can still act here" wedged the clock
   * on that step, so the group's step never arrived and the ship never fired.
   * Only our own plans are known; an opponent holding a ship for a later step
   * reads as able to act, which at worst leaves the clock for them to wind.
   */
  const heldForLater = new Set(
    [...plans.values()].flatMap((p) => (p.stepIndex > step.index ? p.shipIds : [])),
  )
  const stillToAct = active.some((s) => {
    if (game.firedThisSegment.has(s.id)) return false
    if (group && group.shipIds.includes(s.id) && group.step === step.index) return true
    if (heldForLater.has(s.id)) return false
    return step.kind === 'individual'
      ? stepMatchesScan(step, scanOf(s))
      : mayFireAlone(step, scanOf(s))
  })
  if (!stillToAct && game.firingStepIndex < FIRING_STEPS.length - 1) {
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
 * Every PD weapon in the book is a main gun with a point-defense mode, and an
 * interception discharges the mount like any shot, so the question is how much
 * of the volley to give up. This has now been wrong in both directions:
 *
 *   - Eagerly, trading main-battery volleys for warhead wear, which turned a
 *     +26 Union margin into −16 across the raid season.
 *   - Then only with IDLE guns — mounts with no firing solution on any visible
 *     enemy hull. That reads as prudence and is in fact a null: a torpedo comes
 *     in from the bearing of the ship that launched it, so the mounts with no
 *     enemy in their arcs are precisely the mounts pointing away from the
 *     torpedo. `fire-small-target` was not emitted once in roughly three
 *     hundred measured battles, and in every sampled phase where a counter was
 *     about to land on a ship with ready idle point defense, the number of
 *     those mounts that could bear on it was zero.
 *
 * Now: idle mounts first because they are free, then up to half a ship's ready
 * point defense may be taken out of its volley. Measured on the raid season it
 * is a wash — 95W-97L with the interception and 95W-97L without — and that is
 * the honest ceiling rather than a disappointment. Every homing weapon in the
 * shipped roster is a plasma torpedo with the PARTCL trait, and a particle
 * warhead is never destroyed outright (F1.16.1); it is only worn, three
 * absorbed points to one point of damage (F1.16.2). An interception absorbs
 * 3.7 points on average, so it buys about one point off a warhead in exchange
 * for one mount's dice. The kill path in `applyDefensiveFire` — where stopping
 * a counter dead is worth far more than a mount — waits on a MISL homing
 * weapon, and there is not one in the book yet.
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

    /*
     * Every armed point-defense mount, with a note of whether it also has a
     * ship to shoot at — a preference, not a qualification.
     *
     * It used to be a qualification, and that was why none of this ever fired.
     * A mount was offered to the interception only if *no* enemy sat in its
     * brackets and arcs; but a torpedo comes in from where the enemy is, so
     * the only mounts the filter left were the ones pointing the other way.
     * Measured over roughly three hundred battles, `fire-small-target` was
     * never once emitted. In a sample where a counter was about to land and
     * the defender had ready, idle point-defense aboard, the number of those
     * mounts that could actually bear on the counter was zero, every time.
     */
    const isPointDefense = (weapon: WeaponSystemDef) =>
      weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
    const mounts = own.flatMap((ship) => {
      const enemies = enemiesOf(game, ship).filter((e) => !positionHidden(game, e))
      const busyWith = (mount: WeaponSystemDef['mounts'][number], weapon: WeaponSystemDef) =>
        enemies.some((enemy) => {
          const range = actualRange(ship.placement.position, enemy.placement.position)
          if (!weapon.brackets.some((b) => range >= b.min && range <= b.max)) return false
          return canBearOn(
            mount.arcs,
            arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position),
          )
        })
      return ship.form.weapons.flatMap((weapon) =>
        isPointDefense(weapon)
          ? weapon.mounts.flatMap((mount, mountIndex) =>
              mountIsReady(weapon, mountIndex, ship.mounts[weapon.id][mountIndex])
                ? [{ ship, weapon, mount, mountIndex, busy: busyWith(mount, weapon) }]
                : [],
            )
          : [],
      )
    })
    // Spend the free mounts first; they cost the volley nothing. Ties are
    // broken by name so both sides compute the same assignment.
    mounts.sort(
      (a, b) =>
        Number(a.busy) - Number(b.busy) ||
        (`${a.ship.id}|${a.weapon.id}|${a.mountIndex}` < `${b.ship.id}|${b.weapon.id}|${b.mountIndex}`
          ? -1
          : 1),
    )

    /*
     * How many mounts a ship may take out of its own volley to swat torpedoes.
     * Half its point defense, at least one — a torpedo warhead is worth more
     * than a mount's dice against a shielded hull, but a ship that turned its
     * whole battery on the incoming wave would win the interception and lose
     * the gunnery duel.
     */
    const budget = new Map<string, number>()
    for (const { ship } of mounts) {
      if (budget.has(ship.id)) continue
      const ready = mounts.filter((m) => m.ship.id === ship.id).length
      budget.set(ship.id, Math.max(1, Math.floor(ready / 2)))
    }

    const spent = new Set<string>()
    for (const hw of incoming) {
      const shot = mounts.find(({ ship, weapon, mount, mountIndex, busy }) => {
        const key = `${ship.id}|${weapon.id}|${mountIndex}`
        if (spent.has(key)) return false
        // One attempt per mount per counter per phase: a refusal the doctrine
        // did not foresee must not be re-argued every drive iteration.
        if (memo.done.has(`pdshot:${game.round}:${game.phase}:${key}:${hw.id}`)) return false
        if (busy && (budget.get(ship.id) ?? 0) <= 0) return false
        const range = actualRange(ship.placement.position, hw.position)
        if (!weapon.brackets.some((b) => range >= b.min && range <= b.max)) return false
        return canBearOn(
          mount.arcs,
          arcTo(ship.placement.position, ship.placement.heading, hw.position),
        )
      })
      if (!shot) continue
      const key = `${shot.ship.id}|${shot.weapon.id}|${shot.mountIndex}`
      if (shot.busy) budget.set(shot.ship.id, (budget.get(shot.ship.id) ?? 0) - 1)
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
    /*
     * The defender's last card (J6.3): arm the general crew, which raises two
     * improvised squads per size class — enough to turn almost any boarding
     * around, since a dreadnought conjures ten squads out of its galleys.
     *
     * It is not free and it is not reversible. For twenty rounds after the
     * fighting ends the ship may not repair anything, loses two points of
     * power, and fires last however good its Tactical Scan (J6.3.4). So it is
     * played at the point where the alternative is losing the ship: when the
     * boarders already match the marines left to stop them.
     */
    if (
      sides.includes(target.side) &&
      !isCaptured(target) &&
      !crewIsArmed(target) &&
      boardersAboard(target) >= target.marineSquads
    ) {
      actions.push({ type: 'arm-crew', shipId: target.id })
    }

    for (const side of boardingSides(target)) {
      if (!sides.includes(side)) continue
      const key = `board:${game.round}:${target.id}:${side}`
      if (memo.done.has(key)) continue
      memo.done.add(key)

      /*
       * Sabotage (J6.2.4): a squad may attack the ship instead of its marines,
       * one point of damage per Light hit, and structure hits are simply lost.
       *
       * Who goes is decided by J6.2.3 rather than by taste. Tight quarters cap
       * a side's dice at twice the enemy's squads, so every squad past that cap
       * is standing in a corridor doing nothing — send those to the engine
       * rooms, where their die still counts for something. And when the
       * boarding is already lost — outnumbered two to one, with no capture
       * coming — the whole party goes for the ship, because damage is worth
       * something and a losing melee is not.
       */
      const boarders = target.boarders[side] ?? 0
      const defenders = target.marineSquads
      const hopeless = defenders >= boarders * MAX_ATTACKERS_PER_SQUAD
      const saboteurs = hopeless ? boarders : Math.max(0, boarders - defenders * MAX_ATTACKERS_PER_SQUAD)
      if (saboteurs > 0) {
        actions.push({ type: 'set-sabotage', targetId: target.id, side, squads: saboteurs })
      }
      actions.push({ type: 'fight-boarders', targetId: target.id, side })
    }
  }
  return actions
}

function planDisengagement(
  game: GameState,
  fleet: ShipState[],
  difficulty: AiDifficulty = 'admiral',
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
