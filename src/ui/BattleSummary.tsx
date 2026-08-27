import type { BattleSummary } from '../engine/battleSummary'

/**
 * The screen a table of players looks over when the last volley lands: who
 * holds the field, the score, and what every hull did and suffered. Opens by
 * itself when the battle ends — dismissible, and reopenable from the menu,
 * because the argument about who really won outlives the battle.
 */
export function BattleSummaryPanel({
  summary,
  scenarioName,
  onClose,
  onReturnToCampaign,
}: {
  summary: BattleSummary
  scenarioName: string
  onClose: () => void
  /** Set when this battle came from Border Command: one obvious way home. */
  onReturnToCampaign?: () => void
}) {
  const ranked = [...summary.sides].sort((a, b) => b.points - a.points)
  return (
    <div className="picker-backdrop" role="dialog" aria-label="Battle summary">
      <div className="picker battle-summary">
        <header>
          <h2>{summary.over ? 'Battle over' : 'Battle so far'} — {scenarioName}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="summary-body">
          <p className="summary-outcome">{summary.outcome}</p>
          <p className="summary-line">
            {summary.rounds} round{summary.rounds === 1 ? '' : 's'} · {summary.totalVolleys}{' '}
            volley{summary.totalVolleys === 1 ? '' : 's'} fired · {summary.totalCards} damage card
            {summary.totalCards === 1 ? '' : 's'} drawn
            {summary.biggestVolley && (
              <>
                {' '}
                · heaviest volley: <strong>{summary.biggestVolley.attacker}</strong> hit{' '}
                {summary.biggestVolley.target} for <strong>{summary.biggestVolley.damage}</strong>
              </>
            )}
          </p>

          {ranked.map((side) => (
            <section key={side.side} className="summary-side">
              <h3>
                {side.side}
                <span className="summary-points">
                  {side.points} VP · fleet condition {Math.round(side.health * 100)}%
                </span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Ship</th>
                    <th>Fate</th>
                    <th title="Structure boxes remaining">Structure</th>
                    <th title="Volleys fired, per the battle log">Volleys</th>
                    <th title="Total damage rolled, before shields and armor">Damage rolled</th>
                    <th title="Damage cards drawn against this ship">Cards taken</th>
                  </tr>
                </thead>
                <tbody>
                  {side.ships.map((ship) => (
                    <tr key={ship.id} className={ship.status === 'fighting' ? '' : 'is-out'}>
                      <td>
                        <strong>{ship.name}</strong>
                        <em>{ship.formName}</em>
                      </td>
                      <td>{ship.status === 'fighting' ? `${ship.damage} damage` : ship.status}</td>
                      <td>
                        {ship.structureLeft}/{ship.structureTotal}
                      </td>
                      <td>{ship.volleys}</td>
                      <td>{ship.damageRolled}</td>
                      <td>{ship.cardsTaken}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          <p className="hint">
            Deeds are read from the battle log; the Report download carries this summary and the
            full log together, ready for the campaign record.
          </p>
          {onReturnToCampaign && (
            <div className="summary-campaign-return">
              <button type="button" className="primary" onClick={onReturnToCampaign}>
                Return to Border Command
              </button>
              <p className="hint">
                Back at the campaign console, press <strong>Read back from the table</strong> in
                the Battles-waiting panel to record this result.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
