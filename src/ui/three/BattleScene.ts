/**
 * The 3D battle view's engine room: renderer, camera, controls, bloom, the
 * layers, and the pointer.
 *
 * `BattleScene` is plain TypeScript around three.js — no React inside — so
 * the React wrapper (BattleView3D.tsx) only creates one, feeds it the game
 * and props on every render, and disposes of it. The scene redraws every
 * animation frame (hulls bob, plasma pulses, beams fly) and diffs the battle
 * only when it changes.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  MOUSE,
  PMREMGenerator,
  Plane,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { GameState } from '../../engine/game'
import { BackdropLayer } from './backdrop'
import { EffectsLayer } from './effects'
import { pickableOf, tooltipOf, type Layer, type ViewProps } from './layer'
import { OrdnanceLayer } from './ordnance'
import { OverlaysLayer } from './overlays'
import { ShipsLayer } from './ships'
import { framingDistance } from './space'
import { TerrainLayer } from './terrain'

export type CameraPreset = 'tilt' | 'top' | 'low'

export interface SceneCallbacks {
  onSelect: (id: string) => void
  /** Hover text changed (null = nothing under the pointer). */
  onHover: (text: string | null, at: { x: number; y: number } | null) => void
  /** The ruler's reading, in inches, while measuring (null = no ruler up). */
  onRuler: (reading: { inches: number; at: { x: number; y: number } } | null) => void
}

const FOV = 42

