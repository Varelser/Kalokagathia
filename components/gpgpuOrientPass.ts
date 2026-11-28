import * as THREE from 'three';
import type { ResolvedOrient } from '../lib/gpgpuOrient';
import { quatToMat3Columns } from '../lib/gpgpuOrient';

/**
 * Orientation channel pass (Limit plan stage 4, slice S2).
 *
 * The posture counterpart of the Spin pass: a dedicated
 * ping-pong render-target pair, one texel per particle,
 * holding a full quaternion instead of a scalar phase:
 *
 *   .x/.y/.z  quaternion vector part
 *   .w        quaternion scalar part (identity = (0,0,0,1))
 *
 * Step law (CPU twin: orientStep / orientInitialState in
 * lib/gpgpuOrient.ts):
 *   - reset (first run after construction, or — while the age
 *     system is on — the frame a particle's age wraps back to
 *     ~0, the spin pass's respawn test): the identity
 *     quaternion. Posture starts unrotated.
 *   - otherwise: omega = speed · hashMultiplier ·
 *     exp(−damping · tState), with tState = the particle's
 *     age while the age system is on and the pass's own
 *     accumulated elapsed time (uElapsed, summed from the
 *     run() dt values) while it is off — the quaternion RT
 *     has no spare channel for a stored omega, so omega is a
 *     pure function of (keys, hash, tState). The increment
 *     axisAngle(axis, omega · slotFactor · dt) is composed on
 *     the world side (q ← dq ⊗ q) and re-normalised; the
 *     slot factor multiplies the INCREMENT only.
 *   - axis: mode 0 ('axis') = the fixed axis (0, 1, 0);
 *     mode 1 ('velocity') = the particle's velocity
 *     direction from uVelTex (a near-zero velocity takes no
 *     increment that step).
 *
 * The one consumer in this slice is the instanced-geometry
 * vertex (its orient variant reads .xyzw as the posture).
 * The velocity fragment never reads this pass (stage-4
 * design §0: its 16 samplers stay untouched).
 *
 * Lifecycle mirrors GpgpuSpinPass: the scene builds the pass
 * only while the channel is enabled, rebuilds it when the
 * signature (enabled / texSize) changes, and disposes it
 * otherwise. The returned texture is stable between runs.
 */
const ORIENT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const ORIENT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrevTex;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform sampler2D uAttrTex;
uniform bool uAttrEnabled;
uniform bool uAgeEnabled;
uniform bool uResetAll;
uniform float uDelta;
uniform float uElapsed;
uniform float uOrientSpeed;
uniform float uOrientRandom;
uniform float uOrientDamping;
uniform int uOrientSlot;
uniform int uOrientMode;

// Attribute channel picker (Phase AK): an identical copy
// lives in the velocity helpers / points shader / spin pass.
float kaloAttrChannel(vec4 a, int slot) {
  if (slot == 0) return a.r;
  if (slot == 1) return a.g;
  if (slot == 2) return a.b;
  return a.a;
}

