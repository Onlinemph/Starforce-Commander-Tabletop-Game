import { useState } from 'react'
import {
  advanceOperationsStep,
  attemptTractorLock,
  contestTractor,
  craftName,
  effectiveSpeed,
  maxSystemOf,
  performScan,
  performTransport,
  releaseTractor,
  scanTargets,
  setMaxSystem,
  setShieldDown,
  tractorBeamsFree,
  tractorTargets,
  type GameState,
} from '../engine/game'
import {
  infoPoints,
  OPERATIONS_STEPS,
  OPERATIONS_STEP_LABELS,
  OPERATIONS_STEP_RULES,
  scanYield,
  shieldsAllDown,
  transportCapacity,
  transporterRange,
} from '../engine/operations'
import { genSysSetting, undamagedSystemBoxes, type ShipState } from '../engine/shipState'
import { linksHolding, tractorBeams, tractorPower, type TractorLink } from '../engine/tractor'
import type { ShieldSide, SystemKind } from '../engine/types'
import { act } from './store'

/**
 * The Operations Segment (J1), walked as the five steps the rules print. Each
 * step shows only what may be done in it, so shields settle before tractor
 * beams reach out and beams settle before anyone beams across (J1.4).
 */

/** Systems that can be run at maximum, in the order the form prints them. */
const MAX_CANDIDATES: SystemKind[] = ['TRAC', 'TRAN', 'SCNC', 'SHTL', 'PROB', 'SENS']

