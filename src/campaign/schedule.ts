/**
 * The 16-phase movement schedule — Doyle's fine-tuning table, verbatim.
 *
 * A round is sixteen phases; A moves the odd ones, B the even. A unit's SPEED
 * (hexes per round) decides WHICH of its side's eight phases it moves in:
 *
 *   speed 1 →                      15        speed 5 → 3, 7,    11, 13, 15
 *   speed 2 →       7,             15        speed 6 → 3, 5, 7, 11, 13, 15
 *   speed 3 → 3,    7,             15        speed 7 → 3, 5, 7, 9, 11, 13, 15
 *   speed 4 → 3,    7,     11,     15        speed 8 → 1, 3, 5, 7, 9, 11, 13, 15
 *
 * (Player A's phases; B adds one to each.) The table has a generating order:
 * as speed climbs, own-phases join in the fixed sequence 8, 4, 2, 6, 7, 3, 5,
 * 1 — halves first, then quarters, then the gaps. Encoding THAT sequence
 * instead of eight rows reproduces the table exactly and answers the
 * designer's "very high speed" note for free: past speed eight the sequence
 * wraps, so a speed-9 ship moves twice in its last phase, a speed-12 ship
 * twice in four of them, and so on.
 */

import type { Side } from './types'

/** Phases in a campaign round. A resolves the odd ones, B the even (5.1). */
export const ROUND_PHASES = 16

/**
 * The own-phase index (1..8) each additional point of speed adds a move to.
 * First entry serves speed 1, first two serve speed 2, … wrapping past 8.
 */
export const SPEED_JOIN_ORDER: readonly number[] = [8, 4, 2, 6, 7, 3, 5, 1]

/** Which of a side's own phases (1..8) a table phase is, or null if not theirs. */
export function ownPhaseIndex(side: Side, phase: number): number | null {
  if (side === 'A') return phase % 2 === 1 ? (phase + 1) / 2 : null
  return phase % 2 === 0 ? phase / 2 : null
}

/** Hexes a unit of this speed moves in this table phase (0 when off-schedule). */
export function hexesThisPhase(speed: number, side: Side, phase: number): number {
  const k = ownPhaseIndex(side, phase)
  if (k === null || speed <= 0) return 0
  let hexes = 0
  for (let i = 0; i < speed; i++) {
    if (SPEED_JOIN_ORDER[i % SPEED_JOIN_ORDER.length] === k) hexes += 1
  }
  return hexes
}

/** The table phases a unit of this speed moves in, for display. */
export function movementPhases(speed: number, side: Side): number[] {
  const out: number[] = []
  for (let phase = 1; phase <= ROUND_PHASES; phase++) {
    if (hexesThisPhase(speed, side, phase) > 0) out.push(phase)
  }
  return out
}
