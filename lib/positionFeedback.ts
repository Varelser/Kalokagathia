import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { ParticleData } from '../components/particleData';
import { PHYSICS_LOGIC } from '../components/scenePhysicsLogic';

/**
 * Position feedback (free-wiring stage 4, method C) for the standard
 * layer path. The design first chose WebGL2 transform feedback, but a
 * prototype on the target machine showed three.js offers no supported
 * route to feed TF output buffers back into managed geometry, so the
 * shipped implementation uses the pre-approved fallback: a texture
 * ping-pong shadow simulation, the same pattern as the GPGPU system.
 *
 * A fragment pass re-evaluates the layer's full position stack (the
 * shared PHYSICS_LOGIC, fed by data textures packed from the particle
 * arrays) and mixes the result with the previous frame's stored
 * positions: final = mix(evaluated, prev, feedback), then a decay pull
 * toward the stack input. The point vertex shader applies the same mix
 * against the stored texture, so feedback is coherent in layer space
 * (spin / audio warp still apply afterwards, as before).
 *
 * Known approximations of the shadow pass: audio-reactive terms are
 * zeroed, and the stored positions are the layer-function results —
 * the same space the visible shader mixes in. Deterministic exports
 * suppress feedback entirely (the manager sets the flag below).
 */

let detSuppressed = false;
export function setPositionFeedbackSuppressed(value: boolean): void {
  detSuppressed = value;
}
export function isPositionFeedbackSuppressed(): boolean {
  return detSuppressed;
}

const SHARED_UNIFORM_KEYS = [
  'uTime', 'uGlobalSpeed', 'uGlobalAmp', 'uGlobalFreq', 'uGlobalRadius',
  'uGlobalNoiseScale', 'uGlobalComplexity', 'uGlobalEvolution', 'uGlobalFidelity',
  'uGlobalOctaveMult', 'uFluidForce', 'uViscosity', 'uWind', 'uAffectPos',
  'uResistance', 'uMoveWithWind', 'uNeighborForce', 'uCollisionMode',
  'uCollisionRadius', 'uRepulsion', 'uGravity', 'uBoundaryY', 'uBoundaryEnabled',
  'uBoundaryBounce', 'uInterLayerEnabled', 'uInterLayerColliderCount',
  'uInterLayerColliders', 'uInterLayerStrength', 'uInterLayerPadding',
  'uEmitterOrbitSpeed', 'uEmitterOrbitRadius', 'uEmitterPulseAmount',
  'uMotionChainType2', 'uMotionChainType3', 'uMotionRouteType',
  'uMotionRouteChainType2', 'uMotionRouteChainType3', 'uRouteSpeed', 'uRouteAmp',
  'uRouteFreq', 'uRouteWind', 'uRouteNoiseScale', 'uRouteEvolution',
  'uRouteComplexity', 'uRouteFluidForce', 'uRouteViscosity', 'uRouteFidelity',
  'uRouteOctaveMult', 'uGraphSteps', 'uGraphStepCount', 'uDagNodes',
  'uDagMotions', 'uDagNodeCount', 'uDagOutput', 'uWarpEnabled', 'uWarpAmount', 'uWarpScale',
] as const;

