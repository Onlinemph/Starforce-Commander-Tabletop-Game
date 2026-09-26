/**
 * The final look of the 3D view: one full-screen pass after bloom that
 * grades the picture like a film frame.
 *
 * - A gentle S-curve on contrast, so space stays black while lit plating
 *   and weapon fire keep their punch.
 * - Split toning: shadows pushed a touch toward blue, highlights toward
 *   warm, the classic space-opera palette.
 * - A soft vignette that seats the board in its frame.
 * - A whisper of animated film grain, which stops large dark gradients
 *   (nebulae, the board) from banding on 8-bit screens.
 *
 * It runs before OutputPass in linear space, so every number here is a
 * taste decision rather than a rules one.
 */
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.32 },
    grain: { value: 0.009 },
    contrast: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    uniform float contrast;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Contrast about a low pivot: blacks stay black, mids and highs lift.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, 1.06);
      c = pow(max(c, 0.0), vec3(contrast));

      // Split toning by brightness.
      float t = smoothstep(0.0, 0.6, luma);
      c *= mix(vec3(0.92, 0.97, 1.08), vec3(1.05, 1.0, 0.94), t);

      // Vignette.
      vec2 d = vUv - 0.5;
      float v = 1.0 - vignette * smoothstep(0.25, 0.85, length(d * vec2(1.1, 1.0)));
      c *= v;

      // Grain, strongest in the shadows where banding shows.
      float n = hash(vUv * 1024.0 + fract(time * 0.37) * 97.0) - 0.5;
      c += n * grain * (1.0 - t * 0.7);

      gl_FragColor = vec4(c, texel.a);
    }
  `,
}

export function gradePass(): ShaderPass {
  return new ShaderPass(GradeShader)
}
