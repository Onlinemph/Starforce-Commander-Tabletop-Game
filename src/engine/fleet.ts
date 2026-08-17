import type { Availability, ShipForm } from './types'

/**
 * Force composition (S2.5).
 *
 * A force is a list of ship classes and how many of each you are fielding. What
 * makes it interesting is S2.5.4: how many of a class you may take depends both
 * on the rarity printed on its form and on how long the class has been in
 * service when the battle is fought.
 */

export interface FleetEntry {
  formId: string
  count: number
}

export interface Fleet {
  side: string
  entries: FleetEntry[]
}

/** Common is the most available, unique the least. */
export const AVAILABILITY_ORDER: Availability[] = ['common', 'uncommon', 'rare', 'unique']

/** The share of a force's point value each rarity may make up (S2.5.4). */
export const AVAILABILITY_SHARE: Record<Availability, number> = {
  common: 1,
  uncommon: 0.4,
  rare: 0.2,
  unique: 0,
}

export const AVAILABILITY_RULE: Record<Availability, string> = {
  common: 'No limit on numbers.',
  uncommon: 'At most 40% of a force by point value — but one is always allowed.',
  rare: 'At most 20% of a force by point value.',
  unique: 'Only one unique ship in the whole battle.',
}

/** How many ships one side may deploy before a scenario's setup zone overflows. */
export const MAX_SHIPS_PER_SIDE = 8

/**
 * What a class is actually worth on the availability table in a given year
 * (S2.5.4).
 *
 * A class is Rare in its first year of service, Uncommon in its second and
 * Common from its third — but never more available than the maximum printed on
 * its form. Before it enters service it cannot be fielded at all.
 */
export function availabilityIn(form: ShipForm, year?: number): Availability | 'unavailable' {
  const printed = form.availability ?? 'common'
  if (year === undefined || form.year === undefined) return printed
  const age = year - form.year
  if (age < 0) return 'unavailable'
  const byAge: Availability = age === 0 ? 'rare' : age === 1 ? 'uncommon' : 'common'
  // The rarer of the two wins.
  return AVAILABILITY_ORDER.indexOf(byAge) > AVAILABILITY_ORDER.indexOf(printed) ? byAge : printed
}

/**
 * How the picker prices a hull: the printed Master Ship List value by
 * default, or the measured battle value when the battle is being built on
 * the balanced scale (engine/fleetValue.ts).
 */
export type PriceOf = (form: ShipForm) => number

const printedPrice: PriceOf = (form) => form.pointValue

export function fleetPoints(
  entries: FleetEntry[],
  forms: Map<string, ShipForm>,
  price: PriceOf = printedPrice,
): number {
  const total = entries.reduce((n, e) => {
    const form = forms.get(e.formId)
    return n + (form ? price(form) : 0) * e.count
  }, 0)
  // Point values carry one decimal since the hit-point Master Ship List
  // (50.4-point dreadnoughts), and binary floats would let three of them show
  // as 151.20000000000002 in the picker.
  return Math.round(total * 10) / 10
}

export function fleetSize(entries: FleetEntry[]): number {
  return entries.reduce((n, e) => n + e.count, 0)
}

/** Flatten a force into one form id per hull, in the order they were added. */
export function fleetFormIds(entries: FleetEntry[]): string[] {
  return entries.flatMap((e) => Array.from({ length: e.count }, () => e.formId))
}

export interface FleetProblem {
  side: string
  severity: 'error' | 'warning'
  message: string
}

export interface FleetCheckOptions {
  /** The year the battle is fought, which drives S2.5.4 availability. */
  year?: number
  /** Point budget both forces are built to, if the players agreed one. */
  budget?: number
  /** The price scale the budget is denominated in. Printed by default. */
  price?: PriceOf
}

/**
 * Check every force in a battle against S2.5.4, plus the practical limits of
 * deploying them. Returns errors that make a force illegal and warnings for
 * things that are legal but lopsided.
 */
export function validateFleets(
  fleets: Fleet[],
  forms: Map<string, ShipForm>,
  options: FleetCheckOptions = {},
): FleetProblem[] {
  const problems: FleetProblem[] = []
  const { year, budget } = options
  const price = options.price ?? printedPrice
  let uniquesInBattle = 0

  for (const fleet of fleets) {
    const push = (severity: FleetProblem['severity'], message: string) =>
      problems.push({ side: fleet.side, severity, message })

    const size = fleetSize(fleet.entries)
    if (size === 0) {
      push('error', 'The force has no ships.')
      continue
    }
    if (size > MAX_SHIPS_PER_SIDE) {
      push('error', `A setup zone holds at most ${MAX_SHIPS_PER_SIDE} ships; this force has ${size}.`)
    }

    const total = fleetPoints(fleet.entries, forms, price)
    if (budget !== undefined && total > budget) {
      push('error', `${total} points fielded against a budget of ${budget} (S2.5.1).`)
    }

    // Group the force's point value by the rarity that applies this year.
    const byRarity = new Map<Availability, { points: number; count: number; names: string[] }>()
    for (const entry of fleet.entries) {
      const form = forms.get(entry.formId)
      if (!form) {
        push('error', `Unknown ship class "${entry.formId}".`)
        continue
      }
      const rarity = availabilityIn(form, year)
      if (rarity === 'unavailable') {
        push('warning', `${form.name} does not enter service until ${form.year} (S2.5.4).`)
        continue
      }
      const bucket = byRarity.get(rarity) ?? { points: 0, count: 0, names: [] }
      bucket.points += price(form) * entry.count
      bucket.count += entry.count
      if (!bucket.names.includes(form.name)) bucket.names.push(form.name)
      byRarity.set(rarity, bucket)
    }

    const uncommon = byRarity.get('uncommon')
    if (uncommon && uncommon.count > 1) {
      // "You can always have at least one uncommon ship within your force" —
      // so the 40% cap only bites once a second one is added.
      const share = uncommon.points / total
      if (share > AVAILABILITY_SHARE.uncommon) {
        push(
          'warning',
          `Uncommon ships are ${Math.round(share * 100)}% of the force by point value; ` +
            `S2.5.4 allows 40% once you field more than one (${uncommon.names.join(', ')}).`,
        )
      }
    }

    const rare = byRarity.get('rare')
    if (rare) {
      const share = rare.points / total
      if (share > AVAILABILITY_SHARE.rare) {
        push(
          'warning',
          `Rare ships are ${Math.round(share * 100)}% of the force by point value; S2.5.4 allows ` +
            `20% — "these ships are valuable and rarely travel alone" (${rare.names.join(', ')}).`,
        )
      }
    }

    const unique = byRarity.get('unique')
    if (unique) uniquesInBattle += unique.count

    if (budget !== undefined && total < budget * 0.75) {
      push('warning', `Only ${total} of the ${budget}-point budget is spent.`)
    }
  }

  if (uniquesInBattle > 1) {
    problems.push({
      side: fleets[0]?.side ?? '',
      severity: 'warning',
      message: `${uniquesInBattle} unique ships are in the battle; S2.5.4 allows one.`,
    })
  }

  return problems
}
