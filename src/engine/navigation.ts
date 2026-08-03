import { maneuverAllowedWhenCaptured } from './boarding'
import { drawCard, resolveCard, type DamageContext } from './damage'
import { applyManeuver, maneuverStress, type ManeuverResult } from './geometry'
import {
  currentMaxSpeed,
  findLine,
  lineValue,
  maxReverseSpeed,
  turnTemplateAt,
  type ShipState,
} from './shipState'
import type { CommandCard, DamageCard, Maneuver } from './types'

/**
 * Navigation: plotting validation, movement execution, and the Stress Check
 * (C1 – C4, A3.4.1).
 */

// ---------------------------------------------------------------------------
// Plot validation (C1)
// ---------------------------------------------------------------------------

export interface PlotError {
  message: string
  /** Illegal plots are not rejected outright — the ship moves straight (C1.1.2). */
  fallbackToStraight: boolean
}

/** Acceleration points the ship generated this round (C1.2.3). */
export function accelerationBudget(ship: ShipState): number {
  const line = findLine(ship.form, 'accel')
  return line ? lineValue(ship, line.id) : 0
}

export function emergencyTurnPowered(ship: ShipState): boolean {
  const line = findLine(ship.form, 'emergency-turn')
  if (!line) return false
  return (ship.allocation[line.id] ?? 0) > 0 || line.freeValue > 0
}

