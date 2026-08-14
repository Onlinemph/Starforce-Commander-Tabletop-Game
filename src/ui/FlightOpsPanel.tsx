import { useState } from 'react'
import {
  craftName,
  effectiveSpeed,
  flightsAirborne,
  flightsInHangar,
  maxSystemOf,
  tractorBeamsFree,
  wingCardFor,
  type GameState,
} from '../engine/game'
import { undamagedSystemBoxes, type ShipState } from '../engine/shipState'
import {
  isShuttle,
  recoveryAllowance,
  shuttleCapacity,
  SHUTTLE_SPEED,
  type SmallCraft,
} from '../engine/smallCraft'
import {
  airframeJamming,
  airframeSpeed,
  CONFIG_LABELS,
  currentConfig,
  currentLoadout,
  flightPoints,
  hangarCapacity,
  launchRate,
  loadoutOf,
  recoveryRate,
  FLIGHT_RANGE,
  MAX_FLIGHT_SIZE,
  MAX_FLIGHTS_PER_SHIP,
  type FighterConfigKind,
  type Flight,
} from '../engine/fighters'
import { fighterCard, FIGHTER_CARDS } from '../data/fighters'
import { dispatch, dispatchWithChoices } from './store'

/**
 * The Flight Operations Segment (A3.3.5, J8.2). Shuttles launch in Step A and
 * activate in Step B, and each one moves, lands or docks once a phase.
 */

