import * as THREE from 'three';
import { atmosphereGLSL, globalUniforms, noiseGLSL } from './common';

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  side?: THREE.Side;
  /** Strength of the cool back-light rim. */
  rim?: number;
  /** Adds glossy highlight (painted metal / varnish). */
  gloss?: number;
  /** Receive cloud shadows (skip for tiny objects to save fillrate). */
  cloudShadows?: boolean;
  /** Optional wing flapping for birds (uses `aPhase` instance attribute). */
  flap?: boolean;
}

const vertex = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
uniform vec3 uColor;
#ifdef FLAP
attribute float aPhase;
#endif

void main() {
  vec3 pos = position;
  vec3 nrm = normal;
#ifdef FLAP
  // wings: |x| > 0.12 bend upward around the body axis, gulls mostly glide with lazy flaps
  float side = sign(pos.x);
  float burst = smoothstep(-0.2, 0.4, sin(uTime * 0.45 + aPhase * 3.1));
  float ang = (sin(uTime * 7.5 + aPhase * 6.28) * 0.75 * burst + 0.12) * side;
  float ca = cos(ang), sa = sin(ang);
  if (abs(pos.x) > 0.1) {
    vec2 rel = vec2(pos.x - side * 0.1, pos.y);
    pos.x = side * 0.1 + rel.x * ca - rel.y * sa;
    pos.y = rel.x * sa + rel.y * ca;
    nrm.xy = vec2(nrm.x * ca - nrm.y * sa, nrm.x * sa + nrm.y * ca);
  }
#endif
  vec4 lp = vec4(pos, 1.0);
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  nrm = mat3(instanceMatrix) * nrm;
#endif
  vec4 wp = modelMatrix * lp;
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * nrm);
  vCol = uColor;
#ifdef USE_COLOR
  vCol *= color.rgb;
#endif
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${noiseGLSL}
${atmosphereGLSL}
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
uniform float uRim;
uniform float uGloss;

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWP);
  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float lit = smoothstep(-0.02, 0.12, ndl);
#ifdef CLOUD_SHADOWS
  lit *= 1.0 - 0.7 * cloudShadow(vWP);
#endif
  vec3 skyAmb = mix(vec3(0.42, 0.48, 0.62), uSkyMid * 0.9, 0.5);
  vec3 amb = mix(vec3(0.36, 0.42, 0.52), skyAmb, N.y * 0.5 + 0.5);
  vec3 shade = uShadowTint * 0.62 + amb * 0.35;
  vec3 light = uSunColor * 1.05 + amb * 0.15;
  vec3 col = vCol * mix(shade, light, lit);
  // soft bounce from the bright sea below
  col += vCol * vec3(0.05, 0.12, 0.14) * clamp(-N.y, 0.0, 1.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uRim * fres * mix(uSkyMid, uSunColor, 0.4) * (0.4 + 0.6 * lit);
  vec3 H = normalize(L + V);
  col += uGloss * lit * uSunColor * smoothstep(0.93, 0.97, dot(N, H));
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createToonMaterial(opts: ToonOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (opts.cloudShadows ?? true) defines.CLOUD_SHADOWS = '';
  if (opts.flap) defines.FLAP = '';
  return new THREE.ShaderMaterial({
    uniforms: {
      ...globalUniforms,
      uColor: { value: new THREE.Color(opts.color ?? '#ffffff') },
      uRim: { value: opts.rim ?? 0.35 },
      uGloss: { value: opts.gloss ?? 0 },
    },
    defines,
    vertexShader: vertex,
    fragmentShader: fragment,
    vertexColors: opts.vertexColors ?? false,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** Inverted-hull outline for the anime ink line. */
export function createOutlineMaterial(color: THREE.ColorRepresentation, thickness: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uThickness: { value: thickness },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        float d = length(cameraPosition - wp.xyz);
        wp.xyz += n * uThickness * clamp(d * 0.02, 1.0, 6.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
    side: THREE.BackSide,
  });
}
