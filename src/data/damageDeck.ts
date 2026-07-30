import type { DamageCard, DamageCategory, DamageHit } from '../engine/types'

/**
 * The 56-card damage deck (A2.6, E8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATA GAP — VERIFY AGAINST THE PRINTED DECK
 * ─────────────────────────────────────────────────────────────────────────────
 * The rulebook documents what every card *does* (E8.2 – E8.7) and states the
 * deck is 56 cards colour-coded by system, but the per-card composition and the
 * ALT HIT pairings live on the physical cards, not in the rules text. The deck
 * below totals 56 and follows the colour coding and alt-hit logic described in
 * the rules, but the exact card counts, alt-hit pairings and Stress Damage icon
 * placement should be corrected against the real deck.
 *
 * Everything downstream reads this table, so fixing it here fixes the game.
 */

interface CardSpec {
  category: DamageCategory
  primary: DamageHit
  alt?: DamageHit
  count: number
  /** How many copies of this spec carry the Stress Damage icon (C3.1.4). */
  stressIcons?: number
}

const SPECS: CardSpec[] = [
  // ── Defense (blue) — E8.2 ────────────────────────────────────────────────
  { category: 'defense', primary: 'shield-generator', alt: 'any-hit', count: 4, stressIcons: 1 },
  { category: 'defense', primary: 'shield-power-loss', alt: 'shield-generator', count: 2 },

  // ── Weapons (red) — E8.3 ─────────────────────────────────────────────────
  { category: 'weapon', primary: 'facing-weapon', alt: 'any-weapon', count: 3 },
  { category: 'weapon', primary: 'any-weapon', alt: 'structure', count: 3, stressIcons: 1 },
  { category: 'weapon', primary: 'heavy-weapon', alt: 'any-weapon', count: 2 },
  { category: 'weapon', primary: 'weapon-power-loss', alt: 'any-weapon', count: 2 },

  // ── General systems (yellow) — E8.4 ──────────────────────────────────────
  { category: 'general', primary: 'any-hit', count: 2 },
  { category: 'general', primary: 'casualties', alt: 'structure', count: 1 },
  { category: 'general', primary: 'sciences', alt: 'quarters', count: 2 },
  { category: 'general', primary: 'sensors', alt: 'quarters', count: 3, stressIcons: 1 },
  { category: 'general', primary: 'sensor-power-loss', alt: 'sensors', count: 1 },
  { category: 'general', primary: 'shuttle-bay', alt: 'quarters', count: 1 },
  { category: 'general', primary: 'special-system', alt: 'quarters', count: 1 },
  { category: 'general', primary: 'tractor-beam', alt: 'quarters', count: 2 },
  { category: 'general', primary: 'transporter', alt: 'quarters', count: 1 },
  { category: 'general', primary: 'quarters', alt: 'structure', count: 1 },

  // ── Engineering (green) — E8.5 ───────────────────────────────────────────
  {
    category: 'engineering',
    primary: 'left-main-reactor',
    alt: 'any-main-reactor',
    count: 3,
    stressIcons: 1,
  },
  {
    category: 'engineering',
    primary: 'right-main-reactor',
    alt: 'any-main-reactor',
    count: 3,
    stressIcons: 1,
  },
  { category: 'engineering', primary: 'sublight-reactor', alt: 'battery', count: 2, stressIcons: 1 },
  { category: 'engineering', primary: 'sublight-drive', alt: 'sublight-reactor', count: 2 },
  { category: 'engineering', primary: 'aux-reactor', alt: 'sif', count: 1 },
  { category: 'engineering', primary: 'battery', alt: 'sif', count: 1 },
  { category: 'engineering', primary: 'ftl-drive', alt: 'aux-reactor', count: 1 },

  // ── Structural (orange) — E8.7 ───────────────────────────────────────────
  { category: 'structure', primary: 'structure', alt: 'derelict', count: 6, stressIcons: 3 },

  // ── Critical (white) — E8.6. No alt hits (E8.6 preamble). ────────────────
  { category: 'critical', primary: 'bridge-hit', count: 1 },
  { category: 'critical', primary: 'major-fire', count: 1 },
  { category: 'critical', primary: 'minor-fire', count: 1, stressIcons: 1 },
  { category: 'critical', primary: 'main-engineering-hit', count: 1 },
  { category: 'critical', primary: 'battery-power-loss', count: 1 },
  { category: 'critical', primary: 'no-effect', count: 1 },
]

