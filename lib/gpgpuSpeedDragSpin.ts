/**
 * Speed / relative drag / Spin channel (Grammar 2.0 stage 2,
 * slice B3). The single resolution point for the three motion
 * items the stage-2 design (§3 B3) groups together:
 *
 *   - Speed absolute setting (plan item 3): the velocity tail
 *     sets the speed MAGNITUDE to a target value — the pool
 *     previously had only upper clamps (gpgpuMaxSpeed, the
 *     hard 350 ceiling). Implemented as a setting term inside
 *     the existing velocity pass (no new pass): the tail's
 *     final magnitude operation, after the clamps, the global
 *     drag and the velocity-over-lifetime curve, so the value
 *     the author sets is the value the position pass
 *     integrates (the boundary reflection preserves magnitude
 *     wherever it sits relative to the block). Blend 1 (the
 *     default) is a hard set; lower
 *     blends approach the target geometrically per step. A
 *     zero-velocity particle has no direction to scale and is
 *     left untouched. The effective target is capped at the
 *     pool's hard ceiling (350), so the setting can never
 *     defeat the safety clamp.
 *   - Relative-velocity drag (plan item 5): a NEW force chunk
 *     ('rel-drag') with the law vel += (windVel − vel) ·
 *     (1 − exp(−k·dt)) — the particle relaxes toward the wind
 *     velocity instead of receiving the legacy wind's additive
 *     acceleration. The wind velocity is a NEW unit definition
 *     (the legacy wind keys carry an acceleration strength,
 *     not a speed): direction from the legacy wind direction
 *     keys, magnitude from gpgpuRelDragWindSpeed, in the
 *     pool's velocity units (1 unit = 60 world units/second
 *     under the position pass's integration).
 *   - Spin (plan item 4): the stage's ONE exception to the
 *     attribute-slot rule (design §1, judgment 1) — angle and
 *     angular velocity are ACCUMULATED state, so they live in
 *     a dedicated ping-pong render-target pair
 *     (components/gpgpuSpinPass.ts): .x = angle (radians,
 *     wrapped to [0, 2π)), .y = angular velocity (rad/s). The
 *     draw side's two analytic rotation systems (points sprite
 *     rotation, instanced-geometry self-rotation) consume the
 *     accumulated angle while the channel is on, replacing
 *     their closed forms.
 *
 * Per-particle modulation of all three items rides the
 * attribute slots (judgment 1): the target speed and the drag
 * coefficient are multiplied by the particle's slot value, and
 * the spin channel's slot factor multiplies the angle
 * increment (the state's own omega stays slot-free, so a
 * changing slot value cannot compound into the state). A slot
 * of -1 (the default) means no modulation — factor exactly 1.
 *
 * Everything here is inert at the key defaults: target speed
 * 0 = off, drag rate 0 = off, spin disabled. The shader
 * variants exist only while the matching predicate holds (the
 * Phase 19 splicing discipline), so the stock shader strings
 * stay byte-identical.
 */
import type { ParticleConfig } from '../types';
import { normalizeAttrSlot } from './gpgpuAttributes';

export const TAU = Math.PI * 2;
/** The pool's hard speed ceiling (the velocity tail's literal
 *  350 clamp). The target-speed setting is capped to it. */
export const SPEED_HARD_CEILING = 350;

// ── Target speed ─────────────────────────────────────────────

export interface ResolvedTargetSpeed {
  /** Target magnitude in velocity units, clamped [0, 350]. */
  speed: number;
  /** Per-step approach blend, clamped [0, 1]. 1 = hard set. */
  blend: number;
  /** Attribute slot multiplying the target, or -1. */
  slot: number;
}

export function clampTargetSpeed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(SPEED_HARD_CEILING, v));
}

