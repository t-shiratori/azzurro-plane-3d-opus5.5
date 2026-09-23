import * as THREE from 'three';
import './style.css';
import { Soundscape } from './audio';
import { Director } from './camera/director';
import { QUALITY, SUN_DIR } from './config';
import { Pipeline } from './post/pipeline';
import { globalUniforms } from './shaders/common';
import { createBirds } from './world/birds';
import { createBoats } from './world/boats';
import { createClouds } from './world/clouds';
import { createDistantCoast, createIslands } from './world/islands';
import { createOcean } from './world/ocean';
import { FlightPath, createPlaneModel } from './world/plane';
import { createSky } from './world/sky';
import { createDepthTexture } from './world/terrain';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

async function boot() {
  const status = $('#loader-status');
  const step = async (msg: string) => {
    status.textContent = msg;
    await nextFrame();
  };

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
  });
  let pixelRatio = Math.min(window.devicePixelRatio, QUALITY === 'low' ? 1 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.5,
    30000,
  );

  await step('空を塗っています… painting the sky');
  scene.add(createSky());

  await step('海底を測っています… sounding the sea');
  const depthTex = createDepthTexture();
  const ocean = createOcean(depthTex);
  scene.add(ocean.mesh);

  await step('島を彫っています… carving the islands');
  scene.add(createIslands());
  scene.add(createDistantCoast());

  await step('雲を膨らませています… puffing up the clouds');
  const clouds = createClouds();
  scene.add(clouds.group);

  await step('船を浮かべています… launching the boats');
  const boats = createBoats(ocean);
  scene.add(boats.group);
  const birds = createBirds();
  scene.add(birds.mesh);

  await step('エンジン始動… starting the engine');
  const plane = createPlaneModel();
  scene.add(plane.root);
  const flight = new FlightPath();

  const pipeline = new Pipeline(renderer);
  const director = new Director(camera, renderer.domElement, flight);
  const sound = new Soundscape();

  // --- UI
  const shotLabel = $('#shot');
  let labelTimer = 0;
  director.onShotChange = (name) => {
    shotLabel.textContent = name;
    shotLabel.classList.add('show');
    labelTimer = 3.5;
  };
  const camBtn = $<HTMLButtonElement>('#btn-camera');
  const soundBtn = $<HTMLButtonElement>('#btn-sound');
  const nextBtn = $<HTMLButtonElement>('#btn-next');
  const updateCamBtn = () => {
    camBtn.textContent = director.mode === 'auto' ? '🎥 Director' : '🖐 Free';
    camBtn.classList.toggle('active', director.mode === 'free');
  };
  camBtn.addEventListener('click', () => {
    director.setMode(director.mode === 'auto' ? 'free' : 'auto');
    updateCamBtn();
  });
  nextBtn.addEventListener('click', () => {
    director.next();
    updateCamBtn();
  });
  soundBtn.addEventListener('click', () => {
    const on = sound.toggle();
    soundBtn.textContent = on ? '♪ Sound on' : '♪ Sound off';
    soundBtn.classList.toggle('active', on);
  });
  renderer.domElement.addEventListener('pointerdown', () => {
    if (director.mode === 'auto') {
      director.setMode('free');
      updateCamBtn();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-ui');
    else if (e.key === ' ') {
      e.preventDefault();
      director.next();
      updateCamBtn();
    } else if (e.key === 'f' || e.key === 'F') camBtn.click();
    else if (e.key === 'm' || e.key === 'M') soundBtn.click();
    else if (/^[1-8]$/.test(e.key)) {
      director.select(Number(e.key) - 1);
      updateCamBtn();
    }
  });

  let lastW = -1;
  let lastH = -1;
  const onResize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (w === lastW && h === lastH && renderer.getPixelRatio() === pixelRatio) return;
    lastW = w;
    lastH = h;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    pipeline.setSize(s.x, s.y);
  };
  window.addEventListener('resize', onResize);

  // dev-only hook for inspecting the scene from the console
  const debug = { freezeCamera: false, camera, scene, boats };
  if (import.meta.env.DEV) Object.assign(window, { __azzurro: debug });

  // --- loop
  const clock = new THREE.Clock();
  let t = 0;
  const shadowVec = ocean.uniforms.uPlaneShadow.value;
  // adaptive resolution: step down if the GPU can't keep ~45fps
  let perfTime = 0;
  let perfFrames = 0;
  const adapt = (raw: number) => {
    if (raw > 0.25) return;
    perfTime += raw;
    perfFrames++;
    if (perfTime < 3) return;
    const fps = perfFrames / perfTime;
    perfTime = 0;
    perfFrames = 0;
    if (fps < 45 && pixelRatio > 0.75) pixelRatio = Math.max(0.75, pixelRatio - 0.25);
  };
  const tick = () => {
    const raw = clock.getDelta();
    adapt(raw);
    onResize();
    const dt = Math.min(raw, 1 / 20);
    t += dt;
    globalUniforms.uTime.value = t;

    const s = flight.update(dt, t);
    plane.root.position.copy(s.position);
    plane.root.quaternion.copy(s.quaternion);
    plane.prop.rotation.z += dt * 55;

    clouds.update(dt);
    boats.update(dt, t);
    birds.update(t);
    if (!debug.freezeCamera) director.update(dt, t, s);
    ocean.update(camera);

    // soft plane shadow on the sea
    const k = s.position.y / Math.max(SUN_DIR.y, 0.1);
    shadowVec.set(
      s.position.x - SUN_DIR.x * k,
      s.position.z - SUN_DIR.z * k,
      7.5,
      0.55 * (1 - THREE.MathUtils.smoothstep(s.position.y, 30, 260)),
    );

    const camDist = camera.position.distanceTo(s.position);
    sound.update(dt, 1 - THREE.MathUtils.smoothstep(camDist, 10, 400));

    if (labelTimer > 0) {
      labelTimer -= dt;
      if (labelTimer <= 0) shotLabel.classList.remove('show');
    }

    pipeline.render(scene, camera, t);
    requestAnimationFrame(tick);
  };

  // warm up shaders before revealing
  await step('幕が上がります… curtain up');
  onResize();
  director.update(0, 0, flight.update(0, 0));
  renderer.compile(scene, camera);
  pipeline.render(scene, camera, 0);
  requestAnimationFrame(tick);
  await nextFrame();
  document.body.classList.add('ready');
}

boot().catch((err: unknown) => {
  console.error(err);
  const s = document.querySelector('#loader-status');
  if (s) s.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
