import { rollDie, type Rng } from './dice'
import type { ShipState } from './shipState'
import type { DieFace, Maneuver } from './types'

/**
 * Boarding combat (J6.2).
 *
 * Marines reach an enemy hull by transporter (J5) or by shuttle (J8.2.6), and
 * once aboard they fight in the Boarding Combat Segment of the Final Phase.
 * Everything is rolled on blue dice: a Light hit kills one enemy squad, and
 * nothing else on the die matters.
 *
 * J6.3, arming the general crew to repel boarders, is an optional rule and is
 * not implemented here.
 */

/** A Light hit kills one enemy squad; misses and Mediums do nothing (J6.2.2). */
export const KILL_FACE: DieFace = 'L'

/** Squads that may gang up on a single enemy squad in tight quarters (J6.2.3). */
export const MAX_ATTACKERS_PER_SQUAD = 2

/** Rounds a captured ship must wait before it may go to FTL (J6.2.5). */
export const CAPTURED_FTL_LOCKOUT = 10

/** Maneuvers a captured ship may still plot (J6.2.5 item 1). */
export const CAPTURED_MANEUVERS: Maneuver[] = ['straight', 'standard']

/**
 * Dice one side actually rolls (J6.2.3).
 *
 * A corridor only holds so many people. Once a side has a two-to-one advantage
 * it must name which enemy squads it is attacking, and no more than two squads
 * may set about any one of them — so its extra numbers buy nothing and a small
 * force can hold out for a long time.
 */
export function combatDice(own: number, enemy: number): number {
  return Math.max(0, Math.min(own, enemy * MAX_ATTACKERS_PER_SQUAD))
}

/** True once one side outnumbers the other two to one (J6.2.3). */
export function tightQuarters(own: number, enemy: number): boolean {
  return enemy > 0 && own >= enemy * MAX_ATTACKERS_PER_SQUAD
}

export interface BoardingRoll {
  /** Squads present. */
  squads: number
  /** Dice actually rolled, after the tight-quarters cap. */
  dice: number
  faces: DieFace[]
  /** Enemy squads killed. */
  kills: number
}

export interface SabotageRoll {
  /** Squads that went for the ship rather than its marines (J6.2.4). */
  squads: number
  faces: DieFace[]
  /** Damage points scored, one per Light hit. */
  damage: number
}

export interface BoardingOutcome {
  shipId: string
  /** The side whose marines are aboard. */
  attackerSide: string
  attackers: BoardingRoll
  defenders: BoardingRoll
  sabotage: SabotageRoll
  /** Every defending squad is dead and attackers remain (J6.2.2 item 2). */
  captured: boolean
  /** Every attacking squad is dead (J6.2.2 item 3). */
  repelled: boolean
  /** Neither side is finished, so it runs on next round (J6.2.2 item 4). */
  continues: boolean
}

function roll(rng: Rng, dice: number): { faces: DieFace[]; kills: number } {
  const faces: DieFace[] = []
  for (let i = 0; i < dice; i += 1) faces.push(rollDie('blue', rng).face)
  return { faces, kills: faces.filter((f) => f === KILL_FACE).length }
}

/**
 * Resolve one round of boarding combat aboard `ship` (J6.2.2).
 *
 * Both sides roll at once and casualties are taken together, so a boarding
 * action can wipe out both parties in the same round.
 *
 * `sabotageSquads` are attacking squads that go after the ship itself instead
 * of its defenders this round (J6.2.4); they roll separately and do not fight.
 */
export function resolveBoarding(
  ship: ShipState,
  attackerSide: string,
  rng: Rng,
  sabotageSquads = 0,
): BoardingOutcome {
  const boarders = ship.boarders[attackerSide] ?? 0
  const saboteurs = Math.max(0, Math.min(sabotageSquads, boarders))
  const fighting = boarders - saboteurs
  const defending = ship.marineSquads

  const attackerDice = combatDice(fighting, defending)
  const defenderDice = combatDice(defending, fighting)

  const attackerRoll = roll(rng, attackerDice)
  const defenderRoll = roll(rng, defenderDice)
  const sabotageRoll = roll(rng, saboteurs)

  // Both sides fire at once, so casualties are applied from the pre-roll
  // strengths rather than in sequence.
  ship.marineSquads = Math.max(0, defending - attackerRoll.kills)
  ship.boarders[attackerSide] = Math.max(0, boarders - defenderRoll.kills)

  const attackersLeft = ship.boarders[attackerSide]
  const captured = ship.marineSquads === 0 && attackersLeft > 0
  const repelled = attackersLeft === 0
  if (repelled) delete ship.boarders[attackerSide]

  return {
    shipId: ship.id,
    attackerSide,
    attackers: { squads: fighting, dice: attackerDice, ...attackerRoll },
    defenders: { squads: defending, dice: defenderDice, ...defenderRoll },
    sabotage: { squads: saboteurs, faces: sabotageRoll.faces, damage: sabotageRoll.kills },
    captured,
    repelled,
    continues: !captured && !repelled,
  }
}

/** Sides with marines aboard this ship, in the order they arrived. */
export function boardingSides(ship: ShipState): string[] {
  return Object.keys(ship.boarders).filter((side) => ship.boarders[side] > 0)
}

export function boardersAboard(ship: ShipState): number {
  return Object.values(ship.boarders).reduce((a, b) => a + b, 0)
}

// ---------------------------------------------------------------------------
// J6.2.5 — a captured ship
// ---------------------------------------------------------------------------

export function isCaptured(ship: ShipState): boolean {
  return ship.capturedBy !== null
}

/** Who gives this ship its orders — its captors, if it has any (J6.2.5). */
export function controllingSide(ship: ShipState): string {
  return ship.capturedBy ?? ship.side
}

/**
 * A captured ship "ceases to perform any actions or functions" (J6.2.5), so it
 * cannot shoot, scan, tractor, beam or launch. Returns the refusal, or `null`.
 */
export function capturedRefusal(ship: ShipState, action = 'do that'): string | null {
  return ship.capturedBy
    ? `${ship.name} has been captured by ${ship.capturedBy} and may not ${action} (J6.2.5).`
    : null
}

/** Only forward movement and Standard turns survive capture (J6.2.5 item 1). */
export function maneuverAllowedWhenCaptured(maneuver: Maneuver): boolean {
  return CAPTURED_MANEUVERS.includes(maneuver)
}

/**
 * FTL disengagement opens up ten rounds after the capture; sublight is
 * available at once (J6.2.5 item 2).
 */
export function capturedFtlAvailable(ship: ShipState, round: number): boolean {
  if (ship.capturedBy === null) return true
  return ship.capturedRound !== null && round >= ship.capturedRound + CAPTURED_FTL_LOCKOUT
}
