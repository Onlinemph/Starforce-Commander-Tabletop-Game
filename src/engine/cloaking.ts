import { rollDie, type Rng } from './dice'
import { actualRange } from './geometry'
import {
  scoutSensorsOn,
} from './scouting'
import { undamagedSystemBoxes, type ShipState } from './shipState'
import type { Placement, Point } from './types'

/**
 * Cloaking Systems (H6, Expansion 5).
 *
 * The heart of the rule is that an undetected cloaked ship has no position on
 * the map. Its counter stays at its *datum* — where it was last seen — and the
 * owning player tracks only three things: resource allocation, speed, and how
 * many phases it has gone undetected (H6.1). When it decloaks or is found, it
 * walks that movement forward from the datum, one phase at a time (H6.8).
 *
 * Searching runs the other way: each enemy ship rolls to climb a four-step
 * ladder — Undetected, Contact, Track, Target Lock (H6.2) — and what it may do
 * with its weapons depends on which rung it has reached (H6.14).
 */

// ---------------------------------------------------------------------------
// Detection levels (H6.2)
// ---------------------------------------------------------------------------

export type DetectionLevel = 0 | 1 | 2 | 3

export const DETECTION_LABELS: Record<DetectionLevel, string> = {
  0: 'Undetected',
  1: 'Contact',
  2: 'Track',
  3: 'Target Lock',
}

/** Search range is five inches per undamaged SCNC box (H6.9.1). */
export const SEARCH_RANGE_PER_SCNC = 5

/** Cloaking within this range of an enemy hands it a free Contact (H6.6.3). */
export const CLOAK_NEAR_ENEMY_RANGE = 8

/** A cloaked ship may not exceed this speed without risking detection (H6.4.6). */
export const CLOAK_SAFE_SPEED = 2

/** Every four points of damage grants a bonus search roll (H6.15.3). */
export const DAMAGE_PER_SEARCH_ROLL = 4

/** After this long cloaked, a ship may reappear anywhere near its datum (H6.8.7). */
export const LONG_CLOAK_PHASES = 18
export const LONG_CLOAK_RADIUS = 18

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A cloaked ship's hidden track (H6.1, H6.8.4). */
export interface CloakState {
  /** Cloak engaged — true from the moment of activation (H6.6.2). */
  engaged: boolean
  /** Where the ship was last seen; its movement replays from here (H6.1). */
  datum: Placement
  /** Speed in each phase spent cloaked and undetected, oldest first (H6.5.4). */
  speedLog: number[]
  /** Detection level held by each searching ship, keyed by ship id (H6.9.3). */
  detection: Record<string, DetectionLevel>
  /** Phase count since the cloak engaged, for the minimum-cloak rule (H6.6.7). */
  phasesCloaked: number
  /** Phases since the cloak came off, for the minimum-uncloak rule (H6.7.7). */
  phasesUncloaked: number
  /** Searchers that have already climbed a level this segment (H6.15.1). */
  raisedThisSegment: string[]
  /**
   * Power was cut at Resource Allocation, so the cloak comes off in Phase 1
   * whatever the captain wants (H6.3.2).
   */
  powerCut: boolean
  /**
   * H6.6.8 — the power went before the minimum cloak time was served. The
   * cloak took a point of damage on the way down and the ship stays under
   * every cloaking restriction for the rest of this round's Phase 1, visible
   * and shootable but with its shields still down and its guns still cold.
   * The round it applies to, or null.
   */
  restrictedRound: number | null
}

export function newCloakState(placement: Placement): CloakState {
  return {
    engaged: false,
    datum: { position: { ...placement.position }, heading: placement.heading },
    speedLog: [],
    detection: {},
    phasesCloaked: 0,
    phasesUncloaked: Infinity,
    raisedThisSegment: [],
    powerCut: false,
    restrictedRound: null,
  }
}

export function hasCloak(ship: ShipState): boolean {
  return ship.form.systems.some((g) => g.kind === 'CLOAK' && g.boxes > 0)
}

/** A cloak knocked out by a Special System hit stops working (H6.1.4). */
export function cloakOperational(ship: ShipState): boolean {
  return hasCloak(ship) && undamagedSystemBoxes(ship, 'CLOAK') > 0
}

