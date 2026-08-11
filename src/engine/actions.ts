import {
  attemptSearch,
  disengageCloak,
  engageCloak,
  maneuverAllowedWhileCloaked,
  mayDecloak,
  positionIsHidden,
  reduceDetection,
  DETECTION_LABELS,
} from './cloaking'
import { firingOrder, resolveVolley, type FireMode, type MountSelection, type VolleyResult } from './combat'
import type { DamageChoice } from './damage'
import { setCommandAssignment } from './command'
import {
  armMount,
  autoArmIfChoiceFree,
  batterySpendError,
  damageControlRefusal,
  resolveDamageControl,
  setAllocation,
  spendBattery,
  type RepairAssignment,
} from './engineering'
import { chooseLead, joinFormation, leaveFormation } from './formation'
import { accelerationBudget, clampAccel } from './navigation'
import {
  advanceFiringStep,
  advanceOperationsStep,
  advanceSegment,
  asteroidCoverRerolls,
  asteroidFieldsAt,
  attackAllowed,
  attemptTractorLock,
  cloakModifiers,
  cloakOf,
  abandonToPods,
  cloudModifiers,
  commandStateFor,
  contestTractor,
  armCrew,
  captureCraft,
  damageContext,
  damageRevealsCloak,
  displaceTractored,
  declareCoordinatedFire,
  evacuateCrew,
  everyoneReady,
  dockShuttle,
  fightBoarders,
  fireAtSmallTarget,
  isCombatPhase,
  launchHoming,
  launchProbe,
  launchShuttle,
  moveSmallCraft,
  performScan,
  performTransport,
  pushLog,
  recordAttack,
  recoverPod,
  recoverShuttle,
  releaseTractor,
  repositionCloaked,
  resolveHomingImpacts,
  scoutSupport,
  setMaxSystem,
  setSabotageSquads,
  setShieldDown,
  shipIsCloaked,
  shipUnderCloakRestrictions,
  sidesAwaited,
  flushPendingVolleys,
  recordShieldHit,
  tacticalScanOf,
  terrainObstacles,
  tractorIncomingHoming,
  workingSystemBoxes,
  type FlushedVolley,
  type GameState,
} from './game'
import { setScoutAssignment, setScoutSensorActive } from './scouting'
import { sensorFunctionCap, sensorPointsAvailable, type ShipState } from './shipState'
import type { Maneuver, ShieldSide, SystemKind, TurnDirection } from './types'
import type { ScoutFunction } from './types'
import type { SmallCraftKind } from './smallCraft'

/**
 * Every mutation the game accepts, as a named, serializable record.
 *
 * The UI never mutates the game directly — it dispatches one of these, and the
 * store journals what it dispatched. Because the engine is deterministic and
 * the RNG is seeded, (setup + journal) reconstructs the game exactly, which is
 * what save/resume, undo and replays are made of — and what will let two
 * browsers stay in sync when the battle is fought over a wire.
 *
 * Two rules keep replay honest:
 *
 *  1. Payloads carry ids and player choices only — never derived state. Each
 *     handler re-derives context (cloaks, clouds, scout support, coordinated
 *     groups) from the game itself, so a stale or hand-edited payload cannot
 *     make the replay disagree with the original.
 *  2. A refused action mutates nothing and is refused identically on replay,
 *     so journaling refusals is harmless.
 */
