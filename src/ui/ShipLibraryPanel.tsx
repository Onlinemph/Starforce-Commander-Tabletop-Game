import { useEffect, useState } from 'react'
import {
  alreadyHave,
  importedForm,
  LIBRARY_FACTIONS,
  type LibraryEntry,
} from '../engine/shipLibrary'
import {
  alreadyHaveScenario,
  importedScenario,
  type ScenarioLibraryEntry,
} from '../engine/scenarioLibrary'
import { customForms, importCustomForms, saveCustomForm, useCustomForms } from './customShips'
import { saveCustomScenario, useCustomScenarios } from './customScenarios'
import {
  browseLibrary,
  libraryConfig,
  recordDownload,
  reportDesign,
  setLibraryConfig,
} from './shipLibrary'
import { browseScenarios, recordScenarioDownload, reportScenario } from './scenarioLibrary'

/**
 * The shared library of fan-made ships and designed scenarios.
 *
 * Browse what other people have built, and take a copy. "Take a copy" is
 * literal: importing writes the whole design into this browser — a ship into
 * the roster; a scenario into the scenario list *along with every fan ship it
 * fields* — so a battle you fight with it keeps working whether or not the
 * library is still there, and a battle file you send someone carries the
 * designs inside it, as it always has.
 */

interface Props {
  onClose: () => void
}

export function ShipLibraryPanel({ onClose }: Props) {
  const [tab, setTab] = useState<'ships' | 'scenarios'>('ships')
  const [configured, setConfigured] = useState(() => libraryConfig() !== null)

  return (
    <div className="picker theater ship-library">
      <header>
        <h2>Library</h2>
        <div className="library-tabs">
          <button
            type="button"
            className={`chip${tab === 'ships' ? ' is-on' : ''}`}
            onClick={() => setTab('ships')}
          >
            Ships
          </button>
          <button
            type="button"
            className={`chip${tab === 'scenarios' ? ' is-on' : ''}`}
            onClick={() => setTab('scenarios')}
          >
            Scenarios
          </button>
        </div>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {!configured ? (
        <div className="segment-help">
          <p>
            No library is configured. The library is a Supabase project — the same one online
            matches can use — with <code>supabase/ship-library.sql</code> and{' '}
            <code>supabase/scenario-library.sql</code> run in it once. Paste the project URL and its
            publishable key below, or set them at build time and every visitor gets them without
            typing anything.
          </p>
          <LibrarySetup onSaved={() => setConfigured(true)} />
        </div>
      ) : tab === 'ships' ? (
        <ShipList />
      ) : (
        <ScenarioList />
      )}
    </div>
  )
}

