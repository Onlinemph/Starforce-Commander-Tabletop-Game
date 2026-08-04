import { useEffect, useState } from 'react'
import {
  alreadyHave,
  importedForm,
  type LibraryEntry,
} from '../engine/shipLibrary'
import { customForms, saveCustomForm, useCustomForms } from './customShips'
import {
  browseLibrary,
  libraryConfig,
  recordDownload,
  reportDesign,
  setLibraryConfig,
} from './shipLibrary'

/**
 * The shared library of fan-made ships.
 *
 * Browse what other people have built, and take a copy. "Take a copy" is
 * literal: importing writes the whole design into this browser's roster, so a
 * battle you fight with it keeps working whether or not the library is still
 * there — and a battle file you send someone carries the design inside it, as
 * it always has.
 */

interface Props {
  onClose: () => void
}

export function ShipLibraryPanel({ onClose }: Props) {
  const roster = useCustomForms()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const config = libraryConfig()

  const load = async (term: string) => {
    setBusy(true)
    setError(null)
    try {
      setEntries(await browseLibrary(term))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (config) void load('')
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
    <div className="picker theater ship-library">
      <header>
        <h2>Ship Library</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {!config ? (
        <div className="segment-help">
          <p>
            No library is configured. The library is a Supabase project — the same one online
            matches can use — with <code>supabase/ship-library.sql</code> run in it once. Paste the
            project URL and its publishable key below, or set them at build time and every visitor
            gets them without typing anything.
          </p>
          <LibrarySetup onSaved={() => void load('')} />
        </div>
      ) : (
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
              Nothing here yet. Designs published from the ship builder show up in this list.
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
      )}
    </div>
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
