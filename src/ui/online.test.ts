import { describe, expect, it } from 'vitest'
import { looksLikeSupabase } from './online'

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
