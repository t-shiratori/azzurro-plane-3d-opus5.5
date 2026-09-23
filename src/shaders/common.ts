import * as THREE from 'three';
import { PALETTE, SUN_DIR, color } from '../config';

export const MAX_CLOUD_SHADOWS = 48;

/**
 * Uniforms shared by every custom material. Objects are shared by reference,
 * so updating `.value` once updates every shader in the scene.
 */
export const globalUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: color(PALETTE.sun) },
  uSkyZenith: { value: color(PALETTE.skyZenith) },
  uSkyMid: { value: color(PALETTE.skyMid) },
  uSkyHorizon: { value: color(PALETTE.skyHorizon) },
  uShadowTint: { value: color(PALETTE.shadowTint) },
  uFogDensity: { value: 1 / 8500 },
  uCloudShadows: {
    value: Array.from({ length: MAX_CLOUD_SHADOWS }, () => new THREE.Vector4(0, 0, 1, 0)),
  },
};

export type GlobalUniforms = typeof globalUniforms;

/** Ashima Arts / Stefan Gustavson simplex noise (MIT). */
export const noiseGLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; }
  return s;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Sky gradient, fog and cloud shadow helpers shared by every world shader. */
export const atmosphereGLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uShadowTint;
uniform float uFogDensity;
uniform vec4 uCloudShadows[${MAX_CLOUD_SHADOWS}];

vec3 skyBase(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 c = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.22, y));
  c = mix(c, uSkyZenith, smoothstep(0.18, 0.95, y));
  float s = max(dot(dir, uSunDir), 0.0);
  // warm forward scattering around the sun
  c += uSunColor * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.45);
  // slightly lavender, hazy band hugging the horizon
  c = mix(c, uSkyHorizon * vec3(1.02, 1.0, 1.04), exp(-y * 28.0) * 0.35);
  return c;
}

vec3 fogColor(vec3 dir) {
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35, dir.z));
  return skyBase(d);
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  // thinner haze higher up
  float heightFade = mix(1.0, 0.45, smoothstep(0.0, 1400.0, 0.5 * (wp.y + cameraPosition.y)));
  float f = 1.0 - exp(-dist * uFogDensity * heightFade);
  return mix(col, fogColor(dir), clamp(f, 0.0, 1.0));
}

/** 0 = full sun, 1 = full cloud shadow. Clouds are projected onto the ground along the sun. */
float cloudShadow(vec3 wp) {
  vec2 g = wp.xz - uSunDir.xz * (wp.y / max(uSunDir.y, 0.05));
  float s = 0.0;
  float n = snoise(g * 0.004 + uTime * 0.01) * 0.22;
  for (int i = 0; i < ${MAX_CLOUD_SHADOWS}; i++) {
    vec4 c = uCloudShadows[i];
    float d = length(g - c.xy) / c.z + n;
    s = max(s, (1.0 - smoothstep(0.45, 1.0, d)) * c.w);
  }
  return s;
}
`;
