import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../noise';
import { createToonMaterial } from '../shaders/toon';
import { MAX_BOATS, type OceanHandle } from './ocean';
import { terrainHeight } from './terrain';
import { waveHeight } from './waves';

function paint(geo: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(c);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) col.toArray(arr, i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Tapered hull: pointed raised bow, narrow bottom. Bow at +z. */
function hullGeo(L: number, W: number, H: number, top: string, bottom: string) {
  const g = new THREE.BoxGeometry(W, H, L, 2, 2, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    const t = z / (L / 2);
    const bow = Math.max(0, t);
    x *= 1 - Math.pow(bow, 2.2) * 0.98;
    x *= t < 0 ? 1 - Math.pow(-t, 4) * 0.25 : 1;
    if (y < 0) x *= 0.55;
    y += Math.pow(bow, 3) * H * 0.5 * (y > 0 ? 1 : 0.3);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const upper = g.clone();
  upper.translate(0, H * 0.5, 0);
  const u = paint(upper, top);
  // colour the lower half differently by vertex height
  const colors = u.attributes.color;
  const pos = u.attributes.position;
  const cb = new THREE.Color(bottom);
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < H * 0.4) cb.toArray(colors.array, i * 3);
  return u;
}

function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray()], 3),
  );
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, c: string) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, c);
}

