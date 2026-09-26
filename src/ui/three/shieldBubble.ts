/**
 * The shield bubble: an energy envelope drawn around the selected (or
 * hovered) hull, split into its four facings (G1.1.1) and tinted by what
 * each one still holds — the shield ring's own bands, shown as the thing
 * they describe. A lowered or collapsed facing leaves a gap in the bubble.
 *
 * One ShaderMaterial per ship: a hex lattice over a fresnel rim, the facing
 * picked per fragment from its bearing off the bow.
 */
import { AdditiveBlending, Color, Mesh, ShaderMaterial, SphereGeometry, Vector4 } from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 colorF;
  uniform vec3 colorS;
  uniform vec3 colorA;
  uniform vec3 colorP;
  uniform vec4 strength; // F, S, A, P
  uniform float opacity;
  uniform float time;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;

  float hexEdge(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }

  void main() {
    // Bearing off the bow, clockwise: the bow is -Z in hull space.
    float b = degrees(atan(vLocal.x, -vLocal.z));
    vec3 c;
    float s;
    if (abs(b) <= 45.0) { c = colorF; s = strength.x; }
    else if (b > 45.0 && b < 135.0) { c = colorS; s = strength.y; }
    else if (b < -45.0 && b > -135.0) { c = colorP; s = strength.w; }
    else { c = colorA; s = strength.z; }
    if (s <= 0.0) discard;

    float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.2);

    // A hex lattice wrapped round the bubble, drifting slowly upward.
    vec2 uv = vec2(atan(vLocal.x, vLocal.z) * 3.0, vLocal.y * 9.0 + time * 0.15);
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 g = mod(uv - h, r) - h;
    vec2 cell = dot(a, a) < dot(g, g) ? a : g;
    // The lattice pinches toward the poles, so it fades out before them.
    float line = smoothstep(0.42, 0.5, hexEdge(cell)) * (1.0 - smoothstep(0.55, 0.9, abs(vLocal.y)));

    // A seam of light where two facings meet, so the four read as four.
    float seam = 1.0 - smoothstep(0.0, 4.0, min(abs(abs(b) - 45.0), abs(abs(b) - 135.0)));

    float alpha = (rim * 0.7 + line * 0.14 * (0.35 + rim) + seam * 0.2) * mix(0.35, 1.0, s) * opacity;
    gl_FragColor = vec4(c * alpha, alpha);
  }
`

export class ShieldBubble {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>
  private shown = 0

  constructor(halfBeam: number, halfLength: number, height: number) {
    const material = new ShaderMaterial({
      uniforms: {
        colorF: { value: new Color() },
        colorS: { value: new Color() },
        colorA: { value: new Color() },
        colorP: { value: new Color() },
        strength: { value: new Vector4(1, 1, 1, 1) },
        opacity: { value: 0 },
        time: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), material)
    this.mesh.scale.set(Math.max(0.5, halfBeam * 1.6 + 0.15), height, Math.max(0.62, halfLength * 1.35 + 0.15))
    this.mesh.visible = false
    this.mesh.renderOrder = 3
  }

  /** Each facing's colour and strength (0 = down or gone, 1 = full). */
  setFacings(facings: Record<'F' | 'S' | 'A' | 'P', { color: number; fraction: number }>): void {
    const u = this.mesh.material.uniforms
    u.colorF.value.setHex(facings.F.color)
    u.colorS.value.setHex(facings.S.color)
    u.colorA.value.setHex(facings.A.color)
    u.colorP.value.setHex(facings.P.color)
    u.strength.value.set(facings.F.fraction, facings.S.fraction, facings.A.fraction, facings.P.fraction)
  }

  /** Fade the bubble toward shown or hidden. */
  tick(want: number, now: number, dt: number): void {
    this.shown += (want - this.shown) * (1 - Math.exp(-dt * 6))
    this.mesh.visible = this.shown > 0.01
    this.mesh.material.uniforms.opacity.value = this.shown
    this.mesh.material.uniforms.time.value = now / 1000
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
