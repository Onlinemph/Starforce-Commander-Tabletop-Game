/**
 * The scenario force editor — the designer's "being able to add ships to the
 * scenario will help test a variety of ships." Any launch scenario opens as a
 * draft whose forces can be reshaped before the campaign starts: add or
 * remove units on either side, change a unit's hulls to ANY form in the
 * roster (the canon 112, Expansion 7's freighters and stations included, plus
 * local custom designs), move its start hex, or change its kind. The edited
 * scenario launches like any other; nothing here touches a campaign already
 * underway.
 */

import { useMemo, useState } from 'react'
import { inBounds } from '../campaign/hexmap'
import type { CampaignScenario, ScenarioForceUnit, Side } from '../campaign/types'
import { allShipForms, customShipForms, SHIP_FORMS } from '../data/ships'
import type { ShipForm } from '../engine/types'

interface Props {
  scenario: CampaignScenario
  onLaunch: (scenario: CampaignScenario) => void
  onCancel: () => void
}

const SIDE_TITLE: Record<Side, string> = { A: 'Commander A', B: 'Commander B' }

export function ForceEditor({ scenario, onLaunch, onCancel }: Props) {
  const [draft, setDraft] = useState<CampaignScenario>(() => structuredClone(scenario))
  const [seq, setSeq] = useState(1)

  const groups = useMemo(() => {
    const byFaction = new Map<string, ShipForm[]>()
    for (const form of SHIP_FORMS) {
      const list = byFaction.get(form.faction) ?? []
      list.push(form)
      byFaction.set(form.faction, list)
    }
    const customs = customShipForms()
    return { byFaction: [...byFaction.entries()], customs }
  }, [])

  const mutate = (fn: (s: CampaignScenario) => void) => {
    setDraft((d) => {
      const next = structuredClone(d)
      fn(next)
      return next
    })
  }

  const formName = (id: string) => allShipForms().find((f) => f.id === id)?.name ?? id

  const formSelect = (value: string, onChange: (id: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.byFaction.map(([faction, forms]) => (
        <optgroup key={faction} label={faction}>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {f.pointValue} pts
            </option>
          ))}
        </optgroup>
      ))}
      {groups.customs.length > 0 && (
        <optgroup label="Custom designs">
          {groups.customs.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {f.pointValue} pts
            </option>
          ))}
        </optgroup>
      )}
      {!allShipForms().some((f) => f.id === value) && <option value={value}>{value}</option>}
    </select>
  )

  const unitRow = (side: Side, unit: ScenarioForceUnit, index: number) => (
    <div key={unit.id} className="force-unit">
      <div className="force-unit-head">
        <input
          value={unit.name ?? unit.id}
          onChange={(e) => mutate((s) => void (s.forces[side][index].name = e.target.value))}
          aria-label="Unit name"
        />
        <select
          value={unit.kind}
          onChange={(e) =>
            mutate((s) => void (s.forces[side][index].kind = e.target.value as ScenarioForceUnit['kind']))
          }
        >
          <option value="ship">ship</option>
          <option value="group">group</option>
          <option value="convoy">convoy</option>
        </select>
        <label title="The start hex: Q is the column, R the row — the same pair the campaign plot prints at its grid marks and in every unit tooltip (e.g. the hex labeled 10,5 is Q 10, R 5)">
          hex Q
          <input
            type="number"
            value={unit.hex.q}
            onChange={(e) =>
              mutate((s) => {
                const q = Math.round(Number(e.target.value))
                const hex = { q, r: s.forces[side][index].hex.r }
                if (inBounds(hex, s.mapWidth, s.mapHeight)) s.forces[side][index].hex = hex
              })
            }
          />
        </label>
        <label title="The start hex: Q is the column, R the row — the same pair the campaign plot prints at its grid marks and in every unit tooltip (e.g. the hex labeled 10,5 is Q 10, R 5)">
          R
          <input
            type="number"
            value={unit.hex.r}
            onChange={(e) =>
              mutate((s) => {
                const r = Math.round(Number(e.target.value))
                const hex = { q: s.forces[side][index].hex.q, r }
                if (inBounds(hex, s.mapWidth, s.mapHeight)) s.forces[side][index].hex = hex
              })
            }
          />
        </label>
        <label title="Reinforcement schedule (S3.2): held off the map — undrawn, unscannable — until this campaign round. Blank or 1 deploys at the opening bell.">
          arrives R
          <input
            type="number"
            min={1}
            value={unit.arrivesRound ?? ''}
            placeholder="1"
            onChange={(e) =>
              mutate((s) => {
                const round = Math.round(Number(e.target.value))
                if (e.target.value === '' || !Number.isFinite(round) || round <= 1) {
                  delete s.forces[side][index].arrivesRound
                } else {
                  s.forces[side][index].arrivesRound = round
                }
              })
            }
          />
        </label>
        <button type="button" onClick={() => mutate((s) => void s.forces[side].splice(index, 1))}>
          Remove
        </button>
      </div>
      {unit.ships.map((formId, si) => (
        <div key={`${unit.id}-s${si}`} className="force-ship">
          {formSelect(formId, (id) => mutate((s) => void (s.forces[side][index].ships[si] = id)))}
          <button
            type="button"
            disabled={unit.ships.length <= 1}
            onClick={() => mutate((s) => void s.forces[side][index].ships.splice(si, 1))}
            aria-label={`Remove ${formName(formId)}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="force-add-ship"
        onClick={() =>
          mutate((s) => {
            const ships = s.forces[side][index].ships
            ships.push(ships[ships.length - 1])
          })
        }
      >
        + hull
      </button>
    </div>
  )

  const addUnit = (side: Side) => {
    mutate((s) => {
      const near = s.forces[side][0]?.hex ?? { q: side === 'A' ? 2 : s.mapWidth - 3, r: 4 }
      // Default hull: the side's flavor — Union for A, Vallari for B.
      const fallback =
        SHIP_FORMS.find((f) =>
          f.faction === (side === 'A' ? 'Union of Federated Systems' : 'Vallari Imperium'),
        ) ?? SHIP_FORMS[0]
      s.forces[side].push({
        id: `${side.toLowerCase()}-added-${seq}`,
        kind: 'ship',
        name: `${side === 'A' ? 'USS' : 'IMS'} Addition ${seq}`,
        ships: [fallback.id],
        hex: { ...near },
        order: { speed: 'hold' },
      })
    })
    setSeq((n) => n + 1)
  }

  return (
    <div className="campaign-panel force-editor">
      <h3>
        Forces — {draft.name}
        <button type="button" className="wright-back" onClick={onCancel}>
          Back
        </button>
      </h3>
      <p className="hint">
        Reshape either side before launch: any hull in the roster (Expansion 7 freighters,
        transports and stations included, plus your custom designs), any start hex on the{' '}
        {draft.mapWidth}×{draft.mapHeight} plot. Q,R is the start hex — column and row, the same
        pair the plot prints at its grid marks (the hex labeled 10,5 is Q 10, R 5). Convoys
        deliver where the base scenario says.
      </p>
      {(['A', 'B'] as Side[]).map((side) => (
        <section key={side} className="force-side">
          <h4>{SIDE_TITLE[side]}</h4>
          {draft.forces[side].map((unit, i) => unitRow(side, unit, i))}
          <button type="button" onClick={() => addUnit(side)}>
            + unit
          </button>
        </section>
      ))}
      <div className="campaign-battle-actions">
        <button type="button" className="primary" onClick={() => onLaunch(draft)}>
          Launch with these forces
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
