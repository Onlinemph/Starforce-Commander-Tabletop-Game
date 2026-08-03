import { describe, expect, it } from 'vitest'
import { canCaptureTab, DEFAULT_RECORD, estimateSeconds, localiseRefs, recordMethod } from './replayVideo'

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

  it('holds a narrated moment long enough to cover the glide', () => {
    // .map-mover transitions for 900ms; cutting away sooner is what made the
    // old recordings jerky.
    expect(DEFAULT_RECORD.holdMs).toBeGreaterThanOrEqual(900)
    expect(DEFAULT_RECORD.quietMs).toBeLessThan(DEFAULT_RECORD.holdMs)
  })
})
