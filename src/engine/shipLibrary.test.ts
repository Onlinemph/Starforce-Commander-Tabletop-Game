import { describe, expect, it } from 'vitest'
import { findShipForm, isCanonForm } from '../data/ships'
import {
  alreadyHave,
  checkPublishable,
  designFingerprint,
  importedForm,
  libraryFaction,
  LIBRARY_FACTIONS,
  MAX_AUTHOR_CHARS,
  MAX_NOTES_CHARS,
  type LibraryEntry,
} from './shipLibrary'
import type { ShipForm } from './types'

/**
 * The shared ship library.
 *
 * The load-bearing idea is that an entry is addressed by the design's own
 * content, because a battle save embeds the whole form and must go on replaying
 * the same way forever. Editing an entry in place would rewrite history; making
 * a new entry does not.
 */

const YORKTOWN = findShipForm('YORKTOWN IIIc-class Command Cruiser')!
const PASSER = findShipForm('PASSER I-class Frigate')!

function entryFor(form: ShipForm): LibraryEntry {
  return {
    fingerprint: designFingerprint(form),
    form,
    author: 'someone',
    notes: '',
    points: 0,
    faction: form.faction ?? 'Custom',
    sizeClass: form.sizeClass,
    publishedAt: '2026-01-01T00:00:00Z',
    downloads: 0,
  }
}

describe('a design’s identity', () => {
  it('is the same for the same ship built twice under different ids', () => {
    const a = { ...YORKTOWN, id: 'mine' }
    const b = { ...YORKTOWN, id: 'yours' }
    expect(designFingerprint(a)).toBe(designFingerprint(b))
  })

  it('ignores the order the fields happened to be written in', () => {
    const forward = { ...YORKTOWN }
    const shuffled = Object.fromEntries(
      Object.entries(YORKTOWN).reverse(),
    ) as unknown as ShipForm
    expect(designFingerprint(shuffled)).toBe(designFingerprint(forward))
  })

  it('changes when anything about the ship changes', () => {
    const base = designFingerprint(YORKTOWN)
    expect(designFingerprint({ ...YORKTOWN, sizeClass: 9 })).not.toBe(base)
    expect(
      designFingerprint({
        ...YORKTOWN,
        sublight: { ...YORKTOWN.sublight, maxSpeed: 3 },
      }),
    ).not.toBe(base)
  })

  it('changes when the ship is renamed, because the name is on the counter', () => {
    expect(designFingerprint({ ...YORKTOWN, name: 'Something Else' })).not.toBe(
      designFingerprint(YORKTOWN),
    )
  })

  it('tells two different hulls apart', () => {
    expect(designFingerprint(YORKTOWN)).not.toBe(designFingerprint(PASSER))
  })
})

describe('what may be published', () => {
  it('accepts a printed ship, and prices it', () => {
    const check = checkPublishable(YORKTOWN, 'me', 'a solid command cruiser')
    expect(check.ok).toBe(true)
    expect(check.refusal).toBeNull()
    expect(check.points).toBeGreaterThan(0)
  })

  it('refuses a design the engine could not field', () => {
    // E8.5.4 wants one damaged-speed entry per drive box; this has none.
    const broken: ShipForm = {
      ...YORKTOWN,
      sublight: { ...YORKTOWN.sublight, dmgTopSpeed: [] },
    }
    const check = checkPublishable(broken, '', '')
    expect(check.ok).toBe(false)
    expect(check.refusal).toMatch(/could not field/)
  })

  it('refuses a nameless design', () => {
    expect(checkPublishable({ ...YORKTOWN, name: '  ' }, '', '').refusal).toMatch(/needs a name/)
  })

  it('caps the free text rather than letting it into the browser', () => {
    expect(checkPublishable(YORKTOWN, 'x'.repeat(MAX_AUTHOR_CHARS + 1), '').refusal).toMatch(
      /Author names/,
    )
    expect(checkPublishable(YORKTOWN, '', 'x'.repeat(MAX_NOTES_CHARS + 1)).refusal).toMatch(
      /Notes are limited/,
    )
  })

  it('never refuses a design for being expensive', () => {
    // Cost is recorded so the browser can sort by it. An expensive ship is a
    // legal ship; the fleet picker is what enforces a budget.
    const heavy: ShipForm = { ...YORKTOWN, name: 'Overgunned' }
    const check = checkPublishable(heavy, '', '')
    expect(check.ok).toBe(true)
    expect(check.points).toBeGreaterThan(0)
  })
})

describe('faction tags', () => {
  it('keeps a design under a canon flag it declares', () => {
    expect(libraryFaction(YORKTOWN)).toBe('Union of Federated Systems')
    expect(libraryFaction(PASSER)).toBe('Aurelian Empire')
  })

  it('files anything else as Independent rather than inventing a tag', () => {
    expect(libraryFaction({ ...YORKTOWN, faction: 'Somebody’s Homebrew' })).toBe('Independent')
    expect(libraryFaction({ ...YORKTOWN, faction: '' })).toBe('Independent')
  })

  it('offers exactly the three printed factions plus the escape hatch', () => {
    expect(LIBRARY_FACTIONS).toEqual([
      'Union of Federated Systems',
      'Vallari Imperium',
      'Aurelian Empire',
      'Independent',
    ])
  })
})

describe('canon and fan are told apart by identity, not by flag', () => {
  it('knows a printed ship', () => {
    expect(isCanonForm(YORKTOWN.id)).toBe(true)
    expect(isCanonForm(PASSER.id)).toBe(true)
  })

  /*
   * The point of the whole exercise: a fan design is free to fly a canon flag
   * — a Union cruiser somebody built is *meant* to be fielded beside the
   * printed ones — so the flag cannot be what separates them. Identity is.
   */
  it('does not mistake a fan design for canon just because it claims the flag', () => {
    const impostor: ShipForm = {
      ...YORKTOWN,
      id: 'lib-deadbeefdeadbeef',
      name: 'U.S.S. Definitely Official',
      faction: 'Union of Federated Systems',
    }
    expect(libraryFaction(impostor)).toBe('Union of Federated Systems')
    expect(isCanonForm(impostor.id)).toBe(false)
  })

  it('treats an imported library design as non-canon', () => {
    expect(isCanonForm(importedForm(entryFor(YORKTOWN)).id)).toBe(false)
  })
})

describe('taking a copy', () => {
  it('gives the imported design an id of its own, keeping the rules identical', () => {
    const entry = entryFor(YORKTOWN)
    const mine = importedForm(entry)
    expect(mine.id).toBe(`lib-${entry.fingerprint}`)
    expect(mine.id).not.toBe(YORKTOWN.id)
    // Same ship, so the same fingerprint — the id is bookkeeping, not rules.
    expect(designFingerprint(mine)).toBe(entry.fingerprint)
  })

  it('notices a design already in the roster even under a different id', () => {
    const entry = entryFor(YORKTOWN)
    expect(alreadyHave(entry, [PASSER])).toBe(false)
    expect(alreadyHave(entry, [{ ...YORKTOWN, id: 'renamed-locally' }])).toBe(true)
  })

  it('does not confuse a renamed local copy for the same design', () => {
    const entry = entryFor(YORKTOWN)
    expect(alreadyHave(entry, [{ ...YORKTOWN, name: 'My Version' }])).toBe(false)
  })
})
