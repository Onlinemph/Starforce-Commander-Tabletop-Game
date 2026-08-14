import {
  checkPublishable,
  libraryFaction,
  LIBRARY_FACTIONS,
  MAX_AUTHOR_CHARS,
  MAX_NOTES_CHARS,
  type LibraryFaction,
} from '../engine/shipLibrary'
import { publishDesign } from './shipLibrary'
import { useMemo, useRef, useState } from 'react'
import { ArcRose } from './ArcRose'
import { BLUE, RED } from '../data/scenarios'
import { SHIP_FORMS } from '../data/ships'
import {
  blankForm,
  blankScoutSensor,
  blankWeapon,
  impliedSpecialModifier,
  pointValue,
  syncSpecialLines,
  TRAIT_MODIFIERS,
  validateDesign,
  type PointBreakdown,
} from '../engine/shipBuilder'
import type {
  Arc,
  DieColor,
  FunctionLineDef,
  RangeBand,
  ShieldSide,
  ShipForm,
  SystemGroupDef,
  SystemKind,
  WeaponSystemDef,
} from '../engine/types'
import {
  customFormId,
  deleteCustomForm,
  draftCount,
  importCustomForms,
  isFileForm,
  isUnsavedDraft,
  rosterFileContents,
  saveCustomForm,
  useCustomForms,
} from './customShips'
import { newGame } from './store'

/**
 * The ship builder — a digital version of the designers' own `SHIP FORM MASTER`
 * spreadsheet.
 *
 * Everything on the left is the ship form itself, laid out in the order the
 * printed forms use. Everything on the right is what the design costs: the
 * point value from the designers' valuation model (see `shipBuilder.ts`), the
 * eight components it is built from, and the rules a design has to satisfy
 * before it can be played.
 */

const ARCS: Arc[] = ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP']
const SIDES: ShieldSide[] = ['F', 'S', 'A', 'P']
const DICE: DieColor[] = ['blue', 'green', 'yellow', 'red']
const BANDS: RangeBand[] = ['green', 'black', 'red']
const SYSTEM_KINDS: SystemKind[] = [
  'SENS',
  'SCNC',
  'TRAC',
  'TRAN',
  'SHTL',
  'HNGR',
  'LNCH',
  'LNDG',
  'QTRS',
  'CRGO',
  'PROB',
  'CMND',
  'CLOAK',
  'SPCL',
]
const WEAPON_CLASSES = [
  'phaser',
  'disruptor',
  'laser',
  'plasma-cannon',
  'a-mat-torpedo',
  'plasma-torpedo',
  'missile',
  'rail-gun',
  'point-defense',
]

interface Props {
  onClose: () => void
}

