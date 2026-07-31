import { useEffect, useMemo, useRef, useState } from 'react'
import { actionLabel, buildTimeline, replayPrefix } from '../data/replay'
import { parseSavedGame, type SavedGame } from '../data/savedGame'
import { applyAction } from '../engine/actions'
import { PHASE_LABELS, SEGMENT_LABELS, victoryPoints, type GameState } from '../engine/game'
import { fxAfter, fxBefore, type BattleFx } from './fx'
import { MapView } from './MapView'

/**
 * The replay theater: any battle file, scrubbed like a tape.
 *
 * Nothing here is recorded beyond what every save already holds. A battle is
 * (setup + actions) and the engine is deterministic, so the game at any point
 * of the timeline is recomputed on demand — stepping forward applies one
 * action to the cached state, scrubbing rebuilds the prefix, and both land on
 * exactly the moment the table saw, dice included. The narration is the
 * engine's own log, surfaced as each action lands.
 */

interface Props {
  /** The battle the theater opens on — usually the one being played. */
  initial: SavedGame
  onClose: () => void
}

const SPEEDS = [
  { label: 'Slow', ms: 1600 },
  { label: 'Normal', ms: 800 },
  { label: 'Fast', ms: 300 },
]

export function ReplayTheater({ initial, onClose }: Props) {
  const [saved, setSaved] = useState<SavedGame>(initial)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const timeline = useMemo(() => buildTimeline(saved), [saved])
  const last = saved.actions.length

  /**
   * The state at the playhead. Stepping forward — the overwhelmingly common
   * case while playing — applies one action to the cached game; any other
   * jump replays the prefix, which is the undo mechanism doing a new job.
   */
  const cache = useRef<{ saved: SavedGame; index: number; game: GameState } | null>(null)
  // Weapon fire replays too: stepping through a volley derives the same
  // effects the live table showed, kept briefly so bursts overlap naturally.
  const fxRef = useRef<Array<BattleFx & { born: number }>>([])
  const game = useMemo(() => {
    const c = cache.current
    if (c && c.saved === saved) {
      if (c.index === index) return c.game
      if (index === c.index + 1) {
        const action = saved.actions[c.index]
        const pre = fxBefore(c.game, action)
        const outcome = applyAction(c.game, action)
        const born = Date.now()
        fxRef.current = [
          ...fxRef.current.filter((f) => born - f.born < 4500),
          ...[...pre, ...fxAfter(c.game, action, outcome)].map((f) => ({ ...f, born })),
        ]
        cache.current = { saved, index, game: c.game }
        return c.game
      }
    }
    fxRef.current = []
    const rebuilt = replayPrefix(saved, index)
    cache.current = { saved, index, game: rebuilt }
    return rebuilt
  }, [saved, index])

  const frame = timeline.frames[index]

  /** Auto-play: quiet bookkeeping hurries past, narrated moments hold. */
  useEffect(() => {
    if (!playing) return
    if (index >= last) {
      setPlaying(false)
      return
    }
    const base = SPEEDS[speed].ms
    const nextFrame = timeline.frames[index + 1]
    const hold = nextFrame.captions.length > 0 ? base : base / 4
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), hold)
    return () => clearTimeout(timer)
  }, [playing, index, last, speed, timeline])

  const jump = (to: number) => setIndex(Math.max(0, Math.min(last, to)))
  const prevRound = () => jump([...timeline.roundStarts].reverse().find((r) => r < index) ?? 0)
  const nextRound = () => jump(timeline.roundStarts.find((r) => r > index) ?? last)

  /** The narration feed: everything said so far, newest at the bottom. */
  const feed = useMemo(
    () =>
      timeline.frames
        .slice(0, index + 1)
        .flatMap((f, fi) => f.captions.map((text) => ({ text, current: fi === index }))),
    [timeline, index],
  )
  const feedRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [feed.length])

  const load = async (file: File) => {
    const parsed = parseSavedGame(await file.text())
    if (typeof parsed === 'string') {
      setNote(parsed)
      return
    }
    setSaved(parsed)
    setIndex(0)
    setPlaying(false)
    setSelectedId(null)
    setNote(null)
  }

  const points = victoryPoints(game)

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Replay theater">
      <div className="picker theater">
        <header>
          <h2>Replay theater</h2>
          <span className="theater-title">{game.scenario.name}</span>
          <label className="chip file-chip" title="Watch any saved battle file">
            Load file
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void load(file)
                e.target.value = ''
              }}
            />
          </label>
          {note && <span className="hint">{note}</span>}
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="theater-body">
          <div className="theater-stage">
            <div className="theater-status">
              <strong>Round {frame.round}</strong>
              <span>{PHASE_LABELS[frame.phase]}</span>
              <span>{SEGMENT_LABELS[frame.segment]}</span>
              <span className="theater-counter">
                {index} / {last}
              </span>
              {Object.entries(points).map(([side, vp]) => (
                <span key={side} className="theater-score">
                  {side}: {vp} VP
                </span>
              ))}
            </div>

            <MapView
              game={game}
              selectedId={selectedId}
              targetId={null}
              onSelect={setSelectedId}
              showArcs={false}
              rangeRings={[]}
              viewSide={null}
              rulerMode={false}
              fx={fxRef.current}
            />

            <div className="theater-controls">
              <button type="button" onClick={() => jump(0)} title="Back to deployment" aria-label="Start">
                ⏮
              </button>
              <button type="button" onClick={prevRound} title="Previous round" aria-label="Previous round">
                ◀◀
              </button>
              <button type="button" onClick={() => jump(index - 1)} title="Step back one action" aria-label="Step back">
                ◀
              </button>
              <button
                type="button"
                className="primary theater-play"
                onClick={() => {
                  if (index >= last) setIndex(0)
                  setPlaying((p) => !p)
                }}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button type="button" onClick={() => jump(index + 1)} title="Step one action" aria-label="Step forward">
                ▶
              </button>
              <button type="button" onClick={nextRound} title="Next round" aria-label="Next round">
                ▶▶
              </button>
              <button type="button" onClick={() => jump(last)} title="Jump to the end" aria-label="End">
                ⏭
              </button>

              <div className="theater-scrub">
                <input
                  type="range"
                  min={0}
                  max={last}
                  value={index}
                  onChange={(e) => {
                    setPlaying(false)
                    jump(Number(e.target.value))
                  }}
                  aria-label="Timeline"
                />
                <div className="theater-ticks" aria-hidden="true">
                  {timeline.roundStarts.map((r) => (
                    <i key={r} style={{ left: `${(r / Math.max(1, last)) * 100}%` }} />
                  ))}
                </div>
              </div>

              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Playback speed"
                title="Playback speed — quiet bookkeeping is skipped through at any speed"
              >
                {SPEEDS.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <aside className="theater-narration">
            <h3>Narration</h3>
            <ol ref={feedRef}>
              {feed.length === 0 && <li className="quiet">The fleets deploy…</li>}
              {feed.map((entry, i) => (
                <li key={i} className={entry.current ? 'is-current' : ''}>
                  {entry.text}
                </li>
              ))}
              {frame.action && frame.captions.length === 0 && (
                <li className="quiet is-current">{actionLabel(frame.action)}</li>
              )}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  )
}
