import { describe, expect, it } from 'vitest'
import { applyManeuver, normalizeHeading } from '../engine/geometry'
import type { MoveTrail } from '../engine/game'
import type { Maneuver, TurnDirection } from '../engine/types'
import { trailDuration, trailIsNewer, trailKeyframes } from './motion'

/** A trail exactly as the engine records one, from the real maneuver code. */
function leg(maneuver: Maneuver, direction: TurnDirection | null, speed: number, turnTemplate = 30): MoveTrail {
  const from = { position: { x: 10, y: 10 }, heading: 90 }
  const result = applyManeuver({ start: from, speed, maneuver, direction, turnTemplate })
  return {
    round: 1,
    phase: 'combat-1',
    from,
    path: result.path,
    heading: result.end.heading,
    reverse: speed < 0,
    ...{ end: result.end },
  } as MoveTrail & { end: { position: { x: number; y: number }; heading: number } }
}

const end = (t: ReturnType<typeof leg>) => (t as unknown as { end: { position: { x: number; y: number }; heading: number } }).end

describe('turning a Navigation leg into keyframes', () => {
  it('flies a straight leg as one glide, facing unchanged', () => {
    const t = leg('straight', null, 4)
    const keys = trailKeyframes(t, end(t), 90)
    expect(keys).toHaveLength(2)
    expect(keys.every((k) => k.heading === 90)).toBe(true)
    expect(keys[1].x).toBeCloseTo(14)
    expect(keys[1].offset).toBe(1)
  })

  it('moves forward, then pivots in place, for a standard turn (C2.2.3)', () => {
    const t = leg('standard', 'right', 4)
    const keys = trailKeyframes(t, end(t), 90)
    // Start, end of the forward leg, then the pivot at the same point.
    expect(keys).toHaveLength(3)
    expect(keys[1].heading).toBe(90)
    expect(keys[2].x).toBeCloseTo(keys[1].x)
    expect(keys[2].y).toBeCloseTo(keys[1].y)
    expect(keys[2].heading).toBe(120)
  })

  it('pivots between the halves of a hard turn and again at the end (C3.2.2)', () => {
    const t = leg('hard', 'left', 6)
    const keys = trailKeyframes(t, end(t), 90)
    const headings = keys.map((k) => k.heading)
    // Never spins the long way: every step is a short turn.
    for (let i = 1; i < headings.length; i++) expect(Math.abs(headings[i] - headings[i - 1])).toBeLessThanOrEqual(180)
    expect(normalizeHeading(headings[headings.length - 1])).toBeCloseTo(end(t).heading)
    const last = keys[keys.length - 1]
    expect(last.x).toBeCloseTo(end(t).position.x)
    expect(last.y).toBeCloseTo(end(t).position.y)
  })

  it('keeps its facing through a slide (C2.4.2)', () => {
    const t = leg('slide', 'right', 3)
    const keys = trailKeyframes(t, end(t), 90)
    expect(keys.every((k) => k.heading === 90)).toBe(true)
  })

  it('backs astern without turning round (C3.7.2)', () => {
    const t = leg('straight', null, -2)
    const keys = trailKeyframes(t, end(t), 90)
    expect(keys.every((k) => k.heading === 90)).toBe(true)
    expect(keys[keys.length - 1].x).toBeCloseTo(8)
  })

  it('starts from the unwrapped heading the counter is already drawn at', () => {
    const t = leg('standard', 'left', 4)
    // Drawn at 450 (= 90 after a full lap): the result stays continuous with it.
    const keys = trailKeyframes(t, end(t), 450)
    expect(keys[0].heading).toBe(450)
    expect(keys[keys.length - 1].heading).toBe(420)
  })

  it('ends exactly where the table ended, even if something turned the ship afterwards', () => {
    const t = leg('straight', null, 4)
    const keys = trailKeyframes(t, { position: end(t).position, heading: 120 }, 90)
    expect(keys[keys.length - 1].heading).toBe(120)
  })

  it('gives a longer leg more time, within bounds', () => {
    const short = trailKeyframes(leg('straight', null, 1), end(leg('straight', null, 1)), 90)
    const long = trailKeyframes(leg('straight', null, 8), end(leg('straight', null, 8)), 90)
    expect(trailDuration(long)).toBeGreaterThan(trailDuration(short))
    expect(trailDuration(long)).toBeLessThanOrEqual(1500)
    expect(trailDuration(short)).toBeGreaterThanOrEqual(600)
  })

  it('only replays moves newer than the last one shown', () => {
    const t = leg('straight', null, 4)
    expect(trailIsNewer(t, undefined)).toBe(true)
    expect(trailIsNewer(t, { round: 1, phase: 'combat-1' })).toBe(false)
    expect(trailIsNewer({ ...t, phase: 'combat-2' }, { round: 1, phase: 'combat-1' })).toBe(true)
    expect(trailIsNewer({ ...t, round: 2, phase: 'combat-1' }, { round: 1, phase: 'combat-3' })).toBe(true)
  })
})
