import { useMemo, useRef, useState } from 'react'
import { allShipForms } from '../data/ships'
import { FIGHTER_CARDS } from '../data/fighters'
import { allScenarioEntries, facingToHeading, type CustomScenario } from '../data/scenarios'
import { ASTEROID_COUNTERS, DENSITY_STATS, type AsteroidDensity } from '../data/terrainCounters'
import type { Terrain } from '../engine/game'
import { headingVector } from '../engine/geometry'
import type { Point } from '../engine/types'
import {
  customScenarioId,
  importCustomScenarios,
  saveCustomScenario,
  scenarioFileContents,
} from './customScenarios'
import { newGame } from './store'
import { checkScenarioPublishable } from '../engine/scenarioLibrary'
import { MAX_AUTHOR_CHARS, MAX_NOTES_CHARS } from '../engine/shipLibrary'
import { publishScenario } from './scenarioLibrary'

/**
 * The scenario designer. A battle is laid out directly on a live map — click
 * to place the printed asteroid counters, planets, moons and gas clouds; drop
 * each side's deployment anchor and turn its compass facing — with the fleet
 * lists, the story text and the K1.2 placement rules checked as you go.
 *
 * Designs live in `src/data/customScenarios.json` exactly like custom ships:
 * committed there they travel with the site; until then they are drafts in
 * this browser, and a battle file embeds the whole design so a save plays
 * anywhere.
 */

const PX = 12 // preview scale: 1 inch = 12px

type Tool =
  | { kind: 'select' }
  | { kind: 'asteroid'; density: AsteroidDensity }
  | { kind: 'planet' }
  | { kind: 'moon' }
  | { kind: 'gas-cloud' }
  | { kind: 'anchor'; sideIndex: number }

function blankScenario(): CustomScenario {
  return {
    id: '',
    name: 'New Battle',
    background: '',
    victory: 'Victory points are earned from damage levels inflicted (S2.8.4).',
    specialRules: [],
    bounds: { width: 36, height: 36, fixed: true },
    terrain: [],
    sides: [
      {
        side: 'Blue Force',
        objective: 'Destroy the enemy force or drive it off.',
        facing: 6,
        speed: 2,
        anchor: { x: 33, y: 18 },
        spread: { x: 0, y: 2 },
        force: ['union-yorktown-i-class-heavy-cruiser'],
      },
      {
        side: 'Red Force',
        objective: 'Destroy the enemy force or drive it off.',
        facing: 2,
        speed: 2,
        anchor: { x: 3, y: 18 },
        spread: { x: 0, y: 2 },
        force: ['vallari-v-7c-raider-class-battlecruiser'],
      },
    ],
  }
}

/** Copy any existing scenario — printed or designed — as a starting point. */
function copyOf(scenarioId: string): CustomScenario | null {
  const entry = allScenarioEntries().find((e) => e.scenario.id === scenarioId)
  if (!entry) return null
  const { scenario, sides } = entry
  return {
    id: '',
    name: `${scenario.name} (copy)`,
    background: scenario.background,
    victory: scenario.victory,
    specialRules: scenario.specialRules ? [...scenario.specialRules] : [],
    bounds: { ...scenario.bounds },
    nebula: scenario.nebula,
    terrain: structuredClone(scenario.terrain),
    sides: sides.map((s) => ({
      side: s.side,
      objective: entry.scenario.objectives[s.side] ?? '',
      facing: s.facing,
      speed: s.speed,
      anchor: { ...s.anchor },
      spread: { ...s.spread },
      force: s.defaults().map((f) => f.id),
    })),
  }
}

interface Problem {
  severity: 'error' | 'warning'
  message: string
}

