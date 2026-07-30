import { describe, expect, it } from 'vitest'
import {
  actualRange,
  applyManeuver,
  arcsForBearing,
  arcTo,
  effectiveRange,
  emergencyTurnStress,
  hasLineOfSight,
  normalizeHeading,
  shieldsFacing,
} from './geometry'

describe('range (E1)', () => {
  it('rounds fractional range down (E1.1.1)', () => {
    expect(actualRange({ x: 0, y: 0 }, { x: 0.99, y: 0 })).toBe(0)
    expect(actualRange({ x: 0, y: 0 }, { x: 1.99, y: 0 })).toBe(1)
    expect(actualRange({ x: 0, y: 0 }, { x: 4.5, y: 0 })).toBe(4)
  })

  it('applies jamming and targeting (H2.3.5, H2.3.6)', () => {
    // Yorktown at range 8, Vallari jamming 3, Yorktown targeting 2 → 9 (H2.3.5).
    expect(effectiveRange(8, 3, 2)).toBe(9)
    // Range 4, jamming 4, targeting 2 → 6 (H2.3.7 second example).
    expect(effectiveRange(4, 4, 2)).toBe(6)
    // Equal jamming and targeting cancel out (H2.3.4).
    expect(effectiveRange(7, 2, 2)).toBe(7)
    // Targeting can reduce range to zero but no further (H2.3.8).
    expect(effectiveRange(3, 0, 9)).toBe(0)
  })
})

describe('firing arcs (E2.2)', () => {
  it('maps bearings to the eight 45-degree arcs', () => {
    expect(arcsForBearing(20)).toEqual(['FS'])
    expect(arcsForBearing(60)).toEqual(['SF'])
    expect(arcsForBearing(100)).toEqual(['SA'])
    expect(arcsForBearing(160)).toEqual(['AS'])
    expect(arcsForBearing(200)).toEqual(['AP'])
    expect(arcsForBearing(250)).toEqual(['PA'])
    expect(arcsForBearing(300)).toEqual(['PF'])
    expect(arcsForBearing(340)).toEqual(['FP'])
  })

  it('returns both arcs on a boundary so the player chooses (E2.2.5)', () => {
    expect(arcsForBearing(45)).toEqual(['FS', 'SF'])
    expect(arcsForBearing(0)).toEqual(['FP', 'FS'])
  })

  it('finds the arc a target sits in (E2.2.3)', () => {
    // Ship facing north (heading 0); target off the starboard bow.
    const arcs = arcTo({ x: 0, y: 0 }, 0, { x: 1, y: -3 })
    expect(arcs).toEqual(['FS'])
  })

  it('determines which shield an attack strikes (E2.2.4)', () => {
    // Attacker dead ahead of a north-facing target → forward shield.
    expect(shieldsFacing({ x: 0, y: -5 }, { x: 0, y: 0 }, 0)).toEqual(['F'])
    // Attacker due south of a north-facing target → aft shield.
    expect(shieldsFacing({ x: 0, y: 5 }, { x: 0, y: 0 }, 0)).toEqual(['A'])
    // Attacker due east of a north-facing target → starboard shield.
    expect(shieldsFacing({ x: 5, y: 0 }, { x: 0, y: 0 }, 0)).toEqual(['S'])
    // Attacker due west → port shield.
    expect(shieldsFacing({ x: -5, y: 0 }, { x: 0, y: 0 }, 0)).toEqual(['P'])
  })
})

describe('line of sight (E2.3, K3.1.3)', () => {
  const planet = { center: { x: 10, y: 0 }, radius: 3, blocksLos: true }

  it('is blocked by a planet between two ships', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 20, y: 0 }, [planet])).toBe(false)
  })

  it('is clear when the planet is off to one side', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 20, y: 0 }, [{ ...planet, center: { x: 10, y: 10 } }])).toBe(true)
  })

  it('is clear for a ship overlapping the planet — it passes over it (K3.1.3)', () => {
    expect(hasLineOfSight({ x: 10, y: 1 }, { x: 20, y: 0 }, [planet])).toBe(true)
  })
})