export type GameAction =
  // Sequence of play (A3)
  | { type: 'advance-segment' }
  /**
   * Online matches: a side declares itself finished with the segment. When
   * the last one does, the segment closes — nobody advances it by hand.
   */
  | { type: 'signal-ready'; side: string; ready: boolean }
  | { type: 'ops-next-step' }
  | { type: 'advance-firing-step' }
  | { type: 'set-coordinated-fire'; on: boolean }
  /** Christen a hull — cosmetic, journaled so replays and saves keep the name. */
  | { type: 'rename-ship'; shipId: string; name: string }
  // Resource Allocation (B2, E4.2)
  | { type: 'allocate'; shipId: string; lineId: string; circles: number }
  | { type: 'arm-mount'; shipId: string; weaponId: string; mountIndex: number }
  /** Optional batteries (B2.5.2): one battery, into one empty function circle. */
  | { type: 'spend-battery'; shipId: string; lineId: string }
  // Damage Control (B3.2)
  | { type: 'damage-control'; shipId: string; assignments: RepairAssignment[] }
  // Command card plotting (C1)
  | { type: 'plot-maneuver'; shipId: string; maneuver: Maneuver; direction: TurnDirection | null }
  | { type: 'plot-accel'; shipId: string; delta: number }
  | { type: 'plot-evasive'; shipId: string; points: number }
  /** Precise turns and slides (C3.9): turn at less than the ship could manage. */
  | { type: 'plot-turn-rate'; shipId: string; rate: number | null }
  | { type: 'plot-half-slide'; shipId: string; on: boolean }
  /** Emergency stop (C3.8): shut the drive field down and stand still. */
  | { type: 'plot-emergency-stop'; shipId: string; on: boolean }
  | {
      type: 'plot-sensor'
      shipId: string
      key: 'targeting' | 'jamming' | 'tacticalScan'
      value: number
    }
  | { type: 'plot-shield'; shipId: string; side: ShieldSide }
  // Operations (J1–J5)
  | { type: 'set-max-system'; shipId: string; kind: SystemKind | null }
  | { type: 'set-shield-down'; shipId: string; side: ShieldSide; down: boolean }
  | { type: 'tractor-lock'; shipId: string; targetId: string; beams: number }
  | { type: 'release-tractor'; shipId: string; targetId: string }
  | { type: 'contest-tractor'; shipId: string }
  | { type: 'transport'; shipId: string; targetId: string; squads: number }
  | { type: 'scan'; shipId: string; targetId: string }
  // Combat (E6, H4)
  | {
      type: 'fire-volley'
      attackerId: string
      targetId: string
      mounts: MountSelection[]
      mode: FireMode
      precisionSection?: 'shields' | 'weapons' | 'general' | 'engineering'
      degraded: boolean
      /** On an arc boundary the attacker picks the shield struck (E6.2 Step 4). */
      chosenShield?: ShieldSide
    }
  | { type: 'pass-fire'; shipId: string }
  /**
   * Damage-card choices for the action that follows (E8.4.1). Journalled like
   * anything else, so a replay makes the captain's decision rather than its
   * own.
   */
  | { type: 'queue-damage-choices'; choices: DamageChoice[] }
  /**
   * A damaging action held while the console commanding `awaiting` answers its
   * damage-card choices (E8.4.1 across a wire). The battle refuses everything
   * else until `resolve-staged-action` lands it. Re-staged with a longer
   * script — and possibly a different `awaiting` — as each console answers the
   * choices that are its player's to make.
   */
  | { type: 'stage-damage-action'; action: GameAction; choices: DamageChoice[]; awaiting: string }
  /** The staged action finally lands, with the complete script of answers. */
  | { type: 'resolve-staged-action'; choices: DamageChoice[] }
  | { type: 'declare-coordinated'; shipIds: string[]; targetId: string }
  | { type: 'fire-small-target'; attackerId: string; targetId: string; weaponId: string; mountIndex: number }
  | { type: 'catch-missile'; shipId: string; homingId: string; beams: number }
  | { type: 'launch-homing'; shipId: string; weaponId: string; mountIndex: number; targetId: string }
  | { type: 'launch-probe'; shipId: string; objectId: string; weaponId: string; mountIndex: number }
  | { type: 'resolve-homing-impacts'; shipId: string; pointDefense: Partial<Record<ShieldSide, number>> }
  // Cloaking (H6)
  | { type: 'engage-cloak'; shipId: string }
  | { type: 'decloak'; shipId: string }
  | { type: 'reduce-detection'; shipId: string }
  | { type: 'cloak-search'; shipId: string; ghostId: string }
  /**
   * H6.8.7 — after six rounds cloaked, reappear anywhere within 18" of the
   * datum instead of replaying eighteen phases of hidden movement.
   */
  | { type: 'cloak-reposition'; shipId: string; x: number; y: number; heading: number; speed: number }
  // Scouting sensors (H3)
  | {
      type: 'scout-assign'
      shipId: string
      index: number
      fn: ScoutFunction
      targetId: string | null
    }
  | { type: 'scout-active'; shipId: string; index: number; active: boolean }
  // Formations (C5)
  | { type: 'form-up'; shipIds: string[] }
  | { type: 'leave-formation'; shipId: string }
  // Command systems (H5)
  | { type: 'set-command-ship'; side: string; shipId: string | null }
  | { type: 'assign-command'; side: string; targetId: string; points: number }
  // Boarding (J6.2)
  | { type: 'set-sabotage'; targetId: string; side: string; squads: number }
  | { type: 'fight-boarders'; targetId: string; side: string }
  /** Arm the general crew to repel boarders (J6.3, optional). */
  | { type: 'arm-crew'; shipId: string }
  // Flight operations (J8)
  | { type: 'launch-shuttle'; shipId: string; kind?: SmallCraftKind; marines?: number }
  | { type: 'move-craft'; craftId: string; x: number; y: number }
  | { type: 'recover-shuttle'; craftId: string; shipId: string }
  /** J3.2.6 — bring a craft held in a tractor beam aboard, friend or prize. */
  | { type: 'capture-craft'; craftId: string; shipId: string }
  /** J3.5 — shove a tractored ship an inch, once everyone has moved. */
  | { type: 'displace-tractored'; shipId: string; targetId: string; direction: 'F' | 'A' | 'P' | 'S' }
  | { type: 'dock-shuttle'; craftId: string; shipId: string }
  // Abandoning ship (E11.4–E11.6, optional)
  /** E11.5 — emergency beam-out to a nearby ship, one green die per crew unit. */
  | { type: 'evacuate-crew'; shipId: string; toShipId: string }
  /** E11.6 — take to the pods, optionally scuttling the hull on the way out. */
  | { type: 'abandon-ship'; shipId: string; selfDestruct: boolean }
  /** E11.6.5 — take a pod aboard, by landing it or beaming its crew across. */
  | { type: 'recover-pod'; podId: string; shipId: string; method: 'land' | 'beam' }
  // Disengagement (J9)
  | { type: 'disengage'; shipId: string }

/** What a dispatch hands back to the panel that asked. Replay discards it. */
export interface ActionOutcome {
  /** A refusal, or a human summary of what happened. Null means quiet success. */
  message: string | null
  /** The full roll record, for the combat panel's dice display. */
  volley?: VolleyResult
  /** fire-small-target: the counter is gone, clear the picker. */
  destroyed?: boolean
  /** damage-control: one line per repair attempt. */
  messages?: string[]
  /** Held tie-group volleys this action caused to land (H2.4.2). */
  flushed?: FlushedVolley[]
}

