/**
 * The optional 3D battle view: a drop-in for MapView, taking the same props.
 *
 * It is loaded lazily (see Map3DSwitch in App), so a player who never opens
 * it never downloads three.js. Everything it shows is a reading of the same
 * GameState the 2D map reads; everything it can do — select a hull, measure
 * with the ruler — goes back through the same callbacks. The rules do not
 * know or care which view is on screen.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../../engine/game'
import type { BattleFx } from '../fx'
import type { RangeRing } from '../MapView'
import { BattleScene, type CameraPreset } from './BattleScene'
import './three.css'

export interface BattleView3DProps {
  game: GameState
  selectedId: string | null
  targetId: string | null
  onSelect: (id: string) => void
  showArcs: boolean
  rangeRings: RangeRing[]
  viewSide: string | null
  rulerMode: boolean
  fx?: BattleFx[]
  /** Asked to go back to the flat map (WebGL missing, or the player's choice). */
  onExit?: () => void
}

/** Whether this browser can draw WebGL at all. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export default function BattleView3D({
  game,
  selectedId,
  targetId,
  onSelect,
  showArcs,
  rangeRings,
  viewSide,
  rulerMode,
  fx = [],
  onExit,
}: BattleView3DProps) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<BattleScene | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [hover, setHover] = useState<{ text: string; at: { x: number; y: number } } | null>(null)
  const [ruler, setRuler] = useState<{ inches: number } | null>(null)
  const [preset, setPreset] = useState<CameraPreset>('tilt')
  const [follow, setFollow] = useState(false)
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    if (!host.current) return
    if (!webglAvailable()) {
      setFailed('This browser cannot draw WebGL, which the 3D view needs.')
      return
    }
    try {
      scene.current = new BattleScene(host.current, {
        onSelect: (id) => select.current(id),
        onHover: (text, at) => setHover(text && at ? { text, at } : null),
        onRuler: (reading) => setRuler(reading ? { inches: reading.inches } : null),
      })
      // A handle for the screenshot tests and for poking at the scene from
      // the console while developing. Never in a production build.
      if (import.meta.env.DEV) (window as unknown as { __battle3d?: BattleScene }).__battle3d = scene.current
    } catch (e) {
      setFailed(`The 3D view could not start: ${(e as Error).message}`)
    }
    return () => {
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  // Every render hands the scene the current battle; the layers diff it.
  useEffect(() => {
    scene.current?.update(game, { selectedId, targetId, showArcs, rangeRings, viewSide, rulerMode, fx })
  })

  useEffect(() => {
    scene.current?.setFollow(follow)
  }, [follow])

  const choose = (p: CameraPreset) => {
    setPreset(p)
    setFollow(false)
    scene.current?.setPreset(p)
  }

  if (failed) {
    return (
      <div className="battle3d battle3d-failed" role="alert">
        <p>{failed}</p>
        {onExit && (
          <button type="button" className="primary" onClick={onExit}>
            Back to the 2D map
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className={`battle3d${rulerMode ? ' is-ruler' : ''}${game.scenario.nebula ? ' is-nebula' : ''}`}
      ref={host}
      role="img"
      aria-label="Play surface, 3D view"
    >
      <div className="battle3d-hud" onPointerDown={(e) => e.stopPropagation()}>
        <div className="battle3d-cams" role="group" aria-label="Camera">
          {(
            [
              ['tilt', 'Tilt', 'The whole board from above and behind (double-click empty space)'],
              ['top', 'Top', 'Straight down, like the 2D map'],
              ['low', 'Low', 'Down among the hulls'],
            ] as const
          ).map(([p, label, title]) => (
            <button
              key={p}
              type="button"
              className={`chip${preset === p && !follow ? ' is-on' : ''}`}
              title={title}
              onClick={() => choose(p)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`chip${follow ? ' is-on' : ''}`}
            disabled={!selectedId}
            title="Keep the selected ship in the middle of the view as it moves"
            onClick={() => setFollow((f) => !f)}
          >
            Follow
          </button>
        </div>
        <p className="battle3d-help">
          Drag to orbit · right-drag to pan · wheel to zoom · click a hull to select · double-click to fly to it
        </p>
      </div>
      {hover && (
        <div className="battle3d-tip" style={{ left: hover.at.x + 14, top: hover.at.y + 14 }}>
          {hover.text}
        </div>
      )}
      {rulerMode && ruler && (
        <div className="battle3d-ruler-read">
          {Math.floor(ruler.inches)}&quot; ({ruler.inches.toFixed(1)})
        </div>
      )}
    </div>
  )
}