describe('maneuvers (C2, C3)', () => {
  const start = { position: { x: 0, y: 0 }, heading: 0 }

  it('moves forward at its speed (C2.1.2)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 'straight', direction: null, turnTemplate: 30 })
    expect(result.end.position.y).toBeCloseTo(-4)
    expect(result.end.heading).toBe(0)
    expect(result.stress).toBe(0)
  })

  it('performs a standard turn by moving then pivoting (C2.2.3)', () => {
    const result = applyManeuver({ start, speed: 3, maneuver: 'standard', direction: 'right', turnTemplate: 30 })
    expect(result.end.position.y).toBeCloseTo(-3)
    expect(result.end.heading).toBe(30)
    expect(result.stress).toBe(0)
  })

  it('uses the 20-degree template for easy turns regardless of turn rate (C2.3.2)', () => {
    const result = applyManeuver({ start, speed: 2, maneuver: 'easy', direction: 'left', turnTemplate: 45 })
    expect(result.end.heading).toBe(normalizeHeading(-20))
  })

  it('slides one inch perpendicular without changing facing (C2.4.2)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 'slide', direction: 'right', turnTemplate: 30 })
    expect(result.end.heading).toBe(0)
    expect(result.end.position.x).toBeCloseTo(1)
    expect(result.end.position.y).toBeCloseTo(-4)
  })

  it('rejects a slide at speed zero (C2.4.2)', () => {
    const result = applyManeuver({ start, speed: 0, maneuver: 'slide', direction: 'right', turnTemplate: 30 })
    expect(result.illegal).toBeDefined()
  })

  it('makes two same-direction turns for a hard turn and costs 1 stress (C3.2)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 'hard', direction: 'right', turnTemplate: 30 })
    expect(result.end.heading).toBe(60)
    expect(result.stress).toBe(1)
  })

  it('makes opposite turns for an S-turn, ending on the original heading (C3.3)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 's-turn', direction: 'left', turnTemplate: 30 })
    expect(result.end.heading).toBe(0)
    expect(result.stress).toBe(1)
  })

  it('turns once at the halfway point for a snap turn (C3.4)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 'snap', direction: 'right', turnTemplate: 30 })
    expect(result.end.heading).toBe(30)
    expect(result.stress).toBe(1)
  })

  it('pivots 90 degrees mid-move for an emergency turn (C3.5.6)', () => {
    const result = applyManeuver({ start, speed: 5, maneuver: 'em-90', direction: 'left', turnTemplate: 20 })
    expect(result.end.heading).toBe(270)
    // 2.5 inches north, then 2.5 inches west.
    expect(result.end.position.y).toBeCloseTo(-2.5)
    expect(result.end.position.x).toBeCloseTo(-2.5)
  })

  it('adds a second pivot for a 180-degree emergency turn (C3.5.7)', () => {
    const result = applyManeuver({ start, speed: 4, maneuver: 'em-180', direction: 'right', turnTemplate: 20 })
    expect(result.end.heading).toBe(180)
  })

  it('treats the stern as the bow in reverse (C3.7.2)', () => {
    const result = applyManeuver({ start, speed: -2, maneuver: 'straight', direction: null, turnTemplate: 30 })
    expect(result.end.position.y).toBeCloseTo(2)
    expect(result.end.heading).toBe(0)
  })

  it('falls back to straight movement when a turn is plotted at TURN 0 (C1.1.2)', () => {
    const result = applyManeuver({ start, speed: 6, maneuver: 'standard', direction: 'right', turnTemplate: 0 })
    expect(result.illegal).toBeDefined()
    expect(result.end.heading).toBe(0)
  })
})

describe('emergency turn stress (C3.5.8, C3.5.9)', () => {
  it('costs speed for a 90, never less than one', () => {
    expect(emergencyTurnStress('em-90', 0)).toBe(1)
    expect(emergencyTurnStress('em-90', 1)).toBe(1)
    expect(emergencyTurnStress('em-90', 5)).toBe(5)
  })

  it('costs twice speed for a 180, never less than two', () => {
    expect(emergencyTurnStress('em-180', 0)).toBe(2)
    expect(emergencyTurnStress('em-180', 3)).toBe(6)
  })
})
