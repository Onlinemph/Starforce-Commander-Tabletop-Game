/**
 * The screenshot-test page: renders one map fixture, full size, with no app
 * chrome around it. `tools/visual/run.mjs` loads `visual.html?fixture=<name>`
 * for each entry in `fixtures.ts`, waits for `data-ready`, and photographs
 * the map. Dev-server only — it is not part of the production build.
 */
import { createRoot } from 'react-dom/client'
import { MapView } from '../ui/MapView'
import { FIXTURES } from './fixtures'
import '../ui/styles.css'
import '../ui/theme/tokens.css'
import '../ui/theme/chrome.css'
import '../ui/theme/title.css'
import '../ui/theme/panels.css'
import '../ui/theme/modals.css'
import '../ui/theme/campaign.css'

const name = new URLSearchParams(location.search).get('fixture') ?? ''
const root = document.getElementById('root')!

if (name === 'list') {
  root.textContent = JSON.stringify(Object.keys(FIXTURES))
  document.body.dataset.ready = '1'
} else if (!FIXTURES[name]) {
  root.textContent = `No such fixture: ${name}`
  document.body.dataset.ready = 'error'
} else {
  const f = FIXTURES[name]()
  createRoot(root).render(
    <div className="visual-fixture" style={{ width: 1200, padding: 8 }}>
      <MapView
        game={f.game}
        selectedId={f.selectedId}
        targetId={f.targetId}
        onSelect={() => {}}
        showArcs={f.showArcs}
        rangeRings={f.rangeRings}
        viewSide={f.viewSide}
        rulerMode={false}
        viewLock
      />
    </div>,
  )
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
