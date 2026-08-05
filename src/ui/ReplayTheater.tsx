import { useEffect, useMemo, useRef, useState } from 'react'
import { actionLabel, buildTimeline, replayPrefix } from '../data/replay'
import { parseSavedGame, type SavedGame } from '../data/savedGame'
import { applyAction } from '../engine/actions'
import { PHASE_LABELS, SEGMENT_LABELS, victoryPoints, type GameState } from '../engine/game'
import { fxAfter, fxBefore, type BattleFx } from './fx'
import { MapView } from './MapView'
import {
  canRecordVideo,
  DEFAULT_RECORD,
  estimateSeconds,
  recordMethod,
  recordReplay,
  videoExtension,
} from './replayVideo'

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
  const [recording, setRecording] = useState<{ done: number; total: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  /*
   * Skipping goes by moment rather than by round, because "the next thing that
   * happened" is what somebody reading a battle back actually wants. Round
   * starts are moments too, so this still walks the chapters — it just stops
   * at the volleys and the kills between them as well. In a squadron game
   * that is 56 stops out of 778 actions; by round it would be 7, and by
   * action it would be 778.
   */
  const marks = timeline.moments
  const prevMoment = () => jump([...marks].reverse().find((m) => m.index < index)?.index ?? 0)
  const nextMoment = () => jump(marks.find((m) => m.index > index)?.index ?? last)

  /**
   * The keys every other video player has. This is a tape deck, and reaching
   * for the mouse to step one action at a time is the wrong shape for reading
   * a battle back.
   *
   * Space is taken unconditionally and its default suppressed, because the
   * alternative is that it re-presses whichever transport button was clicked
   * last. The arrows are handed to a focused control first — the scrubber's
   * own arrow keys step it by one, which is the same thing, and a select
   * needs them to open.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (recording) return
      const el = document.activeElement
      const inControl =
        el instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          if (index >= last) setIndex(0)
          setPlaying((p) => !p)
          return
        case 'Escape':
          onClose()
          return
      }
      if (inControl) return

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          setPlaying(false)
          event.shiftKey ? prevMoment() : jump(index - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          setPlaying(false)
          event.shiftKey ? nextMoment() : jump(index + 1)
          break
        case 'Home':
          event.preventDefault()
          setPlaying(false)
          jump(0)
          break
        case 'End':
          event.preventDefault()
          setPlaying(false)
          jump(last)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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

  /**
   * Which steps the video should linger on. The same read the auto-play loop
   * uses: a step somebody narrates is a moment, everything else is
   * bookkeeping the recording can hurry past — which keeps the file shorter
   * *and* spends its length where there is something to watch.
   */
  const narrated = (index: number) => (timeline.frames[index]?.captions.length ?? 0) > 0
  const narratedCount = timeline.frames.filter((f) => f.captions.length > 0).length

  /**
   * Record the battle as a video file. The theater owns the playhead, so it
   * drives: set the step, let React paint it, and let the recorder film the
   * map for as long as the step is held. Two animation frames is the reliable
   * "it is on screen now" — one schedules the paint, the second lands after
   * it — and the recorder takes it from there, sampling the glide and the
   * gunfire as they happen rather than snapshotting the end of them.
   */
  const exportVideo = async () => {
    if (recording) {
      abortRef.current?.abort()
      return
    }
    setPlaying(false)
    setNote(null)
    const controller = new AbortController()
    abortRef.current = controller
    setRecording({ done: 0, total: last })
    try {
      const blob = await recordReplay(
        () => stageRef.current?.querySelector('svg') ?? null,
        last,
        async (step) => {
          setIndex(step)
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        },
        {
          ...DEFAULT_RECORD,
          narrated,
          signal: controller.signal,
          onProgress: (done, total) => setRecording({ done, total }),
        },
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `starforce-replay.${videoExtension()}`
      link.click()
      URL.revokeObjectURL(url)
      setNote(controller.signal.aborted ? 'Recording stopped — the part captured was saved.' : 'Video saved.')
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'The recording failed.')
    } finally {
      abortRef.current = null
      setRecording(null)
    }
  }

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
          {canRecordVideo() && (
            <button
              type="button"
              className={recording ? 'chip is-on' : 'chip'}
              onClick={() => void exportVideo()}
              title={
                recording
                  ? 'Stop recording and save what has been captured'
                  : `Record the whole replay as a video file — about ${estimateSeconds(
                      narratedCount,
                      last - narratedCount,
                    )} seconds, filmed in real time. The map is held on the whole board while it records.${
                      recordMethod() === 'tab'
                        ? ' Your browser will ask permission to film this tab; decline and it will draw the frames itself instead.'
                        : ''
                    }`
              }
            >
              {recording
                ? `Recording ${recording.done}/${recording.total} — stop`
                : '⏺ Export video'}
            </button>
          )}
          {note && <span className="hint">{note}</span>}
          <button type="button" onClick={onClose} aria-label="Close" disabled={recording !== null}>
            ✕
          </button>
        </header>

        <div className="theater-body">
          <div className="theater-stage" ref={stageRef}>
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
              viewLock={recording !== null}
            />

            <div className="theater-controls">
              <button type="button" onClick={() => jump(0)} title="Back to deployment" aria-label="Start">
                ⏮
              </button>
              <button
                type="button"
                onClick={prevMoment}
                title="Back to the previous moment — a volley, a kill, or the start of a round"
                aria-label="Previous moment"
              >
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
              <button
                type="button"
                onClick={nextMoment}
                title="On to the next moment — a volley, a kill, or the start of a round"
                aria-label="Next moment"
              >
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
                {/* Every moment gets a mark, and the mark says which kind it
                    was — so the shape of the battle is legible before you
                    press anything: where the shooting started, where a ship
                    died, where the rounds fell. */}
                <div className="theater-ticks" aria-hidden="true">
                  {marks.map((m) => (
                    <i
                      key={m.index}
                      className={`tick-${m.kind}`}
                      title={m.text}
                      style={{ left: `${(m.index / Math.max(1, last)) * 100}%` }}
                    />
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

            {/* A shortcut nobody is told about is not a shortcut. */}
            <p className="theater-keys">
              <kbd>space</kbd> play · <kbd>←</kbd>
              <kbd>→</kbd> step · <kbd>shift</kbd>+<kbd>←</kbd>
              <kbd>→</kbd> moment · <kbd>home</kbd>
              <kbd>end</kbd> ends · <kbd>esc</kbd> close
            </p>
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
