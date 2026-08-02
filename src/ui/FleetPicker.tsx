import { useMemo, useState } from 'react'
import { allShipForms } from '../data/ships'
import { allScenarioEntries, printedForce, scenarioSides } from '../data/scenarios'
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
import { useCustomScenarios } from './customScenarios'
import { newGame } from './store'

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
  // Keeps the scenario list current when a design is saved mid-session.
  useCustomScenarios()
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
  const [terrain, setTerrain] = useState<'none' | 'roll' | 4 | 6 | 8>('none')
  const [aiSides, setAiSides] = useState<Set<string>>(new Set())
  const [aiDifficulty, setAiDifficulty] = useState<'ensign' | 'captain' | 'admiral'>('captain')
  const [aiPersonality, setAiPersonality] = useState<'steady' | 'aggressive' | 'cautious'>('steady')
  const [aiRetreats, setAiRetreats] = useState(true)
  const [mapScale, setMapScale] = useState<1 | 2>(1)

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
    const ai = sides.filter((s) => aiSides.has(s))
    newGame({
      scenarioId: scenario,
      seed: Math.floor(Math.random() * 1e9),
      fleets: Object.fromEntries(sides.map((s) => [s, fleetFormIds(fleets[s] ?? [])])),
      terrain: terrain === 'none' ? undefined : terrain,
      aiSides: ai.length > 0 ? ai : undefined,
      aiDifficulty: ai.length > 0 ? aiDifficulty : undefined,
      aiPersonality: ai.length > 0 && aiPersonality !== 'steady' ? aiPersonality : undefined,
      aiRetreats: ai.length > 0 && !aiRetreats ? false : undefined,
      mapScale: mapScale !== 1 ? mapScale : undefined,
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
              {allScenarioEntries().map(({ scenario: s }) => (
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
          <label
            className="field tiny"
            title="K1.1 — asteroid fields from the printed counter sheet, on top of the scenario's own terrain. 'Roll' rolls the yellow die: miss none, L 4, M 6, H 8."
          >
            <span>Terrain</span>
            <select
              value={String(terrain)}
              onChange={(e) => {
                const v = e.target.value
                setTerrain(v === 'none' || v === 'roll' ? v : (Number(v) as 4 | 6 | 8))
              }}
            >
              <option value="none">Open space</option>
              <option value="roll">Roll (K1.1)</option>
              <option value="4">4 fields</option>
              <option value="6">6 fields</option>
              <option value="8">8 fields</option>
            </select>
          </label>
          <label
            className="field tiny"
            title="Deep space doubles the printed map in both directions. Measured: room to turn, repair and reload turns a lone out-reached capital's 0–24 massacre into a 9–15 fight — envelopment only beats reach when the walls are close."
          >
            <span>Map size</span>
            <select
              value={String(mapScale)}
              onChange={(e) => setMapScale(Number(e.target.value) === 2 ? 2 : 1)}
            >
              <option value="1">Printed (36")</option>
              <option value="2">Deep space (72")</option>
            </select>
          </label>
          {[...aiSides].some((s) => sides.includes(s)) && (
            <label
              className="field tiny"
              title="Ensign: does not lead targets, sometimes takes the second-best plot, shoots whatever is closest, no exotic systems. Captain: full doctrine — cloaks, homing weapons, point defense, scouts. Admiral: adds tractor captures, boarding actions, proximity fire and harder focus."
            >
              <span>AI level</span>
              <select
                value={aiDifficulty}
                onChange={(e) => setAiDifficulty(e.target.value as 'ensign' | 'captain' | 'admiral')}
              >
                <option value="ensign">Ensign</option>
                <option value="captain">Captain</option>
                <option value="admiral">Admiral</option>
              </select>
            </label>
          )}
          {[...aiSides].some((s) => sides.includes(s)) && (
            <label
              className="field tiny"
              title="How the computer reads the scoreboard. Steady plays it straight. Aggressive presses unless clearly ahead and barely protects a lead. Cautious protects early and presses only from deep in the hole."
            >
              <span>AI temperament</span>
              <select
                value={aiPersonality}
                onChange={(e) =>
                  setAiPersonality(e.target.value as 'steady' | 'aggressive' | 'cautious')
                }
              >
                <option value="steady">Steady</option>
                <option value="aggressive">Aggressive</option>
                <option value="cautious">Cautious</option>
              </select>
            </label>
          )}
          {[...aiSides].some((s) => sides.includes(s)) && (
            <label
              className="field tiny checkbox"
              title="Checked: the computer plays the scoreboard — cripples go home, and an admiral refuses hopeless odds outright (a disengaged ship concedes only its damage level, S2.8.4). Unchecked: every AI hull stands and fights to the last box."
            >
              <span>AI may retreat</span>
              <input
                type="checkbox"
                checked={aiRetreats}
                onChange={(e) => setAiRetreats(e.target.checked)}
              />
            </label>
          )}
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
                ai={aiSides.has(side)}
                onAi={(on) =>
                  setAiSides((current) => {
                    const next = new Set(current)
                    if (on) next.add(side)
                    else next.delete(side)
                    return next
                  })
                }
                onAdjust={(formId, delta) => adjust(side, formId, delta)}
                onReset={() =>
                  setFleets((current) => ({ ...current, [side]: printedFleets(scenario)[side] }))
                }
              />
            ))}
          </div>
        </div>

        <footer className="fleet-footer">
          {/*
            Only a force that cannot physically deploy stops a battle now —
            an empty side, more hulls than the setup zone holds, or a budget
            the player themselves set. S2.5.4's rarity limits are shown as
            advice and never bar the way: a scenario's own composition
            overrides them anyway (S2.5.1), and a table that refuses to deal
            the cards is worse than one that lets a friendly game bend a
            tournament rule.
          */}
          {errors.length > 0 && (
            <label className="checkbox" title="Overrides the remaining hard limits — an over-budget force, or more hulls than the setup zone holds">
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
  ai,
  onAi,
  onAdjust,
  onReset,
}: {
  side: string
  entries: FleetEntry[]
  forms: Map<string, ShipForm>
  year: number
  budget: number | null
  problems: ReturnType<typeof validateFleets>
  ai: boolean
  onAi: (on: boolean) => void
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
        <label className="checkbox" title="The computer commands this force — it allocates, plots, fires and repairs on its own as you play through the segments">
          <input type="checkbox" checked={ai} onChange={(e) => onAi(e.target.checked)} />
          AI
        </label>
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