function buildDeck(): DamageCard[] {
  const cards: DamageCard[] = []
  for (const spec of SPECS) {
    for (let i = 0; i < spec.count; i++) {
      cards.push({
        id: `${spec.primary}-${i + 1}`,
        category: spec.category,
        primary: spec.primary,
        alt: spec.alt,
        stressIcon: i < (spec.stressIcons ?? 0),
      })
    }
  }
  return cards
}

/** A fresh, ordered deck. Callers shuffle (E7.1.3). */
export const DAMAGE_DECK: readonly DamageCard[] = buildDeck()

export const DAMAGE_DECK_SIZE = DAMAGE_DECK.length

/** Human-readable card titles for the log and UI. */
export const HIT_LABELS: Record<DamageHit, string> = {
  'shield-generator': 'Shield Generator',
  'shield-power-loss': 'Shield Power Loss',
  'any-weapon': 'Any Weapon',
  'facing-weapon': 'Facing Weapon',
  'heavy-weapon': 'Heavy Weapon',
  'weapon-power-loss': 'Weapon Power Loss',
  'any-hit': 'Any Hit',
  casualties: 'Casualties',
  sciences: 'Sciences',
  sensors: 'Sensors',
  'sensor-power-loss': 'Sensor Power Loss',
  'shuttle-bay': 'Shuttle or Hangar Bay',
  'special-system': 'Special System',
  'tractor-beam': 'Tractor Beam',
  transporter: 'Transporter',
  quarters: 'Quarters',
  'aux-reactor': 'Auxiliary Reactor',
  battery: 'Battery',
  'sublight-drive': 'Sublight Drive',
  'sublight-reactor': 'Sublight Reactor',
  'left-main-reactor': 'Left (or Center) Main Reactor',
  'right-main-reactor': 'Right (or Center) Main Reactor',
  'any-main-reactor': 'Any Main Reactor',
  'ftl-drive': 'FTL Drive',
  sif: 'SIF',
  'bridge-hit': 'Bridge Hit',
  'major-fire': 'Major Fire',
  'minor-fire': 'Minor Fire',
  'main-engineering-hit': 'Main Engineering Hit',
  'battery-power-loss': 'Battery Power Loss',
  'no-effect': 'No Effect',
  structure: 'Structure Hit',
  derelict: 'Derelict',
}

/**
 * Which precision-targeting section each primary hit belongs to
 * (E9.2.4 – E9.2.7). Critical (white) hits cannot be precision targeted.
 */
export type PrecisionSection = 'shields' | 'weapons' | 'general' | 'engineering'

export const PRECISION_SECTION: Partial<Record<DamageHit, PrecisionSection>> = {
  'shield-generator': 'shields',
  'shield-power-loss': 'shields',
  'any-weapon': 'weapons',
  'facing-weapon': 'weapons',
  'heavy-weapon': 'weapons',
  'weapon-power-loss': 'weapons',
  transporter: 'general',
  'tractor-beam': 'general',
  sciences: 'general',
  sensors: 'general',
  'shuttle-bay': 'general',
  'any-hit': 'general',
  'sensor-power-loss': 'general',
  quarters: 'general',
  battery: 'engineering',
  'left-main-reactor': 'engineering',
  'right-main-reactor': 'engineering',
  'aux-reactor': 'engineering',
  'ftl-drive': 'engineering',
  'sublight-reactor': 'engineering',
  'sublight-drive': 'engineering',
}
