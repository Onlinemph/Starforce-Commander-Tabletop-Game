import { currentStep, markTutorialSeen, tutorialShip, TUTORIAL } from './tutorial'
import type { GameState } from '../engine/game'

/**
 * The guided first battle, as a card that sits beside the board.
 *
 * It follows rather than leads: the step shown is worked out from the game
 * itself on every render, so it keeps up with a player who does things in an
 * unexpected order, explores a panel, or presses undo. There is no "next"
 * button by design — pressing next is not how you learn where the arming
 * points went. Finishing the thing it asks for is.
 */
export function TutorialPanel({
  game,
  viewSide,
  onClose,
}: {
  game: GameState
  viewSide: string | null
  onClose: () => void
}) {
  const ship = tutorialShip(game, viewSide)
  const index = currentStep(game, ship)
  const step = TUTORIAL[index]
  const last = index === TUTORIAL.length - 1

  return (
    <aside className="tutorial" aria-label="Guided battle">
      <header>
        <span className="tutorial-count">
          Step {index + 1} of {TUTORIAL.length}
        </span>
        <button
          type="button"
          className="chip"
          onClick={() => {
            markTutorialSeen()
            onClose()
          }}
        >
          {last ? 'Finish' : 'Skip'}
        </button>
      </header>

      <h3>{step.title}</h3>
      <p>{step.body}</p>

      {step.where && (
        <p className="tutorial-where">
          You want: <strong>{step.where}</strong>
        </p>
      )}

      <ol className="tutorial-track" aria-hidden="true">
        {TUTORIAL.map((s, i) => (
          <li key={s.id} className={i < index ? 'is-done' : i === index ? 'is-now' : ''} />
        ))}
      </ol>
    </aside>
  )
}
