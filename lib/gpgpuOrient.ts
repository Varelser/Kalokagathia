/**
 * Orientation channel (Limit plan stage 4, slice S2; design
 * STAGE4_DESIGN_MATERIALS §2, posture 案A). The draw-side
 * 3-axis posture channel the stage-4 design adds next to the
 * Spin channel: where Spin accumulates a SCALAR phase around
 * a fixed axis, Orient accumulates a full quaternion per
 * particle in a dedicated ping-pong render-target pair
 * (components/gpgpuOrientPass.ts):
 *
 *   .x/.y/.z  quaternion vector part
 *   .w        quaternion scalar part (identity = (0,0,0,1))
 *
 * Step law (GLSL twin: ORIENT_FRAG in
 * components/gpgpuOrientPass.ts):
 *   - reset (first run after construction, or — while the age
 *     system is on — the frame a particle's age wraps back to
 *     ~0): the identity quaternion. Unlike Spin there is no
 *     initial phase: posture starts unrotated, by the task
 *     brief's reset contract.
 *   - otherwise: the angular velocity for this step is
 *       omega = speed · hashMultiplier · exp(−damping · tState)
 *     where tState is the particle's age while the age system
 *     is on, and the pass's accumulated elapsed time while it
 *     is off (so a respawn restarts the decay together with
 *     the posture, and without ages every particle shares the
 *     same decay clock — the state the pass can actually
 *     persist is the quaternion alone, so omega is a pure
 *     function of (keys, hash, tState) rather than stored
 *     state; this is the one structural difference from Spin,
 *     whose RT has a spare channel for omega).
 *     The increment dq = axisAngle(axis, omega · slotFactor ·
 *     dt) is composed on the WORLD side (q ← dq ⊗ q) and the
 *     result re-normalised. The slot factor multiplies the
 *     INCREMENT only and never enters the state (the Spin
 *     channel's judgment-1 discipline).
 *   - axis: 'axis' mode rotates about the fixed axis
 *     (0, 1, 0); 'velocity' mode rotates about the particle's
 *     current velocity direction (a near-zero velocity takes
 *     no increment that step). The design's third candidate
 *     mode, 'spin-align', is deliberately NOT in this slice:
 *     it would compose the Spin channel's accumulated angle
 *     into the posture axis, coupling the two channels'
 *     lifecycles (the posture pass would have to run after
 *     and read the spin pass), and the geometry consumer
 *     already composes spin ∘ orient in the vertex — the
 *     same visual composition without the pass coupling.
 *
 * Consumer: the instanced-geometry vertex only (this slice),
 * which applies the quaternion innermost —
 * totalRot = velocityAlign ∘ spin ∘ orient — so the legacy
 * terms keep their exact meaning and an identity posture is
 * an exact no-op. The points draw's sprite projection is a
 * later slice. The velocity fragment never reads the posture
 * (stage-4 design §0: its 16 samplers stay untouched).
 *
 * Everything here is inert at the key defaults: the channel
 * is disabled, no pass stands, no draw variant string exists,
 * and the stock shader strings stay byte-identical.
 */
import type { ParticleConfig } from '../types';
import { normalizeAttrSlot } from './gpgpuAttributes';
import { spinSpeedMultiplier } from './gpgpuSpeedDragSpin';

export type OrientMode = 'axis' | 'velocity';

/** The fixed rotation axis of 'axis' mode (no axis keys in
 *  this slice; a per-key axis is a recorded candidate). */
export const ORIENT_FIXED_AXIS: readonly [number, number, number] = [0, 1, 0];

export interface ResolvedOrient {
  /** Mode: fixed axis, or the particle's velocity direction. */
  mode: OrientMode;
  /** Base angular velocity in rad/s (the key is rad/s —
   *  unlike the Spin key, which is deg/s by legacy). */
  speedRad: number;
  /** Per-particle speed multiplier range [1−r, 1+r], [0, 1]. */
  random: number;
  /** Angular-velocity decay rate in 1/seconds, [0, 10]. */
  damping: number;
  /** Attribute slot multiplying the angle increment, or -1. */
  slot: number;
}

/** ±4π rad/s — twice the Spin channel's ±720°/s envelope. */
export const ORIENT_SPEED_LIMIT = Math.PI * 4;

export function clampOrientSpeedRad(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-ORIENT_SPEED_LIMIT, Math.min(ORIENT_SPEED_LIMIT, v));
}

