import { batteryLineEligible, batterySpendError } from '../engine/engineering'
import { isCombatPhase, lentScanPoints, type GameState } from '../engine/game'
import { accelerationBudget, validatePlot } from '../engine/navigation'
import { batteryPower, currentMaxSpeed, lineValue, maxReverseSpeed, sensorFunctionCap, turnTemplateAt, type ShipState } from '../engine/shipState'
import type { Maneuver, ShieldSide, TurnDirection } from '../engine/types'
import { dispatch } from './store'

/**
 * The command card (A2.3, C1). Orders are plotted here during the Command
 * Segment and revealed at the start of the Navigation Segment (B1.9.1).
 */

const MANEUVERS: Array<{ id: Maneuver; label: string; directional: boolean; rule: string }> = [
  { id: 'slide', label: 'SLIDE', directional: true, rule: 'C2.4' },
  { id: 'easy', label: 'EASY', directional: true, rule: 'C2.3 — always 20°' },
  { id: 'straight', label: 'STRAIGHT', directional: false, rule: 'C2.1' },
  { id: 'standard', label: 'STND', directional: true, rule: 'C2.2' },
  { id: 's-turn', label: 'S-TURN', directional: true, rule: 'C3.3 — 1 stress' },
  { id: 'snap', label: 'SNAP', directional: true, rule: 'C3.4 — 1 stress' },
  { id: 'hard', label: 'HARD', directional: true, rule: 'C3.2 — 1 stress' },
  { id: 'em-90', label: 'EM-90', directional: true, rule: 'C3.5 — stress = speed' },
  { id: 'em-180', label: 'EM-180', directional: true, rule: 'C3.5 — stress = 2× speed' },
]

interface Props {
  game: GameState
  ship: ShipState
}

