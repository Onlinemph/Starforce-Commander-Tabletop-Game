import type { DieColor, DieFace } from './types'

/**
 * Attack dice (A2.7, E7.2).
 *
 * Faces are transcribed from the DIE ROLL CHART on the Captain's Reference Card,
 * which prints the equivalent result for each face of a standard d6:
 *
 *   ROLL   RED     YELLOW  GREEN   BLUE
 *     1    SPCL    L (2)   L (2)   L (2)
 *     2    SPCL    M (3)   L (2)   L (2)
 *     3    SPCL    M (3)   L (2)   L (2)
 *     4    M (3)   H (4+1) M (3)   M (3)
 *     5    H (4+1) H (4+1) H (4+1) MISS
 *     6    MISS    MISS    MISS    MISS
 *
 * Listed in roll order so the table can be checked against the card at a glance.
 * This matches every constraint the rulebook states in prose: potency runs
 * red > yellow > green > blue (A2.7), only red carries `S` (E7.2.5), and the
 * maximum face of each colour is red → S, yellow and green → H, blue → M
 * (J3.2.5, J3.3.1).
 */
export const DIE_FACES: Record<DieColor, readonly DieFace[]> = {
  red: ['S', 'S', 'S', 'M', 'H', '-'],
  yellow: ['L', 'M', 'M', 'H', 'H', '-'],
  green: ['L', 'L', 'L', 'M', 'H', '-'],
  blue: ['L', 'L', 'L', 'M', '-', '-'],
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
