import type { DieColor } from '../engine/types'

/**
 * The 26 asteroid field counters from the Print and Play Components (v2.6),
 * transcribed from the counter sheet (page 37).
 *
 * Each printed counter carries its values directly (K2.1.1): the maximum safe
 * speed (K2.1.5), the damage die rolled per point of excess speed (K2.1.6),
 * the white cover diamonds that grant the defender rerolls (K2.1.8), and a
 * SCAN value. The coloured cross gives the density (K2.1.2): Light (blue),
 * Medium (green), High (yellow), Extreme (red).
 *
 * On the printed sheet the statline is uniform within a density — verified on
 * every legible counter — so the density carries the numbers and the counter
 * list carries which of the 26 pieces is which.
 */

export type AsteroidDensity = 'light' | 'medium' | 'high' | 'extreme'

export interface DensityStats {
  /** Highest speed that transits without damage (K2.1.5). */
  spd: number
  /** One die of this colour per speed point over safe (K2.1.6). */
  dmgDie: DieColor
  /** Defender rerolls granted as cover (K2.1.8). */
  cover: number
  /** Printed SCAN value (hidden-unit searches, K6 — carried for scenarios). */
  scan: number
  label: string
}

export const DENSITY_STATS: Record<AsteroidDensity, DensityStats> = {
  light: { spd: 3, dmgDie: 'blue', cover: 1, scan: 3, label: 'Light' },
  medium: { spd: 3, dmgDie: 'green', cover: 2, scan: 4, label: 'Medium' },
  high: { spd: 3, dmgDie: 'yellow', cover: 3, scan: 5, label: 'High' },
  extreme: { spd: 2, dmgDie: 'red', cover: 4, scan: 6, label: 'Extreme' },
}

export interface AsteroidCounter {
  /** The printed identification number (K2.1.1). */
  id: number
  density: AsteroidDensity
}

/** #1–4 Extreme, #5–10 High, #11–20 Medium, #21–26 Light, as printed. */
export const ASTEROID_COUNTERS: AsteroidCounter[] = [
  ...[1, 2, 3, 4].map((id) => ({ id, density: 'extreme' as const })),
  ...[5, 6, 7, 8, 9, 10].map((id) => ({ id, density: 'high' as const })),
  ...[11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((id) => ({ id, density: 'medium' as const })),
  ...[21, 22, 23, 24, 25, 26].map((id) => ({ id, density: 'light' as const })),
]
