import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, rng } from '../noise';
import { atmosphereGLSL, globalUniforms, noiseGLSL } from '../shaders/common';
import { createToonMaterial } from '../shaders/toon';
import { ISLANDS, heightOf, terrainHeight, terrainNormal, type IslandSpec } from './terrain';

const islandMaterial = (distant = false) =>
  new THREE.ShaderMaterial({
    uniforms: { ...globalUniforms },
    defines: distant ? { DISTANT: '' } : {},
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${noiseGLSL}
      ${atmosphereGLSL}
      varying vec3 vN;
      varying vec3 vWP;

      void main() {
        vec3 N = normalize(vN);
        vec3 p = vWP;
        float h = p.y;
        float slope = N.y;

        // --- limestone cliffs: warm strata bands and vertical rain streaks
        float strata = sin(h * 0.32 + snoise(p.xz * 0.012) * 4.0) * 0.5 + 0.5;
        float streak = snoise(vec2(p.x * 0.09 + p.z * 0.09, h * 0.012)) * 0.5 + 0.5;
        vec3 rock = mix(vec3(0.93, 0.88, 0.76), vec3(0.80, 0.70, 0.54), strata * 0.55);
        rock = mix(rock, vec3(0.66, 0.60, 0.52), smoothstep(0.55, 0.95, streak) * 0.45);
        rock = mix(rock, vec3(0.98, 0.95, 0.88), smoothstep(0.6, 0.9, snoise(p.xz * 0.05 + h * 0.03)) * 0.3);

        // --- vegetation: maquis patches, painterly greens
        float n1 = fbm2(p.xz * 0.008);
        float n2 = snoise(p.xz * 0.045);
        vec3 grass = mix(vec3(0.42, 0.62, 0.20), vec3(0.20, 0.44, 0.16), smoothstep(-0.3, 0.4, n1));
        grass = mix(grass, vec3(0.66, 0.72, 0.30), smoothstep(0.35, 0.8, n2) * 0.55);
        grass = mix(grass, vec3(0.13, 0.32, 0.14), smoothstep(0.45, 0.75, snoise(p.xz * 0.11)) * 0.6);

        vec3 sand = mix(vec3(0.96, 0.88, 0.66), vec3(0.90, 0.80, 0.58), snoise(p.xz * 0.1) * 0.5 + 0.5);

        float grassMask = smoothstep(0.62, 0.82, slope + n2 * 0.08) * smoothstep(2.5, 6.0, h + n1 * 3.0);
        float sandMask = (1.0 - smoothstep(1.8, 3.2, h + n2)) * smoothstep(0.35, 0.6, slope);
        vec3 albedo = mix(rock, grass, grassMask);
        albedo = mix(albedo, sand, sandMask);
#ifdef DISTANT
        albedo = mix(vec3(0.30, 0.42, 0.30), vec3(0.62, 0.60, 0.55), (1.0 - grassMask) * 0.6);
#endif
        // wet dark band at the waterline
        albedo *= mix(0.72, 1.0, smoothstep(-0.2, 0.9, h));

        // --- toon light
        float ndl = dot(N, uSunDir);
        float lit = smoothstep(0.0, 0.16, ndl + n2 * 0.04);
        lit *= 1.0 - 0.72 * cloudShadow(p);
        vec3 amb = mix(vec3(0.36, 0.40, 0.50), uSkyMid * 0.85, N.y * 0.5 + 0.5);
        vec3 shade = uShadowTint * 0.58 + amb * 0.34;
        vec3 light = uSunColor * 1.22 + amb * 0.2;
        vec3 col = albedo * mix(shade, light, lit);
        // sea bounce light on the lower cliffs
        col += albedo * vec3(0.06, 0.16, 0.18) * (1.0 - smoothstep(0.0, 25.0, h)) * (1.0 - slope);
#ifdef DISTANT
        // far mainland: cool, lavender-blue silhouettes rather than lit detail
        col = mix(col, vec3(0.30, 0.42, 0.62) * (0.75 + 0.35 * lit), 0.6);
        col = mix(col, fogColor(normalize(p - cameraPosition)), 0.35);
        gl_FragColor = vec4(col, 1.0);
        return;
#endif
        col = applyFog(col, p);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

function buildIslandGeometry(isl: IslandSpec): THREE.BufferGeometry {
  const stretch = Math.max(isl.stretch ?? 1, 1);
  const extent = isl.radius * 1.5 * stretch;
  const targetCell = Math.max(1.6, (extent * 2) / 260);
  const seg = Math.min(300, Math.ceil((extent * 2) / targetCell));
  const n = seg + 1;
  const pos = new Float32Array(n * n * 3);
  const hs = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = isl.x - extent + (i / seg) * extent * 2;
      const z = isl.z - extent + (j / seg) * extent * 2;
      const h = heightOf(isl, x, z);
      const k = j * n + i;
      hs[k] = h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = Math.max(h, -4);
      pos[k * 3 + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (Math.max(hs[a], hs[b], hs[c], hs[d]) < -1.5) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- props

function colorize(geo: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const col = new THREE.Color(c);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function cypressGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.5 * (1 - t * 0.35);
    pts.push(new THREE.Vector2(Math.max(r, 0.001), t * 4.6));
  }
  const crown = colorize(new THREE.LatheGeometry(pts, 7), '#2c5a2c');
  crown.translate(0, 0.4, 0);
  const trunk = colorize(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 5), '#5b4431');
  trunk.translate(0, 0.3, 0);
  return mergeGeometries([crown.toNonIndexed(), trunk.toNonIndexed()]);
}

function pineGeometry() {
  const canopy = colorize(new THREE.SphereGeometry(1, 9, 6), '#3d6e2e');
  canopy.scale(1.9, 0.62, 1.9);
  canopy.translate(0.2, 3.4, 0);
  const canopy2 = colorize(new THREE.SphereGeometry(1, 8, 5), '#4b7d33');
  canopy2.scale(1.2, 0.5, 1.2);
  canopy2.translate(-0.8, 3.0, 0.5);
  const trunk = colorize(new THREE.CylinderGeometry(0.1, 0.16, 3.2, 5), '#6a4b33');
  trunk.rotateZ(0.08);
  trunk.translate(0, 1.6, 0);
  return mergeGeometries([canopy.toNonIndexed(), canopy2.toNonIndexed(), trunk.toNonIndexed()]);
}

function shrubGeometry() {
  const g = colorize(new THREE.IcosahedronGeometry(1, 1), '#35652c');
  g.scale(1, 0.7, 1);
  g.translate(0, 0.35, 0);
  return g.toNonIndexed();
}

function houseGeometry() {
  const walls = colorize(new THREE.BoxGeometry(1, 1, 1), '#ffffff');
  walls.translate(0, 0.5, 0);
  const roof = colorize(new THREE.ConeGeometry(0.78, 0.45, 4, 1), '#c8603a');
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.22, 0);
  const win = colorize(new THREE.BoxGeometry(0.2, 0.25, 1.02), '#3b4a5c');
  win.translate(0.22, 0.58, 0);
  const win2 = win.clone();
  win2.translate(-0.44, 0, 0);
  return mergeGeometries([
    walls.toNonIndexed(),
    roof.toNonIndexed(),
    win.toNonIndexed(),
    win2.toNonIndexed(),
  ]);
}

function towerGeometry() {
  const body = colorize(new THREE.BoxGeometry(1, 4.5, 1), '#f3ead8');
  body.translate(0, 2.25, 0);
  const roof = colorize(new THREE.ConeGeometry(0.8, 1.6, 4), '#b8553a');
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 5.3, 0);
  const bell = colorize(new THREE.BoxGeometry(1.04, 0.5, 0.4), '#3b3b44');
  bell.translate(0, 3.9, 0);
  return mergeGeometries([body.toNonIndexed(), roof.toNonIndexed(), bell.toNonIndexed()]);
}

function lighthouseGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const base = colorize(new THREE.CylinderGeometry(3.2, 3.6, 3, 12), '#e8dcc4');
  base.translate(0, 1.5, 0);
  parts.push(base);
  for (let i = 0; i < 4; i++) {
    const seg = colorize(
      new THREE.CylinderGeometry(1.9 - (i + 1) * 0.12, 1.9 - i * 0.12, 4, 14),
      i % 2 === 0 ? '#ffffff' : '#c83a32',
    );
    seg.translate(0, 3 + i * 4 + 2, 0);
    parts.push(seg);
  }
  const lamp = colorize(new THREE.CylinderGeometry(1.1, 1.1, 2, 10), '#fff2b0');
  lamp.translate(0, 20, 0);
  const cap = colorize(new THREE.ConeGeometry(1.5, 1.8, 10), '#2f3a4a');
  cap.translate(0, 21.9, 0);
  const gallery = colorize(new THREE.CylinderGeometry(1.8, 1.8, 0.3, 14), '#2f3a4a');
  gallery.translate(0, 19, 0);
  const keeper = colorize(new THREE.BoxGeometry(6, 3.2, 4), '#f4ecde');
  keeper.translate(5, 1.6, 0);
  const keeperRoof = colorize(new THREE.BoxGeometry(6.4, 0.8, 4.4), '#c8603a');
  keeperRoof.translate(5, 3.5, 0);
  parts.push(lamp, cap, gallery, keeper, keeperRoof);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

interface Scatter {
  geo: THREE.BufferGeometry;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

function makeInstanced(s: Scatter, rim = 0.25): THREE.InstancedMesh | null {
  if (s.matrices.length === 0) return null;
  const mesh = new THREE.InstancedMesh(
    s.geo,
    createToonMaterial({ vertexColors: true, rim }),
    s.matrices.length,
  );
  s.matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, s.colors[i]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createIslands(): THREE.Group {
  const group = new THREE.Group();
  const mat = islandMaterial();
  for (const isl of ISLANDS) {
    const mesh = new THREE.Mesh(buildIslandGeometry(isl), mat);
    group.add(mesh);
  }

  const cypress: Scatter = { geo: cypressGeometry(), matrices: [], colors: [] };
  const pines: Scatter = { geo: pineGeometry(), matrices: [], colors: [] };
  const shrubs: Scatter = { geo: shrubGeometry(), matrices: [], colors: [] };
  const houses: Scatter = { geo: houseGeometry(), matrices: [], colors: [] };
  const towers: Scatter = { geo: towerGeometry(), matrices: [], colors: [] };
  const nrm = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tmpColor = new THREE.Color();
  const houseTints = ['#ffffff', '#fff6e4', '#f7e3c0', '#f4d2b8', '#ffffff', '#e9e4dc', '#f6e8c8'];

  const place = (
    s: Scatter,
    x: number,
    y: number,
    z: number,
    scale: THREE.Vector3,
    yaw: number,
    tint: THREE.Color,
  ) => {
    q.setFromAxisAngle(up, yaw);
    s.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, scale));
    s.colors.push(tint.clone());
  };

  for (const isl of ISLANDS) {
    const r = rng(isl.seed * 977 + 13);
    const stretch = Math.max(isl.stretch ?? 1, 1);
    const ext = isl.radius * 1.2 * stretch;
    const area = ext * ext * 4;
    const tries = Math.min(9000, Math.floor(area / 90));
    for (let k = 0; k < tries; k++) {
      const x = isl.x + (r() * 2 - 1) * ext;
      const z = isl.z + (r() * 2 - 1) * ext;
      const h = terrainHeight(x, z);
      if (h < 5) continue;
      terrainNormal(x, z, 1.5, nrm);
      if (nrm.y < 0.8) continue;
      const clump = Math.sin(x * 0.021 + isl.seed) * Math.cos(z * 0.017 - isl.seed * 2);
      const roll = r();
      const v = 0.75 + r() * 0.5;
      tmpColor.setRGB(v, v * (0.95 + r() * 0.1), v);
      if (isl.type === 'hill' && clump > 0.1 && roll < 0.35) {
        const s = 1.6 + r() * 1.8;
        place(
          cypress,
          x,
          h - 0.3,
          z,
          new THREE.Vector3(s, s * (0.9 + r() * 0.6), s),
          r() * 6.28,
          tmpColor,
        );
      } else if (clump < -0.15 && roll < 0.25) {
        const s = 1.8 + r() * 1.6;
        place(pines, x, h - 0.4, z, new THREE.Vector3(s, s, s), r() * 6.28, tmpColor);
      } else if (roll < 0.28) {
        const s = 1.2 + r() * 2.4;
        place(
          shrubs,
          x,
          h - 0.2,
          z,
          new THREE.Vector3(s, s * (0.6 + r() * 0.6), s),
          r() * 6.28,
          tmpColor,
        );
      }
    }

    if (isl.village) {
      // find a gentle coastal slope for the village
      let cx = 0;
      let cz = 0;
      let found = false;
      for (let k = 0; k < 4000 && !found; k++) {
        const a = r() * Math.PI * 2;
        const d = isl.radius * (0.55 + r() * 0.45) * stretch;
        cx = isl.x + Math.cos(a) * d;
        cz = isl.z + Math.sin(a) * d;
        const h = terrainHeight(cx, cz);
        terrainNormal(cx, cz, 4, nrm);
        found = h > 4 && h < 40 && nrm.y > 0.9;
      }
      if (!found) continue;
      const count = 30 + Math.floor(r() * 25);
      let placed = 0;
      for (let k = 0; k < count * 12 && placed < count; k++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 110;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        const h = terrainHeight(x, z);
        terrainNormal(x, z, 3, nrm);
        if (h < 2.5 || nrm.y < 0.82) continue;
        const w = 5 + r() * 5;
        const hh = 4 + r() * 4 + (r() < 0.2 ? 3 : 0);
        tmpColor.set(houseTints[Math.floor(r() * houseTints.length)]);
        const yaw = Math.round(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.3;
        place(
          houses,
          x,
          h - 1.2,
          z,
          new THREE.Vector3(w, hh, w * (0.7 + r() * 0.6)),
          yaw,
          tmpColor,
        );
        placed++;
      }
      const th = terrainHeight(cx, cz);
      tmpColor.set('#ffffff');
      place(towers, cx, th - 1, cz, new THREE.Vector3(4.2, 4.2, 4.2), r() * 3, tmpColor);
    }

    if (isl.lighthouse) {
      let bx = isl.x;
      let bz = isl.z;
      let best = -1;
      for (let k = 0; k < 400; k++) {
        const x = isl.x + (r() * 2 - 1) * isl.radius * stretch;
        const z = isl.z + (r() * 2 - 1) * isl.radius;
        const h = terrainHeight(x, z);
        if (h > best) {
          best = h;
          bx = x;
          bz = z;
        }
      }
      const lh = new THREE.Mesh(
        lighthouseGeometry(),
        createToonMaterial({ vertexColors: true, rim: 0.3 }),
      );
      lh.position.set(bx, best - 0.5, bz);
      lh.scale.setScalar(1.3);
      group.add(lh);
    }
  }

  for (const [s, rim] of [
    [cypress, 0.2],
    [pines, 0.2],
    [shrubs, 0.15],
    [houses, 0.3],
    [towers, 0.3],
  ] as const) {
    const m = makeInstanced(s, rim);
    if (m) group.add(m);
  }
  return group;
}

/** A hazy mainland coast far on the horizon (the Dalmatian mountains). */
export function createDistantCoast(): THREE.Mesh {
  const angSeg = 220;
  const radSeg = 24;
  const a0 = THREE.MathUtils.degToRad(-70);
  const a1 = THREE.MathUtils.degToRad(95);
  const r0 = 10500;
  const r1 = 16000;
  const pos: number[] = [];
  for (let j = 0; j <= radSeg; j++) {
    const tr = j / radSeg;
    for (let i = 0; i <= angSeg; i++) {
      const ta = i / angSeg;
      const a = a0 + (a1 - a0) * ta;
      const coast = r0 + fbm2(ta * 6, 0.5, 4) * 900;
      const r = coast + tr * (r1 - r0);
      const ridge = 1 - Math.abs(fbm2(ta * 14, tr * 3 + 4, 5));
      const edge = Math.min(1, Math.min(ta, 1 - ta) * 8);
      const h =
        (tr < 0.02 ? -20 : 1) * (80 + Math.pow(ridge, 2.2) * 1300 * Math.min(1, tr * 4)) * edge;
      pos.push(Math.cos(a) * r, h - 10, Math.sin(a) * r);
    }
  }
  const idx: number[] = [];
  const n = angSeg + 1;
  for (let j = 0; j < radSeg; j++) {
    for (let i = 0; i < angSeg; i++) {
      const a = j * n + i;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, islandMaterial(true));
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}
