import { describe, expect, it } from 'vitest'
import {
  canCaptureTab,
  DEFAULT_RECORD,
  estimateRecording,
  estimateSeconds,
  localiseRefs,
  recordMethod,
  recordingStops,
} from './replayVideo'

/**
 * The recorder's arithmetic and its feature detection. Everything else needs a
 * browser to mean anything, and was measured in one (Chromium, 141-action
 * battle):
 *
 *  - Filming the tab: the track crops to the map — 774×710 out of a 1400×900
 *    page — and the finished file holds the board and nothing else. Zero
 *    frames drawn by hand.
 *  - Drawing frames by hand, for browsers without Region Capture: 765 frames
 *    over a 29-second recording, where the original pipeline managed 90.
 *  - Either way the view is locked: zoomed five notches in, the recording
 *    snapped back to the whole board and refused to move.
 */

describe('references inside a frame', () => {
  it('stay relative, so a glow still points at the frame’s own defs', () => {
    expect(localiseRefs('url("http://localhost:5199/replay#glow")')).toBe('url("#glow")')
    expect(localiseRefs('url(#glow)')).toBe('url(#glow)')
    expect(localiseRefs("url('https://example.test/x#hull-grad')")).toBe("url('#hull-grad')")
  })

  it('leaves everything that is not a reference alone', () => {
    expect(localiseRefs('matrix(0, -1, 1, 0, 658.607, 360)')).toBe(
      'matrix(0, -1, 1, 0, 658.607, 360)',
    )
    expect(localiseRefs('rgb(12, 200, 140)')).toBe('rgb(12, 200, 140)')
  })
})

describe('choosing how to record', () => {
  it('falls back to drawing frames where the browser cannot film its own tab', () => {
    // Node has no getDisplayMedia and no Region Capture, which is exactly the
    // shape of a browser that has to take the slow road.
    expect(canCaptureTab()).toBe(false)
    expect(recordMethod()).toBe('canvas')
  })
})

describe('how long a recording will take', () => {
  it('prices a narrated moment and a bookkeeping step differently', () => {
    const narrated = estimateSeconds(10, 0)
    const mixed = estimateSeconds(10, 40)
    expect(mixed).toBeGreaterThan(narrated)
    // Forty quiet steps must still cost less than forty narrated ones.
    expect(mixed).toBeLessThan(estimateSeconds(50, 0))
  })

  /*
   * The invariant is not a number, it is a relationship: the camera must not
   * cut away before the map has finished moving. It used to be written as
   * "hold >= 900" because the live board glides for 900ms — but recording now
   * shortens the glide rather than sitting through it, so what has to hold is
   * that the hold still outlasts whatever the glide has been set to.
   */
  it('holds a narrated moment longer than the glide it has to cover', () => {
    expect(DEFAULT_RECORD.glideMs).toBeDefined()
    expect(DEFAULT_RECORD.holdMs).toBeGreaterThan(DEFAULT_RECORD.glideMs!)
    expect(DEFAULT_RECORD.quietMs).toBeLessThan(DEFAULT_RECORD.holdMs)
    // And a quiet stop still has to outlast the glide, since a collapsed run
    // of bookkeeping is exactly where a ship's movement lands.
    expect(DEFAULT_RECORD.quietMs).toBeGreaterThanOrEqual(DEFAULT_RECORD.glideMs!)
  })
})

/**
 * Which steps the recorder stops at. This is where the time goes: filming
 * every action of a battle films the bookkeeping between the moments, and
 * there is far more of that than there is battle.
 */
describe('the stops a recording makes', () => {
  // A battle shaped like a real one: a narrated moment every so often, with
  // runs of quiet bookkeeping between them.
  const narrated = (i: number) => i % 7 === 3
  const options = { ...DEFAULT_RECORD, narrated }

  it('collapses a run of quiet steps to a single stop', () => {
    const stops = recordingStops(60, options)
    // Two stops per seven steps: the narrated one, and the end of the run
    // leading to the next.
    expect(stops.length).toBeLessThan(61 / 2)
    expect(stops.length).toBeGreaterThan(0)
  })

  it('keeps every narrated moment', () => {
    const stops = new Set(recordingStops(60, options))
    for (let i = 0; i <= 60; i++) if (narrated(i)) expect(stops.has(i)).toBe(true)
  })

  it('always ends on the last step, so the film does not stop early', () => {
    for (const steps of [0, 1, 7, 60, 61]) {
      expect(recordingStops(steps, options).at(-1)).toBe(steps)
    }
  })

  it('never goes backwards or repeats', () => {
    const stops = recordingStops(60, options)
    expect([...new Set(stops)]).toEqual(stops)
    expect([...stops].sort((a, b) => a - b)).toEqual(stops)
  })

  it('films everything when every step is narrated', () => {
    const stops = recordingStops(20, { ...DEFAULT_RECORD, narrated: () => true })
    expect(stops).toHaveLength(21)
  })

  it('drops the bookkeeping entirely on highlights only', () => {
    const all = recordingStops(60, options)
    const few = recordingStops(60, { ...options, highlightsOnly: true })
    expect(few.length).toBeLessThan(all.length)
    for (const i of few) expect(narrated(i) || i === 60).toBe(true)
  })

  it('is much shorter than filming every action, and highlights shorter still', () => {
    const every = estimateRecording(60, { ...DEFAULT_RECORD, narrated: () => true })
    const collapsed = estimateRecording(60, options)
    const highlights = estimateRecording(60, { ...options, highlightsOnly: true })
    expect(collapsed).toBeLessThan(every)
    expect(highlights).toBeLessThan(collapsed)
  })
})
