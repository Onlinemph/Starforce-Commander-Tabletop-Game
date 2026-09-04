/**
 * The Sensor Lab — the designer's workbook, live (his ask: "a spreadsheet
 * similar in format to the one I sent you, that allows us designers to enter
 * data for various situations… to ensure the results are to our liking and
 * that they make sense").
 *
 * Pick a real ship on each side, describe the situation, and read what the
 * CAMPAIGN would compute — every number here comes from `campaign/sensorLab.ts`,
 * which builds its actors through the campaign's own `unitActor` and calls the
 * same `sensorModel.ts` functions the sweep does. Nothing is modelled twice.
 *
 * Three things the sheet could not do, and the reason this is a tool: the
 * per-round truth (sixteen scans, so 5% a scan is 56% a round), the whole
 * range curve at once, and an approach simulation that rolls the real odds
 * phase by phase while two ships close.
 */

import { useMemo, useState } from 'react'
import {
  approachTrials,
  cloakCapable,
  cloakEffective,
  effectiveSpeed,
  rangeSweep,
  readSituation,
  sweepCsv,
  type ApproachResult,
  type LabShipSetup,
  type LabSituation,
} from '../campaign/sensorLab'
import { allShipForms, SHIP_FORMS } from '../data/ships'
import type { ShipForm } from '../engine/types'
import { useCustomForms } from './customShips'

interface Props {
  onClose: () => void
}

const TERRAIN = [
  { value: 0, label: 'Clear space' },
  { value: 1, label: 'System or dust (1)' },
  { value: 2, label: 'Nebula (2)' },
]

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const pct2 = (p: number) => `${(p * 100).toFixed(2)}%`

function defaultSetup(form: ShipForm, speed: number): LabShipSetup {
  return {
    form,
    speed,
    active: false,
    cloaked: false,
    damage: 'fresh',
    shipCount: 1,
    formation: 'standard',
    terrain: 0,
    civilian: false,
  }
}

