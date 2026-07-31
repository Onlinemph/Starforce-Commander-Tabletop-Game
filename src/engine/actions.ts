import {
  attemptSearch,
  disengageCloak,
  engageCloak,
  reduceDetection,
  DETECTION_LABELS,
} from './cloaking'
import { resolveVolley, type FireMode, type MountSelection, type VolleyResult } from './combat'
import { setCommandAssignment } from './command'
import {
  armMount,
  autoArmIfChoiceFree,
  resolveDamageControl,
  setAllocation,
  type RepairAssignment,
} from './engineering'
import { chooseLead, joinFormation, leaveFormation } from './formation'
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
  cloudModifiers,
  commandStateFor,
  contestTractor,
  damageContext,
  declareCoordinatedFire,
  dockShuttle,
  fightBoarders,
  fireAtSmallTarget,
  launchHoming,
  launchProbe,
  launchShuttle,
  moveSmallCraft,
  performScan,
  performTransport,
  pushLog,
  recordAttack,
  recoverShuttle,
  releaseTractor,
  resolveHomingImpacts,
  scoutSupport,
  setMaxSystem,
  setSabotageSquads,
  setShieldDown,
  terrainObstacles,
  tractorIncomingHoming,
  workingSystemBoxes,
  type GameState,
} from './game'
import { setScoutAssignment, setScoutSensorActive } from './scouting'
import { sensorFunctionCap, type ShipState } from './shipState'
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
  | { type: 'ops-next-step' }
  | { type: 'advance-firing-step' }
  | { type: 'set-coordinated-fire'; on: boolean }
  // Resource Allocation (B2, E4.2)
  | { type: 'allocate'; shipId: string; lineId: string; circles: number }
  | { type: 'arm-mount'; shipId: string; weaponId: string; mountIndex: number }
  // Damage Control (B3.2)
  | { type: 'damage-control'; shipId: string; assignments: RepairAssignment[] }
  // Command card plotting (C1)
  | { type: 'plot-maneuver'; shipId: string; maneuver: Maneuver; direction: TurnDirection | null }
  | { type: 'plot-accel'; shipId: string; delta: number }
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
    }
  | { type: 'pass-fire'; shipId: string }
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
  // Flight operations (J8)
  | { type: 'launch-shuttle'; shipId: string; kind?: SmallCraftKind; marines?: number }
  | { type: 'move-craft'; craftId: string; x: number; y: number }
  | { type: 'recover-shuttle'; craftId: string; shipId: string }
  | { type: 'dock-shuttle'; craftId: string; shipId: string }
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
}

const ok: ActionOutcome = { message: null }
const said = (message: string | null): ActionOutcome => ({ message })

function shipById(game: GameState, id: string): ShipState | null {
  return game.ships.find((s) => s.id === id) ?? null
}

/**
 * Apply one action to the game. The single mutation switchboard: the store
 * calls it live, and replay calls it again with the same journal.
 */
export function applyAction(game: GameState, action: GameAction): ActionOutcome {
  switch (action.type) {
    // ── Sequence of play ─────────────────────────────────────────────────
    case 'advance-segment':
      advanceSegment(game)
      return ok
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

    // ── Resource allocation ──────────────────────────────────────────────
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
    case 'damage-control': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
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
      card.maneuver = action.maneuver
      card.direction = action.direction
      return ok
    }
    case 'plot-accel': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      card.accel += action.delta
      card.speed = ship.speed + card.accel
      return ok
    }
    case 'plot-sensor': {
      const ship = shipById(game, action.shipId)
      const card = game.orders[action.shipId]
      if (!ship || !card) return said('No command card for that ship.')
      card.sensors[action.key] = Math.max(0, Math.min(action.value, sensorFunctionCap(ship)))
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
      const terrain = cloudModifiers(game, attacker, target)
      const result = resolveVolley(
        {
          attacker,
          target,
          mounts: action.mounts,
          mode: action.mode,
          precisionSection: action.mode === 'precision' ? action.precisionSection : undefined,
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
          lowSpeedNegated:
            terrain.lowSpeedNegated ||
            asteroidFieldsAt(game.scenario.terrain, target.placement.position).length > 0,
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
          (result.damage.leak ? `, ${result.damage.leak} leak` : ''),
      )
      return { message: null, volley: result }
    }
    case 'pass-fire': {
      const ship = shipById(game, action.shipId)
      if (!ship) return said('No such ship.')
      game.firedThisSegment.add(ship.id)
      pushLog(game, `${ship.name} declines to fire this phase (E6.2 Step 1).`)
      return ok
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
      disengageCloak(cloak)
      pushLog(game, `${ship.name} decloaks (H6.7).`)
      return ok
    }
    case 'reduce-detection': {
      const ship = shipById(game, action.shipId)
      const cloak = ship ? cloakOf(game, ship) : null
      if (!ship || !cloak) return said('No cloaking system.')
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
    case 'cloak-search': {
      const ship = shipById(game, action.shipId)
      const ghost = shipById(game, action.ghostId)
      const cloak = ghost ? cloakOf(game, ghost) : null
      if (!ship || !ghost || !cloak) return said('Nothing to search for.')
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
