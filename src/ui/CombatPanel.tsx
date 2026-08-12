import { useState } from 'react'
import {
  firingOrder,
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
  asteroidCoverRerolls,
  asteroidFieldsAt,
  attackAllowed,
  cloakModifiers,
  cloudModifiers,
  impactingHoming,
  probeLaunchers,
  smallTargetsFor,
  tractorableHoming,
  tractorBeamsFree,
  scanTargets,
  currentFiringStep,
  scoutSupport,
  tacticalScanOf,
  type GameState,
} from '../engine/game'
import { actualRange, arcTo, canBearOn, effectiveRange, shieldsFacing } from '../engine/geometry'
import { defendingArcs, endurance, impactShield, isHoming, speedInPhase } from '../engine/homing'
import { NO_SCOUT_SUPPORT } from '../engine/scouting'
import { mountIsReady, type ShipState } from '../engine/shipState'
import type { ShieldSide } from '../engine/types'
import { ArcRose } from './ArcRose'
import { dispatch, dispatchWithChoices } from './store'

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
  // Cloaking bars fire outright below Track level and locks a cloaked ship's
  // own weapons (H6.4.2, H6.14).
  // The attacker's own cloak locks its weapons whether or not it has picked a
  // target yet, so that half is computed against itself (H6.4.2).
  const cloak = cloakModifiers(game, attacker, target ?? attacker)
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
  // Asteroid cover (K2.1.8) and the in-field low-speed exemption (K2.2.1).
  const cover = target ? asteroidCoverRerolls(game, attacker, target) : 0
  const targetInField =
    target !== null && asteroidFieldsAt(game.scenario.terrain, target.placement.position).length > 0
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

  const fire = async () => {
    if (!target) return
    const mounts: MountSelection[] = [...selected].map((key) => {
      const [weaponId, indexStr] = key.split('|')
      return { weaponId, mountIndex: Number(indexStr) }
    })

    // One action carries the whole volley: the handler re-derives every
    // modifier from game state, resolves it, and journals the intent.
    const outcome = await dispatchWithChoices({
      type: 'fire-volley',
      attackerId: attacker.id,
      targetId: target.id,
      mounts,
      mode,
      precisionSection: mode === 'precision' ? section : undefined,
      degraded,
    })
    if (outcome.volley) {
      setSelected(new Set())
      setLastResult(outcome.volley)
    } else {
      setLastResult(outcome.message)
    }
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
      {cloak.targetUnshootable && <p className="fire-error">{cloak.targetUnshootable}</p>}
      {cloak.attackerCloaked && (
        <p className="fire-error">{attacker.name} is cloaked and may not fire (H6.4.2).</p>
      )}

      {impactingHoming(game, attacker).length > 0 && (
        <>
          <HomingImpacts game={game} target={attacker} />
          <MissileCatch game={game} defender={attacker} />
        </>
      )}
      {/*
        The playtest that demanded this line: torpedoes impacted a ship the
        player never re-selected, and nothing on screen said so. The engine
        now resolves unanswered impacts when the segment closes — but with
        only the defensive fire that ship actually got off, which is worth a
        warning while its guns can still be pointed at them.
      */}
      {(() => {
        const waiting = game.ships.filter(
          (s) =>
            s.side === attacker.side &&
            s.id !== attacker.id &&
            !s.destroyed &&
            impactingHoming(game, s).length > 0,
        )
        if (waiting.length === 0) return null
        return (
          <p className="fire-error">
            Incoming homing weapons on {waiting.map((s) => s.name).join(' and ')} — select{' '}
            {waiting.length === 1 ? 'it' : 'each'} to fire point defense. Impacts left unanswered
            resolve when the segment ends, with whatever was fired at them (E5.4).
          </p>
        )
      })()}
      {target && <HomingLaunch attacker={attacker} target={target} />}

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
          {target.speed === 0 && !clouds.lowSpeedNegated && !targetInField && (
            <span className="chip chip-warn">Low-speed penalty (C1.5)</span>
          )}
          {cover > 0 && (
            <span className="chip chip-scout" title="K2.1.8 — the defender rerolls this many attack dice">
              Asteroid cover: {cover} reroll{cover === 1 ? '' : 's'}
            </span>
          )}
          {targetInField && target.speed === 0 && (
            <span className="chip chip-scout" title="K2.2.1 — no low-speed penalty inside an asteroid field">
              In the rocks — no low-speed penalty
            </span>
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
                <span className="pick-head">
                  <ArcRose arcs={mount.arcs} size={15} />
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
            cloak.attackerCloaked ||
            cloak.targetUnshootable !== undefined ||
            (game.coordinatedFire && !mayFire)
          }
          onClick={() => void fire()}
        >
          Fire volley
        </button>
        <button
          type="button"
          // Passing can land another ship's held volley (H2.4.2), which is
          // damage, which may be a question for its captain.
          onClick={() => void dispatchWithChoices({ type: 'pass-fire', shipId: attacker.id })}
        >
          Pass
        </button>
      </div>

      {typeof lastResult === 'string' && <p className="fire-error">{lastResult}</p>}

      {/* Secondary fire options sit below the volley so the main button stays
          near the top of the panel. */}
      <SmallTargets game={game} attacker={attacker} />
      <ProbeLaunch game={game} attacker={attacker} />

      {game.coordinatedFire && (
        <button
          type="button"
          className="next-step"
          disabled={step.index === FIRING_STEPS.length}
          onClick={() => dispatch({ type: 'advance-firing-step' })}
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
            {lastResult.targetShield} shield →{' '}
            {lastResult.outcome === null ? (
              <>damage held — tied Tactical Scans resolve simultaneously (H2.4.2)</>
            ) : (
              <>
                {lastResult.outcome.blueAbsorbed + lastResult.outcome.greenAbsorbed} absorbed by
                shields, {lastResult.outcome.armorAbsorbed} by armor, {lastResult.outcome.internal}{' '}
                internal.
              </>
            )}
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
    setError(dispatch({ type: 'declare-coordinated', shipIds: ships.map((s) => s.id), targetId: target.id }).message)
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

/**
 * Homing weapon launches (E5.2). A launch is not a volley: the weapon goes on
 * the map and flies toward its target over the phases that follow.
 */
/**
 * Step 4A — tractor beams may reach out and catch an incoming missile after
 * defensive fire has been rolled (J3.2.2). Every homing weapon in the printed
 * roster is a particle weapon, which cannot be held, so this only ever appears
 * for a missile from a custom design.
 */
function MissileCatch({ game, defender }: { game: GameState; defender: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const catchable = tractorableHoming(game, defender)
  if (catchable.length === 0) return null
  const free = tractorBeamsFree(game, defender)

  return (
    <div className="probe-launch">
      <h4>Tractor beams vs incoming missiles (J3.2.2)</h4>
      <p className="hint">
        {free} beam(s) free. A held missile goes nowhere until it is released, shot away, or runs
        out of endurance — and a released one strikes at once, with no defensive fire.
      </p>
      <div className="builder-row wrap">
        {catchable.map((hw) => (
          <button
            key={hw.id}
            type="button"
            className="chip"
            disabled={free < 1}
            onClick={() =>
              setError(dispatch({ type: 'catch-missile', shipId: defender.id, homingId: hw.id, beams: 1 }).message)
            }
          >
            catch {hw.weaponName}
          </button>
        ))}
      </div>
      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}

/**
 * Firing at shuttles, probes and missiles in flight (E12.4). Point defense
 * weapons fire normally; everything else has to use Degraded Fire Control,
 * which halves the damage.
 */
function SmallTargets({ game, attacker }: { game: GameState; attacker: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState('')
  const targets = smallTargetsFor(game, attacker)
  if (targets.length === 0) return null

  const chosen = targets.find((t) => t.id === targetId)
  const armed = attacker.form.weapons.flatMap((weapon) =>
    weapon.mounts
      .map((_, index) => ({ weapon, index }))
      .filter(({ index }) => {
        const state = attacker.mounts[weapon.id]?.[index]
        return state ? mountIsReady(weapon, index, state) : false
      }),
  )

  return (
    <div className="probe-launch">
      <h4>Small targets (E12.4)</h4>
      <div className="builder-row wrap">
        <label className="field">
          <span>Fire at</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a counter…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.held ? ' (held in your beam)' : ''}
              </option>
            ))}
          </select>
        </label>
        {chosen &&
          armed.map(({ weapon, index }) => {
            const pd = weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
            return (
              <button
                key={`${weapon.id}-${index}`}
                type="button"
                className="chip"
                title={
                  pd
                    ? 'Point defense: full damage (E12.4.3)'
                    : 'No point defense trait: degraded fire control halves the damage (E12.4.4)'
                }
                onClick={async () => {
                  const outcome = await dispatchWithChoices({
                    type: 'fire-small-target',
                    attackerId: attacker.id,
                    targetId: chosen.id,
                    weaponId: weapon.id,
                    mountIndex: index,
                  })
                  setError(outcome.message)
                  if (outcome.destroyed) setTargetId('')
                }}
              >
                {weapon.name} #{index + 1}
                {pd ? ' · PD' : ' · degraded'}
              </button>
            )
          })}
      </div>
      {chosen?.held && (
        <p className="hint">
          Held in your own tractor beam: it is shifted into any arc you like and every die does its
          maximum, so there is nothing to roll (J3.2.5).
        </p>
      )}
      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}

/**
 * Probes go out in the Offensive Fire step alongside homing weapons (J7.2.3).
 * No printed ship carries a dedicated PROB launcher, so in practice a probe
 * rides out of a torpedo tube that has paid its full arming cost (J7.1.3).
 */
function ProbeLaunch({ game, attacker }: { game: GameState; attacker: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const [objectId, setObjectId] = useState('')
  const launchers = probeLaunchers(attacker)
  const objects = scanTargets(game, attacker)
  if (launchers.length === 0 || objects.length === 0) return null

  return (
    <div className="probe-launch">
      <h4>Probes (J7)</h4>
      <div className="builder-row wrap">
        <label className="field">
          <span>Probe</span>
          <select value={objectId} onChange={(e) => setObjectId(e.target.value)}>
            <option value="">Choose an object…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {launchers.map((l) => (
          <button
            key={`${l.weaponId}-${l.mountIndex}`}
            type="button"
            className="chip"
            disabled={!objectId}
            title="Loading a probe costs the tube its full arming cycle (J7.2.2)"
            onClick={() =>
              setError(
                dispatch({
                  type: 'launch-probe',
                  shipId: attacker.id,
                  objectId,
                  weaponId: l.weaponId,
                  mountIndex: l.mountIndex,
                }).message,
              )
            }
          >
            from {l.label}
          </button>
        ))}
      </div>
      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}

function HomingLaunch({ attacker, target }: { attacker: ShipState; target: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const launchers = attacker.form.weapons.filter(isHoming)
  if (launchers.length === 0) return null

  // A launcher bears like any other mount (E2.2), and a ship weaving may not
  // launch at all (E5.2.3) — both shown here rather than left to a refusal.
  const targetArcs = arcTo(
    attacker.placement.position,
    attacker.placement.heading,
    target.placement.position,
  )
  const weaving = attacker.evasive > 0

  return (
    <div className="homing-launch">
      <h4>Homing weapons (E5.2)</h4>
      {weaving && (
        <p className="hint">
          {attacker.name} is weaving {attacker.evasive} point(s) and may not launch this phase
          (E5.2.3).
        </p>
      )}
      <div className="weapon-picker">
        {launchers.map((weapon) =>
          weapon.mounts.map((mount, index) => {
            const state = attacker.mounts[weapon.id][index]
            const bears = canBearOn(mount.arcs, targetArcs)
            const ready = mountIsReady(weapon, index, state) && bears && !weaving
            return (
              <button
                key={`${weapon.id}|${index}`}
                type="button"
                className={`weapon-pick${ready ? '' : ' is-disabled'}`}
                disabled={!ready}
                title={
                  !mountIsReady(weapon, index, state)
                    ? 'Not fully armed (E4.2.3)'
                    : weaving
                      ? 'A ship using evasive maneuvers may not launch (E5.2.3)'
                      : !bears
                        ? `Bears ${mount.arcs.join('/')}; the target is ${targetArcs.join('/')} (E2.2)`
                        : `Endurance ${endurance(weapon)} phases, ${speedInPhase(weapon, 1)}" on the first leg`
                }
                onClick={() =>
                  setError(
                    dispatch({
                      type: 'launch-homing',
                      shipId: attacker.id,
                      weaponId: weapon.id,
                      mountIndex: index,
                      targetId: target.id,
                    }).message,
                  )
                }
              >
                <span className="pick-head">
                  <ArcRose arcs={mount.arcs} size={15} />
                  Launch {weapon.name} #{index + 1}
                </span>
                <em>{endurance(weapon)} phases</em>
              </button>
            )
          }),
        )}
      </div>
      {error && <p className="fire-error">{error}</p>}
    </div>
  )
}

/**
 * Homing weapons that have reached this ship and are waiting to be resolved
 * (E5.4). The defender assigns point defense damage per shield struck, since
 * each shield is its own volley (E5.4 Step 3).
 */
function HomingImpacts({ game, target }: { game: GameState; target: ShipState }) {
  const [error, setError] = useState<string | null>(null)
  const arrived = impactingHoming(game, target)

  const bySide = new Map<ShieldSide, typeof arrived>()
  for (const hw of arrived) {
    const side = hw.forcedShield ?? impactShield(hw, target)
    if (!bySide.has(side)) bySide.set(side, [])
    bySide.get(side)!.push(hw)
  }

  return (
    <div className="homing-impacts">
      <h4>Incoming homing weapons (E5.4)</h4>
      {[...bySide].map(([side, group]) => (
        <div key={side} className="impact-group">
          <h5>
            {group.length} on the {side} shield
          </h5>
          {group.map((hw) => {
            // E5.4 Step 2: the two 45° arcs that make up the struck shield are
            // the ones that may answer.
            const answering = defendingArcs(hw, target)
            const mounts = target.form.weapons.flatMap((weapon) =>
              weapon.mounts.flatMap((mount, index) => {
                const state = target.mounts[weapon.id]?.[index]
                if (!state || !mountIsReady(weapon, index, state)) return []
                if (!canBearOn(mount.arcs, answering)) return []
                return [{ weapon, index }]
              }),
            )
            return (
              <div key={hw.id} className="builder-row wrap">
                <span className="pick-head">
                  {hw.weaponName}
                  {hw.damage > 0 ? ` · ${hw.damage} soaked` : ''}
                </span>
                {mounts.length === 0 ? (
                  <em className="hint">nothing bears on it</em>
                ) : (
                  mounts.map(({ weapon, index }) => {
                    const pd = weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
                    return (
                      <button
                        key={`${weapon.id}-${index}`}
                        type="button"
                        className="chip"
                        title={
                          pd
                            ? 'Point defense: full damage (E12.4.3)'
                            : 'No point defense trait: degraded fire control halves the damage (E12.4.4)'
                        }
                        onClick={async () => {
                          setError(
                            (
                              await dispatchWithChoices({
                                type: 'fire-small-target',
                                attackerId: target.id,
                                targetId: hw.id,
                                weaponId: weapon.id,
                                mountIndex: index,
                              })
                            ).message,
                          )
                        }}
                      >
                        {weapon.name} #{index + 1}
                        {pd ? ' · PD' : ' · degraded'}
                      </button>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      ))}
      <button
        type="button"
        className="primary"
        onClick={() => {
          void dispatchWithChoices({ type: 'resolve-homing-impacts', shipId: target.id })
        }}
      >
        Resolve impacts
      </button>
      {error && <p className="fire-error">{error}</p>}
      <p className="hint">
        Fire the mounts that bear and the dice are rolled for you, the same as any other shot.
        Every three points that land takes one point off a particle weapon&apos;s warhead; a missile
        is destroyed outright once it has taken its <code>MISL X</code> (F1.16.2, F13.2). Impacts
        you do not resolve here go off by themselves — with whatever point defense you did fire —
        when the segment ends (E5.4).
      </p>
    </div>
  )
}
