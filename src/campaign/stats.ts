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

/**
 * The speed ladder, in hexes a round, from the designer's fine-tuning note:
 * cruise = FTL circles + 1 (efficient); max cruise = FTL circles × 2;
 * maximum = max cruise + SIF; emergency = maximum + 1, at which a ship can
 * damage its own drives. "FTL circles" are the FTL DRV *function line's*
 * green circles (the allocatable ones), not the damage-track boxes — that is
 * the reading under which "a Yorktown has 9" comes out true (3 circles × 2 +
 * SIF 3).
 */
export interface SpeedTiers {
  cruise: number
  maxCruise: number
  maximum: number
  emergency: number
}

export interface OperationalStats {
  /** 1–10, how loud the hull is: size class + ACTUAL POWER (4.3). */
  signature: number
  /** 1–10, how well it searches: sensor line + scout block + command (4.3). */
  sensorRating: number
  /**
   * The rating at each sensor power setting, index = power 0/1/2: the form's
   * own 0-, 1- and 2-power SENSOR values (the H2.2.1 ladder), plus the scout
   * and command bonuses. `sensorRating` above equals the full-power entry.
   */
  sensorRatings: [number, number, number]
  /** 0–5, identification quality — SCNC boxes + scout block (4.4, 4.5). */
  sciences: number
  /** Campaign rounds of fuel/supplies/ammo/spares (6.4). */
  endurance: number
  cloak: boolean
  /** FTL DRV boxes — the sprint allowance placeholder until Doyle's FTL rules (5.4). */
  ftlRating: number
  /** Operational speeds in hexes a round, derived from FTL circles + SIF. */
  speeds: SpeedTiers
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

/**
 * The Tactical Scan value the SENSOR line delivers at a given power setting:
 * zero power is the line's free value; each further point fills circles left
 * to right (sequential, B2.2.2) and the value is the last circle afforded.
 * These are the "zero power / 1 power / 2 power sensor points" the designer
 * names as detection inputs — read straight off the form.
 */
export function sensorValueAt(form: ShipForm, power: 0 | 1 | 2): number {
  const line = form.functions.find((l) => l.kind === 'sensor')
  if (!line) return 0
  let value = line.freeValue
  let budget: number = power
  for (const step of line.steps) {
    if (step.powerCost > budget) break
    budget -= step.powerCost
    value = step.value
  }
  return value
}

/** Identification quality, not detection range (4.4). */
export function sciencesOf(form: ShipForm): number {
  const scout = (form.scoutSensor?.sensors ?? 0) > 0 ? 2 : 0
  return clamp(systemBoxes(form, 'SCNC') + scout, 0, 5)
}

/** The FTL DRV function line's green circles — the speed formulas' input. */
export function ftlCirclesOf(form: ShipForm): number {
  const line = form.functions.find((l) => l.kind === 'ftl-drive')
  return line ? Math.max(line.freeValue, ...line.steps.map((s) => s.value), 0) : 0
}

/** The SIF line's top value — the margin the frame adds over the drives. */
export function sifOf(form: ShipForm): number {
  const line = form.functions.find((l) => l.kind === 'sif')
  return line ? Math.max(line.freeValue, ...line.steps.map((s) => s.value), 0) : 0
}

/** The designer's speed formulas, verbatim; a drive-less hull limps at 1. */
export function speedTiersOf(ftlCircles: number, sif: number): SpeedTiers {
  const cruise = Math.max(1, ftlCircles + 1)
  const maxCruise = Math.max(cruise, ftlCircles * 2)
  const maximum = maxCruise + sif
  return { cruise, maxCruise, maximum, emergency: maximum + 1 }
}

export function operationalStats(form: ShipForm): OperationalStats {
  const scout = (form.scoutSensor?.sensors ?? 0) > 0 ? 2 : 0
  const command = systemBoxes(form, 'CMND') > 0 ? 1 : 0
  const ratings = ([0, 1, 2] as const).map((power) =>
    clamp(sensorValueAt(form, power) + scout + command, 1, 10),
  ) as [number, number, number]
  return {
    signature: signatureOf(form),
    sensorRating: sensorRatingOf(form),
    sensorRatings: ratings,
    sciences: sciencesOf(form),
    endurance: clamp(form.sizeClass + 2, 4, 8),
    cloak: hasCloak(form),
    ftlRating: form.ftlDriveBoxes,
    speeds: speedTiersOf(ftlCirclesOf(form), sifOf(form)),
    combatValue: form.pointValue,
  }
}