export function OperationsPanel({ game, ship }: { game: GameState; ship: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const step = game.ops.step
  const index = OPERATIONS_STEPS.indexOf(step)

  return (
    <div className="segment-help ops-panel">
      <h3>Operations (A3.3.2, J1)</h3>

      <ol className="ops-steps">
        {OPERATIONS_STEPS.map((s, i) => (
          <li key={s} className={s === step ? 'is-current' : i < index ? 'is-done' : ''}>
            {OPERATIONS_STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      <p className="hint">{OPERATIONS_STEP_RULES[step]}</p>

      <MaxSystem game={game} ship={ship} />

      {step === 'shields' && <Shields game={game} ship={ship} onError={setError} />}
      {step === 'tractor' && <Tractors game={game} ship={ship} onError={setError} />}
      {step === 'transport' && <Transporters game={game} ship={ship} onError={setError} />}
      {step === 'other' && <Scans game={game} ship={ship} onError={setError} />}

      {error && <p className="fire-error">{error}</p>}

      <button
        type="button"
        className="chip"
        disabled={index >= OPERATIONS_STEPS.length - 1}
        onClick={() => act((g) => void advanceOperationsStep(g))}
      >
        Next step →
      </button>
    </div>
  )
}

type ErrorSetter = (message: string | null) => void

/** J1.1.2 — one system per phase may run at its maximum level. */
function MaxSystem({ game, ship }: { game: GameState; ship: ShipState }) {
  const gen = genSysSetting(ship)
  const chosen = maxSystemOf(game, ship)
  const available = MAX_CANDIDATES.filter((k) => undamagedSystemBoxes(ship, k) > 0)
  if (available.length === 0) return null

  return (
    <div className="ops-max">
      <span className="ops-max-label">MAX this phase</span>
      {gen !== 'max' ? (
        <em>GEN SYS is at {gen.toUpperCase()} — nothing may run at maximum (J1.1.2).</em>
      ) : (
        <div className="builder-row wrap">
          <button
            type="button"
            className={`chip${chosen === null ? ' is-on' : ''}`}
            onClick={() => act((g) => setMaxSystem(g, ship, null))}
          >
            none
          </button>
          {available.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`chip${chosen === kind ? ' is-on' : ''}`}
              onClick={() => act((g) => setMaxSystem(g, ship, kind))}
            >
              {kind}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Shields({
  game,
  ship,
  onError,
}: {
  game: GameState
  ship: ShipState
  onError: ErrorSetter
}) {
  return (
    <div className="shield-toggles">
      {(['F', 'P', 'S', 'A'] as ShieldSide[]).map((side) => (
        <button
          key={side}
          type="button"
          className={`shield-toggle${ship.shieldsDown[side] ? ' is-down' : ''}`}
          onClick={() => act(() => onError(setShieldDown(game, ship, side, !ship.shieldsDown[side])))}
        >
          {side} {ship.shieldsDown[side] ? 'down' : 'up'}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step C — tractor beams (J3)
// ---------------------------------------------------------------------------

function Tractors({
  game,
  ship,
  onError,
}: {
  game: GameState
  ship: ShipState
  onError: ErrorSetter
}) {
  const [targetId, setTargetId] = useState('')
  const [beams, setBeams] = useState(1)

  const total = tractorBeams(ship)
  if (total === 0) return <p className="hint">{ship.name} has no tractor beams (J3.1.2).</p>

  const free = tractorBeamsFree(game, ship)
  const power = tractorPower(ship, maxSystemOf(game, ship))
  const held = game.ops.links.filter((l) => l.sourceId === ship.id)
  const heldBy = linksHolding(game.ops.links, ship.id)
  const targets = tractorTargets(game, ship)
  const adjusted = effectiveSpeed(game, ship)

  return (
    <div className="ops-block">
      <p className="hint">
        {free} of {total} beam(s) free · reach {power === 'max' ? 2 : 1}&quot; at {power.toUpperCase()}{' '}
        power
        {adjusted !== ship.speed && ` · towing has this ship at speed ${adjusted}, plotted ${ship.speed}`}
      </p>

      <div className="builder-row wrap">
        <label className="field">
          <span>Lock onto</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a target…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field tiny">
          <span>Beams</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, free)}
            value={beams}
            onChange={(e) => setBeams(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button
          type="button"
          className="chip"
          disabled={!targetId || free === 0}
          onClick={() =>
            act((g) => {
              const result = attemptTractorLock(g, ship, targetId, beams)
              onError(
                result.refusal ??
                  (result.locked
                    ? null
                    : `Lock failed: ${result.total} against ${result.required || 'no L or M'}.`),
              )
            })
          }
        >
          Attempt lock
        </button>
      </div>

      {held.length > 0 && (
        <ul className="ops-links">
          {held.map((link) => (
            <li key={link.id}>
              holding <b>{labelFor(game, link.targetId)}</b> with {link.beams} beam(s)
              <button
                type="button"
                className="chip danger"
                onClick={() => act((g) => releaseTractor(g, ship.id, link.targetId))}
              >
                release
              </button>
            </li>
          ))}
        </ul>
      )}

      {heldBy.length > 0 && (
        <div className="ops-block">
          <p className="hint">
            {ship.name} is held by {heldBy.length} tractor beam(s). It may force each one to prove
            itself again (J3.6.1).
          </p>
          <button
            type="button"
            className="chip"
            onClick={() =>
              act((g) => {
                const result = contestTractor(g, ship.id)
                onError(result.locked ? 'The beam holds.' : 'Broken free.')
              })
            }
          >
            Try to break free
          </button>
        </div>
      )}
    </div>
  )
}

function labelFor(game: GameState, id: string): string {
  const ship = game.ships.find((s) => s.id === id)
  if (ship) return ship.name
  const craft = game.smallCraft.find((c) => c.id === id)
  return craft ? craftName(craft) : id
}

// ---------------------------------------------------------------------------
// Step D — transporters (J5)
// ---------------------------------------------------------------------------

function Transporters({
  game,
  ship,
  onError,
}: {
  game: GameState
  ship: ShipState
  onError: ErrorSetter
}) {
  const [targetId, setTargetId] = useState('')
  const [squads, setSquads] = useState(1)

  const capacity = transportCapacity(ship)
  if (capacity === 0) return <p className="hint">{ship.name} has no transporters (J5.1.1).</p>

  const used = game.ops.transportedThisPhase[ship.id] ?? 0
  const reach = transporterRange(ship, maxSystemOf(game, ship))
  const others = game.ships.filter((s) => s.id !== ship.id && !s.destroyed && !s.disengaged)

  return (
    <div className="ops-block">
      <p className="hint">
        {capacity - used} of {capacity} squad(s) left this phase · reach {reach}&quot; ·{' '}
        {ship.marineSquads} marine squad(s) aboard ·{' '}
        {shieldsAllDown(ship) ? 'shields down' : 'shields up — beaming is blocked (J5.1.3)'}
      </p>
      <div className="builder-row wrap">
        <label className="field">
          <span>Beam to</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a ship…</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.side === ship.side ? '' : ' (enemy — boarding)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field tiny">
          <span>Squads</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, capacity - used)}
            value={squads}
            onChange={(e) => setSquads(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button
          type="button"
          className="chip"
          disabled={!targetId}
          onClick={() =>
            act((g) => {
              const target = g.ships.find((s) => s.id === targetId)
              if (!target) return
              const result = performTransport(g, ship, target, squads)
              onError(result.refusal)
            })
          }
        >
          Energize
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step E — informational scans (J4)
// ---------------------------------------------------------------------------

function Scans({
  game,
  ship,
  onError,
}: {
  game: GameState
  ship: ShipState
  onError: ErrorSetter
}) {
  const [targetId, setTargetId] = useState('')
  const yielded = scanYield(ship, maxSystemOf(game, ship), ship.sensors.tacticalScan)
  const targets = scanTargets(game, ship)

  return (
    <div className="ops-block">
      <p className="hint">
        A scan is worth {yielded.total} point(s): {yielded.fromSciences} from{' '}
        {undamagedSystemBoxes(ship, 'SCNC')} SCNC box(es) at {yielded.power.toUpperCase()}, plus{' '}
        {yielded.fromSensors} from Tactical Scan (J4.2.2).
      </p>
      <div className="builder-row wrap">
        <label className="field">
          <span>Scan</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose an object…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {infoPoints(game.ops.info, ship.side, t.id)} info
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="chip"
          disabled={!targetId}
          onClick={() =>
            act((g) => {
              const result = performScan(g, ship, targetId)
              onError(result.refusal)
            })
          }
        >
          Scan
        </button>
      </div>

      <InfoLedgerView game={game} side={ship.side} />
    </div>
  )
}

function InfoLedgerView({ game, side }: { game: GameState; side: string }) {
  const ledger = game.ops.info[side] ?? {}
  const rows = Object.entries(ledger).filter(([, points]) => points > 0)
  if (rows.length === 0) return null
  return (
    <table className="builder-table">
      <thead>
        <tr>
          <th>Object</th>
          <th>Info points</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([id, points]) => (
          <tr key={id}>
            <td>{labelFor(game, id) === id ? terrainName(game, id) : labelFor(game, id)}</td>
            <td>{points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function terrainName(game: GameState, id: string): string {
  return game.scenario.terrain.find((t) => t.id === id)?.name ?? id
}

export type { TractorLink }
