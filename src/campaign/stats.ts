/**
 * Operational stats, derived — never hand-entered (design doc 3.1).
 *
 * Every number the campaign layer knows about a hull is an exported function
 * of its ship form plus the designers' own costing model in
 * `src/engine/shipBuilder.ts` — ACTUAL POWER above all, the spreadsheet value
 * Doyle names as a detection variable (reference hull 118.39). A new ship —
 * canon errata, fan design, campaign freighter — gets its operational stats
 * the moment it has a form, and a formula change shows up in the anchor tests
 * rather than in a hundred stale rows.
 *
 * Two of the doc's sanity anchors met the data and lost, recorded here for
 * Doyle's Part 12 list:
 *  - "V-7: cloak true" — no V-7 RAIDER form carries a CLOAK system; in this
 *    roster cloak is an Aurelian line (all 31 Aurelian hulls, no one else).
 *    Cloak derives from the form, so the anchor tests an Aurelian hull.
 *  - "Knox II survey cruiser: sciences ≥ 4" — KNOX II has SCNC 2; its survey
 *    character lives in its Scout Sensor block (H3). So sciences counts SCNC
 *    boxes plus 2 for a scout block, which also matches 4.4's rule that a
 *    scout block substitutes for closing to identification range.
 */

import { pointValue } from '../engine/shipBuilder'
import type { ShipForm } from '../engine/types'

export interface OperationalStats {
  /** 1–10, how loud the hull is: size class + ACTUAL POWER (4.3). */
  signature: number
  /** 1–10, how well it searches: sensor line + scout block + command (4.3). */
  sensorRating: number
  /** 0–5, identification quality — SCNC boxes + scout block (4.4, 4.5). */
  sciences: number
  /** Campaign rounds of fuel/supplies/ammo/spares (6.4). */
  endurance: number
  cloak: boolean
  /** FTL DRV boxes — the sprint allowance placeholder until Doyle's FTL rules (5.4). */
  ftlRating: number
  /** Printed point value, verbatim: VP and force-building only (3.1). */
  combatValue: number
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function systemBoxes(form: ShipForm, kind: string): number {
  return form.systems.filter((g) => g.kind === kind).reduce((n, g) => n + g.boxes, 0)
}

export function hasCloak(form: ShipForm): boolean {
  return systemBoxes(form, 'CLOAK') > 0
}

/** Big, hot ships are loud: the doc's proposed formula, verbatim (3.1). */
export function signatureOf(form: ShipForm): number {
  const actualPower = pointValue(form).actualPower
  return clamp(Math.round(form.sizeClass / 2 + actualPower / 40), 1, 10)
}

/**
 * The best Tactical Scan the SENSOR line can buy (its top step's value —
 * H2.2.1 prices exactly the 0/1/2-power settings Doyle's variable list names),
 * plus 2 for a Scout Sensor block and 1 for command systems (his note:
 * command ships have improved detection).
 */
export function sensorRatingOf(form: ShipForm): number {
  const line = form.functions.find((l) => l.kind === 'sensor')
  const top = line ? Math.max(line.freeValue, ...line.steps.map((s) => s.value)) : 0
  const scout = (form.scoutSensor?.sensors ?? 0) > 0 ? 2 : 0
  const command = systemBoxes(form, 'CMND') > 0 ? 1 : 0
  return clamp(top + scout + command, 1, 10)
}

/** Identification quality, not detection range (4.4). */
export function sciencesOf(form: ShipForm): number {
  const scout = (form.scoutSensor?.sensors ?? 0) > 0 ? 2 : 0
  return clamp(systemBoxes(form, 'SCNC') + scout, 0, 5)
}

export function operationalStats(form: ShipForm): OperationalStats {
  return {
    signature: signatureOf(form),
    sensorRating: sensorRatingOf(form),
    sciences: sciencesOf(form),
    endurance: clamp(form.sizeClass + 2, 4, 8),
    cloak: hasCloak(form),
    ftlRating: form.ftlDriveBoxes,
    combatValue: form.pointValue,
  }
}