function cyl(r: number, h: number, x: number, y: number, z: number, c: string) {
  const g = new THREE.CylinderGeometry(r, r, h, 8);
  g.translate(x, y, z);
  return paint(g, c);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

type Kind = 'sail' | 'lugger' | 'fishing' | 'steamer';

function boatGeometry(kind: Kind, r: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'sail': {
      parts.push(hullGeo(9, 2.6, 1.4, '#fbfaf5', '#2b4f7e'));
      parts.push(cyl(0.08, 11, 0, 6.5, 0.8, '#6b5238'));
      parts.push(paint(triangle(V(0, 1.8, 0.7), V(0, 11.5, 0.7), V(0, 1.9, -3.6)), '#fbf6ea'));
      parts.push(paint(triangle(V(0, 1.8, 1.1), V(0, 10.5, 0.9), V(0, 1.6, 4.4)), '#f4ecd8'));
      break;
    }
    case 'lugger': {
      const sail = r() < 0.5 ? '#d9772f' : '#c4432f';
      parts.push(hullGeo(12, 3.4, 1.8, r() < 0.5 ? '#2f6f8f' : '#f1e3c4', '#7a3b25'));
      parts.push(cyl(0.12, 12, 0, 7.5, 1.5, '#5d4630'));
      parts.push(cyl(0.1, 8, 0, 5.5, -3.2, '#5d4630'));
      parts.push(paint(triangle(V(0, 2.6, 3.8), V(0, 12.8, 0.4), V(0, 2.4, -1.8)), sail));
      parts.push(paint(triangle(V(0, 12.8, 0.4), V(0, 2.4, -1.8), V(0, 5, -2.2)), sail));
      parts.push(paint(triangle(V(0, 2.4, -2.1), V(0, 9, -3.2), V(0, 2.4, -5.4)), sail));
      break;
    }
    case 'fishing': {
      const hull = ['#2d6ea8', '#3c8a5c', '#d4553b', '#e8d9b6'][Math.floor(r() * 4)];
      parts.push(hullGeo(8, 2.8, 1.5, hull, '#f4efe6'));
      parts.push(box(1.8, 1.6, 2, 0, 2.8, -1.2, '#fbf8f0'));
      parts.push(box(1.84, 0.4, 1.6, 0, 3.2, -1.0, '#33485c'));
      parts.push(box(2.0, 0.2, 2.3, 0, 3.7, -1.2, '#c5553a'));
      parts.push(cyl(0.07, 5, 0, 4.5, 1.8, '#5d4630'));
      break;
    }
    case 'steamer': {
      parts.push(hullGeo(34, 6.5, 3.2, '#fbfaf5', '#9b2a24'));
      parts.push(box(5, 2.6, 16, 0, 5.3, -2, '#f7f3ea'));
      parts.push(box(5.04, 0.6, 15, 0, 5.5, -2, '#2d3d52'));
      parts.push(box(4, 2.2, 7, 0, 7.6, 0, '#fbf8f0'));
      parts.push(cyl(1.05, 5, 0, 10.5, -3.5, '#f0c23a'));
      parts.push(cyl(1.08, 1.2, 0, 12.6, -3.5, '#1f2328'));
      parts.push(cyl(0.12, 12, 0, 10, 8, '#5d4630'));
      break;
    }
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

interface Boat {
  mesh: THREE.Mesh;
  center: THREE.Vector2;
  radius: number;
  angle: number;
  speed: number;
  dir: number;
  length: number;
  heel: number;
}

export interface BoatSystem {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  update(dt: number, t: number): void;
}

function circleIsClear(cx: number, cz: number, R: number) {
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    for (const k of [0.92, 1, 1.08]) {
      if (terrainHeight(cx + Math.cos(a) * R * k, cz + Math.sin(a) * R * k) > -3.5) return false;
    }
  }
  return true;
}

export function createBoats(ocean: OceanHandle): BoatSystem {
  const group = new THREE.Group();
  const r = rng(90210);
  const mat = createToonMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    rim: 0.3,
    gloss: 0.1,
  });
  const boats: Boat[] = [];
  const kinds: Kind[] = [
    'steamer',
    'lugger',
    'sail',
    'fishing',
    'lugger',
    'sail',
    'fishing',
    'sail',
  ];
  const lengths: Record<Kind, number> = { sail: 9, lugger: 12, fishing: 8, steamer: 34 };
  const speeds: Record<Kind, number> = { sail: 4.5, lugger: 3.8, fishing: 5.5, steamer: 7.5 };

  for (let i = 0; i < Math.min(kinds.length, MAX_BOATS); i++) {
    const kind = kinds[i];
    let cx = 0;
    let cz = 0;
    let R = 0;
    for (let k = 0; k < 400; k++) {
      cx = (r() * 2 - 1) * 1700;
      cz = (r() * 2 - 1) * 1700;
      R = kind === 'steamer' ? 900 + r() * 600 : 150 + r() * 350;
      if (circleIsClear(cx, cz, R)) break;
    }
    const mesh = new THREE.Mesh(boatGeometry(kind, r), mat);
    group.add(mesh);
    boats.push({
      mesh,
      center: new THREE.Vector2(cx, cz),
      radius: R,
      angle: r() * Math.PI * 2,
      speed: speeds[kind],
      dir: r() < 0.5 ? 1 : -1,
      length: lengths[kind],
      heel: kind === 'sail' || kind === 'lugger' ? 0.12 : 0,
    });
  }

  const e = new THREE.Euler();
  const update = (dt: number, t: number) => {
    boats.forEach((b, i) => {
      b.angle += ((b.speed * dt) / b.radius) * b.dir;
      const x = b.center.x + Math.cos(b.angle) * b.radius;
      const z = b.center.y + Math.sin(b.angle) * b.radius;
      // tangent direction
      const fx = -Math.sin(b.angle) * b.dir;
      const fz = Math.cos(b.angle) * b.dir;
      const half = b.length * 0.4;
      const yB = waveHeight(x + fx * half, z + fz * half, t);
      const yS = waveHeight(x - fx * half, z - fz * half, t);
      const yP = waveHeight(x - fz * 1.5, z + fx * 1.5, t);
      const yR = waveHeight(x + fz * 1.5, z - fx * 1.5, t);
      const y = (yB + yS + yP + yR) / 4;
      const pitch = Math.atan2(yB - yS, half * 2);
      const roll = Math.atan2(yP - yR, 3) * 0.7;
      const yaw = Math.atan2(fx, fz);
      e.set(-pitch, yaw, roll + b.heel * b.dir, 'YXZ');
      b.mesh.position.set(x, y - 0.35, z);
      b.mesh.rotation.copy(e);
      ocean.uniforms.uBoats.value[i].set(x, z, fx, fz);
      ocean.uniforms.uBoatInfo.value[i].set(Math.min(1, b.speed / 7), b.length, 1, 0);
    });
  };
  return { group, meshes: boats.map((b) => b.mesh), update };
}