// The per-particle speed multiplier hash (the GEOM_VERT
// spinHash2 form, at the +19.19 / +7.77 offset; TS twin
// spinSpeedHash in lib/gpgpuSpeedDragSpin.ts, shared with
// the Spin channel so the two random fields agree).
float kaloOrientSpeedHash(vec2 uv) {
  vec3 p3 = fract(vec3((uv.x + 19.19) * 127.1 + (uv.y + 7.77) * 311.7) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Hamilton product a (x) b: applies b first, then a. Term
// for term with quatMultiply in lib/gpgpuOrient.ts.
vec4 kaloOrientQuatMul(vec4 a, vec4 b) {
  return vec4(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}

void main() {
  float age = texture2D(uPosTex, vUv).w;
  bool reset = uResetAll || (uAgeEnabled && age < uDelta * 1.5);
  if (reset) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 prev = texture2D(uPrevTex, vUv);
  float mul = uOrientRandom > 0.0
    ? mix(1.0 - uOrientRandom, 1.0 + uOrientRandom, kaloOrientSpeedHash(vUv))
    : 1.0;
  float tState = uAgeEnabled ? age : uElapsed;
  float omega = uOrientSpeed * mul * exp(-uOrientDamping * tState);
  float slotFactor = 1.0;
  if (uAttrEnabled && uOrientSlot >= 0) {
    slotFactor = max(kaloAttrChannel(texture2D(uAttrTex, vUv), uOrientSlot), 0.0);
  }
  vec3 axis = vec3(0.0, 1.0, 0.0);
  bool stepActive = omega != 0.0 && uDelta > 0.0;
  if (uOrientMode == 1) {
    vec3 vel = texture2D(uVelTex, vUv).xyz;
    float vlen = length(vel);
    if (vlen > 0.0001) {
      axis = vel / vlen;
    } else {
      stepActive = false;
    }
  }
  vec4 q = prev;
  if (stepActive) {
    float halfAngle = omega * slotFactor * uDelta * 0.5;
    vec4 dq = vec4(axis * sin(halfAngle), cos(halfAngle));
    q = kaloOrientQuatMul(dq, prev);
  }
  gl_FragColor = vec4(normalize(q));
}
`;

/**
 * Diag introspection registry (stage-4 gate fix round 2):
 * the most recently constructed orient pass, so the diag
 * hook — which only receives render targets through the
 * frame context — can reach BOTH ping-pong sides and the
 * pass's bookkeeping (hasState / elapsed) for read-only
 * captures. Registration never feeds back into rendering.
 */
let activeOrientPass: GpgpuOrientPass | null = null;
export function getActiveOrientPass(): GpgpuOrientPass | null {
  return activeOrientPass;
}

/**
 * Pending orientation seed (bake A-2 premise fix): posture
 * restored from a state-cache frame while NO orient pass
 * stands yet — the deterministic capture job's remount is
 * the case that matters: the initial state is re-applied
 * into the fresh mount before the scene's first frame has
 * constructed the pass. The seed waits here, one-shot, and
 * the next pass constructed at this texSize consumes it on
 * its first run() (see GpgpuOrientPass.run). A newer
 * request replaces an unconsumed one (each apply supersedes
 * the last, like the initial-state record it mirrors).
 * Registration never feeds back into rendering on its own:
 * with no request pending, construction and stepping are
 * exactly the legacy behaviour.
 */
let pendingOrientSeed: { texSize: number; data: Float32Array } | null = null;

export function requestPendingOrientSeed(data: Float32Array, texSize: number): void {
  pendingOrientSeed = { texSize, data };
}

export function takePendingOrientSeed(texSize: number): Float32Array | null {
  if (!pendingOrientSeed || pendingOrientSeed.texSize !== texSize) return null;
  const data = pendingOrientSeed.data;
  pendingOrientSeed = null;
  return data;
}

export function clearPendingOrientSeed(): void {
  pendingOrientSeed = null;
}

/** Whether a seed is waiting (diag / tests). */
export function hasPendingOrientSeed(): boolean {
  return pendingOrientSeed !== null;
}

/** Literal JS translation of lookRot in
 *  components/gpgpuShaderVolumes.ts: the rotation whose
 *  columns are (r, u, dir), applied to v as r·x + u·y + dir·z. */
export function lookRotJs(dir: [number, number, number], v: [number, number, number]): [number, number, number] {
  const up: [number, number, number] = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  // r = normalize(cross(dir, up))
  let r: [number, number, number] = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  // u = cross(r, dir)
  const u: [number, number, number] = [
    r[1] * dir[2] - r[2] * dir[1],
    r[2] * dir[0] - r[0] * dir[2],
    r[0] * dir[1] - r[1] * dir[0],
  ];
  return [
    r[0] * v[0] + u[0] * v[1] + dir[0] * v[2],
    r[1] * v[0] + u[1] * v[1] + dir[1] * v[2],
    r[2] * v[0] + u[2] * v[1] + dir[2] * v[2],
  ];
}

/** Literal JS translation of rotYMat in
 *  components/gpgpuShaderVolumes.ts (column-major mat3 with
 *  columns (c,0,s), (0,1,0), (−s,0,c)), applied to v. */
export function rotYJs(a: number, v: [number, number, number]): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
}

export interface VelocityAlignStats {
  texSize: number;
  count: number;
  validCount: number;
  meanAngleDeg: number;
  maxAngleDeg: number;
  within5Rate: number;
  meanAngleAlignOnlyDeg: number;
  spinSource: 'channel' | 'none';
  orientApplied: boolean;
}

/**
 * Pure per-texel long-axis alignment statistics for the diag
 * hook's captureVelocityAlignStats (stage-4 gate fix round 2,
 * G4-1 (b)). For each texel with speed > 0.01 the drawn long
 * axis is rebuilt exactly as the geometry vertex composes it:
 *   axis = lookRot(vel̂) · rotY(spinAngle) · quatMat(quat) · ẑ
 * and compared against vel̂ with the axis's sign ambiguity
 * folded out (angle = acos(min(1, |axis·vel̂|)), degrees).
 * meanAngleAlignOnlyDeg repeats the measure with spin and
 * orient removed (lookRot only) as a self-calibration: it is
 * identically 0 for a faithful lookRot translation.
 * Buffers are RGBA texel arrays; spin/orient may be null
 * (spin angle 0 / identity posture) and must share the
 * velocity buffer's texel count when present.
 */
export function computeVelocityAlignStats(
  vel: ArrayLike<number>,
  spin: ArrayLike<number> | null,
  orient: ArrayLike<number> | null,
  texSize: number,
): VelocityAlignStats {
  const count = texSize * texSize;
  let valid = 0;
  let sumAngle = 0;
  let maxAngle = 0;
  let within5 = 0;
  let sumAlignOnly = 0;
  for (let i = 0; i < count; i++) {
    const vx = vel[i * 4];
    const vy = vel[i * 4 + 1];
    const vz = vel[i * 4 + 2];
    const spd = Math.hypot(vx, vy, vz);
    if (!(spd > 0.01)) continue;
    const dir: [number, number, number] = [vx / spd, vy / spd, vz / spd];
    // quatMat(quat) · ẑ = third column of the quaternion matrix.
    let v: [number, number, number] = [0, 0, 1];
    if (orient) {
      const m = quatToMat3Columns([orient[i * 4], orient[i * 4 + 1], orient[i * 4 + 2], orient[i * 4 + 3]]);
      v = [m[6], m[7], m[8]];
    }
    const spinAngle = spin ? spin[i * 4] : 0;
    v = rotYJs(spinAngle, v);
    const axis = lookRotJs(dir, v);
    const dot = Math.min(1, Math.abs(axis[0] * dir[0] + axis[1] * dir[1] + axis[2] * dir[2]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const axisOnly = lookRotJs(dir, [0, 0, 1]);
    const dotOnly = Math.min(1, Math.abs(axisOnly[0] * dir[0] + axisOnly[1] * dir[1] + axisOnly[2] * dir[2]));
    sumAlignOnly += (Math.acos(dotOnly) * 180) / Math.PI;
    valid++;
    sumAngle += angleDeg;
    if (angleDeg > maxAngle) maxAngle = angleDeg;
    if (angleDeg <= 5) within5++;
  }
  return {
    texSize,
    count,
    validCount: valid,
    meanAngleDeg: valid ? sumAngle / valid : 0,
    maxAngleDeg: maxAngle,
    within5Rate: valid ? within5 / valid : 0,
    meanAngleAlignOnlyDeg: valid ? sumAlignOnly / valid : 0,
    spinSource: spin ? 'channel' : 'none',
    orientApplied: !!orient,
  };
}

export interface GpgpuOrientPassRunArgs {
  /** Current position texture (its .w is the particle age). */
  posTex: THREE.Texture | null;
  /** Current velocity texture (velocity mode's axis source). */
  velTex: THREE.Texture | null;
  /** Final attribute texture, or null while no slot consumer
   *  stands (the slot factor then stays exactly 1). */
  attrTex: THREE.Texture | null;
  /** Age system on — gates the per-particle respawn reset
   *  and selects age as the damping clock. */
  ageEnabled: boolean;
  dt: number;
  orient: ResolvedOrient;
}

export class GpgpuOrientPass {
  private rts: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIdx = 0;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private mesh: THREE.Mesh;
  private hasState = false;
  /** Seconds accumulated over run() calls; the damping clock
   *  while the age system is off (the CPU twin's elapsed). */
  private elapsed = 0;
  /** Pool size this pass was built for (seed validation). */
  readonly texSize: number;

  constructor(texSize: number) {
    this.texSize = texSize;
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
        uVelTex: { value: null as THREE.Texture | null },
        uAttrTex: { value: null as THREE.Texture | null },
        uAttrEnabled: { value: false },
        uAgeEnabled: { value: false },
        uResetAll: { value: true },
        uDelta: { value: 0 },
        uElapsed: { value: 0 },
        uOrientSpeed: { value: 0 },
        uOrientRandom: { value: 0 },
        uOrientDamping: { value: 0 },
        uOrientSlot: { value: -1 },
        uOrientMode: { value: 0 },
      },
      vertexShader: ORIENT_VERT,
      fragmentShader: ORIENT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.scene.add(mesh);
    activeOrientPass = this;
  }

  /**
   * Seed the posture state from restored data (bake A-2
   * premise fix): copy the count x 4 quaternion buffer into
   * BOTH ping-pong targets through a DataTexture passthrough
   * (NoBlending, the bake copy's discipline), so the next
   * step composes its increment onto the restored posture
   * instead of resetting to identity, and mark the state as
   * started. Returns false — and changes nothing — when the
   * buffer does not match this pass's pool size; the caller
   * (the initial-state applier) turns that into its refusal.
   * The elapsed clock is NOT seeded: the state-cache format
   * carries no pass clock. While the age system is on (the
   * restored frame's own age lane drives the step law's
   * tState) this does not enter the resumed evolution; while
   * ages are off, the damping clock restarts with the mount
   * — a format boundary, stated here rather than papered
   * over with an invented value.
   */
  seedFromData(gl: THREE.WebGLRenderer, data: Float32Array): boolean {
    if (data.length !== this.texSize * this.texSize * 4) return false;
    const tex = new THREE.DataTexture(
      data.slice(), this.texSize, this.texSize, THREE.RGBAFormat, THREE.FloatType,
    );
    tex.needsUpdate = true;
    const copyMat = new THREE.MeshBasicMaterial({ map: tex });
    copyMat.blending = THREE.NoBlending;
    const prevMaterial = this.mesh.material;
    const prevTarget = gl.getRenderTarget();
    this.mesh.material = copyMat;
    try {
      for (const rt of this.rts) {
        gl.setRenderTarget(rt);
        gl.render(this.scene, this.cam);
      }
    } finally {
      gl.setRenderTarget(prevTarget);
      this.mesh.material = prevMaterial;
      copyMat.dispose();
      tex.dispose();
    }
    this.hasState = true;
    return true;
  }

  /**
   * Advance the posture state by one step and return the
   * texture consumers should read. The first run after
   * construction resets every texel to the identity posture
   * (uResetAll), so no clear / copy pass is needed.
   */
  run(gl: THREE.WebGLRenderer, args: GpgpuOrientPassRunArgs): THREE.Texture {
    // Pending seed (bake A-2 premise fix): posture restored
    // while no pass stood yet (the capture job's remount)
    // is consumed here, on the first run after construction,
    // before the step below reads the read side — so the
    // first stepped frame already evolves the restored
    // posture. No pending seed = the exact legacy run.
    const pendingSeed = takePendingOrientSeed(this.texSize);
    if (pendingSeed) this.seedFromData(gl, pendingSeed);
    const writeIdx = this.readIdx === 0 ? 1 : 0;
    const u = this.mat.uniforms;
    u.uPrevTex.value = this.hasState ? this.rts[this.readIdx].texture : null;
    u.uPosTex.value = args.posTex;
    u.uVelTex.value = args.velTex;
    u.uAttrTex.value = args.attrTex;
    u.uAttrEnabled.value = !!args.attrTex && args.orient.slot >= 0;
    u.uAgeEnabled.value = args.ageEnabled;
    u.uResetAll.value = !this.hasState;
    u.uDelta.value = args.dt;
    u.uElapsed.value = this.elapsed;
    u.uOrientSpeed.value = args.orient.speedRad;
    u.uOrientRandom.value = args.orient.random;
    u.uOrientDamping.value = args.orient.damping;
    u.uOrientSlot.value = args.orient.slot;
    u.uOrientMode.value = args.orient.mode === 'velocity' ? 1 : 0;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.rts[writeIdx]);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    this.readIdx = writeIdx;
    this.hasState = true;
    this.elapsed += Math.max(args.dt, 0);
    return this.rts[this.readIdx].texture;
  }

  /** The render target holding the latest posture state (the
   * read side of the ping-pong). Used by the diag hook's
   * read-only captureOrientStats. */
  get currentTarget(): THREE.WebGLRenderTarget {
    return this.rts[this.readIdx];
  }

  /** Diag-only introspection (stage-4 gate fix round 2):
   * both ping-pong targets in storage order, so a capture can
   * compare the read side against the stale side — one side
   * at identity points at the feedback path, both sides at
   * identity at reset / increment. Read-only. */
  get targets(): readonly [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    return this.rts;
  }

  /** Diag-only introspection: which side `targets` index is
   * the current read side. */
  get readIndex(): number {
    return this.readIdx;
  }

  /** Diag-only introspection: whether run() has produced a
   * state yet (the pass's hasState bookkeeping, echoed). */
  get stateStarted(): boolean {
    return this.hasState;
  }

  /** Diag-only introspection: the accumulated run() dt sum
   * (the damping clock while the age system is off, echoed). */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  dispose(): void {
    if (activeOrientPass === this) activeOrientPass = null;
    this.rts[0].dispose();
    this.rts[1].dispose();
    this.mat.dispose();
    this.geo.dispose();
  }
}
