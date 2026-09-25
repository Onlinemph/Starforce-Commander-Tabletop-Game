import { describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import { headingVector } from '../../engine/geometry'
import { sampleKeys } from './ships'
import { alongHeading, framingDistance, headingToYaw, hullDepth, hullScale, shieldBand } from './space'

/**
 * The 3D view has to agree with the rules geometry: a ship on heading 90
 * points east in both views, and an inch is an inch. These pin the
 * conventions the layers are built on.
 */
describe('3D coordinates', () => {
  it('turns a nose-north model onto the board heading', () => {
    for (const heading of [0, 45, 90, 135, 180, 270, 315]) {
      const o = new Object3D()
      o.rotation.y = headingToYaw(heading)
      o.updateMatrixWorld()
      // The model's bow is −Z; after the yaw it must point along the heading.
      const bow = new Vector3(0, 0, -1).applyQuaternion(o.quaternion)
      const want = headingVector(heading)
      expect(bow.x).toBeCloseTo(want.x, 6)
      expect(bow.z).toBeCloseTo(want.y, 6)
    }
  })

  it('walks along a heading the way geometry.ts does', () => {
    const p = alongHeading({ x: 10, z: 10 }, 90, 3)
    expect(p.x).toBeCloseTo(13)
    expect(p.z).toBeCloseTo(10)
    const q = alongHeading({ x: 10, z: 10 }, 0, 2)
    expect(q.z).toBeCloseTo(8)
  })

  it('frames the whole board, wider boards from further away', () => {
    const near = framingDistance(24, 16, 42, 1.5)
    const far = framingDistance(48, 32, 42, 1.5)
    expect(far).toBeGreaterThan(near * 1.9)
    // The board's half-height fits in the vertical field of view.
    expect(Math.tan((21 * Math.PI) / 180) * near).toBeGreaterThanOrEqual(8)
  })

  it('bands shields exactly as the 2D ring does', () => {
    expect(shieldBand(1)).toBe('strong')
    expect(shieldBand(0.6)).toBe('strong')
    expect(shieldBand(0.59)).toBe('worn')
    expect(shieldBand(0.24)).toBe('weak')
    expect(shieldBand(0)).toBe('gone')
  })

  it('draws bigger hulls bigger and deeper, capped', () => {
    expect(hullScale(7)).toBeGreaterThan(hullScale(2))
    expect(hullScale(12)).toBe(1.05)
    expect(hullDepth(7)).toBeGreaterThan(hullDepth(2))
  })
})

describe('3D playback sampling', () => {
  const keys = [
    { x: 0, y: 0, heading: 0, offset: 0 },
    { x: 0, y: -4, heading: 0, offset: 0.6 },
    { x: 0, y: -4, heading: 60, offset: 1 },
  ]

  it('travels the straight before pivoting', () => {
    const mid = sampleKeys(keys, 0.3)
    expect(mid.y).toBeCloseTo(-2)
    expect(mid.heading).toBe(0)
    const turning = sampleKeys(keys, 0.8)
    expect(turning.y).toBeCloseTo(-4)
    expect(turning.heading).toBeCloseTo(30)
  })

  it('clamps to the ends', () => {
    expect(sampleKeys(keys, -1)).toEqual(keys[0])
    expect(sampleKeys(keys, 2)).toEqual(keys[2])
  })
})