/**
 * A cloak needs *every* circle on its CLOAK line filled; partial power does
 * nothing at all (H6.3.1).
 */
export function cloakFullyPowered(ship: ShipState): boolean {
  const line = ship.form.functions.find((l) => l.label === 'CLOAK')
  if (!line || line.steps.length === 0) return false
  return (ship.allocation[line.id] ?? 0) >= line.steps.length
}

export function isCloaked(state: CloakState | undefined): boolean {
  return state?.engaged === true
}

/** The highest detection level any searcher holds (H6.2). */
export function bestDetection(state: CloakState): DetectionLevel {
  const levels = Object.values(state.detection)
  return levels.length === 0 ? 0 : (Math.max(...levels) as DetectionLevel)
}

export function detectionBy(state: CloakState, searcherId: string): DetectionLevel {
  return state.detection[searcherId] ?? 0
}

/** An undetected cloaked ship has no position on the map (H6.2.2). */
export function positionIsHidden(state: CloakState): boolean {
  return state.engaged && bestDetection(state) === 0
}

// ---------------------------------------------------------------------------
// Cloaking effects (H6.4)
// ---------------------------------------------------------------------------

export interface CloakEffects {
  /** H6.4.1 — shields are down; damage goes straight inside. */
  shieldsDown: boolean
  /** H6.4.2 — no weapon fire and no homing weapon launches. */
  weaponsLocked: boolean
  /** H6.4.3 — no information scans. */
  noScans: boolean
  /** H6.4.4 — targeting points do nothing. */
  targetingDisabled: boolean
  /** H6.4.7 — no tractor beams, in either direction. */
  tractorsDisabled: boolean
  /** H6.4.8 — no transporters, in either direction. */
  transportersDisabled: boolean
  /** H6.4.10 — CMND systems lend nothing. */
  commandDisabled: boolean
}

export const CLOAKED_EFFECTS: CloakEffects = {
  shieldsDown: true,
  weaponsLocked: true,
  noScans: true,
  targetingDisabled: true,
  tractorsDisabled: true,
  transportersDisabled: true,
  commandDisabled: true,
}

const NO_EFFECTS: CloakEffects = {
  shieldsDown: false,
  weaponsLocked: false,
  noScans: false,
  targetingDisabled: false,
  tractorsDisabled: false,
  transportersDisabled: false,
  commandDisabled: false,
}

export function cloakEffects(state: CloakState | undefined): CloakEffects {
  return isCloaked(state) ? CLOAKED_EFFECTS : NO_EFFECTS
}

/**
 * Jamming points are re-purposed while cloaked: they are extra power to the
 * cloak rather than jamming, and they are what a searcher's targeting has to
 * beat (H6.4.5, H6.5.1, H6.10.2).
 */
export function cloakStrength(ship: ShipState): number {
  return ship.sensors.jamming
}

// ---------------------------------------------------------------------------
// Engaging and disengaging (H6.6, H6.7)
// ---------------------------------------------------------------------------

export interface EngageResult {
  ok: boolean
  reason?: string
  /** Enemies that got a free Contact for being inside range 8 (H6.6.3). */
  freeContacts: string[]
}

/**
 * Engage the cloak during Operations step 2A (H6.6.2). Any enemy within range 8
 * sees it happen and starts with a Contact (H6.6.3).
 */
export function engageCloak(
  ship: ShipState,
  state: CloakState,
  enemies: readonly ShipState[],
): EngageResult {
  if (state.engaged) return { ok: false, reason: 'Already cloaked.', freeContacts: [] }
  if (!cloakOperational(ship)) {
    return { ok: false, reason: `${ship.name}'s cloaking system is damaged (H6.1.4).`, freeContacts: [] }
  }
  if (!cloakFullyPowered(ship)) {
    return {
      ok: false,
      reason: 'The cloak needs every circle on its CLOAK line filled; partial power has no effect (H6.3.1).',
      freeContacts: [],
    }
  }
  // H6.7.7: once off, the cloak stays off for a phase before it may re-engage.
  if (state.phasesUncloaked < 1) {
    return {
      ok: false,
      reason: 'The cloak must stay off for a full phase before re-engaging (H6.7.7).',
      freeContacts: [],
    }
  }

  state.engaged = true
  state.phasesCloaked = 0
  state.phasesUncloaked = 0
  state.speedLog = []
  state.detection = {}
  state.datum = {
    position: { ...ship.placement.position },
    heading: ship.placement.heading,
  }

  const freeContacts: string[] = []
  for (const enemy of enemies) {
    if (enemy.destroyed || enemy.disengaged) continue
    if (actualRange(ship.placement.position, enemy.placement.position) <= CLOAK_NEAR_ENEMY_RANGE) {
      state.detection[enemy.id] = 1
      freeContacts.push(enemy.id)
    }
  }
  return { ok: true, freeContacts }
}