const SIM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SIM_FRAGMENT = /* glsl */ `
  ${PHYSICS_LOGIC}
  uniform float uTime;
  uniform float uGlobalSpeed; uniform float uGlobalAmp; uniform float uGlobalFreq;
  uniform float uGlobalRadius; uniform float uGlobalNoiseScale; uniform float uGlobalComplexity;
  uniform float uGlobalEvolution; uniform float uGlobalFidelity; uniform float uGlobalOctaveMult;
  uniform float uFluidForce; uniform float uViscosity; uniform vec3 uWind;
  uniform float uAffectPos; uniform float uResistance; uniform float uMoveWithWind;
  uniform float uNeighborForce; uniform float uCollisionMode; uniform float uCollisionRadius;
  uniform float uRepulsion; uniform float uGravity;
  uniform float uBoundaryY; uniform float uBoundaryEnabled; uniform float uBoundaryBounce;
  uniform float uInterLayerEnabled; uniform int uInterLayerColliderCount;
  uniform vec4 uInterLayerColliders[MAX_INTER_LAYER_COLLIDERS];
  uniform float uInterLayerStrength; uniform float uInterLayerPadding;
  uniform float uEmitterOrbitSpeed; uniform float uEmitterOrbitRadius; uniform float uEmitterPulseAmount;
  uniform sampler2D uFbDataA; uniform sampler2D uFbDataB; uniform sampler2D uFbDataC; uniform sampler2D uFbDataD;
  uniform sampler2D uFbPrev;
  uniform float uFeedback; uniform float uFeedbackDecay; uniform float uFeedbackInit;
  varying vec2 vUv;
  void main() {
    vec4 tA = texture2D(uFbDataA, vUv);
    vec4 tB = texture2D(uFbDataB, vUv);
    vec4 tC = texture2D(uFbDataC, vUv);
    vec4 tD = texture2D(uFbDataD, vUv);
    vec3 srcPos = tA.xyz;
    float radius = tA.w * uGlobalRadius;
    vec3 off0 = tB.xyz;
    float phase = tB.w;
    float rnd = tC.x;
    float motionType = tC.y;
    float speed = tC.z * uGlobalSpeed;
    float amp = tC.w * uGlobalAmp;
    float freq = tD.x * uGlobalFreq;
    float emitterOrbitPhase = uTime * max(0.0, uEmitterOrbitSpeed);
    float emitterPulse = 1.0 + sin(uTime * max(0.05, uEmitterOrbitSpeed) * 1.6 + phase) * uEmitterPulseAmount;
    vec3 animatedOffset = off0 * emitterPulse;
    if (uEmitterOrbitRadius > 0.0 || length(off0.xz) > 0.001) {
      animatedOffset = rotate(animatedOffset, vec3(0.0, 1.0, 0.0), emitterOrbitPhase);
    }
    animatedOffset += vec3(cos(emitterOrbitPhase), sin(emitterOrbitPhase * 0.5) * 0.25, sin(emitterOrbitPhase)) * uEmitterOrbitRadius;
    vec3 evaluated = calculateLayerPosition(
      srcPos, animatedOffset, motionType, uTime,
      speed, amp, freq, radius,
      phase, rnd, uWind, uGlobalNoiseScale,
      uGlobalEvolution, uGlobalComplexity, uFluidForce, uViscosity,
      uGlobalFidelity, uGlobalOctaveMult, uAffectPos,
      uResistance, uMoveWithWind, uNeighborForce,
      uCollisionMode, uCollisionRadius, uRepulsion,
      uGravity, uBoundaryY, uBoundaryEnabled, uBoundaryBounce,
      uInterLayerEnabled, uInterLayerColliderCount, uInterLayerColliders, uInterLayerStrength,
      uInterLayerPadding
    );
    vec3 prev = texture2D(uFbPrev, vUv).xyz;
    vec3 outPos = uFeedbackInit > 0.5 ? evaluated : mix(evaluated, prev, clamp(uFeedback, 0.0, 1.0));
    outPos = mix(outPos, srcPos * radius + animatedOffset, clamp(uFeedbackDecay, 0.0, 1.0) * 0.15);
    gl_FragColor = vec4(outPos, 1.0);
  }
`;

function makeRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function packTexture(size: number, fill: (i: number, out: Float32Array, o: number) => void, count: number): THREE.DataTexture {
  const arr = new Float32Array(size * size * 4);
  for (let i = 0; i < count; i++) fill(i, arr, i * 4);
  const tex = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export class PositionFeedbackSim {
  readonly size: number;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private currentIsA = true;
  private dataTextures: THREE.DataTexture[] = [];
  private material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;
  initialized = false;

  constructor(
    data: ParticleData,
    sharedUniforms: Record<string, THREE.IUniform>,
  ) {
    this.size = Math.max(2, Math.ceil(Math.sqrt(data.count)));
    const { pos, off, d1, d2, count } = data;
    const texA = packTexture(this.size, (i, a, o) => { a[o] = pos[i * 3]; a[o + 1] = pos[i * 3 + 1]; a[o + 2] = pos[i * 3 + 2]; a[o + 3] = d1[i * 4 + 3]; }, count);
    const texB = packTexture(this.size, (i, a, o) => { a[o] = off[i * 3]; a[o + 1] = off[i * 3 + 1]; a[o + 2] = off[i * 3 + 2]; a[o + 3] = d1[i * 4]; }, count);
    const texC = packTexture(this.size, (i, a, o) => { a[o] = d1[i * 4 + 1]; a[o + 1] = d1[i * 4 + 2]; a[o + 2] = d2[i * 4]; a[o + 3] = d2[i * 4 + 1]; }, count);
    const texD = packTexture(this.size, (i, a, o) => { a[o] = d2[i * 4 + 2]; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; }, count);
    this.dataTextures = [texA, texB, texC, texD];
    this.rtA = makeRT(this.size);
    this.rtB = makeRT(this.size);
    const uniforms: Record<string, THREE.IUniform> = {};
    for (const key of SHARED_UNIFORM_KEYS) {
      if (sharedUniforms[key]) uniforms[key] = sharedUniforms[key];
    }
    uniforms.uFbDataA = { value: texA };
    uniforms.uFbDataB = { value: texB };
    uniforms.uFbDataC = { value: texC };
    uniforms.uFbDataD = { value: texD };
    uniforms.uFbPrev = { value: null };
    uniforms.uFeedback = { value: 0 };
    uniforms.uFeedbackDecay = { value: 0 };
    uniforms.uFeedbackInit = { value: 1 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get currentTexture(): THREE.Texture {
    return (this.currentIsA ? this.rtA : this.rtB).texture;
  }

  private renderPass(gl: THREE.WebGLRenderer, init: boolean): void {
    const read = this.currentIsA ? this.rtA : this.rtB;
    const write = this.currentIsA ? this.rtB : this.rtA;
    this.material.uniforms.uFbPrev.value = read.texture;
    this.material.uniforms.uFeedbackInit.value = init ? 1 : 0;
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(write);
    gl.render(this.scene, this.camera);
    gl.setRenderTarget(prevTarget);
    this.currentIsA = !this.currentIsA;
  }

  /** Run one frame. On the first call after (re)build, seed both targets with the stateless evaluation. */
  run(gl: THREE.WebGLRenderer, feedback: number, decay: number): void {
    this.material.uniforms.uFeedback.value = feedback;
    this.material.uniforms.uFeedbackDecay.value = decay;
    if (!this.initialized) {
      this.renderPass(gl, true);
      this.renderPass(gl, true);
      this.initialized = true;
      return;
    }
    this.renderPass(gl, false);
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    for (const tex of this.dataTextures) tex.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

export interface LayerFeedbackState {
  sim: PositionFeedbackSim | null;
  key: string;
  wasEnabled: boolean;
}

/**
 * Per-frame hook for a layer's particle system. Returns nothing; writes
 * the feedback uniforms into the layer's point material.
 */
export function runLayerPositionFeedback(args: {
  gl: THREE.WebGLRenderer;
  config: ParticleConfig;
  layerIndex: 2 | 3;
  data: ParticleData | null;
  geometryKey: string;
  uniforms: Record<string, THREE.IUniform>;
  material: THREE.ShaderMaterial | null | undefined;
  ghostMaterials: THREE.ShaderMaterial[] | null | undefined;
  state: LayerFeedbackState;
}): void {
  const { gl, config, layerIndex, data, geometryKey, uniforms, material, ghostMaterials, state } = args;
  const enabled = (layerIndex === 2 ? config.layer2PositionFeedbackEnabled : config.layer3PositionFeedbackEnabled)
    && !isPositionFeedbackSuppressed();
  const setMaterialFeedback = (on: boolean, tex?: THREE.Texture, size = 0) => {
    if (!material) return;
    material.uniforms.uFeedbackEnabled = { value: on ? 1 : 0 };
    material.uniforms.uFeedback = { value: layerIndex === 2 ? config.layer2PositionFeedback : config.layer3PositionFeedback };
    material.uniforms.uFeedbackDecay = { value: layerIndex === 2 ? config.layer2PositionFeedbackDecay : config.layer3PositionFeedbackDecay };
    material.uniforms.uFeedbackPrevTex = { value: tex ?? null };
    material.uniforms.uFeedbackTexSize = { value: size };
  };
  if (!enabled || !data) {
    if (state.wasEnabled) setMaterialFeedback(false);
    state.wasEnabled = false;
    if (state.sim) state.sim.initialized = false;
    return;
  }
  const key = `${geometryKey}|${data.count}`;
  if (!state.sim || state.key !== key) {
    state.sim?.dispose();
    state.sim = new PositionFeedbackSim(data, uniforms);
    state.key = key;
  }
  state.sim.run(
    gl,
    layerIndex === 2 ? config.layer2PositionFeedback : config.layer3PositionFeedback,
    layerIndex === 2 ? config.layer2PositionFeedbackDecay : config.layer3PositionFeedbackDecay,
  );
  setMaterialFeedback(true, state.sim.currentTexture, state.sim.size);
  if (ghostMaterials) {
    for (const gmat of ghostMaterials) {
      if (gmat.uniforms.uFeedbackEnabled) gmat.uniforms.uFeedbackEnabled = { value: 0 };
    }
  }
  state.wasEnabled = true;
}
