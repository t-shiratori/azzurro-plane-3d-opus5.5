import * as THREE from 'three';
import { atmosphereGLSL, globalUniforms, noiseGLSL } from '../shaders/common';

/**
 * Painted sky dome: gradient, glowing sun, and a drifting layer of
 * high-altitude cirrus / altocumulus strokes.
 */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...globalUniforms },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${noiseGLSL}
      ${atmosphereGLSL}
      varying vec3 vDir;

      float cirrus(vec2 uv) {
        // wind-stretched streaks
        vec2 q = vec2(uv.x * 0.55, uv.y * 1.6);
        float w = fbm2(q * 0.9 + vec2(uTime * 0.004, 0.0));
        float s = fbm2(q * 2.2 + w * 1.4 + vec2(uTime * 0.006, 3.1));
        return smoothstep(0.08, 0.65, s * 0.8 + w * 0.5);
      }

      float altocumulus(vec2 uv) {
        vec2 p = uv * 3.2 + vec2(uTime * 0.008, 0.0);
        float base = smoothstep(0.1, 0.55, fbm2(uv * 0.7 + 10.0));
        float cells = snoise(p) * 0.5 + snoise(p * 2.1 + 4.0) * 0.3;
        return smoothstep(0.2, 0.5, cells) * base;
      }

      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyBase(dir);
        float y = dir.y;
        float s = max(dot(dir, uSunDir), 0.0);

        if (y > 0.0) {
          vec2 uv = dir.xz / (y + 0.12);
          float horizonFade = smoothstep(0.02, 0.25, y) * (1.0 - 0.75 * smoothstep(0.45, 0.95, y));
          float c1 = cirrus(uv * 0.8) * horizonFade;
          float c2 = altocumulus(uv * 0.9 + 3.0) * horizonFade * 0.8;
          vec3 cloudCol = mix(vec3(0.86, 0.9, 1.0), vec3(1.25, 1.15, 1.0), pow(s, 4.0));
          col = mix(col, cloudCol, c1 * 0.42);
          col = mix(col, cloudCol * 1.02, c2 * 0.55);
        }

        // sun disc + glow (HDR so the post pipeline can grab it for bloom and rays)
        float disc = smoothstep(0.99955, 0.99975, s);
        col += uSunColor * (disc * 40.0 + pow(s, 900.0) * 6.0 + pow(s, 120.0) * 0.6);

        // below horizon: haze that meets the ocean fog
        if (y < 0.0) col = fogColor(dir);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