export function ShipBuilder({ onClose }: Props) {
  const saved = useCustomForms()
  const [draft, setDraft] = useState<ShipForm>(() => blankForm(customFormId('New Class')))
  const [status, setStatus] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const cost = useMemo(() => pointValue(draft), [draft])
  const problems = useMemo(() => validateDesign(draft), [draft])
  const blocking = problems.filter((p) => p.severity === 'error')

  /**
   * Every edit goes through here, so the draft is never mutated in place and
   * the FUNCTIONS lines a scout block or cloak needs are always present.
   */
  const edit = (mutate: (form: ShipForm) => void) =>
    setDraft((current) => {
      const next = structuredClone(current)
      mutate(next)
      syncSpecialLines(next)
      return next
    })

  const openTemplate = (id: string) => {
    if (!id) return setDraft(blankForm(customFormId('New Class')))
    const source = saved.find((f) => f.id === id)
    if (source) return setDraft(structuredClone(source))
    const canon = SHIP_FORMS.find((f) => f.id === id)
    if (!canon) return
    const copy = structuredClone(canon)
    copy.id = customFormId(`${canon.name} copy`)
    copy.name = `${canon.name} (copy)`
    copy.faction = 'Custom'
    copy.notes = `Based on the ${canon.name}.`
    setDraft(copy)
  }

  const save = () => {
    saveCustomForm(structuredClone(draft))
    setStatus(`Saved “${draft.name}” as a local draft — download the roster file to keep it.`)
  }

  /**
   * Hand back `src/data/customShips.json` with every design in it. Committing
   * that file is what makes a design permanent and shared: it is bundled with
   * the site, so it reaches every player on every device.
   */
  const download = () => {
    const blob = new Blob([rosterFileContents()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'customShips.json'
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Downloaded — replace src/data/customShips.json with it and commit.')
  }

  const upload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      const list: ShipForm[] = Array.isArray(parsed) ? parsed : [parsed]
      setStatus(
        `Loaded ${importCustomForms(list)} design(s) as drafts — download the roster file to keep them.`,
      )
    } catch {
      setStatus('That file is not a StarForce ship roster.')
    }
  }

  const launch = (sideName: string) => {
    saveCustomForm(structuredClone(draft))
    newGame({
      scenarioId: 's3.1-the-duel',
      seed: Math.floor(Math.random() * 1e9),
      forms: { [sideName]: draft.id },
      // A test flight deserves an opponent that shoots back.
      aiSides: [sideName === BLUE ? RED : BLUE],
    })
    onClose()
  }

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Ship builder">
      <div className="picker builder">
        <header>
          <h2>Ship builder</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="builder-toolbar">
          <label className="field">
            <span>Start from</span>
            <select value="" onChange={(e) => openTemplate(e.target.value)}>
              <option value="">Blank hull…</option>
              {saved.length > 0 && (
                <optgroup label="Your designs">
                  {saved.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {isUnsavedDraft(f.id) ? ' — draft' : isFileForm(f.id) ? ' — in the file' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Copy a canon ship">
                {SHIP_FORMS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.pointValue} PV)
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <button type="button" onClick={save}>
            Save draft
          </button>
          <button
            type="button"
            className="primary"
            onClick={download}
            title="Every design, as the file to commit to the repository"
          >
            Download customShips.json
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Load a roster file
          </button>
          <button
            type="button"
            title="Share this design with everyone, through the online ship library"
            onClick={() => setPublishing(true)}
          >
            Publish to library
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
          {saved.some((f) => f.id === draft.id) && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteCustomForm(draft.id)
                setStatus(
                  isFileForm(draft.id)
                    ? `Reverted “${draft.name}” to the version in the file.`
                    : `Deleted “${draft.name}”.`,
                )
              }}
            >
              {isFileForm(draft.id) ? 'Revert' : 'Delete'}
            </button>
          )}
          {status && <span className="builder-status">{status}</span>}
        </div>

        {publishing && (
          <PublishDialog form={draft} onClose={() => setPublishing(false)} />
        )}

        <p className="builder-where">
          Designs live in <code>src/data/customShips.json</code>, which is bundled with the site, so
          a design committed there reaches every player on every device.{' '}
          <strong>Save draft</strong> keeps a design in this browser only;{' '}
          <strong>Download customShips.json</strong> writes the file to commit.
          {draftCount() > 0 && (
            <em>
              {' '}
              {draftCount()} design{draftCount() === 1 ? '' : 's'} not yet in the file.
            </em>
          )}
        </p>

        <div className="builder-body">
          <div className="builder-form">
            <Identity draft={draft} edit={edit} />
            <Power draft={draft} edit={edit} />
            <Sublight draft={draft} edit={edit} />
            <Defenses draft={draft} edit={edit} />
            <Systems draft={draft} edit={edit} />
            <ScoutSensors draft={draft} edit={edit} />
            <Structure draft={draft} edit={edit} />
            <Weapons draft={draft} edit={edit} />
            <Functions draft={draft} edit={edit} />
          </div>

          <aside className="builder-cost">
            <CostPanel draft={draft} cost={cost} edit={edit} />
            <Problems problems={problems} />
            <div className="builder-launch">
              <p>
                Fight the design in the duel scenario (S3.1). It is saved to your roster first, so
                it also shows up under “Choose forces”.
              </p>
              <button
                type="button"
                className="primary"
                disabled={blocking.length > 0}
                onClick={() => launch(BLUE)}
              >
                Fly for {BLUE}
              </button>
              <button type="button" disabled={blocking.length > 0} onClick={() => launch(RED)}>
                Fly for {RED}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

type Edit = (mutate: (form: ShipForm) => void) => void

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="builder-section">
      <h3>
        {title}
        {hint && <em>{hint}</em>}
      </h3>
      {children}
    </section>
  )
}

