import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FlightPath, FlightState } from '../world/plane';
import { terrainHeight } from '../world/terrain';

interface ShotContext {
  s: FlightState;
  fwdH: THREE.Vector3;
  rightH: THREE.Vector3;
  t: number;
  elapsed: number;
}

interface ShotResult {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  up?: THREE.Vector3;
  fov: number;
  /** Follow stiffness (higher = tighter). */
  stiffness: number;
}

interface Shot {
  name: string;
  duration: number;
  begin?(ctx: ShotContext): void;
  frame(ctx: ShotContext): ShotResult;
}

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Director {
  mode: 'auto' | 'free' = 'auto';
  private shots: Shot[];
  private index = 0;
  private elapsed = 0;
  private snap = true;
  private readonly controls: OrbitControls;
  private readonly prevPlane = new THREE.Vector3();
  private readonly lookSmoothed = new THREE.Vector3();
  private readonly upSmoothed = new THREE.Vector3(0, 1, 0);
  private readonly fwdH = new THREE.Vector3();
  private readonly rightH = new THREE.Vector3();
  onShotChange: (name: string) => void = () => {};

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly path: FlightPath,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 400;
    this.controls.enablePan = false;
    this.shots = this.buildShots();
  }

  private buildShots(): Shot[] {
    const path = this.path;
    const fixed = V();
    const drift = V();
    let side = 1;
    return [
      {
        name: 'Chase — 追走',
        duration: 13,
        frame: ({ s, fwdH, rightH, t }) => ({
          pos: V()
            .copy(s.position)
            .addScaledVector(fwdH, -24)
            .addScaledVector(rightH, 7 + Math.sin(t * 0.2) * 4)
            .addScaledVector(UP, 4.5 + Math.sin(t * 0.13) * 2),
          look: V().copy(s.position).addScaledVector(s.forward, 14),
          fov: 50,
          stiffness: 2.5,
        }),
      },
      {
        name: 'Horizon — 水平線',
        duration: 14,
        begin: ({ s, fwdH, rightH }) => {
          this.pickSpot(fixed, s.position, (c) => {
            side = Math.random() < 0.5 ? -1 : 1;
            c.copy(s.position)
              .addScaledVector(rightH, (420 + Math.random() * 250) * side)
              .addScaledVector(fwdH, 250 + Math.random() * 300);
            c.y = 14 + Math.random() * 30;
          });
          drift.copy(fwdH).multiplyScalar(6);
        },
        frame: ({ s, elapsed }) => ({
          pos: V().copy(fixed).addScaledVector(drift, elapsed),
          look: V().copy(s.position),
          fov: 17,
          stiffness: 30,
        }),
      },
      {
        name: 'Wingman — 僚機',
        duration: 13,
        begin: () => {
          side = Math.random() < 0.5 ? -1 : 1;
        },
        frame: ({ s, fwdH, rightH, t }) => ({
          pos: V()
            .copy(s.position)
            .addScaledVector(rightH, 30 * side)
            .addScaledVector(fwdH, 4 + Math.sin(t * 0.3) * 6)
            .addScaledVector(UP, 2 + Math.sin(t * 0.21) * 3),
          look: V().copy(s.position).addScaledVector(s.forward, 3),
          fov: 38,
          stiffness: 2,
        }),
      },
      {
        name: 'Fly-by — 通過',
        duration: 11,
        begin: ({ s, rightH }) => {
          this.pickSpot(fixed, s.position, (c) => {
            side = Math.random() < 0.5 ? -1 : 1;
            path.sample(path.speed * (5 + Math.random() * 3) + path.distance, c);
            c.addScaledVector(rightH, (28 + Math.random() * 25) * side);
            c.y -= 8 + Math.random() * 18;
          });
        },
        frame: ({ s }) => ({
          pos: V().copy(fixed),
          look: V().copy(s.position),
          fov: 42,
          stiffness: 30,
        }),
      },
      {
        name: 'Cockpit — 操縦席',
        duration: 12,
        frame: ({ s }) => ({
          pos: V()
            .copy(s.position)
            .addScaledVector(s.forward, -10.5)
            .addScaledVector(s.up, 3.9)
            .addScaledVector(s.right, 2.2),
          look: V().copy(s.position).addScaledVector(s.forward, 40).addScaledVector(s.up, 2),
          up: s.up,
          fov: 62,
          stiffness: 14,
        }),
      },
      {
        name: 'Seascape — 碧い海',
        duration: 13,
        frame: ({ s, fwdH, rightH, elapsed }) => ({
          pos: V()
            .copy(s.position)
            .addScaledVector(UP, 95 + elapsed * 3)
            .addScaledVector(fwdH, -70 + elapsed * 2)
            .addScaledVector(rightH, 45),
          look: V().copy(s.position).addScaledVector(s.forward, 30),
          fov: 50,
          stiffness: 1.6,
        }),
      },
      {
        name: 'Head-on — 正面',
        duration: 10,
        frame: ({ s, fwdH, rightH, t }) => ({
          pos: V()
            .copy(s.position)
            .addScaledVector(fwdH, 30)
            .addScaledVector(rightH, 6 + Math.sin(t * 0.4) * 3)
            .addScaledVector(UP, 1.5),
          look: V().copy(s.position).addScaledVector(s.forward, -3),
          fov: 45,
          stiffness: 3,
        }),
      },
      {
        name: 'Sea level — 波間',
        duration: 11,
        begin: ({ s }) => {
          this.pickSpot(fixed, s.position, (c) => {
            side = Math.random() < 0.5 ? -1 : 1;
            path.sample(path.speed * (6 + Math.random() * 5) + path.distance, c);
            c.addScaledVector(this.rightH, (30 + Math.random() * 40) * side);
            c.y = 3.2;
          });
        },
        frame: ({ s }) => ({
          pos: V().copy(fixed),
          look: V().copy(s.position),
          fov: 55,
          stiffness: 30,
        }),
      },
    ];
  }

  get shotNames(): string[] {
    return this.shots.map((s) => s.name);
  }

  next() {
    this.select((this.index + 1) % this.shots.length);
  }

  select(i: number) {
    this.setMode('auto');
    this.index = i;
    this.elapsed = 0;
    this.snap = true;
  }

  setMode(mode: 'auto' | 'free') {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      this.camera.up.set(0, 1, 0);
      this.controls.target.copy(this.prevPlane);
      this.onShotChange('Free camera — 自由視点');
    } else {
      this.snap = true;
      this.elapsed = 0;
    }
  }

  update(dt: number, t: number, s: FlightState) {
    this.fwdH.set(s.forward.x, 0, s.forward.z).normalize();
    this.rightH.crossVectors(UP, this.fwdH).normalize();

    if (this.mode === 'free') {
      const delta = V().subVectors(s.position, this.prevPlane);
      this.camera.position.add(delta);
      this.controls.target.copy(s.position);
      this.controls.update();
      this.keepAboveGround(this.camera.position);
      this.prevPlane.copy(s.position);
      return;
    }
    this.prevPlane.copy(s.position);

    this.elapsed += dt;
    let shot = this.shots[this.index];
    if (this.elapsed > shot.duration) {
      this.index = (this.index + 1) % this.shots.length;
      this.elapsed = 0;
      this.snap = true;
      shot = this.shots[this.index];
    }
    const ctx: ShotContext = { s, fwdH: this.fwdH, rightH: this.rightH, t, elapsed: this.elapsed };
    if (this.snap) {
      shot.begin?.(ctx);
      this.onShotChange(shot.name);
    }
    const r = shot.frame(ctx);
    this.keepAboveGround(r.pos);
    const k = this.snap ? 1 : 1 - Math.exp(-r.stiffness * dt);
    this.camera.position.lerp(r.pos, k);
    this.keepAboveGround(this.camera.position);
    this.lookSmoothed.lerp(r.look, this.snap ? 1 : 1 - Math.exp(-8 * dt));
    this.upSmoothed.lerp(r.up ?? UP, this.snap ? 1 : 1 - Math.exp(-6 * dt)).normalize();
    this.camera.up.copy(this.upSmoothed);
    this.camera.lookAt(this.lookSmoothed);
    if (Math.abs(this.camera.fov - r.fov) > 0.01) {
      this.camera.fov = this.snap
        ? r.fov
        : THREE.MathUtils.lerp(this.camera.fov, r.fov, 1 - Math.exp(-3 * dt));
      this.camera.updateProjectionMatrix();
    }
    this.snap = false;
  }

  /** Try candidate camera spots until one sits over open water with a clear view of the plane. */
  private pickSpot(
    out: THREE.Vector3,
    target: THREE.Vector3,
    candidate: (c: THREE.Vector3) => void,
  ) {
    const c = V();
    const q = V();
    for (let attempt = 0; attempt < 24; attempt++) {
      candidate(c);
      let ok =
        terrainHeight(c.x, c.z) < -2 &&
        terrainHeight(c.x + 15, c.z) < 0 &&
        terrainHeight(c.x, c.z + 15) < 0;
      for (let i = 1; ok && i < 16; i++) {
        q.lerpVectors(c, target, i / 16);
        if (terrainHeight(q.x, q.z) > q.y - 4) ok = false;
      }
      out.copy(c);
      if (ok) return;
    }
  }

  private keepAboveGround(p: THREE.Vector3) {
    const g = Math.max(terrainHeight(p.x, p.z) + 8, 2.5);
    if (p.y < g) p.y = g;
  }
}
