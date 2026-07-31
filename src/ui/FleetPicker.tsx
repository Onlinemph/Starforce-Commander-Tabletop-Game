import { useMemo, useState } from 'react'
import { allShipForms } from '../data/ships'
import { printedForce, scenarioSides, SCENARIOS } from '../data/scenarios'
import {
  availabilityIn,
  AVAILABILITY_RULE,
  fleetFormIds,
  fleetPoints,
  fleetSize,
  MAX_SHIPS_PER_SIDE,
  validateFleets,
  type FleetEntry,
} from '../engine/fleet'
import type { Availability, ShipForm } from '../engine/types'
import { useCustomForms } from './customShips'
import { resetGame } from './store'

/**
 * Force composition before a battle (S2.5).
 *
 * A scenario prints a force for each side, so that is what this opens with and
 * what "Reset to printed force" puts back. From there the players may compose
 * their own, subject to the availability limits of S2.5.4 — which depend on the
 * year the battle is fought, not just on the rarity printed on the form.
 */

interface Props {
  scenarioId: string
  onClose: () => void
}

type Fleets = Record<string, FleetEntry[]>

const RARITY_CLASS: Record<Availability | 'unavailable', string> = {
  common: 'rarity-common',
  uncommon: 'rarity-uncommon',
  rare: 'rarity-rare',
  unique: 'rarity-unique',
  unavailable: 'rarity-unavailable',
}

function printedFleets(scenarioId: string): Fleets {
  const fleets: Fleets = {}
  for (const side of scenarioSides(scenarioId)) {
    const entries: FleetEntry[] = []
    for (const id of printedForce(scenarioId, side)) {
      const existing = entries.find((e) => e.formId === id)
      if (existing) existing.count += 1
      else entries.push({ formId: id, count: 1 })
    }
    fleets[side] = entries
  }
  return fleets
}