/**
 * Whether the cloak may be switched off this phase. Once engaged it must stay
 * on for a full phase (H6.6.7).
 */
export function mayDecloak(state: CloakState): boolean {
  return state.engaged && state.phasesCloaked >= 1
}

export function disengageCloak(state: CloakState): void {
  state.engaged = false
  state.phasesUncloaked = 0
  state.detection = {}
  state.speedLog = []
  state.powerCut = false
}

/**
 * The cloak's power was cut during Resource Allocation (H6.3.2): it must come
 * off during the Operations Segment of Phase 1. If that cut lands before the
 * minimum cloak time has been served, the abrupt loss damages the system and
 * the ship stays under cloaking restrictions for the rest of Phase 1 (H6.6.8).
 *
 * Returns whether the cloak was damaged, so the caller can mark the box and
 * say so in the log.
 */
export function cutCloakPower(state: CloakState, round: number): { damaged: boolean } {
  if (!state.engaged || state.powerCut) return { damaged: false }
  state.powerCut = true
  // H6.6.7 wants a full phase; anything less and the drop is violent.
  const damaged = state.phasesCloaked < 1
  if (damaged) state.restrictedRound = round
  return { damaged }
}

/**
 * Whether the ship is still living under the cloak's restrictions — either
 * because the cloak is running, or because it was torn down mid-cycle and
 * H6.6.8 keeps the effects in force for the rest of Phase 1.
 *
 * Distinct from `isCloaked`, which answers whether the ship is *hidden*. A
 * ship in the H6.6.8 window is in plain sight and can be shot at normally; it
 * simply cannot shoot back, raise a shield, or run a scan.
 */
export function underCloakRestrictions(
  state: CloakState | undefined,
  round: number,
  phase: string,
): boolean {
  if (!state) return false
  if (state.engaged) return true
  return state.restrictedRound === round && phase === 'combat-1'
}

// ---------------------------------------------------------------------------
// Searching (H6.9 – H6.12)
// ---------------------------------------------------------------------------

/** Five inches per undamaged SCNC box (H6.9.1). */
export function searchRange(searcher: ShipState): number {
  return undamagedSystemBoxes(searcher, 'SCNC') * SEARCH_RANGE_PER_SCNC
}

/**
 * The point a searcher measures to: the datum while the ship is undetected, its
 * real position once it is not (H6.9.1).
 */
export function searchTarget(cloaked: ShipState, state: CloakState, searcherId: string): Point {
  return detectionBy(state, searcherId) === 0 ? state.datum.position : cloaked.placement.position
}

export function withinSearchRange(
  searcher: ShipState,
  cloaked: ShipState,
  state: CloakState,
): boolean {
  const to = searchTarget(cloaked, state, searcher.id)
  return actualRange(searcher.placement.position, to) <= searchRange(searcher)
}

/**
 * Dice for one search attempt (H6.10.2, H6.11.3, H6.12.3).
 *
 * Targeting is compared against the cloaked ship's jamming: more targeting
 * rolls at least two dice and one more for every point of the difference beyond
 * that, equal targeting rolls one, and less targeting cannot search at all.
 *
 * A scout adds the scout sensors it has pointed at the cloaked ship to its own
 * targeting (H6.16.2).
 */
export function searchDice(
  searcher: ShipState,
  cloaked: ShipState,
  state: CloakState,
): { count: number; color: 'green' | 'yellow' } {
  const level = detectionBy(state, searcher.id)
  // Climbing to a Target Lock uses yellow dice, which hit twice as often
  // (H6.12.3, H6.14.3).
  const color = level >= 2 ? 'yellow' : 'green'

  const scoutPoints = scoutSensorsOn(searcher, 'targeting').filter(
    (s) => s.targetId === cloaked.id,
  ).length
  const targeting = searcher.sensors.targeting + scoutPoints
  const jamming = cloakStrength(cloaked)

  if (targeting < jamming) return { count: 0, color }
  if (targeting === jamming) return { count: 1, color }
  return { count: Math.max(2, targeting - jamming), color }
}

