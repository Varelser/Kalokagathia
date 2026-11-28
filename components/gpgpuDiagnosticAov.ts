// Diagnostic AOV renderer (Phase DA3 path B, implemented in
// Phase DH) — renders the per-particle quantities registered in
// lib/diagnosticPasses.ts (age / speed / position / velocity) as a
// point-cloud image into an offscreen target and reads it back,
// and captures the simulation state (position + velocity readback
// buffers, their encoded stats, and a content hash) for numeric
// before/after proof.
//
// Isolation contract (DA3_DESIGN §3): the normal draw path never
// uses these objects. The only entry point is the window hook
// registered by sceneGpgpuSystem when the page URL carries
// ?diag=1; without that parameter nothing here is constructed.
// Renders follow the DeterministicRenderManager pattern: renderer
// state (target, clear color) is saved and restored around the
// offscreen pass.

import * as THREE from 'three';
import {
  encodeDiagnosticPass,
  type DiagnosticPassResult,
} from '../lib/diagnosticPasses';
import type { WebGPUComputeState } from '../lib/webgpuCompute';

const AOV_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uPointSize;
varying vec4 vPosAge;
varying vec3 vVel;
void main() {
  vec4 pos = texture2D(uPosTex, aTexCoord);
  vec4 vel = texture2D(uVelTex, aTexCoord);
  vPosAge = pos;
  vVel = vel.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.xyz, 1.0);
  gl_PointSize = uPointSize;
}
`;

const AOV_FRAG = /* glsl */ `
precision highp float;
uniform int uMode;
uniform float uAgeMax;
uniform float uSpeedMax;
uniform float uExtent;
varying vec4 vPosAge;
varying vec3 vVel;
void main() {
  vec3 col;
  if (uMode == 0) {
    float a = clamp(vPosAge.w / max(uAgeMax, 0.0001), 0.0, 1.0);
    col = vec3(a);
  } else if (uMode == 1) {
    float s = clamp(length(vVel) / max(uSpeedMax, 0.0001), 0.0, 1.0);
    col = vec3(s);
  } else if (uMode == 2) {
    col = clamp(vPosAge.xyz / max(uExtent, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
  } else {
    col = clamp(vVel / max(uSpeedMax, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const PASS_MODE: Record<string, number> = {
  age: 0,
  speed: 1,
  position: 2,
  velocity: 3,
};

export interface DiagnosticFrameContext {
  posOut: THREE.WebGLRenderTarget;
  velOut: THREE.WebGLRenderTarget;
  texSize: number;
  ageMax: number;
  extent: number;
  /**
   * Phase DL: the render target holding the latest frame's
   * resolved final fluid field (64×64), or null while the
   * fluid is off. With FLIP vorticity confinement on this is
   * NOT the ping target — never resolve it from ping state.
   */
  fluidFinal: THREE.WebGLRenderTarget | null;
  /** Which member of the fluid ping pair `fluidFinal` is. */
  fluidFinalName: 'fluidRTA' | 'fluidRTB' | null;
  /**
   * Stage 0 S7 (plan A1): the execution route this frame ran
   * on. Absent on contexts built before the field existed —
   * captureState treats absence as 'webgl', the historical
   * behaviour. On the 'webgpu' route posOut/velOut above are
   * NOT advanced by the simulation (see
   * STAGE0_S7_CROWD_DIAG_ANALYSIS) and must not be read back;
   * captureState serves the WebGPU diagnostic snapshot from
   * `webgpuState` instead.
   */
  route?: 'webgl' | 'webgpu';
  /**
   * The live WebGPU compute state on the 'webgpu' route —
   * also the gate measurement support's source for position
   * readback; null on the WebGL route.
   */
  webgpuState?: WebGPUComputeState | null;
  /**
   * Gate measurement support (2026-11-27 re-gate): the REP's
   * latest output target (.b = condBits), or null while no REP
   * stood this frame.
   */
  ruleLiveTarget: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support: the contact pass's latest record
   * target (.r = hits, .g = hit), or null while the contact
   * pass does not stand.
   */
  contactTarget: THREE.WebGLRenderTarget | null;
  /** Whether the contact pass is suppressed (hit/hits read 0). */
  contactSuppressed: boolean;
  /**
   * Gate measurement support: the Aux level-1 targets holding
   * the latest written state (resolved post-flip), or null
   * while the Aux pool does not exist.
   */
  auxPosLatest: THREE.WebGLRenderTarget | null;
  auxVelLatest: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (stage-4 gate fix round 4,
   * G4-5 triage): the OTHER members of the Aux level-1
   * ping-pong pair — the sides this frame's passes read FROM
   * (resolved post-flip as .posOut / .velOut) — or null while
   * the Aux pool does not exist. Published so the diag hook's
   * captureAuxPoolProbe can read both sides of the pair from
   * the same frame and tell a stale / divergent side apart
   * from the latest one.
   */
  auxPosOther: THREE.WebGLRenderTarget | null;
  auxVelOther: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (stage-4 gate fix round 4,
   * G4-5 triage): Aux draw-binding texture identity — the
   * uuid of the texture the Aux draw material currently
   * samples (its uAuxPosTex / uAuxVelTex uniform value), and
   * whether that texture IS (object identity, resolved at
   * publish time) the latest targets' texture above. Null
   * while nothing is bound / the pool does not exist. Read
   * by captureAuxPoolProbe only.
   */
  auxDrawPosTextureUuid: string | null;
  auxDrawVelTextureUuid: string | null;
  auxDrawPosMatchesLatest: boolean | null;
  auxDrawVelMatchesLatest: boolean | null;
  /**
   * Gate measurement support (stage-4 gate fix round 5,
   * G4-5 triage): the simulation clock at publish time —
   * timeRef's current value, and the Aux shaders' tick
   * derived from it. The tick is floor(simTime * 60),
   * exactly the definition findAuxEvent / findAuxChainEvent
   * apply to their uTime uniform (gpgpuShaderAux.ts), which
   * the passes fill from this same clock. Two reads across
   * samples let the harness compare the tick increment
   * against the integrated frame dt: a tick that skips
   * residues (e.g. advancing in steps of 3 while dt is
   * clamped) starves the event test's phase gate, while a
   * tick that walks every residue exonerates the tick
   * source. Read by captureAuxSpawnPhaseStats and
   * captureAuxPassLandingStats.
   */
  simTime: number;
  simTick: number;
  /**
   * Gate measurement support (2026-11-27 re-gate 2): the Aux
   * level-1 spawn-inheritance target (single RT, the same one
   * the Aux draw material samples), or null while the slots
   * key is off / the target does not exist.
   */
  auxInheritTarget: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (2026-11-27 stage-2 confirm):
   * the Aux level-2 (chain) counterparts of the two fields
   * above — the level-2 spawn-inheritance target (the same RT
   * the Aux2 draw material samples) and the level-2 pool's
   * latest position target, or null while the chain level /
   * target does not exist.
   */
  aux2PosLatest: THREE.WebGLRenderTarget | null;
  aux2InheritTarget: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (2026-11-27 stage-2 B-group):
   * the spin channel's current state target (angle in .x),
   * or null while the spin channel does not stand. Read by
   * the diag hook's captureSpinStats only.
   */
  spinTarget: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (stage 4, G4-1): the orient
   * channel's current posture target (quaternion in .xyzw),
   * or null while the orient channel does not stand. Read by
   * the diag hook's captureOrientStats only.
   */
  orientTarget: THREE.WebGLRenderTarget | null;
  /**
   * Gate measurement support (2026-11-27 re-gate 2): the
   * WebGPU mirror position DataTexture — the texture the draw
   * actually samples on the WebGPU route, fed every frame by
   * the app's own readbackWebGPUPositions mirror. Null on the
   * WebGL route.
   */
  webgpuPosTexture: THREE.Texture | null;
}

export interface DiagnosticStateCapture {
  texSize: number;
  /** FNV-1a hash over the raw bytes of both readback buffers. */
  stateHash: string;
  passes: Record<string, DiagnosticPassResult>;
}

/** Deterministic content hash of the two simulation buffers. */
export function hashSimulationBuffers(positions: Float32Array, velocities: Float32Array): string {
  let h = 0x811c9dc5;
  const mix = (buf: Float32Array) => {
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(positions);
  mix(velocities);
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

export class DiagnosticAovRenderer {
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private points: THREE.Points;
  private scene = new THREE.Scene();
  private rt: THREE.WebGLRenderTarget | null = null;
  private rtW = 0;
  private rtH = 0;

  constructor(texSize: number) {
    const count = texSize * texSize;
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = i % texSize;
      const y = Math.floor(i / texSize);
      coords[i * 2] = (x + 0.5) / texSize;
      coords[i * 2 + 1] = (y + 0.5) / texSize;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    // The vertex shader positions come from the texture, but three
    // still needs a position attribute for the draw count.
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: AOV_VERT,
      fragmentShader: AOV_FRAG,
      uniforms: {
        uPosTex: { value: null },
        uVelTex: { value: null },
        uPointSize: { value: 2 },
        uMode: { value: 0 },
        uAgeMax: { value: 1 },
        uSpeedMax: { value: 1 },
        uExtent: { value: 150 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  capture(
    gl: THREE.WebGLRenderer,
    camera: THREE.Camera,
    ctx: DiagnosticFrameContext,
    passId: string,
    opts: { width: number; height: number; speedMax: number; pointSize?: number },
  ): { pixels: Uint8Array; width: number; height: number } {
    const mode = PASS_MODE[passId];
    if (mode === undefined) {
      throw new Error(`diagnostic AOV: unknown pass "${passId}" (known: ${Object.keys(PASS_MODE).join(', ')})`);
    }
    const { width, height } = opts;
    if (!this.rt || this.rtW !== width || this.rtH !== height) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(width, height);
      this.rtW = width;
      this.rtH = height;
    }
    this.mat.uniforms.uPosTex.value = ctx.posOut.texture;
    this.mat.uniforms.uVelTex.value = ctx.velOut.texture;
    this.mat.uniforms.uMode.value = mode;
    this.mat.uniforms.uAgeMax.value = ctx.ageMax;
    this.mat.uniforms.uSpeedMax.value = opts.speedMax;
    this.mat.uniforms.uExtent.value = ctx.extent;
    this.mat.uniforms.uPointSize.value = opts.pointSize ?? 2;

    const prevTarget = gl.getRenderTarget();
    const prevClear = new THREE.Color();
    gl.getClearColor(prevClear);
    const prevClearAlpha = gl.getClearAlpha();
    try {
      gl.setRenderTarget(this.rt);
      gl.setClearColor(0x000000, 1);
      gl.clear(true, true, false);
      gl.render(this.scene, camera);
      const pixels = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(this.rt, 0, 0, width, height, pixels);
      return { pixels, width, height };
    } finally {
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(prevClear, prevClearAlpha);
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.rt?.dispose();
  }
}

/** Encode the DA3 passes from readback buffers and hash the state.
 *  Pure: the buffers are read, never written. */
export function captureDiagnosticState(
  positions: Float32Array,
  velocities: Float32Array,
  texSize: number,
  ageMax: number,
): DiagnosticStateCapture {
  const params = { ageMax, speedMax: 0 };
  const passes: Record<string, DiagnosticPassResult> = {};
  for (const id of ['age', 'speed', 'position', 'velocity']) {
    passes[id] = encodeDiagnosticPass(id, { positions, velocities }, params);
  }
  return {
    texSize,
    stateHash: hashSimulationBuffers(positions, velocities),
    passes,
  };
}
