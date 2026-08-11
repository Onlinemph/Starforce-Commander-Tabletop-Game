import { describe, expect, it } from 'vitest'
import { firstConfigured, inMatch, looksLikeSupabase, timeAgo, type OnlineState } from './online'
import { dispatch, enableReadyGate, getGame, newGame, waitingSides } from './store'

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

/**
 * The pre-filled match service comes from build variables, and CI hands over
 * an empty string for every repository variable nobody set. Falling back with
 * `??` treats that empty string as a real answer — which is precisely how a
 * configured Supabase project stopped reaching the panel.
 */
describe('choosing a configured value', () => {
  it('skips empty and whitespace-only build variables', () => {
    expect(firstConfigured('', 'https://x.supabase.co')).toBe('https://x.supabase.co')
    expect(firstConfigured('   ', 'https://x.supabase.co')).toBe('https://x.supabase.co')
    expect(firstConfigured(undefined, 'https://x.supabase.co')).toBe('https://x.supabase.co')
  })

  it('takes the first real value and trims it', () => {
    expect(firstConfigured('  https://a.supabase.co  ', 'https://b.supabase.co')).toBe(
      'https://a.supabase.co',
    )
  })

  it('is empty when nothing was configured at all', () => {
    expect(firstConfigured(undefined, '', '   ')).toBe('')
  })
})

/**
 * The match browser's "whose move is it" line: what a correspondence player
 * scans the list for, so both halves — the waiting set and the clock — are
 * worth pinning.
 */
describe('whose move it is', () => {
  it('names the sides the ready gate still waits on', () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    enableReadyGate()
    expect(waitingSides().sort()).toEqual(['Blue Force', 'Red Force'])
    dispatch({ type: 'signal-ready', side: 'Blue Force', ready: true })
    expect(waitingSides()).toEqual(['Red Force'])
  })

  it('names the side a staged volley waits on for its damage answers', () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    enableReadyGate()
    dispatch({
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: getGame().ships[0].id },
      choices: [],
      awaiting: 'Blue Force',
    })
    expect(waitingSides()).toEqual(['Blue Force'])
  })

  it('says nothing outside a gated battle', () => {
    newGame({ scenarioId: 's3.1-the-duel', seed: 5 })
    expect(waitingSides()).toEqual([])
  })

  it('turns a timestamp into a waiting time a human reads at a glance', () => {
    const now = Date.parse('2026-08-11T12:00:00Z')
    expect(timeAgo('2026-08-11T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-08-11T11:45:00Z', now)).toBe('15m ago')
    expect(timeAgo('2026-08-11T07:00:00Z', now)).toBe('5h ago')
    expect(timeAgo('2026-08-08T12:00:00Z', now)).toBe('3d ago')
    expect(timeAgo('not a date', now)).toBe('')
  })
})
