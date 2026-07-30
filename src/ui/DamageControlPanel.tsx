import { useState } from 'react'
import { pushLog, type GameState } from '../engine/game'
import { repairTargets, resolveDamageControl, type RepairAssignment, type RepairCategory } from '../engine/engineering'
import { damageControlRating, type ShipState } from '../engine/shipState'
import { act } from './store'

/**
 * Damage Control Segment (B3.2). The player assigns red dice to categories and
 * nominates one box per category to repair on a success.
 */

const CATEGORIES: RepairCategory[] = ['systems', 'shields', 'weapons', 'engineering', 'structure']

interface Props {
  game: GameState
  ship: ShipState
}

export function DamageControlPanel({ ship }: Props) {
  const [assignments, setAssignments] = useState<Record<string, { dice: number; key: string }>>({})
  const [resolved, setResolved] = useState<string[] | null>(null)

  const budget = damageControlRating(ship)
  const targets = repairTargets(ship)
  const boarders = Object.values(ship.boarders).reduce((a, b) => a + b, 0)
  const used = Object.values(assignments).reduce((sum, a) => sum + a.dice, 0)

  const setDice = (category: string, dice: number) =>
    setAssignments((prev) => ({
      ...prev,
      [category]: { dice: Math.max(0, dice), key: prev[category]?.key ?? '' },
    }))

  const setTarget = (category: string, key: string) =>
    setAssignments((prev) => ({ ...prev, [category]: { dice: prev[category]?.dice ?? 0, key } }))

  const roll = () => {
    const list: RepairAssignment[] = Object.entries(assignments)
      .filter(([, a]) => a.dice > 0)
      .map(([category, a]) => ({
        category: category as RepairCategory,
        dice: a.dice,
        targetKey: a.key || undefined,
      }))

    const messages: string[] = []
    act((g) => {
      const outcomes = resolveDamageControl(ship, list, g.rng, (m) => {
        messages.push(m)
        pushLog(g, m)
      })
      for (const outcome of outcomes) {
        if (!outcome.success) messages.push(`${outcome.category}: no success on ${outcome.dice} dice.`)
      }
    })
    setResolved(messages.length > 0 ? messages : ['No repair attempts made.'])
    setAssignments({})
  }

  if (targets.length === 0 && boarders === 0) {
    return (
      <div className="damage-control">
        <h3>Damage Control — {ship.name}</h3>
        <p className="hint">No damage to repair. Damage Control Rating {budget}.</p>
      </div>
    )
  }

  return (
    <div className="damage-control">
      <h3>
        Damage Control — {ship.name}
        <span className="chip">
          {used} of {budget} red dice assigned
        </span>
      </h3>

      <table className="repair-table">
        <tbody>
          {CATEGORIES.map((category) => {
            const options = targets.filter((t) => t.category === category)
            if (options.length === 0) return null
            const assignment = assignments[category] ?? { dice: 0, key: '' }
            return (
              <tr key={category}>
                <th>{category}</th>
                <td>
                  <select value={assignment.key} onChange={(e) => setTarget(category, e.target.value)}>
                    <option value="">— choose a box —</option>
                    {options.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="dice-stepper">
                  <button type="button" onClick={() => setDice(category, assignment.dice - 1)}>
                    −
                  </button>
                  <span>{assignment.dice}</span>
                  <button
                    type="button"
                    disabled={used >= budget}
                    onClick={() => setDice(category, assignment.dice + 1)}
                  >
                    +
                  </button>
                </td>
              </tr>
            )
          })}

          {boarders > 0 && (
            <tr>
              <th title="B3.4 Repelling Boarders">boarders</th>
              <td>{boarders} enemy marine squad(s) aboard</td>
              <td className="dice-stepper">
                <button type="button" onClick={() => setDice('boarders', (assignments.boarders?.dice ?? 0) - 1)}>
                  −
                </button>
                <span>{assignments.boarders?.dice ?? 0}</span>
                <button
                  type="button"
                  disabled={used >= budget}
                  onClick={() => setDice('boarders', (assignments.boarders?.dice ?? 0) + 1)}
                >
                  +
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="hint">
        One box per category per round, regardless of dice assigned (B3.2 Step 3). An &quot;S&quot; on any red die in a
        category is a success (B3.1.1).
      </p>

      <button type="button" className="primary" disabled={used === 0} onClick={roll}>
        Roll damage control
      </button>

      {resolved && (
        <ul className="repair-results">
          {resolved.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