const ok: ActionOutcome = { message: null }
const said = (message: string | null): ActionOutcome => ({ message })

function shipById(game: GameState, id: string): ShipState | null {
  return game.ships.find((s) => s.id === id) ?? null
}

/**
 * If every ship in the tie group whose damage is being held has now fired or
 * passed, land the lot (H2.4.2). Returns what landed, for the effects layer.
 */
function maybeFlushTieGroup(game: GameState): FlushedVolley[] | undefined {
  if (game.pendingVolleys.length === 0) return undefined
  const pending = new Set(game.pendingVolleys.map((h) => h.attackerId))
  const groups = firingOrder(game.ships, (s) => tacticalScanOf(game, s))
  const settled = groups.every(
    (g) =>
      !g.some((s) => pending.has(s.id)) || g.every((s) => game.firedThisSegment.has(s.id)),
  )
  if (!settled) return undefined
  return flushPendingVolleys(game)
}

/**
 * Apply one action to the game. The single mutation switchboard: the store
 * calls it live, and replay calls it again with the same journal.
 *
 * A queued damage script belongs to exactly one action — the next one — so it
 * is cleared afterwards whether the cards consumed it or not. Anything left
 * behind would be answers to questions a later volley never asked.
 */
export function applyAction(game: GameState, action: GameAction): ActionOutcome {
  /*
   * While a staged action waits on another console's damage-card answers,
   * the battle holds still. Anything else mutating meanwhile would change
   * the state the stage's script was probed against, and the answers would
   * land on different cards than the ones the player was shown. The refusal
   * is deterministic, so consoles that race an action into the journal
   * during the hold all refuse it identically on replay.
   */
  if (
    game.stagedAction &&
    action.type !== 'stage-damage-action' &&
    action.type !== 'resolve-staged-action'
  ) {
    return said(
      `${game.stagedAction.awaiting} is choosing where the damage falls — the battle holds until they have.`,
    )
  }
  const outcome = resolveAction(game, action)
  if (action.type !== 'queue-damage-choices') game.damageScript = []
  return outcome
}

