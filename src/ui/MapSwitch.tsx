/**
 * The choice between the flat map and the optional 3D view, shared by the
 * battle screen and the replay theater.
 *
 * The 3D view is loaded on first use, so three.js stays out of the bundle
 * for anyone who plays on the flat map, and the choice is remembered per
 * browser.
 */
import { lazy, useState } from 'react'

export type MapMode = '2d' | '3d'

export const BattleView3D = lazy(() => import('./three/BattleView3D'))

const MAP_VIEW_KEY = 'sfc.map-view.v1'

export function useMapView(): [MapMode, (mode: MapMode) => void] {
  const [mode, setMode] = useState<MapMode>(() => {
    try {
      return localStorage.getItem(MAP_VIEW_KEY) === '3d' ? '3d' : '2d'
    } catch {
      return '2d'
    }
  })
  const choose = (next: MapMode) => {
    setMode(next)
    try {
      localStorage.setItem(MAP_VIEW_KEY, next)
    } catch {
      // Only the remembered preference is lost.
    }
  }
  return [mode, choose]
}

/** The "Map 2D / 3D" chips. */
export function MapModeChips({
  mode,
  onChange,
  disabled = false,
  title = 'The same battle drawn flat, or in three dimensions. Rules and orders are identical in both.',
}: {
  mode: MapMode
  onChange: (mode: MapMode) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <div className="view-chips" title={title}>
      <span>Map</span>
      {(['2d', '3d'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`chip${mode === m ? ' is-on' : ''}`}
          disabled={disabled}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {m.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
