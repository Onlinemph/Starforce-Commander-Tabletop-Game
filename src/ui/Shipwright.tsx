/**
 * The Shipwright — the focused, budgeted way to build a ship (the third
 * construction system, per the designer). Pick a faction, a generation and a
 * canon chassis; the hull IS the budget. Arm it from the canon weapon
 * catalog — each weapon size-floored and tech-gated, faction-locked unless
 * the catalog is opened — and the envelope (src/data/shipwright.ts) refuses
 * what the fiction never fielded. Designs save as ordinary custom forms, so
 * they fight duels, fleets and campaigns, and the freeform builder can still
 * open one for fine surgery afterward.
 */

import { useMemo, useState } from 'react'
import { CANON_FACTIONS } from '../data/ships'
import {
  addCatalogWeapon,
  ARC_PRESETS,
  buildChassis,
  catalogFor,
  chassisOptions,
  removeWeapon,
  shipwrightBudget,
  shipwrightViolations,
  TECH_LEVELS,
  weaponFloor,
  type CatalogWeapon,
} from '../data/shipwright'
import { pointValue } from '../engine/shipBuilder'
import type { ShipForm } from '../engine/types'
import { saveCustomForm } from './customShips'
import { newGame } from './store'
import { BLUE, RED } from '../data/scenarios'

interface Props {
  onClose: () => void
}