export function FleetPicker({ scenarioId, onClose }: Props) {
  const custom = useCustomForms()
  const roster = useMemo(() => allShipForms(), [custom])
  const byId = useMemo(() => new Map(roster.map((f) => [f.id, f])), [roster])

  const [scenario, setScenario] = useState(scenarioId)
  const [fleets, setFleets] = useState<Fleets>(() => printedFleets(scenarioId))
  const sides = useMemo(() => scenarioSides(scenario), [scenario])
  const [activeSide, setActiveSide] = useState(sides[0])
  const [search, setSearch] = useState('')
  const [ignoreLimits, setIgnoreLimits] = useState(false)

  /**
   * Late enough that every class is at the availability its form prints. Dial
   * it back to fight a period battle, where new classes are still rare.
   */
  const latestYear = useMemo(
    () => Math.max(...roster.map((f) => f.year ?? 0)) + 2,
    [roster],
  )
  const [year, setYear] = useState(latestYear)
  const [budget, setBudget] = useState<number | null>(null)

  const changeScenario = (id: string) => {
    setScenario(id)
    setFleets(printedFleets(id))
    setActiveSide(scenarioSides(id)[0])
  }

  const adjust = (side: string, formId: string, delta: number) =>
    setFleets((current) => {
      const entries = [...(current[side] ?? [])]
      const i = entries.findIndex((e) => e.formId === formId)
      if (i < 0) {
        if (delta > 0) entries.push({ formId, count: delta })
      } else {
        const count = entries[i].count + delta
        if (count <= 0) entries.splice(i, 1)
        else entries[i] = { ...entries[i], count }
      }
      return { ...current, [side]: entries }
    })

  const problems = useMemo(
    () =>
      validateFleets(
        sides.map((side) => ({ side, entries: fleets[side] ?? [] })),
        byId,
        { year, budget: budget ?? undefined },
      ),
    [sides, fleets, byId, year, budget],
  )
  const errors = problems.filter((p) => p.severity === 'error')
  const blocked = errors.length > 0 && !ignoreLimits
  // An empty force is a hole in the battle, not a rule you may waive.
  const empty = sides.some((side) => fleetSize(fleets[side] ?? []) === 0)

  const start = () => {
    resetGame(scenario, {
      fleets: Object.fromEntries(sides.map((s) => [s, fleetFormIds(fleets[s] ?? [])])),
      seed: Math.floor(Math.random() * 1e9),
    })
    onClose()
  }

  const visible = useMemo(() => {
    const needle = search.toLowerCase()
    const groups = new Map<string, ShipForm[]>()
    for (const form of roster) {
      if (needle && !form.name.toLowerCase().includes(needle)) continue
      if (!groups.has(form.faction)) groups.set(form.faction, [])
      groups.get(form.faction)!.push(form)
    }
    return groups
  }, [roster, search])

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Choose forces">
      <div className="picker fleet-picker">
        <header>
          <h2>Choose forces</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="picker-controls">
          <label className="field">
            <span>Scenario</span>
            <select value={scenario} onChange={(e) => changeScenario(e.target.value)}>
              {SCENARIOS.map(({ scenario: s }) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field tiny" title="S2.5.4 — a class is Rare in its first year of service, Uncommon in its second, Common thereafter">
            <span>Battle year</span>
            <input
              type="number"
              value={year}
              min={2000}
              max={9999}
              onChange={(e) => setYear(Number(e.target.value) || latestYear)}
            />
          </label>
          <label className="field tiny">
            <span>Point budget</span>
            <input
              type="number"
              value={budget ?? ''}
              min={0}
              placeholder="none"
              onChange={(e) => setBudget(e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
          <label className="field grow">
            <span>Filter roster ({roster.length} ships)</span>
            <input
              type="search"
              value={search}
              placeholder="Yorktown, Raider, Dreadnought…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="fleet-body">
          <div className="fleet-roster">
            <div className="fleet-side-tabs">
              <span>Add to</span>
              {sides.map((side) => (
                <button
                  key={side}
                  type="button"
                  className={`chip${side === activeSide ? ' is-on' : ''}`}
                  onClick={() => setActiveSide(side)}
                >
                  {side}
                </button>
              ))}
            </div>
            <div className="roster">
              {[...visible.entries()].map(([faction, forms]) => (
                <div key={faction}>
                  <h4>{faction}</h4>
                  {forms.map((form) => {
                    const rarity = availabilityIn(form, year)
                    return (
                      <button
                        key={form.id}
                        type="button"
                        className="roster-row"
                        disabled={rarity === 'unavailable'}
                        onClick={() => adjust(activeSide, form.id, 1)}
                        title={
                          rarity === 'unavailable'
                            ? `Enters service in ${form.year} (S2.5.4).`
                            : AVAILABILITY_RULE[rarity]
                        }
                      >
                        <span className="roster-name">{form.name}</span>
                        <span className="roster-meta">
                          {form.pointValue} PV · size {form.sizeClass} · {form.year}{' '}
                          <em className={RARITY_CLASS[rarity]}>{rarity}</em>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="fleet-sides">
            {sides.map((side) => (
              <ForceList
                key={side}
                side={side}
                entries={fleets[side] ?? []}
                forms={byId}
                year={year}
                budget={budget}
                problems={problems.filter((p) => p.side === side)}
                onAdjust={(formId, delta) => adjust(side, formId, delta)}
                onReset={() =>
                  setFleets((current) => ({ ...current, [side]: printedFleets(scenario)[side] }))
                }
              />
            ))}
          </div>
        </div>

        <footer className="fleet-footer">
          {errors.length > 0 && (
            <label className="checkbox" title="A scenario's own force composition overrides S2.5.4 (S2.5.1)">
              <input
                type="checkbox"
                checked={ignoreLimits}
                onChange={(e) => setIgnoreLimits(e.target.checked)}
              />
              Fight anyway — the scenario sets the force
            </label>
          )}
          <button type="button" className="primary" disabled={blocked || empty} onClick={start}>
            Start battle
          </button>
        </footer>
      </div>
    </div>
  )
}

function ForceList({
  side,
  entries,
  forms,
  year,
  budget,
  problems,
  onAdjust,
  onReset,
}: {
  side: string
  entries: FleetEntry[]
  forms: Map<string, ShipForm>
  year: number
  budget: number | null
  problems: ReturnType<typeof validateFleets>
  onAdjust: (formId: string, delta: number) => void
  onReset: () => void
}) {
  const total = fleetPoints(entries, forms)
  const hulls = fleetSize(entries)
  return (
    <section className={`fleet-side picker-${side.split(' ')[0].toLowerCase()}`}>
      <header>
        <h3>{side}</h3>
        <span className="fleet-total">
          {total} PV · {hulls}/{MAX_SHIPS_PER_SIDE} hulls
          {budget !== null && ` · ${budget - total >= 0 ? `${budget - total} left` : 'over budget'}`}
        </span>
        <button type="button" className="chip" onClick={onReset}>
          printed force
        </button>
      </header>

      {entries.length === 0 && <p className="fleet-empty">No ships. Pick some from the roster.</p>}

      <ul className="fleet-list">
        {entries.map((entry) => {
          const form = forms.get(entry.formId)
          if (!form) return null
          const rarity = availabilityIn(form, year)
          return (
            <li key={entry.formId}>
              <span className="fleet-count">
                <button type="button" className="chip" onClick={() => onAdjust(entry.formId, -1)}>
                  −
                </button>
                <b>{entry.count}</b>
                <button type="button" className="chip" onClick={() => onAdjust(entry.formId, 1)}>
                  +
                </button>
              </span>
              <span className="fleet-name">
                {form.name}
                <em className={RARITY_CLASS[rarity]}>{rarity}</em>
              </span>
              <span className="fleet-points">{form.pointValue * entry.count}</span>
            </li>
          )
        })}
      </ul>

      {problems.length > 0 && (
        <ul className="design-problems">
          {problems.map((p, i) => (
            <li key={i} className={p.severity}>
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
