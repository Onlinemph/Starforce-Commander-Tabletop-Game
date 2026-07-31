import { hasLineOfSight, type CircleObstacle } from './geometry'
import { actualRange } from './geometry'
import { genSysSetting, undamagedSystemBoxes, type ShipState } from './shipState'
import type { SystemKind } from './types'

/**
 * The Operations Segment (J1) and the systems that run inside it: informational
 * scans (J4) and transporters (J5).
 *
 * Most of a ship's general systems are used here rather than in combat, and the
 * segment is walked in five fixed steps so that everyone's shields go up or down
 * before anyone's tractor beams reach out, and tractor beams settle before
 * anyone beams across (J1.4).
 */

// ---------------------------------------------------------------------------
// J1 — the segment's five steps
// ---------------------------------------------------------------------------

export type OperationsStep = 'delay' | 'shields' | 'tractor' | 'transport' | 'other'

/** Steps A–E, in the order J1.3 and J1.4 give them. */
export const OPERATIONS_STEPS: OperationsStep[] = ['delay', 'shields', 'tractor', 'transport', 'other']

export const OPERATIONS_STEP_LABELS: Record<OperationsStep, string> = {
  delay: 'A · Delayed activation',
  shields: 'B · Raise or lower shields',
  tractor: 'C · Tractor beams',
  transport: 'D · Transporters',
  other: 'E · Activate other systems',
}

export const OPERATIONS_STEP_RULES: Record<OperationsStep, string> = {
  delay:
    'Announce systems with an activation delay, and engage or disengage cloaking devices (J1.3, H6.6).',
  shields: 'A ship may raise or lower shields this phase, but not both (G1.1.5).',
  tractor: 'Gain, maintain, release or break tractor beam locks (J3, J3.6).',
  transport: 'Beam marine squads and landing parties, once shields are down (J5.2.1).',
  other: 'Informational scans and everything else (J4.2.2).',
}

/**
 * How a system is being run this phase (J1.1).
 *
 * GEN SYS at MAX does not put every system on maximum: only one system per
 * combat phase runs at its maximum level, and the rest stay normal (J1.1.2).
 */
export type PowerLevel = 'off' | 'nrm' | 'max'

export function systemPower(ship: ShipState, kind: SystemKind, maxSystem: SystemKind | null): PowerLevel {
  if (undamagedSystemBoxes(ship, kind) === 0) return 'off'
  const gen = genSysSetting(ship)
  if (gen === 'off') return 'off'
  return gen === 'max' && maxSystem === kind ? 'max' : 'nrm'
}

/**
 * Choose which single system runs at maximum this phase. Returns a refusal
 * message rather than throwing, so the UI can explain it.
 */
export function chooseMaxSystem(ship: ShipState, kind: SystemKind | null): string | null {
  if (kind === null) return null
  if (genSysSetting(ship) !== 'max') {
    return 'GEN SYS is not set to MAX this round, so no system may run at maximum (J1.1.2).'
  }
  if (undamagedSystemBoxes(ship, kind) === 0) {
    return `${ship.name} has no undamaged ${kind} boxes.`
  }
  return null
}

// ---------------------------------------------------------------------------
// J4 — informational scans
// ---------------------------------------------------------------------------

/** Effective range within which a ship may gather information (J4.2.1). */
export const SCAN_RANGE = 8

/**
 * Information gathered on each object, by side. Points are cumulative across
 * phases and across every friendly unit that contributed (J4.2.3), so this is
 * keyed side → object id rather than ship → object.
 */
export type InfoLedger = Record<string, Record<string, number>>

export function infoPoints(ledger: InfoLedger, side: string, objectId: string): number {
  return ledger[side]?.[objectId] ?? 0
}

export function addInfoPoints(ledger: InfoLedger, side: string, objectId: string, points: number): void {
  if (!ledger[side]) ledger[side] = {}
  ledger[side][objectId] = (ledger[side][objectId] ?? 0) + points
}

export interface ScanYield {
  /** Points from the ship's own science boxes. */
  fromSciences: number
  /** Points from sensor points assigned to Tactical Scan. */
  fromSensors: number
  total: number
  power: PowerLevel
}

/**
 * What one scan is worth: a point per science box at normal power, two at
 * maximum, plus a point per sensor point on Tactical Scan (J4.2.2 item 3).
 */
export function scanYield(ship: ShipState, maxSystem: SystemKind | null, tacticalScan: number): ScanYield {
  const power = systemPower(ship, 'SCNC', maxSystem)
  const boxes = undamagedSystemBoxes(ship, 'SCNC')
  const fromSciences = power === 'off' ? 0 : boxes * (power === 'max' ? 2 : 1)
  const fromSensors = Math.max(0, tacticalScan)
  return { fromSciences, fromSensors, total: fromSciences + fromSensors, power }
}