function validate(draft: CustomScenario, knownFormIds: Set<string>): Problem[] {
  const problems: Problem[] = []
  const err = (message: string) => problems.push({ severity: 'error', message })
  const warn = (message: string) => problems.push({ severity: 'warning', message })

  if (!draft.name.trim()) err('The scenario needs a name.')
  if (draft.bounds.width < 18 || draft.bounds.height < 18) err('The map must be at least 18 inches a side.')
  if (draft.bounds.width > 72 || draft.bounds.height > 72) err('The map cannot exceed 72 inches a side.')
  if (draft.sides.length < 2) err('A battle needs at least two sides.')
  if (new Set(draft.sides.map((s) => s.side.trim())).size !== draft.sides.length) {
    err('Side names must be distinct.')
  }
  for (const side of draft.sides) {
    if (!side.side.trim()) err('Every side needs a name.')
    if (side.force.length === 0) err(`${side.side || 'A side'} has no ships.`)
    if (side.force.length > 8) err(`${side.side} exceeds the 8-hull limit (S2.5.4).`)
    for (const id of side.force) {
      if (!knownFormIds.has(id)) err(`${side.side}: unknown ship "${id}".`)
    }
    if (
      side.anchor.x < 1.5 ||
      side.anchor.y < 1.5 ||
      side.anchor.x > draft.bounds.width - 1.5 ||
      side.anchor.y > draft.bounds.height - 1.5
    ) {
      err(`${side.side}'s deployment anchor is off the map.`)
    }
  }

  const planets = draft.terrain.filter((t) => t.kind === 'planet')
  if (planets.length > 1) err('Only one planet per scenario (K1.2.3) — moons are unlimited.')
  for (const t of draft.terrain) {
    if (
      t.center.x - t.radius < 0 ||
      t.center.y - t.radius < 0 ||
      t.center.x + t.radius > draft.bounds.width ||
      t.center.y + t.radius > draft.bounds.height
    ) {
      warn(`${t.name} extends past the map edge.`)
    }
  }
  for (const a of draft.terrain) {
    for (const b of draft.terrain) {
      if (a.id >= b.id) continue
      const gap = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) - a.radius - b.radius
      if (gap < 0) warn(`${a.name} and ${b.name} overlap (K1.2.2 forbids it).`)
      else if (gap < 3) warn(`${a.name} and ${b.name} are under 3 inches apart (K1.2.2).`)
    }
  }
  return problems
}

const DENSITY_ORDER: AsteroidDensity[] = ['light', 'medium', 'high', 'extreme']
const DENSITY_COLOR: Record<AsteroidDensity, string> = {
  light: '#4aa8ff',
  medium: '#57c46f',
  high: '#ffb020',
  extreme: '#ff4d4d',
}
const SIDE_COLOR = ['#5aa9ff', '#ff5c5c', '#cc99cc']

