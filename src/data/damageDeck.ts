import type { DamageCard, DamageHit } from '../engine/types'
import deckData from './damageDeck.json'

/**
 * The 56-card damage deck (A2.6, E8).
 *
 * Transcribed from the four "CARD FRONT n of 4" sheets in the print-and-play
 * components. Each card's category comes from its header band colour, its
 * primary and alternate hits from the two band titles, and its Stress Damage
 * icon (C3.1.4) from the one piece of artwork a card can carry.
 *
 * To regenerate after a components update, re-run `tools/extract_damage_deck.py`
 * and replace `damageDeck.json`.
 */
export const DAMAGE_DECK: readonly DamageCard[] = deckData as unknown as DamageCard[]

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
  'left-main-reactor': 'Left or Center Main Reactor',
  'right-main-reactor': 'Right or Center Main Reactor',
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