export interface ScanTarget {
  id: string
  name: string
  position: { x: number; y: number }
}

/**
 * Why a scan cannot be made, or `null` if it can (J4.2.2).
 *
 * `effectiveRange` is the range after targeting support has reduced it, since
 * J4.2.1 explicitly allows a scan to reach further when the target has been
 * illuminated (H3.4).
 */
export function scanRefusal(
  ship: ShipState,
  target: ScanTarget,
  effectiveRange: number,
  obstacles: CircleObstacle[],
  maxSystem: SystemKind | null,
): string | null {
  if (undamagedSystemBoxes(ship, 'SCNC') === 0 && ship.sensors.tacticalScan === 0) {
    return `${ship.name} has no undamaged SCNC boxes and no Tactical Scan points (J4.2.2).`
  }
  if (systemPower(ship, 'SCNC', maxSystem) === 'off' && ship.sensors.tacticalScan === 0) {
    return 'GEN SYS is switched off, so the sciences cannot run (J4.1.2).'
  }
  if (!hasLineOfSight(ship.placement.position, target.position, obstacles)) {
    return `No line of sight to ${target.name} (J4.2.2 item 1).`
  }
  if (effectiveRange > SCAN_RANGE) {
    return `${target.name} is at effective range ${effectiveRange}"; a scan needs ${SCAN_RANGE}" or less (J4.2.1).`
  }
  return null
}

// ---------------------------------------------------------------------------
// J5 — transporters
// ---------------------------------------------------------------------------

/** Transporter range at normal and maximum power (J5.1.2). */
export const TRANSPORTER_RANGE: Record<'nrm' | 'max', number> = { nrm: 2, max: 4 }

/** Squads one ship may beam in a phase — one per undamaged TRAN box (J5.2.2). */
export function transportCapacity(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'TRAN')
}

export function transporterRange(ship: ShipState, maxSystem: SystemKind | null): number {
  const power = systemPower(ship, 'TRAN', maxSystem)
  return power === 'max' ? TRANSPORTER_RANGE.max : TRANSPORTER_RANGE.nrm
}

/** Whether any shield facing is still up (J5.1.3). */
export function shieldsAllDown(ship: ShipState): boolean {
  return (['F', 'S', 'A', 'P'] as const).every((side) => ship.shieldsDown[side])
}

export interface TransportRequest {
  from: ShipState
  to: ShipState
  squads: number
  /** Squads already beamed by `from` this phase. */
  usedThisPhase: number
  maxSystem: SystemKind | null
}

/**
 * Why a transport cannot happen, or `null` if it can.
 *
 * The awkward rule is J5.1.3's defence fields: a ship cannot beam an enemy's
 * people off their own ship, even with the shields down, so a transport onto an
 * enemy hull may only ever *deliver* marines.
 */
export function transportRefusal(request: TransportRequest): string | null {
  const { from, to, squads, usedThisPhase, maxSystem } = request
  if (squads < 1) return 'Nothing selected to transport.'

  const capacity = transportCapacity(from)
  if (capacity === 0) return `${from.name} has no undamaged TRAN boxes (J5.2.2).`
  if (usedThisPhase + squads > capacity) {
    return `${from.name} can beam ${capacity} squad(s) a phase and has already beamed ${usedThisPhase} (J5.2.2).`
  }
  if (systemPower(from, 'TRAN', maxSystem) === 'off') {
    return 'GEN SYS is switched off, so the transporters cannot run (J1.1.1).'
  }

  const range = actualRange(from.placement.position, to.placement.position)
  const reach = transporterRange(from, maxSystem)
  if (range > reach) {
    return `${to.name} is ${range}" away; the transporter reaches ${reach}" (J5.1.2).`
  }

  // Shields must be down at both ends (J5.1.3).
  if (!shieldsAllDown(from)) return `${from.name} must drop its shields to beam (J5.1.3).`
  if (!shieldsAllDown(to)) return `${to.name}'s shields are up (J5.1.3).`

  if (from.marineSquads < squads) {
    return `${from.name} has only ${from.marineSquads} marine squad(s) aboard.`
  }
  return null
}

/** Move marine squads across. The caller has already checked the refusal. */
export function transport(from: ShipState, to: ShipState, squads: number): void {
  from.marineSquads -= squads
  if (from.side === to.side) {
    to.marineSquads += squads
  } else {
    // J6 — squads landed on an enemy hull fight in the Boarding Combat Segment.
    to.boarders[from.side] = (to.boarders[from.side] ?? 0) + squads
  }
}
