import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/styles.css'
/*
 * The design system, as a layer over the original stylesheet: tokens first so
 * the retuned values win, then one file per region of the screen. Keeping the
 * layer separate from styles.css is what makes it reviewable and reversible —
 * delete the six imports below and the app renders as it did before.
 * See docs/ui-design-system.md for the spec they implement.
 */
import './ui/theme/tokens.css'
import './ui/theme/chrome.css'
import './ui/theme/title.css'
import './ui/theme/panels.css'
import './ui/theme/modals.css'
import './ui/theme/campaign.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support: the rules engine runs entirely in the browser, so after
// one visit the game works with no network at all. Production only — the dev
// server's modules would fight the cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // No worker, no offline play — the game itself is unaffected.
    })
  })
}
