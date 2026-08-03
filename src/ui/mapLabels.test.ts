import { describe, expect, it } from 'vitest'
import { LABEL_LINE, labelHalfWidth, stackLabels, type LabelBox } from './mapLabels'

/**
 * A squadron in formation is exactly when you most need to read the names, and
 * exactly when they used to print on top of each other. These are the rules
 * the layout follows.
 */

const box = (id: string, x: number, y: number, width = 60): LabelBox => ({
  id,
  x,
  y,
  halfWidth: width / 2,
})

describe('labels that have room', () => {
  it('sit where they were asked to', () => {
    const shifts = stackLabels([box('a', 0, 0), box('b', 300, 0), box('c', 600, 0)])
    expect(shifts).toEqual({ a: 0, b: 0, c: 0 })
  })

  it('leave labels alone when only their columns overlap', () => {
    const shifts = stackLabels([box('a', 0, 0), box('b', 0, 100)])
    expect(shifts.b).toBe(0)
  })
})

describe('labels that collide', () => {
  it('step the lower one down a line', () => {
    const shifts = stackLabels([box('a', 0, 0), box('b', 10, 2)])
    expect(shifts.a).toBe(0)
    expect(shifts.b).toBe(LABEL_LINE)
  })

  it('stacks a whole formation into readable lines', () => {
    const packed = ['a', 'b', 'c', 'd'].map((id, i) => box(id, i * 4, i))
    const shifts = stackLabels(packed)
    const rows = packed.map((b) => b.y + shifts[b.id]).sort((x, y) => x - y)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(LABEL_LINE)
    }
  })

  it('gives way top-down, so the northmost ship keeps its place', () => {
    const shifts = stackLabels([box('low', 0, 40), box('high', 0, 0)])
    expect(shifts.high).toBe(0)
    expect(shifts.low).toBe(0) // 40 apart: no clash at all
    const tight = stackLabels([box('low', 0, 6), box('high', 0, 0)])
    expect(tight.high).toBe(0)
    expect(tight.low).toBeGreaterThan(0)
  })

  it('gives up rather than pushing a label off the map', () => {
    const pile = Array.from({ length: 30 }, (_, i) => box(`s${i}`, 0, 0))
    const shifts = stackLabels(pile)
    expect(Math.max(...Object.values(shifts))).toBeLessThanOrEqual(LABEL_LINE * 6)
  })
})

describe('labels and hulls', () => {
  const hull = { x1: -20, x2: 20, y1: -20, y2: 20 }

  it('step past a counter rather than print across it', () => {
    const shifts = stackLabels([box('a', 0, 0)], [hull])
    expect(shifts.a).toBeGreaterThan(0)
    expect(shifts.a % LABEL_LINE).toBe(0)
    expect(shifts.a).toBeGreaterThanOrEqual(20)
  })

  it('ignore a counter they were never going to touch', () => {
    expect(stackLabels([box('a', 0, 100)], [hull]).a).toBe(0)
    expect(stackLabels([box('a', 500, 0)], [hull]).a).toBe(0)
  })
})

describe('the layout is stable', () => {
  it('returns the same answer whatever order the ships arrive in', () => {
    const boxes = [box('a', 0, 0), box('b', 8, 3), box('c', 4, 1)]
    const forward = stackLabels(boxes)
    const backward = stackLabels([...boxes].reverse())
    expect(backward).toEqual(forward)
  })
})

describe('width estimate', () => {
  it('grows with the name, so long names claim more room', () => {
    expect(labelHalfWidth('V.I.S. Karnath · spd 4')).toBeGreaterThan(labelHalfWidth('Hawk · spd 4'))
  })
})
