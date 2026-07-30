import { useState } from 'react'
import {
  firingOrder,
  resolveVolley,
  selectBracket,
  type FireMode,
  type MountSelection,
  type VolleyResult,
} from '../engine/combat'
import {
  coordinatedStepFor,
  FIRING_STEPS,
  individualStepFor,
  mayFireAlone,
} from '../engine/coordinatedFire'
import {
  advanceFiringStep,
  attackAllowed,
  cloudModifiers,
  currentFiringStep,
  damageContext,
  declareCoordinatedFire,
  pushLog,
  recordAttack,
  scoutSupport,
  tacticalScanOf,
  workingSystemBoxes,
  terrainObstacles,
  type GameState,
} from '../engine/game'
import { actualRange, arcTo, canBearOn, effectiveRange, shieldsFacing } from '../engine/geometry'
import { NO_SCOUT_SUPPORT } from '../engine/scouting'
import { mountIsReady, type ShipState } from '../engine/shipState'
import { act } from './store'

/**
 * Offensive Fire (E6.2). Ships fire in descending order of Tactical Scan; the
 * panel shows who has the option to fire, then walks the firing steps.
 *
 * With the optional Coordinated Fire rules in force (H4), Step B of the Combat
 * Segment instead runs through the ten firing steps of H4.2.3 and the panel
 * gains a group builder for the four Coordinated steps.
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
  const step = currentFiringStep(game)
  const group = game.coordinatedGroup
  const inGroup = group?.shipIds.includes(attacker.id) ?? false

  // A ship in a declared group must fire at the group's target (H4.5).
  const forcedTargetId = inGroup ? group!.targetId : null
  const target = enemies.find((s) => s.id === (forcedTargetId ?? targetId)) ?? null

  const groups = firingOrder(game.ships, (s) => tacticalScanOf(game, s))
  const currentTacScanGroup = groups.find((g) => g.some((s) => !game.firedThisSegment.has(s.id)))

  const alreadyFired = game.firedThisSegment.has(attacker.id)
  const mayFire = game.coordinatedFire
    ? !alreadyFired &&
      (inGroup
        ? group!.step === step.index
        : mayFireAlone(step, tacticalScanOf(game, attacker)) &&
          !(group !== null && group.side === attacker.side))
    : (currentTacScanGroup?.some((s) => s.id === attacker.id) ?? false)

  // H4.3.1: one attack per faction per target per phase. A group member is
  // covered by the attack its group already recorded.
  const attackBlocked = target && !inGroup ? attackAllowed(game, attacker, target) : null

  // Scout targeting and area jamming both bend the effective range (H3.4, H3.5).
  const support = target ? scoutSupport(game, attacker, target) : NO_SCOUT_SUPPORT
  // Nebulae and gas clouds force degraded fire control, cancel the low-speed
  // penalty and switch the target's shields off (K4.2.1, K4.2.3, K4.2.6, K5.2.5).
  const clouds = target
    ? cloudModifiers(game, attacker, target)
    : { degradedFireControl: false, lowSpeedNegated: false, targetShieldsInoperative: false }
  const degradedNow = degraded || clouds.degradedFireControl
  const actual = target ? actualRange(attacker.placement.position, target.placement.position) : null
  const effective =
    target !== null && actual !== null
      ? effectiveRange(
          actual,
          target.sensors.jamming + support.jamming,
          degradedNow ? 0 : attacker.sensors.targeting + support.targeting,
        )
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

    const result = act((g) => {
      const terrain = cloudModifiers(g, attacker, target)
      return resolveVolley(
        {
          attacker,
          target,
          mounts,
          mode,
          precisionSection: mode === 'precision' ? section : undefined,
          coordinated: inGroup,
          scoutSupport: scoutSupport(g, attacker, target),
          // A nebula can switch the sciences off, shrinking the precision hand
          // (K4.2.4, E9.2.2).
          attackerSciences: workingSystemBoxes(g, attacker, 'SCNC'),
          ...terrain,
          degradedFireControl: degraded || terrain.degradedFireControl,
          obstacles: terrainObstacles(g.scenario.terrain),
        },
        damageContext(g),
        g.rng,
      )
    })

    if (!result.ok) {
      setLastResult(result.reason)
      return
    }

    act((g) => {
      g.firedThisSegment.add(attacker.id)
      if (g.coordinatedFire && !inGroup) recordAttack(g, attacker, target)
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

      {game.coordinatedFire ? (
        <FiringSteps game={game} attacker={attacker} />
      ) : (
        <div className="firing-order">
          <strong>Firing sequence (Tactical Scan):</strong>{' '}
          {groups.length === 0
            ? '—'
            : groups
                .map((g) => `${tacticalScanOf(game, g[0])}: ${g.map((s) => s.name).join(' + ')}`)
                .join(' → ')}
          {!mayFire && <span className="chip chip-warn">Not this ship&apos;s turn to fire</span>}
        </div>
      )}

      {game.coordinatedFire && step.kind === 'coordinated' && !group && !alreadyFired && (
        <CoordinatedFireBuilder game={game} attacker={attacker} />
      )}

      <label className="field">
        <span>Target</span>
        <select
          value={forcedTargetId ?? targetId ?? ''}
          disabled={forcedTargetId !== null}
          onChange={(e) => setTargetId(e.target.value || null)}
        >
          <option value="">— choose a target —</option>
          {enemies.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      {inGroup && (
        <p className="hint">
          Firing with {group!.shipIds.filter((id) => id !== attacker.id).length} other ship(s) on step{' '}
          {group!.step}. Each ship still resolves a separate volley (H4.6.1), and no member may use
          precision targeting (H4.6.2).
        </p>
      )}

      {attackBlocked && <p className="fire-error">{attackBlocked}</p>}

      {target && (
        <div className="range-readout">
          <span>Actual range {actual}&quot;</span>
          <span>
            Effective {effective}&quot;{' '}
            <em>
              (+{target.sensors.jamming + support.jamming} jam −{' '}
              {degradedNow ? 0 : attacker.sensors.targeting + support.targeting} targeting)
            </em>
          </span>
          {support.targeting > 0 && (
            <span className="chip chip-scout" title="H3.4.1">
              +{support.targeting} targeting from {support.targetingFrom}
            </span>
          )}
          {support.jamming > 0 && (
            <span className="chip chip-scout" title="H3.5.1">
              +{support.jamming} area jamming from {support.jammingFrom}
            </span>
          )}
          <span>Firing arc {targetArcs.join(' or ')}</span>
          <span>Strikes {shieldOptions.join(' or ')} shield</span>
          {target.speed === 0 && !clouds.lowSpeedNegated && (
            <span className="chip chip-warn">Low-speed penalty (C1.5)</span>
          )}
          {clouds.degradedFireControl && (
            <span className="chip chip-warn" title="K4.2.6, K5.2.5">
              Degraded fire control — nebula or gas cloud
            </span>
          )}
          {clouds.targetShieldsInoperative && (
            <span className="chip chip-warn" title="K4.2.1">
              Target&apos;s shields inoperative
            </span>
          )}
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
          <input
            type="checkbox"
            checked={degradedNow}
            disabled={clouds.degradedFireControl}
            onChange={(e) => setDegraded(e.target.checked)}
          />
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
        <button
          type="button"
          className="primary"
          // H4.1.3 makes the step order binding ("NO EXCEPTIONS"); the base
          // game's Tactical Scan order is advisory here and only warns.
          disabled={
            !target ||
            selected.size === 0 ||
            attackBlocked !== null ||
            (game.coordinatedFire && !mayFire)
          }
          onClick={fire}
        >
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

      {game.coordinatedFire && (
        <button
          type="button"
          className="next-step"
          disabled={step.index === FIRING_STEPS.length}
          onClick={() => act((g) => advanceFiringStep(g))}
        >
          Next firing step →
        </button>
      )}

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

/** The ten firing steps of H4.2.3, with the current one called out. */
function FiringSteps({ game, attacker }: { game: GameState; attacker: ShipState }) {
  const current = currentFiringStep(game)
  const scan = tacticalScanOf(game, attacker)

  return (
    <div className="firing-steps">
      <strong>
        Step {current.index} — {current.label}
      </strong>
      <ol>
        {FIRING_STEPS.map((step) => {
          const mine = mayFireAlone(step, scan)
          return (
            <li
              key={step.index}
              className={[
                step.index === current.index ? 'is-current' : '',
                step.index < current.index ? 'is-past' : '',
                mine ? 'is-mine' : '',
                step.kind === 'coordinated' ? 'is-coordinated' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={step.label}
            >
              {step.index}
            </li>
          )
        })}
      </ol>
      <p className="hint">
        {attacker.name} has Tactical Scan {scan} and fires on step {individualStepFor(scan).index}
        {coordinatedStepFor(scan) ? ` or step ${coordinatedStepFor(scan)!.index}` : ''} — one opportunity
        only (H4.2.4).
      </p>
    </div>
  )
}

/**
 * Build a coordinated attack on the current step (H4.5). Every ship needs at
 * least as many tactical scan points as there are ships firing together, and
 * the group fires on the step matching its highest level.
 */
function CoordinatedFireBuilder({ game, attacker }: { game: GameState; attacker: ShipState }) {
  const [picked, setPicked] = useState<Set<string>>(new Set([attacker.id]))
  const [targetId, setTargetId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const step = currentFiringStep(game)
  const friends = game.ships.filter(
    (s) => s.side === attacker.side && !s.destroyed && !s.disengaged && !s.derelict && !game.firedThisSegment.has(s.id),
  )
  const enemies = game.ships.filter((s) => s.side !== attacker.side && !s.destroyed && !s.disengaged)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const declare = () => {
    const target = enemies.find((s) => s.id === targetId)
    if (!target) {
      setError('Choose a target for the coordinated attack.')
      return
    }
    const ships = friends.filter((s) => picked.has(s.id))
    setError(act((g) => declareCoordinatedFire(g, ships, target)))
  }

  return (
    <div className="coordinated-builder">
      <h4>Coordinated fire — step {step.index}</h4>
      <div className="coordinated-ships">
        {friends.map((s) => (
          <label key={s.id} className="checkbox">
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
            {s.name} <em>TacScan {tacticalScanOf(game, s)}</em>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Common target (H4.3.1)</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— choose a target —</option>
          {enemies.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={declare} disabled={picked.size === 0}>
        Declare coordinated attack
      </button>
      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        Each ship needs Tactical Scan at least equal to the number of ships firing together (H4.5.1),
        and the group fires on the step set by its highest level (H4.5.5).
      </p>
    </div>
  )
}