export function SensorLab({ onClose }: Props) {
  const custom = useCustomForms()
  const roster = useMemo(() => allShipForms(), [custom])
  const byFaction = useMemo(() => {
    const groups = new Map<string, ShipForm[]>()
    for (const form of roster) {
      const list = groups.get(form.faction) ?? []
      list.push(form)
      groups.set(form.faction, list)
    }
    return [...groups.entries()]
  }, [roster])

  const start = (id: string, fallback: number) =>
    roster.find((f) => f.id === id) ?? roster[fallback] ?? SHIP_FORMS[0]

  /*
   * The workbook's own worked example, so the lab opens on the pairing the
   * designer calibrated against: a heavy cruiser holding station and
   * listening for a small fast scout at range four. It also opens mid-curve
   * — 15% a scan, 92% over the round — which is the lab's whole lesson.
   */
  const [searcher, setSearcher] = useState<LabShipSetup>(() =>
    defaultSetup(start('union-yorktown-ii-class-heavy-cruiser', 0), 0),
  )
  const [target, setTarget] = useState<LabShipSetup>(() =>
    defaultSetup(start('vallari-v-2p-flanker-class-scout', 1), 4),
  )
  const [range, setRange] = useState(4)
  const [between, setBetween] = useState(0)
  const [previousRange, setPreviousRange] = useState(4)
  const [maxRange, setMaxRange] = useState(10)
  const [startRange, setStartRange] = useState(10)
  const [trials, setTrials] = useState(500)
  const [seed, setSeed] = useState(12345)
  const [approach, setApproach] = useState<ApproachResult | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const situation: LabSituation = {
    searcher,
    target,
    range,
    interveningTerrain: between,
    previousRange,
  }
  const reading = useMemo(() => readSituation(situation), [situation])
  const sweep = useMemo(() => rangeSweep(situation, maxRange), [situation, maxRange])

  const shipPicker = (setup: LabShipSetup, onPick: (form: ShipForm) => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <select
        value={setup.form.id}
        onChange={(e) => {
          const form = roster.find((f) => f.id === e.target.value)
          if (form) onPick(form)
        }}
      >
        {byFaction.map(([faction, forms]) => (
          <optgroup key={faction} label={faction}>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )

  /** One side's inputs. The searcher hides the fields only a target uses. */
  const sidePanel = (
    which: 'searcher' | 'target',
    setup: LabShipSetup,
    set: (next: LabShipSetup) => void,
  ) => {
    const edit = (patch: Partial<LabShipSetup>) => set({ ...setup, ...patch })
    const capped = effectiveSpeed(setup)
    const cloakOk = cloakCapable(setup.form)
    return (
      <section className="lab-side">
        <h3>{which === 'searcher' ? 'Searching ship' : 'Target'}</h3>
        {shipPicker(setup, (form) => edit({ form, cloaked: false }), 'Class')}
        <label className="field">
          <span>Speed (hexes/round)</span>
          <input
            type="number"
            min={0}
            max={12}
            value={setup.speed}
            onChange={(e) => edit({ speed: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
          />
        </label>
        {capped !== setup.speed && (
          <p className="hint">
            This hull makes {capped} — the campaign clamps the order, so the lab reads {capped}.
          </p>
        )}
        <label className="field">
          <span>Terrain occupied</span>
          <select value={setup.terrain} onChange={(e) => edit({ terrain: Number(e.target.value) })}>
            {TERRAIN.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={setup.active} onChange={(e) => edit({ active: e.target.checked })} />
          Active sensors{' '}
          {which === 'searcher' ? '— sharper inside range 2' : '— and +7 signature speed on every scope'}
        </label>
        {which === 'target' && (
          <>
            <label className="checkbox" title={cloakOk ? undefined : `${setup.form.name} carries no cloak (H6).`}>
              <input
                type="checkbox"
                disabled={!cloakOk}
                checked={setup.cloaked}
                onChange={(e) => edit({ cloaked: e.target.checked })}
              />
              Cloaked
              {setup.cloaked && !cloakEffective(setup) && ' — refused: a crippled hull cannot hold a cloak'}
            </label>
            <label className="field">
              <span>Damage</span>
              <select
                value={setup.damage}
                onChange={(e) => edit({ damage: e.target.value as LabShipSetup['damage'] })}
              >
                <option value="fresh">Fresh</option>
                <option value="damaged">Damaged</option>
                <option value="crippled">Crippled</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={setup.civilian}
                onChange={(e) => edit({ civilian: e.target.checked })}
              />
              Civilian hull — three times as findable, and capped at speed 3
            </label>
          </>
        )}
        <div className="lab-row">
          <label className="field">
            <span>Hulls</span>
            <input
              type="number"
              min={1}
              max={8}
              value={setup.shipCount}
              onChange={(e) =>
                edit({ shipCount: Math.max(1, Math.min(8, Math.round(Number(e.target.value) || 1))) })
              }
            />
          </label>
          <label className="field">
            <span>Formation</span>
            <select
              value={setup.formation}
              onChange={(e) => edit({ formation: e.target.value as LabShipSetup['formation'] })}
            >
              <option value="standard">Standard</option>
              <option value="close">Close</option>
            </select>
          </label>
        </div>
      </section>
    )
  }

  const factorRows = useMemo(() => {
    const keys = new Set([
      ...Object.keys(reading.detectionFactors),
      ...Object.keys(reading.intelligenceFactors),
    ])
    return [...keys].map((key) => ({
      key,
      detection: reading.detectionFactors[key],
      intelligence: reading.intelligenceFactors[key],
    }))
  }, [reading])

  const downloadCsv = () => {
    const text = sweepCsv(situation, sweep)
    const blob = new Blob([text], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sensor-sweep.csv'
    a.click()
    URL.revokeObjectURL(url)
    setNote('Sweep saved as sensor-sweep.csv.')
  }

  const copyCsv = () => {
    void navigator.clipboard
      ?.writeText(sweepCsv(situation, sweep))
      .then(() => setNote('Sweep copied — paste it straight into a spreadsheet.'))
      .catch(() => setNote('Could not reach the clipboard; use Download instead.'))
  }

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Sensor Lab">
      <div className="picker sensor-lab">
        <header>
          <h2>Sensor Lab</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="hint">
          Every number here is the campaign&apos;s own: the lab builds both ships through the same
          code the operational sweep uses, and calls the same sensor model. Per-scan odds are what
          one phase rolls; a campaign round is sixteen of them.
        </p>

        <div className="lab-body">
          <div className="lab-sides">
            {sidePanel('searcher', searcher, setSearcher)}
            {sidePanel('target', target, setTarget)}
          </div>

          <section className="lab-situation">
            <h3>Situation</h3>
            <div className="lab-row">
              <label className="field">
                <span>Range (hexes)</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={range}
                  onChange={(e) => setRange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </label>
              <label className="field">
                <span>Terrain between</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={between}
                  onChange={(e) => setBetween(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </label>
              <label className="field" title="Where the track was last held — retention and reacquisition read the change (B106/B107).">
                <span>Held at</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={previousRange}
                  onChange={(e) => setPreviousRange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </label>
            </div>
          </section>

          <section className="lab-results">
            <h3>This scan</h3>
            <div className="lab-figures">
              <div className="lab-figure">
                <span>Detection</span>
                <strong>{pct2(reading.detection)}</strong>
                <em>per scan</em>
              </div>
              <div className="lab-figure is-major">
                <span>Detection</span>
                <strong>{pct(reading.detectionPerRound)}</strong>
                <em>over a round (16 scans)</em>
              </div>
              <div className="lab-figure">
                <span>Intelligence</span>
                <strong>{pct2(reading.intelligence)}</strong>
                <em>per scan</em>
              </div>
              <div className="lab-figure">
                <span>Intelligence</span>
                <strong>{pct(reading.intelligencePerRound)}</strong>
                <em>over a round</em>
              </div>
              <div className="lab-figure">
                <span>Even odds after</span>
                <strong>
                  {!Number.isFinite(reading.scansToEven)
                    ? '—'
                    : reading.scansToEven < 1
                      ? '1'
                      : reading.scansToEven.toFixed(1)}
                </strong>
                <em>
                  {!Number.isFinite(reading.scansToEven)
                    ? 'never at these odds'
                    : reading.scansToEven < 1
                      ? 'scan — even money on the first look'
                      : `scans (${(reading.scansToEven / 16).toFixed(1)} rounds)`}
                </em>
              </div>
              <div className="lab-figure">
                <span>Hold the track</span>
                <strong>{pct(reading.retention)}</strong>
                <em>retention, from {previousRange}</em>
              </div>
              <div className="lab-figure">
                <span>Pick it back up</span>
                <strong>{pct(reading.reacquisition)}</strong>
                <em>reacquisition</em>
              </div>
              <div className="lab-figure">
                <span>Ghost</span>
                <strong>{pct2(reading.falseContact)}</strong>
                <em>false contact, per scan</em>
              </div>
            </div>

            <details className="lab-factors">
              <summary>Every factor of the product (the workbook&apos;s columns)</summary>
              <table>
                <thead>
                  <tr>
                    <th>Factor</th>
                    <th>Detection</th>
                    <th>Intelligence</th>
                  </tr>
                </thead>
                <tbody>
                  {factorRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>{row.detection === undefined ? '—' : row.detection.toFixed(4)}</td>
                      <td>{row.intelligence === undefined ? '—' : row.intelligence.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                Capability and difficulty feed the gate; the gate is multiplied by every factor
                below it, then the damage bonus is added (E49).
              </p>
              <p className="hint">
                <strong>What the model does not read:</strong> the searcher&apos;s own damage, and
                the sensor-power setting (0/1/2) — the sheet takes all three SP values as static
                stats, so a ship at quiet power searches exactly as well as one at full power, and
                a battered scout searches exactly as well as a fresh one. Both are dials players
                expect to matter; worth a ruling if they should.
              </p>
            </details>
          </section>

          <section className="lab-sweep">
            <div className="lab-sweep-head">
              <h3>Every range</h3>
              <label className="field inline">
                <span>out to</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxRange}
                  onChange={(e) => setMaxRange(Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))))}
                />
              </label>
              <button type="button" onClick={copyCsv}>
                Copy as CSV
              </button>
              <button type="button" onClick={downloadCsv}>
                Download CSV
              </button>
            </div>
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Range</th>
                  <th>Detect / scan</th>
                  <th>Detect / round</th>
                  <th>Intel / scan</th>
                  <th>Retention</th>
                  <th>Reacquire</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sweep.map((row) => (
                  <tr key={row.range} className={row.range === range ? 'is-current' : undefined}>
                    <td>{row.range}</td>
                    <td>{pct2(row.detection)}</td>
                    <td>{pct(row.detectionPerRound)}</td>
                    <td>{pct2(row.intelligence)}</td>
                    <td>{pct(row.retention)}</td>
                    <td>{pct(row.reacquisition)}</td>
                    <td className="lab-bar-cell">
                      <span className="lab-bar" style={{ width: `${row.detectionPerRound * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="lab-approach">
            <div className="lab-sweep-head">
              <h3>The approach</h3>
              <label className="field inline">
                <span>from</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={startRange}
                  onChange={(e) => setStartRange(Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))))}
                />
              </label>
              <label className="field inline">
                <span>trials</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  step={100}
                  value={trials}
                  onChange={(e) => setTrials(Math.max(1, Math.min(5000, Math.round(Number(e.target.value) || 1))))}
                />
              </label>
              <label className="field inline">
                <span>seed</span>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Math.round(Number(e.target.value) || 0))}
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => setApproach(approachTrials(situation, { startRange, trials, seed }))}
              >
                Run
              </button>
            </div>
            <p className="hint">
              Both ships close at their ordered speeds while the searcher scans every phase, rolling
              these very odds against a shrinking range: at what range does contact actually happen?
              Seeded, so the same run repeats.
            </p>
            {approach && (
              <>
                <p>
                  <strong>
                    {approach.detected} of {approach.trials}
                  </strong>{' '}
                  approaches were detected ({pct(approach.detected / approach.trials)})
                  {approach.meanRange !== null && (
                    <>
                      , first contact at <strong>{approach.meanRange.toFixed(1)} hexes</strong> on
                      average, after {approach.meanPhases?.toFixed(1)} phases
                    </>
                  )}
                  .
                </p>
                <table className="lab-table">
                  <thead>
                    <tr>
                      <th>Range at contact</th>
                      <th>Approaches</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {approach.byRange
                      .filter((b) => b.contacts > 0)
                      .map((b) => (
                        <tr key={b.range}>
                          <td>{b.range}</td>
                          <td>{b.contacts}</td>
                          <td className="lab-bar-cell">
                            <span
                              className="lab-bar"
                              style={{ width: `${(b.contacts / approach.trials) * 100}%` }}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>

        {note && <p className="title-note">{note}</p>}
      </div>
    </div>
  )
}