export function ScenarioDesigner({ onClose }: { onClose: () => void }) {
  const roster = useMemo(() => allShipForms(), [])
  const knownFormIds = useMemo(() => new Set(roster.map((f) => f.id)), [roster])
  const [draft, setDraft] = useState<CustomScenario>(blankScenario)
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [selectedTerrain, setSelectedTerrain] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [vsAi, setVsAi] = useState(true)
  const [publishing, setPublishing] = useState<CustomScenario | null>(null)
  const dragging = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const edit = (mutate: (d: CustomScenario) => void) =>
    setDraft((current) => {
      const next = structuredClone(current)
      mutate(next)
      return next
    })

  const problems = useMemo(() => validate(draft, knownFormIds), [draft, knownFormIds])
  const blocked = problems.some((p) => p.severity === 'error')

  const toBoard = (e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * draft.bounds.width
    const y = ((e.clientY - rect.top) / rect.height) * draft.bounds.height
    // Half-inch snap, like laying a counter along a printed grid.
    return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 }
  }

  const nextAsteroid = (density: AsteroidDensity): Terrain | null => {
    const used = new Set(
      draft.terrain.filter((t) => t.kind === 'asteroid-field').map((t) => t.id),
    )
    const counter = ASTEROID_COUNTERS.find(
      (c) => c.density === density && !used.has(`asteroid-${c.id}`),
    )
    if (!counter) return null
    const stats = DENSITY_STATS[density]
    return {
      id: `asteroid-${counter.id}`,
      kind: 'asteroid-field',
      name: `Asteroids #${counter.id}`,
      center: { x: 0, y: 0 },
      radius: 2,
      density,
      safeSpeed: stats.spd,
      damageDie: stats.dmgDie,
      cover: stats.cover,
      scan: stats.scan,
    }
  }

  const place = (at: Point) => {
    if (tool.kind === 'select') return
    if (tool.kind === 'anchor') {
      edit((d) => {
        d.sides[tool.sideIndex].anchor = at
      })
      return
    }
    edit((d) => {
      let feature: Terrain | null = null
      if (tool.kind === 'asteroid') {
        feature = nextAsteroid(tool.density)
        if (!feature) return
      } else {
        const n = d.terrain.filter((t) => t.kind === tool.kind).length + 1
        const defaults = { planet: 5, moon: 2.5, 'gas-cloud': 4 } as const
        feature = {
          id: `${tool.kind}-${n}`,
          kind: tool.kind,
          name:
            tool.kind === 'planet'
              ? 'Planet'
              : tool.kind === 'moon'
                ? `Moon ${n}`
                : `Gas cloud ${n}`,
          center: { x: 0, y: 0 },
          radius: defaults[tool.kind],
          ...(tool.kind === 'gas-cloud' ? { scan: 3 } : {}),
        }
      }
      feature.center = at
      d.terrain.push(feature)
    })
    if (tool.kind !== 'asteroid') setTool({ kind: 'select' })
  }

  const selected = draft.terrain.find((t) => t.id === selectedTerrain) ?? null

  const save = (): CustomScenario => {
    const withId = draft.id ? draft : { ...draft, id: customScenarioId(draft.name) }
    saveCustomScenario(structuredClone(withId))
    setDraft(withId)
    return withId
  }

  const download = () => {
    save()
    const blob = new Blob([scenarioFileContents()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'customScenarios.json'
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Saved. Commit customScenarios.json and the scenario ships with the site.')
  }

  const play = () => {
    const saved = save()
    newGame({
      scenarioId: saved.id,
      seed: Math.floor(Math.random() * 1e9),
      aiSides: vsAi && saved.sides.length > 1 ? [saved.sides[1].side] : undefined,
    })
    onClose()
  }

  const upload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      const list: CustomScenario[] = Array.isArray(parsed) ? parsed : [parsed]
      setStatus(`Loaded ${importCustomScenarios(list)} scenario(s) as drafts.`)
    } catch {
      setStatus('That file is not a StarForce scenario file.')
    }
  }

  const w = draft.bounds.width * PX
  const h = draft.bounds.height * PX

  return (
    <div className="picker-backdrop" role="dialog" aria-label="Scenario designer">
      <div className="picker builder designer">
        <header>
          <h2>Scenario designer</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="builder-toolbar">
          <label className="field">
            <span>Start from</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value === 'blank') setDraft(blankScenario())
                else {
                  const copy = copyOf(e.target.value)
                  if (copy) setDraft(copy)
                }
                setSelectedTerrain(null)
              }}
            >
              <option value="">Blank map…</option>
              <option value="blank">Blank map</option>
              {allScenarioEntries().map(({ scenario }) => (
                <option key={scenario.id} value={scenario.id}>
                  Copy: {scenario.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void save()}>
            Save draft
          </button>
          <button type="button" className="primary" onClick={download}>
            Download customScenarios.json
          </button>
          <button
            type="button"
            title="Share this scenario in the library, along with any fan ships it fields"
            onClick={() => setPublishing(save())}
          >
            Publish to library
          </button>
          <label className="chip file-chip">
            Load a scenario file
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />
          </label>
          {status && <span className="builder-status">{status}</span>}
        </div>

        {publishing && (
          <PublishScenarioDialog scenario={publishing} onClose={() => setPublishing(null)} />
        )}

        <div className="designer-body">
          <div className="designer-map-pane">
            <div className="designer-tools">
              <span>Place</span>
              <button
                type="button"
                className={`chip${tool.kind === 'select' ? ' is-on' : ''}`}
                onClick={() => setTool({ kind: 'select' })}
                title="Click a feature to select it; drag to move it"
              >
                Select
              </button>
              {DENSITY_ORDER.map((density) => (
                <button
                  key={density}
                  type="button"
                  className={`chip${tool.kind === 'asteroid' && tool.density === density ? ' is-on' : ''}`}
                  style={{ borderColor: DENSITY_COLOR[density] }}
                  title={`${DENSITY_STATS[density].label} density asteroid counter (K2.1.2): SPD ${DENSITY_STATS[density].spd}, CVR ${DENSITY_STATS[density].cover}`}
                  onClick={() => setTool({ kind: 'asteroid', density })}
                >
                  {DENSITY_STATS[density].label}
                </button>
              ))}
              <button
                type="button"
                className={`chip${tool.kind === 'planet' ? ' is-on' : ''}`}
                onClick={() => setTool({ kind: 'planet' })}
                title="One per scenario (K1.2.3)"
              >
                Planet
              </button>
              <button
                type="button"
                className={`chip${tool.kind === 'moon' ? ' is-on' : ''}`}
                onClick={() => setTool({ kind: 'moon' })}
              >
                Moon
              </button>
              <button
                type="button"
                className={`chip${tool.kind === 'gas-cloud' ? ' is-on' : ''}`}
                onClick={() => setTool({ kind: 'gas-cloud' })}
              >
                Gas cloud
              </button>
              {draft.sides.map((side, i) => (
                <button
                  key={side.side + i}
                  type="button"
                  className={`chip${tool.kind === 'anchor' && tool.sideIndex === i ? ' is-on' : ''}`}
                  style={{ borderColor: SIDE_COLOR[i % SIDE_COLOR.length] }}
                  title={`Click the map to move ${side.side}'s deployment anchor`}
                  onClick={() => setTool({ kind: 'anchor', sideIndex: i })}
                >
                  ⚓ {side.side}
                </button>
              ))}
            </div>

            <svg
              ref={svgRef}
              className="designer-map"
              viewBox={`0 0 ${w} ${h}`}
              onPointerDown={(e) => {
                if (tool.kind !== 'select') {
                  place(toBoard(e))
                  return
                }
                setSelectedTerrain(null)
              }}
              onPointerMove={(e) => {
                if (!dragging.current) return
                const at = toBoard(e)
                edit((d) => {
                  const t = d.terrain.find((x) => x.id === dragging.current)
                  if (t) t.center = at
                })
              }}
              onPointerUp={() => {
                dragging.current = null
              }}
            >
              <rect x={0} y={0} width={w} height={h} className={`map-bg${draft.nebula ? ' is-nebula' : ''}`} />
              {Array.from({ length: Math.floor(draft.bounds.width / 3) - 0 }, (_, i) => (
                <line key={`v${i}`} x1={(i + 1) * 3 * PX} y1={0} x2={(i + 1) * 3 * PX} y2={h} className="grid" />
              ))}
              {Array.from({ length: Math.floor(draft.bounds.height / 3) - 0 }, (_, i) => (
                <line key={`h${i}`} x1={0} y1={(i + 1) * 3 * PX} x2={w} y2={(i + 1) * 3 * PX} className="grid" />
              ))}

              {draft.terrain.map((t) => (
                <g
                  key={t.id}
                  className={`designer-terrain${selectedTerrain === t.id ? ' is-selected' : ''}`}
                  onPointerDown={(e) => {
                    if (tool.kind !== 'select') return
                    e.stopPropagation()
                    setSelectedTerrain(t.id)
                    dragging.current = t.id
                    svgRef.current?.setPointerCapture(e.pointerId)
                  }}
                >
                  <circle
                    cx={t.center.x * PX}
                    cy={t.center.y * PX}
                    r={t.radius * PX}
                    className={`terrain terrain-${t.kind}`}
                    style={t.density ? { stroke: DENSITY_COLOR[t.density as AsteroidDensity] } : undefined}
                  />
                  <text x={t.center.x * PX} y={t.center.y * PX + 3} className="terrain-label" textAnchor="middle">
                    {t.name}
                  </text>
                </g>
              ))}

              {draft.sides.map((side, i) => {
                const color = SIDE_COLOR[i % SIDE_COLOR.length]
                const hv = headingVector(facingToHeading(side.facing))
                return (
                  <g key={side.side + i}>
                    {side.force.map((_, n) => (
                      <rect
                        key={n}
                        x={(side.anchor.x + side.spread.x * n) * PX - 6}
                        y={(side.anchor.y + side.spread.y * n) * PX - 6}
                        width={12}
                        height={12}
                        fill="none"
                        stroke={color}
                        strokeWidth={n === 0 ? 2 : 1}
                        opacity={n === 0 ? 1 : 0.45}
                      />
                    ))}
                    <line
                      x1={side.anchor.x * PX}
                      y1={side.anchor.y * PX}
                      x2={side.anchor.x * PX + hv.x * 14}
                      y2={side.anchor.y * PX + hv.y * 14}
                      stroke={color}
                      strokeWidth={2}
                      markerEnd="none"
                    />
                  </g>
                )
              })}
            </svg>

            {selected && (
              <div className="designer-selected">
                <strong>{selected.name}</strong>
                <label className="field tiny">
                  <span>Radius</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={0.5}
                    value={selected.radius}
                    onChange={(e) =>
                      edit((d) => {
                        const t = d.terrain.find((x) => x.id === selected.id)
                        if (t) t.radius = Math.max(1, Math.min(10, Number(e.target.value) || t.radius))
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => {
                    edit((d) => {
                      d.terrain = d.terrain.filter((t) => t.id !== selected.id)
                    })
                    setSelectedTerrain(null)
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <div className="builder-form designer-props">
            <section className="builder-section">
              <h3>
                Battle <em>S2</em>
              </h3>
              <div className="builder-row wrap">
                <label className="field grow">
                  <span>Name</span>
                  <input value={draft.name} onChange={(e) => edit((d) => void (d.name = e.target.value))} />
                </label>
                <label className="field tiny">
                  <span>Width ″</span>
                  <input
                    type="number"
                    min={18}
                    max={72}
                    value={draft.bounds.width}
                    onChange={(e) => edit((d) => void (d.bounds.width = Number(e.target.value) || 36))}
                  />
                </label>
                <label className="field tiny">
                  <span>Height ″</span>
                  <input
                    type="number"
                    min={18}
                    max={72}
                    value={draft.bounds.height}
                    onChange={(e) => edit((d) => void (d.bounds.height = Number(e.target.value) || 36))}
                  />
                </label>
                <label className="checkbox" title="The whole play area sits inside a nebula (K4.1.1)">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.nebula)}
                    onChange={(e) => edit((d) => void (d.nebula = e.target.checked || undefined))}
                  />
                  Nebula
                </label>
              </div>
              <label className="field grow">
                <span>Background</span>
                <textarea
                  rows={2}
                  value={draft.background}
                  onChange={(e) => edit((d) => void (d.background = e.target.value))}
                />
              </label>
              <label className="field grow">
                <span>Victory</span>
                <textarea
                  rows={2}
                  value={draft.victory}
                  onChange={(e) => edit((d) => void (d.victory = e.target.value))}
                />
              </label>
            </section>

            <section className="builder-section">
              <h3>
                Objectives <em>beyond the guns</em>
              </h3>
              {(draft.missions ?? []).map((m, mi) => (
                <div key={m.id} className="builder-row wrap">
                  <span className="chip">
                    {m.kind === 'hold' ? '⬤ hold' : m.kind === 'cargo' ? '◆ cargo' : '＋ rescue'}
                  </span>
                  <label className="field grow">
                    <span>Name</span>
                    <input
                      value={m.name}
                      onChange={(e) => edit((d) => void (d.missions![mi].name = e.target.value))}
                    />
                  </label>
                  <label className="field tiny">
                    <span>X ″</span>
                    <input
                      type="number"
                      value={'center' in m ? m.center.x : m.position.x}
                      onChange={(e) =>
                        edit((d) => {
                          const t = d.missions![mi]
                          ;('center' in t ? t.center : t.position).x = Number(e.target.value) || 0
                        })
                      }
                    />
                  </label>
                  <label className="field tiny">
                    <span>Y ″</span>
                    <input
                      type="number"
                      value={'center' in m ? m.center.y : m.position.y}
                      onChange={(e) =>
                        edit((d) => {
                          const t = d.missions![mi]
                          ;('center' in t ? t.center : t.position).y = Number(e.target.value) || 0
                        })
                      }
                    />
                  </label>
                  {m.kind === 'hold' && (
                    <>
                      <label className="field tiny">
                        <span>Radius ″</span>
                        <input
                          type="number"
                          min={1}
                          value={m.radius}
                          onChange={(e) =>
                            edit((d) => {
                              const t = d.missions![mi]
                              if (t.kind === 'hold') t.radius = Math.max(1, Number(e.target.value) || 1)
                            })
                          }
                        />
                      </label>
                      <label className="field tiny" title="Banked at the end of each round the zone is held alone">
                        <span>VP/round</span>
                        <input
                          type="number"
                          min={1}
                          value={m.pointsPerRound}
                          onChange={(e) =>
                            edit((d) => {
                              const t = d.missions![mi]
                              if (t.kind === 'hold') t.pointsPerRound = Math.max(1, Number(e.target.value) || 1)
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  {m.kind === 'cargo' && (
                    <label className="field tiny" title="Paid when the carrier leaves the map with it">
                      <span>VP</span>
                      <input
                        type="number"
                        min={1}
                        value={m.points}
                        onChange={(e) =>
                          edit((d) => {
                            const t = d.missions![mi]
                            if (t.kind === 'cargo') t.points = Math.max(1, Number(e.target.value) || 1)
                          })
                        }
                      />
                    </label>
                  )}
                  {m.kind === 'rescue' && (
                    <>
                      <label className="field tiny">
                        <span>Souls</span>
                        <input
                          type="number"
                          min={1}
                          value={m.souls}
                          onChange={(e) =>
                            edit((d) => {
                              const t = d.missions![mi]
                              if (t.kind === 'rescue') t.souls = Math.max(1, Number(e.target.value) || 1)
                            })
                          }
                        />
                      </label>
                      <label className="field tiny" title="Paid per soul the moment it is beamed aboard">
                        <span>VP/soul</span>
                        <input
                          type="number"
                          min={1}
                          value={m.pointsPerSoul}
                          onChange={(e) =>
                            edit((d) => {
                              const t = d.missions![mi]
                              if (t.kind === 'rescue') t.pointsPerSoul = Math.max(1, Number(e.target.value) || 1)
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className="chip-x"
                    aria-label="Remove objective"
                    onClick={() =>
                      edit((d) => {
                        d.missions!.splice(mi, 1)
                        if (d.missions!.length === 0) delete d.missions
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="builder-row wrap">
                <select
                  value=""
                  onChange={(e) => {
                    const kind = e.target.value
                    if (!kind) return
                    edit((d) => {
                      d.missions ??= []
                      const at = { x: Math.round(d.bounds.width / 2), y: Math.round(d.bounds.height / 2) }
                      const id = `mission-${Date.now().toString(36)}`
                      if (kind === 'hold') d.missions.push({ kind: 'hold', id, name: 'The Hill', center: at, radius: 6, pointsPerRound: 2 })
                      if (kind === 'cargo') d.missions.push({ kind: 'cargo', id, name: 'The Flag', position: at, radius: 2, points: 12 })
                      if (kind === 'rescue') d.missions.push({ kind: 'rescue', id, name: 'Stricken Station', position: at, souls: 6, pointsPerSoul: 2 })
                    })
                  }}
                >
                  <option value="">+ add objective…</option>
                  <option value="hold">Hold the zone — VP per round held alone</option>
                  <option value="cargo">Cargo / flag — carry it off the map</option>
                  <option value="rescue">Rescue — beam souls out by transporter</option>
                </select>
              </div>
              <p className="hint">
                Objectives pay victory points into the same ledger as damage, so the AI weighs them,
                runs them, and defends them without being told.
              </p>
            </section>

            {draft.sides.map((side, i) => (
              <section className="builder-section" key={i}>
                <h3 style={{ color: SIDE_COLOR[i % SIDE_COLOR.length] }}>
                  {side.side || `Side ${i + 1}`} <em>S2.5</em>
                </h3>
                <div className="builder-row wrap">
                  <label className="field grow">
                    <span>Name</span>
                    <input
                      value={side.side}
                      onChange={(e) => edit((d) => void (d.sides[i].side = e.target.value))}
                    />
                  </label>
                  <label className="field tiny" title="Compass facing (S2.5.2): 8 north, 2 east, 4 south, 6 west">
                    <span>Facing</span>
                    <select
                      value={side.facing}
                      onChange={(e) => edit((d) => void (d.sides[i].facing = Number(e.target.value)))}
                    >
                      {[
                        [8, 'N'], [1, 'NE'], [2, 'E'], [3, 'SE'],
                        [4, 'S'], [5, 'SW'], [6, 'W'], [7, 'NW'],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field tiny">
                    <span>Speed</span>
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={side.speed}
                      onChange={(e) => edit((d) => void (d.sides[i].speed = Number(e.target.value) || 0))}
                    />
                  </label>
                </div>
                <label className="field grow">
                  <span>Objective</span>
                  <input
                    value={side.objective}
                    onChange={(e) => edit((d) => void (d.sides[i].objective = e.target.value))}
                  />
                </label>
                <div className="designer-force">
                  {side.force.map((id, n) => (
                    <span key={`${id}-${n}`} className="chip">
                      {roster.find((f) => f.id === id)?.name ?? id}
                      {/*
                        Condition at the opening bell: a rescue scenario fields
                        the cripple already broken, a campaign fields last
                        battle's survivors as they ended it. Stored as a
                        fraction of the structure track; scored as a baseline,
                        so wounds a ship arrives with are nobody's points.
                      */}
                      <select
                        className="chip-select"
                        title="Damage the ship starts the battle with — it concedes victory points only for damage taken beyond this."
                        value={side.damage?.[n] ?? 0}
                        onChange={(e) =>
                          edit((d) => {
                            const s = d.sides[i]
                            s.damage ??= []
                            while (s.damage.length < s.force.length) s.damage.push(0)
                            s.damage[n] = Number(e.target.value)
                            if (s.damage.every((v) => v === 0)) delete s.damage
                          })
                        }
                      >
                        <option value={0}>fresh</option>
                        <option value={0.25}>light (25%)</option>
                        <option value={0.5}>moderate (50%)</option>
                        <option value={0.75}>heavy (75%)</option>
                        <option value={0.9}>crippled (90%)</option>
                      </select>
                      {/*
                        The hull's worth on the victory ledger — the whole
                        scoreboard, and through it the AI's priorities, reads
                        this. Blank keeps the printed value.
                      */}
                      <input
                        className="chip-value"
                        type="number"
                        min={0}
                        placeholder={`${roster.find((f) => f.id === id)?.pointValue ?? ''} VP`}
                        title="What this hull is worth in victory points. Empty uses the printed value; a re-priced hull is scored by the S2.8.4 damage fractions of its new worth."
                        value={side.value?.[n] || ''}
                        onChange={(e) =>
                          edit((d) => {
                            const s = d.sides[i]
                            s.value ??= []
                            while (s.value.length < s.force.length) s.value.push(0)
                            s.value[n] = Math.max(0, Number(e.target.value) || 0)
                            if (s.value.every((v) => v === 0)) delete s.value
                          })
                        }
                      />
                      {/*
                        Only a hull with a hangar can field a wing, so the
                        picker only appears on one. Left unset, whoever
                        launches picks the card at the bay door.
                      */}
                      {(roster.find((f) => f.id === id)?.systems ?? []).some(
                        (g) => g.kind === 'HNGR',
                      ) && (
                        <select
                          className="chip-select"
                          title="The fighter card this carrier's wing flies. Fighters are the Apr 2026 outline's Babylon 5 calibration set; point values for them are still open."
                          value={side.wing?.[n] ?? ''}
                          onChange={(e) =>
                            edit((d) => {
                              const s = d.sides[i]
                              s.wing ??= []
                              while (s.wing.length < s.force.length) s.wing.push('')
                              s.wing[n] = e.target.value
                              if (s.wing.every((v) => !v)) delete s.wing
                            })
                          }
                        >
                          <option value="">wing: pick at launch</option>
                          {FIGHTER_CARDS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label="Remove ship"
                        onClick={() =>
                          edit((d) => {
                            d.sides[i].force.splice(n, 1)
                            d.sides[i].damage?.splice(n, 1)
                            d.sides[i].value?.splice(n, 1)
                            d.sides[i].wing?.splice(n, 1)
                          })
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value
                      if (id) edit((d) => void d.sides[i].force.push(id))
                    }}
                  >
                    <option value="">+ add ship…</option>
                    {roster.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.pointValue} PV)
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            ))}
          </div>

          <div className="builder-cost">
            {problems.length > 0 ? (
              <ul className="design-problems">
                {problems.map((p, i) => (
                  <li key={i} className={p.severity === 'error' ? 'error' : 'warning'}>
                    {p.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="design-ok">The scenario is ready to fight.</p>
            )}
            <div className="builder-launch">
              <p>
                Saved to your roster, so it appears in the scenario list and under “Choose forces”.
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={vsAi} onChange={(e) => setVsAi(e.target.checked)} />
                AI commands {draft.sides[1]?.side ?? 'the second side'}
              </label>
              <button type="button" className="primary" disabled={blocked} onClick={play}>
                Play it
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Publishing a scenario to the shared library.
 *
 * The same two facts the ship builder's dialog makes unmissable: publishing is
 * permanent and public (an entry cannot be edited or withdrawn — battle files
 * reference it, so an edit is a new entry), and the design is checked before
 * it goes. The scenario-specific third fact: any fan ships the force lists
 * field are packaged inside the entry, so it works on machines that have
 * never seen them.
 */
function PublishScenarioDialog({
  scenario,
  onClose,
}: {
  scenario: CustomScenario
  onClose: () => void
}) {
  const [author, setAuthor] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const check = checkScenarioPublishable(scenario, allShipForms(), author, notes)

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      await publishScenario({
        fingerprint: check.fingerprint,
        pack: check.pack,
        author,
        notes,
        sides: check.sides,
        hulls: check.hulls,
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
      <h3>Publish “{scenario.name}” to the library</h3>

      {done ? (
        <>
          <p className="hint">
            Published. Anyone pointed at this library can now find it under the Library&apos;s
            Scenarios tab and take a copy.
          </p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            This is public and permanent: an entry cannot be edited or withdrawn, because battle
            files that reference it have to keep replaying the same way. Publishing a changed
            version makes a new entry rather than altering this one.
            {check.pack.forms.length > 0 && (
              <>
                {' '}
                The {check.pack.forms.length} fan ship(s) this scenario fields travel inside the
                entry, so it works for people who do not have them.
              </>
            )}
          </p>

          {check.refusal && <p className="fire-error">{check.refusal}</p>}

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
              placeholder="What is the battle about? optional"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {error && <p className="fire-error">{error}</p>}
          <div className="builder-row">
            <button
              type="button"
              className="primary"
              disabled={!check.ok || busy}
              onClick={() => void publish()}
            >
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