export function FlightOpsPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const bays = undamagedSystemBoxes(ship, 'SHTL')
  const mine = game.smallCraft.filter((c) => c.side === ship.side && isShuttle(c))
  const launched = game.ops.launchedThisPhase.has(ship.id)
  const recovered = game.ops.recoveredThisPhase[ship.id] ?? 0
  const allowance = recoveryAllowance(ship, maxSystemOf(game, ship), tractorBeamsFree(game, ship))

  return (
    <div className="segment-help ops-panel">
      <h3>Flight Operations (A3.3.5, J8)</h3>

      {bays === 0 ? (
        <p className="hint">{ship.name} has no shuttle bay (J8.1.1).</p>
      ) : (
        <>
          <p className="hint">
            {ship.shuttlesAboard} shuttle(s) aboard of {shuttleCapacity(ship)} the bay holds ·{' '}
            {recovered}/{allowance} recovered this phase (J8.1.2, J8.1.5).
          </p>
          <div className="builder-row wrap">
            <button
              type="button"
              className="chip"
              disabled={launched}
              onClick={() => setError(dispatch({ type: 'launch-shuttle', shipId: ship.id }).message)}
            >
              Launch shuttle
            </button>
            <button
              type="button"
              className="chip"
              disabled={launched || ship.marineSquads < 1}
              onClick={() =>
                setError(
                  dispatch({ type: 'launch-shuttle', shipId: ship.id, kind: 'shuttle', marines: 1 })
                    .message,
                )
              }
              title="J8.3.5 — a standard shuttle carries one marine squad or away team"
            >
              Launch with marines
            </button>
            <button
              type="button"
              className="chip"
              disabled={launched}
              onClick={() =>
                setError(
                  dispatch({ type: 'launch-shuttle', shipId: ship.id, kind: 'jamming-shuttle' })
                    .message,
                )
              }
              title="J8.4 — GEN SYS at MAX, mother ship at speed 3 or less"
            >
              Launch jammer
            </button>
          </div>
        </>
      )}

      {mine.length > 0 && (
        <table className="builder-table">
          <thead>
            <tr>
              <th>Craft</th>
              <th>Damage</th>
              <th>Move</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mine.map((craft) => (
              <CraftRow
                key={craft.id}
                game={game}
                craft={craft}
                ship={ship}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        A shuttle moves up to {SHUTTLE_SPEED}&quot; in any direction, ignoring its facing and
        ignoring stress (J8.2.3). Movement is not plotted — pick a bearing and go.
      </p>

      <FighterSection game={game} ship={ship} />
    </div>
  )
}

/**
 * Fighters (Apr 2026 outline, Package A). A separate block because it is a
 * separate subsystem: fighters roll d6, ships roll the coloured dice, and the
 * two never meet inside one roll.
 */
function FighterSection({ game, ship }: { game: GameState; ship: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const [cardId, setCardId] = useState(wingCardFor(ship))
  const [config, setConfig] = useState<FighterConfigKind>('space-superiority')
  const [members, setMembers] = useState(MAX_FLIGHT_SIZE)

  const hangar = hangarCapacity(ship)
  const out = flightsAirborne(game, ship)
  const launched = game.ops.flightsLaunchedThisPhase[ship.id] ?? 0
  const recovered = game.ops.flightsRecoveredThisPhase[ship.id] ?? 0
  const mine = game.flights.filter((f) => f.side === ship.side && f.members > 0)
  const card = fighterCard(cardId)
  const loadout = card ? loadoutOf(card, config) : undefined

  if (hangar === 0 && mine.length === 0) return null

  return (
    <>
      <h3>Fighters</h3>

      {hangar === 0 ? (
        <p className="hint">{ship.name} has no hangar bay.</p>
      ) : (
        <>
          <p className="hint">
            {flightsInHangar(game, ship)} flight(s) in the hangar of {hangar} · {out.length}/
            {MAX_FLIGHTS_PER_SHIP} out · {launched}/{launchRate(ship)} launched and {recovered}/
            {recoveryRate(ship)} recovered this phase.
          </p>
          <div className="builder-row wrap">
            <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {FIGHTER_CARDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={config}
              onChange={(e) => setConfig(e.target.value as FighterConfigKind)}
            >
              {(['strike', 'space-superiority', 'basic'] as FighterConfigKind[]).map((k) => (
                <option key={k} value={k}>
                  {CONFIG_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={MAX_FLIGHT_SIZE}
              value={members}
              onChange={(e) =>
                setMembers(Math.max(1, Math.min(MAX_FLIGHT_SIZE, Number(e.target.value) || 1)))
              }
            />
            <button
              type="button"
              className="chip"
              onClick={() =>
                setError(
                  dispatch({ type: 'launch-flight', shipId: ship.id, cardId, config, members })
                    .message,
                )
              }
            >
              Launch flight
            </button>
          </div>
          {card && loadout && (
            <p className="hint">
              {card.name} {CONFIG_LABELS[config]}: speed {airframeSpeed(card, loadout)}&quot;,
              jamming {airframeJamming(card, loadout)}, structure {card.structure} each · DFR 1‑
              {loadout.dfr}, dodge 1‑{loadout.dodge}, strike 1‑{loadout.strikeHit} for{' '}
              {loadout.strikeDamage} · ~{flightPoints(card, config, members)} points provisional.
            </p>
          )}
        </>
      )}

      {mine.length > 0 && (
        <table className="builder-table">
          <thead>
            <tr>
              <th>Flight</th>
              <th>Move</th>
              <th>Attack</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((flight) => (
              <FlightRow key={flight.id} game={game} flight={flight} onError={setError} />
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        Fighters roll a plain d6 — DFR to hit, Dodge to save — while everything a starship&apos;s
        guns do stays on the coloured dice. A flight counts as one launch for a cloak&apos;s
        detection roll (H6.15.4), and a strike run expends the load and flips the counter to BASIC.
      </p>
    </>
  )
}

function FlightRow({
  game,
  flight,
  onError,
}: {
  game: GameState
  flight: Flight
  onError: (message: string | null) => void
}) {
  const card = fighterCard(flight.cardId)
  const loadout = card ? currentLoadout(flight, card) : undefined
  const [distance, setDistance] = useState(card && loadout ? airframeSpeed(card, loadout) : 6)
  if (!card || !loadout) return null
  const speed = airframeSpeed(card, loadout)

  const fly = (heading: number) => {
    const radians = (heading * Math.PI) / 180
    onError(
      dispatch({
        type: 'move-flight',
        flightId: flight.id,
        x: flight.position.x + Math.sin(radians) * distance,
        y: flight.position.y - Math.cos(radians) * distance,
      }).message,
    )
  }

  const within = (x: number, y: number) =>
    Math.hypot(x - flight.position.x, y - flight.position.y) <= speed + 1e-9

  const enemyFlights = game.flights.filter(
    (f) => f.side !== flight.side && !f.dockedTo && f.members > 0 && within(f.position.x, f.position.y),
  )
  const enemyShips = game.ships.filter(
    (s) =>
      s.side !== flight.side &&
      !s.destroyed &&
      !s.disengaged &&
      within(s.placement.position.x, s.placement.position.y),
  )
  const carriers = game.ships.filter(
    (s) =>
      s.side === flight.side &&
      !s.destroyed &&
      Math.hypot(
        s.placement.position.x - flight.position.x,
        s.placement.position.y - flight.position.y,
      ) < FLIGHT_RANGE + 1,
  )

  return (
    <tr className={flight.activated && flight.attacked ? 'is-done' : ''}>
      <td>
        {card.name} ×{flight.members}
        <em>
          {' '}
          · {CONFIG_LABELS[currentConfig(flight)]}
          {flight.spent && ' (spent)'}
        </em>
        {flight.dockedTo && <em> · aboard</em>}
        {flight.damage > 0 && <em> · {flight.damage} damage carried</em>}
      </td>
      <td>
        {flight.dockedTo ? (
          <em className="hint">in the hangar</em>
        ) : (
          <div className="builder-row wrap">
            <input
              type="number"
              min={0}
              max={speed}
              step={0.5}
              value={distance}
              onChange={(e) => setDistance(Math.min(speed, Number(e.target.value) || 0))}
            />
            {BEARINGS.map((b) => (
              <button
                key={b.label}
                type="button"
                className="chip"
                disabled={flight.activated}
                onClick={() => fly(b.heading)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </td>
      <td>
        <div className="builder-row wrap">
          {enemyFlights.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              disabled={flight.attacked}
              title={`DFR 1‑${loadout.dfr} against a dodge of 1‑${
                currentLoadout(f, fighterCard(f.cardId)!)?.dodge ?? '?'
              }`}
              onClick={() =>
                onError(dispatch({ type: 'dogfight', flightId: flight.id, targetId: f.id }).message)
              }
            >
              engage {f.cardId.slice(0, 4).toUpperCase()} ×{f.members}
            </button>
          ))}
          {enemyShips.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              disabled={flight.attacked || loadout.strikeHit <= 0}
              title={`Strike 1‑${loadout.strikeHit} for ${loadout.strikeDamage} per hit — expends the load`}
              onClick={() =>
                void dispatchWithChoices({
                  type: 'flight-strike',
                  flightId: flight.id,
                  shipId: s.id,
                }).then((o) => onError(o.message))
              }
            >
              strike {s.name.split(' ').pop()}
            </button>
          ))}
          {!flight.dockedTo &&
            carriers.map((s) => (
              <button
                key={`land-${s.id}`}
                type="button"
                className="chip"
                onClick={() =>
                  onError(
                    dispatch({ type: 'recover-flight', flightId: flight.id, shipId: s.id }).message,
                  )
                }
              >
                land on {s.name.split(' ').pop()}
              </button>
            ))}
          {enemyFlights.length === 0 && enemyShips.length === 0 && carriers.length === 0 && (
            <em className="hint">nothing in reach</em>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Eight compass points, so a shuttle can be flown without a map click. */
const BEARINGS: Array<{ label: string; heading: number }> = [
  { label: '↑', heading: 0 },
  { label: '↗', heading: 45 },
  { label: '→', heading: 90 },
  { label: '↘', heading: 135 },
  { label: '↓', heading: 180 },
  { label: '↙', heading: 225 },
  { label: '←', heading: 270 },
  { label: '↖', heading: 315 },
]

function CraftRow({
  game,
  craft,
  ship,
  onError,
}: {
  game: GameState
  craft: SmallCraft
  ship: ShipState
  onError: (message: string | null) => void
}) {
  const [distance, setDistance] = useState(SHUTTLE_SPEED)

  const fly = (heading: number) => {
    const radians = (heading * Math.PI) / 180
    onError(
      dispatch({
        type: 'move-craft',
        craftId: craft.id,
        x: craft.position.x + Math.sin(radians) * distance,
        y: craft.position.y - Math.cos(radians) * distance,
      }).message,
    )
  }

  /* Ships that actually have this craft in a beam (J3.2.6). */
  const holders = game.ships.filter(
    (s) =>
      !s.destroyed &&
      !s.disengaged &&
      game.ops.links.some((l) => l.sourceId === s.id && l.targetId === craft.id),
  )

  const nearby = game.ships.filter(
    (s) =>
      !s.destroyed &&
      !s.disengaged &&
      Math.hypot(s.placement.position.x - craft.position.x, s.placement.position.y - craft.position.y) < 2,
  )

  return (
    <tr className={craft.activated ? 'is-done' : ''}>
      <td>
        {craftName(craft)}
        {craft.kind === 'jamming-shuttle' && <em> jammer</em>}
        {craft.marines ? <em> · {craft.marines} marine(s)</em> : null}
        {craft.dockedTo && <em> · docked</em>}
      </td>
      <td>{craft.damage}/4</td>
      <td>
        <div className="builder-row wrap">
          <input
            type="number"
            min={0}
            max={SHUTTLE_SPEED}
            step={0.5}
            value={distance}
            onChange={(e) => setDistance(Math.min(SHUTTLE_SPEED, Number(e.target.value) || 0))}
          />
          {BEARINGS.map((b) => (
            <button
              key={b.label}
              type="button"
              className="chip"
              disabled={craft.activated || Boolean(craft.dockedTo)}
              onClick={() => fly(b.heading)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </td>
      <td>
        <div className="builder-row wrap">
          {nearby
            .filter((s) => s.side === craft.side)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                onClick={() =>
                  onError(dispatch({ type: 'recover-shuttle', craftId: craft.id, shipId: s.id }).message)
                }
              >
                land on {s.name.split(' ').pop()}
              </button>
            ))}
          {nearby
            .filter((s) => s.side !== craft.side)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                title={`J8.2.6 — ${s.name} is at speed ${effectiveSpeed(game, s)}`}
                onClick={() =>
                  onError(dispatch({ type: 'dock-shuttle', craftId: craft.id, shipId: s.id }).message)
                }
              >
                board {s.name.split(' ').pop()}
              </button>
            ))}
          {/*
            J3.2.6 — anything caught in a beam can be brought aboard, which is
            how you take a prize rather than merely shoot one down. Offered
            only to a ship actually holding this craft; the engine refuses the
            armed and the live regardless.
          */}
          {holders.map((s) => (
            <button
              key={`capture-${s.id}`}
              type="button"
              className="chip"
              title={
                s.side === craft.side
                  ? 'Bring your own craft in off the beam (J3.2.6)'
                  : 'Take the captured craft aboard as a prize (J3.2.6)'
              }
              onClick={() =>
                onError(dispatch({ type: 'capture-craft', craftId: craft.id, shipId: s.id }).message)
              }
            >
              {s.side === craft.side ? 'bring aboard' : 'take as prize'}
            </button>
          ))}
          {nearby.length === 0 && holders.length === 0 && (
            <em className="hint">nothing within range 1</em>
          )}
        </div>
        {ship.id === craft.motherId && null}
      </td>
    </tr>
  )
}
