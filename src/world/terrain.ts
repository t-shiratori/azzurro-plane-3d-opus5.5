import * as THREE from 'three';
import { WORLD_HALF } from '../config';
import { fbm2, noise2, smoothstep } from '../noise';

export type IslandType = 'cliff' | 'hill' | 'spire' | 'low';

export interface IslandSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  type: IslandType;
  stretch?: number;
  rot?: number;
  seed: number;
  village?: boolean;
  lighthouse?: boolean;
  /** How far (in radii) the turquoise shallow shelf extends. */
  shelf?: number;
}

export const ISLANDS: IslandSpec[] = [
  { x: -600, z: -300, radius: 270, height: 150, type: 'cliff', stretch: 1.45, rot: 0.3, seed: 1 },
  {
    x: 720,
    z: -520,
    radius: 400,
    height: 170,
    type: 'hill',
    stretch: 1.3,
    rot: -0.5,
    seed: 2,
    village: true,
  },
  { x: 120, z: -980, radius: 72, height: 200, type: 'spire', seed: 3, shelf: 3.2 },
  { x: 250, z: -880, radius: 46, height: 135, type: 'spire', seed: 4, shelf: 3.5 },
  { x: 40, z: -870, radius: 38, height: 95, type: 'spire', seed: 18, shelf: 3.5 },
  {
    x: -150,
    z: 470,
    radius: 120,
    height: 16,
    type: 'low',
    stretch: 1.4,
    rot: 0.8,
    seed: 5,
    lighthouse: true,
    shelf: 2.8,
  },
  { x: 950, z: 620, radius: 220, height: 115, type: 'cliff', stretch: 1.8, rot: 1.1, seed: 6 },
  {
    x: -1350,
    z: 760,
    radius: 480,
    height: 250,
    type: 'hill',
    stretch: 1.25,
    rot: 0.2,
    seed: 7,
    village: true,
  },
  { x: -950, z: -1250, radius: 85, height: 170, type: 'spire', seed: 8, shelf: 3 },
  { x: -820, z: -1130, radius: 52, height: 95, type: 'spire', seed: 9, shelf: 3 },
  { x: 1650, z: -1450, radius: 360, height: 185, type: 'cliff', stretch: 1.2, rot: -0.9, seed: 10 },
  {
    x: 420,
    z: 1320,
    radius: 170,
    height: 24,
    type: 'low',
    stretch: 1.6,
    rot: -0.3,
    seed: 11,
    shelf: 2.6,
  },
  {
    x: -2450,
    z: -650,
    radius: 700,
    height: 380,
    type: 'hill',
    stretch: 1.3,
    rot: 0.9,
    seed: 12,
    village: true,
    shelf: 1.7,
  },
  {
    x: 2650,
    z: 950,
    radius: 640,
    height: 300,
    type: 'hill',
    stretch: 1.4,
    rot: -0.4,
    seed: 13,
    shelf: 1.7,
  },
  { x: -320, z: 1560, radius: 250, height: 150, type: 'cliff', stretch: 1.2, rot: 0.5, seed: 14 },
  { x: 1250, z: 120, radius: 42, height: 38, type: 'spire', seed: 15, shelf: 3.5 },
  { x: -1750, z: -280, radius: 60, height: 75, type: 'spire', seed: 16, shelf: 3 },
  {
    x: 1900,
    z: -300,
    radius: 150,
    height: 20,
    type: 'low',
    stretch: 1.3,
    rot: 1.4,
    seed: 17,
    shelf: 2.8,
  },
];

export const SEABED = -45;

interface Local {
  qx: number;
  qz: number;
  d: number;
}

function toLocal(isl: IslandSpec, x: number, z: number): Local {
  const rot = isl.rot ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let lx = x - isl.x;
  let lz = z - isl.z;
  const rx = lx * c + lz * s;
  const rz = -lx * s + lz * c;
  lx = rx / (isl.stretch ?? 1);
  lz = rz;
  const qx = lx / isl.radius;
  const qz = lz / isl.radius;
  const sd = isl.seed * 7.31;
  const wx = fbm2(qx * 1.1 + sd, qz * 1.1, 3) * 0.3;
  const wz = fbm2(qx * 1.1 + sd + 5.2, qz * 1.1 + 1.3, 3) * 0.3;
  return { qx, qz, d: Math.hypot(qx + wx, qz + wz) };
}

