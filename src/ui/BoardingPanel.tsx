import { useState } from 'react'
import { sabotageSquads, shipsUnderBoarding, type GameState } from '../engine/game'
import {
  boardersAboard,
  boardingSides,
  combatDice,
  controllingSide,
  isCaptured,
  tightQuarters,
  CAPTURED_FTL_LOCKOUT,
} from '../engine/boarding'
import { crewIsArmed, type ShipState } from '../engine/shipState'
import { dispatch } from './store'

/**
 * Boarding Combat (J6.2). Marines who reached an enemy hull by transporter
 * (J5) or shuttle (J8.2.6) fight here, in the Final Phase.
 *
 * The segment resolves itself when you complete it; this panel is where the
 * attacking player decides how many squads go after the ship instead of its
 * defenders (J6.2.4), and where the state of each action is readable.
 */

export function BoardingPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const contested = shipsUnderBoarding(game)

  return (
    <div className="segment-help ops-panel">
      <h3>Boarding Combat (A3.4.2, J6.2)</h3>

      {isCaptured(ship) && (
        <p className="fire-error">
          {ship.name} was captured by {ship.capturedBy} in round {ship.capturedRound}. It performs no
          actions, may only fly straight or make Standard turns, and cannot reach FTL until round{' '}
          {(ship.capturedRound ?? 0) + CAPTURED_FTL_LOCKOUT} (J6.2.5).
        </p>
      )}

      {contested.length === 0 ? (
        <p className="hint">
          No marines are aboard any ship. Send them across with transporters in Step D of the
          Operations Segment (J5.2.1), or by shuttle in Flight Operations (J8.2.6).
        </p>
      ) : (
        contested.map((target) => <BoardingAction key={target.id} game={game} target={target} />)
      )}

      <p className="hint">
        Each side rolls one blue die per squad and a Light hit kills one enemy squad. Once a side
        outnumbers the other two to one, only two squads may set about each enemy squad — so a small
        force takes a long time to dig out (J6.2.2, J6.2.3).
      </p>
    </div>
  )
}

function BoardingAction({ game, target }: { game: GameState; target: ShipState }) {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="ops-block boarding-action">
      <header>
        <strong>{target.name}</strong>
        <span className="hint">
          {target.marineSquads} defending squad(s) · controlled by {controllingSide(target)}
        </span>
      </header>

      {boardingSides(target).map((side) => {
        const boarders = target.boarders[side] ?? 0
        const saboteurs = sabotageSquads(game, target, side)
        const fighting = Math.max(0, boarders - saboteurs)
        const attackDice = combatDice(fighting, target.marineSquads)
        const defendDice = combatDice(target.marineSquads, fighting)
        const capped =
          tightQuarters(fighting, target.marineSquads) || tightQuarters(target.marineSquads, fighting)

        return (
          <div key={side} className="boarding-side">
            <p className="hint">
              {side}: {boarders} squad(s) aboard — {attackDice} attacking die/dice against{' '}
              {defendDice} defending
              {capped && <em> · tight quarters (J6.2.3)</em>}
            </p>
            <div className="builder-row wrap">
              <label className="field tiny">
                <span>Wreck the ship</span>
                <input
                  type="number"
                  min={0}
                  max={boarders}
                  value={saboteurs}
                  onChange={(e) =>
                    dispatch({
                      type: 'set-sabotage',
                      targetId: target.id,
                      side,
                      squads: Math.min(boarders, Number(e.target.value) || 0),
                    })
                  }
                />
              </label>
              <span className="hint">
                Those squads skip the fight and roll against the ship instead — a damage point per
                Light hit, with anything reaching the structure track simply lost (J6.2.4).
              </span>
            </div>
            <button
              type="button"
              className="chip"
              onClick={() =>
                setError(dispatch({ type: 'fight-boarders', targetId: target.id, side }).message)
              }
            >
              Fight it out now
            </button>
          </div>
        )
      })}

      {/*
        Arming the crew (J6.3): two more squads per size class, and a ship that
        stops being a warship for twenty rounds after the fighting ends.
      */}
      {boardersAboard(target) > 0 && (
        <div className="board-crew">
          <button
            type="button"
            className={crewIsArmed(target) ? 'chip is-on' : 'chip'}
            disabled={crewIsArmed(target)}
            title={
              crewIsArmed(target)
                ? 'The crew is already under arms — no damage control, two points less power, and the ship fires last (J6.3.4).'
                : `Arm the general crew: ${2 * target.form.sizeClass} improvised squads, at the cost of damage control, two power and the firing order for twenty rounds (J6.3.4).`
            }
            onClick={() => setError(dispatch({ type: 'arm-crew', shipId: target.id }).message)}
          >
            {crewIsArmed(target) ? 'Crew under arms' : 'Arm the crew (J6.3)'}
          </button>
          <span className="hint">
            An act of desperation: it raises {2 * target.form.sizeClass} squads and leaves a
            skeleton crew running the ship.
          </span>
        </div>
      )}

      {boardersAboard(target) === 0 && <p className="hint">No boarders left aboard.</p>}
      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}