export class BattleScene {
  readonly renderer: WebGLRenderer
  private labels = new CSS2DRenderer()
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 2000)
  private controls: OrbitControls
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private last = performance.now()
  private frame = 0
  private layers: Layer[]
  private ships = new ShipsLayer()
  private overlays = new OverlaysLayer()
  private terrain = new TerrainLayer()
  private ordnance = new OrdnanceLayer()
  private raycaster = new Raycaster()
  private board = new Plane(new Vector3(0, 1, 0), 0)
  private game: GameState | null = null
  private view: ViewProps | null = null
  private boardSize = { width: 0, height: 0 }
  private follow = false
  private down: { x: number; y: number } | null = null
  private measuring = false
  private resizeObserver: ResizeObserver
  private reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(
    private host: HTMLElement,
    private callbacks: SceneCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.className = 'battle3d-canvas'
    host.appendChild(this.renderer.domElement)

    this.labels.domElement.className = 'battle3d-labels'
    host.appendChild(this.labels.domElement)

    this.scene.background = new Color(0x010206)
    // A soft studio environment for reflections only — it is what makes the
    // plating read as metal rather than matte card — kept dim so space stays
    // dark and the sun does the modelling.
    const pmrem = new PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.28
    pmrem.dispose()
    this.scene.add(new HemisphereLight(0x8fa8ff, 0x0a0612, 0.55))
    this.scene.add(new AmbientLight(0x404a66, 0.35))
    // One sun for the whole map, from the upper left as the 2D worlds are lit.
    const sun = new DirectionalLight(0xfff1dc, 2.1)
    sun.position.set(-40, 60, -30)
    this.scene.add(sun)
    const rim = new DirectionalLight(0x6f8cff, 0.6)
    rim.position.set(30, 20, 40)
    this.scene.add(rim)

    this.layers = [
      new BackdropLayer(),
      this.terrain,
      this.overlays,
      this.ships,
      this.ordnance,
      new EffectsLayer(),
    ]
    for (const layer of this.layers) this.scene.add(layer.group)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.screenSpacePanning = false
    this.controls.maxPolarAngle = 84 * (Math.PI / 180)
    this.controls.minDistance = 3
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.85, 0.5, 0.62)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointerleave', this.onPointerLeave)
    el.addEventListener('dblclick', this.onDoubleClick)
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    // Lines and points pick within a tenth of an inch, not the default inch.
    this.raycaster.params.Line = { threshold: 0.1 }
    this.raycaster.params.Points = { threshold: 0.1 }

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    this.loop()
  }

  /** Feed the scene the battle and the view's props; layers diff from here. */
  update(game: GameState, view: ViewProps): void {
    const first = this.game === null
    const resized =
      game.scenario.bounds.width !== this.boardSize.width || game.scenario.bounds.height !== this.boardSize.height
    this.game = game
    this.view = view
    this.boardSize = { width: game.scenario.bounds.width, height: game.scenario.bounds.height }
    const ctx = { game, view, now: performance.now() }
    for (const layer of this.layers) layer.update(ctx)
    this.overlays.setShipPositions((id) => this.ships.drawnPosition(id))
    if (first || resized) this.setPreset('tilt', true)
    if (!view.rulerMode && this.measuring) {
      this.measuring = false
      this.overlays.setRuler(null)
      this.callbacks.onRuler(null)
    }
    this.controls.enabled = !view.rulerMode
  }

  /** Point the camera at the board from one of the stock angles. */
  setPreset(preset: CameraPreset, instant = false): void {
    const aspect = this.camera.aspect || 1.5
    // Top shows the whole board, like the flat map. The angled views frame
    // the action instead — the hulls plus room to manoeuvre — because a
    // perspective camera pulled back far enough for a whole 48" table makes
    // every ship a speck.
    const { width, height } = this.boardSize
    let frame = { x: width / 2, z: height / 2, w: width, h: height }
    const extent = preset === 'top' ? null : this.ships.extent()
    if (extent) {
      const pad = 7
      const w = Math.min(width, Math.max(18, extent.maxX - extent.minX + pad * 2))
      const h = Math.min(height, Math.max(12, extent.maxZ - extent.minZ + pad * 2))
      frame = { x: (extent.minX + extent.maxX) / 2, z: (extent.minZ + extent.maxZ) / 2, w, h }
    }
    const center = new Vector3(frame.x, 0, frame.z)
    const elevation = preset === 'top' ? 89.5 : preset === 'low' ? 16 : 48
    const distance =
      framingDistance(frame.w, frame.h, FOV, aspect) * (preset === 'top' ? 1 : preset === 'low' ? 0.75 : 1)
    const e = elevation * (Math.PI / 180)
    const position = new Vector3(center.x, Math.sin(e) * distance, center.z + Math.cos(e) * distance)
    this.follow = false
    this.controls.maxDistance = Math.max(distance, framingDistance(width, height, FOV, aspect)) * 2
    if (instant || this.reducedMotion) {
      this.camera.position.copy(position)
      this.controls.target.copy(center)
      this.controls.update()
      return
    }
    this.flyTo(position, center)
  }

  /** Keep the selected ship in the middle of the view as it moves. */
  setFollow(on: boolean): void {
    this.follow = on
  }

  private flight: { from: Vector3; to: Vector3; fromT: Vector3; toT: Vector3; start: number } | null = null
  private flyTo(position: Vector3, target: Vector3): void {
    this.flight = {
      from: this.camera.position.clone(),
      to: position,
      fromT: this.controls.target.clone(),
      toT: target,
      start: performance.now(),
    }
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.labels.setSize(w, h)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w / 2, h / 2)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now

    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / 900)
      const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, k)
      this.controls.target.lerpVectors(this.flight.fromT, this.flight.toT, k)
      if (t >= 1) this.flight = null
    } else if (this.follow && this.view?.selectedId) {
      const at = this.ships.drawnPosition(this.view.selectedId)
      if (at) {
        const goal = new Vector3(at.x, 0, at.z)
        const shift = goal.sub(this.controls.target).multiplyScalar(1 - Math.exp(-dt * 4))
        this.controls.target.add(shift)
        this.camera.position.add(shift)
      }
    }
    this.controls.update()

    const frame = { now, dt, camera: this.camera, reducedMotion: this.reducedMotion }
    for (const layer of this.layers) layer.tick?.(frame)
    this.composer.render()
    this.labels.render(this.scene, this.camera)
  }

  // ── Pointer ────────────────────────────────────────────────────────────

  private ndc(e: PointerEvent | MouseEvent): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
  }

  /** The board point under the pointer, in inches. */
  private boardPoint(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.board, new Vector3())
    return hit ? { x: hit.x, y: hit.z } : null
  }

  private pick(e: PointerEvent | MouseEvent) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hits = this.raycaster.intersectObjects(this.ships.pickables(), true)
    return hits.length > 0 ? hits[0].object : null
  }

  /** The nearest terrain feature or small craft under the pointer that carries hover text. */
  private hoverTarget(e: PointerEvent) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hits = this.raycaster.intersectObjects([this.ordnance.group, this.terrain.group], true)
    return hits.find((h) => tooltipOf(h.object) !== null)?.object ?? null
  }

  private rulerFrom: { x: number; y: number } | null = null

  private onPointerDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY }
    if (this.view?.rulerMode && e.button === 0) {
      const at = this.boardPoint(e)
      if (!at) return
      this.measuring = true
      this.rulerFrom = at
      this.overlays.setRuler({ from: at, to: at })
      this.renderer.domElement.setPointerCapture(e.pointerId)
    }
    // A camera move is not a follow: grabbing the view hands it back.
    if (!this.view?.rulerMode) this.follow = this.follow && e.button !== 2
    this.flight = null
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.measuring && this.rulerFrom) {
      const at = this.boardPoint(e)
      if (!at) return
      this.overlays.setRuler({ from: this.rulerFrom, to: at })
      const inches = Math.hypot(at.x - this.rulerFrom.x, at.y - this.rulerFrom.y)
      this.callbacks.onRuler({ inches, at: { x: e.clientX, y: e.clientY } })
      return
    }
    if (e.buttons !== 0) return
    const hit = this.pick(e)
    const pick = pickableOf(hit)
    // Hover text reaches past the hulls to the terrain and small craft, the
    // way every 2D counter carries a <title>; only hulls are clickable.
    const hover = hit ?? this.hoverTarget(e)
    this.ships.setHovered(pick?.id ?? null)
    this.renderer.domElement.style.cursor = pick ? 'pointer' : this.view?.rulerMode ? 'crosshair' : 'grab'
    const rect = this.host.getBoundingClientRect()
    const text = tooltipOf(hover)
    this.callbacks.onHover(text, text ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
  }

  private onPointerUp = (e: PointerEvent): void => {
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4 : true
    this.down = null
    if (this.measuring) {
      // Released, the ruler stays up until the next press, as in 2D.
      this.measuring = false
      return
    }
    if (moved || e.button !== 0 || this.view?.rulerMode) return
    const pick = pickableOf(this.pick(e))
    if (pick?.kind === 'ship') this.callbacks.onSelect(pick.id)
  }

  private onPointerLeave = (): void => {
    this.ships.setHovered(null)
    this.callbacks.onHover(null, null)
  }

  private onDoubleClick = (e: MouseEvent): void => {
    // Double-click a hull to swing the camera onto it; empty space resets.
    const pick = pickableOf(this.pick(e))
    if (!pick || !this.focusShip(pick.id)) this.setPreset('tilt')
  }

  /**
   * Swing the camera onto a ship, keeping the current viewing angle, from
   * `distance` inches away. Returns false when the ship is not drawn.
   */
  focusShip(id: string, distance = 9, instant = false): boolean {
    const at = this.ships.drawnPosition(id)
    if (!at) return false
    const target = new Vector3(at.x, 0, at.z)
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(distance)
    if (instant) {
      this.camera.position.copy(target.clone().add(offset))
      this.controls.target.copy(target)
      this.controls.update()
    } else {
      this.flyTo(target.clone().add(offset), target)
    }
    return true
  }

  /** Orbit to a given elevation (degrees) and bearing about the current target. */
  orbitTo(elevation: number, bearing: number, distance?: number): void {
    const d = distance ?? this.camera.position.distanceTo(this.controls.target)
    const e = elevation * (Math.PI / 180)
    const b = bearing * (Math.PI / 180)
    const t = this.controls.target
    this.camera.position.set(t.x + Math.sin(b) * Math.cos(e) * d, Math.sin(e) * d, t.z + Math.cos(b) * Math.cos(e) * d)
    this.controls.update()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    for (const layer of this.layers) layer.dispose()
    this.composer.dispose()
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }
}
