import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, SUN_DIR, WIND, color } from '../config';
import { fbm3, rng } from '../noise';
import { MAX_CLOUD_SHADOWS, atmosphereGLSL, globalUniforms, noiseGLSL } from '../shaders/common';

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface Cloud {
  mesh: THREE.Mesh;
  radius: number;
  height: number;
  castsShadow: boolean;
}

const baseSphere = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
const lowSphere = mergeVertices(new THREE.IcosahedronGeometry(1, 2));

function buildCloudGeometry(seed: number, W: number, H: number, D: number): THREE.BufferGeometry {
  const r = rng(seed);
  const puffs: Puff[] = [];
  const count = Math.round(14 + Math.min(W / 18, 26) + r() * 6);
  for (let i = 0; i < count; i++) {
    const hf = Math.pow(r(), 1.35);
    const profile = 1 - Math.pow(hf, 1.6) * 0.72;
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * profile;
    const x = Math.cos(a) * rad * W * 0.42;
    const z = Math.sin(a) * rad * D * 0.42;
    const pr = (W * (0.2 - hf * 0.09) + H * 0.08) * (0.7 + r() * 0.55);
    const y = hf * (H - pr * 0.8) + pr * 0.25;
    puffs.push({ x, y, z, r: pr });
  }
  // guarantee a solid core and a crowning turret
  puffs.push({ x: 0, y: H * 0.25, z: 0, r: Math.min(W, H) * 0.34 });
  puffs.push({
    x: (r() - 0.5) * W * 0.15,
    y: H * 0.62,
    z: (r() - 0.5) * D * 0.1,
    r: Math.min(W, H) * 0.24,
  });

  const parts: THREE.BufferGeometry[] = [];
  const cx = 0;
  const cy = H * 0.35;
  const cz = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const sOff = seed * 13.1;

  for (const p of puffs) {
    const src = p.r > 35 ? baseSphere : lowSphere;
    const g = src.clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const cnt = pos.count;
    const hAttr = new Float32Array(cnt);
    const aoAttr = new Float32Array(cnt);
    const scaleAttr = new Float32Array(cnt).fill(p.r);
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(pos, i);
      // cauliflower bumps
      const bump = fbm3(v.x * 1.6 + sOff + p.x * 0.01, v.y * 1.6 + p.y * 0.01, v.z * 1.6, 3);
      const k = p.r * (1 + bump * 0.28);
      const wx = p.x + v.x * k;
      let wy = p.y + v.y * k;
      const wz = p.z + v.z * k;
      // flat, slightly soft base
      if (wy < 0) wy *= 0.06;
      pos.setXYZ(i, wx, wy, wz);
      hAttr[i] = Math.min(Math.max(wy / H, 0), 1);
      // occlusion: how buried is this vertex inside neighbouring puffs
      let occ = 0;
      for (const o of puffs) {
        if (o === p) continue;
        const dx = wx - o.x;
        const dy = wy - o.y;
        const dz = wz - o.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / (o.r * 1.35);
        if (d < 1) occ += 1 - d;
      }
      aoAttr[i] = Math.max(0, 1 - occ * 0.6);
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < cnt; i++) {
      n.fromBufferAttribute(nrm, i);
      v.fromBufferAttribute(pos, i);
      radial.set(v.x - cx, (v.y - cy) * 1.3, v.z - cz).normalize();
      n.lerp(radial, 0.42).normalize();
      if (v.y <= 0.5) n.lerp(new THREE.Vector3(0, -1, 0), 0.7).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    g.setAttribute('aH', new THREE.BufferAttribute(hAttr, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(aoAttr, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(scaleAttr, 1));
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  merged.computeBoundingSphere();
  return merged;
}

function cloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...globalUniforms,
      uCloudLit: { value: color(PALETTE.cloudLit) },
      uCloudShade: { value: color(PALETTE.cloudShade) },
      uCloudDark: { value: color(PALETTE.cloudDark) },
    },
    vertexShader: /* glsl */ `
      ${noiseGLSL}
      uniform float uTime;
      attribute float aH;
      attribute float aAO;
      attribute float aScale;
      varying vec3 vN;
      varying vec3 vWP;
      varying float vH;
      varying float vAO;
      void main() {
        vec3 p = position;
        // slow boiling: the cloud is alive
        float boil = snoise(p * 0.018 + vec3(0.0, uTime * 0.035, uTime * 0.02));
        p += normal * boil * aScale * 0.07 * smoothstep(0.02, 0.2, aH);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vH = aH;
        vAO = aAO;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${noiseGLSL}
      ${atmosphereGLSL}
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      uniform vec3 uCloudDark;
      varying vec3 vN;
      varying vec3 vWP;
      varying float vH;
      varying float vAO;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWP);
        vec3 L = uSunDir;
        float wrap = dot(N, L) * 0.5 + 0.5;
        float brush = snoise(vWP * 0.03) * 0.05;
        float lit = smoothstep(0.4, 0.68, wrap + brush);
        lit *= mix(0.55, 1.0, vAO);

        vec3 shade = mix(uCloudDark, uCloudShade, smoothstep(0.0, 0.6, vH));
        shade += uSkyMid * 0.12 * max(N.y, 0.0);
        vec3 light = uCloudLit * mix(vec3(1.0), uSunColor, 0.5) * 1.12;
        vec3 col = mix(shade, light, lit);
        // soft mid-tone band gives that painted, layered look
        col = mix(col, mix(shade, light, 0.55), smoothstep(0.25, 0.5, wrap) * (1.0 - smoothstep(0.5, 0.65, wrap)) * 0.35);
        col *= mix(0.82, 1.0, vAO);
        // darker, bluer flat bottoms
        col = mix(col, uCloudDark * 0.85, (1.0 - smoothstep(0.0, 0.18, vH)) * 0.45);

        // silver lining when the sun is behind the cloud
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float behind = pow(max(dot(-V, L), 0.0), 4.0);
        col += uSunColor * rim * (0.18 + behind * 1.5);
        // light glowing through thin edges
        col += uSunColor * behind * 0.18 * (1.0 - vAO * 0.5);

        col = applyFog(col, vWP);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...globalUniforms },
    vertexShader: /* glsl */ `
      uniform vec3 uSunDir;
      attribute vec3 aOrigin;
      attribute vec4 aParams; // width, length, phase, intensity
      varying vec2 vUV;
      varying float vFade;
      varying float vPhase;
      varying float vInt;
      void main() {
        vec3 axis = -uSunDir;
        vec3 o = (modelMatrix * vec4(aOrigin, 1.0)).xyz;
        vec3 mid = o + axis * aParams.y * 0.5;
        vec3 toCam = normalize(cameraPosition - mid);
        vec3 side = normalize(cross(axis, toCam));
        float u = position.x;
        float v = position.y;
        vec3 wp = o + axis * (v * aParams.y) + side * (u * aParams.x * (1.0 + v * 0.7));
        float dist = length(cameraPosition - wp);
        float facing = 1.0 - abs(dot(axis, toCam));
        float scatter = 0.55 + 1.4 * pow(max(dot(-toCam, uSunDir), 0.0), 2.0);
        vFade = facing * scatter * smoothstep(25.0, 160.0, dist) * (1.0 - smoothstep(4000.0, 9000.0, dist));
        vUV = vec2(u, v);
        vPhase = aParams.z;
        vInt = aParams.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${noiseGLSL}
      uniform float uTime;
      uniform vec3 uSunColor;
      varying vec2 vUV;
      varying float vFade;
      varying float vPhase;
      varying float vInt;
      void main() {
        float u = vUV.x;
        float v = vUV.y;
        float across = pow(max(1.0 - u * u, 0.0), 2.2);
        float along = smoothstep(0.0, 0.1, v) * (1.0 - smoothstep(0.35, 0.95, v));
        float streaks = 0.6 + 0.4 * snoise(vec2(u * 2.5 + vPhase * 10.0, v * 0.6 - uTime * 0.03));
        float breathe = 0.6 + 0.4 * sin(uTime * 0.23 + vPhase * 6.28);
        float a = across * along * streaks * breathe * vInt * vFade;
        gl_FragColor = vec4(uSunColor * vec3(1.0, 0.94, 0.8) * a * 0.75, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function buildBeams(seed: number, W: number, D: number, baseY: number, count: number) {
  const r = rng(seed * 31 + 7);
  const quad = new THREE.PlaneGeometry(2, 1, 1, 8);
  quad.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const origins = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  const len = (baseY / Math.max(SUN_DIR.y, 0.1)) * 1.02;
  // beams come in clusters, like light escaping one gap in the cloud
  const gx = (r() - 0.5) * W * 0.5;
  const gz = (r() - 0.5) * D * 0.5;
  for (let i = 0; i < count; i++) {
    origins[i * 3] = gx + (r() - 0.5) * W * 0.55;
    origins[i * 3 + 1] = 10;
    origins[i * 3 + 2] = gz + (r() - 0.5) * D * 0.55;
    params[i * 4] = 5 + r() * r() * 38;
    params[i * 4 + 1] = len;
    params[i * 4 + 2] = r();
    params[i * 4 + 3] = 0.45 + r() * 0.75;
  }
  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geo.instanceCount = count;
  return geo;
}

export interface CloudSystem {
  group: THREE.Group;
  clouds: Cloud[];
  update(dt: number): void;
}

export function createClouds(): CloudSystem {
  const group = new THREE.Group();
  const clouds: Cloud[] = [];
  const mat = cloudMaterial();
  const bMat = beamMaterial();
  const r = rng(4242);

  const add = (
    x: number,
    y: number,
    z: number,
    W: number,
    H: number,
    D: number,
    beams: number,
    castsShadow = true,
  ) => {
    const seed = Math.floor(r() * 1e6);
    const mesh = new THREE.Mesh(buildCloudGeometry(seed, W, H, D), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = r() * Math.PI * 2;
    group.add(mesh);
    if (beams > 0) {
      const b = new THREE.Mesh(buildBeams(seed, W, D, y, beams), bMat);
      b.frustumCulled = false;
      b.renderOrder = 10;
      // beams hang from the cloud but must not rotate with it
      b.rotation.y = -mesh.rotation.y;
      mesh.add(b);
    }
    clouds.push({ mesh, radius: Math.max(W, D) * 0.5, height: H, castsShadow });
  };

  // medium cumulus around the flight area
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 400 + Math.sqrt(r()) * 3600;
    const W = 220 + r() * r() * 520;
    add(
      Math.cos(a) * d,
      420 + r() * 260,
      Math.sin(a) * d,
      W,
      W * (0.55 + r() * 0.45),
      W * (0.7 + r() * 0.3),
      r() < 0.55 ? 6 + Math.floor(r() * 8) : 0,
    );
  }
  // small fair-weather puffs the plane slips past
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2;
    const d = 200 + Math.sqrt(r()) * 2200;
    const W = 60 + r() * 80;
    add(Math.cos(a) * d, 250 + r() * 90, Math.sin(a) * d, W, W * 0.55, W * 0.8, 0);
  }
  // towering cumulus on the horizon
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + r() * 0.4;
    const d = 5200 + r() * 3800;
    const W = 700 + r() * 700;
    add(Math.cos(a) * d, 380, Math.sin(a) * d, W, W * (0.9 + r() * 0.7), W * 0.8, 0, false);
  }

  const shadowUniform = globalUniforms.uCloudShadows.value;
  const LIMIT = 9500;

  const update = (dt: number) => {
    let si = 0;
    for (const c of clouds) {
      const p = c.mesh.position;
      p.x += WIND.x * dt;
      p.z += WIND.y * dt;
      if (p.x > LIMIT) p.x -= LIMIT * 2;
      if (p.z > LIMIT) p.z -= LIMIT * 2;
      if (c.castsShadow && si < MAX_CLOUD_SHADOWS) {
        const lift = p.y + c.height * 0.3;
        const gx = p.x - (SUN_DIR.x / SUN_DIR.y) * lift;
        const gz = p.z - (SUN_DIR.z / SUN_DIR.y) * lift;
        shadowUniform[si++].set(gx, gz, c.radius * 0.95, 0.85);
      }
    }
    for (; si < MAX_CLOUD_SHADOWS; si++) shadowUniform[si].set(0, 0, 1, 0);
  };
  update(0);
  return { group, clouds, update };
}
