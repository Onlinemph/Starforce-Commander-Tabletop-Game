import { describe, expect, it } from 'vitest'
import { inMatch, looksLikeSupabase, type OnlineState } from './online'

/**
 * The match layer speaks to two backends — a Supabase project or a deployed
 * Worker service — and picks by the address it was given. Everything else
 * about a match (the ledger, the invite link, the reconnection) is the same
 * either way, so this one decision is worth pinning down.
 */

describe('choosing a backend by address', () => {
  it('recognises a Supabase project', () => {
    expect(looksLikeSupabase('https://abcdefgh.supabase.co')).toBe(true)
    expect(looksLikeSupabase('https://abcdefgh.supabase.co/')).toBe(true)
    expect(looksLikeSupabase('HTTPS://ABCDEFGH.SUPABASE.CO')).toBe(true)
    expect(looksLikeSupabase('https://db.supabase.in')).toBe(true)
  })

  it('leaves a Worker match service alone', () => {
    expect(looksLikeSupabase('sfc-matches.someone.workers.dev')).toBe(false)
    expect(looksLikeSupabase('https://sfc-matches.someone.workers.dev')).toBe(false)
    expect(looksLikeSupabase('http://localhost:8787')).toBe(false)
    expect(looksLikeSupabase('')).toBe(false)
  })
})

/**
 * Enrolment is what stands the setup controls down and pins a commander to
 * their own chair, so its boundaries are worth being exact about: a match
 * being reconnected is still a match, and a failed one is not.
 */
describe('being in a match', () => {
  const state = (over: Partial<OnlineState>): OnlineState => ({
    phase: 'idle',
    server: '',
    matchId: null,
    matchName: null,
    side: null,
    sides: [],
    present: [],
    creator: false,
    error: null,
    ...over,
  })

  it('holds while connected, connecting or reconnecting', () => {
    for (const phase of ['connected', 'connecting', 'reconnecting'] as const) {
      expect(inMatch(state({ phase, matchId: 'ABCD1234' }))).toBe(true)
    }
  })

  it('does not hold with no match, or once one has failed', () => {
    expect(inMatch(state({ phase: 'idle' }))).toBe(false)
    expect(inMatch(state({ phase: 'failed', matchId: 'ABCD1234' }))).toBe(false)
    expect(inMatch(state({ phase: 'connected', matchId: null }))).toBe(false)
  })
})
