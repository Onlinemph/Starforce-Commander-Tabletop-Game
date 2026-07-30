import { useState } from 'react'
import {
  firingOrder,
  resolveVolley,
  selectBracket,
  type FireMode,
  type MountSelection,
  type VolleyResult,
} from '../engine/combat'
import { damageContext, pushLog, terrainObstacles, type GameState } from '../engine/game'
import { actualRange, arcTo, canBearOn, effectiveRange, shieldsFacing } from '../engine/geometry'
import { mountIsReady, type ShipState } from '../engine/shipState'
import { act } from './store'

/**
 * Offensive Fire (E6.2). Ships fire in descending order of Tactical Scan; the
 * panel shows who has the option to fire, then walks the firing steps.
 */

interface Props {
  game: GameState
  attacker: ShipState
}

export function CombatPanel({ game, attacker }: Props) {
  const [targetId, setTargetId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<FireMode>('standard')
  const [section, setSection] = useState<'shields' | 'weapons' | 'general' | 'engineering'>('weapons')
  const [degraded, setDegraded] = useState(false)
  const [lastResult, setLastResult] = useState<VolleyResult | string | null>(null)

  const enemies = game.ships.filter((s) => s.side !== attacker.side && !s.destroyed && !s.disengaged)
  const target = enemies.find((s) => s.id === targetId) ?? null
  const groups = firingOrder(game.ships)
  const currentGroup = groups.find((g) => g.some((s) => !game.firedThisSegment.has(s.id)))
  const mayFire = currentGroup?.some((s) => s.id === attacker.id) ?? false

  const actual = target ? actualRange(attacker.placement.position, target.placement.position) : null
  const effective =
    target !== null && actual !== null
      ? effectiveRange(actual, target.sensors.jamming, degraded ? 0 : attacker.sensors.targeting)
      : null
  const targetArcs = target ? arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position) : []
  const shieldOptions = target
    ? shieldsFacing(attacker.placement.position, target.placement.position, target.placement.heading)
    : []

  const toggleMount = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const fire = () => {
    if (!target) return
    const mounts: MountSelection[] = [...selected].map((key) => {
      const [weaponId, indexStr] = key.split('|')
      return { weaponId, mountIndex: Number(indexStr) }
    })

    const result = act((g) =>
      resolveVolley(
        {
          attacker,
          target,
          mounts,
          mode,
          precisionSection: mode === 'precision' ? section : undefined,
          degradedFireControl: degraded,
          obstacles: terrainObstacles(g.scenario.terrain),
        },
        damageContext(g),
        g.rng,
      ),
    )

    if (!result.ok) {
      setLastResult(result.reason)
      return
    }

    act((g) => {
      g.firedThisSegment.add(attacker.id)
      const dice = result.records.flatMap((r) => r.rolls.map((d) => d.face)).join(' ')
      pushLog(
        g,
        `${attacker.name} fires on ${target.name} at effective range ${result.effectiveRange} ` +
          `(${result.targetShield} shield). Dice: ${dice} → ${result.damage.standard} damage` +
          (result.damage.leak ? `, ${result.damage.leak} leak` : ''),
      )
    })
    setSelected(new Set())
    setLastResult(result)
  }

  return (
    <div className="combat-panel">
      <h3>Offensive Fire — {attacker.name}</h3>

      <div className="firing-order">
        <strong>Firing sequence (Tactical Scan):</strong>{' '}
        {groups.length === 0
          ? '—'
          : groups
              .map((g) => `${g[0].sensors.tacticalScan}: ${g.map((s) => s.name).join(' + ')}`)
              .join(' → ')}
        {!mayFire && <span className="chip chip-warn">Not this ship&apos;s turn to fire</span>}
      </div>

      <label className="field">
        <span>Target</span>
        <select value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value || null)}>
          <option value="">— choose a target —</option>
          {enemies.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      {target && (
        <div className="range-readout">
          <span>Actual range {actual}&quot;</span>
          <span>
            Effective {effective}&quot;{' '}
            <em>
              (+{target.sensors.jamming} jam − {degraded ? 0 : attacker.sensors.targeting} targeting)
            </em>
          </span>
          <span>Firing arc {targetArcs.join(' or ')}</span>
          <span>Strikes {shieldOptions.join(' or ')} shield</span>
          {target.speed === 0 && <span className="chip chip-warn">Low-speed penalty (C1.5)</span>}
        </div>
      )}

      <div className="fire-modes">
        {(['standard', 'proximity', 'precision'] as FireMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`mode${mode === m ? ' is-current' : ''}`}
            onClick={() => setMode(m)}
            title={
              m === 'proximity'
                ? 'Reroll blanks, halve damage, ignore leak (E3.3)'
                : m === 'precision'
                  ? 'Target a ship section, effective range 8 or less (E9)'
                  : 'Normal volley (E6.2)'
            }
          >
            {m}
          </button>
        ))}
        <label className="checkbox" title="Firing at small targets, cloaked ships or through terrain (E10)">
          <input type="checkbox" checked={degraded} onChange={(e) => setDegraded(e.target.checked)} />
          Degraded fire control
        </label>
      </div>

      {mode === 'precision' && (
        <label className="field">
          <span>Target section (E9.1.2)</span>
          <select value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
            <option value="shields">Shields</option>
            <option value="weapons">Weapons</option>
            <option value="general">General Systems</option>
            <option value="engineering">Engineering</option>
          </select>
        </label>
      )}

      <div className="weapon-picker">
        {attacker.form.weapons.map((weapon) =>
          weapon.mounts.map((mount, index) => {
            const state = attacker.mounts[weapon.id][index]
            const key = `${weapon.id}|${index}`
            const ready = mountIsReady(weapon, index, state)
            const bears = target ? canBearOn(mount.arcs, targetArcs) : false
            const bracket =
              target && effective !== null ? selectBracket(weapon, effective, target.speed === 0) : null
            const disabled = !ready || !bears || !bracket

            return (
              <button
                key={key}
                type="button"
                className={`weapon-pick${selected.has(key) ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                disabled={disabled}
                onClick={() => toggleMount(key)}
                title={
                  !ready
                    ? 'Not armed'
                    : !bears
                      ? `Cannot bear (arcs ${mount.arcs.join('/')})`
                      : !bracket
                        ? 'Out of range'
                        : `${bracket.bracket.dice.length} dice from the ${bracket.bracket.min}–${bracket.bracket.max} bracket`
                }
              >
                <span>
                  {weapon.name} #{index + 1}
                </span>
                {bracket && (
                  <span className={`band band-${bracket.bracket.band}`}>
                    {bracket.bracket.dice.map((d, j) => (
                      <span key={j} className={`die die-${d}`} />
                    ))}
                    {bracket.bracket.bonus ? ` +${bracket.bracket.bonus}` : ''}
                  </span>
                )}
              </button>
            )
          }),
        )}
      </div>

      <div className="fire-actions">
        <button type="button" className="primary" disabled={!target || selected.size === 0} onClick={fire}>
          Fire volley
        </button>
        <button
          type="button"
          onClick={() =>
            act((g) => {
              g.firedThisSegment.add(attacker.id)
              pushLog(g, `${attacker.name} declines to fire this phase (E6.2 Step 1).`)
            })
          }
        >
          Pass
        </button>
      </div>

      {typeof lastResult === 'string' && <p className="fire-error">{lastResult}</p>}

      {lastResult && typeof lastResult !== 'string' && (
        <div className="volley-result">
          <h4>Volley resolved</h4>
          <ul>
            {lastResult.records.map((r, i) => (
              <li key={i}>
                {r.weaponName} #{r.mountIndex + 1} ({r.bracket.min}–{r.bracket.max}, {r.bracket.band}):{' '}
                {r.rolls.map((d, j) => (
                  <span key={j} className={`roll roll-${d.color}`}>
                    {d.face}
                  </span>
                ))}
                {r.diceLostToDamage > 0 && <em> −{r.diceLostToDamage} die (degraded)</em>}
              </li>
            ))}
          </ul>
          <p>
            {lastResult.damage.standard} standard
            {lastResult.damage.leak > 0 && `, ${lastResult.damage.leak} leak`}
            {lastResult.damage.structurePenetration > 0 && `, STR+${lastResult.damage.structurePenetration}`} on the{' '}
            {lastResult.targetShield} shield → {lastResult.outcome.blueAbsorbed + lastResult.outcome.greenAbsorbed}{' '}
            absorbed by shields, {lastResult.outcome.armorAbsorbed} by armor, {lastResult.outcome.internal} internal.
          </p>
        </div>
      )}
    </div>
  )
}
