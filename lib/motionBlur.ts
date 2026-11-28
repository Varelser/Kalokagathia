// Motion blur foundation (limit plan stage 4, slice S5 —
// the MB half of the DOF+MB pair, design
// kalokagathia-pro/STAGE4_DESIGN_MATERIALS.md §3.2, 案A:
// velocity-buffer motion blur).
//
// 案A is a VELOCITY BUFFER design, not a frame-history blend
// (the design marks 案B's afterimage as not satisfying the
// row): the main pool's points are drawn once per frame into
// a half-resolution velocity target (components/
// ParticleVelocityCapture.tsx), where each splat writes the
// particle's screen-space velocity for a reference frame, and
// the 'motion-blur' post stage (components/motionBlurPass.ts)
// gathers colour samples SYMMETRICALLY along that velocity
// (centred on the current pixel), so a moving particle smears
// along its own direction of travel while a still one gathers
// only its own pixel. The gather was backward-only until the
// stage-4 gate fix round 2 (STAGE4_FIX5_MB_CHAIN_RECORD): the
// splat field also carries the particle's velocity on the
// pixels BEHIND it (the trail region), and a backward-only
// gather from those pixels reaches only background, so no
// trail could ever form; the centred interval is the form
// that matches the field's semantics.
//
// What lives here:
//  1. Key resolution + the stage predicate (the TS side every
//     consumer shares; resolution happens here, never in
//     normalizeConfig — the S1..S4 convention).
//  2. The pure math + its GLSL twin: screen-space velocity
//     from a world velocity under a view-projection matrix,
//     and the gather offsets / gather average the post stage
//     applies. Both halves must never drift apart; the S5
//     test transcribes the GLSL independently and compares
//     over the whole domain.
//  3. The velocity splat shaders (the capture's draw).
//  4. A tiny shared store for the captured velocity source
//     (the lib/sceneDepth.ts precedent: the capture publishes,
//     the post stage reads). The store is null whenever the
//     MB stage is off — the capture never mounts then — and
//     the stage treats null as a bit-identical passthrough,
//     so the default render is unchanged.

import React from 'react';
import type * as THREE from 'three';

/** Reference frame duration the stored velocity is expressed
 *  for: UV of travel per 1/60 s frame. A fixed reference (not
 *  the live frame time) keeps the field deterministic and the
 *  strength key meaningful across refresh rates. */
export const MOTION_BLUR_REFERENCE_DT = 1 / 60;

export const MOTION_BLUR_MAX_SAMPLES = 16;
export const MOTION_BLUR_DEFAULT_SAMPLES = 8;
export const MOTION_BLUR_MAX_STRENGTH = 4;

/** Resolved motion-blur settings (the single resolution site). */
export interface MotionBlurSettings {
  enabled: boolean;
  strength: number;
  samples: number;
  particleOnly: boolean;
}

function finiteOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Resolve the postMb* keys: strength is a finite number
 * clamped to [0, 4] (anything else resolves to the key
 * default 1), samples a finite number rounded and clamped to
 * [1, 16] (anything else resolves to 8), particleOnly and
 * enabled are literal-true predicates.
 */
export function resolveMotionBlurSettings(config: {
  postMbEnabled?: unknown;
  postMbStrength?: unknown;
  postMbSamples?: unknown;
  postMbParticleOnly?: unknown;
}): MotionBlurSettings {
  const strength = Math.min(
    MOTION_BLUR_MAX_STRENGTH,
    Math.max(0, finiteOr(config.postMbStrength, 1)),
  );
  const samples = Math.min(
    MOTION_BLUR_MAX_SAMPLES,
    Math.max(1, Math.round(finiteOr(config.postMbSamples, MOTION_BLUR_DEFAULT_SAMPLES))),
  );
  return {
    enabled: config.postMbEnabled === true,
    strength,
    samples,
    particleOnly: config.postMbParticleOnly === true,
  };
}

/**
 * The stage predicate (postFxStack's activation rule, the
 * stack-wide "a stage exists only when it would change a
 * pixel"): literally enabled with a resolved strength that
 * can move a sample.
 */
export function motionBlurOn(config: {
  postMbEnabled?: unknown;
  postMbStrength?: unknown;
  postMbSamples?: unknown;
  postMbParticleOnly?: unknown;
}): boolean {
  const s = resolveMotionBlurSettings(config);
  return s.enabled && s.strength > 0.001;
}

