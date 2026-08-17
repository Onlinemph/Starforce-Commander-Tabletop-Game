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
  type PriceOf,
} from '../engine/fleet'
import { balancedPointValue } from '../engine/fleetValue'
import type { Availability, ShipForm } from '../engine/types'
import { isCanonForm } from '../data/ships'
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
  /**
   * Build (and fight) at the measured battle values instead of the printed
   * list — the scale under which equal points is actually an even fight
   * (engine/fleetValue.ts). The choice travels into the battle: the victory
   * ledger prices every hull at what it was bought for.
   */
  const [balancedPoints, setBalancedPoints] = useState(false)
  const price: PriceOf = useMemo(
    () => (balancedPoints ? balancedPointValue : (form: ShipForm) => form.pointValue),
    [balancedPoints],
  )
  const [terrain, setTerrain] = useState<'none' | 'roll' | 4 | 6 | 8>('none')
  const [aiSides, setAiSides] = useState<Set<string>>(new Set())
  const [aiDifficulty, setAiDifficulty] = useState<'ensign' | 'captain' | 'admiral'>('admiral')
  const [aiPersonality, setAiPersonality] = useState<'steady' | 'aggressive' | 'cautious'>('steady')
  const [aiRetreats, setAiRetreats] = useState(true)
  const [mapScale, setMapScale] = useState<1 | 2>(1)
  const [armedStart, setArmedStart] = useState(false)
  const [optionalBatteries, setOptionalBatteries] = useState(false)
  // E11's optional endgame: derelicts, explosions, and getting the crew off.
  const [derelicts, setDerelicts] = useState(false)
  const [explosions, setExplosions] = useState(false)
  const [abandonShip, setAbandonShip] = useState(false)
  const [decelFromDamage, setDecelFromDamage] = useState(false)

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
        { year, budget: budget ?? undefined, price },
      ),
    [sides, fleets, byId, year, budget, price],
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
      armedStart: armedStart || undefined,
      balancedPoints: balancedPoints || undefined,
      optionalBatteries: optionalBatteries || undefined,
      derelicts: derelicts || undefined,
      // A ship cannot linger long enough to explode or be abandoned unless it
      // lingers at all, so both of those imply derelicts (E11.3, E11.6.2).
      explosions: explosions || undefined,
      abandonShip: abandonShip || undefined,
      decelerationFromDamage: decelFromDamage || undefined,
    })
    onClose()
  }

  /*
    Printed ships and fan-made ones are grouped separately, even when the fan
    design flies a canon flag — which it usually will, since a Union cruiser
    somebody built is meant to be fielded beside the printed ones. Mixing them
    into one list makes the canon roster hard to read and hard to trust; giving
    each faction its own "fan designs" heading underneath keeps the printed
    list exactly as it was while leaving the fan ships where you would look
    for them.
  */
  const visible = useMemo(() => {
    const needle = search.toLowerCase()
    const canon = new Map<string, ShipForm[]>()
    const fan = new Map<string, ShipForm[]>()
    for (const form of roster) {
      if (needle && !form.name.toLowerCase().includes(needle)) continue
      const into = isCanonForm(form.id) ? canon : fan
      const key = isCanonForm(form.id) ? form.faction : `${form.faction} · fan designs`
      if (!into.has(key)) into.set(key, [])
      into.get(key)!.push(form)
    }
    // Every printed faction first, in the order the roster prints them, then
    // the fan sections.
    return new Map([...canon.entries(), ...fan.entries()])
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
          <label
            className="checkbox"
            title="House rule. The printed game opens cold — batteries fill their arming circles from each round's power, and a slow-arming heavy takes several rounds to charge (E4.2.8) — so the first exchanges are fought with half-loaded guns. Tick this and every mount arrives with its circles full, power unspent."
          >
            <input
              type="checkbox"
              checked={armedStart}
              onChange={(e) => setArmedStart(e.target.checked)}
            />
            Weapons armed at start
          </label>
          <label
            className="checkbox"
            title="Optional rule B2.5. Normally a battery is just extra power at Resource Allocation, spent before anyone has moved. Tick this and stored power may be held back and spent during a combat phase's Command Segment instead — a burst of acceleration, a shield repaired on the spot, a fired weapon rearmed. Slow-arming heavies (NoBAT) still cannot be charged from a battery mid-round."
          >
            <input
              type="checkbox"
              checked={optionalBatteries}
              onChange={(e) => setOptionalBatteries(e.target.checked)}
            />
            Batteries usable mid-round (B2.5)
          </label>
          <label
            className="checkbox"
            title="Optional rule E11.2. A ship whose last structure box is marked stops being removed from play and becomes a derelict instead: dead in space, shields gone, no systems but damage control, and a decision for both captains — repair it, abandon it, capture it, or finish it off."
          >
            <input
              type="checkbox"
              checked={derelicts}
              onChange={(e) => {
                setDerelicts(e.target.checked)
                if (!e.target.checked) {
                  setExplosions(false)
                  setAbandonShip(false)
                }
              }}
            />
            Derelict ships (E11.2)
          </label>
          <label
            className="checkbox"
            title="Optional rule E11.3. Damage past the structure track may set off the main reactor: one red die per point of excess damage, and an S takes the ship — and a blue die per size class off everything within an inch of it."
          >
            <input
              type="checkbox"
              disabled={!derelicts}
              checked={explosions}
              onChange={(e) => setExplosions(e.target.checked)}
            />
            Ship explosions (E11.3)
          </label>
          <label
            className="checkbox"
            title="Optional rules E11.4–E11.6. The crew becomes something to play for: two units per size class, worth two victory points each to whoever saves or captures them. Beam them out under emergency protocols and lose some in the transport, or take to the escape pods and hope somebody comes before the enemy does."
          >
            <input
              type="checkbox"
              disabled={!derelicts}
              checked={abandonShip}
              onChange={(e) => setAbandonShip(e.target.checked)}
            />
            Abandon ship (E11.4–E11.6)
          </label>
          <label
            className="checkbox"
            title="Optional rule C4.2. Drive damage that drops a ship's top speed below the speed it is making forces an immediate slowdown, and the slowdown is charged to the same per-round acceleration track a captain spends voluntarily. Everything past the green circles becomes stress at the check — which can damage the drive again, force another slowdown, and take the ship apart."
          >
            <input
              type="checkbox"
              checked={decelFromDamage}
              onChange={(e) => setDecelFromDamage(e.target.checked)}
            />
            Deceleration from damage (C4.2)
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
          <label
            className="field tiny checkbox"
            title="Prices every hull at its measured battle value instead of the printed Master Ship List number — the scale under which equal points is an even fight. Measured across thousands of AI-vs-AI battles: big hulls cost less (a UNION III is 97, not 158.5), small hulls hold their price. The scoreboard prices each hull at what it was bought for."
          >
            <span>Balanced points</span>
            <input
              type="checkbox"
              checked={balancedPoints}
              onChange={(e) => setBalancedPoints(e.target.checked)}
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
                          {price(form)} PV · size {form.sizeClass} · {form.year}{' '}
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
                price={price}
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
  price,
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
  price: PriceOf
  problems: ReturnType<typeof validateFleets>
  ai: boolean
  onAi: (on: boolean) => void
  onAdjust: (formId: string, delta: number) => void
  onReset: () => void
}) {
  const total = fleetPoints(entries, forms, price)
  const hulls = fleetSize(entries)
  return (
    <section className={`fleet-side picker-${side.split(' ')[0].toLowerCase()}`}>
      <header>
        <h3>{side}</h3>
        <span className="fleet-total">
          {total} PV · {hulls}/{MAX_SHIPS_PER_SIDE} hulls
          {budget !== null && ` · ${budget - total >= 0 ? `${budget - total} left` : 'over budget'}`}
        </span>
        {/*
          Which side the computer commands is the single most consequential
          box on this screen, and it used to read as a bare "AI" that was easy
          to miss on one force. A side left unticked and unplayed does not put
          up a fight — it is destroyed without ever firing, and the battle
          reads as a rout by a ship that was never tested. So it says which it
          is, either way.
        */}
        <label
          className={ai ? 'checkbox ai-toggle is-on' : 'checkbox ai-toggle'}
          title={
            ai
              ? 'The computer commands this force — it allocates, plots, fires and repairs on its own as you play through the segments.'
              : 'Nobody is assigned to this force. Tick this to hand it to the computer, or plan to give its orders yourself — a force with no orders never fights back.'
          }
        >
          <input type="checkbox" checked={ai} onChange={(e) => onAi(e.target.checked)} />
          {ai ? 'AI commands' : 'You command'}
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
              <span className="fleet-points">{Math.round(price(form) * entry.count * 10) / 10}</span>
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
