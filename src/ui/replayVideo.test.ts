import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORD, estimateSeconds, localiseRefs } from './replayVideo'

/**
 * The recorder's arithmetic. Everything else about it — that frames come out
 * mid-glide rather than at the destination, that zooming while it records
 * stays out of the file — needs a browser to mean anything, and was measured
 * in one: 765 frames over a 29-second recording where the old pipeline
 * managed 90, with the live map zoomed six notches in throughout and the
 * whole board still in every frame.
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