export function clampOrientRandom(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampOrientDamping(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

export function resolveOrientMode(v: unknown): OrientMode {
  return v === 'velocity' ? 'velocity' : 'axis';
}

export function resolveOrient(
  config: Pick<ParticleConfig, 'gpgpuOrientMode' | 'gpgpuOrientSpeed' | 'gpgpuOrientRandom' | 'gpgpuOrientDamping' | 'gpgpuOrientSlot'>,
): ResolvedOrient {
  return {
    mode: resolveOrientMode(config.gpgpuOrientMode),
    speedRad: clampOrientSpeedRad(config.gpgpuOrientSpeed ?? 0),
    random: clampOrientRandom(config.gpgpuOrientRandom ?? 0),
    damping: clampOrientDamping(config.gpgpuOrientDamping ?? 0),
    slot: normalizeAttrSlot(config.gpgpuOrientSlot),
  };
}

/** The orient channel (pass + geometry variant) stands only
 *  while the enable key is on. */
export function orientChannelActive(
  config: Pick<ParticleConfig, 'gpgpuOrientEnabled'>,
): boolean {
  return !!config.gpgpuOrientEnabled;
}

// ── Quaternion algebra (x, y, z, w) ──────────────────────────

export type Quat = [number, number, number, number];

export function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/**
 * Hamilton product a ⊗ b: the rotation that applies b first,
 * then a (column-vector convention, v' = q v q*). Term for
 * term with kaloOrientQuatMul in the pass GLSL and the
 * geometry vertex's consumption.
 */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatFromAxisAngle(axis: readonly [number, number, number], angle: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len <= 0.000001 || angle === 0) return quatIdentity();
  const half = angle / 2;
  const s = Math.sin(half) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** Rotate a vector by a unit quaternion (v' = q v q*). */
export function quatRotateVec(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  // Expanded form: v + 2·(w·(u×v) + u×(u×v)), u = vector part.
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  const dx = y * cz - z * cy;
  const dy = z * cx - x * cz;
  const dz = x * cy - y * cx;
  return [
    v[0] + 2 * (w * cx + dx),
    v[1] + 2 * (w * cy + dy),
    v[2] + 2 * (w * cz + dz),
  ];
}

/**
 * The 3×3 rotation matrix of a unit quaternion as 9 values in
 * GLSL mat3 constructor order (column-major: three columns).
 * Term for term with kaloQuatMat3 in the geometry vertex.
 */
export function quatToMat3Columns(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** Total rotation angle of a unit quaternion, in [0, π]. */
export function quatAngle(q: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

// ── Step law ─────────────────────────────────────────────────

export interface OrientState {
  /** Accumulated posture (unit quaternion). */
  quat: Quat;
  /** Seconds accumulated since the pass (re)started; the
   *  decay clock while the age system is off. */
  elapsed: number;
}

/** The state a particle (re)starts from: identity posture. */
export function orientInitialState(): OrientState {
  return { quat: quatIdentity(), elapsed: 0 };
}

/**
 * The angular velocity (rad/s) for one step: base rate × the
 * per-particle hash multiplier (the Spin channel's hash form,
 * shared so the two channels' random fields agree) × the
 * damping decay at tState.
 */
export function orientOmega(orient: ResolvedOrient, u: number, v: number, tState: number): number {
  const mul = spinSpeedMultiplier(u, v, orient.random);
  return orient.speedRad * mul * Math.exp(-orient.damping * Math.max(tState, 0));
}

export interface OrientStepOptions {
  /** Texel coordinates of the particle (hash input). */
  u?: number;
  v?: number;
  /** Attribute slot factor; scales the increment only. */
  slotFactor?: number;
  /** Particle age in seconds while the age system is on —
   *  the decay clock and the value the pass reads. Omit (or
   *  pass null) while ages are off: the state's own elapsed
   *  clock is used. */
  age?: number | null;
  /** Particle velocity (velocity mode's axis source). */
  vel?: readonly [number, number, number] | null;
}

/**
 * CPU twin of the orient pass's step law. Deterministic: the
 * same (state, dt, keys, options) always yields the same next
 * state, and a fresh state is exactly the identity posture.
 */
export function orientStep(state: OrientState, dt: number, orient: ResolvedOrient, opts: OrientStepOptions = {}): OrientState {
  const step = Math.max(dt, 0);
  const tState = opts.age != null ? Math.max(opts.age, 0) : state.elapsed;
  const omega = orientOmega(orient, opts.u ?? 0, opts.v ?? 0, tState);
  const slotFactor = Math.max(opts.slotFactor ?? 1, 0);
  let quat = state.quat;
  if (omega !== 0 && step > 0) {
    let axis: readonly [number, number, number] | null = null;
    if (orient.mode === 'velocity') {
      const vel = opts.vel ?? null;
      if (vel) {
        const len = Math.hypot(vel[0], vel[1], vel[2]);
        if (len > 0.0001) axis = [vel[0] / len, vel[1] / len, vel[2] / len];
      }
    } else {
      axis = ORIENT_FIXED_AXIS;
    }
    if (axis) {
      const dq = quatFromAxisAngle(axis, omega * slotFactor * step);
      quat = quatNormalize(quatMultiply(dq, state.quat));
    }
  }
  return { quat, elapsed: state.elapsed + step };
}
