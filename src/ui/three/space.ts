/**
 * The 3D view's coordinate system and palette.
 *
 * One world unit is one rulebook inch, so the tape measure means the same in
 * both views. The board lies in the XZ plane: board x is world X, board y is
 * world Z (south is +Z), and up is +Y. A ship's heading turns it about Y: a
 * hull modelled nose toward −Z (north) takes `rotation.y = −heading` in
 * radians, so heading 90 points it along +X (east) exactly as on the map.
 *
 * Nothing here knows about three.js objects beyond vectors, so the pure parts
 * of the view (layout, colours, geometry maths) can be tested in node.
 */
import { Vector3 } from 'three'

export const DEG = Math.PI / 180

/** Height the hulls ride above the board plane, in inches. */
export const HULL_ALTITUDE = 0.32

/** A ship counter is 1.5 inches across (A2.1). */
export const SHIP_SIZE = 1.5

export function toWorld(p: { x: number; y: number }, altitude = 0): Vector3 {
  return new Vector3(p.x, altitude, p.y)
}

/** Board heading (degrees, 0 = north, clockwise) to a Y rotation in radians. */
export function headingToYaw(heading: number): number {
  return -heading * DEG
}

/**
 * The point `distance` inches from `origin` along a board heading. Mirrors
 * geometry.ts's `headingVector`, but in world space.
 */
export function alongHeading(origin: { x: number; z: number }, heading: number, distance: number) {
  return {
    x: origin.x + Math.sin(heading * DEG) * distance,
    z: origin.z - Math.cos(heading * DEG) * distance,
  }
}

/** The side colours, matching the stylesheet's tokens. */
export const SIDE_COLOR = {
  blue: 0x5aa9ff,
  red: 0xff5c5c,
  aurelian: 0xcc99cc,
} as const

export type SideColor = keyof typeof SIDE_COLOR

export function sideColorOf(side: string): SideColor {
  if (side.startsWith('Blue')) return 'blue'
  if (side.startsWith('Aurelian')) return 'aurelian'
  return 'red'
}

/** Shield bands, the same thresholds and colours as the 2D ring. */
export const SHIELD_COLOR = {
  strong: 0x56d2a0,
  worn: 0xffc247,
  weak: 0xff6b4a,
  armor: 0xb9c2d2,
  gone: 0xff6b4a,
} as const

export function shieldBand(fraction: number): 'strong' | 'worn' | 'weak' | 'gone' {
  if (fraction <= 0) return 'gone'
  if (fraction < 0.25) return 'weak'
  if (fraction < 0.6) return 'worn'
  return 'strong'
}

/** Beam colours, from the 2D fx stylesheet. */
export const WEAPON_COLOR = {
  phaser: 0xff9548,
  disruptor: 0x6dff8f,
  torpedo: 0xffd27a,
  generic: 0xdfe6ff,
} as const

/** Hull plating washes by damage level, from the 2D stylesheet. */
export const DAMAGE_TINT: Record<string, number> = {
  // Multiplied by the panel texture, so these are the plating's paint:
  // gunmetal when whole, scorched toward rust and char as it is hurt.
  none: 0x7482a0,
  minor: 0x6f7b96,
  light: 0x76705f,
  moderate: 0x76604f,
  heavy: 0x6d4838,
  crippled: 0x5a2f25,
  derelict: 0x2e2e34,
}

/** How big the hull glyph is drawn, as a fraction of the counter (same curve as 2D). */
export function hullScale(sizeClass: number): number {
  return Math.min(0.72 + 0.05 * sizeClass, 1.05)
}

/**
 * How tall an extruded hull is, in inches. Bigger ships are deeper as well as
 * wider, so a dreadnought has presence from a low camera and a frigate
 * still reads as a solid thing, not a decal.
 */
export function hullDepth(sizeClass: number): number {
  return 0.08 + Math.min(sizeClass, 10) * 0.018
}

/**
 * Where the camera should sit to frame the whole board from a given
 * elevation, looking at its centre. Pure maths so it can be tested.
 */
export function framingDistance(width: number, height: number, fovDeg: number, aspect: number): number {
  const vFov = fovDeg * DEG
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const byHeight = height / 2 / Math.tan(vFov / 2)
  const byWidth = width / 2 / Math.tan(hFov / 2)
  // A touch of air round the edge, so the board does not kiss the frame.
  return Math.max(byHeight, byWidth) * 1.08
}
