import * as THREE from 'three';
import { createOutlineMaterial, createToonMaterial } from '../shaders/toon';
import { terrainHeight } from './terrain';

const RED = '#c8232b';
const DARK = '#2a2a30';

function mat(c: THREE.ColorRepresentation, gloss = 0.35, rim = 0.35) {
  return createToonMaterial({ color: c, gloss, rim, cloudShadows: true, side: THREE.DoubleSide });
}

function withOutline(mesh: THREE.Mesh, thickness = 0.035): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, createOutlineMaterial('#3a0d10', thickness));
  mesh.add(o);
  return mesh;
}

function hull(): THREE.BufferGeometry {
  // side profile of a flying-boat hull, lathed then squashed into a boat shape
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [
    [0.0, -4.9],
    [0.12, -4.7],
    [0.26, -4.0],
    [0.44, -2.8],
    [0.66, -1.4],
    [0.8, -0.2],
    [0.84, 1.0],
    [0.8, 2.2],
    [0.66, 3.2],
    [0.42, 3.9],
    [0.14, 4.25],
    [0.0, 4.32],
  ];
  for (const [r, z] of prof) pts.push(new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, 24);
  // lathe runs along +y; lay it along +z
  g.rotateX(Math.PI / 2);
  g.scale(0.9, 1.05, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // flat-ish, keeled boat bottom and a raised tail
    if (v.y < 0) v.y *= 0.72 + 0.28 * Math.abs(v.x);
    const tail = THREE.MathUtils.smoothstep(-v.z, 1.5, 4.9);
    v.y += tail * 0.55;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function wingGeometry(span: number, chord: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const hs = span / 2;
  const r = chord * 0.48;
  s.moveTo(-hs + r, -chord / 2);
  s.lineTo(hs - r, -chord / 2);
  s.quadraticCurveTo(hs, -chord / 2, hs, 0);
  s.quadraticCurveTo(hs, chord / 2, hs - r, chord / 2);
  s.lineTo(-hs + r, chord / 2);
  s.quadraticCurveTo(-hs, chord / 2, -hs, 0);
  s.quadraticCurveTo(-hs, -chord / 2, -hs + r, -chord / 2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick * 0.4,
    bevelEnabled: true,
    bevelThickness: thick * 0.3,
    bevelSize: thick * 0.25,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick * 0.2, 0);
  g.computeVertexNormals();
  return g;
}

function strut(a: THREE.Vector3, b: THREE.Vector3, r = 0.045): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export interface PlaneModel {
  root: THREE.Group;
  prop: THREE.Object3D;
  propDisc: THREE.Mesh;
}

export function createPlaneModel(): PlaneModel {
  const root = new THREE.Group();
  const red = mat(RED, 0.5);
  const dark = mat(DARK, 0.4, 0.2);
  const wood = mat('#7a5230', 0.3, 0.2);
  const glass = mat('#bfe6f2', 0.9, 0.6);

  root.add(withOutline(new THREE.Mesh(hull(), red)));

  // cockpit opening + windshield
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    dark,
  );
  cockpit.scale.set(0.8, 0.25, 1.3);
  cockpit.position.set(0, 0.8, 0.6);
  root.add(cockpit);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.38), glass);
  shield.position.set(0, 1.02, 1.35);
  shield.rotation.x = -0.55;
  root.add(shield);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), mat('#5a3b28', 0.1, 0.2));
  pilot.position.set(0, 1.0, 0.5);
  root.add(pilot);

  // main wing on a pylon
  const wing = withOutline(new THREE.Mesh(wingGeometry(12.8, 1.75, 0.24), red));
  wing.position.set(0, 1.55, 0.35);
  root.add(wing);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 1.4), red);
  pylon.position.set(0, 1.2, 0.3);
  root.add(pylon);

  // engine nacelle above the wing
  const nacelleGeo = new THREE.CapsuleGeometry(0.42, 1.9, 6, 14);
  nacelleGeo.rotateX(Math.PI / 2);
  const nacelle = withOutline(new THREE.Mesh(nacelleGeo, red));
  nacelle.position.set(0, 2.45, 0.35);
  root.add(nacelle);
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.35, 16), dark);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 2.45, 1.45);
  root.add(cowl);
  const radiator = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), dark);
  radiator.position.set(0, 2.0, 0.9);
  root.add(radiator);
  for (const [x, z] of [
    [-0.3, -0.1],
    [0.3, -0.1],
    [-0.3, 0.9],
    [0.3, 0.9],
  ] as const) {
    root.add(
      new THREE.Mesh(
        strut(new THREE.Vector3(x * 1.4, 1.62, z), new THREE.Vector3(x, 2.2, z)),
        dark,
      ),
    );
  }

  // pusher propeller behind the nacelle
  const prop = new THREE.Group();
  prop.position.set(0, 2.45, -0.95);
  const bladeGeo = new THREE.BoxGeometry(0.14, 1.35, 0.05);
  bladeGeo.translate(0, 0.7, 0);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(bladeGeo, wood);
    b.rotation.z = i * Math.PI;
    b.rotation.y = 0.35;
    prop.add(b);
  }
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 12), dark);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.15;
  prop.add(spinner);
  root.add(prop);
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.42, 40),
    new THREE.MeshBasicMaterial({
      color: '#d9c7a8',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  propDisc.position.copy(prop.position);
  propDisc.position.z -= 0.02;
  root.add(propDisc);

  // struts: hull to wing
  for (const s of [-1, 1]) {
    root.add(
      new THREE.Mesh(
        strut(new THREE.Vector3(0.62 * s, 0.1, 0.9), new THREE.Vector3(2.6 * s, 1.5, 0.6)),
        dark,
      ),
    );
    root.add(
      new THREE.Mesh(
        strut(new THREE.Vector3(0.62 * s, 0.1, -0.2), new THREE.Vector3(2.6 * s, 1.5, 0.0)),
        dark,
      ),
    );
    // wingtip floats
    const floatGeo = new THREE.CapsuleGeometry(0.18, 0.9, 4, 10);
    floatGeo.rotateX(Math.PI / 2);
    const fl = withOutline(new THREE.Mesh(floatGeo, red), 0.02);
    fl.position.set(4.9 * s, 0.35, 0.45);
    root.add(fl);
    root.add(
      new THREE.Mesh(
        strut(new THREE.Vector3(4.9 * s, 0.45, 0.45), new THREE.Vector3(4.9 * s, 1.5, 0.45), 0.035),
        dark,
      ),
    );
  }

  // tail: fin, rudder in tricolour, stabiliser
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(1.3, 0);
  finShape.quadraticCurveTo(1.25, 1.2, 0.85, 1.75);
  finShape.lineTo(0.35, 1.75);
  finShape.quadraticCurveTo(0.2, 0.7, 0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
  finGeo.translate(0, 0, -0.04);
  finGeo.rotateY(Math.PI / 2);
  const fin = withOutline(new THREE.Mesh(finGeo, red), 0.02);
  fin.position.set(0, 0.95, -3.4);
  root.add(fin);
  const bands = ['#2e8b3e', '#f4f1e8', '#c8232b'];
  bands.forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.15), mat(c, 0.2));
    b.position.set(0, 1.5, -4.2 - i * 0.15);
    root.add(b);
  });
  const stab = withOutline(new THREE.Mesh(wingGeometry(4.0, 0.95, 0.12), red), 0.02);
  stab.position.set(0, 1.9, -4.0);
  root.add(stab);

  return { root, prop, propDisc };
}

