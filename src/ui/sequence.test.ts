import { describe, expect, it } from 'vitest'
import { PHASE_ORDER, PHASE_SEGMENTS, SEGMENT_LABELS } from '../engine/game'
import { sequenceOutline, PHASE_SHORT, SEGMENT_SHORT } from './sequence'
import type { Phase, Segment } from '../engine/types'

/**
 * The sequence-of-play rail (A3). It is a status display, so what matters is
 * that it always agrees with the engine about what a round is made of, and
 * that exactly one row is ever the current one.
 */

describe('the sequence outline', () => {
  it('lists every phase, and opens out only the one you are in', () => {
    const rows = sequenceOutline('combat-1', 'navigation')
    const phases = rows.filter((r) => r.kind === 'phase')
    expect(phases).toHaveLength(PHASE_ORDER.length)
    expect(rows.filter((r) => r.kind === 'segment')).toHaveLength(
      PHASE_SEGMENTS['combat-1'].length,
    )
  })

  it('puts the open segments directly under their phase', () => {
    const rows = sequenceOutline('final', 'disengagement')
    const at = rows.findIndex((r) => r.kind === 'phase' && r.key === 'final')
    expect(rows.slice(at + 1).every((r) => r.kind === 'segment')).toBe(true)
  })

  it('marks exactly one phase and one segment as current', () => {
    for (const phase of PHASE_ORDER) {
      for (const segment of PHASE_SEGMENTS[phase]) {
        const rows = sequenceOutline(phase, segment)
        expect(rows.filter((r) => r.kind === 'phase' && r.state === 'now')).toHaveLength(1)
        expect(rows.filter((r) => r.kind === 'segment' && r.state === 'now')).toHaveLength(1)
      }
    }
  })

  it('reads behind you as done and ahead of you as ahead', () => {
    const rows = sequenceOutline('combat-2', 'combat')
    const state = (key: string) => rows.find((r) => r.key === key)!.state
    expect(state('engineering')).toBe('done')
    expect(state('combat-1')).toBe('done')
    expect(state('combat-2')).toBe('now')
    expect(state('combat-3')).toBe('ahead')
    expect(state('final')).toBe('ahead')
    // And within the open phase: command and operations are behind combat.
    expect(state('combat-2/command')).toBe('done')
    expect(state('combat-2/navigation')).toBe('done')
    expect(state('combat-2/combat')).toBe('now')
    expect(state('combat-2/flight-operations')).toBe('ahead')
  })

  it('walks the whole round without ever going backwards', () => {
    let seen = 0
    for (const phase of PHASE_ORDER) {
      for (const segment of PHASE_SEGMENTS[phase]) {
        const rows = sequenceOutline(phase, segment)
        const done = rows.filter((r) => r.state === 'done').length
        // Each step of the round finishes at least as much as the one before.
        expect(done).toBeGreaterThanOrEqual(seen - PHASE_SEGMENTS[phase].length)
        seen = done
      }
    }
  })

  /*
   * The rail's short labels are a second copy of a list the engine owns, and
   * the failure mode is quiet: add a segment to the sequence of play and the
   * rail renders a blank row for it. So the copies are checked against each
   * other rather than trusted.
   */
  it('has a short label for every phase and segment the engine defines', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_SHORT[phase as Phase], `no short name for ${phase}`).toBeTruthy()
      for (const segment of PHASE_SEGMENTS[phase]) {
        expect(SEGMENT_SHORT[segment as Segment], `no short name for ${segment}`).toBeTruthy()
      }
    }
  })

  it('has no short label for anything the engine does not have', () => {
    const real = new Set(Object.keys(SEGMENT_LABELS))
    for (const key of Object.keys(SEGMENT_SHORT)) expect(real.has(key)).toBe(true)
  })

  it('keeps the short labels short enough for the rail', () => {
    for (const label of Object.values(SEGMENT_SHORT)) expect(label.length).toBeLessThanOrEqual(11)
    for (const label of Object.values(PHASE_SHORT)) expect(label.length).toBeLessThanOrEqual(11)
  })

  it('shows the start of a phase rather than the end when the segment is unknown', () => {
    const rows = sequenceOutline('engineering', 'combat' as Segment)
    expect(rows.filter((r) => r.kind === 'segment' && r.state === 'done')).toHaveLength(0)
  })
})
