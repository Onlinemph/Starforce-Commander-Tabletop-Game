import { useSyncExternalStore } from 'react'
import type { DamageDecision } from '../engine/damage'
import {
  answerDamageDecision,
  currentMatchSide,
  pendingDamageDecision,
  subscribeStore,
  useGame,
} from './store'

/**
 * "Which box?" — put to the captain whose ship is taking the hit.
 *
 * Several damage cards hand the *defender* the decision (E8.4.1, E8.3.2,
 * E8.3.5, E8.2.2, E8.5.3, E8.5.10), and until now the engine's own doctrine
 * answered them for everybody. This is the console.
 *
 * The options are worked out by the engine, which knows what is legal — a
 * ship with its sensors already gone cannot offer them, structure is offered
 * only when nothing else will take the hit, and a Critical Hit is never on the
 * list because E8.4.1 forbids choosing one. The doctrine's own pick is marked,
 * so a player who does not want to think can take it and move on.
 *
 * In an online match the same questions can be *someone else's*: a volley
 * staged across the wire waits on the defender's console, and everyone else
 * sees the hold announced instead of a battle that has quietly stopped moving.
 */
export function DamageChoicePrompt() {
  const decision = useSyncExternalStore(subscribeStore, pendingDamageDecision, pendingDamageDecision)
  const game = useGame()
  if (decision) return <Prompt decision={decision} />
  const staged = game.stagedAction
  const mySide = currentMatchSide()
  // Only the consoles that are *not* being asked see the banner; on the
  // asking console the prompt itself takes over as soon as the relay lands.
  if (staged && mySide !== null && staged.awaiting !== mySide) {
    return (
      <div className="staged-banner" role="status">
        <span className="staged-dot" aria-hidden="true" />
        Holding fire — {staged.awaiting} is choosing where the damage falls (E8.4.1)…
      </div>
    )
  }
  return null
}

function Prompt({ decision }: { decision: DamageDecision }) {
  return (
    <div className="picker-backdrop" role="dialog" aria-label="Damage control decision">
      <div className="picker damage-choice">
        <header>
          <h2>{decision.shipName}</h2>
          <span className="hint">{decision.prompt}</span>
        </header>
        <ul className="damage-choice-options">
          {decision.options.map((option) => (
            <li key={JSON.stringify(option.choice)}>
              <button
                type="button"
                className={option.recommended ? 'primary' : ''}
                autoFocus={option.recommended}
                onClick={() => answerDamageDecision(option.choice)}
              >
                {option.label}
                {option.recommended && <em> — damage control advises</em>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