export interface SearchOutcome {
  /** Dice actually rolled. */
  faces: string[]
  /** True when the detection level went up. */
  detected: boolean
  from: DetectionLevel
  to: DetectionLevel
  reason?: string
}

/**
 * One search attempt (H6.10 – H6.12). Any `H` raises the level by exactly one,
 * however many are rolled, and a searcher may only climb one level per segment
 * (H6.10.3, H6.15.1).
 */
export function attemptSearch(
  searcher: ShipState,
  cloaked: ShipState,
  state: CloakState,
  rng: Rng,
): SearchOutcome {
  const from = detectionBy(state, searcher.id)
  const fail = (reason: string): SearchOutcome => ({ faces: [], detected: false, from, to: from, reason })

  if (!state.engaged) return fail(`${cloaked.name} is not cloaked.`)
  if (from >= 3) return fail(`${searcher.name} already holds a Target Lock.`)
  if (state.raisedThisSegment.includes(searcher.id)) {
    return fail('A searching ship may only gain one detection level per segment (H6.15.1).')
  }
  if (searcher.destroyed || searcher.derelict || searcher.disengaged) {
    return fail(`${searcher.name} cannot search.`)
  }
  // H6.9.5 is the caller's to check: whether the *searcher* is running its own
  // cloak is not visible from here, and a ship hunting from behind its own
  // cloak is exactly what that rule forbids.
  if (!withinSearchRange(searcher, cloaked, state)) {
    return fail(`${cloaked.name} is beyond ${searcher.name}'s search range of ${searchRange(searcher)}" (H6.9.1).`)
  }

  const { count, color } = searchDice(searcher, cloaked, state)
  if (count === 0) {
    return fail('Targeting is lower than the cloaked ship\'s jamming — no search may be attempted (H6.10.2).')
  }

  const faces: string[] = []
  let hit = false
  for (let i = 0; i < count; i++) {
    const face = rollDie(color, rng).face
    faces.push(face)
    if (face === 'H') hit = true
  }
  if (!hit) return { faces, detected: false, from, to: from }

  const to = (from + 1) as DetectionLevel
  state.detection[searcher.id] = to
  state.raisedThisSegment.push(searcher.id)
  return { faces, detected: true, from, to }
}

/**
 * A bonus search granted by an event rather than the once-per-phase scan
 * (H6.15): high speed, heavy damage, or launching small craft. The dice count
 * comes from the event; the colour still comes from the searcher's level.
 */
export function bonusSearch(
  searcher: ShipState,
  cloaked: ShipState,
  state: CloakState,
  dice: number,
  rng: Rng,
): SearchOutcome {
  const from = detectionBy(state, searcher.id)
  if (dice <= 0 || from >= 3 || !state.engaged) {
    return { faces: [], detected: false, from, to: from }
  }
  if (state.raisedThisSegment.includes(searcher.id)) {
    return { faces: [], detected: false, from, to: from,
      reason: 'Already gained a level this segment (H6.15.1).' }
  }
  if (!withinSearchRange(searcher, cloaked, state)) {
    return { faces: [], detected: false, from, to: from, reason: 'Out of search range (H6.9.1).' }
  }

  const { color } = searchDice(searcher, cloaked, state)
  const faces: string[] = []
  let hit = false
  for (let i = 0; i < dice; i++) {
    const face = rollDie(color, rng).face
    faces.push(face)
    if (face === 'H') hit = true
  }
  if (!hit) return { faces, detected: false, from, to: from }

  const to = (from + 1) as DetectionLevel
  state.detection[searcher.id] = to
  state.raisedThisSegment.push(searcher.id)
  return { faces, detected: true, from, to }
}

/** Extra dice from a cloaked ship's speed (H6.15.2): one per point above 2. */
export function speedSearchDice(speed: number): number {
  return Math.max(0, Math.abs(speed) - CLOAK_SAFE_SPEED)
}

/** Extra dice from damage taken (H6.15.3): one per full four points. */
export function damageSearchDice(damage: number): number {
  return Math.floor(damage / DAMAGE_PER_SEARCH_ROLL)
}

