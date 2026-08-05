import { PHASE_ORDER, PHASE_SEGMENTS } from '../engine/game'
import type { Phase, Segment } from '../engine/types'

/**
 * Where you are in the round (A3), as something you can see rather than
 * remember.
 *
 * A round is five phases and each phase is a handful of segments, always in
 * the same order, and almost every rule in the book is anchored to one of them
 * — power is spent in Engineering, courses are written in Command, and if you
 * wanted to raise a shield you needed Operations two segments ago. The header
 * showed only the segments of the phase you were already in, which tells you
 * nothing about what is coming or what you have missed.
 *
 * Only the current phase is opened out. All five at full depth is
 * twenty-three rows of a game you are trying to look at, and the segments of a
 * phase you are not in are not a decision you can act on.
 */

export type SequenceState = 'done' | 'now' | 'ahead'

export interface SequenceRow {
  kind: 'phase' | 'segment'
  /** Stable key for React, unique across the outline. */
  key: string
  label: string
  state: SequenceState
}

/** Phase names as they fit a 104-pixel rail. */
export const PHASE_SHORT: Record<Phase, string> = {
  engineering: 'ENGINEERING',
  'combat-1': 'COMBAT 1',
  'combat-2': 'COMBAT 2',
  'combat-3': 'COMBAT 3',
  final: 'FINAL',
}

/**
 * Segment names likewise. The full names live in SEGMENT_LABELS and are used
 * everywhere there is room for them; these are only for the rail.
 */
export const SEGMENT_SHORT: Record<Segment, string> = {
  'resource-allocation': 'Resource',
  'damage-control': 'Damage Ctl',
  command: 'Command',
  operations: 'Operations',
  navigation: 'Navigation',
  combat: 'Combat',
  'flight-operations': 'Flight Ops',
  'delayed-action': 'Delayed',
  'stress-check': 'Stress',
  'boarding-combat': 'Boarding',
  disengagement: 'Disengage',
  'hangar-bay': 'Hangar',
  'final-activity': 'Activity',
}

/**
 * The round as a list of rows: every phase, with the current phase's segments
 * opened out beneath it.
 */
export function sequenceOutline(phase: Phase, segment: Segment): SequenceRow[] {
  const here = PHASE_ORDER.indexOf(phase)
  const rows: SequenceRow[] = []

  for (const [index, p] of PHASE_ORDER.entries()) {
    rows.push({
      kind: 'phase',
      key: p,
      label: PHASE_SHORT[p],
      state: index < here ? 'done' : index === here ? 'now' : 'ahead',
    })
    if (index !== here) continue

    const segments = PHASE_SEGMENTS[p]
    // A segment the engine does not list for this phase — which should not
    // happen — reads as "at the start", not as "everything is finished".
    const at = segments.indexOf(segment)
    for (const [j, s] of segments.entries()) {
      rows.push({
        kind: 'segment',
        key: `${p}/${s}`,
        label: SEGMENT_SHORT[s],
        state: at < 0 ? 'ahead' : j < at ? 'done' : j === at ? 'now' : 'ahead',
      })
    }
  }
  return rows
}