export function validatePlot(ship: ShipState, card: CommandCard): PlotError[] {
  const errors: PlotError[] = []
  const accel = Math.abs(card.accel)

  // A captured ship keeps its engines but little else: forward movement and
  // Standard turns only, though it may still change speed (J6.2.5 item 1).
  if (ship.capturedBy !== null && !maneuverAllowedWhenCaptured(card.maneuver)) {
    errors.push({
      message: `A captured ship may only fly straight or make Standard turns (J6.2.5).`,
      fallbackToStraight: true,
    })
  }

  // Per-phase acceleration limit (C1.2.5).
  if (accel > ship.form.sublight.maxAccelPerPhase) {
    errors.push({
      message: `Exceeds max acceleration per phase (${ship.form.sublight.maxAccelPerPhase}).`,
      fallbackToStraight: false,
    })
  }

  // Round budget: acceleration points must have been paid for (C1.2.3).
  if (ship.accelUsedThisRound + accel > accelerationBudget(ship)) {
    errors.push({
      message: `Only ${accelerationBudget(ship) - ship.accelUsedThisRound} acceleration points remain this round.`,
      fallbackToStraight: false,
    })
  }

  // Speed limits (C1.2.7, C3.7.3, E8.5.4).
  const maxForward = currentMaxSpeed(ship)
  if (card.speed > maxForward) {
    errors.push({ message: `Speed ${card.speed} exceeds current maximum of ${maxForward}.`, fallbackToStraight: false })
  }
  if (card.speed < 0 && Math.abs(card.speed) > maxReverseSpeed(ship)) {
    errors.push({
      message: `Reverse speed limited to ${maxReverseSpeed(ship)} (C3.7.3).`,
      fallbackToStraight: false,
    })
  }

  // Emergency stop keeps the ship still for two phases (C3.8.2, E8.5.4).
  if (ship.emergencyStopPhases > 0) {
    if (card.speed !== 0) {
      errors.push({ message: 'Ship is performing an Emergency Stop and must remain at speed zero.', fallbackToStraight: true })
    }
    if (card.maneuver !== 'straight' && card.maneuver !== 'easy') {
      errors.push({ message: 'While stopped the ship may only move straight or make a single Easy Turn (C3.8.4).', fallbackToStraight: true })
    }
  }

  // Emergency turns need power and are once per round (C3.5.4, C3.5.5).
  if (card.maneuver === 'em-90' || card.maneuver === 'em-180') {
    if (!emergencyTurnPowered(ship)) {
      errors.push({ message: 'Emergency turn requires power allocated to EMER (C3.5.2).', fallbackToStraight: true })
    }
    if (ship.emergencyTurnUsed) {
      errors.push({ message: 'Only one emergency turn per round (C3.5.4).', fallbackToStraight: true })
    }
  }

  // A slide at speed zero is illegal (C2.4.2).
  if (card.maneuver === 'slide' && card.speed === 0) {
    errors.push({ message: 'No ship may perform a Slide at speed zero (C2.4.2).', fallbackToStraight: true })
  }

  // Sensor split may not exceed available points or the per-function cap (H2.2.3).
  const sensorLine = findLine(ship.form, 'sensor')
  if (sensorLine) {
    const available = lineValue(ship, sensorLine.id)
    const total = card.sensors.targeting + card.sensors.jamming + card.sensors.tacticalScan
    if (total > available) {
      errors.push({ message: `Only ${available} sensor points available.`, fallbackToStraight: false })
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Movement (C2, C3)
// ---------------------------------------------------------------------------

export interface MovementResult extends ManeuverResult {
  /** Speed actually used after any involuntary deceleration (C4.2). */
  speed: number
}

/**
 * What a plotted card will do when the Navigation Segment reveals it — the
 * pure half of `executeMovement`, shared with the map's plot preview so the
 * ghost and the real move can never disagree.
 */
export function plannedMovement(
  ship: ShipState,
  card: CommandCard,
  towedSpeed?: number,
): MovementResult & { maneuver: Maneuver } {
  const errors = validatePlot(ship, card)
  const mustGoStraight = errors.some((e) => e.fallbackToStraight)

  // Apply the plotted speed change, clamped to what the drive can do (C4.2.1).
  const maxForward = currentMaxSpeed(ship)
  let speed = card.speed
  if (speed > maxForward) speed = maxForward
  if (speed < 0 && Math.abs(speed) > maxReverseSpeed(ship)) speed = -maxReverseSpeed(ship)
  if (ship.emergencyStopPhases > 0 || card.emergencyStop) speed = 0

  const travel =
    towedSpeed === undefined
      ? speed
      : Math.sign(speed) * Math.min(Math.abs(speed), Math.abs(towedSpeed))

  // An emergency stop is a straight line to a standstill (C3.8.1).
  const maneuver = mustGoStraight || card.emergencyStop ? 'straight' : card.maneuver
  /**
   * A turn may be taken at any rate up to the one the table allows (C3.9.1) —
   * a captain who wants 20 degrees where the ship could manage 40 says so, and
   * the ship obliges. Never *more* than the table, whatever the card says.
   */
  const allowed = turnTemplateAt(ship, travel)
  const result = applyManeuver({
    start: ship.placement,
    speed: travel,
    maneuver,
    direction: card.direction,
    turnTemplate:
      card.turnRate !== undefined ? Math.min(Math.max(0, card.turnRate), allowed) : allowed,
    halfSlide: card.halfSlide,
  })

  // Stress from the maneuver itself (C3.1.2), or from stopping dead (C3.8.3).
  const stress = card.emergencyStop
    ? Math.abs(ship.speed)
    : maneuverStress(maneuver, travel)
  return { ...result, speed: travel, stress, maneuver }
}

/**
 * Execute a plotted maneuver during the Navigation Segment (A3.3.3).
 * Speed changes take effect now, not when plotted (C1.2.4).
 *
 * `towedSpeed` is the adjusted speed of a ship in a tractor link (J3.3.4). The
 * ship keeps plotting — and keeps — its true speed, and the acceleration it
 * paid for still counts against the round; only the distance it actually covers
 * and the turn template it may use come from the adjusted figure (J3.4.1,
 * J3.4.5).
 */
export function executeMovement(
  ship: ShipState,
  card: CommandCard,
  towedSpeed?: number,
  /** A scenario's opening-round speed limit, if one binds this ship. */
  speedCap?: number,
): MovementResult {
  const planned = plannedMovement(ship, card, towedSpeed)
  const maxForward = Math.min(currentMaxSpeed(ship), speedCap ?? Infinity)
  let speed = card.speed
  if (speed > maxForward) speed = maxForward
  if (speed < 0 && Math.abs(speed) > maxReverseSpeed(ship)) speed = -maxReverseSpeed(ship)
  if (ship.emergencyStopPhases > 0) speed = 0
  /**
   * Emergency stop (C3.8): the drive shuts down and the ship is stationary
   * this phase and the next, even when the next one falls in the following
   * round. Two phases are booked here and one is spent below, so the ship is
   * still held when the next card is revealed.
   */
  if (card.emergencyStop && ship.emergencyStopPhases === 0) {
    speed = 0
    ship.emergencyStopPhases = 2
  }
  ship.speed = speed
  // "An emergency stop does not count against the ship's acceleration limits"
  // (C3.8.1) — the stress it applies is the price instead.
  if (!card.emergencyStop) ship.accelUsedThisRound += Math.abs(card.accel)

  /**
   * The evasive plot takes effect as the card is revealed (C3.6.4). Only an
   * *increase* costs points: staying evasive at the same depth is free, but
   * stopping and restarting is not, because the old points are spent and gone
   * (C3.6.4). Evasive spending counts against the round's acceleration limit
   * like any other, though the per-phase limit does not apply to it (C3.6.2).
   */
  if (card.evasive !== undefined) {
    const want = Math.max(0, Math.floor(card.evasive))
    if (want > ship.evasive) {
      const room = Math.max(0, accelerationBudget(ship) - ship.accelUsedThisRound)
      const added = Math.min(want - ship.evasive, room)
      ship.accelUsedThisRound += added
      ship.evasive += added
    } else {
      ship.evasive = want
    }
  }

  ship.placement = planned.end
  ship.stressMarkers += planned.stress
  if (planned.maneuver === 'em-90' || planned.maneuver === 'em-180') ship.emergencyTurnUsed = true
  if (ship.emergencyStopPhases > 0) ship.emergencyStopPhases -= 1

  return planned
}

// ---------------------------------------------------------------------------
// Acceleration stress (C1.2.6)
// ---------------------------------------------------------------------------

/**
 * Stress from exceeding the safe acceleration limit: one point per red circle
 * filled on the /ROUND track (C1.2.6).
 */
export function accelerationStress(ship: ShipState): number {
  const { safeAccelPerRound } = ship.form.sublight
  return Math.max(0, ship.accelUsedThisRound - safeAccelPerRound)
}

// ---------------------------------------------------------------------------
// Stress Check Segment (A3.4.1, C3.1.3)
// ---------------------------------------------------------------------------

export interface StressCheckResult {
  markersBefore: number
  canceledBySif: number
  checksResolved: number
  /** One entry per individual stress check. */
  checks: Array<{ cards: DamageCard[]; stressCard: DamageCard | null }>
}

/**
 * Resolve every accumulated stress point.
 *
 * Each check draws cards equal to the ship's Stress Rating; at most one card
 * with the Stress Damage icon causes damage, applying its system hit plus one
 * point of structure damage (C3.1.3, C3.1.4). Decks are not reshuffled between
 * checks (C3.1.5).
 */
export function resolveStressCheck(ship: ShipState, ctx: DamageContext): StressCheckResult {
  // Acceleration stress is added at the Stress Check, from the /ROUND track.
  ship.stressMarkers += accelerationStress(ship)

  const markersBefore = ship.stressMarkers
  const sifLine = findLine(ship.form, 'sif')
  const sif = sifLine ? lineValue(ship, sifLine.id) : 0
  const canceled = Math.min(markersBefore, sif)
  let remaining = markersBefore - canceled

  const result: StressCheckResult = {
    markersBefore,
    canceledBySif: canceled,
    checksResolved: remaining,
    checks: [],
  }

  if (canceled > 0) ctx.log(`${ship.name}: SIF cancels ${canceled} stress.`)

  while (remaining > 0 && !ship.destroyed) {
    remaining -= 1
    const cards: DamageCard[] = []
    for (let i = 0; i < ship.form.stressRating; i++) cards.push(drawCard(ctx.deck, ctx.rng))

    // At most one Stress Damage card applies; the captain chooses (C3.1.4).
    const stressCards = cards.filter((c) => c.stressIcon)
    const chosen = stressCards.length > 0 ? pickLeastHarmfulStressCard(stressCards) : null
    result.checks.push({ cards, stressCard: chosen })

    if (!chosen) {
      ctx.log(`${ship.name}: stress check passed (${cards.length} cards).`)
      continue
    }

    ctx.log(`${ship.name}: stress damage!`)
    // The indicated system, plus one point of structure damage (C3.1.4).
    resolveCard(ship, chosen, ctx)
    resolveCard(ship, { id: 'stress-structure', category: 'structure', primary: 'structure', stressIcon: false }, ctx)
  }

  ship.stressMarkers = 0
  return result
}

/** A structure primary costs two structure points, so avoid it if possible (C3.1.4). */
function pickLeastHarmfulStressCard(cards: DamageCard[]): DamageCard {
  const nonStructure = cards.find((c) => c.primary !== 'structure')
  return nonStructure ?? cards[0]
}

// ---------------------------------------------------------------------------
// Disengagement (J9)
// ---------------------------------------------------------------------------

export interface MapBounds {
  width: number
  height: number
  fixed: boolean
}

/** Reasons a ship may leave the battle during the Disengagement Segment (J9). */
export function disengagementOptions(
  ship: ShipState,
  enemies: ShipState[],
  bounds: MapBounds,
  /** Set false inside a nebula or gas cloud, which shuts FTL down (K4.2.7). */
  ftlAvailable = true,
): string[] {
  const options: string[] = []

  // FTL disengagement needs a fully powered, undamaged drive (J9.1.3, J9.1.4).
  const ftlLine = findLine(ship.form, 'ftl-drive')
  if (ftlAvailable && ftlLine && ship.ftlDriveDamage < ship.form.ftlDriveBoxes) {
    const filled = ship.allocation[ftlLine.id] ?? 0
    if (filled >= ftlLine.steps.length && ftlLine.steps.length > 0) options.push('FTL disengagement (J9.1)')
  }

  // Leaving a fixed map disengages the ship (J9.2.2).
  const { x, y } = ship.placement.position
  if (bounds.fixed && (x < 0 || y < 0 || x > bounds.width || y > bounds.height)) {
    options.push('Left the map (J9.2.2)')
  }

  // Range 36 or more from the nearest enemy (J9.2.5).
  const live = enemies.filter((e) => !e.destroyed && !e.disengaged)
  if (live.length > 0) {
    const nearest = Math.min(
      ...live.map((e) => Math.hypot(e.placement.position.x - x, e.placement.position.y - y)),
    )
    if (nearest >= 36) options.push('Sublight disengagement by distance (J9.2.5)')
  } else {
    options.push('No enemies remain')
  }

  return options
}