// ---------------------------------------------------------------------------
// Pure math (TS) + GLSL twin

/**
 * Screen-space velocity in UV units per reference frame:
 * project the world position and the position advanced by
 * the reference-frame travel through the same view-projection
 * matrix (column-major, 16 elements), perspective-divide
 * both, and take the UV difference. A point at or behind the
 * clip w of either projection resolves to [0, 0] (no
 * measurable travel — never smear on bad data).
 *
 * Unit system (gate G4-4 fix round, STAGE4_FIX3_MB_RECORD):
 * worldVel is in SIMULATION units — the position pass
 * integrates `pos += vel * uDelta * uSpeed * 60.0`
 * (components/gpgpuShaderSimulationPosition.ts), so vel is
 * world units per 1/60 s frame and the travel over dt
 * seconds is vel * speed * dt * 60, NOT vel * dt. The
 * earlier vel * dt form understated the travel 60x.
 */
export function screenVelocityUv(
  worldPos: readonly [number, number, number],
  worldVel: readonly [number, number, number],
  viewProj: ArrayLike<number>,
  dt: number = MOTION_BLUR_REFERENCE_DT,
  speed: number = 1,
): [number, number] {
  const project = (x: number, y: number, z: number): [number, number, number] | null => {
    const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
    if (!(w > 1e-9)) return null;
    const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
    const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
    return [cx / w, cy / w, w];
  };
  const a = project(worldPos[0], worldPos[1], worldPos[2]);
  const b = project(
    worldPos[0] + worldVel[0] * speed * dt * 60,
    worldPos[1] + worldVel[1] * speed * dt * 60,
    worldPos[2] + worldVel[2] * speed * dt * 60,
  );
  if (!a || !b) return [0, 0];
  return [(b[0] - a[0]) * 0.5, (b[1] - a[1]) * 0.5];
}

/**
 * Gather offsets for the post stage: sample i (of n) reads
 * the frame at uv + velUv * strength * (t - 0.5), t = i / (n - 1)
 * (t = 0.5 for a single sample, i.e. the centre). The gather
 * therefore spans exactly the reference-frame travel scaled
 * by strength, CENTRED on the current position — half the
 * span on each side — and an odd sample count includes the
 * centre sample at offset zero. (Backward-only until the
 * stage-4 gate fix round 2; see the file header for why the
 * centred interval is the one the splat field supports.)
 * Zero velocity yields n zero offsets (an exact identity
 * average).
 */
export function motionBlurSampleOffsets(
  velUv: readonly [number, number],
  strength: number,
  samples: number,
): [number, number][] {
  const n = Math.max(1, Math.floor(samples));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    out.push([velUv[0] * strength * (t - 0.5), velUv[1] * strength * (t - 0.5)]);
  }
  return out;
}

/**
 * The gather itself over a UV sampler (the CPU twin of the
 * post stage's fragment loop): the plain average of the
 * sampler at uv + offset for every offset. For a static
 * field region (or zero velocity) this is the sampler's own
 * value at uv, bit for bit when the field is locally constant.
 */
export function gatherMotionBlur<T extends number[]>(
  sample: (u: number, v: number) => T,
  uv: readonly [number, number],
  velUv: readonly [number, number],
  strength: number,
  samples: number,
): T {
  const offsets = motionBlurSampleOffsets(velUv, strength, samples);
  let acc: number[] | null = null;
  for (const [du, dv] of offsets) {
    const s = sample(uv[0] + du, uv[1] + dv);
    if (!acc) acc = s.slice();
    else for (let c = 0; c < acc.length; c++) acc[c] += s[c];
  }
  const out = acc as T;
  for (let c = 0; c < out.length; c++) out[c] /= offsets.length;
  return out;
}

/** GLSL twin of motionBlurSampleOffsets' per-sample offset. */
export const MOTION_BLUR_OFFSET_GLSL = /* glsl */ `
vec2 kaloMotionBlurOffset(vec2 velUv, float strength, float t) {
  return velUv * strength * (t - 0.5);
}
`;

/**
 * World diameter of one velocity splat sprite: gpgpuSize in
 * the geometry path's world unit (bounceRadius * 0.02) — the
 * same representative-diameter definition the S4 shadow
 * caster recorded (the visible sprite size is distance-based
 * and has no single world diameter). Non-positive inputs
 * give 0 (the capture skips the splat draw at 0).
 */
