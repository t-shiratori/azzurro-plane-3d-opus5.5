import * as THREE from 'three';

/** Direction pointing *towards* the sun. Late-morning sun, fairly low for long light shafts. */
export const SUN_DIR = new THREE.Vector3()
  .setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 27), THREE.MathUtils.degToRad(-38))
  .normalize();

/** Horizontal wind (m/s) that drifts clouds, birds and wave detail. */
export const WIND = new THREE.Vector2(3.2, 1.1);

/** Half size of the square world region where islands live. */
export const WORLD_HALF = 3200;

export const PALETTE = {
  skyZenith: '#1f5cc4',
  skyMid: '#4f95e3',
  skyHorizon: '#cfe7f3',
  sun: '#fff0d2',
  seaDeep: '#0b3a78',
  seaMid: '#155fa5',
  seaTurquoise: '#12a8b4',
  seaShallow: '#7fe3cf',
  cloudLit: '#fffaf1',
  cloudShade: '#9aa8d4',
  cloudDark: '#6f7db2',
  shadowTint: '#5f6fb0',
} as const;

export const color = (hex: string): THREE.Color => new THREE.Color(hex);

const params = new URLSearchParams(location.search);
export const QUALITY: 'low' | 'high' = params.get('q') === 'low' ? 'low' : 'high';