function resolveAction(game: GameState, action: GameAction): ActionOutcome {
  switch (action.type) {
    case 'queue-damage-choices':
      // The captain's decisions, made before the cards come out (E8.4.1).
      game.damageScript = [...action.choices]
      return ok

    case 'stage-damage-action': {
      const inner = action.action
      // An envelope holds a damaging action, never another envelope — and a
      // queued script travels inside the stage's own `choices`, not alongside.
      if (
        inner.type === 'stage-damage-action' ||
        inner.type === 'resolve-staged-action' ||
        inner.type === 'queue-damage-choices'
      ) {
        return said('That action cannot be staged.')
      }
      const before = game.stagedAction
      /*
       * One hold at a time, and it belongs to the action that got there
       * first. Two consoles can fire in the same instant, each probing
       * before the other's stage arrived — without this, the second stage
       * would replace the first and a held volley would silently vanish.
       * A re-stage carrying the *same* action is the relay extending its
       * script and passes; a different action waits its turn and refires.
       */
      if (before && JSON.stringify(before.action) !== JSON.stringify(inner)) {
        return said(
          `${before.awaiting} is choosing where the damage falls — the battle holds until they have.`,
        )
      }
      game.stagedAction = { action: inner, choices: [...action.choices], awaiting: action.awaiting }
      // Narrate the hold — and each handoff — but not every extension of the
      // script, or the log would count the questions instead of the answers.
      if (!before || before.awaiting !== action.awaiting) {
        pushLog(game, `${action.awaiting} is choosing where the damage falls…`)
      }
      // A summary, not a refusal: the panel that fired shows the player why
      // no dice have appeared yet.
      return said(`Waiting for ${action.awaiting} to choose where the damage falls (E8.4.1).`)
    }

    case 'resolve-staged-action': {
      const staged = game.stagedAction
      if (!staged) return said('No held action is waiting on damage choices.')
      // The hold lifts, the answers become the script, and the action lands
      // exactly as it would have on the console that first dispatched it.
      game.stagedAction = null
      game.damageScript = [...action.choices]
      return resolveAction(game, staged.action)
    }
    // ── Sequence of play ─────────────────────────────────────────────────
    case 'advance-segment':
      /**
       * Under the ready gate the segment closes when the sides agree it is
       * closed, and not before (B1.9.1). Refused rather than ignored, so a
       * client that still has the old button cannot quietly move the battle
       * on while the other player is mid-plot.
       */
      if (game.readyGate && !everyoneReady(game)) {
        const waiting = sidesAwaited(game).filter((side) => !game.readySides.includes(side))
        return said(`Waiting for ${waiting.join(' and ')} to finish the segment.`)
      }
      advanceSegment(game)
      return ok

    case 'signal-ready': {
      if (!game.readyGate) return said('This battle does not use ready checks.')
      if (!sidesAwaited(game).includes(action.side)) return said('That side has no ships left.')
      const already = game.readySides.includes(action.side)
      if (action.ready === already) return ok
      game.readySides = action.ready
        ? [...game.readySides, action.side]
        : game.readySides.filter((side) => side !== action.side)
      if (action.ready) pushLog(game, `${action.side} is ready.`)
      // The last one to be ready closes the segment. Both ends work that out
      // from the same journal, so neither has to be told.
      if (everyoneReady(game)) advanceSegment(game)
      return ok
    }
    case 'ops-next-step':
      advanceOperationsStep(game)
      return ok
    case 'advance-firing-step':
      advanceFiringStep(game)
      return ok
    case 'set-coordinated-fire':
      game.coordinatedFire = action.on
      game.firingStepIndex = 0
      game.coordinatedGroup = null
      game.attackedThisPhase.clear()
      pushLog(game, `Coordinated Fire (H4) ${action.on ? 'in force' : 'switched off'}.`)
      return ok
    case 'rename-ship': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      // Cosmetic and always legal for the owner, any time — a captain may
      // christen the ship mid-battle. Bounded so a save file cannot carry a
      // novel where a name goes.
      const name = action.name.trim().slice(0, 40)
      if (!name) return said('A ship needs a name.')
      if (name === ship.name) return ok
      // Names identify ships in the battle log — and the AI reads that log
      // (observe() attributes volleys by name) — so two hulls may not share
      // one.
      if (game.ships.some((s) => s.id !== ship.id && s.name === name)) {
        return said('Another ship already answers to that name.')
      }
      pushLog(game, `${ship.name} answers to ${name} now.`)
      ship.name = name
      return ok
    }

    // ── Resource allocation ──────────────────────────────────────────────
    case 'spend-battery': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      if (!game.optionalBatteries) return said('Optional battery rules are not in play (B2.5).')
      /**
       * Plotted in the Command Segment of a combat phase (B2.5.2). Outside
       * one there is nothing optional about it — batteries are simply part of
       * the power available at Resource Allocation (B2.4.1).
       */
      if (!isCombatPhase(game.phase) || game.segment !== 'command') {
        return said('Battery power is plotted during a combat phase’s Command Segment (B2.5.2).')
      }
      if (ship.derelict) return said('A derelict allocates nothing (E11.2.4).')
      const refused = batterySpendError(ship, action.lineId)
      if (refused) return said(refused)
      pushLog(game, spendBattery(ship, action.lineId))
      // The same courtesy the allocation panel gets: when the fresh points
      // cover every circle that may legally be filled, fill them (E4.2.2).
      const line = ship.form.functions.find((l) => l.id === action.lineId)
      if (line?.kind === 'weapon' && line.weaponSystemId) {
        autoArmIfChoiceFree(ship, line.weaponSystemId)
      }
      return ok
    }

    case 'allocate': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      const refused = setAllocation(ship, action.lineId, action.circles)
      if (refused) return said(refused.message)
      // When the points now cover every circle a weapon may legally fill,
      // spending them one click at a time is busywork, not a decision —
      // arm the lot (E4.2.2, E4.2.8).
      const line = ship.form.functions.find((l) => l.id === action.lineId)
      if (line?.kind === 'weapon' && line.weaponSystemId) {
        const armed = autoArmIfChoiceFree(ship, line.weaponSystemId)
        if (armed > 0) {
          const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)
          pushLog(game, `${ship.name}: ${weapon?.name ?? line.label} armed in full (${armed} circles).`)
        }
      }
      return said(null)
    }
    case 'arm-mount': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(armMount(ship, action.weaponId, action.mountIndex)?.message ?? null)
    }

    // ── Damage control ───────────────────────────────────────────────────
    case 'arm-crew': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      // "The decision to use the crew to repel boarders is made during the
      // Boarding Combat Segment" (J6.3.2).
      if (game.segment !== 'boarding-combat') {
        return said('The crew is armed during the Boarding Combat Segment (J6.3.2).')
      }
      const refused = armCrew(game, ship)
      return refused ? said(refused) : ok
    }

    case 'damage-control': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      const noCrew = damageControlRefusal(ship)
      if (noCrew) return said(noCrew)
      const messages: string[] = []
      const outcomes = resolveDamageControl(ship, action.assignments, game.rng, (m) => {
        messages.push(m)
        pushLog(game, m)
      })
      for (const outcome of outcomes) {
        if (!outcome.success) messages.push(`${outcome.category}: no success on ${outcome.dice} dice.`)
      }
      return { message: null, messages }
    }

    // ── Command card ─────────────────────────────────────────────────────
    case 'plot-maneuver': {
      const card = game.orders[action.shipId]
      if (!card) return said('No command card for that ship.')
      // H6.8.5(3): a ship feeling its way through the dark keeps it simple.
      // While cloaked and undetected only straight, slide, easy and standard
      // are available; anything sharper waits until it is back on the map.
      const cloak = cloakOf(game, shipById(game, action.shipId)!)
      if (
        cloak &&
        positionIsHidden(cloak) &&
        !maneuverAllowedWhileCloaked(action.maneuver)
      ) {
        return said(
          `A cloaked ship may only fly straight, slide, or make easy and standard turns (H6.8.5).`,
        )
      }
      card.maneuver = action.maneuver
      card.direction = action.direction
      return ok
    }
    case 'plot-accel': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      // Cut to the per-phase limit and the round's unspent points (C1.2.3,
      // C1.2.5) as it is plotted — the card must never promise a speed change
      // the drive has not paid for.
      card.accel = clampAccel(ship, card.accel + action.delta)
      card.speed = ship.speed + card.accel
      return ok
    }
    case 'plot-turn-rate': {
      const card = game.orders[action.shipId]
      if (!card) return said('No command card for that ship.')
      card.turnRate = action.rate === null ? undefined : Math.max(0, Math.round(action.rate))
      return ok
    }

    case 'plot-half-slide': {
      const card = game.orders[action.shipId]
      if (!card) return said('No command card for that ship.')
      card.halfSlide = action.on || undefined
      return ok
    }

    case 'plot-emergency-stop': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      // Nothing to shut down when the drive is already off (C3.8.4).
      if (action.on && ship.emergencyStopPhases > 0) {
        return said(`${ship.name} is already stopped (C3.8.2).`)
      }
      card.emergencyStop = action.on || undefined
      if (action.on) {
        // The card reads speed zero, straight ahead — the rest of the plot is
        // no longer the captain's to make (C3.8.1).
        card.speed = 0
        card.accel = 0
        card.maneuver = 'straight'
        card.direction = null
      }
      return ok
    }

    case 'plot-evasive': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      /**
       * The EVASIVE box (C3.6.2). Capped at what the drive was powered for
       * this round, minus what the round has already spent — the per-phase
       * acceleration limit deliberately does not apply here, only the round's
       * total does. Points already weaving are not re-bought (C3.6.4).
       */
      const room = Math.max(
        0,
        accelerationBudget(ship) - ship.accelUsedThisRound + ship.evasive,
      )
      card.evasive = Math.max(0, Math.min(Math.floor(action.points), room))
      return ok
    }
    case 'plot-sensor': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      /*
       * Two separate limits, and both bind (H2.2).
       *
       * H2.2.3 caps any single function at the ship's undamaged sensor boxes,
       * and that one was already here. H2.2.2 is the other half: the captain
       * divides *the points the sensor line generated* between the three
       * functions, so the three together cannot exceed the line's output. That
       * was checked in validatePlot — which reports to the command card panel
       * and is never consulted before the split is copied onto the ship — so
       * in practice a ship could run targeting, jamming and Tactical Scan all
       * at their cap at once, spending as much as three times what it had.
       *
       * Clamping against what the other two functions already hold is what a
       * player does filling circles on the card: the last function gets what
       * is left, not a fresh allowance.
       */
      const spentElsewhere = (['targeting', 'jamming', 'tacticalScan'] as const)
        .filter((key) => key !== action.key)
        .reduce((n, key) => n + card.sensors[key], 0)
      const budget = Math.max(0, sensorPointsAvailable(ship) - spentElsewhere)
      card.sensors[action.key] = Math.max(
        0,
        Math.min(action.value, sensorFunctionCap(ship), budget),
      )
      // The card is trimmed again on its way onto the ship (clampSensors), for
      // sensors shot away between plotting and the Command Segment.
      return ok
    }
    case 'plot-shield': {
      const card = game.orders[action.shipId]
      if (!card) return said('No command card for that ship.')
      card.shieldsDown = card.shieldsDown.includes(action.side)
        ? card.shieldsDown.filter((s) => s !== action.side)
        : [...card.shieldsDown, action.side]
      return ok
    }

    // ── Operations ───────────────────────────────────────────────────────
    case 'set-max-system': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      setMaxSystem(game, ship, action.kind)
      return ok
    }
    case 'set-shield-down': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(setShieldDown(game, ship, action.side, action.down))
    }
    case 'tractor-lock': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      const result = attemptTractorLock(game, ship, action.targetId, action.beams)
      return said(
        result.refusal ??
          (result.locked ? null : `Lock failed: ${result.total} against ${result.required || 'no L or M'}.`),
      )
    }
    case 'release-tractor':
      releaseTractor(game, action.shipId, action.targetId)
      return ok
    case 'contest-tractor': {
      const result = contestTractor(game, action.shipId)
      return said(result.refusal ?? (result.locked ? 'The beam holds.' : 'Broken free.'))
    }
    case 'transport': {
      const from = shipById(game, action.shipId)
      const to = shipById(game, action.targetId)
      if (!from || !to) return said('No such ship.')
      return said(performTransport(game, from, to, action.squads).refusal)
    }
    case 'scan': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(performScan(game, ship, action.targetId).refusal)
    }

    // ── Combat ───────────────────────────────────────────────────────────
    case 'fire-volley': {
      const attacker = shipById(game, action.attackerId)
      const target = shipById(game, action.targetId)
      if (!attacker || !target) return said('No such ship.')

      // Context is re-derived here, never trusted from the panel, so a replay
      // sees exactly the modifiers the original resolution saw.
      const inGroup = game.coordinatedGroup?.shipIds.includes(attacker.id) ?? false
      if (game.coordinatedFire && !inGroup) {
        const blocked = attackAllowed(game, attacker, target)
        if (blocked) return said(blocked)
      }
      /**
       * Tied Tactical Scans fire simultaneously and their damage takes
       * effect simultaneously (H2.4.2): a tied ship's volley is rolled now
       * but held, so no tie-mate loses weapons — or the ship — before its
       * own guns speak. Held damage lands when the whole group has fired or
       * passed. The optional H4 step machine has its own sequencing, so this
       * applies to the base firing sequence only.
       */
      const tieGroup = game.coordinatedFire
        ? undefined
        : firingOrder(game.ships, (s) => tacticalScanOf(game, s)).find((g) =>
            g.some((s) => !game.firedThisSegment.has(s.id)),
          )
      const tied =
        tieGroup !== undefined && tieGroup.length > 1 && tieGroup.some((s) => s.id === attacker.id)
      const terrain = cloudModifiers(game, attacker, target)
      const result = resolveVolley(
        {
          attacker,
          target,
          mounts: action.mounts,
          mode: action.mode,
          precisionSection: action.mode === 'precision' ? action.precisionSection : undefined,
          chosenShield: action.chosenShield,
          coordinated: inGroup,
          scoutSupport: scoutSupport(game, attacker, target),
          ...cloakModifiers(game, attacker, target),
          attackerSciences: workingSystemBoxes(game, attacker, 'SCNC'),
          ...terrain,
          degradedFireControl: action.degraded || terrain.degradedFireControl,
          obstacles: terrainObstacles(game.scenario.terrain),
          // Asteroid cover rerolls (K2.1.8) and the in-field exemption from
          // the low-speed penalty (K2.2.1).
          defenderCoverRerolls: asteroidCoverRerolls(game, attacker, target),
          // Both halves of C3.6.3 at once: what the target's own weaving
          // earns it, plus what the attacker's weaving costs its accuracy.
          defenderEvasiveRerolls: target.evasive + attacker.evasive,
          lowSpeedNegated:
            terrain.lowSpeedNegated ||
            asteroidFieldsAt(game.scenario.terrain, target.placement.position).length > 0,
          defer: tied,
        },
        damageContext(game),
        game.rng,
      )
      if (!result.ok) return said(result.reason)

      game.firedThisSegment.add(attacker.id)
      if (game.coordinatedFire && !inGroup) recordAttack(game, attacker, target)
      const dice = result.records.flatMap((r) => r.rolls.map((d) => d.face)).join(' ')
      pushLog(
        game,
        `${attacker.name} fires on ${target.name} at effective range ${result.effectiveRange} ` +
          `(${result.targetShield} shield). Dice: ${dice} → ${result.damage.standard} damage` +
          (result.damage.leak ? `, ${result.damage.leak} leak` : '') +
          (result.held ? ' — damage held for simultaneous resolution (H2.4.2)' : ''),
      )
      if (result.held) game.pendingVolleys.push(result.held)
      // A landed volley's shield absorption is public — both players saw the
      // side declared and the boxes come off. Held volleys record at flush.
      if (result.outcome) {
        recordShieldHit(
          game,
          target.id,
          result.damage.side,
          result.outcome.greenAbsorbed + result.outcome.blueAbsorbed,
        )
        // H6.15.3: four points into a cloaked hull is a flare in the dark. The
        // reduction from degraded fire control is already in this number.
        damageRevealsCloak(game, target, result.damage.standard)
      }
      const flushed = maybeFlushTieGroup(game)
      return { message: null, volley: result, flushed }
    }
    case 'pass-fire': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      game.firedThisSegment.add(ship.id)
      pushLog(game, `${ship.name} declines to fire this phase (E6.2 Step 1).`)
      const flushed = maybeFlushTieGroup(game)
      return flushed ? { message: null, flushed } : ok
    }
    case 'declare-coordinated': {
      const ships = action.shipIds
        .map((id) => shipById(game, id))
        .filter((s): s is ShipState => s !== null)
      const target = shipById(game, action.targetId)
      if (!target) return said('No such target.')
      return said(declareCoordinatedFire(game, ships, target))
    }
    case 'fire-small-target': {
      const attacker = shipById(game, action.attackerId)
      if (!attacker) return said('No such ship.')
      const result = fireAtSmallTarget(game, attacker, action.targetId, action.weaponId, action.mountIndex)
      return {
        message:
          result.refusal ??
          (result.volley
            ? `${result.volley.damage} damage${result.destroyed ? ' — destroyed' : ''}` +
              (result.volley.automatic ? ' (automatic, J3.2.5)' : '') +
              (result.volley.degraded ? ' (halved, E10.2.3)' : '')
            : null),
        destroyed: !result.refusal && result.destroyed,
      }
    }
    case 'catch-missile': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(tractorIncomingHoming(game, ship, action.homingId, action.beams).refusal ?? null)
    }
    case 'launch-homing': {
      const ship = shipById(game, action.shipId)
      const target = shipById(game, action.targetId)
      if (!ship || !target) return said('No such ship.')
      const weapon = ship.form.weapons.find((w) => w.id === action.weaponId)
      if (!weapon) return said('Unknown weapon system.')
      return said(launchHoming(game, ship, weapon, action.mountIndex, target))
    }
    case 'launch-probe': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(
        launchProbe(game, ship, action.objectId, {
          weaponId: action.weaponId,
          mountIndex: action.mountIndex,
        }),
      )
    }
    case 'resolve-homing-impacts': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      resolveHomingImpacts(game, ship, action.pointDefense)
      return ok
    }

    // ── Cloaking ─────────────────────────────────────────────────────────
    case 'engage-cloak': {
      const ship = shipById(game, action.shipId)
      const cloak = ship ? cloakOf(game, ship) : null
      if (!ship || !cloak) return said('No cloaking system.')
      const enemies = game.ships.filter((s) => s.side !== ship.side)
      const result = engageCloak(ship, cloak, enemies)
      if (result.ok) {
        pushLog(
          game,
          `${ship.name} engages its cloaking system (H6.6)` +
            (result.freeContacts.length
              ? ` — ${result.freeContacts.length} enemy within range 8 gains a Contact (H6.6.3).`
              : '.'),
        )
      }
      return said(result.reason ?? null)
    }
    case 'decloak': {
      const ship = shipById(game, action.shipId)
      const cloak = ship ? cloakOf(game, ship) : null
      if (!ship || !cloak) return said('No cloaking system.')
      if (!cloak.engaged) return said(`${ship.name} is not cloaked.`)
      // H6.6.7: once engaged the cloak runs for a full phase before it may be
      // switched off. The panel greys the button out; the engine is what makes
      // it true for a remote client or a replayed script.
      if (!mayDecloak(cloak)) {
        return said('The cloak must run for a full phase before it can be disengaged (H6.6.7).')
      }
      disengageCloak(cloak)
      pushLog(game, `${ship.name} decloaks (H6.7).`)
      return ok
    }
    case 'reduce-detection': {
      const ship = shipById(game, action.shipId)
      const cloak = ship ? cloakOf(game, ship) : null
      if (!ship || !cloak) return said('No cloaking system.')
      // H6.13.2: the attempt happens once, at Step E of the Operations
      // Segment. Asking twice is not a second chance.
      if (cloak.evadedThisSegment) {
        return said(`${ship.name} has already tried to shake its hunters this segment (H6.13.2).`)
      }
      cloak.evadedThisSegment = true
      const results = reduceDetection(cloak, game.rng)
      for (const r of results) {
        pushLog(
          game,
          `${ship.name} tries to shake ${game.ships.find((s) => s.id === r.searcherId)?.name ?? r.searcherId}` +
            ` — ${r.face}${r.reduced ? ', detection drops' : ', no change'} (H6.13).`,
        )
      }
      return said(results.length === 0 ? 'Nobody has a fix to shake off.' : null)
    }
    case 'cloak-reposition': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(
        repositionCloaked(
          game,
          ship,
          { position: { x: action.x, y: action.y }, heading: action.heading },
          action.speed,
        ),
      )
    }
    case 'cloak-search': {
      const ship = shipById(game, action.shipId)
      const ghost = shipById(game, action.ghostId)
      const cloak = ghost ? cloakOf(game, ghost) : null
      if (!ship || !ghost || !cloak) return said('Nothing to search for.')
      // H6.9.5: two ships stalking each other from behind their own cloaks is
      // a submarine engagement, not a space battle — the rulebook says so in
      // as many words, and refuses the search outright.
      if (shipIsCloaked(game, ship)) {
        return said(`${ship.name} cannot search for another cloaked ship while cloaked (H6.9.5).`)
      }
      const out = attemptSearch(ship, ghost, cloak, game.rng)
      if (out.faces.length > 0) {
        pushLog(
          game,
          `${ship.name} searches for ${ghost.name}: ${out.faces.join(' ')} — ` +
            (out.detected ? `${DETECTION_LABELS[out.to]} (H6.10).` : 'no contact.'),
        )
      }
      return said(out.reason ?? null)
    }

    // ── Scouting sensors ─────────────────────────────────────────────────
    case 'scout-assign': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(setScoutAssignment(ship, action.index, action.fn, action.targetId, game.ships))
    }
    case 'scout-active': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      setScoutSensorActive(ship, action.index, action.active)
      pushLog(
        game,
        `${ship.name}: scout sensor ${action.index + 1} ${action.active ? 'activated' : 'deactivated'} (H3.3.2).`,
      )
      return ok
    }

    // ── Formations ───────────────────────────────────────────────────────
    case 'form-up': {
      const ships = action.shipIds
        .map((id) => shipById(game, id))
        .filter((s): s is ShipState => s !== null)
      if (ships.length < 2) return said('Pick at least one ship to form up with.')
      // C5.1.1: the least maneuverable ship at the formation's speed leads —
      // computed here so the journal cannot disagree with the rule.
      const lead = chooseLead(ships)!
      const rest = ships.filter((s) => s.id !== lead.id)
      const { formation: made, rejected } = joinFormation(game.formations, lead, rest)
      if (made) {
        pushLog(
          game,
          `${lead.name} leads a formation with ${made.memberIds
            .map((id) => game.ships.find((s) => s.id === id)!.name)
            .join(', ')} (C5.1).`,
        )
      }
      return said(rejected.length > 0 ? rejected.map((r) => r.reason).join(' ') : null)
    }
    case 'leave-formation': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      leaveFormation(game.formations, ship.id)
      pushLog(game, `${ship.name} leaves the formation (C5.2).`)
      return ok
    }

    // ── Command systems ──────────────────────────────────────────────────
    case 'set-command-ship': {
      const state = commandStateFor(game, action.side)
      state.commandShipId = action.shipId
      state.assignments = []
      return ok
    }
    case 'assign-command': {
      const state = commandStateFor(game, action.side)
      const commandShip = game.ships.find((s) => s.id === state.commandShipId)
      // H6.4.10: command systems go dark with the cloak, so a cloaked flagship
      // lends nothing and a cloaked ship is past hearing.
      if (commandShip && shipUnderCloakRestrictions(game, commandShip)) {
        return said(`${commandShip.name}'s command systems are disabled while cloaked (H6.4.10).`)
      }
      const recipientShip = game.ships.find((s) => s.id === action.targetId)
      if (recipientShip && shipUnderCloakRestrictions(game, recipientShip)) {
        return said(`${recipientShip.name} cannot receive command points while cloaked (H6.4.10).`)
      }
      const message = setCommandAssignment(state, game.ships, action.targetId, action.points)
      if (!message) {
        const recipient = game.ships.find((s) => s.id === action.targetId)!
        pushLog(
          game,
          `${commandShip?.name}: ${action.points} command point(s) to ${recipient.name} (H5.2.1).`,
        )
      }
      return said(message)
    }

    // ── Boarding ─────────────────────────────────────────────────────────
    case 'set-sabotage': {
      const target = shipById(game, action.targetId)
      if (!target) return said('No such ship.')
      setSabotageSquads(game, target, action.side, action.squads)
      return ok
    }
    case 'fight-boarders': {
      const target = shipById(game, action.targetId)
      if (!target) return said('No such ship.')
      const outcome = fightBoarders(game, target, action.side)
      return said(
        outcome.captured
          ? `${target.name} is captured.`
          : outcome.repelled
            ? 'The boarders are wiped out.'
            : `${outcome.attackers.kills} defender(s) and ${outcome.defenders.kills} boarder(s) killed.`,
      )
    }

    // ── Flight operations ────────────────────────────────────────────────
    case 'launch-shuttle': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(launchShuttle(game, ship, action.kind ?? 'shuttle', action.marines))
    }
    case 'move-craft':
      return said(moveSmallCraft(game, action.craftId, { x: action.x, y: action.y }))
    case 'capture-craft': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(captureCraft(game, action.craftId, ship))
    }
    case 'displace-tractored': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(displaceTractored(game, ship, action.targetId, action.direction))
    }
    case 'recover-shuttle': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(recoverShuttle(game, action.craftId, ship))
    }
    case 'dock-shuttle': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(dockShuttle(game, action.craftId, ship))
    }

    // ── Abandoning ship (E11.4–E11.6) ────────────────────────────────────
    case 'evacuate-crew': {
      const from = shipById(game, action.shipId)
      const to = shipById(game, action.toShipId)
      if (!from || !to) return said('No such ship.')
      return said(evacuateCrew(game, from, to))
    }
    case 'abandon-ship': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(abandonToPods(game, ship, action.selfDestruct))
    }
    case 'recover-pod': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      return said(recoverPod(game, action.podId, ship, action.method))
    }

    // ── Disengagement ────────────────────────────────────────────────────
    case 'disengage': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      ship.disengaged = true
      pushLog(game, `${ship.name} disengages from the battle.`)
      return ok
    }
  }
}

