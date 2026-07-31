import { useState } from 'react'
import { act } from './store'
import {
  armingPointsAvailable,
  armMount,
  powerRemaining,
  setAllocation,
  totalPowerAvailable,
} from '../engine/engineering'
import {
  armorRemaining,
  batteryPower,
  blueShieldRemaining,
  damageControlRating,
  greenShieldRemaining,
  lineValue,
  mountIsDamaged,
  mountIsDegraded,
  reactorPower,
  sensorBoxesRemaining,
  shieldGeneratorRating,
  SHIELD_SIDES,
  structureBoxes,
  undamagedSystemBoxes,
  currentMaxSpeed,
  type ShipState,
} from '../engine/shipState'
import type { GameState } from '../engine/game'

/**
 * The starship form (B1). Layout follows the printed sheet: engineering and
 * resource allocation at the top, then weapons, shields, systems and structure.
 */

interface Props {
  game: GameState
  ship: ShipState
}

export function ShipFormPanel({ game, ship }: Props) {
  const allocating = game.phase === 'engineering' && game.segment === 'resource-allocation'
  /**
   * Why the last click was refused. Allocation and arming both have rules that
   * can turn a click down — not enough power, arming points already spent, a
   * slow-arming diamond — and a button that silently does nothing reads as a
   * broken game rather than a rule.
   */
  const [refusal, setRefusal] = useState<string | null>(null)
  const remaining = powerRemaining(ship)

  return (
    <div className="ship-form">
      <header className="ship-form-header">
        <div>
          <h2>{ship.name}</h2>
          <p className="ship-class">
            {ship.form.name} · {ship.form.faction}
          </p>
        </div>
        <dl className="general-data">
          <div>
            <dt>Size</dt>
            <dd>{ship.form.sizeClass}</dd>
          </div>
          <div>
            <dt>Accel/phase</dt>
            <dd>{ship.form.sublight.maxAccelPerPhase}</dd>
          </div>
          <div>
            <dt>Stress</dt>
            <dd>{ship.form.stressRating}</dd>
          </div>
          <div>
            <dt>Dmg Ctl</dt>
            <dd>{damageControlRating(ship)}</dd>
          </div>
          <div>
            <dt>Max spd</dt>
            <dd>{currentMaxSpeed(ship)}</dd>
          </div>
        </dl>
      </header>

      {ship.form.provisional && (
        <p className="provisional-note" title={ship.form.notes}>
          Provisional stats — reconstructed from rulebook examples, not Ship Book 1.
        </p>
      )}

      <section className="form-section">
        <h3>
          Power Systems
          <span className="chip">
            {reactorPower(ship)} + {batteryPower(ship)} available
          </span>
        </h3>
        <div className="reactor-row">
          {ship.form.reactors.map((group) => (
            <div key={group.id} className="reactor-group">
              <span className="reactor-label">{group.label}</span>
              {group.points.map((point, i) => {
                const hits = ship.reactorDamage[group.id][i]
                return (
                  <span key={i} className={`power-point${hits >= point.boxes ? ' is-dead' : ''}`}>
                    <span className="dot" />
                    {Array.from({ length: point.boxes }, (_, b) => (
                      <span key={b} className={`box${b < hits ? ' is-damaged' : ''}`} />
                    ))}
                  </span>
                )
              })}
            </div>
          ))}
          <div className="reactor-group">
            <span className="reactor-label">BATTERY</span>
            {ship.batteryDamaged.map((damaged, i) => (
              <span key={i} className="power-point">
                <span className={`dot${ship.batteryCharged[i] ? ' is-charged' : ''}`} />
                <span className={`box${damaged ? ' is-damaged' : ''}`} />
              </span>
            ))}
          </div>
        </div>
      </section>

      {allocating && refusal && (
        <p className="alloc-error" role="status">
          {refusal}
        </p>
      )}

      <section className="form-section">
        <h3>
          Functions / Power Level
          {allocating && (
            <span className={`chip${remaining === 0 ? ' chip-warn' : ''}`}>
              {remaining} of {totalPowerAvailable(ship)} power left
            </span>
          )}
        </h3>
        <table className="functions">
          <tbody>
            {ship.form.functions.map((line) => {
              const filled = ship.allocation[line.id] ?? 0
              return (
                <tr key={line.id}>
                  <th>{line.label}</th>
                  <td className="circles">
                    {line.freeValue > 0 && <span className="circle is-free" title="Free power (B2.2.3)">{line.freeValue}</span>}
                    {line.steps.map((step, i) => {
                      // Cost of filling up to and including this circle, less
                      // whatever the line already holds.
                      const costToHere = line.steps
                        .slice(0, i + 1)
                        .reduce((n, s) => n + s.powerCost, 0)
                      const alreadyOnLine = line.steps
                        .slice(0, filled)
                        .reduce((n, s) => n + s.powerCost, 0)
                      const extra = costToHere - alreadyOnLine
                      const affordable = i < filled || extra <= remaining
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`circle${i < filled ? ' is-filled' : ''}${
                            allocating && !affordable ? ' is-unaffordable' : ''
                          }`}
                          disabled={!allocating}
                          title={
                            i < filled
                              ? `Click to take the power back off, down to ${step.value}`
                              : affordable
                                ? `${extra} power → ${step.value}`
                                : `Needs ${extra} power; ${remaining} left`
                          }
                          onClick={() =>
                            act(() => {
                              // Clicking a filled circle empties back to it.
                              const next = i < filled ? i : i + 1
                              setRefusal(setAllocation(ship, line.id, next)?.message ?? null)
                            })
                          }
                        >
                          {step.value}
                        </button>
                      )
                    })}
                  </td>
                  <td className="line-value">{lineValue(ship, line.id)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="form-section">
        <h3>Weapons</h3>
        {ship.form.weapons.map((weapon) => {
          const pending = allocating ? armingPointsAvailable(ship, weapon.id) : 0
          return (
            <div key={weapon.id} className="weapon-block">
              <div className="weapon-head">
                <strong>{weapon.name}</strong>
                <span className="traits">{weapon.traits.join(' · ')}</span>
                {pending > 0 && <span className="chip chip-warn">{pending} arming points to spend</span>}
              </div>

              <div className="mounts">
                {weapon.mounts.map((mount, index) => {
                  const state = ship.mounts[weapon.id][index]
                  const damaged = mountIsDamaged(weapon, index, state)
                  const degraded = mountIsDegraded(weapon, index, state)
                  return (
                    <button
                      key={mount.id}
                      type="button"
                      className={`mount${damaged ? ' is-damaged' : ''}${degraded ? ' is-degraded' : ''}`}
                      disabled={pending === 0 || damaged}
                      title={
                        pending > 0
                          ? 'Spend one arming point on this mount (E4.2.2)'
                          : `Arcs: ${mount.arcs.join(', ')}`
                      }
                      onClick={() =>
                        act(() => setRefusal(armMount(ship, weapon.id, index)?.message ?? null))
                      }
                    >
                      <span className="mount-arcs">{mount.arcs.join('/')}</span>
                      <span className="arming">
                        {Array.from({ length: mount.armingCircles }, (_, c) => (
                          <span key={c}>
                            <span className={`circle-sm${c < state.armed ? ' is-filled' : ''}`} />
                            {mount.roundGates?.[c] && <span className="gate" title="Slow arming (E4.2.8)">◆</span>}
                          </span>
                        ))}
                      </span>
                      <span className="hitboxes">
                        {Array.from({ length: mount.hitBoxes }, (_, b) => (
                          <span key={b} className={`box${b < state.damage ? ' is-damaged' : ''}`} />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>

              <table className="firing-chart">
                <tbody>
                  <tr>
                    {weapon.brackets.map((b, i) => (
                      <th key={i} className={`band-${b.band}`}>
                        {b.min}–{b.max}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {weapon.brackets.map((b, i) => (
                      <td key={i}>
                        {b.bonus ? `+${b.bonus} ` : ''}
                        {b.dice.map((d, j) => (
                          <span key={j} className={`die die-${d}`} />
                        ))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              {weapon.special && (
                <p className="special">
                  SPCL: {weapon.special.damage} DMG
                  {weapon.special.leak ? `, LEAK+${weapon.special.leak}` : ''}
                  {weapon.special.structure ? `, STR+${weapon.special.structure}` : ''}
                </p>
              )}
            </div>
          )
        })}
      </section>

      <section className="form-section">
        <h3>
          Shields <span className="chip">Gen {shieldGeneratorRating(ship)}/{ship.form.shields.generatorBoxes}</span>
        </h3>
        <table className="shields">
          <tbody>
            <tr>
              <th />
              {SHIELD_SIDES.map((side) => (
                <th key={side}>{side}</th>
              ))}
            </tr>
            <tr>
              <th>Blue</th>
              {SHIELD_SIDES.map((side) => (
                <td key={side} className={ship.shieldsDown[side] ? 'is-down' : ''}>
                  {blueShieldRemaining(ship, side)}/{ship.form.shields.blue[side]}
                </td>
              ))}
            </tr>
            <tr>
              <th>Reinf.</th>
              {SHIELD_SIDES.map((side) => (
                <td key={side}>{greenShieldRemaining(ship, side)}</td>
              ))}
            </tr>
            {Object.values(ship.form.armor).some((a) => a > 0) && (
              <tr>
                <th>Armor</th>
                {SHIELD_SIDES.map((side) => (
                  <td key={side}>
                    {armorRemaining(ship, side)}/{ship.form.armor[side]}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <th>Status</th>
              {SHIELD_SIDES.map((side) => (
                <td key={side}>{ship.shieldsDown[side] ? 'DOWN' : 'up'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="form-section">
        <h3>Systems</h3>
        <div className="systems">
          {ship.form.systems.map((group) => (
            <div key={group.kind} className="system-group">
              <span>{group.kind}</span>
              {Array.from({ length: group.boxes }, (_, i) => (
                <span
                  key={i}
                  className={`box${i >= undamagedSystemBoxes(ship, group.kind) ? ' is-damaged' : ''}`}
                />
              ))}
            </div>
          ))}
          <div className="system-group">
            <span>SL DRV</span>
            {Array.from({ length: ship.form.sublight.driveBoxes }, (_, i) => (
              <span key={i} className={`box${i < (ship.systemDamage['__sublight'] ?? 0) ? ' is-damaged' : ''}`} />
            ))}
          </div>
          <div className="system-group">
            <span>FTL DRV</span>
            {Array.from({ length: ship.form.ftlDriveBoxes }, (_, i) => (
              <span key={i} className={`box${i < ship.ftlDriveDamage ? ' is-damaged' : ''}`} />
            ))}
          </div>
          <div className="system-group">
            <span>Marines</span>
            <span className="count">{ship.marineSquads}</span>
          </div>
          <div className="system-group">
            <span>Sensor cap</span>
            <span className="count">{sensorBoxesRemaining(ship)} per function</span>
          </div>
        </div>
      </section>

      <section className="form-section">
        <h3>Structural Integrity</h3>
        <div className="structure">
          {(() => {
            const boxes = structureBoxes(ship)
            let boxIndex = 0
            return ship.form.structure.map((entry, i) => {
              if (entry.kind === 'dc') {
                return (
                  <span key={i} className="dc-marker" title="Damage Control Rating (B3.1.2)">
                    {entry.rating}
                  </span>
                )
              }
              const box = boxes[boxIndex++]
              return <span key={i} className={`box structure-${box.color}${box.damaged ? ' is-damaged' : ''}`} />
            })
          })()}
        </div>
        {ship.excessStructureDamage > 0 && (
          <p className="excess">Excess structural damage: {ship.excessStructureDamage}</p>
        )}
      </section>
    </div>
  )
}