export function CommandCardPanel({ game, ship }: Props) {
  const card = game.orders[ship.id]
  if (!card) return null

  const errors = validatePlot(ship, card)
  const budget = accelerationBudget(ship)
  const sensorPoints = lineValue(ship, ship.form.functions.find((l) => l.kind === 'sensor')?.id ?? '')
  const sensorsUsed = card.sensors.targeting + card.sensors.jamming + card.sensors.tacticalScan
  const cap = sensorFunctionCap(ship)
  const lent = lentScanPoints(game)[ship.id] ?? 0

  const setManeuver = (maneuver: Maneuver, direction: TurnDirection | null) =>
    dispatch({ type: 'plot-maneuver', shipId: ship.id, maneuver, direction })

  const setAccel = (delta: number) => dispatch({ type: 'plot-accel', shipId: ship.id, delta })
  /**
   * How far the accel plot can go in either direction: the per-phase limit
   * (C1.2.5) or the round's unspent points (C1.2.3), whichever binds first —
   * the same arithmetic `plot-accel` clamps with, so a button past the wall is
   * disabled rather than silently refused.
   */
  const accelLimit = Math.min(
    ship.form.sublight.maxAccelPerPhase,
    Math.max(0, budget - ship.accelUsedThisRound),
  )
  const accelLimitReason =
    budget - ship.accelUsedThisRound < ship.form.sublight.maxAccelPerPhase
      ? `Only ${Math.max(0, budget - ship.accelUsedThisRound)} acceleration point${budget - ship.accelUsedThisRound === 1 ? '' : 's'} left this round (C1.2.3) — power ACC/DEC for more.`
      : `Max ${ship.form.sublight.maxAccelPerPhase} acceleration per phase (C1.2.5).`
  const evasive = card.evasive ?? ship.evasive
  const setEvasive = (points: number) =>
    dispatch({ type: 'plot-evasive', shipId: ship.id, points })

  /** The turn templates the printed counters offer (C3.9.3). */
  const RATES = [20, 25, 30, 35, 40, 45, 60]
  const maxTurn = turnTemplateAt(ship, card.speed)
  const turning = card.direction !== null && card.maneuver !== 'slide' && maxTurn > 0
  const sliding = card.maneuver === 'slide'

  const setSensor = (key: keyof typeof card.sensors, value: number) =>
    dispatch({ type: 'plot-sensor', shipId: ship.id, key, value })

  const toggleShield = (side: ShieldSide) =>
    dispatch({ type: 'plot-shield', shipId: ship.id, side })

  return (
    <div className="command-card">
      <h3>Command Card — {ship.name}</h3>

      <div className="cc-block">
        <h4>Helm</h4>
        <div className="maneuver-grid">
          {MANEUVERS.map((entry) => {
            const isCurrent = card.maneuver === entry.id
            if (!entry.directional) {
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`maneuver${isCurrent ? ' is-current' : ''}`}
                  title={entry.rule}
                  onClick={() => setManeuver(entry.id, null)}
                >
                  {entry.label}
                </button>
              )
            }
            return (
              <div key={entry.id} className="maneuver-pair" title={entry.rule}>
                <button
                  type="button"
                  className={`maneuver${isCurrent && card.direction === 'left' ? ' is-current' : ''}`}
                  onClick={() => setManeuver(entry.id, 'left')}
                >
                  ◀
                </button>
                <span className="maneuver-name">{entry.label}</span>
                <button
                  type="button"
                  className={`maneuver${isCurrent && card.direction === 'right' ? ' is-current' : ''}`}
                  onClick={() => setManeuver(entry.id, 'right')}
                >
                  ▶
                </button>
              </div>
            )
          })}
        </div>
        <p className="hint">
          Turn template at speed {card.speed}: {turnTemplateAt(ship, card.speed) || 'no turn'}
          {turnTemplateAt(ship, card.speed) ? '°' : ''} (C2.2.2)
        </p>
      </div>

      <div className="cc-block">
        <h4>Sublight Drive</h4>
        <div className="accel-row">
          <button
            type="button"
            disabled={card.accel <= -accelLimit}
            title={card.accel <= -accelLimit ? accelLimitReason : 'Decelerate — braking spends acceleration points too (C1.2.3)'}
            onClick={() => setAccel(-1)}
          >
            −
          </button>
          <span className="accel-value">
            ACCEL {card.accel >= 0 ? '+' : ''}
            {card.accel}
          </span>
          <button
            type="button"
            disabled={card.accel >= accelLimit}
            title={card.accel >= accelLimit ? accelLimitReason : 'Accelerate (C1.2)'}
            onClick={() => setAccel(1)}
          >
            +
          </button>
          <span className="speed-value">SPEED {card.speed}</span>
        </div>
        <p className="hint">
          {ship.accelUsedThisRound} of {budget} acceleration points used this round · max{' '}
          {ship.form.sublight.maxAccelPerPhase}/phase · safe {ship.form.sublight.safeAccelPerRound}/round ·
          speed range {-maxReverseSpeed(ship)} to {currentMaxSpeed(ship)}
        </p>

        {/*
          The EVASIVE box (C3.6). Acceleration spent weaving rather than on
          speed: it buys rerolls against every incoming volley, and hands the
          same number to anyone this ship shoots at. The per-phase limit does
          not apply to it, only the round's total.
        */}
        <div className="accel-row">
          <button
            type="button"
            disabled={evasive <= 0}
            onClick={() => setEvasive(evasive - 1)}
            aria-label="Less evasive"
          >
            −
          </button>
          <span className={`accel-value${evasive > 0 ? ' is-evasive' : ''}`}>EVASIVE {evasive}</span>
          <button type="button" onClick={() => setEvasive(evasive + 1)} aria-label="More evasive">
            +
          </button>
          {ship.evasive > 0 && <span className="speed-value">WEAVING</span>}
        </div>
        <p className="hint">
          {evasive > 0
            ? `Rerolls ${evasive} attack ${evasive === 1 ? 'die' : 'dice'} from every incoming volley — and hands ${evasive} back to anything this ship fires at (C3.6.3).`
            : 'Spend acceleration on evasive maneuvers: harder to hit, and less accurate yourself (C3.6).'}
        </p>

        {/*
          Emergency stop (C3.8). The drive field is shut down: the ship stands
          still this phase and the next, takes stress equal to the speed it was
          making, and none of it counts against the round's acceleration.
        */}
        <div className="accel-row">
          <button
            type="button"
            className={card.emergencyStop ? 'chip is-on' : 'chip'}
            disabled={ship.emergencyStopPhases > 0}
            title={
              ship.emergencyStopPhases > 0
                ? 'The drive is already shut down — the ship is stationary until it restarts (C3.8.2).'
                : `Shut the drive field down: speed 0 this phase and the next, and ${Math.abs(ship.speed)} stress (C3.8.3).`
            }
            onClick={() =>
              dispatch({
                type: 'plot-emergency-stop',
                shipId: ship.id,
                on: !card.emergencyStop,
              })
            }
          >
            EMER STOP
          </button>
          {ship.emergencyStopPhases > 0 && (
            <span className="speed-value">DRIVE DOWN · {ship.emergencyStopPhases}</span>
          )}
        </div>
      </div>

      {/*
        Precise turns and slides (C3.9), which only matter once a turn or a
        slide is actually plotted — so the block appears when it can be used.
      */}
      {(turning || sliding) && (
        <div className="cc-block">
          <h4>Precise maneuver</h4>
          {turning && (
            <>
              <div className="turn-rates">
                {[null, ...RATES.filter((r) => r <= maxTurn)].map((rate) => (
                  <button
                    key={rate ?? 'max'}
                    type="button"
                    className={`chip${(card.turnRate ?? null) === rate ? ' is-on' : ''}`}
                    onClick={() => dispatch({ type: 'plot-turn-rate', shipId: ship.id, rate })}
                  >
                    {rate === null ? `Max ${maxTurn}°` : `${rate}°`}
                  </button>
                ))}
              </div>
              <p className="hint">
                Any turn may be taken at less than the ship could manage (C3.9.1) — a shallower
                turn holds a firing arc that a hard one throws away.
              </p>
            </>
          )}
          {sliding && (
            <>
              <button
                type="button"
                className={card.halfSlide ? 'chip is-on' : 'chip'}
                onClick={() =>
                  dispatch({ type: 'plot-half-slide', shipId: ship.id, on: !card.halfSlide })
                }
              >
                ½-inch slide
              </button>
              <p className="hint">Slide half an inch instead of the full inch (C3.9.5).</p>
            </>
          )}
        </div>
      )}

      <div className="cc-block">
        <h4>Sensors</h4>
        <div className="sensor-grid">
          {(['targeting', 'jamming', 'tacticalScan'] as const).map((key) => (
            <label key={key}>
              <span>{key === 'tacticalScan' ? 'Tactical Scan' : key[0].toUpperCase() + key.slice(1)}</span>
              <input
                type="number"
                min={0}
                max={cap}
                value={card.sensors[key]}
                onChange={(e) => setSensor(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className={`hint${sensorsUsed > sensorPoints ? ' is-error' : ''}`}>
          {sensorsUsed} of {sensorPoints} sensor points allocated · max {cap} per function (H2.2.3)
        </p>
        {lent > 0 && (
          <p className="hint">
            Plus {lent} tactical scan point{lent === 1 ? '' : 's'} on loan from the command ship, which may
            take the ship past its sensor cap (H5.2.2) — effective Tactical Scan{' '}
            {card.sensors.tacticalScan + lent}.
          </p>
        )}
      </div>

      <div className="cc-block">
        <h4>Shields</h4>
        <div className="shield-toggles">
          {(['F', 'P', 'S', 'A'] as ShieldSide[]).map((side) => (
            <button
              key={side}
              type="button"
              className={`shield-toggle${card.shieldsDown.includes(side) ? ' is-down' : ''}`}
              onClick={() => toggleShield(side)}
              title="Mark a shield to be lowered during the Operations Segment (G1.1.5)"
            >
              {side} {card.shieldsDown.includes(side) ? 'down' : 'up'}
            </button>
          ))}
        </div>
      </div>

      {game.optionalBatteries && <ReservePower game={game} ship={ship} />}

      {errors.length > 0 && (
        <ul className="plot-errors">
          {errors.map((e, i) => (
            <li key={i} className={e.fallbackToStraight ? 'is-warn' : 'is-error'}>
              {e.message}
              {e.fallbackToStraight ? ' The ship will move straight instead (C1.1.2).' : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Reserve power (B2.5), on the card where it is plotted.
 *
 * Only under the optional rules, and only in a combat phase's Command Segment
 * — everywhere else a battery is simply part of the power the round was
 * allocated. The lines it may go to are the ones the engine will accept, each
 * with the reason when it will not: a shield already reinforced, a heavy too
 * slow to charge off a battery, a line already at full power.
 */
function ReservePower({ game, ship }: { game: GameState; ship: ShipState }) {
  const charged = batteryPower(ship)
  const inWindow = isCombatPhase(game.phase) && game.segment === 'command'
  if (!inWindow) return null

  // A line that can never take battery power is noise. One that cannot take it
  // *right now* — a shield already reinforced, a line at full power, an empty
  // battery — is worth showing greyed out, with the reason on the tooltip.
  const lines = ship.form.functions
    .filter((line) => batteryLineEligible(ship, line.id))
    .map((line) => ({ line, refusal: batterySpendError(ship, line.id) }))

  return (
    <div className="cc-block">
      <h4>Reserve power</h4>
      <p className="hint">
        {charged > 0
          ? `${charged} charged ${charged === 1 ? 'battery' : 'batteries'}. One point fills one empty circle.`
          : ship.batteryCharged.length === 0
            ? 'This ship carries no batteries.'
            : ship.batteryDamaged.every(Boolean)
              ? 'Every battery is damaged (E8.3) — repair one with damage control first.'
              : 'Batteries are empty — power beyond the reactors drains them at Resource Allocation (B2.4.1); recharge with BTY RECH (B2.4.3).'}
      </p>
      <div className="reserve-power">
        {lines.map(({ line, refusal }) => (
          <button
            key={line.id}
            type="button"
            className="chip"
            disabled={refusal !== null}
            title={refusal ?? `Spend one battery on ${line.label}`}
            onClick={() => dispatch({ type: 'spend-battery', shipId: ship.id, lineId: line.id })}
          >
            {line.label}
          </button>
        ))}
      </div>
    </div>
  )
}
