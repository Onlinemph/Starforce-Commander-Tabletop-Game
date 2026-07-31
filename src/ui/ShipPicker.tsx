import { useMemo, useState } from 'react'
import { allShipForms, SHIP_FORMS } from '../data/ships'
import { BLUE, RED, SCENARIOS } from '../data/scenarios'
import type { ShipForm } from '../engine/types'
import { useCustomForms } from './customShips'
import { resetGame } from './store'

/**
 * Force selection before a battle (S2.5). Ships are drawn from the Master Ship
 * Book roster, with the availability limits and point values the Master Ship
 * List prints (S2.5.4, S2.8.3).
 */

const AVAILABILITY_NOTE: Record<string, string> = {
  common: 'No limit on numbers (S2.5.4).',
  uncommon: 'At most 40% of a force by point value (S2.5.4).',
  rare: 'At most 20% of a force by point value (S2.5.4).',
  unique: 'Only one may appear in a battle (S2.5.4).',
}

interface Props {
  scenarioId: string
  current: Partial<Record<string, string>>
  onClose: () => void
}

export function ShipPicker({ scenarioId, current, onClose }: Props) {
  const [scenario, setScenario] = useState(scenarioId)
  const [picks, setPicks] = useState<Record<string, string>>({
    [BLUE]: current[BLUE] ?? SHIP_FORMS.find((f) => f.faction.startsWith('Union'))!.id,
    [RED]: current[RED] ?? SHIP_FORMS.find((f) => f.faction.startsWith('Vallari'))!.id,
  })
  const [search, setSearch] = useState('')
  // Custom designs sit alongside the canon roster, grouped under their own
  // faction name so they never masquerade as printed ships.
  const custom = useCustomForms()
  const roster = useMemo(() => allShipForms(), [custom])

  const byFaction = useMemo(() => {
    const groups = new Map<string, ShipForm[]>()
    for (const form of roster) {
      if (search && !form.name.toLowerCase().includes(search.toLowerCase())) continue
      if (!groups.has(form.faction)) groups.set(form.faction, [])
      groups.get(form.faction)!.push(form)
    }
    return groups
  }, [search, roster])

  const start = () =>
    resetGame(scenario, { forms: picks, seed: Math.floor(Math.random() * 1e9) })

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Choose forces">
      <div className="picker">
        <header>
          <h2>Choose forces</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="picker-controls">
          <label className="field">
            <span>Scenario</span>
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {SCENARIOS.map(({ scenario: s }) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Filter roster ({roster.length} ships)</span>
            <input
              type="search"
              value={search}
              placeholder="Yorktown, Raider, Dreadnought…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="picker-sides">
          {[BLUE, RED].map((side) => (
            <section key={side} className={`picker-side picker-${side.startsWith('Blue') ? 'blue' : 'red'}`}>
              <h3>{side}</h3>
              <SelectedSummary form={roster.find((f) => f.id === picks[side])} />
              <div className="roster">
                {[...byFaction.entries()].map(([faction, forms]) => (
                  <div key={faction}>
                    <h4>{faction}</h4>
                    {forms.map((form) => (
                      <button
                        key={form.id}
                        type="button"
                        className={`roster-row${picks[side] === form.id ? ' is-picked' : ''}`}
                        onClick={() => setPicks((p) => ({ ...p, [side]: form.id }))}
                        title={AVAILABILITY_NOTE[form.availability ?? 'common']}
                      >
                        <span className="roster-name">{form.name}</span>
                        <span className="roster-meta">
                          {form.pointValue} PV · size {form.sizeClass} · {form.year} · {form.availability}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer>
          <button
            type="button"
            className="primary"
            onClick={() => {
              start()
              onClose()
            }}
          >
            Start battle
          </button>
        </footer>
      </div>
    </div>
  )
}

function SelectedSummary({ form }: { form: ShipForm | undefined }) {
  if (!form) return null
  const power = form.reactors.reduce((n, r) => n + r.points.length, 0)
  const structure = form.structure.filter((e) => e.kind === 'box').length
  const shields = Object.values(form.shields.blue).reduce((a, b) => a + b, 0)
  return (
    <div className="picked-summary">
      <strong>{form.name}</strong>
      <dl>
        <div>
          <dt>Power</dt>
          <dd>
            {power}+{form.batteries}
          </dd>
        </div>
        <div>
          <dt>Shields</dt>
          <dd>{shields}</dd>
        </div>
        <div>
          <dt>Structure</dt>
          <dd>{structure}</dd>
        </div>
        <div>
          <dt>Max spd</dt>
          <dd>{form.sublight.maxSpeed}</dd>
        </div>
        <div>
          <dt>Dmg Ctl</dt>
          <dd>{form.damageControlRating}</dd>
        </div>
      </dl>
      <ul className="picked-weapons">
        {form.weapons.map((w) => (
          <li key={w.id}>
            {w.mounts.length}× {w.name}
            <em>
              {' '}
              — {w.brackets[0].min}–{w.brackets[w.brackets.length - 1].max}&quot;
              {w.traits.length > 0 ? ` · ${w.traits.join(', ')}` : ''}
            </em>
          </li>
        ))}
      </ul>
      {form.notes && <p className="picked-note">{form.notes}</p>}
    </div>
  )
}