export function motionBlurPointDiameterWorld(gpgpuSize: number, bounceRadius: number): number {
  const size = Number.isFinite(gpgpuSize) ? Math.max(0, gpgpuSize) : 0;
  const radius = Number.isFinite(bounceRadius) ? Math.max(0, bounceRadius) : 0;
  return size * radius * 0.02;
}

/**
 * Pixel diameter of a world diameter under a perspective
 * camera at view depth z: px = diameter * projFactor / z,
 * where projFactor = drawingBufferHeight * 0.5 *
 * projectionMatrix[1][1] (the standard perspective size
 * factor). Non-positive inputs give 0.
 */
export function motionBlurPointSizePx(diameterWorld: number, projFactor: number, viewDepth: number): number {
  if (!(diameterWorld > 0) || !(projFactor > 0) || !(viewDepth > 0)) return 0;
  return (diameterWorld * projFactor) / viewDepth;
}

/** Half-resolution velocity target size for a drawing buffer
 *  (the design §0 budget: exactly one half-res velocity RT). */
export function velocityTargetSize(bufferWidth: number, bufferHeight: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(bufferWidth / 2)),
    height: Math.max(1, Math.floor(bufferHeight / 2)),
  };
}

// ---------------------------------------------------------------------------
// Velocity splat shaders (the capture's draw)
//
// One sampler pair (uPosTex / uVelTex — the simulation's own
// textures, read off the marked points object's live
// material). These are capture-side programs; no existing
// program gains a sampler. The fragment writes
// vec4(velUv, 0, coverage): the post stage reads .rg as the
// velocity and .a as the splat coverage (particleOnly mask).

