/**
 * Drive wakes: a glowing ribbon left behind a hull while it flies its
 * Navigation leg, fading from the stern back along the path it took.
 *
 * It is the one thing a still frame cannot show and a moving one should —
 * where a ship has just come from — so it draws only while a ship moves and
 * for a moment after, then burns out. One ribbon per ship, a fixed ring of
 * points updated in place: nothing is allocated while it plays.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
} from 'three'

/** How many samples a wake remembers, and how often it takes one (ms). */
const POINTS = 48
const SAMPLE_MS = 40

const vertexShader = /* glsl */ `
  attribute float fade;
  attribute float side;
  varying float vFade;
  varying float vSide;
  void main() {
    vFade = fade;
    vSide = side;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 tint;
  uniform float strength;
  varying float vFade;
  varying float vSide;
  void main() {
    // Brightest along the centre line, soft at the ribbon's edges.
    float edge = 1.0 - abs(vSide);
    float a = vFade * vFade * strength * (0.35 + 0.65 * edge);
    gl_FragColor = vec4(tint * a * 1.4, a);
  }
`

export class Wake {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>
  private positions = new Float32Array(POINTS * 2 * 3)
  private fades = new Float32Array(POINTS * 2)
  private trail: Array<{ x: number; z: number; t: number }> = []
  private lastSample = 0
  private strength = 0

  constructor(
    color: number,
    private halfWidth: number,
  ) {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.positions, 3))
    geo.setAttribute('fade', new BufferAttribute(this.fades, 1))
    const side = new Float32Array(POINTS * 2)
    for (let i = 0; i < POINTS * 2; i++) side[i] = i % 2 === 0 ? -1 : 1
    geo.setAttribute('side', new BufferAttribute(side, 1))
    const index: number[] = []
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(index)
    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        uniforms: { tint: { value: new Color(color) }, strength: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    )
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /**
   * Feed the wake the hull's stern position this frame (world XZ, at `y`).
   * `moving` is whether the hull is flying a leg; the wake builds while it
   * is and fades out over a second after.
   */
  update(stern: { x: number; z: number }, y: number, moving: boolean, now: number, dt: number): void {
    this.strength = moving ? Math.min(1, this.strength + dt * 4) : Math.max(0, this.strength - dt * 0.9)
    if (this.strength <= 0) {
      this.mesh.visible = false
      this.trail.length = 0
      return
    }
    if (moving && now - this.lastSample >= SAMPLE_MS) {
      this.lastSample = now
      this.trail.unshift({ x: stern.x, z: stern.z, t: now })
      if (this.trail.length > POINTS) this.trail.length = POINTS
    }
    if (this.trail.length < 2) {
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true
    this.mesh.material.uniforms.strength.value = this.strength

    const n = this.trail.length
    for (let i = 0; i < POINTS; i++) {
      const p = this.trail[Math.min(i, n - 1)]
      const q = this.trail[Math.min(i + 1, n - 1)]
      const r = this.trail[Math.min(Math.max(i - 1, 0), n - 1)]
      // The ribbon's sideways direction, from its neighbours along the path.
      let dx = r.x - q.x
      let dz = r.z - q.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      const along = Math.min(1, i / (n - 1))
      const w = this.halfWidth * (1 - along * 0.6)
      const k = i * 6
      this.positions[k] = p.x - dz * w
      this.positions[k + 1] = y
      this.positions[k + 2] = p.z + dx * w
      this.positions[k + 3] = p.x + dz * w
      this.positions[k + 4] = y
      this.positions[k + 5] = p.z - dx * w
      const fade = i < n ? Math.max(0, 1 - along) : 0
      this.fades[i * 2] = fade
      this.fades[i * 2 + 1] = fade
    }
    this.mesh.geometry.attributes.position.needsUpdate = true
    this.mesh.geometry.attributes.fade.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