function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="field tiny">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
      />
    </label>
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Identity({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  return (
    <Section title="Identity" hint="B1.3">
      <div className="builder-row">
        <label className="field grow">
          <span>Class name</span>
          <input
            value={draft.name}
            onChange={(e) => edit((f) => void (f.name = e.target.value))}
          />
        </label>
        <label className="field">
          <span>Faction</span>
          <input
            value={draft.faction}
            list="sfc-factions"
            onChange={(e) => edit((f) => void (f.faction = e.target.value))}
          />
          <datalist id="sfc-factions">
            {[...new Set(SHIP_FORMS.map((f) => f.faction))].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="builder-row">
        <Num
          label="Size class"
          value={draft.sizeClass}
          min={1}
          max={10}
          onChange={(n) => edit((f) => void (f.sizeClass = n))}
        />
        <Num
          label="Stress rating"
          value={draft.stressRating}
          min={1}
          max={12}
          onChange={(n) => edit((f) => void (f.stressRating = n))}
        />
        <Num
          label="Dmg control"
          value={draft.damageControlRating}
          max={12}
          onChange={(n) => edit((f) => void (f.damageControlRating = n))}
        />
        <Num
          label="Marines"
          value={draft.marineSquads}
          max={64}
          onChange={(n) => edit((f) => void (f.marineSquads = n))}
        />
        <Num
          label="Shuttles"
          value={draft.shuttles}
          max={40}
          onChange={(n) => edit((f) => void (f.shuttles = n))}
        />
        <Num
          label="Year"
          value={draft.year ?? 3600}
          min={2000}
          max={9999}
          onChange={(n) => edit((f) => void (f.year = n))}
        />
        <label className="field tiny">
          <span>Availability</span>
          <select
            value={draft.availability ?? 'common'}
            onChange={(e) =>
              edit((f) => void (f.availability = e.target.value as ShipForm['availability']))
            }
          >
            {['common', 'uncommon', 'rare', 'unique'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field grow">
        <span>Notes</span>
        <input
          value={draft.notes ?? ''}
          onChange={(e) => edit((f) => void (f.notes = e.target.value))}
        />
      </label>
      <CounterArt draft={draft} edit={edit} />
    </Section>
  )
}

/**
 * Custom counter art. Two roads in, both cosmetic: upload an image (scaled
 * down and embedded in the form, so it travels inside saves, library entries
 * and remote matches with no link to rot) or paste an https:// URL (small,
 * but whoever views the battle fetches it — offline and dead links fall back
 * to the class silhouette). Player-requested, both halves.
 */
function CounterArt({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  const [problem, setProblem] = useState<string | null>(null)

  const upload = async (file: File) => {
    setProblem(null)
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('That file is not an image this browser can read.'))
        img.src = url
      })
      /*
       * Scale down until the data URL fits the form comfortably (the library
       * caps a whole design at 64K; validateDesign holds art to 48K). PNG
       * keeps transparency, which counter art usually wants; step down in
       * size rather than to JPEG so a transparent background never turns
       * into a white box.
       */
      let embedded: string | null = null
      for (const limit of [128, 96, 64, 48]) {
        const scale = Math.min(1, limit / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        const data = canvas.toDataURL('image/png')
        if (data.length <= 45_000) {
          embedded = data
          break
        }
      }
      if (!embedded) {
        setProblem('That image does not compress small enough to embed — try a simpler one.')
        return
      }
      edit((f) => void (f.art = embedded))
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="builder-row counter-art">
      <label className="chip file-chip" title="Embed an image in the design — it travels inside saves and library entries. Scaled down to fit; transparency is kept. Draw it nose-up.">
        Upload counter art
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
      </label>
      <label className="field grow" title="Or link an image by URL. Smaller than embedding, but whoever views the battle fetches it — offline play and dead links fall back to the class silhouette.">
        <span>…or image URL</span>
        <input
          placeholder="https://…/my-ship.png"
          value={draft.art?.startsWith('https://') ? draft.art : ''}
          onChange={(e) =>
            edit((f) => void (f.art = e.target.value.trim() || undefined))
          }
        />
      </label>
      {draft.art && (
        <>
          <span className="art-preview">
            <img src={draft.art} alt="Counter art preview" />
          </span>
          <button type="button" className="chip" onClick={() => edit((f) => void (f.art = undefined))}>
            Use class silhouette
          </button>
        </>
      )}
      {problem && <p className="fire-error">{problem}</p>}
    </div>
  )
}

function Power({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  const total = draft.reactors.reduce((n, r) => n + r.points.length, 0)
  return (
    <Section title="Power systems" hint={`B2 · ${total} power + ${draft.batteries} batteries`}>
      <table className="builder-table">
        <thead>
          <tr>
            <th>Reactor</th>
            <th>Damage type</th>
            <th>Power points</th>
            <th>Boxes each</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.reactors.map((reactor, i) => (
            <tr key={reactor.id}>
              <td>
                <input
                  value={reactor.label}
                  onChange={(e) => edit((f) => void (f.reactors[i].label = e.target.value))}
                />
              </td>
              <td>
                <select
                  value={reactor.hitKind}
                  onChange={(e) =>
                    edit((f) => {
                      f.reactors[i].hitKind = e.target.value as typeof reactor.hitKind
                    })
                  }
                >
                  {['left-main', 'right-main', 'center-main', 'sublight-reactor', 'aux'].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Num
                  label=""
                  value={reactor.points.length}
                  min={1}
                  max={12}
                  onChange={(n) =>
                    edit((f) => {
                      const boxes = f.reactors[i].points[0]?.boxes ?? 2
                      f.reactors[i].points = Array.from({ length: n }, () => ({ boxes }))
                    })
                  }
                />
              </td>
              <td>
                <Num
                  label=""
                  value={reactor.points[0]?.boxes ?? 0}
                  min={1}
                  max={8}
                  onChange={(n) =>
                    edit((f) => f.reactors[i].points.forEach((p) => void (p.boxes = n)))
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => edit((f) => void f.reactors.splice(i, 1))}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="builder-row">
        <button
          type="button"
          className="chip"
          onClick={() =>
            edit((f) =>
              f.reactors.push({
                id: `reactor-${f.reactors.length + 1}`,
                label: 'AUX PWR',
                hitKind: 'aux',
                points: [{ boxes: 2 }],
              }),
            )
          }
        >
          + reactor
        </button>
        <Num
          label="Batteries"
          value={draft.batteries}
          max={12}
          onChange={(n) => edit((f) => void (f.batteries = n))}
        />
        <Num
          label="FTL drive boxes"
          value={draft.ftlDriveBoxes}
          max={12}
          onChange={(n) => edit((f) => void (f.ftlDriveBoxes = n))}
        />
      </div>
    </Section>
  )
}

function Sublight({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  const { sublight } = draft
  const speeds = Array.from({ length: sublight.maxSpeed + 1 }, (_, i) => i)
  return (
    <Section title="Sublight drive and maneuvering" hint="C1.2, C2.2, E8.5.4">
      <div className="builder-row">
        <Num
          label="Max speed"
          value={sublight.maxSpeed}
          min={1}
          max={8}
          onChange={(n) =>
            edit((f) => {
              f.sublight.maxSpeed = n
              // C2.2.2 prints a turn row for every speed the ship can plot.
              const turns = f.sublight.turnBySpeed
              while (turns.length < n + 1) turns.push(0)
              turns.length = n + 1
            })
          }
        />
        <Num
          label="Accel / phase"
          value={sublight.maxAccelPerPhase}
          max={8}
          onChange={(n) => edit((f) => void (f.sublight.maxAccelPerPhase = n))}
        />
        <Num
          label="Safe accel"
          value={sublight.safeAccelPerRound}
          max={8}
          onChange={(n) => edit((f) => void (f.sublight.safeAccelPerRound = n))}
        />
        <Num
          label="Stress accel"
          value={sublight.stressAccelPerRound}
          max={8}
          onChange={(n) => edit((f) => void (f.sublight.stressAccelPerRound = n))}
        />
      </div>

      <p className="builder-hint">Turn template in degrees at each speed — 0 means no turn.</p>
      <div className="builder-row wrap">
        {speeds.map((speed) => (
          <Num
            key={speed}
            label={`Spd ${speed}`}
            value={sublight.turnBySpeed[speed] ?? 0}
            max={180}
            step={5}
            onChange={(n) => edit((f) => void (f.sublight.turnBySpeed[speed] = n))}
          />
        ))}
      </div>

      <p className="builder-hint">
        Drive damage boxes, in order — each is the new top speed once that box is marked (E8.5.4).
      </p>
      <div className="builder-row wrap">
        {sublight.dmgTopSpeed.map((speed, i) => (
          <Num
            key={i}
            label={`Box ${i + 1}`}
            value={speed}
            max={8}
            onChange={(n) => edit((f) => void (f.sublight.dmgTopSpeed[i] = n))}
          />
        ))}
        <button
          type="button"
          className="chip"
          onClick={() =>
            edit((f) => {
              f.sublight.dmgTopSpeed.push(0)
              f.sublight.driveBoxes = f.sublight.dmgTopSpeed.length
            })
          }
        >
          + box
        </button>
        <button
          type="button"
          className="chip danger"
          disabled={sublight.dmgTopSpeed.length === 0}
          onClick={() =>
            edit((f) => {
              f.sublight.dmgTopSpeed.pop()
              f.sublight.driveBoxes = f.sublight.dmgTopSpeed.length
            })
          }
        >
          − box
        </button>
      </div>
    </Section>
  )
}

function Defenses({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  return (
    <Section title="Shields and armor" hint="G1.1, G2.1">
      <div className="builder-row">
        <Num
          label="Shield gen boxes"
          value={draft.shields.generatorBoxes}
          max={12}
          onChange={(n) => edit((f) => void (f.shields.generatorBoxes = n))}
        />
      </div>
      <table className="builder-table">
        <thead>
          <tr>
            <th>Facing</th>
            <th>Shield</th>
            <th>Reinforcement</th>
            <th>Armor</th>
          </tr>
        </thead>
        <tbody>
          {SIDES.map((s) => (
            <tr key={s}>
              <th>{s}</th>
              <td>
                {/* Deliberately not clamped to the printed cap: a silent clamp
                    teaches nothing, so let the rules check explain G1.1.3. */}
                <Num
                  label=""
                  value={draft.shields.blue[s]}
                  max={99}
                  onChange={(n) => edit((f) => void (f.shields.blue[s] = n))}
                />
              </td>
              <td>
                <Num
                  label=""
                  value={draft.shields.green[s]}
                  max={12}
                  onChange={(n) => edit((f) => void (f.shields.green[s] = n))}
                />
              </td>
              <td>
                <Num
                  label=""
                  value={draft.armor[s]}
                  max={24}
                  onChange={(n) => edit((f) => void (f.armor[s] = n))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function Systems({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  return (
    <Section title="General systems" hint="B1.7">
      <table className="builder-table">
        <tbody>
          {draft.systems.map((group, i) => (
            <tr key={i}>
              <td>
                <select
                  value={group.kind}
                  onChange={(e) =>
                    edit((f) => {
                      f.systems[i].kind = e.target.value as SystemKind
                      f.systems[i].label = e.target.value
                    })
                  }
                >
                  {SYSTEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={group.label}
                  onChange={(e) => edit((f) => void (f.systems[i].label = e.target.value))}
                />
              </td>
              <td>
                <Num
                  label="boxes"
                  value={group.boxes}
                  max={24}
                  onChange={(n) => edit((f) => void (f.systems[i].boxes = n))}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => edit((f) => void f.systems.splice(i, 1))}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="chip"
        onClick={() =>
          edit((f) => {
            const group: SystemGroupDef = { kind: 'SPCL', label: 'Special', boxes: 1 }
            f.systems.push(group)
          })
        }
      >
        + system
      </button>
      <p className="builder-hint">
        Sciences boxes are free — they are paid for through the precision bonus they give your
        weapons. Command and cloak boxes are priced off the ship&apos;s own sensor value (H5, H6).
      </p>
    </Section>
  )
}

function ScoutSensors({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  const block = draft.scoutSensor
  return (
    <Section title="Scout sensors" hint="H3.1.1">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={Boolean(block)}
          onChange={(e) =>
            edit((f) => {
              f.scoutSensor = e.target.checked ? blankScoutSensor() : undefined
            })
          }
        />
        This ship carries a scout sensor block
      </label>
      {block && (
        <>
          <div className="builder-row wrap">
            <Num
              label="Sensors"
              value={block.sensors}
              min={1}
              max={8}
              onChange={(n) => edit((f) => void (f.scoutSensor!.sensors = n))}
            />
            <Num
              label="Damage boxes"
              value={block.damageBoxes}
              max={8}
              onChange={(n) => edit((f) => void (f.scoutSensor!.damageBoxes = n))}
            />
            <Num
              label="Targeting"
              value={block.targetingRange}
              max={48}
              onChange={(n) => edit((f) => void (f.scoutSensor!.targetingRange = n))}
            />
            <Num
              label="Jamming"
              value={block.jammingRange}
              max={48}
              onChange={(n) => edit((f) => void (f.scoutSensor!.jammingRange = n))}
            />
            <Num
              label="Scan"
              value={block.scanRange}
              max={48}
              onChange={(n) => edit((f) => void (f.scoutSensor!.scanRange = n))}
            />
          </div>
          <p className="builder-hint">
            Each sensor illuminates a target for the whole fleet (H3.4), jams within its radius
            (H3.5) or runs a full scan (H3.6) — one job each, chosen during Resource Allocation.
            Changing the sensor count rebuilds the SCOUT SEN line at one sensor per power point.
          </p>
        </>
      )}
    </Section>
  )
}

function Structure({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  return (
    <Section title="Structural integrity" hint="B1.8, B3.1.2">
      <div className="structure-track">
        {draft.structure.map((entry, i) => (
          <span
            key={i}
            className={entry.kind === 'dc' ? 'track-dc' : `track-box track-${entry.color}`}
            title={entry.kind === 'dc' ? `Damage Control drops to ${entry.rating}` : entry.color}
          >
            {entry.kind === 'dc' ? entry.rating : ''}
          </span>
        ))}
      </div>
      <div className="builder-row">
        <button
          type="button"
          className="chip"
          onClick={() => edit((f) => void f.structure.push({ kind: 'box', color: 'black' }))}
        >
          + black box
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => edit((f) => void f.structure.push({ kind: 'box', color: 'red' }))}
        >
          + red box
        </button>
        <button
          type="button"
          className="chip"
          onClick={() =>
            edit((f) => {
              const last = [...f.structure].reverse().find((e) => e.kind === 'dc')
              const rating = last && last.kind === 'dc' ? last.rating : f.damageControlRating
              f.structure.push({ kind: 'dc', rating: Math.max(0, rating - 1) })
            })
          }
        >
          + DC marker
        </button>
        <button
          type="button"
          className="chip danger"
          disabled={draft.structure.length === 0}
          onClick={() => edit((f) => void f.structure.pop())}
        >
          remove last
        </button>
      </div>
      <p className="builder-hint">
        Red boxes cannot be repaired (B3.1.3). Crossing a Damage Control marker permanently drops
        the rating.
      </p>
    </Section>
  )
}

function Weapons({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  return (
    <Section title="Weapons" hint="B1.5, E3.2">
      {draft.weapons.map((weapon, wi) => (
        <WeaponEditor key={weapon.id} weapon={weapon} index={wi} edit={edit} />
      ))}
      <button
        type="button"
        className="chip"
        onClick={() =>
          edit((f) => {
            const { weapon, line } = blankWeapon(`w-${f.weapons.length + 1}-${Date.now()}`)
            f.weapons.push(weapon)
            f.functions.push(line)
          })
        }
      >
        + weapon system
      </button>
      <datalist id="sfc-traits">
        {Object.keys(TRAIT_MODIFIERS).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </Section>
  )
}

function WeaponEditor({
  weapon,
  index,
  edit,
}: {
  weapon: WeaponSystemDef
  index: number
  edit: Edit
}) {
  const w = (mutate: (weapon: WeaponSystemDef, form: ShipForm) => void) =>
    edit((f) => mutate(f.weapons[index], f))

  // A homing weapon's chart is read one endurance box at a time, so its
  // brackets carry the phase of flight they belong to (E5.1.5).
  const homing = weapon.traits.some((t) => /^HOMING/i.test(t))

  return (
    <div className="weapon-editor">
      <div className="builder-row">
        <label className="field grow">
          <span>Name</span>
          <input
            value={weapon.name}
            onChange={(e) =>
              w((weap, form) => {
                weap.name = e.target.value
                const line = form.functions.find((l) => l.weaponSystemId === weap.id)
                if (line) line.label = e.target.value
              })
            }
          />
        </label>
        <label className="field">
          <span>Class</span>
          <input
            value={weapon.weaponClass}
            list="sfc-weapon-classes"
            onChange={(e) => w((weap) => void (weap.weaponClass = e.target.value))}
          />
          <datalist id="sfc-weapon-classes">
            {WEAPON_CLASSES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="chip danger"
          onClick={() =>
            edit((f) => {
              const [removed] = f.weapons.splice(index, 1)
              f.functions = f.functions.filter((l) => l.weaponSystemId !== removed.id)
            })
          }
        >
          remove
        </button>
      </div>

      <label className="field grow">
        <span>Traits (comma separated)</span>
        <input
          value={weapon.traits.join(', ')}
          list="sfc-traits"
          placeholder="PD MODE, PREC 1, NoBAT…"
          onChange={(e) =>
            w((weap) => {
              weap.traits = e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            })
          }
        />
      </label>

      <p className="builder-hint">Mounts — each fires once a phase into any arc it covers (E2.2.2).</p>
      <table className="builder-table">
        <thead>
          <tr>
            <th>Arcs</th>
            <th>Arming</th>
            <th>Boxes</th>
            <th>Slow arm</th>
            <th>Ammo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {weapon.mounts.map((mount, mi) => (
            <tr key={mount.id}>
              <td>
                <div className="arc-edit">
                  <ArcRose arcs={mount.arcs} size={26} />
                  <div className="arc-toggles">
                  {ARCS.map((arc) => (
                    <button
                      key={arc}
                      type="button"
                      className={`chip arc${mount.arcs.includes(arc) ? ' is-on' : ''}`}
                      onClick={() =>
                        w((weap) => {
                          const arcs = weap.mounts[mi].arcs
                          const at = arcs.indexOf(arc)
                          if (at >= 0) arcs.splice(at, 1)
                          else arcs.push(arc)
                        })
                      }
                    >
                      {arc}
                    </button>
                  ))}
                  </div>
                </div>
              </td>
              <td>
                <Num
                  label=""
                  value={mount.armingCircles}
                  min={1}
                  max={8}
                  onChange={(n) => w((weap) => void (weap.mounts[mi].armingCircles = n))}
                />
              </td>
              <td>
                <Num
                  label=""
                  value={mount.hitBoxes}
                  min={1}
                  max={8}
                  onChange={(n) => w((weap) => void (weap.mounts[mi].hitBoxes = n))}
                />
              </td>
              <td>
                <label className="checkbox" title="E4.2.8 — a diamond forces a wait for the next round">
                  <input
                    type="checkbox"
                    checked={(mount.roundGates ?? []).some(Boolean)}
                    onChange={(e) =>
                      w((weap) => {
                        const m = weap.mounts[mi]
                        m.roundGates = e.target.checked
                          ? Array.from({ length: m.armingCircles - 1 }, (_, i) => i === 0)
                          : undefined
                      })
                    }
                  />
                </label>
              </td>
              <td>
                {/* F1.2 — blank means unlimited shots, which is the norm. */}
                <Num
                  label=""
                  value={mount.ammo ?? 0}
                  max={99}
                  onChange={(n) => w((weap) => void (weap.mounts[mi].ammo = n === 0 ? undefined : n))}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => w((weap) => void weap.mounts.splice(mi, 1))}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="chip"
        onClick={() =>
          w((weap) => {
            const last = weap.mounts[weap.mounts.length - 1]
            weap.mounts.push({
              id: `${weap.id}-m${weap.mounts.length + 1}`,
              arcs: last ? [...last.arcs] : ['FS', 'FP'],
              armingCircles: last?.armingCircles ?? 2,
              hitBoxes: last?.hitBoxes ?? 1,
              roundGates: last?.roundGates ? [...last.roundGates] : undefined,
            })
          })
        }
      >
        + mount
      </button>

      <p className="builder-hint">
        Firing chart — ranges in inches, dice per mount (E3.2.1).
        {homing && ' Phase is the endurance box each bracket sits in (E5.1.5).'}
      </p>
      <table className="builder-table">
        <thead>
          <tr>
            {homing && <th>Phase</th>}
            <th>From</th>
            <th>To</th>
            <th>Band</th>
            {DICE.map((d) => (
              <th key={d}>{d[0].toUpperCase()}</th>
            ))}
            <th>Bonus</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {weapon.brackets.map((bracket, bi) => (
            <tr key={bi}>
              {homing && (
                <td>
                  <Num
                    label=""
                    value={bracket.endurancePhase ?? 0}
                    max={9}
                    onChange={(n) =>
                      w((weap) => void (weap.brackets[bi].endurancePhase = n === 0 ? undefined : n))
                    }
                  />
                </td>
              )}
              <td>
                <Num
                  label=""
                  value={bracket.min}
                  max={99}
                  onChange={(n) => w((weap) => void (weap.brackets[bi].min = n))}
                />
              </td>
              <td>
                <Num
                  label=""
                  value={bracket.max}
                  max={99}
                  onChange={(n) => w((weap) => void (weap.brackets[bi].max = n))}
                />
              </td>
              <td>
                <select
                  value={bracket.band}
                  onChange={(e) =>
                    w((weap) => void (weap.brackets[bi].band = e.target.value as RangeBand))
                  }
                >
                  {BANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </td>
              {DICE.map((die) => (
                <td key={die}>
                  <Num
                    label=""
                    value={bracket.dice.filter((d) => d === die).length}
                    max={9}
                    onChange={(n) =>
                      w((weap) => {
                        const others = weap.brackets[bi].dice.filter((d) => d !== die)
                        weap.brackets[bi].dice = [
                          ...others,
                          ...(Array.from({ length: n }, () => die) as DieColor[]),
                        ].sort((a, b) => DICE.indexOf(a) - DICE.indexOf(b))
                      })
                    }
                  />
                </td>
              ))}
              <td>
                <Num
                  label=""
                  value={bracket.bonus ?? 0}
                  max={9}
                  onChange={(n) =>
                    w((weap) => void (weap.brackets[bi].bonus = n === 0 ? undefined : n))
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => w((weap) => void weap.brackets.splice(bi, 1))}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="builder-row">
        <button
          type="button"
          className="chip"
          onClick={() =>
            w((weap) => {
              const last = weap.brackets[weap.brackets.length - 1]
              // A homing weapon's range restarts each phase; a direct-fire
              // chart continues from the last bracket (E3.2.1, E5.1.5).
              const min = homing ? 0 : last ? last.max + 1 : 0
              weap.brackets.push({
                min,
                max: min + 3,
                band: homing ? 'green' : 'black',
                dice: ['blue'],
                ...(homing ? { endurancePhase: (last?.endurancePhase ?? 0) + 1 } : {}),
              })
            })
          }
        >
          + bracket
        </button>
        <Num
          label="SPCL dmg"
          value={weapon.special?.damage ?? 0}
          max={20}
          onChange={(n) =>
            w((weap) => {
              weap.special = { ...(weap.special ?? { damage: 0 }), damage: n }
            })
          }
        />
        <Num
          label="LEAK +"
          value={weapon.special?.leak ?? 0}
          max={20}
          onChange={(n) =>
            w((weap) => {
              weap.special = { ...(weap.special ?? { damage: 0 }), leak: n || undefined }
            })
          }
        />
        <Num
          label="STR +"
          value={weapon.special?.structure ?? 0}
          max={20}
          onChange={(n) =>
            w((weap) => {
              weap.special = { ...(weap.special ?? { damage: 0 }), structure: n || undefined }
            })
          }
        />
      </div>
    </div>
  )
}

function Functions({ draft, edit }: { draft: ShipForm; edit: Edit }) {
  const setStep = (line: FunctionLineDef, i: number, patch: Partial<(typeof line.steps)[0]>) =>
    edit((f) => {
      const target = f.functions.find((l) => l.id === line.id)
      if (target) Object.assign(target.steps[i], patch)
    })
  return (
    <Section title="Functions and power levels" hint="B2.2">
      <p className="builder-hint">
        Each circle is one arming or power step. The free value is what the line gives for nothing —
        the solid circles on a printed form (B2.2.3).
      </p>
      <table className="builder-table functions-table">
        <thead>
          <tr>
            <th>Line</th>
            <th>Free</th>
            <th>Circles (value / power cost)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.functions.map((line) => (
            <tr key={line.id}>
              <th>{line.label}</th>
              <td>
                <Num
                  label=""
                  value={line.freeValue}
                  max={30}
                  onChange={(n) =>
                    edit((f) => {
                      const target = f.functions.find((l) => l.id === line.id)
                      if (target) target.freeValue = n
                    })
                  }
                />
              </td>
              <td>
                <div className="builder-row wrap">
                  {line.steps.map((s, i) => (
                    <span key={i} className="step-pair">
                      <Num
                        label=""
                        value={s.value}
                        max={30}
                        onChange={(n) => setStep(line, i, { value: n })}
                      />
                      <Num
                        label=""
                        value={s.powerCost}
                        min={1}
                        max={6}
                        onChange={(n) => setStep(line, i, { powerCost: n })}
                      />
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    edit((f) => {
                      const target = f.functions.find((l) => l.id === line.id)
                      if (!target) return
                      const last = target.steps[target.steps.length - 1]
                      target.steps.push({ powerCost: last?.powerCost ?? 1, value: (last?.value ?? target.freeValue) + 1 })
                    })
                  }
                >
                  +
                </button>
                <button
                  type="button"
                  className="chip danger"
                  disabled={line.steps.length === 0}
                  onClick={() =>
                    edit((f) => {
                      const target = f.functions.find((l) => l.id === line.id)
                      target?.steps.pop()
                    })
                  }
                >
                  −
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

const COMPONENTS = [
  ['generalSystems', 'General systems'],
  ['sensors', 'Sensors'],
  ['defence', 'Defense'],
  ['powerSystem', 'Power system'],
  ['speedAccel', 'Speed & accel'],
  ['sif', 'SIF'],
  ['maneuver', 'Maneuver'],
  ['offense', 'Offense'],
] as const

function CostPanel({
  draft,
  cost,
  edit,
}: {
  draft: ShipForm
  cost: PointBreakdown
  edit: Edit
}) {
  const suggested = Math.max(1, Math.round(cost.points))
  const largest = Math.max(...COMPONENTS.map(([key]) => Math.abs(cost[key])), 1)
  return (
    <div className="cost-panel">
      <div className="cost-headline">
        <strong>{cost.points.toFixed(1)}</strong>
        <span>points, by the designers&apos; model</span>
      </div>
      <div className="builder-row">
        <Num
          label="Printed point value"
          value={draft.pointValue}
          max={999}
          onChange={(n) => edit((f) => void (f.pointValue = n))}
        />
        <button type="button" className="chip" onClick={() => edit((f) => void (f.pointValue = suggested))}>
          use {suggested}
        </button>
      </div>
      {draft.pointValue > 0 && (
        <p className="builder-hint">
          Special modifier ×{impliedSpecialModifier(draft).toFixed(2)} — how far your printed value
          sits from the model, the same dial the designers use on canon ships.
        </p>
      )}

      <ul className="cost-bars">
        {COMPONENTS.map(([key, label]) => (
          <li key={key}>
            <span className="cost-label">{label}</span>
            <span className="cost-bar">
              <i style={{ width: `${(Math.abs(cost[key]) / largest) * 100}%` }} />
            </span>
            <span className="cost-value">{cost[key].toFixed(1)}</span>
          </li>
        ))}
      </ul>

      <dl className="cost-facts">
        <div>
          <dt>Total offense</dt>
          <dd>{cost.totalOffense.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Actual power</dt>
          <dd>{cost.actualPower.toFixed(0)}</dd>
        </div>
        <div>
          <dt>Damage boxes</dt>
          <dd>{cost.systemBoxes}</dd>
        </div>
      </dl>

      {cost.weapons.length > 0 && (
        <table className="builder-table weapon-costs">
          <thead>
            <tr>
              <th>Weapon</th>
              <th>Dmg</th>
              <th>Rng</th>
              <th>Arm</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {cost.weapons.map((w) => (
              <tr key={w.name}>
                <td>{w.name}</td>
                <td>{w.basicDamage.toFixed(2)}</td>
                <td>{w.rangeModifier.toFixed(2)}</td>
                <td>×{w.armingMultiplier}</td>
                <td>{w.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Problems({ problems }: { problems: ReturnType<typeof validateDesign> }) {
  if (problems.length === 0) {
    return <p className="design-ok">The design is legal and ready to fly.</p>
  }
  return (
    <ul className="design-problems">
      {problems.map((p, i) => (
        <li key={i} className={p.severity}>
          {p.message}
        </li>
      ))}
    </ul>
  )
}


/**
 * Publishing a design to the shared library.
 *
 * The dialog exists to make two things impossible to miss. The first is that
 * publishing is permanent and public: an entry cannot be edited or withdrawn,
 * because battles saved with it must go on replaying the same way, so an edit
 * is a new entry rather than a change to this one. The second is that the
 * design is checked before it goes — not for taste, but for whether the engine
 * could field it at all.
 */
function PublishDialog({ form, onClose }: { form: ShipForm; onClose: () => void }) {
  const [author, setAuthor] = useState('')
  const [notes, setNotes] = useState('')
  // Defaulted from the design and then the publisher's to change: a hull built
  // as a Union cruiser is filed under Union unless they say otherwise.
  const [faction, setFaction] = useState<LibraryFaction>(() => libraryFaction(form))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const check = checkPublishable(form, author, notes)
  const warnings = check.problems.filter((p) => p.severity === 'warning')

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      await publishDesign({
        fingerprint: check.fingerprint,
        form,
        faction,
        points: check.points,
        author,
        notes,
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="segment-help publish-dialog">
      <h3>Publish “{form.name}” to the library</h3>

      {done ? (
        <>
          <p className="hint">
            Published. Anyone pointed at this library can now find and take a copy of it.
          </p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            This is public and permanent: an entry cannot be edited or withdrawn, because battles
            saved with it have to keep replaying the same way. Publishing a changed version makes a
            new entry rather than altering this one. Costed at{' '}
            <strong>{check.points} points</strong> by the designers&apos; own model.
          </p>

          {check.refusal && <p className="fire-error">{check.refusal}</p>}
          {warnings.length > 0 && (
            <ul className="hint">
              {warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          )}

          <label className="field inline">
            <span>Faction</span>
            <select
              value={faction}
              title="How the library files it. Fan designs are always listed apart from the printed ships, whichever flag they fly."
              onChange={(e) => setFaction(e.target.value as LibraryFaction)}
            >
              {LIBRARY_FACTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Your name</span>
            <input
              value={author}
              maxLength={MAX_AUTHOR_CHARS}
              placeholder="optional"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              value={notes}
              maxLength={MAX_NOTES_CHARS}
              rows={3}
              placeholder="What is it for? optional"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {error && <p className="fire-error">{error}</p>}
          <div className="builder-row">
            <button type="button" className="primary" disabled={!check.ok || busy} onClick={() => void publish()}>
              {busy ? 'Publishing…' : 'Publish'}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
