import { describe, expect, it } from 'vitest'
import { skyDirection } from './textures'

/** Length of a direction vector — every one of these must sit on the unit sphere. */
function length(d: { x: number; y: number; z: number }): number {
  return Math.hypot(d.x, d.y, d.z)
}

describe('skyDirection', () => {
  it('always returns a unit vector', () => {
    for (const [u, v] of [
      [0, 0],
      [0.25, 0.1],
      [0.5, 0.5],
      [0.73, 0.9],
      [0.999, 0.001],
    ]) {
      expect(length(skyDirection(u, v))).toBeCloseTo(1, 5)
    }
  })

  it('puts v=0 at the +Y pole and v=1 at the -Y pole, for any u', () => {
    // Matches SphereGeometry's own convention (thetaStart=0 at the top), so
    // the canvas the sky is painted on lines up with the sphere with no seam.
    expect(skyDirection(0.3, 0).y).toBeCloseTo(1, 5)
    expect(skyDirection(0.7, 1).y).toBeCloseTo(-1, 5)
  })

  it('wraps seamlessly: u=0 and u=1 land on the same point', () => {
    const a = skyDirection(0, 0.4)
    const b = skyDirection(1, 0.4)
    expect(a.x).toBeCloseTo(b.x, 5)
    expect(a.y).toBeCloseTo(b.y, 5)
    expect(a.z).toBeCloseTo(b.z, 5)
  })
})
