import * as THREE from 'three';

/** Gerstner wave: direction (xz), wavelength, amplitude, steepness. */
interface Wave {
  dir: THREE.Vector2;
  length: number;
  amp: number;
  steep: number;
}

const mk = (deg: number, length: number, amp: number, steep: number): Wave => {
  const a = THREE.MathUtils.degToRad(deg);
  return { dir: new THREE.Vector2(Math.cos(a), Math.sin(a)), length, amp, steep };
};

/** Calm Adriatic swell: gentle, long, with a few chop components. */
export const WAVES: Wave[] = [
  mk(20, 62, 0.55, 0.35),
  mk(-15, 37, 0.32, 0.4),
  mk(55, 23, 0.2, 0.45),
  mk(-60, 14, 0.11, 0.5),
  mk(95, 9, 0.06, 0.5),
];

export const waveUniforms = {
  uWaves: {
    value: WAVES.map((w) => new THREE.Vector4(w.dir.x, w.dir.y, w.length, w.amp)),
  },
  uWaveSteep: { value: WAVES.map((w) => w.steep) },
};

export const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaves[${WAVES.length}];
uniform float uWaveSteep[${WAVES.length}];

// returns displaced position; accumulates the analytic normal
vec3 gerstner(vec2 xz, float t, float fade, float spacing, out vec3 nrm) {
  vec3 p = vec3(xz.x, 0.0, xz.y);
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${WAVES.length}; i++) {
    vec4 w = uWaves[i];
    float k = 6.28318 / w.z;
    float c = sqrt(9.8 / k);
    // band-limit: a wave needs several grid vertices per wavelength or it turns jagged
    float a = w.w * fade * (1.0 - smoothstep(w.z * 0.12, w.z * 0.25, spacing));
    float q = uWaveSteep[i];
    float f = k * (dot(w.xy, xz) - c * t);
    float cf = cos(f), sf = sin(f);
    p.x += q * a * w.x * cf;
    p.z += q * a * w.y * cf;
    p.y += a * sf;
    n.x -= w.x * k * a * cf;
    n.z -= w.y * k * a * cf;
    n.y -= q * k * a * sf;
  }
  nrm = normalize(n);
  return p;
}
`;

/** Per-pixel swell normal, band-limited by the pixel footprint (fragment shader). */
export const SWELL_NORMAL_GLSL = /* glsl */ `
uniform vec4 uWaves[${WAVES.length}];
uniform float uWaveSteep[${WAVES.length}];

vec3 swellNormal(vec2 xz, float t, float footprint, float fade) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${WAVES.length}; i++) {
    vec4 w = uWaves[i];
    float k = 6.28318 / w.z;
    float c = sqrt(9.8 / k);
    float a = w.w * fade * (1.0 - smoothstep(w.z * 0.06, w.z * 0.2, footprint));
    float f = k * (dot(w.xy, xz) - c * t);
    n.x -= w.x * k * a * cos(f);
    n.z -= w.y * k * a * cos(f);
    n.y -= uWaveSteep[i] * k * a * sin(f);
  }
  return normalize(n);
}
`;

/** Approximate water height at (x, z) (ignores horizontal displacement). */
export function waveHeight(x: number, z: number, t: number): number {
  let y = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.length;
    const c = Math.sqrt(9.8 / k);
    y += w.amp * Math.sin(k * (w.dir.x * x + w.dir.y * z - c * t));
  }
  return y;
}
