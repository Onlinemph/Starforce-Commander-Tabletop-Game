import { describe, expect, it } from 'vitest'
import { applyAction, type GameAction } from '../engine/actions'
import { aiNextActions, createAiMemo } from '../engine/ai'
import { activeShips } from '../engine/game'
import { actionLabel, buildTimeline, replayPrefix } from './replay'
import { buildGame, type SavedGame } from './savedGame'

/**
 * The replay theater's contract: a timeline built in one pass tells the same
 * story as the journal it came from, and any prefix of it is the exact game
 * that stood at that moment.
 */

/** A real battle, fought by the AI, as the file a player would save. */
function foughtBattle(seed: number, rounds = 4): SavedGame {
  const setup = { scenarioId: 's3.1-the-duel', seed }
  const game = buildGame(setup)
  const actions: GameAction[] = []
  const memo = createAiMemo()
  const sides = ['Blue Force', 'Red Force']
  const drive = (closing: boolean) => {
    for (let guard = 0; guard < 300; guard++) {
      const batch = aiNextActions(game, sides, memo, closing)
      if (batch.length === 0) return
      for (const action of batch) {
        applyAction(game, action)
        actions.push(action)
      }
      closing = false
    }
    throw new Error('driver did not settle')
  }
  drive(false)
  for (let steps = 0; steps < 200; steps++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    actions.push({ type: 'advance-segment' })
    drive(false)
  }
  return { version: 1, setup, actions }
}

describe('replay timeline', () => {
  const saved = foughtBattle(42)

  it('has one frame per action plus the opening, rounds never running backwards', () => {
    const { frames, roundStarts } = buildTimeline(saved)
    expect(frames).toHaveLength(saved.actions.length + 1)
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].round).toBeGreaterThanOrEqual(frames[i - 1].round)
      expect(frames[i].action).toBe(saved.actions[i - 1])
    }
    // Chapter marks are exactly the frames where the round changes.
    const changes = frames.filter((f, i) => i > 0 && f.round !== frames[i - 1].round)
    expect(roundStarts).toEqual(changes.map((f) => f.index))
    expect(roundStarts.length).toBeGreaterThan(0)
  })

  it('narrates with the engine log, nothing lost and nothing invented', () => {
    const { frames } = buildTimeline(saved)
    const narrated = frames.flatMap((f) => f.captions)
    const finished = replayPrefix(saved, saved.actions.length)
    expect(narrated).toEqual(finished.log.map((e) => e.message))
    // A battle produces narration — volleys, damage, the round turning over.
    expect(narrated.length).toBeGreaterThan(0)
  })

  it('any prefix is the exact game at that moment', () => {
    const mid = Math.floor(saved.actions.length / 2)
    const atMid = replayPrefix(saved, mid)
    for (const action of saved.actions.slice(mid)) applyAction(atMid, action)
    const full = replayPrefix(saved, saved.actions.length)
    expect(JSON.stringify(atMid.ships.map((s) => s.placement))).toBe(
      JSON.stringify(full.ships.map((s) => s.placement)),
    )
    expect(atMid.round).toBe(full.round)
    expect(atMid.log.length).toBe(full.log.length)
  })

  it('frame zero is the untouched deployment, owning the setup narration', () => {
    const opening = replayPrefix(saved, 0)
    expect(opening.round).toBe(1)
    const { frames } = buildTimeline(saved)
    expect(frames[0].captions).toEqual(opening.log.map((e) => e.message))
  })

  /*
   * The moments are what make a replay watchable: a squadron battle is 778
   * actions and about 56 of them are worth stopping at. They are read off the
   * engine's own log lines, which is a coupling worth a test — reword "is
   * destroyed" in the engine and the kill marks quietly vanish from the bar.
   */
  describe('the moments worth stopping at', () => {
    it('finds far fewer moments than there are actions', () => {
      const timeline = buildTimeline(saved)
      expect(timeline.moments.length).toBeGreaterThan(0)
      expect(timeline.moments.length).toBeLessThan(saved.actions.length / 3)
    })

    it('marks every round start as a moment', () => {
      const timeline = buildTimeline(saved)
      for (const start of timeline.roundStarts) {
        expect(timeline.moments.some((m) => m.index === start)).toBe(true)
      }
    })

    it('finds the volleys, and they are real fire', () => {
      const timeline = buildTimeline(saved)
      const volleys = timeline.moments.filter((m) => m.kind === 'volley')
      expect(volleys.length).toBeGreaterThan(0)
      for (const v of volleys) expect(v.text).toMatch(/ fires on /)
    })

    it('keeps the moments in order and inside the journal', () => {
      const timeline = buildTimeline(saved)
      let previous = -1
      for (const m of timeline.moments) {
        expect(m.index).toBeGreaterThan(previous)
        expect(m.index).toBeLessThanOrEqual(saved.actions.length)
        previous = m.index
      }
    })

    it('records one moment per frame, keeping the loudest', () => {
      const timeline = buildTimeline(saved)
      const seen = new Set<number>()
      for (const m of timeline.moments) {
        expect(seen.has(m.index)).toBe(false)
        seen.add(m.index)
      }
      // And a frame the timeline calls a kill is a kill in its captions.
      for (const m of timeline.moments.filter((x) => x.kind === 'kill')) {
        expect(timeline.frames[m.index].captions.join(' ')).toMatch(/destroyed|comes apart/)
      }
    })

    it('agrees with the frames about which are moments', () => {
      const timeline = buildTimeline(saved)
      const flagged = timeline.frames.filter((f) => f.moment !== undefined).map((f) => f.index)
      expect(flagged).toEqual(timeline.moments.map((m) => m.index))
    })
  })

  it('quiet actions still get a readable label', () => {
    expect(actionLabel({ type: 'advance-segment' })).toBe('Advance segment')
  })
})
