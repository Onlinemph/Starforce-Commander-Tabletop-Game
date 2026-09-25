import { describe, expect, it } from 'vitest'
import { hashId, rockCountFor, terrainLabelText } from './terrain'

describe('hashId', () => {
  it('is deterministic for the same id', () => {
    expect(hashId('asteroid-3')).toBe(hashId('asteroid-3'))
  })

  it('tells different ids apart', () => {
    expect(hashId('asteroid-3')).not.toBe(hashId('asteroid-4'))
  })
})

describe('rockCountFor', () => {
  it('scales up with density at the same radius', () => {
    const light = rockCountFor(4, 'light')
    const extreme = rockCountFor(4, 'extreme')
    expect(extreme).toBeGreaterThan(light)
  })

  it('scales up with area at the same density', () => {
    const small = rockCountFor(2, 'medium')
    const large = rockCountFor(6, 'medium')
    expect(large).toBeGreaterThan(small)
  })

  it('never drops below the floor or above the cap, however small or huge the field', () => {
    expect(rockCountFor(0.1, 'light')).toBeGreaterThanOrEqual(14)
    expect(rockCountFor(200, 'extreme')).toBeLessThanOrEqual(220)
  })
})

describe('terrainLabelText', () => {
  it('is just the name for a world', () => {
    expect(terrainLabelText({ kind: 'planet', name: 'Colony world' })).toBe('Colony world')
  })

  it('appends the safe speed for an asteroid field that has one', () => {
    expect(terrainLabelText({ kind: 'asteroid-field', name: 'Asteroids #3', safeSpeed: 3 })).toBe('Asteroids #3 · SPD 3')
  })

  it('drops the speed suffix when an asteroid field has none', () => {
    expect(terrainLabelText({ kind: 'asteroid-field', name: 'Asteroids #3' })).toBe('Asteroids #3')
  })
})