export function clampTargetSpeedBlend(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

export function resolveTargetSpeed(
  config: Pick<ParticleConfig, 'gpgpuTargetSpeed' | 'gpgpuTargetSpeedBlend' | 'gpgpuTargetSpeedSlot'>,
): ResolvedTargetSpeed {
  return {
    speed: clampTargetSpeed(config.gpgpuTargetSpeed ?? 0),
    blend: clampTargetSpeedBlend(config.gpgpuTargetSpeedBlend ?? 1),
    slot: normalizeAttrSlot(config.gpgpuTargetSpeedSlot),
  };
}

/** The tail variant stands only while a positive target is set. */
export function targetSpeedActive(
  config: Pick<ParticleConfig, 'gpgpuTargetSpeed'>,
): boolean {
  return clampTargetSpeed(config.gpgpuTargetSpeed ?? 0) > 0;
}

/**
 * CPU twin of the tail's target-speed block. Scales `vel` so
 * its magnitude moves toward `target · slotFactor` by `blend`
 * (1 = exact set). A (near-)zero velocity has no direction and
 * is returned unchanged; the target is capped at the hard
 * ceiling. Returns a new [x, y, z].
 */
export function applyTargetSpeed(
  vel: readonly [number, number, number],
  target: number,
  blend: number,
  slotFactor = 1,
): [number, number, number] {
  const spd = Math.hypot(vel[0], vel[1], vel[2]);
  if (spd <= 0.00001) return [vel[0], vel[1], vel[2]];
  const effTarget = Math.min(Math.max(target, 0) * Math.max(slotFactor, 0), SPEED_HARD_CEILING);
  const next = spd + (effTarget - spd) * Math.max(0, Math.min(1, blend));
  const k = next / spd;
  return [vel[0] * k, vel[1] * k, vel[2] * k];
}

// ── Relative-velocity drag ───────────────────────────────────

export interface ResolvedRelDrag {
  /** Relaxation rate in 1/seconds, clamped [0, 100]. */
  rate: number;
  /** Wind speed magnitude in velocity units, clamped [0, 350]. */
  windSpeed: number;
  /** The wind velocity vector (direction keys × windSpeed). */
  windVel: { x: number; y: number; z: number };
  /** Attribute slot multiplying the rate, or -1. */
  slot: number;
}

export function clampRelDragRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function clampRelDragWindSpeed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(SPEED_HARD_CEILING, v));
}

/**
 * The wind velocity vector: the legacy wind chunk's direction
 * law (normalize of the direction keys + 0.0001) at the new
 * key's magnitude.
 */
export function resolveRelDragWindVelocity(
  config: Pick<ParticleConfig, 'gpgpuWindX' | 'gpgpuWindY' | 'gpgpuWindZ' | 'gpgpuRelDragWindSpeed'>,
): { x: number; y: number; z: number } {
  const speed = clampRelDragWindSpeed(config.gpgpuRelDragWindSpeed ?? 0);
  const x = (config.gpgpuWindX ?? 0) + 0.0001;
  const y = (config.gpgpuWindY ?? 0) + 0.0001;
  const z = (config.gpgpuWindZ ?? 0) + 0.0001;
  const len = Math.hypot(x, y, z) || 1;
  return { x: (x / len) * speed, y: (y / len) * speed, z: (z / len) * speed };
}

export function resolveRelDrag(
  config: Pick<ParticleConfig, 'gpgpuRelDragRate' | 'gpgpuRelDragWindSpeed' | 'gpgpuRelDragSlot' | 'gpgpuWindX' | 'gpgpuWindY' | 'gpgpuWindZ'>,
): ResolvedRelDrag {
  return {
    rate: clampRelDragRate(config.gpgpuRelDragRate ?? 0),
    windSpeed: clampRelDragWindSpeed(config.gpgpuRelDragWindSpeed ?? 0),
    windVel: resolveRelDragWindVelocity(config),
    slot: normalizeAttrSlot(config.gpgpuRelDragSlot),
  };
}

/** The 'rel-drag' chunk variant stands only while rate > 0. */
export function relDragActive(
  config: Pick<ParticleConfig, 'gpgpuRelDragRate'>,
): boolean {
  return clampRelDragRate(config.gpgpuRelDragRate ?? 0) > 0;
}

/**
 * CPU twin of the 'rel-drag' chunk: exponential relaxation of
 * `vel` toward the wind velocity at `rate · slotFactor` per
 * second. Returns a new [x, y, z].
 */
export function applyRelDrag(
  vel: readonly [number, number, number],
  windVel: { x: number; y: number; z: number },
  rate: number,
  dt: number,
  slotFactor = 1,
): [number, number, number] {
  const k = 1 - Math.exp(-Math.max(rate, 0) * Math.max(slotFactor, 0) * Math.max(dt, 0));
  return [
    vel[0] + (windVel.x - vel[0]) * k,
    vel[1] + (windVel.y - vel[1]) * k,
    vel[2] + (windVel.z - vel[2]) * k,
  ];
}

// ── Spin channel ─────────────────────────────────────────────

export interface ResolvedSpin {
  /** Base angular velocity in rad/s (config key is deg/s). */
  speedRad: number;
  /** Per-particle speed multiplier range [1−r, 1+r], [0, 1]. */
  random: number;
  /** Angular-velocity decay rate in 1/seconds, [0, 10]. */
  damping: number;
  /** Attribute slot multiplying the angle increment, or -1. */
  slot: number;
}

