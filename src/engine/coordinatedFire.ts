import type { ShipState } from './shipState'

/**
 * Coordinated Fire (H4, Expansion 2) — an OPTIONAL rule.
 *
 * The base game resolves offensive fire in one pass, in descending order of
 * Tactical Scan (H2.4). H4 splits Step B of the Combat Segment into ten firing
 * steps: six Individual steps in descending scan order, then four Coordinated
 * steps in ascending scan order, where several ships of one faction may attack
 * the same target together.
 *
 * The trade-off the rule exists to create: a ship may fire early *or* fire
 * together with friends, never both, and the larger the group the longer it
 * waits (H4.1, designer's notes).
 */

export interface FiringStep {
  /** 1 – 10, as printed in H4.2.3. */
  index: number
  kind: 'individual' | 'coordinated'
  /** Tactical Scan level called out on this step. */
  scan: number
  /** Steps 1 and 10 read "5 or more" / "5+". */
  openEnded: boolean
  /** Ships that may fire together; `1` on the Individual steps. */
  maxShips: number | null
  label: string
}

/** The ten firing steps of H4.2.3, in order. */
export const FIRING_STEPS: readonly FiringStep[] = [
  { index: 1, kind: 'individual', scan: 5, openEnded: true, maxShips: 1, label: 'Ships with Tactical Scan Level 5 or more' },
  { index: 2, kind: 'individual', scan: 4, openEnded: false, maxShips: 1, label: 'Ships with Tactical Scan Level 4' },
  { index: 3, kind: 'individual', scan: 3, openEnded: false, maxShips: 1, label: 'Ships with Tactical Scan Level 3' },
  { index: 4, kind: 'individual', scan: 2, openEnded: false, maxShips: 1, label: 'Ships with Tactical Scan Level 2' },
  { index: 5, kind: 'individual', scan: 1, openEnded: false, maxShips: 1, label: 'Ships with Tactical Scan Level 1' },
  { index: 6, kind: 'individual', scan: 0, openEnded: false, maxShips: 1, label: 'Ships with Tactical Scan Level 0' },
  { index: 7, kind: 'coordinated', scan: 2, openEnded: false, maxShips: 2, label: 'Up to two ships with Tactical Scan Level 2' },
  { index: 8, kind: 'coordinated', scan: 3, openEnded: false, maxShips: 3, label: 'Up to three ships with Tactical Scan Level 3' },
  { index: 9, kind: 'coordinated', scan: 4, openEnded: false, maxShips: 4, label: 'Up to four ships with Tactical Scan Level 4' },
  // "…followed by five and up" (H4.5.3): the group size is bounded by the
  // requirement that every ship's scan be at least the number of ships firing,
  // so leaving this open-ended cannot be abused.
  { index: 10, kind: 'coordinated', scan: 5, openEnded: true, maxShips: null, label: 'Five or more ships with Tactical Scan Level 5+' },
]

/** Does a ship of this scan level fire on this step? */
export function stepMatchesScan(step: FiringStep, scan: number): boolean {
  return step.openEnded ? scan >= step.scan : scan === step.scan
}

/** The Individual step on which a ship of this scan level may fire (H4.4). */
export function individualStepFor(scan: number): FiringStep {
  return FIRING_STEPS.filter((s) => s.kind === 'individual').find((s) => stepMatchesScan(s, scan))!
}

/** The Coordinated step a group fires on, set by its highest scan (H4.5.3). */
export function coordinatedStepFor(scan: number): FiringStep | null {
  return FIRING_STEPS.filter((s) => s.kind === 'coordinated').find((s) => stepMatchesScan(s, scan)) ?? null
}

/**
 * Whether a single ship may take the current step to fire on its own.
 *
 * A lone ship is welcome on a Coordinated step — H4.2.4 puts it there
 * explicitly, for the ship whose partners were destroyed or whose player
 * changed their mind — but it still fires on the step matching its own scan
 * level, never an earlier one (H4.5.4).
 */
export function mayFireAlone(step: FiringStep, scan: number): boolean {
  if (step.kind === 'coordinated' && scan < 2) return false // H4.5.1
  return stepMatchesScan(step, scan)
}

export interface CoordinatedEntry {
  ship: ShipState
  /** Effective Tactical Scan: plotted sensor points plus lent command points. */
  scan: number
}

/**
 * Validate a coordinated attack (H4.5). Returns an error message, or null when
 * the group may fire on this step.
 */
export function validateCoordinatedFire(
  entries: readonly CoordinatedEntry[],
  step: FiringStep,
): string | null {
  if (entries.length === 0) return 'No ships selected.'

  // H4.2.4: "ships may never use coordinated fire during the Individual
  // Offensive Firing Steps."
  if (step.kind !== 'coordinated' && entries.length > 1) {
    return 'Coordinated fire may not be performed during the Individual Offensive Fire steps (H4.2.4).'
  }

  const side = entries[0].ship.side
  if (entries.some((e) => e.ship.side !== side)) {
    return 'Only ships of the same faction may coordinate their fire (H4.5).'
  }

  const size = entries.length
  if (step.maxShips !== null && size > step.maxShips) {
    return `Step ${step.index} allows at most ${step.maxShips} ship${step.maxShips === 1 ? '' : 's'} (H4.2.3).`
  }

  // H4.5.1: each ship needs at least as many tactical scan points as there are
  // ships firing together, and never fewer than two.
  const required = Math.max(size, step.kind === 'coordinated' ? 2 : 0)
  for (const entry of entries) {
    if (entry.scan < required) {
      return `${entry.ship.name} has Tactical Scan ${entry.scan}; ${required} is required to fire with ${size} ship${size === 1 ? '' : 's'} (H4.5.1).`
    }
  }

  // H4.5.4/H4.5.5: the step is fixed by the group's highest current scan level.
  // A mixed group therefore waits for the higher-scan ships' step — it may
  // never fire earlier than any of its members would alone.
  const top = Math.max(...entries.map((e) => e.scan))
  if (!stepMatchesScan(step, top)) {
    const proper = coordinatedStepFor(top)
    return proper
      ? `This group fires on step ${proper.index} — its highest Tactical Scan is ${top} (H4.5.5).`
      : `No coordinated step matches Tactical Scan ${top}.`
  }

  return null
}

// ---------------------------------------------------------------------------
// One attack per phase (H4.3)
// ---------------------------------------------------------------------------

/** Key for the "attacked this phase" set: one entry per faction per target. */
export function attackKey(attackerSide: string, targetId: string): string {
  return `${attackerSide}->${targetId}`
}

/**
 * Whether `attacker`'s faction may still fire on `target` this combat phase
 * (H4.3.1, H4.3.2). Returns an error message, or null when the attack is legal.
 */
export function checkOneAttackPerPhase(
  attackerSide: string,
  target: ShipState,
  attackedThisPhase: ReadonlySet<string>,
): string | null {
  if (target.side === attackerSide) {
    return 'A faction may not fire upon its own ships (H4.3.2).'
  }
  if (attackedThisPhase.has(attackKey(attackerSide, target.id))) {
    return `${target.name} has already been attacked by this faction during the current combat phase (H4.3.1).`
  }
  return null
}
