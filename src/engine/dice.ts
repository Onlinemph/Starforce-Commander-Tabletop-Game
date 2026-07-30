import type { DieColor, DieFace } from './types'

/**
 * Attack dice (A2.7, E7.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATA GAP — VERIFY AGAINST THE PHYSICAL DICE
 * ─────────────────────────────────────────────────────────────────────────────
 * The rulebook shows the six faces of each die as an image (A2.7), so the exact
 * face distribution could not be read from the PDF text. The constraints the
 * rules text *does* pin down are honoured here:
 *
 *   • Potency order is Red > Yellow > Green > Blue (A2.7).
 *   • Only red dice carry the `S` (Special) face (E7.2.5).
 *   • J3.2.5 states the maximum result of each die when auto-hitting a tractored
 *     small target: red → S, yellow and green → H, blue → M. So blue dice have
 *     no `H` face, and green/yellow top out at `H`.
 *   • J3.3.1 gives blue damage values Miss = 0, Light = 2, Medium = 3, and lists
 *     no heavy result — consistent with the above.
 *
 * The distributions below are a reconstruction consistent with those
 * constraints. Replace `DIE_FACES` with the printed faces once the physical
 * dice (or the Captain's Reference Card d6 chart) are to hand — nothing else in
 * the engine needs to change.
 */
export const DIE_FACES: Record<DieColor, readonly DieFace[]> = {
  blue: ['-', '-', '-', 'L', 'L', 'M'],
  green: ['-', '-', 'L', 'L', 'M', 'H'],
  yellow: ['-', 'L', 'L', 'M', 'M', 'H'],
  red: ['-', 'L', 'M', 'M', 'H', 'S'],
}

/** Damage points per face (E7.2.1 – E7.2.4). `S` is weapon-defined. */
export const FACE_DAMAGE: Record<Exclude<DieFace, 'S'>, number> = {
  '-': 0,
  L: 2,
  M: 3,
  H: 4,
}

/** Each `H` generates one point of leak damage (E7.2.6). */
export function leakFromFace(face: DieFace): number {
  return face === 'H' ? 1 : 0
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * Seeded RNG so games replay identically from a log — important for a hot-seat
 * game where both players want to audit a volley after the fact.
 * mulberry32.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      ;[items[i], items[j]] = [items[j], items[i]]
    }
    return items
  }
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

export interface DieRoll {
  color: DieColor
  face: DieFace
  /** How many times this die has been rerolled (E1.2, C3.6.3). */
  rerolls: number
}

export function rollDie(color: DieColor, rng: Rng): DieRoll {
  const faces = DIE_FACES[color]
  return { color, face: faces[rng.int(faces.length)], rerolls: 0 }
}

export function rollDice(colors: readonly DieColor[], rng: Rng): DieRoll[] {
  return colors.map((c) => rollDie(c, rng))
}

/**
 * Reroll a die in place. "When a die is rerolled, the player must accept the
 * new result, even if it is worse than the original die roll." (E6.2 Step 8)
 */
export function reroll(die: DieRoll, rng: Rng): DieRoll {
  const faces = DIE_FACES[die.color]
  return { color: die.color, face: faces[rng.int(faces.length)], rerolls: die.rerolls + 1 }
}

/**
 * Damage a face contributes to a volley, including the bonus applied to any die
 * that scores a hit (E4.3.2) and the weapon-specific value of an `S` (E7.2.5).
 */
export function faceValue(face: DieFace, specialDamage: number, bonus: number): number {
  if (face === '-') return 0
  if (face === 'S') return specialDamage + bonus
  return FACE_DAMAGE[face] + bonus
}

/** Mean damage of a die, used to decide whether a reroll is worth taking. */
export function expectedValue(color: DieColor, specialDamage: number, bonus: number): number {
  const faces = DIE_FACES[color]
  return faces.reduce((sum, face) => sum + faceValue(face, specialDamage, bonus), 0) / faces.length
}

/** Damage control and explosion checks succeed on an `S` (B3.2, E11.3.1). */
export function rollForSpecial(count: number, rng: Rng): { rolls: DieRoll[]; success: boolean } {
  const rolls = rollDice(new Array(count).fill('red') as DieColor[], rng)
  return { rolls, success: rolls.some((r) => r.face === 'S') }
}