// ------------------------------------------------------------------ flight

const WAYPOINTS: [number, number, number][] = [
  [0, 150, 70],
  [420, -320, 110],
  [460, -1050, 85],
  [-150, -1330, 140],
  [-700, -1520, 105],
  [-1320, -1080, 170],
  [-1560, -420, 80],
  [-1100, 180, 75],
  [-620, 1120, 190],
  [0, 980, 65],
  [720, 1180, 120],
  [1320, 420, 85],
  [1520, -320, 140],
  [1080, -1150, 230],
  [560, -150, 95],
];

export interface FlightState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  speed: number;
  bank: number;
}

export class FlightPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  private readonly alt: Float32Array;
  private readonly samples = 3000;
  readonly speed = 44;
  private bank = 0;
  private dist = 0;
  readonly state: FlightState = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    speed: 44,
    bank: 0,
  };

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      WAYPOINTS.map(([x, z, y]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
    );
    this.length = this.curve.getLength();
    // terrain-aware altitude profile with limited climb rate
    const n = this.samples;
    const ds = this.length / n;
    const alt = new Float32Array(n);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.curve.getPointAt(i / n, p);
      let hmax = -10;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        hmax = Math.max(hmax, terrainHeight(p.x + Math.cos(a) * 45, p.z + Math.sin(a) * 45));
      }
      hmax = Math.max(hmax, terrainHeight(p.x, p.z));
      alt[i] = Math.max(p.y, hmax + 45);
    }
    const slope = 0.22 * ds;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n * 2; i++) {
        const a = i % n;
        const b = (i + 1) % n;
        alt[b] = Math.max(alt[b], alt[a] - slope);
      }
      for (let i = n * 2; i > 0; i--) {
        const a = i % n;
        const b = (i - 1 + n) % n;
        alt[b] = Math.max(alt[b], alt[a] - slope);
      }
    }
    // moving average for silky transitions
    const out = new Float32Array(n);
    const w = 40;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += alt[(i + k + n) % n];
      out[i] = s / (w * 2 + 1);
    }
    this.alt = out;
  }

  /** Arc-length travelled along the loop so far. */
  get distance(): number {
    return this.dist;
  }

  private altitudeAt(u: number): number {
    const f = (((u % 1) + 1) % 1) * this.samples;
    const i = Math.floor(f);
    const t = f - i;
    return this.alt[i % this.samples] * (1 - t) + this.alt[(i + 1) % this.samples] * t;
  }

  /** Pose at arc-length distance `d` (without smoothing state). */
  sample(d: number, out: THREE.Vector3): THREE.Vector3 {
    const u = (((d / this.length) % 1) + 1) % 1;
    this.curve.getPointAt(u, out);
    out.y = this.altitudeAt(u);
    return out;
  }

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  update(dt: number, time: number): FlightState {
    this.dist += this.speed * dt;
    const s = this.state;
    const p0 = this.sample(this.dist - 12, this.tmpA);
    const p1 = this.sample(this.dist, s.position);
    const p2 = this.sample(this.dist + 12, this.tmpB);
    const fwd = this.tmpC.subVectors(p2, p0).normalize();
    // yaw rate from horizontal heading change -> coordinated-turn bank
    const h0 = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const h1 = Math.atan2(p2.x - p1.x, p2.z - p1.z);
    let dh = h1 - h0;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    const yawRate = dh / (12 / this.speed);
    const targetBank = THREE.MathUtils.clamp(Math.atan((this.speed * yawRate) / 9.81), -0.9, 0.9);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 1.6);
    const wobble = Math.sin(time * 0.8) * 0.03 + Math.sin(time * 1.9 + 1.3) * 0.015;
    s.bank = this.bank + wobble;
    s.position.y += Math.sin(time * 0.9) * 0.5 + Math.sin(time * 2.3) * 0.15;

    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, fwd).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    // roll around forward axis (negative so the plane leans into the turn)
    up.applyAxisAngle(fwd, -s.bank);
    right.crossVectors(up, fwd).normalize();
    s.forward.copy(fwd);
    s.up.copy(up);
    s.right.copy(right);
    this.m.makeBasis(right, up, fwd);
    s.quaternion.setFromRotationMatrix(this.m);
    return s;
  }
}
