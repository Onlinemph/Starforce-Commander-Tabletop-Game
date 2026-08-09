import { describe, expect, it } from 'vitest'
import { findShipForm } from '../data/ships'
import type { CustomScenario } from '../data/scenarios'
import {
  alreadyHaveScenario,
  checkScenarioPublishable,
  importedScenario,
  packageScenario,
  scenarioFingerprint,
  type ScenarioLibraryEntry,
} from './scenarioLibrary'
import { designFingerprint } from './shipLibrary'
import type { ShipForm } from './types'

/**
 * The shared scenario library.
 *
 * The scenario-specific stake: force lists are references, and a designed
 * scenario may field fan ships that exist only in its author's browser. What
 * is tested here is the packaging that keeps those references from dangling —
 * fan forms travel inside the entry under content-addressed ids, so the same
 * entry imports identically on every machine.
 */

const YORKTOWN = findShipForm('YORKTOWN I-class Heavy Cruiser')!
const CANON_ID = YORKTOWN.id

/** A fan design: real rules, local id — exactly what the builder produces. */
function fanDesign(localId: string): ShipForm {
  return { ...YORKTOWN, id: localId, name: 'YORKTOWN X-class Heavy Cruiser' }
}

function scenario(force: string[], name = 'Ambush at Karnath Station'): CustomScenario {
  return {
    id: 'scenario-local-draft',
    name,
    background: '',
    victory: 'Destruction.',
    bounds: { width: 36, height: 36, fixed: true },
    terrain: [],
    sides: [
      {
        side: 'Blue Force',
        objective: 'Win.',
        facing: 6,
        speed: 2,
        anchor: { x: 33, y: 18 },
        spread: { x: 0, y: 2 },
        force: [CANON_ID],
      },
      {
        side: 'Red Force',
        objective: 'Win.',
        facing: 2,
        speed: 2,
        anchor: { x: 3, y: 18 },
        spread: { x: 0, y: 2 },
        force,
      },
    ],
  }
}

describe('packaging a scenario for travel', () => {
  it('embeds fan ships under content-addressed ids and leaves canon ships alone', () => {
    const fan = fanDesign('custom-mine')
    const { pack, missing } = packageScenario(scenario(['custom-mine', CANON_ID]), [fan])
    expect(missing).toEqual([])
    const libId = `lib-${designFingerprint(fan)}`
    expect(pack.scenario.sides[1].force).toEqual([libId, CANON_ID])
    expect(pack.forms).toHaveLength(1)
    expect(pack.forms[0].id).toBe(libId)
  })

  it('embeds a ship fielded twice exactly once', () => {
    const fan = fanDesign('custom-mine')
    const { pack } = packageScenario(scenario(['custom-mine', 'custom-mine']), [fan])
    expect(pack.forms).toHaveLength(1)
    expect(pack.scenario.sides[1].force[0]).toBe(pack.scenario.sides[1].force[1])
  })

  it('reports a force id it cannot resolve instead of publishing a dangling one', () => {
    const { missing } = packageScenario(scenario(['custom-vanished']), [])
    expect(missing).toEqual(['custom-vanished'])
  })
})

describe('a scenario’s identity', () => {
  it('ignores the local draft id', () => {
    const fan = fanDesign('custom-mine')
    const a = packageScenario({ ...scenario(['custom-mine']), id: 'scenario-a' }, [fan]).pack
    const b = packageScenario({ ...scenario(['custom-mine']), id: 'scenario-b' }, [fan]).pack
    expect(scenarioFingerprint(a)).toBe(scenarioFingerprint(b))
  })

  it('is the same design on two machines whose fan ships carry different local ids', () => {
    // The whole point of the rewrite: author A built the ship as custom-mine,
    // author B imported the same rules as custom-ship-2 — the packaged
    // scenario hashes identically, so they land on one library entry.
    const a = packageScenario(scenario(['custom-mine']), [fanDesign('custom-mine')]).pack
    const b = packageScenario(scenario(['custom-ship-2']), [fanDesign('custom-ship-2')]).pack
    expect(scenarioFingerprint(a)).toBe(scenarioFingerprint(b))
  })

  it('changes when the battle changes, including a rename', () => {
    const base = scenarioFingerprint(packageScenario(scenario([CANON_ID]), []).pack)
    const renamed = scenarioFingerprint(
      packageScenario(scenario([CANON_ID], 'Ambush II'), []).pack,
    )
    const rearmed = scenarioFingerprint(
      packageScenario(scenario([CANON_ID, CANON_ID]), []).pack,
    )
    expect(renamed).not.toBe(base)
    expect(rearmed).not.toBe(base)
  })
})

describe('what may be published', () => {
  it('accepts a battle the engine can deal out', () => {
    const fan = fanDesign('custom-mine')
    const check = checkScenarioPublishable(scenario(['custom-mine']), [fan], 'me', 'fun')
    expect(check.ok).toBe(true)
    expect(check.sides).toBe(2)
    expect(check.hulls).toBe(2)
  })

  it('refuses the unnameable, the one-sided, the empty and the dangling', () => {
    const s = scenario([CANON_ID])
    expect(checkScenarioPublishable({ ...s, name: ' ' }, [], '', '').ok).toBe(false)
    expect(
      checkScenarioPublishable({ ...s, sides: s.sides.slice(0, 1) }, [], '', '').ok,
    ).toBe(false)
    expect(
      checkScenarioPublishable(
        { ...s, sides: [s.sides[0], { ...s.sides[1], force: [] }] },
        [],
        '',
        '',
      ).ok,
    ).toBe(false)
    const dangling = checkScenarioPublishable(scenario(['custom-vanished']), [], '', '')
    expect(dangling.ok).toBe(false)
    expect(dangling.refusal).toContain('custom-vanished')
    expect(checkScenarioPublishable(s, [], 'x'.repeat(41), '').ok).toBe(false)
  })
})

describe('importing an entry', () => {
  function entryFor(force: string[], roster: ShipForm[]): ScenarioLibraryEntry {
    const { pack } = packageScenario(scenario(force), roster)
    return {
      fingerprint: scenarioFingerprint(pack),
      scenario: pack.scenario,
      forms: pack.forms,
      author: 'someone',
      notes: '',
      sides: 2,
      hulls: 2,
      publishedAt: '2026-01-01T00:00:00Z',
      downloads: 0,
    }
  }

  it('lands under the same id on every machine, so battle files travel', () => {
    const entry = entryFor(['custom-mine'], [fanDesign('custom-mine')])
    const imported = importedScenario(entry)
    expect(imported.id).toBe(`scenario-lib-${entry.fingerprint}`)
    // The embedded forms' ids already match the rewritten force lists.
    expect(imported.sides[1].force[0]).toBe(entry.forms[0].id)
  })

  it('knows what a collection already holds', () => {
    const entry = entryFor([CANON_ID], [])
    expect(alreadyHaveScenario(entry, [])).toBe(false)
    expect(alreadyHaveScenario(entry, [importedScenario(entry)])).toBe(true)
  })
})
