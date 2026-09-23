import * as THREE from 'three';
import { noise2, rng } from '../noise';
import { createToonMaterial } from '../shaders/toon';

/** Seagull: body along +z, wings along ±x (x > 0.1 flaps in the vertex shader). */
function gullGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const white = [1, 1, 1];
  const grey = [0.72, 0.76, 0.82];
  const black = [0.16, 0.17, 0.2];
  const tri = (a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]) => {
    pos.push(...a, ...b, ...c);
    col.push(...ca, ...cb, ...cc);
  };
  for (const s of [-1, 1]) {
    const root0 = [0.1 * s, 0, 0.22];
    const root1 = [0.1 * s, 0, -0.18];
    const mid0 = [0.62 * s, 0.05, 0.14];
    const mid1 = [0.62 * s, 0.05, -0.22];
    const tip = [1.12 * s, -0.02, -0.28];
    tri(root0, mid0, root1, white, grey, white);
    tri(root1, mid0, mid1, white, grey, grey);
    tri(mid0, tip, mid1, grey, black, grey);
  }
  // body (diamond)
  const nose = [0, 0.02, 0.55];
  const tail = [0, 0.01, -0.5];
  const top = [0, 0.1, 0.05];
  const bot = [0, -0.1, 0.05];
  const l = [-0.1, 0, 0.05];
  const r = [0.1, 0, 0.05];
  const yb = [1, 0.85, 0.35];
  tri(nose, top, r, yb, white, white);
  tri(nose, l, top, yb, white, white);
  tri(nose, r, bot, yb, white, white);
  tri(nose, bot, l, yb, white, white);
  tri(tail, r, top, white, white, white);
  tri(tail, top, l, white, white, white);
  tri(tail, bot, r, white, white, white);
  tri(tail, l, bot, white, white, white);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface Flock {
  center: THREE.Vector3;
  radius: THREE.Vector2;
  alt: number;
  speed: number;
  phase: number;
  birds: { offset: THREE.Vector3; seed: number; scale: number }[];
}

export interface BirdSystem {
  mesh: THREE.InstancedMesh;
  flocks: Flock[];
  update(t: number): void;
}

export function createBirds(): BirdSystem {
  const r = rng(777);
  const flocks: Flock[] = [];
  const specs: [number, number, number, number, number][] = [
    // cx, cz, radius, alt, count
    [300, -600, 380, 90, 34],
    [-900, 200, 520, 60, 26],
    [500, 900, 460, 120, 30],
    [-1100, -1100, 400, 140, 22],
    [1300, -200, 300, 45, 18],
  ];
  let total = 0;
  for (const [cx, cz, rad, alt, count] of specs) {
    const birds = [];
    for (let i = 0; i < count; i++) {
      birds.push({
        offset: new THREE.Vector3((r() - 0.5) * 60, (r() - 0.5) * 16, (r() - 0.5) * 60),
        seed: r() * 100,
        scale: 1.4 + r() * 0.5,
      });
    }
    flocks.push({
      center: new THREE.Vector3(cx, 0, cz),
      radius: new THREE.Vector2(rad, rad * (0.6 + r() * 0.4)),
      alt,
      speed: (11 + r() * 4) / rad,
      phase: r() * 10,
      birds,
    });
    total += count;
  }

  const geo = gullGeometry();
  const phases = new Float32Array(total);
  for (let i = 0; i < total; i++) phases[i] = r();
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  const mat = createToonMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    flap: true,
    rim: 0.4,
    cloudShadows: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const update = (t: number) => {
    let idx = 0;
    for (const f of flocks) {
      const a = t * f.speed + f.phase;
      const cx = f.center.x + Math.cos(a) * f.radius.x;
      const cz = f.center.z + Math.sin(a * 1.0) * f.radius.y;
      const cy = f.alt + Math.sin(a * 2.3) * 20;
      const vx = -Math.sin(a) * f.radius.x;
      const vz = Math.cos(a) * f.radius.y;
      const heading = Math.atan2(vx, vz);
      for (const b of f.birds) {
        const n1 = noise2(b.seed, t * 0.12);
        const n2 = noise2(b.seed + 31, t * 0.1);
        const n3 = noise2(b.seed + 71, t * 0.15);
        // rotate offset with heading so the formation turns as one
        const ox = b.offset.x + n1 * 14;
        const oz = b.offset.z + n2 * 14;
        const ch = Math.cos(heading);
        const sh = Math.sin(heading);
        p.set(cx + ox * ch + oz * sh, cy + b.offset.y + n3 * 6, cz - ox * sh + oz * ch);
        e.set(n3 * 0.15, heading + n1 * 0.25, -0.35 * Math.sign(f.speed) + n2 * 0.3, 'YXZ');
        q.setFromEuler(e);
        s.setScalar(b.scale);
        m.compose(p, q, s);
        mesh.setMatrixAt(idx++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, flocks, update };
}
