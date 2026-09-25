/**
 * The screenshot-test page: renders one map fixture, full size, with no app
 * chrome around it. `tools/visual/run.mjs` loads `visual.html?fixture=<name>`
 * for each entry in `fixtures.ts`, waits for `data-ready`, and photographs
 * the map. Dev-server only — it is not part of the production build.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAction } from '../engine/actions'
import type { GameState } from '../engine/game'
import { MapView } from '../ui/MapView'
import type { BattleFx } from '../ui/fx'
import { FIXTURES, type MapFixture } from './fixtures'
import '../ui/styles.css'
import '../ui/theme/tokens.css'
import '../ui/theme/chrome.css'
import '../ui/theme/title.css'
import '../ui/theme/panels.css'
import '../ui/theme/modals.css'
import '../ui/theme/campaign.css'

const params = new URLSearchParams(location.search)
const name = params.get('fixture') ?? ''
/** `view=3d` draws the fixture in the 3D view instead of the flat map. */
const view3d = params.get('view') === '3d'
/** `fx=1` feeds the 3D view a made-up volley between the first two ships, on
 * a loop — there is no other way to catch `EffectsLayer` mid-flight from a
 * fixture, since real fx only exist for the length of a replayed action. */
const fxEnabled = params.get('fx') === '1'
const BattleView3D = lazy(() => import('../ui/three/BattleView3D'))

/**
 * A synthetic volley — one of each shot the 2D fx stream can produce, plus
 * both kinds of impact — fired between `game.ships[0]` and `[1]` every two
 * seconds, purely so a screenshot has something to catch `EffectsLayer`
 * doing. Dev-only; nothing here reads or writes the actual battle.
 */
function useSyntheticFx(game: GameState): BattleFx[] {
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!fxEnabled) return
    const timer = setInterval(() => setRound((r) => r + 1), 2000)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => {
    if (!fxEnabled) return []
    const [a, b] = game.ships
    if (!a || !b) return []
    const from = a.placement.position
    const to = b.placement.position
    const id = round * 10
    // Offset each shot sideways a little, the way fx.ts's own `offsetShot`
    // fans a broadside out — three shots down the same exact line would
    // stack into one indistinguishable beam.
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const lane = (n: number) => ({
      from: { x: from.x + (-dy / len) * 0.5 * n, y: from.y + (dx / len) * 0.5 * n },
      to: { x: to.x + (-dy / len) * 0.5 * n, y: to.y + (dx / len) * 0.5 * n },
    })
    return [
      { id: id + 1, kind: 'shot', weapon: 'phaser', ...lane(-1), delay: 0 },
      { id: id + 2, kind: 'shot', weapon: 'disruptor', ...lane(0), delay: 140 },
      { id: id + 3, kind: 'shot', weapon: 'torpedo', ...lane(1), delay: 280 },
      { id: id + 4, kind: 'impact', impact: 'shield', at: to, delay: 420 },
      { id: id + 5, kind: 'impact', impact: 'hull', at: to, delay: 660 },
    ]
  }, [game, round])
}

declare global {
  interface Window {
    /** Advance the fixture's battle through its next Navigation Segment and redraw. */
    __navigate?: () => void
    /** The last ship the 3D view reported a click on. */
    __selected?: string
  }
}

/**
 * The fixture on a map, plus one hook for checking motion: `__navigate()`
 * steps the sequence of play until a Navigation Segment has resolved, so a
 * test can photograph the counters mid-flight. The still baselines never
 * call it.
 */
function Stage({ fixture }: { fixture: MapFixture }) {
  const [, redraw] = useState(0)
  const fx = useSyntheticFx(fixture.game)
  window.__navigate = () => {
    const game = fixture.game
    for (let i = 0; i < 40; i++) {
      const was = game.segment
      applyAction(game, { type: 'advance-segment' })
      if (was === 'navigation') break
    }
    redraw((n) => n + 1)
  }
  return (
    <div className="visual-fixture" style={{ width: 1200, padding: 8 }}>
      {view3d ? (
        <Suspense fallback={null}>
          <div style={{ height: 800, display: 'flex' }} className="map-column">
            <BattleView3D
              game={fixture.game}
              selectedId={fixture.selectedId}
              targetId={fixture.targetId}
              onSelect={(id) => {
                window.__selected = id
              }}
              showArcs={fixture.showArcs}
              rangeRings={fixture.rangeRings}
              viewSide={fixture.viewSide}
              rulerMode={false}
              fx={fx}
            />
          </div>
        </Suspense>
      ) : (
      <MapView
        game={fixture.game}
        selectedId={fixture.selectedId}
        targetId={fixture.targetId}
        onSelect={() => {}}
        showArcs={fixture.showArcs}
        rangeRings={fixture.rangeRings}
        viewSide={fixture.viewSide}
        rulerMode={false}
        viewLock
      />
      )}
    </div>
  )
}
const root = document.getElementById('root')!

if (name === 'list') {
  root.textContent = JSON.stringify(Object.keys(FIXTURES))
  document.body.dataset.ready = '1'
} else if (!FIXTURES[name]) {
  root.textContent = `No such fixture: ${name}`
  document.body.dataset.ready = 'error'
} else {
  const f = FIXTURES[name]()
  createRoot(root).render(<Stage fixture={f} />)
  /*
   * Ready once the SVG's raster images (asteroid scatter, ship art) have
   * loaded and two frames have painted — photographing earlier catches the
   * asteroid fields half drawn.
   */
  const settle = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const images = [...document.querySelectorAll('image')]
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            const href = img.getAttribute('href') ?? img.getAttribute('xlink:href')
            if (!href) return resolve()
            const probe = new Image()
            probe.onload = probe.onerror = () => resolve()
            probe.src = href
          }),
      ),
    )
    await document.fonts.ready
    document.body.dataset.ready = '1'
  }
  void settle()
}