export function clampSpinSpeedDeg(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-720, Math.min(720, v));
}

export function clampSpinRandom(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampSpinDamping(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

export function resolveSpin(
  config: Pick<ParticleConfig, 'gpgpuSpinSpeed' | 'gpgpuSpinRandom' | 'gpgpuSpinDamping' | 'gpgpuSpinSlot'>,
): ResolvedSpin {
  return {
    speedRad: (clampSpinSpeedDeg(config.gpgpuSpinSpeed ?? 0) * Math.PI) / 180,
    random: clampSpinRandom(config.gpgpuSpinRandom ?? 0),
    damping: clampSpinDamping(config.gpgpuSpinDamping ?? 0),
    slot: normalizeAttrSlot(config.gpgpuSpinSlot),
  };
}

/** The spin channel (pass + draw variants) stands only while
 *  the enable key is on. */
export function spinChannelActive(
  config: Pick<ParticleConfig, 'gpgpuSpinEnabled'>,
): boolean {
  return !!config.gpgpuSpinEnabled;
}

const fract = (v: number): number => v - Math.floor(v);

/**
 * The texel phase hash, term for term with the GEOM_VERT phase
 * hash (and the spin pass's GLSL copy): a [0, 1) phase per
 * texel, decorrelated across the pool.
 */
export function spinPhaseHash(u: number, v: number): number {
  const n = u * 127.1 + v * 311.7;
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/**
 * The per-particle speed multiplier hash: the GEOM_VERT
 * spinHash2 form (the phase hash family at the +19.19 / +7.77
 * offset, so phase and speed stay decorrelated).
 */
export function spinSpeedHash(u: number, v: number): number {
  const n = (u + 19.19) * 127.1 + (v + 7.77) * 311.7;
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/** Per-particle angular-velocity multiplier in [1−r, 1+r]. */
export function spinSpeedMultiplier(u: number, v: number, random: number): number {
  const r = clampSpinRandom(random);
  if (r <= 0) return 1;
  return 1 - r + 2 * r * spinSpeedHash(u, v);
}

export interface SpinState {
  /** Accumulated angle in radians, wrapped to [0, 2π). */
  angle: number;
  /** Current angular velocity in rad/s. */
  omega: number;
}

/** The state a particle (re)starts from: the hash phase as the
 *  initial angle (the geometry spin's phase convention) and
 *  the base rate folded with the per-particle multiplier. */
export function spinInitialState(u: number, v: number, spin: ResolvedSpin): SpinState {
  return {
    angle: spinPhaseHash(u, v) * TAU,
    omega: spin.speedRad * spinSpeedMultiplier(u, v, spin.random),
  };
}

/**
 * CPU twin of the spin pass's step law: the state's omega
 * decays by the damping rate, then the angle advances by
 * omega · slotFactor · dt and wraps into [0, 2π). The slot
 * factor scales the INCREMENT only — it never enters the
 * state, so a per-frame slot change cannot compound.
 */
export function spinStep(state: SpinState, dt: number, spin: ResolvedSpin, slotFactor = 1): SpinState {
  const step = Math.max(dt, 0);
  const omega = state.omega * Math.exp(-spin.damping * step);
  let angle = state.angle + omega * Math.max(slotFactor, 0) * step;
  angle = ((angle % TAU) + TAU) % TAU;
  return { angle, omega };
}

// ── Shared slot-supply predicate ─────────────────────────────

type B3SlotConfig = Pick<
  ParticleConfig,
  | 'gpgpuTargetSpeed' | 'gpgpuTargetSpeedSlot'
  | 'gpgpuRelDragRate' | 'gpgpuRelDragSlot'
  | 'gpgpuSpinEnabled' | 'gpgpuSpinSlot'
>;

/**
 * Any B3 consumer reading an attribute slot: the attribute
 * bake must stand and the velocity pass must raise its
 * attribute fetch while one of these holds (the B1 layer
 * predicate's connection discipline, shared by the runtime's
 * standing condition and the passes' uAttrEnabled).
 */
export function b3SlotAttrActive(config: B3SlotConfig): boolean {
  if (targetSpeedActive(config) && normalizeAttrSlot(config.gpgpuTargetSpeedSlot) >= 0) return true;
  if (relDragActive(config) && normalizeAttrSlot(config.gpgpuRelDragSlot) >= 0) return true;
  if (spinChannelActive(config) && normalizeAttrSlot(config.gpgpuSpinSlot) >= 0) return true;
  return false;
}
