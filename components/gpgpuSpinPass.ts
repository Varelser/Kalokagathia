import * as THREE from 'three';
import type { ResolvedSpin } from '../lib/gpgpuSpeedDragSpin';

/**
 * Spin channel pass (Grammar 2.0 stage 2, B3).
 *
 * The stage's one accumulated-state channel (design §1,
 * judgment 1's stated exception): angle and angular velocity
 * cannot ride the attribute slots — a slot is an instantaneous
 * value, not an integral — so they live in a dedicated
 * ping-pong render-target pair, one texel per particle:
 *
 *   .x  angle, radians, wrapped to [0, 2π)
 *   .y  angular velocity, rad/s
 *   .z  the texel's phase hash (diagnostics / future use)
 *   .w  1
 *
 * Step law (CPU twin: spinStep / spinInitialState in
 * lib/gpgpuSpeedDragSpin.ts):
 *   - reset (first run after construction, or — while the age
 *     system is on — the frame a particle's age wraps back to
 *     ~0, the morph kick's respawn test): angle = phase · 2π
 *     (the geometry spin's phase convention), omega = base
 *     rate × per-particle hash multiplier.
 *   - otherwise: omega decays by the damping rate, then the
 *     angle advances by omega · slotFactor · dt. The slot
 *     factor (judgment 1) multiplies the INCREMENT only and
 *     never enters the state, so a per-frame slot change
 *     cannot compound into the accumulated omega.
 *
 * The consumers are the draw side's two rotation systems
 * (points sprite rotation, instanced-geometry self-rotation):
 * while the channel stands, their variant strings read .x in
 * place of their analytic closed forms.
 *
 * Lifecycle mirrors GpgpuAttrFeedbackPass: the scene builds
 * the pass only while the channel is enabled, rebuilds it
 * when the signature (enabled / texSize) changes, and
 * disposes it otherwise. The returned texture is stable
 * between runs (consumers hold it like the feedback pass's
 * output). Without the age system there is no per-particle
 * reset — the angle accumulates from the pass's first run,
 * the same envelope the analytic uTime spin had (it also
 * never reset).
 */
const SPIN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SPIN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrevTex;
uniform sampler2D uPosTex;
uniform sampler2D uAttrTex;
uniform bool uAttrEnabled;
uniform bool uAgeEnabled;
uniform bool uResetAll;
uniform float uDelta;
uniform float uSpinSpeed;
uniform float uSpinRandom;
uniform float uSpinDamping;
uniform int uSpinSlot;

// Attribute channel picker (Phase AK): an identical copy
// lives in the velocity helpers / points shader.
float kaloAttrChannel(vec4 a, int slot) {
  if (slot == 0) return a.r;
  if (slot == 1) return a.g;
  if (slot == 2) return a.b;
  return a.a;
}

// The texel phase hash (the GEOM_VERT phase hash form; TS
// twin spinPhaseHash in lib/gpgpuSpeedDragSpin.ts).
float kaloSpinPhase(vec2 uv) {
  vec3 p3 = fract(vec3(uv.x * 127.1 + uv.y * 311.7) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// The per-particle speed multiplier hash (the GEOM_VERT
// spinHash2 form, at the +19.19 / +7.77 offset; TS twin
// spinSpeedHash in lib/gpgpuSpeedDragSpin.ts).
float kaloSpinSpeedHash(vec2 uv) {
  vec3 p3 = fract(vec3((uv.x + 19.19) * 127.1 + (uv.y + 7.77) * 311.7) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float phase = kaloSpinPhase(vUv);
  float mul = uSpinRandom > 0.0
    ? mix(1.0 - uSpinRandom, 1.0 + uSpinRandom, kaloSpinSpeedHash(vUv))
    : 1.0;
  float age = texture2D(uPosTex, vUv).w;
  bool reset = uResetAll || (uAgeEnabled && age < uDelta * 1.5);
  float angle;
  float omega;
  if (reset) {
    angle = phase * 6.2831853;
    omega = uSpinSpeed * mul;
  } else {
    vec4 prev = texture2D(uPrevTex, vUv);
    float slotFactor = 1.0;
    if (uAttrEnabled && uSpinSlot >= 0) {
      slotFactor = max(kaloAttrChannel(texture2D(uAttrTex, vUv), uSpinSlot), 0.0);
    }
    omega = prev.y * exp(-uSpinDamping * uDelta);
    angle = mod(prev.x + omega * slotFactor * uDelta, 6.2831853);
  }
  gl_FragColor = vec4(angle, omega, phase, 1.0);
}
`;

export interface GpgpuSpinPassRunArgs {
  /** Current position texture (its .w is the particle age). */
  posTex: THREE.Texture | null;
  /** Final attribute texture, or null while no slot consumer
   *  stands (the slot factor then stays exactly 1). */
  attrTex: THREE.Texture | null;
  /** Age system on — gates the per-particle respawn reset. */
  ageEnabled: boolean;
  dt: number;
  spin: ResolvedSpin;
}

export class GpgpuSpinPass {
  private rts: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIdx = 0;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private hasState = false;

  constructor(texSize: number) {
    const makeRt = () => new THREE.WebGLRenderTarget(texSize, texSize, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.rts = [makeRt(), makeRt()];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPrevTex: { value: null as THREE.Texture | null },
        uPosTex: { value: null as THREE.Texture | null },
        uAttrTex: { value: null as THREE.Texture | null },
        uAttrEnabled: { value: false },
        uAgeEnabled: { value: false },
        uResetAll: { value: true },
        uDelta: { value: 0 },
        uSpinSpeed: { value: 0 },
        uSpinRandom: { value: 0 },
        uSpinDamping: { value: 0 },
        uSpinSlot: { value: -1 },
      },
      vertexShader: SPIN_VERT,
      fragmentShader: SPIN_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /**
   * Advance the spin state by one step and return the texture
   * consumers should read. The first run after construction
   * resets every texel to its initial state (uResetAll), so no
   * clear / copy pass is needed.
   */
  run(gl: THREE.WebGLRenderer, args: GpgpuSpinPassRunArgs): THREE.Texture {
    const writeIdx = this.readIdx === 0 ? 1 : 0;
    const u = this.mat.uniforms;
    u.uPrevTex.value = this.hasState ? this.rts[this.readIdx].texture : null;
    u.uPosTex.value = args.posTex;
    u.uAttrTex.value = args.attrTex;
    u.uAttrEnabled.value = !!args.attrTex && args.spin.slot >= 0;
    u.uAgeEnabled.value = args.ageEnabled;
    u.uResetAll.value = !this.hasState;
    u.uDelta.value = args.dt;
    u.uSpinSpeed.value = args.spin.speedRad;
    u.uSpinRandom.value = args.spin.random;
    u.uSpinDamping.value = args.spin.damping;
    u.uSpinSlot.value = args.spin.slot;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.rts[writeIdx]);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    this.readIdx = writeIdx;
    this.hasState = true;
    return this.rts[this.readIdx].texture;
  }

  /** The render target holding the latest spin state (the
   * read side of the ping-pong). Same accessor shape as the
   * rule-eval pass's currentTarget; used by the diag hook's
   * read-only captureSpinStats. */
  get currentTarget(): THREE.WebGLRenderTarget {
    return this.rts[this.readIdx];
  }

  dispose(): void {
    this.rts[0].dispose();
    this.rts[1].dispose();
    this.mat.dispose();
    this.geo.dispose();
  }
}