export const VELOCITY_SPLAT_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uDiameterWorld;
uniform float uProjFactor;
uniform float uReferenceDt;
uniform float uSpeed;
varying vec2 vVelUv;
void main() {
  vec3 pos = texture2D(uPosTex, aTexCoord).xyz;
  vec3 vel = texture2D(uVelTex, aTexCoord).xyz;
  vec4 mv0 = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip0 = projectionMatrix * mv0;
  // Sim unit system: the position pass integrates
  // pos += vel * uDelta * uSpeed * 60.0, so vel is world
  // units per 1/60 s frame and the reference-frame travel is
  // vel * uSpeed * (uReferenceDt * 60.0) — at the reference
  // dt of 1/60 s and speed 1 this is exactly vel.
  vec4 clip1 = projectionMatrix * (modelViewMatrix * vec4(pos + vel * uSpeed * (uReferenceDt * 60.0), 1.0));
  vec2 ndc0 = clip0.xy / max(clip0.w, 1e-9);
  vec2 ndc1 = clip1.xy / max(clip1.w, 1e-9);
  vVelUv = (ndc1 - ndc0) * 0.5;
  float px = uDiameterWorld * uProjFactor / max(0.001, -mv0.z);
  gl_PointSize = clamp(px, 1.0, 128.0);
  gl_Position = clip0;
}
`;

export const VELOCITY_SPLAT_FRAG = /* glsl */ `
varying vec2 vVelUv;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vVelUv, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Motion-blur post stage fragment (components/motionBlurPass.ts
// binds tDiffuse / tVelocity and the resolved settings).
//
// uVelocityReady = 0 (no capture published) is a bit-identical
// passthrough, as is particleOnly with zero coverage at the
// centre pixel. The loop bound is the compile-time maximum;
// uSamplesFloat breaks it at the resolved count.

export const MOTION_BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform float uStrength;
uniform float uSamplesFloat;
uniform float uParticleOnly;
uniform float uVelocityReady;
varying vec2 vUv;
${MOTION_BLUR_OFFSET_GLSL}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  if (uVelocityReady < 0.5) {
    gl_FragColor = base;
    return;
  }
  vec4 velData = texture2D(tVelocity, vUv);
  vec2 velUv = velData.rg;
  if (uParticleOnly > 0.5 && velData.a <= 0.001) {
    gl_FragColor = base;
    return;
  }
  if (dot(velUv, velUv) < 1e-12) {
    gl_FragColor = base;
    return;
  }
  float n = max(uSamplesFloat, 1.0);
  vec3 acc = vec3(0.0);
  float taken = 0.0;
  for (int i = 0; i < ${MOTION_BLUR_MAX_SAMPLES}; i++) {
    if (float(i) >= n) break;
    float t = n <= 1.0 ? 0.5 : float(i) / (n - 1.0);
    vec2 uv = vUv + kaloMotionBlurOffset(velUv, uStrength, t);
    acc += texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
    taken += 1.0;
  }
  gl_FragColor = vec4(acc / max(taken, 1.0), base.a);
}
`;

// ---------------------------------------------------------------------------
// Shared velocity-source store (capture publishes, stage reads)

export interface MotionVelocitySource {
  /** Half-resolution velocity texture (rg = UV/frame, a = coverage). */
  texture: THREE.Texture;
  width: number;
  height: number;
  /**
   * The render target behind `texture`, published alongside
   * so the ?diag=1 hook can read the field back
   * (captureMotionVelocityStats). Null when a publisher has
   * only a texture to give.
   */
  target?: THREE.WebGLRenderTarget | null;
}

let currentVelocity: MotionVelocitySource | null = null;
const velocityListeners = new Set<() => void>();

export function setMotionVelocitySource(next: MotionVelocitySource | null): void {
  const prev = currentVelocity;
  if (
    prev === next ||
    (prev !== null && next !== null && prev.texture === next.texture && prev.width === next.width && prev.height === next.height)
  ) {
    return;
  }
  currentVelocity = next;
  for (const listener of velocityListeners) listener();
}

export function getMotionVelocitySource(): MotionVelocitySource | null {
  return currentVelocity;
}

function subscribeMotionVelocitySource(listener: () => void): () => void {
  velocityListeners.add(listener);
  return () => {
    velocityListeners.delete(listener);
  };
}

export function useMotionVelocitySource(): MotionVelocitySource | null {
  return React.useSyncExternalStore(
    subscribeMotionVelocitySource,
    getMotionVelocitySource,
    getMotionVelocitySource,
  );
}

// ---------------------------------------------------------------------------
// Sim frame source (the capture's texture supply)
//
// Stage-4 gate fix round 2 (STAGE4_FIX5_MB_CHAIN_RECORD): the
// velocity capture used to read uPosTex / uVelTex off the
// marked points object's draw material — the only capture
// that needed the velocity uniform — and its
// `if (!posTex || !velTex) return;` failed silently forever
// when that lookup came back empty, leaving the post stage a
// permanent passthrough. The capture now reads the simulation's
// own output targets, published here by the GpgpuSystem frame
// loop at the same site that publishes the diagnostic frame
// context (components/gpgpuDiagnosticAov.ts's ctx.posOut /
// ctx.velOut — the route the diagnostic AOV renders from, with
// a working track record). Plain texture references, republished
// every frame (the sim ping-pongs its targets); the identity
// check keeps repeat publication free. Inert while the capture
// is unmounted (MB off): nothing else reads this store.

export interface MotionSimFrameSource {
  posTexture: THREE.Texture;
  velTexture: THREE.Texture;
}

let currentSimFrame: MotionSimFrameSource | null = null;

export function setMotionSimFrameSource(next: MotionSimFrameSource | null): void {
  const prev = currentSimFrame;
  if (
    prev === next ||
    (prev !== null && next !== null && prev.posTexture === next.posTexture && prev.velTexture === next.velTexture)
  ) {
    return;
  }
  currentSimFrame = next;
}

export function getMotionSimFrameSource(): MotionSimFrameSource | null {
  return currentSimFrame;
}

// ---------------------------------------------------------------------------
// Capture diagnostic state + velocity field statistics
// (the ?diag=1 hook's captureMotionVelocityStats reads these)
//
// The counters exist so a capture that cannot run is VISIBLE:
// every frame the capture sees is counted, every skip leaves
// its reason, and a successful splat + publish clears the
// last-skip marker. No silent passthrough can hide behind
// these numbers again.

export type MotionCaptureSkipReason = 'no-points' | 'no-sim-frame' | 'zero-diameter' | 'bad-buffer';

export interface MotionCaptureDiagState {
  /** useFrame invocations the mounted capture has seen. */
  framesSeen: number;
  /** Frames that completed the splat draw and published. */
  framesPublished: number;
  /** Most recent skip reason, or null after a publish. */
  lastSkipReason: MotionCaptureSkipReason | null;
  skips: Record<MotionCaptureSkipReason, number>;
}

const motionCaptureDiag: MotionCaptureDiagState = {
  framesSeen: 0,
  framesPublished: 0,
  lastSkipReason: null,
  skips: { 'no-points': 0, 'no-sim-frame': 0, 'zero-diameter': 0, 'bad-buffer': 0 },
};

export function noteMotionCaptureFrame(): void {
  motionCaptureDiag.framesSeen += 1;
}

export function noteMotionCaptureSkip(reason: MotionCaptureSkipReason): void {
  motionCaptureDiag.skips[reason] += 1;
  motionCaptureDiag.lastSkipReason = reason;
}

export function noteMotionCapturePublished(): void {
  motionCaptureDiag.framesPublished += 1;
  motionCaptureDiag.lastSkipReason = null;
}

export function getMotionCaptureDiagState(): MotionCaptureDiagState {
  return { ...motionCaptureDiag, skips: { ...motionCaptureDiag.skips } };
}

// ---------------------------------------------------------------------------
// Pass diagnostic state (the ?diag=1 hook's
// captureMotionBlurPassStats reads these)
//
// Stage-4 gate fix round 3 (STAGE4_FIX8_MB_BINDING_RECORD): the
// pass binds the velocity source inside its own render() now
// (components/motionBlurPass.ts reads the store above at
// composite time), and every render records what it actually
// bound here — the ready flag it set and the bound texture's
// dimensions — so a gate can confirm the binding arrived
// directly instead of inferring it from screenshots. The
// sub-mechanism that starved the old React-render assignment
// (pass-instance mismatch vs a re-render that never landed)
// was never separated statically; this state exists so the
// question never has to be asked from pixels again.

export interface MotionBlurPassDiagState {
  /** render() invocations the pass has seen. */
  renders: number;
  /** uVelocityReady of the most recent render. */
  lastVelocityReady: boolean;
  /** Dimensions of the source bound at the most recent
   *  render (null when no source was published). */
  lastTextureWidth: number | null;
  lastTextureHeight: number | null;
}

const motionBlurPassDiag: MotionBlurPassDiagState = {
  renders: 0,
  lastVelocityReady: false,
  lastTextureWidth: null,
  lastTextureHeight: null,
};

export function noteMotionBlurPassRender(ready: boolean, width: number | null, height: number | null): void {
  motionBlurPassDiag.renders += 1;
  motionBlurPassDiag.lastVelocityReady = ready;
  motionBlurPassDiag.lastTextureWidth = width;
  motionBlurPassDiag.lastTextureHeight = height;
}

export function getMotionBlurPassDiagState(): MotionBlurPassDiagState {
  return { ...motionBlurPassDiag };
}

/** Decode one IEEE 754 half-precision value from its bits. */
export function halfFloatBitsToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * (frac / 1024) * Math.pow(2, -14);
  if (exp === 0x1f) return frac === 0 ? sign * Infinity : NaN;
  return sign * (1 + frac / 1024) * Math.pow(2, exp - 15);
}

export interface MotionVelocityStats {
  texelCount: number;
  coveredTexels: number;
  /** Fraction of texels whose coverage clears the stage's
   *  particleOnly threshold (a > 0.001). */
  coverageRate: number;
  /** Largest |velUv| over covered texels (UV per reference frame). */
  maxAbsVelUv: number;
  /** Mean |velUv| over covered texels (0 when none are covered). */
  meanAbsVelUv: number;
}

/**
 * Statistics over a raw readback of the velocity target. The
 * target is HalfFloatType and three's readRenderTargetPixels
 * hands the bits back verbatim in a Uint16Array, so the values
 * are decoded here (pure; the S5 test pins the decode and the
 * aggregation over synthetic bit patterns).
 */
export function motionVelocityStatsFromReadback(data: Uint16Array): MotionVelocityStats {
  const texelCount = Math.floor(data.length / 4);
  let coveredTexels = 0;
  let maxAbsVelUv = 0;
  let sumAbsVelUv = 0;
  for (let i = 0; i < texelCount; i++) {
    const coverage = halfFloatBitsToFloat(data[i * 4 + 3]);
    if (!(coverage > 0.001)) continue;
    const u = halfFloatBitsToFloat(data[i * 4]);
    const v = halfFloatBitsToFloat(data[i * 4 + 1]);
    const mag = Math.hypot(u, v);
    coveredTexels += 1;
    sumAbsVelUv += mag;
    if (mag > maxAbsVelUv) maxAbsVelUv = mag;
  }
  return {
    texelCount,
    coveredTexels,
    coverageRate: texelCount > 0 ? coveredTexels / texelCount : 0,
    maxAbsVelUv,
    meanAbsVelUv: coveredTexels > 0 ? sumAbsVelUv / coveredTexels : 0,
  };
}