// Re-exported so panels can keep their imports to one module.
export type { RepairAssignment }

// ---------------------------------------------------------------------------
// Ownership and reversibility — what a captain may take back in a match
// ---------------------------------------------------------------------------

/**
 * Whose action this is, where the question has an answer.
 *
 * Most actions name a ship and belong to whoever commands it. A few name a
 * side outright. `advance-segment` and the step controls belong to nobody:
 * they move the whole table on.
 */
export function actionSide(game: GameState, action: GameAction): string | null {
  const of = (id: string | undefined) => (id ? (shipById(game, id)?.side ?? null) : null)
  switch (action.type) {
    case 'signal-ready':
    case 'set-command-ship':
    case 'assign-command':
      return action.side
    case 'set-sabotage':
    case 'fight-boarders':
      return action.side
    case 'fire-volley':
      return of(action.attackerId)
    case 'declare-coordinated':
      return of(action.shipIds[0])
    case 'fire-small-target':
      return of(action.attackerId)
    case 'move-craft':
    case 'recover-shuttle':
    case 'dock-shuttle':
    case 'capture-craft':
    case 'displace-tractored':
    case 'recover-pod':
      return of('shipId' in action ? action.shipId : undefined)
    case 'advance-segment':
    case 'ops-next-step':
    case 'advance-firing-step':
    case 'set-coordinated-fire':
    case 'queue-damage-choices':
    // The relay actions belong to the table, not to a side: staging is done
    // by whichever console the volley started on, and resolving by whichever
    // console answered last — the store's ownership gate must let both pass.
    case 'stage-damage-action':
    case 'resolve-staged-action':
      return null
    default:
      return of((action as { shipId?: string }).shipId)
  }
}