export function Shipwright({ onClose }: Props) {
  const [faction, setFaction] = useState<string>(CANON_FACTIONS[0])
  const [techLevel, setTechLevel] = useState(3)
  const [openCatalog, setOpenCatalog] = useState(false)
  const [className, setClassName] = useState('NEW DESIGN-class Cruiser')
  const [draft, setDraft] = useState<ShipForm | null>(null)
  const [pick, setPick] = useState<string>('')
  const [pickMounts, setPickMounts] = useState(1)
  const [pickArcs, setPickArcs] = useState<string>('printed')
  const [status, setStatus] = useState<string | null>(null)

  const yards = useMemo(() => chassisOptions(faction, techLevel), [faction, techLevel])
  const shop = useMemo(
    () =>
      draft
        ? catalogFor({ faction: draft.faction, sizeClass: draft.sizeClass, techLevel, openCatalog })
        : [],
    [draft, techLevel, openCatalog],
  )
  const budget = draft ? shipwrightBudget(draft) : null
  const violations = draft ? shipwrightViolations(draft, { techLevel, openCatalog }) : []

  const layDown = (donorId: string) => {
    const hull = buildChassis(donorId, className.trim() || 'NEW DESIGN')
    if (typeof hull === 'string') {
      setStatus(hull)
      return
    }
    setDraft(hull)
    setPick('')
    setStatus(null)
  }

  const mutate = (fn: (form: ShipForm) => void) => {
    if (!draft) return
    const next = structuredClone(draft)
    fn(next)
    setDraft(next)
  }

  const addPicked = () => {
    const entry = shop.find((e) => e.key === pick)
    if (!entry) return
    mutate((form) =>
      addCatalogWeapon(
        form,
        entry,
        pickMounts,
        pickArcs === 'printed' ? undefined : (pickArcs as keyof typeof ARC_PRESETS),
      ),
    )
  }

  const save = () => {
    if (!draft) return
    const priced = structuredClone(draft)
    priced.name = className.trim() || priced.name
    priced.pointValue = Math.round(pointValue(priced).points * 2) / 2
    saveCustomForm(priced)
    setDraft(priced)
    setStatus(
      `Saved “${priced.name}” (${priced.pointValue} pts) as a local draft — it is ready for fleets and campaigns.`,
    )
  }

  const testFly = () => {
    if (!draft) return
    save()
    newGame({
      scenarioId: 's3.1-the-duel',
      seed: Math.floor(Math.random() * 1e9),
      forms: { [BLUE]: draft.id },
      aiSides: [RED],
    })
    onClose()
  }

  const meter = (label: string, used: number, cap: number) => (
    <li key={label} className={used > cap ? 'wright-meter over' : 'wright-meter'}>
      <span>{label}</span>
      <strong>
        {used}/{cap}
      </strong>
    </li>
  )

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Shipwright">
      <div className="picker builder">
        <header>
          <h2>Shipwright</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="builder-where">
          The hull is the budget: pick a canon chassis, then arm it from the printed catalog. Every
          cap comes from what the fiction actually fielded at that size and generation — the
          freeform Ship builder remains for unrestricted work.
        </p>

        <div className="builder-toolbar">
          <label className="field">
            <span>Faction</span>
            <select
              value={faction}
              onChange={(e) => {
                setFaction(e.target.value)
                setDraft(null)
              }}
            >
              {CANON_FACTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Generation</span>
            <select
              value={techLevel}
              onChange={(e) => {
                setTechLevel(Number(e.target.value))
                setDraft(null)
              }}
            >
              {TECH_LEVELS.map((tl) => (
                <option key={tl.level} value={tl.level}>
                  {tl.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Class name</span>
            <input value={className} onChange={(e) => setClassName(e.target.value)} />
          </label>
          {status && <span className="builder-status">{status}</span>}
        </div>

        {!draft && (
          <div className="wright-yard">
            <h3>Lay down a chassis</h3>
            <ul className="wright-chassis-list">
              {yards.map((c) => (
                <li key={c.donorId}>
                  <button type="button" onClick={() => layDown(c.donorId)}>
                    <strong>{c.label}</strong>
                    <span>
                      size {c.sizeClass} · {c.year} · hull {c.hullPower} of {c.powerBudget} power
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {draft && budget && (
          <div className="builder-body">
            <div className="builder-form">
              <h3>
                {className || draft.name}
                <button type="button" className="wright-back" onClick={() => setDraft(null)}>
                  Change chassis
                </button>
              </h3>

              <section className="builder-section">
                <h4>Armament</h4>
                {draft.weapons.length === 0 && <p className="hint">No weapons aboard yet.</p>}
                <ul className="wright-weapon-list">
                  {draft.weapons.map((w) => (
                    <li key={w.id}>
                      <strong>{w.name}</strong>
                      <span>
                        {w.mounts.length} mount{w.mounts.length === 1 ? '' : 's'} ·{' '}
                        {w.mounts[0].arcs.join('/')}
                      </span>
                      <button type="button" onClick={() => mutate((f) => removeWeapon(f, w.id))}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="wright-shop">
                  <label className="field">
                    <span>Catalog</span>
                    <select value={pick} onChange={(e) => setPick(e.target.value)}>
                      <option value="">— pick a weapon —</option>
                      {shop.map((e: CatalogWeapon) => (
                        <option key={e.key} value={e.key}>
                          {e.key}
                          {e.heavy ? ' · heavy' : ''} · size {weaponFloor(e)}+ · {e.introYear}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Mounts</span>
                    <input
                      type="number"
                      min={1}
                      max={budget.envelope.maxMounts}
                      value={pickMounts}
                      onChange={(e) => setPickMounts(Math.max(1, Math.round(Number(e.target.value))))}
                    />
                  </label>
                  <label className="field">
                    <span>Arcs</span>
                    <select value={pickArcs} onChange={(e) => setPickArcs(e.target.value)}>
                      <option value="printed">As printed</option>
                      {Object.keys(ARC_PRESETS).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={!pick} onClick={addPicked}>
                    Fit weapon
                  </button>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={openCatalog}
                    onChange={(e) => setOpenCatalog(e.target.checked)}
                  />
                  Open catalog — fit other factions&apos; hardware (marked on the form)
                </label>
              </section>

              {violations.length > 0 && (
                <section className="builder-section wright-violations">
                  <h4>The yard refuses</h4>
                  <ul>
                    {violations.map((v, i) => (
                      <li key={i}>{v.message}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="builder-cost">
              <h4>Hull budget — size {draft.sizeClass}</h4>
              <ul className="wright-meters">
                {meter('Actual power', budget.power, budget.envelope.powerBudget)}
                {meter('Mounts', budget.mounts, budget.envelope.maxMounts)}
                {meter('Heavy mounts', budget.heavyMounts, budget.envelope.maxHeavyMounts)}
                {meter('Weapon systems', budget.weaponSystems, budget.envelope.maxWeaponSystems)}
                {meter('System boxes', budget.systemBoxes, budget.envelope.maxSystemBoxes)}
                {meter('Shield boxes', budget.shieldTotal, budget.envelope.maxShieldTotal)}
                {meter('Structure', budget.structureBoxes, budget.envelope.maxStructureBoxes)}
              </ul>
              <div className="builder-launch">
                <button type="button" disabled={violations.length > 0} onClick={save}>
                  Save design
                </button>
                <button type="button" disabled={violations.length > 0} onClick={testFly}>
                  Test flight vs AI
                </button>
              </div>
              {violations.length > 0 && (
                <p className="hint">Clear the yard&apos;s refusals to save or fly.</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
