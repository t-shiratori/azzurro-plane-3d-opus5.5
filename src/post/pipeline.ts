import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SUN_DIR } from '../config';

/**
 * scene -> HDR target (with depth)
 *       -> screen-space god rays from sky pixels near the sun (half res)
 *       -> composite + bloom
 *       -> grade (warm, saturated, vignette) + tone mapping to screen
 */
export class Pipeline {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly raysRT: THREE.WebGLRenderTarget;
  private readonly compRT: THREE.WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass;
  private readonly raysQuad: FullScreenQuad;
  private readonly compQuad: FullScreenQuad;
  private readonly finalQuad: FullScreenQuad;
  private readonly raysMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  private readonly finalMat: THREE.ShaderMaterial;
  private readonly sunWorld = new THREE.Vector3();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
    });
    this.raysRT = new THREE.WebGLRenderTarget(size.x / 2, size.y / 2, {
      type: THREE.HalfFloatType,
    });
    this.compRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });

    this.raysMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uStrength: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uSun;
        uniform float uStrength;
        uniform float uAspect;
        varying vec2 vUv;
        const int SAMPLES = 72;

        vec3 source(vec2 uv) {
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
          float d = texture2D(tDepth, uv).r;
          if (d < 0.99999) return vec3(0.0);
          vec3 c = texture2D(tColor, uv).rgb;
          vec2 dv = (uv - uSun) * vec2(uAspect, 1.0);
          float halo = exp(-dot(dv, dv) * 9.0);
          return max(c - 0.75, 0.0) * halo + c * halo * 0.12;
        }

        void main() {
          if (uStrength <= 0.0) { gl_FragColor = vec4(0.0); return; }
          vec2 delta = (vUv - uSun) / float(SAMPLES) * 0.92;
          vec2 uv = vUv;
          float decay = 1.0;
          vec3 acc = vec3(0.0);
          float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
          uv -= delta * jitter;
          for (int i = 0; i < SAMPLES; i++) {
            acc += source(uv) * decay;
            decay *= 0.968;
            uv -= delta;
          }
          gl_FragColor = vec4(acc / float(SAMPLES) * uStrength, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.raysQuad = new FullScreenQuad(this.raysMat);

    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tRays: { value: null } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tRays;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          vec3 r = texture2D(tRays, vUv).rgb;
          gl_FragColor = vec4(c + r * vec3(1.0, 0.93, 0.78), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compQuad = new FullScreenQuad(this.compMat);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.5, 1.1);

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(size.x, size.y) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform float uTime;
        uniform vec2 uRes;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          // painterly grade: a touch more saturation, warm highlights, cool shadows
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.12);
          c *= mix(vec3(0.97, 0.99, 1.05), vec3(1.04, 1.01, 0.96), smoothstep(0.1, 0.9, l));
          // soft vignette
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.55;
          // very faint paper grain
          float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
          c += (g - 0.5) * 0.012;
          gl_FragColor = vec4(max(c, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
  }

  setSize(w: number, h: number) {
    this.sceneRT.setSize(w, h);
    this.raysRT.setSize(Math.max(1, w / 2), Math.max(1, h / 2));
    this.compRT.setSize(w, h);
    this.bloom.setSize(w, h);
    this.finalMat.uniforms.uRes.value.set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // sun position on screen
    this.sunWorld.copy(SUN_DIR).multiplyScalar(10000).add(camera.position);
    const sp = this.sunWorld.clone().project(camera);
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const facing = camDir.dot(SUN_DIR);
    const u = this.raysMat.uniforms;
    u.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
    u.uStrength.value = facing > 0 ? (1 - THREE.MathUtils.smoothstep(off, 0.9, 2.2)) * 1.1 : 0;
    u.uAspect.value = camera.aspect;
    u.tColor.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    r.setRenderTarget(this.raysRT);
    this.raysQuad.render(r);

    this.compMat.uniforms.tColor.value = this.sceneRT.texture;
    this.compMat.uniforms.tRays.value = this.raysRT.texture;
    r.setRenderTarget(this.compRT);
    this.compQuad.render(r);

    this.bloom.render(r, this.compRT, this.compRT, 0, false);

    this.finalMat.uniforms.tColor.value = this.compRT.texture;
    this.finalMat.uniforms.uTime.value = time;
    r.setRenderTarget(null);
    this.finalQuad.render(r);
  }
}