function ShipList() {
  const roster = useCustomForms()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [faction, setFaction] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const load = async (term: string, tag = faction) => {
    setBusy(true)
    setError(null)
    try {
      setEntries(await browseLibrary(term, tag))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load('')
    // The config is read once on open; changing it re-renders through state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const take = async (entry: LibraryEntry) => {
    saveCustomForm(importedForm(entry))
    setNote(`${entry.form.name} is in your roster.`)
    // Best effort: the design is already yours whether or not the count lands.
    try {
      await recordDownload(entry.fingerprint)
    } catch {
      /* a failed tally is not worth telling anyone about */
    }
  }

  const flag = async (entry: LibraryEntry) => {
    try {
      await reportDesign(entry.fingerprint)
      setNote('Reported. Enough reports takes an entry out of the list.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div className="library-controls">
        <label className="field inline">
          <span>Search</span>
          <input
            value={search}
            placeholder="name or author"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(search)
            }}
          />
        </label>
        <label className="field inline">
          <span>Faction</span>
          <select
            value={faction}
            onChange={(e) => {
              setFaction(e.target.value)
              void load(search, e.target.value)
            }}
          >
            <option value="">All factions</option>
            {LIBRARY_FACTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void load(search)}>
          {busy ? 'Looking…' : 'Search'}
        </button>
      </div>

      {error && <p className="fire-error">{error}</p>}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}

      {entries === null ? (
        <p className="hint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="hint">
          {faction
            ? `No ${faction} designs yet.`
            : 'Nothing here yet. Designs published from the ship builder show up in this list.'}
        </p>
      ) : (
        <ul className="library-list">
          {entries.map((entry) => {
            const have = alreadyHave(entry, roster.length > 0 ? roster : customForms())
            return (
              <li key={entry.fingerprint}>
                <div className="library-entry">
                  <div>
                    <strong>{entry.form.name}</strong>
                    <span className="hint">
                      {' '}
                      {entry.faction} · size {entry.sizeClass} · {entry.points} points
                      {entry.author ? ` · by ${entry.author}` : ''}
                      {entry.downloads > 0 ? ` · ${entry.downloads} taken` : ''}
                    </span>
                    {entry.notes && <p className="hint">{entry.notes}</p>}
                  </div>
                  <div className="library-actions">
                    <button
                      type="button"
                      disabled={have}
                      title={have ? 'Already in your roster' : 'Copy into your roster'}
                      onClick={() => void take(entry)}
                    >
                      {have ? 'In roster' : 'Take a copy'}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      title="Flag this entry for the library's owner to look at"
                      onClick={() => void flag(entry)}
                    >
                      report
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function ScenarioList() {
  const scenarios = useCustomScenarios()
  const [entries, setEntries] = useState<ScenarioLibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const load = async (term: string) => {
    setBusy(true)
    setError(null)
    try {
      setEntries(await browseScenarios(term))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const take = async (entry: ScenarioLibraryEntry) => {
    // The fan hulls first, so the scenario's force lists resolve the moment it
    // lands. Content-addressed ids make re-importing a form a no-op.
    if (entry.forms.length > 0) importCustomForms(entry.forms)
    saveCustomScenario(importedScenario(entry))
    setNote(
      `${entry.scenario.name} is in your scenario list` +
        (entry.forms.length > 0 ? `, with ${entry.forms.length} fan ship(s) it fields.` : '.'),
    )
    try {
      await recordScenarioDownload(entry.fingerprint)
    } catch {
      /* a failed tally is not worth telling anyone about */
    }
  }

  const flag = async (entry: ScenarioLibraryEntry) => {
    try {
      await reportScenario(entry.fingerprint)
      setNote('Reported. Enough reports takes an entry out of the list.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div className="library-controls">
        <label className="field inline">
          <span>Search</span>
          <input
            value={search}
            placeholder="name or author"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(search)
            }}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void load(search)}>
          {busy ? 'Looking…' : 'Search'}
        </button>
      </div>

      {error && <p className="fire-error">{error}</p>}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}

      {entries === null ? (
        <p className="hint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="hint">
          Nothing here yet. Scenarios published from the scenario designer show up in this list.
        </p>
      ) : (
        <ul className="library-list">
          {entries.map((entry) => {
            const have = alreadyHaveScenario(entry, scenarios)
            return (
              <li key={entry.fingerprint}>
                <div className="library-entry">
                  <div>
                    <strong>{entry.scenario.name}</strong>
                    <span className="hint">
                      {' '}
                      {entry.sides} sides · {entry.hulls} hulls ·{' '}
                      {entry.scenario.bounds.width}"×{entry.scenario.bounds.height}"
                      {entry.forms.length > 0 ? ` · ${entry.forms.length} fan ship(s)` : ''}
                      {entry.author ? ` · by ${entry.author}` : ''}
                      {entry.downloads > 0 ? ` · ${entry.downloads} taken` : ''}
                    </span>
                    {entry.scenario.background && <p className="hint">{entry.scenario.background}</p>}
                    {entry.notes && <p className="hint">{entry.notes}</p>}
                  </div>
                  <div className="library-actions">
                    <button
                      type="button"
                      disabled={have}
                      title={
                        have
                          ? 'Already in your scenario list'
                          : 'Copy into your scenario list, along with any fan ships it fields'
                      }
                      onClick={() => void take(entry)}
                    >
                      {have ? 'In your list' : 'Take a copy'}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      title="Flag this entry for the library's owner to look at"
                      onClick={() => void flag(entry)}
                    >
                      report
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** Point this browser at a library. */
function LibrarySetup({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  return (
    <div className="library-controls">
      <label className="field inline">
        <span>Project URL</span>
        <input value={url} placeholder="https://….supabase.co" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field inline">
        <span>Publishable key</span>
        <input value={key} placeholder="sb_publishable_…" onChange={(e) => setKey(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={!url.trim() || !key.trim()}
        onClick={() => {
          setLibraryConfig({ url: url.trim(), key: key.trim() })
          onSaved()
        }}
      >
        Use this library
      </button>
    </div>
  )
}