/**
 * Orders a captain may still take back: written on their own command card and
 * not yet revealed to anyone.
 *
 * The table's own rule is the guide. Plotting is secret until the Navigation
 * Segment turns the cards over (B1.9.1), so a captain may rewrite a card
 * freely — nobody has seen it. Everything else has been *announced*: a volley
 * has rolled dice, a scan has been declared, a cloak has been engaged in front
 * of witnesses. You cannot unring those, and in a match against another human
 * an undo that could is not a convenience, it is a way to fish for a better
 * die roll.
 *
 * Solo and hot-seat play are unaffected: there, undo is a rewind button for
 * one person's own game and the store only consults this in a match.
 */
const REVERSIBLE_IN_MATCH: ReadonlySet<GameAction['type']> = new Set([
  // Resource allocation — secret until it is spent (B2).
  'allocate',
  'arm-mount',
  'spend-battery',
  // The command card itself (C1), secret until Navigation.
  'plot-maneuver',
  'plot-accel',
  'plot-evasive',
  'plot-turn-rate',
  'plot-half-slide',
  'plot-emergency-stop',
  'plot-sensor',
  'plot-shield',
  // Assignments that are bookkeeping until they are used.
  'set-max-system',
  'set-command-ship',
  'assign-command',
  'scout-assign',
  'scout-active',
  'form-up',
  'leave-formation',
  'set-sabotage',
])

/**
 * Whether this action may be taken back by `side` in a match: their own, and
 * still private. Anything that rolled a die, announced a system, or moved the
 * sequence of play along answers false.
 */
export function undoableInMatch(
  game: GameState,
  action: GameAction,
  side: string | null,
): boolean {
  if (!side) return false
  if (!REVERSIBLE_IN_MATCH.has(action.type)) return false
  return actionSide(game, action) === side
}
