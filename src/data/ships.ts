import type { ShipForm } from '../engine/types'
import shipData from './ships.json'

/**
 * The canon ship roster.
 *
 * `ships.json` is machine-extracted from the StarForce Commander **Master Ship
 * Book** (all ships through Expansion 3) — 72 forms, 37 Union and 35 Vallari.
 * The forms are vector art rather than tables, so the importer reads them
 * structurally:
 *
 *   • Hit, shield, armor and structure boxes are Wingdings glyphs whose colour
 *     gives their kind (blue shields, green reinforcement, black systems, red
 *     unrepairable structure, grey armor — B1.1.1).
 *   • Power circles are ⚫ for free power and ○ for purchasable (B2.2.3), with
 *     the value printed to the right of each.
 *   • Range brackets are Calibri spans whose colour and italics give the band
 *     (green optimum, black, red extreme — E1.2).
 *   • Attack dice are Wingdings2 glyphs whose colour gives the die (E3.2.1).
 *   • Firing-arc icons are small images that the layout rotates and mirrors, so
 *     every *placement* is rasterised and its eight wedges are read for red
 *     (usable) versus white (E2.2.2).
 *
 * Every import is cross-checked against the form's own printed totals — TOTAL
 * POWER, battery count, and the four shield values — and against the Master
 * Ship List's structure count, which is also where point values, availability,
 * introduction year and the canon victory-point table come from.
 *
 * To regenerate after a Ship Book update, re-run the importer and replace
 * `ships.json`; nothing in the engine needs to change.
 */
export const SHIP_FORMS: ShipForm[] = shipData as unknown as ShipForm[]

/**
 * Designs built in the ship builder. They are kept apart from the canon roster
 * so nothing can quietly overwrite a printed ship, but they are visible
 * everywhere a form is looked up by id, which is what lets a custom hull be
 * dropped straight into a scenario.
 */
const CUSTOM_FORMS: ShipForm[] = []

/** Replace the custom roster wholesale. Called by the builder's store. */
export function registerCustomForms(forms: ShipForm[]): void {
  CUSTOM_FORMS.splice(0, CUSTOM_FORMS.length, ...forms)
}

export function customShipForms(): ShipForm[] {
  return CUSTOM_FORMS
}

/** Canon roster first, custom designs after. */
export function allShipForms(): ShipForm[] {
  return [...SHIP_FORMS, ...CUSTOM_FORMS]
}

export function shipFormById(id: string): ShipForm | undefined {
  return SHIP_FORMS.find((f) => f.id === id) ?? CUSTOM_FORMS.find((f) => f.id === id)
}

export function shipFormsByFaction(faction: string): ShipForm[] {
  return SHIP_FORMS.filter((f) => f.faction === faction)
}

export const FACTIONS = [...new Set(SHIP_FORMS.map((f) => f.faction))]

/** Find a form by a loose name fragment, e.g. "Yorktown I". */
export function findShipForm(fragment: string): ShipForm | undefined {
  const needle = fragment.toLowerCase()
  return SHIP_FORMS.find((f) => f.name.toLowerCase().includes(needle))
}

// Convenience handles for the built-in scenarios.
export const YORKTOWN = findShipForm('YORKTOWN I-class')!
export const VALLARI_CRUISER = findShipForm('V-7C RAIDER')!