// ---------------------------------------------------------------------------
// Reducing detection (H6.13)
// ---------------------------------------------------------------------------

export interface EvadeOutcome {
  searcherId: string
  face: string
  reduced: boolean
  to: DetectionLevel
}

/**
 * The cloaked ship's own attempt to shake pursuit, made immediately before the
 * searchers roll (H6.13.2): one blue die per searcher holding any level, and an
 * `M` drops that searcher one rung.
 */
export function reduceDetection(state: CloakState, rng: Rng): EvadeOutcome[] {
  const out: EvadeOutcome[] = []
  for (const [searcherId, level] of Object.entries(state.detection)) {
    if (level <= 0) continue
    const face = rollDie('blue', rng).face
    const reduced = face === 'M'
    const to = (reduced ? level - 1 : level) as DetectionLevel
    if (reduced) {
      if (to === 0) delete state.detection[searcherId]
      else state.detection[searcherId] = to
    }
    out.push({ searcherId, face, reduced, to })
  }
  return out
}

// ---------------------------------------------------------------------------
// Firing at a cloaked ship (H6.14)
// ---------------------------------------------------------------------------

export interface FiringPermission {
  mayFire: boolean
  /** Track-level fire is degraded; a Target Lock fires normally (H6.14.3/4). */
  degraded: boolean
  reason?: string
}

export function firingPermission(state: CloakState, searcherId: string): FiringPermission {
  if (!state.engaged) return { mayFire: true, degraded: false }
  const level = detectionBy(state, searcherId)
  switch (level) {
    case 0:
      return { mayFire: false, degraded: false, reason: 'The ship is undetected and cannot be fired upon (H6.14.1).' }
    case 1:
      return { mayFire: false, degraded: false, reason: 'A Contact is too vague to fire at (H6.14.2).' }
    case 2:
      return { mayFire: true, degraded: true }
    default:
      return { mayFire: true, degraded: false }
  }
}

/** Precision targeting is barred at every detection level (H6.4.11). */
export function precisionAllowed(state: CloakState | undefined): boolean {
  return !isCloaked(state)
}

// ---------------------------------------------------------------------------
// Undetected movement (H6.8)
// ---------------------------------------------------------------------------

/** Maneuvers a cloaked ship may use while replaying hidden movement (H6.8.5). */
export const CLOAKED_MANEUVERS = ['straight', 'slide', 'easy', 'standard'] as const

export function maneuverAllowedWhileCloaked(maneuver: string): boolean {
  return (CLOAKED_MANEUVERS as readonly string[]).includes(maneuver)
}

/**
 * A ship cloaked for six rounds may simply reappear anywhere within 18 inches
 * of its datum, on any heading, at speed 0–2 (H6.8.7). It is the escape hatch
 * for a long hidden approach that would otherwise need eighteen plotted moves.
 */
export function mayFreePlace(state: CloakState): boolean {
  return state.speedLog.length >= LONG_CLOAK_PHASES
}

export function freePlacementLegal(state: CloakState, to: Placement, speed: number): string | null {
  if (!mayFreePlace(state)) {
    return `A ship must be cloaked ${LONG_CLOAK_PHASES} phases before placing freely (H6.8.7).`
  }
  const range = actualRange(state.datum.position, to.position)
  if (range > LONG_CLOAK_RADIUS) {
    return `Free placement is within ${LONG_CLOAK_RADIUS}" of the datum (H6.8.7).`
  }
  if (Math.abs(speed) > CLOAK_SAFE_SPEED) {
    return `Free placement is at speed 0 to ${CLOAK_SAFE_SPEED} (H6.8.7).`
  }
  return null
}

/**
 * Order in which simultaneously-revealed cloaked ships replay their movement:
 * fewest phases cloaked first, ties broken by a die roll (H6.8.6).
 */
export function revealOrder(
  entries: ReadonlyArray<{ id: string; phasesCloaked: number }>,
  rng: Rng,
): string[] {
  return [...entries]
    .map((e) => ({ ...e, tiebreak: rng.int(1000) }))
    .sort((a, b) => a.phasesCloaked - b.phasesCloaked || a.tiebreak - b.tiebreak)
    .map((e) => e.id)
}
