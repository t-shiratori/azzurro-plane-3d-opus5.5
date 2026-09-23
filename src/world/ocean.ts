import * as THREE from 'three';
import { PALETTE, WORLD_HALF, color } from '../config';
import { atmosphereGLSL, globalUniforms, noiseGLSL } from '../shaders/common';
import { SWELL_NORMAL_GLSL, WAVES_GLSL, waveUniforms } from './waves';

export const MAX_BOATS = 8;

export interface OceanHandle {
  mesh: THREE.Mesh;
  uniforms: {
    uBoats: { value: THREE.Vector4[] };
    uBoatInfo: { value: THREE.Vector4[] };
    uPlaneShadow: { value: THREE.Vector4 };
  };
  update(camera: THREE.Camera): void;
}

/** Radial grid: dense around the camera, sparse towards the horizon. */
function radialGrid(): THREE.BufferGeometry {
  const segs = 320;
  const q = 1.042;
  const a = 1.6 / (q - 1);
  const rings: number[] = [0];
  for (let i = 1; ; i++) {
    const r = a * (Math.pow(q, i) - 1);
    rings.push(r);
    if (r > 22000) break;
  }
  const pos: number[] = [0, 0, 0];
  for (let i = 1; i < rings.length; i++) {
    for (let s = 0; s < segs; s++) {
      const t = (s / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      pos.push(Math.cos(t) * rings[i], 0, Math.sin(t) * rings[i]);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 1; i < rings.length - 1; i++) {
    const r0 = 1 + (i - 1) * segs;
    const r1 = 1 + i * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(r0 + s, r0 + s1, r1 + s);
      idx.push(r0 + s1, r1 + s1, r1 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

export function createOcean(depthTex: THREE.Texture): OceanHandle {
  const uniforms = {
    ...globalUniforms,
    ...waveUniforms,
    uDepth: { value: depthTex },
    uWorldHalf: { value: WORLD_HALF },
    uCenter: { value: new THREE.Vector2() },
    uSeaDeep: { value: color(PALETTE.seaDeep) },
    uSeaMid: { value: color(PALETTE.seaMid) },
    uSeaTurq: { value: color(PALETTE.seaTurquoise) },
    uSeaShallow: { value: color(PALETTE.seaShallow) },
    uBoats: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
    uBoatInfo: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
    uPlaneShadow: { value: new THREE.Vector4(0, 0, 8, 0) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${WAVES_GLSL}
      uniform float uTime;
      uniform vec2 uCenter;
      varying vec3 vWP;
      varying float vCrest;
      void main() {
        vec2 xz = position.xz + uCenter;
        float dist = length(position.xz);
        float fade = 1.0 - smoothstep(600.0, 4000.0, dist);
        vec3 n;
        float spacing = 1.6 + dist * 0.045;
        vec3 p = gerstner(xz, uTime, fade, spacing, n);
        vWP = p;
        vCrest = p.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${noiseGLSL}
      ${atmosphereGLSL}
      ${SWELL_NORMAL_GLSL}
      uniform sampler2D uDepth;
      uniform float uWorldHalf;
      uniform vec3 uSeaDeep;
      uniform vec3 uSeaMid;
      uniform vec3 uSeaTurq;
      uniform vec3 uSeaShallow;
      uniform vec4 uBoats[${MAX_BOATS}];
      uniform vec4 uBoatInfo[${MAX_BOATS}];
      uniform vec4 uPlaneShadow;
      varying vec3 vWP;
      varying float vCrest;

      const float PI2 = 6.2831853;

      float waterDepth(vec2 xz) {
        vec2 uv = xz / (uWorldHalf * 2.0) + 0.5;
        float r = texture2D(uDepth, uv).r;
        float d = r * r * 50.0;
        vec2 e = abs(uv * 2.0 - 1.0);
        return mix(d, 50.0, smoothstep(0.93, 1.0, max(e.x, e.y)));
      }

      vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }

      // Animated Voronoi: returns (F1, F2 - F1). Used for lacy foam and caustic networks.
      vec2 voronoi(vec2 p, float t) {
        vec2 n = floor(p);
        vec2 f = fract(p);
        float f1 = 8.0, f2 = 8.0;
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = hash22(n + g);
          o = 0.5 + 0.5 * sin(t + PI2 * o);
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
        f1 = sqrt(f1); f2 = sqrt(f2);
        return vec2(f1, f2 - f1);
      }

      // Band-limited ripple field: a spectrum of small directional waves with analytic
      // gradients. Each wave fades out once it gets smaller than the pixel footprint,
      // so the sea stays clean instead of turning into noisy speckle in the distance.
      vec3 rippleNormal(vec2 xz, float t, float footprint, float strength, out float crest) {
        vec2 grad = vec2(0.0);
        float h = 0.0;
        float norm = 0.0;
        float L = 52.0;
        for (int i = 0; i < 20; i++) {
          float fi = float(i);
          float ang = 0.35 + (fract(sin(fi * 12.9898) * 43758.5453) - 0.5) * 2.4;
          vec2 dir = vec2(cos(ang), sin(ang));
          float k = PI2 / L;
          float w = sqrt(9.8 * k);
          float A = L * 0.0075;
          float fade = 1.0 - smoothstep(L * 0.06, L * 0.2, footprint);
          float ph = k * dot(dir, xz) - w * t + fi * 1.7;
          // slightly peaked crests, like painted wavelets
          float s = sin(ph);
          float c = cos(ph);
          float pk = exp(s - 1.0);
          h += A * fade * pk;
          grad += A * fade * pk * c * k * dir;
          norm += A;
          L *= 0.82;
        }
        crest = h / norm;
        return normalize(vec3(-grad.x * strength, 1.0, -grad.y * strength));
      }

      float wakes(vec2 xz) {
        float w = 0.0;
        for (int i = 0; i < ${MAX_BOATS}; i++) {
          vec4 b = uBoats[i];
          vec4 info = uBoatInfo[i];
          if (info.z < 0.5) continue;
          vec2 rel = xz - b.xy;
          vec2 fwd = b.zw;
          float along = -dot(rel, fwd) - info.y * 0.35;
          float side = dot(rel, vec2(-fwd.y, fwd.x));
          if (along < -info.y * 0.8 || along > 260.0) continue;
          float a = max(along, 0.0);
          float spread = a * 0.34 + info.y * 0.18;
          float width = 1.0 + a * 0.04;
          float arms = exp(-pow((abs(side) - spread) / width, 2.0));
          arms *= 0.8 + 0.2 * sin(a * 0.6 - uTime * 1.5);
          float center = exp(-pow(side / (info.y * 0.22 + a * 0.05), 2.0));
          float bow = exp(-pow(along / (info.y * 0.3), 2.0)) * exp(-pow(side / (info.y * 0.25), 2.0));
          float fadeTail = exp(-a / (60.0 + 90.0 * info.x));
          w += (arms * 0.75 + center * 0.9) * fadeTail * clamp(info.x, 0.0, 1.0) + bow * 0.6;
        }
        return clamp(w, 0.0, 1.0);
      }

      void main() {
        vec3 p = vWP;
        vec3 toCam = cameraPosition - p;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        // world-space size of one pixel (grows with distance and at grazing angles)
        float footprint = max(length(fwidth(p.xz)), 1e-3);
        float near = 1.0 - smoothstep(60.0, 900.0, dist);

        // --- normal: swell (vertex) + band-limited ripples
        float crest;
        float topDown = smoothstep(0.35, 0.9, V.y);
        vec3 rn = rippleNormal(p.xz, uTime, footprint, mix(1.0, 0.4, topDown), crest);
        // swell shading evaluated per pixel so it survives where the mesh is too coarse to displace
        float swellFade = 1.0 - 0.75 * smoothstep(2500.0, 12000.0, dist);
        vec3 sN = swellNormal(p.xz, uTime, footprint, swellFade);
        vec3 N = normalize(mix(sN, vec3(0.0, 1.0, 0.0), topDown * 0.45) + vec3(rn.x, 0.0, rn.z));
        // far away the sea calms into a smooth mirror band towards the horizon
        vec3 Nfar = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 9000.0, dist) * 0.8));
        N = Nfar;

        // --- body colour from depth, with a painterly large-scale colour drift
        float d = waterDepth(p.xz);
        float drift = snoise(p.xz * 0.0016 + 3.0) * 0.5 + snoise(p.xz * 0.0045) * 0.25;
        vec3 water = mix(uSeaShallow, uSeaTurq, smoothstep(0.2, 5.5, d));
        water = mix(water, uSeaMid, smoothstep(4.0, 20.0, d + drift * 4.0));
        water = mix(water, uSeaDeep, smoothstep(18.0, 46.0, d + drift * 10.0));

        // looking straight down reads deeper and more saturated; grazing reads lighter
        float ndvRaw = max(dot(vec3(0.0, 1.0, 0.0), V), 0.0);
        water = mix(water * vec3(1.08, 1.12, 1.18), water * vec3(0.78, 0.84, 0.95), smoothstep(0.1, 0.8, ndvRaw) * smoothstep(8.0, 30.0, d));

        // wave faces turned towards the sun catch a little more light (soft, cel-like)
        float facet = dot(N, normalize(vec3(uSunDir.x, 1.6, uSunDir.z)));
        water *= 0.9 + 0.22 * smoothstep(0.985, 1.0, facet);
        // translucent turquoise glow through the swell crests
        float sss = pow(max(dot(-V, uSunDir), 0.0) * 0.5 + 0.5, 3.0) * clamp(vCrest * 0.8 + 0.2, 0.0, 1.0);
        water += uSeaTurq * sss * 0.22 * smoothstep(3.0, 15.0, d);

        // sunlit caustic net on the sandy shallows
        float shallow = 1.0 - smoothstep(0.5, 8.0, d);
        if (shallow > 0.0 && near > 0.0) {
          vec2 cp = p.xz * 0.18 + 0.4 * vec2(snoise(p.xz * 0.03 + uTime * 0.1), snoise(p.xz * 0.03 - uTime * 0.1 + 7.0));
          float c1 = pow(1.0 - smoothstep(0.0, 0.35, voronoi(cp, uTime * 0.9).y), 2.0);
          float c2 = pow(1.0 - smoothstep(0.0, 0.35, voronoi(cp * 1.37 + 3.1, uTime * 0.7).y), 2.0);
          float caus = c1 * c2 * 1.6 + (c1 + c2) * 0.12;
          float causMask = shallow * smoothstep(0.2, 1.2, d) * near;
          water += vec3(0.5, 0.66, 0.55) * caus * causMask * 0.4;
        }

        float shadow = cloudShadow(p);
        float ps = 1.0 - smoothstep(0.35, 1.0, length(p.xz - uPlaneShadow.xy) / uPlaneShadow.z);
        shadow = max(shadow, ps * uPlaneShadow.w);
        float sunVis = 1.0 - 0.75 * shadow;
        water *= mix(vec3(0.66, 0.74, 0.92), vec3(1.0), sunVis);

        // --- sky reflection (Schlick), gently limited so the colour of the sea stays in charge
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyBase(R) * (0.85 + 0.15 * sunVis);
        vec3 col = mix(water, refl, clamp(fres, 0.0, 0.75));

        // --- sun: tight twinkling glints near, widening into a soft glitter path far away
        float farT = smoothstep(40.0, 2500.0, dist);
        // the tighter the highlight, the more it aliases: widen it as pixels grow
        float expo = clamp(900.0 / (footprint * 6.0 + 1.0), 120.0, 1400.0);
        float rs = max(dot(R, uSunDir), 0.0);
        float glint = pow(rs, expo) * expo * mix(0.012, 0.009, farT);
        // slow, smooth twinkle (no per-pixel flicker)
        glint *= 0.55 + 0.45 * snoise(p.xz * 0.12 + uTime * 0.8);
        float path = pow(rs, 40.0) * 0.18 + pow(rs, 400.0) * 0.5;
        col += uSunColor * (glint + path) * sunVis;

        // --- foam: clean shoreline bands and boat wakes with lacy Voronoi texture
        float wake = wakes(p.xz);
        float shoreZone = 1.0 - smoothstep(0.0, 3.5, d);
        float foam = 0.0;
        if (shoreZone > 0.0 || wake > 0.0) {
          vec2 lp = p.xz * 0.35 + vec2(uTime * 0.05, uTime * 0.03);
          float lace = 1.0 - smoothstep(0.02, 0.16, voronoi(lp, uTime * 0.6).y);
          float lace2 = 1.0 - smoothstep(0.02, 0.2, voronoi(lp * 2.1 + 5.0, uTime * 0.8).y);
          float laceMix = max(lace, lace2 * 0.7);
          float fn = snoise(p.xz * 0.04 + uTime * 0.05);
          // waves rolling in: soft travelling bands that thin out as they approach
          float band = sin(d * 2.2 - uTime * 1.3 + fn * 1.5);
          band = smoothstep(0.55, 0.95, band) * (1.0 - smoothstep(0.4, 3.2, d));
          float edge = (1.0 - smoothstep(0.04, 0.3 + fn * 0.1, d)) * 0.75;
          float shore = edge + band * laceMix * 0.9;
          shore *= mix(0.7, 1.0, laceMix);
          float wk = wake * mix(0.35, 1.0, laceMix);
          foam = clamp(max(shore, wk), 0.0, 1.0);
        }
        vec3 foamCol = mix(vec3(0.74, 0.84, 0.94), vec3(1.02, 1.02, 0.99), sunVis);
        col = mix(col, foamCol, foam * 0.92);

        col = applyFog(col, p);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(radialGrid(), mat);
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    update(camera) {
      const snap = 4;
      uniforms.uCenter.value.set(
        Math.round(camera.position.x / snap) * snap,
        Math.round(camera.position.z / snap) * snap,
      );
    },
  };
}