/** Height of a single island's shape above sea level (without seabed). */
function shape(isl: IslandSpec, l: Local): number {
  const { qx, qz, d } = l;
  if (d >= 1) return -Infinity;
  const H = isl.height;
  const sd = isl.seed * 3.7;
  switch (isl.type) {
    case 'cliff': {
      const wall = smoothstep(1.0, 0.86, d);
      const top = 0.7 + 0.3 * smoothstep(0.86, 0.1, d) + 0.1 * fbm2(qx * 3 + sd, qz * 3, 4);
      // vertical gullies carved into the cliffs
      const gully = 1 - 0.08 * Math.abs(noise2(Math.atan2(qz, qx) * 6 + sd, d * 2));
      return H * wall * top * gully;
    }
    case 'hill': {
      const band = smoothstep(1.0, 0.9, d) * 0.2;
      const dome = Math.pow(smoothstep(0.98, 0.0, d), 1.25);
      const bumps = fbm2(qx * 2.4 + sd, qz * 2.4, 5) * 0.16;
      return H * Math.max(band, dome * (0.88 + bumps) + band * 0.5);
    }
    case 'spire': {
      const t = smoothstep(1.0, 0.72, d) * (0.82 + 0.18 * smoothstep(0.72, 0.0, d));
      return H * t * (0.92 + 0.08 * fbm2(qx * 4 + sd, qz * 4, 3));
    }
    case 'low': {
      return H * smoothstep(1.0, 0.45, d) * (0.75 + 0.25 * fbm2(qx * 3 + sd, qz * 3, 3));
    }
  }
}

function islandHeight(isl: IslandSpec, x: number, z: number): number {
  const reach = isl.radius * (isl.shelf ?? 2.1) * Math.max(isl.stretch ?? 1, 1) * 1.35;
  const dx = x - isl.x;
  const dz = z - isl.z;
  if (dx * dx + dz * dz > reach * reach) return SEABED;
  const l = toLocal(isl, x, z);
  const shelf = isl.shelf ?? 2.1;
  const ang = Math.atan2(l.qz, l.qx);
  const beach =
    0.2 + 1.8 * Math.max(0, noise2(Math.cos(ang) * 1.3 + isl.seed, Math.sin(ang) * 1.3));
  // the shallow shelf: soft slope from the beach down to the deep seabed
  const t = smoothstep(shelf, 1.0, l.d);
  const seabed = SEABED + (beach - SEABED) * Math.pow(t, 1.6);
  return Math.max(seabed, shape(isl, l));
}

export function terrainHeight(x: number, z: number): number {
  let h = SEABED;
  for (const isl of ISLANDS) {
    const v = islandHeight(isl, x, z);
    if (v > h) h = v;
  }
  return h;
}

export function heightOf(isl: IslandSpec, x: number, z: number): number {
  return islandHeight(isl, x, z);
}

export function terrainNormal(x: number, z: number, e = 1.5, out = new THREE.Vector3()) {
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

export const DEPTH_MAP_SIZE = 1024;

/**
 * Top-down water depth texture covering [-WORLD_HALF, WORLD_HALF]².
 * Stored as sqrt(depth / 50) for extra precision in the shallows.
 */
export function createDepthTexture(): THREE.DataTexture {
  const N = DEPTH_MAP_SIZE;
  const data = new Uint8Array(N * N);
  const size = WORLD_HALF * 2;
  for (let j = 0; j < N; j++) {
    const z = -WORLD_HALF + ((j + 0.5) / N) * size;
    for (let i = 0; i < N; i++) {
      const x = -WORLD_HALF + ((i + 0.5) / N) * size;
      const h = terrainHeight(x, z);
      const depth = Math.min(Math.max(-h, 0) / 50, 1);
      data[j * N + i] = Math.round(Math.sqrt(depth) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
