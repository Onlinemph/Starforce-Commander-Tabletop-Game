import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { logEntryVisible, type LogEntry } from './game'

/**
 * The battle log keeps Resource Allocation's secrets (B1.9).
 *
 * The log is engine state, identical on every console — replays depend on it —
 * so secrecy is a rendering rule: entries a side's plan produced are tagged
 * with that side, and `logEntryVisible` is the one predicate every surface
 * that shows the log shares (the panel, the compact line, the report export).
 * Playtest report 1 is what shipped without this: both fleets' arming and
 * shield reinforcement interleaved in a shared log, each side reading the
 * other's plan before finishing its own.
 */

const entry = (side: string | undefined, round = 2): LogEntry => ({
  round,
  phase: 'combat-1',
  segment: 'resource-allocation',
  message: 'x',
  ...(side ? { side } : {}),
})

describe('who may read a log line, and when', () => {
  it('shows public lines to everyone', () => {
    expect(logEntryVisible(entry(undefined), 'Blue Force', 2)).toBe(true)
    expect(logEntryVisible(entry(undefined), null, 2)).toBe(true)
  })

  it('keeps a private line to its own side while the round runs', () => {
    expect(logEntryVisible(entry('Blue Force'), 'Blue Force', 2)).toBe(true)
    expect(logEntryVisible(entry('Blue Force'), 'Red Force', 2)).toBe(false)
  })

  it('reveals everything when the round ends (B1.9.2)', () => {
    expect(logEntryVisible(entry('Blue Force', 2), 'Red Force', 3)).toBe(true)
  })

  it('hides nothing from a console with no side — solo, hot-seat, the theater', () => {
    expect(logEntryVisible(entry('Blue Force'), null, 2)).toBe(true)
  })
})

describe('the plan-revealing lines carry their side', () => {
  it('tags what the allocation commit announces — the exact lines report 1 leaked', () => {
    const game = startScenario('s3.1-the-duel', { seed: 9 })
    const ship = game.ships[0]
    // Reinforce a shield, then let the Resource Allocation Segment close and
    // commit it — the same path that wrote "F shield reinforced by 3" into
    // the shared log of playtest report 1.
    const line = ship.form.functions.find((l) => l.kind === 'shield-reinforce')
    expect(line).toBeDefined()
    expect(applyAction(game, { type: 'allocate', shipId: ship.id, lineId: line!.id, circles: 1 }).message).toBeNull()
    applyAction(game, { type: 'advance-segment' })
    const reinforced = game.log.find((e) => /reinforced by/.test(e.message) && e.message.startsWith(ship.name))
    expect(reinforced, 'the commit should have announced the reinforcement').toBeDefined()
    expect(reinforced!.side).toBe(ship.side)
  })
})
