import * as THREE from 'three';
import { DM_HASH11_GLSL } from '../lib/gpgpuRandom';
import {
  REP_PREY_FUNCTION_LINES,
  REP_PREY_MAIN_LINES,
} from '../lib/gpgpuParticleRulesLive';

/**
 * Predation hold pass (Grammar 2.0 stage 2, slice B6
 * follow-up): the accumulation supply behind the REP's
 * `predhold` condition variable — for each particle, the
 * number of CONSECUTIVE rule evaluations for which the
 * predation strike condition (pred >= the resolved strike)
 * has held. The generated prey rule reads `predhold >=
 * strikeFrames` instead of the instantaneous `pred >=
 * strike` while gpgpuPredationStrikeFrames is above its
 * default of 1 (lib/gpgpuPredation.ts buildPredationRules).
 *
 * The pass is the contact pass's sibling in discipline
 * (components/gpgpuContactPass.ts): a dedicated ping-pong
 * pair of RGBA float targets (.r = the hold count, raw and
 * saturating at 255; .g = the age it saw, for the respawn
 * reset test), standing only while a live condition reads
 * `predhold`, driven by the wiring on REP evaluation frames
 * immediately before the REP itself, and reset whenever the
 * REP is rebuilt. Per step (the CPU twin is predationHoldStep
 * in lib/gpgpuPredation.ts):
 *
 *   - a respawn restarts the count (the age going backwards
 *     is the reset test, exactly the contact discipline);
 *   - the activation grace window (uTime < uGraceUntil)
 *     holds the count at zero, so counting starts fresh
 *     when the window ends;
 *   - a failed condition resets the count to zero;
 *   - otherwise the count increments by one, saturating.
 *
 * The neighbourhood count itself is NOT re-derived here:
 * the fragment embeds the REP's own stride-sampling supply
 * lines (REP_PREY_*_LINES in lib/gpgpuParticleRulesLive.ts,
 * imported — never copied), so the hold pass and the REP
 * count `pred` by literally the same GLSL. Parked particles
 * (y = -99999) are out of every range on both sides, so
 * their count reads 0 and their hold resets, as in the twin
 * predationNeighborhood.
 *
 * WebGL route only, like the REP it feeds: the variable has
 * no WGSL home, so a config reading it routes to WebGL
 * through the capability registry (see liveConditionWgsl).
 */

const HOLD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HOLD_INIT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  // No holds yet, no age seen.
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
}
`;

const HOLD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPosTex;
uniform sampler2D uPrevTex;
uniform float uPreyTexSizeF;
uniform int uPreySpecies;
uniform float uPreyRange;
uniform float uStrikeF;
uniform float uGraceUntil;
uniform float uTime;
${DM_HASH11_GLSL.trimEnd()}
${REP_PREY_FUNCTION_LINES.join('\n')}
void main() {
${REP_PREY_MAIN_LINES.join('\n')}
  vec4 prevData = texture2D(uPrevTex, vUv);
  float acc = prevData.r;
  float simAge = texture2D(uPosTex, vUv).w;
  if (simAge < prevData.g) acc = 0.0;
  if (uTime < uGraceUntil) {
    acc = 0.0;
  } else if (simPred >= uStrikeF) {
    acc = min(acc + 1.0, 255.0);
  } else {
    acc = 0.0;
  }
  gl_FragColor = vec4(acc, simAge, 0.0, 0.0);
}
`;

export interface GpgpuPredationHoldBindings {
  /** Current position texture (frame-start positions). */
  posTex: THREE.Texture;
  /** Resolved predation species count (lib/gpgpuPredation.ts). */
  species: number;
  /** Resolved encounter range (vision range / radius fallback). */
  range: number;
  /** Resolved strike: sampled predators required per step. */
  strike: number;
  /** Sim time at which the activation grace window ends. */
  graceUntil: number;
  /** Current sim time. */
  time: number;
}

function makeTarget(texSize: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(texSize, texSize, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class GpgpuPredationHoldPass {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private initMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private mesh: THREE.Mesh;
  /** The target holding the latest step's record. */
  private current: THREE.WebGLRenderTarget;
  private initialised = false;

  constructor(texSize: number) {
    this.rtA = makeTarget(texSize);
    this.rtB = makeTarget(texSize);
    this.current = this.rtA;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null as THREE.Texture | null },
        uPrevTex: { value: null as THREE.Texture | null },
        uPreyTexSizeF: { value: texSize },
        uPreySpecies: { value: 4 },
        uPreyRange: { value: 120 },
        uStrikeF: { value: 1 },
        uGraceUntil: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: HOLD_VERT,
      fragmentShader: HOLD_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.initMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: HOLD_VERT,
      fragmentShader: HOLD_INIT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private renderTo(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, mat: THREE.ShaderMaterial): void {
    this.mesh.material = mat;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    this.mesh.material = this.mat;
  }

  /** Write the empty record into both targets. */
  reset(gl: THREE.WebGLRenderer): void {
    this.renderTo(gl, this.rtA, this.initMat);
    this.renderTo(gl, this.rtB, this.initMat);
    this.current = this.rtA;
    this.initialised = true;
  }

  /**
   * Accumulate one evaluation step: read the current
   * record, write the other target, and return the texture
   * holding the new record (what the REP binds as
   * uPredHoldTex).
   */
  run(gl: THREE.WebGLRenderer, bindings: GpgpuPredationHoldBindings): THREE.Texture {
    if (!this.initialised) this.reset(gl);
    const read = this.current;
    const write = read === this.rtA ? this.rtB : this.rtA;
    const u = this.mat.uniforms;
    u.uPosTex.value = bindings.posTex;
    u.uPrevTex.value = read.texture;
    u.uPreySpecies.value = bindings.species;
    u.uPreyRange.value = bindings.range;
    u.uStrikeF.value = bindings.strike;
    u.uGraceUntil.value = bindings.graceUntil;
    u.uTime.value = bindings.time;
    this.renderTo(gl, write, this.mat);
    this.current = write;
    return write.texture;
  }

  /** The latest step's record texture (zeros before any run). */
  get texture(): THREE.Texture {
    return this.current.texture;
  }

  /** The target holding the latest record. */
  get currentTarget(): THREE.WebGLRenderTarget {
    return this.current;
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.mat.dispose();
    this.initMat.dispose();
    this.geo.dispose();
  }
}
