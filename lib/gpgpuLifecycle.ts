import { dmHash11 } from './gpgpuRandom';
import type { ParticleConfig } from '../types';
/**
 * GPGPU lifecycle grammar (Phase AB: Spawn / Kill / global Drag &
 * Max Speed / SPH surface tension).
 *
 * Until Phase AB the main pool had exactly one lifecycle: every
 * particle was live from the first frame, aged (when the Life
 * System was on), wrapped at ageMax and respawned at a hashed
 * sphere point. This module adds the missing grammar around that
 * cycle, as pure functions with GLSL twins in
 * components/gpgpuShaderSimulationVelocity.ts and
 * components/gpgpuShaderSimulationPosition.ts:
 *
 *  - Spawn gate: a per-particle deterministic hash decides WHEN a
 *    particle joins the pool. `gpgpuSpawnBurst` is the fraction
 *    live at t = 0; the remainder is released linearly at
 *    `gpgpuSpawnRate` (pool fraction per second) until the whole
 *    pool is live. Unreleased particles are parked off-screen with
 *    zero velocity and frozen age; the release frame respawns them
 *    through the exact legacy respawn block, which is also what
 *    makes the Aux 'birthBurst' event fire for them. Defaults
 *    (burst 1, rate 1) disable the gate entirely — the shaders
 *    skip every gate expression, so the legacy render is
 *    bit-identical.
 *  - Kill conditions: a particle that leaves the bounce sphere
 *    (boundary kill) or sits in a rejected raster-mask region
 *    (mask kill, the Phase X mask evaluated with the draw clip's
 *    own rule) respawns immediately instead of bouncing / living
 *    on. Both default OFF.
 *  - Global drag / max speed: the Particle Life block's semantics
 *    (Phase AA1) promoted to the whole pool. `gpgpuDrag` is the
 *    rate of the legacy global damping factor (1 - rate * dt);
 *    its default 1.1 reproduces the historical fixed damping
 *    expression bit-for-bit. `gpgpuMaxSpeed` (0 = off) clamps the
 *    speed after the legacy 350 hard clamp, before damping —
 *    the same order the Particle Life cap uses inside its block.
 *  - SPH surface tension (approximation): a cohesion term in the
 *    SPH force sum. Each neighbour pulls the particle toward
 *    itself with the SPH kernel weight, so a droplet holds
 *    together instead of only pushing apart. This is a cohesion
 *    approximation, NOT a full surface-tension model (no
 *    curvature / colour-field gradient); the UI, the changelog
 *    and the audits say so.
 *
 * The spawn hash is the position shader's own hash1 family with a
 * fixed offset, evaluated on the texel UV — the same value in the
 * velocity pass, the position pass and here, so the three can
 * never disagree about whether a particle is live.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The legacy global damping rate: vel *= (1 - 1.1 * dt). */
export const GPGPU_LEGACY_DRAG_RATE = 1.1;
/** The legacy hard speed clamp at the end of the velocity pass. */
export const GPGPU_LEGACY_SPEED_LIMIT = 350;

// ── Spawn gate ────────────────────────────────────────────────────

export function clampSpawnRate(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.01, Math.min(1, v));
}

export function clampSpawnBurst(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/** The gate only exists when the initial burst holds particles back. */
export function isSpawnGateActive(rate: number, burst: number): boolean {
  void rate;
  return clampSpawnBurst(burst) < 1;
}

/**
 * Fraction of the pool released at spawn-time `time` (seconds
 * since the spawn epoch). burst at t = 0, then linear at `rate`
 * pool-fractions per second, capped at 1. With the gate inactive
 * this is 1 for every t >= 0.
 */
export function spawnThresholdAt(time: number, rate: number, burst: number): number {
  const b = clampSpawnBurst(burst);
  if (b >= 1) return 1;
  const r = clampSpawnRate(rate);
  const t = Math.max(0, time);
  return Math.min(1, b + r * t);
}

// ── Spawn pulse (Phase AH) ────────────────────────────────────────
// The release clock can run in pulses: within each `interval`
// seconds of wall time, the spawn clock advances only during the
// first `duty` fraction of the cycle and freezes for the rest, so
// particles are released in periodic bursts instead of a steady
// stream. Pulse time pt(t) is the amount of "live" time inside t:
//   pt(t) = (floor(t / interval) * duty + min(fract(t / interval), duty)) * interval
// duty = 1 makes pt(t) = t exactly (identity), and interval = 0
// disables pulsing entirely — the threshold functions below then
// reduce to spawnThresholdAt verbatim, and the GLSL twins keep the
// legacy expression on the same branch, so the default render is
// bit-identical.

export function clampSpawnPulseInterval(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(30, v));
}

export function clampSpawnPulseDuty(v: number): number {
  if (!Number.isFinite(v)) return 0.3;
  return Math.max(0.05, Math.min(1, v));
}

/** Pulse time pt(t): live seconds inside `time` wall seconds. */
export function spawnPulseTime(time: number, interval: number, duty: number): number {
  const t = Math.max(0, time);
  const iv = clampSpawnPulseInterval(interval);
  if (iv <= 0) return t;
  const d = clampSpawnPulseDuty(duty);
  const cyc = t / iv;
  const whole = Math.floor(cyc);
  const frac = cyc - whole;
  return (whole * d + Math.min(frac, d)) * iv;
}

/**
 * The spawn threshold with the pulse applied to the release clock.
 * With interval = 0 this IS spawnThresholdAt (same code path, not
 * an approximation); the GLSL twins branch the same way.
 */
export function spawnThresholdWithPulse(
  time: number,
  rate: number,
  burst: number,
  interval: number,
  duty: number,
): number {
  if (clampSpawnPulseInterval(interval) <= 0) return spawnThresholdAt(time, rate, burst);
  const b = clampSpawnBurst(burst);
  if (b >= 1) return 1;
  const r = clampSpawnRate(rate);
  return Math.min(1, b + r * spawnPulseTime(time, interval, duty));
}

// ── Pulse cycles + probability (Phase AX) ────────────────────────
// The periodic burst gains two controls: a cycle limit (0 =
// unlimited) and a per-cycle probability. Cycle k "fires" when a
// deterministic hash of k falls below the probability, so the
// choice is a pure function of the cycle index — the TS and GLSL
// twins can never disagree, and probability 1 fires every cycle.
// The extended pulse time accumulates live time over fired cycles
// only. Exactness bound: the first 64 cycles are summed exactly;
// beyond that the expectation (probability × cycles) is used —
// BOTH twins implement the same bound, so they stay in lockstep.
// At the defaults (cycles 0, probability 1) the extended function
// delegates to spawnPulseTime verbatim.

export function clampSpawnPulseCycles(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(64, Math.floor(v)));
}

export function clampSpawnPulseProbability(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/** Deterministic per-cycle hash in [0, 1): the DM vector
 *  hash11 of the historical seed (k + 1) * 127.1 + 3.13 * 311.7. */
export function spawnPulseCycleHash(cycle: number): number {
  const k = Math.max(0, Math.floor(cycle));
  return dmHash11((k + 1) * 127.1 + 3.13 * 311.7);
}

/** Whether cycle `cycle` fires at the given probability. */
export function spawnPulseCycleFires(cycle: number, probability: number): boolean {
  return spawnPulseCycleHash(cycle) < clampSpawnPulseProbability(probability);
}

/**
 * Pulse time with the cycle limit and probability applied. With
 * interval = 0 this returns max(t, 0); with cycles = 0 and
 * probability = 1 it IS spawnPulseTime (delegated, not re-derived).
 */
export function spawnPulseTimeExtended(
  time: number,
  interval: number,
  duty: number,
  cycles: number,
  probability: number,
): number {
  const t = Math.max(0, time);
  const iv = clampSpawnPulseInterval(interval);
  if (iv <= 0) return t;
  const cycLimit = clampSpawnPulseCycles(cycles);
  const prob = clampSpawnPulseProbability(probability);
  if (cycLimit <= 0 && prob >= 1) return spawnPulseTime(t, iv, duty);
  const d = clampSpawnPulseDuty(duty);
  const cyc = t / iv;
  let whole = Math.floor(cyc);
  const frac = cyc - whole;
  const capped = cycLimit > 0;
  if (capped && whole > cycLimit) whole = cycLimit;
  let live = 0;
  const exact = Math.min(whole, 64);
  for (let k = 0; k < exact; k++) {
    if (spawnPulseCycleFires(k, prob)) live += d * iv;
  }
  if (whole > 64) live += prob * (whole - 64) * d * iv;
  if (!capped || cyc < cycLimit) {
    const cur = whole < 64 ? (spawnPulseCycleFires(whole, prob) ? 1 : 0) : prob;
    live += cur * Math.min(frac, d) * iv;
  }
  return live;
}

/**
 * The spawn threshold with the full Phase AX pulse grammar. With
 * interval = 0 this IS spawnThresholdAt (same delegation as
 * spawnThresholdWithPulse).
 */
export function spawnThresholdFull(
  time: number,
  rate: number,
  burst: number,
  interval: number,
  duty: number,
  cycles: number,
  probability: number,
): number {
  if (clampSpawnPulseInterval(interval) <= 0) return spawnThresholdAt(time, rate, burst);
  const b = clampSpawnBurst(burst);
  if (b >= 1) return 1;
  const r = clampSpawnRate(rate);
  return Math.min(1, b + r * spawnPulseTimeExtended(time, interval, duty, cycles, probability));
}

// ── Spawn order (Phase AX) ───────────────────────────────────────
// What the gate compares the threshold against. 'hash' is the
// legacy per-texel hash. The distance modes bake a static value
// per particle from its INITIAL position: the max-normalised
// distance from the origin, so the threshold crossing releases
// particles in distance order (near first; `far` inverts the
// value). The runtime bakes these values into a texture the sim
// passes sample (uSpawnOrderTex); this module owns the math.

export type SpawnOrderMode = 'hash' | 'distance' | 'distanceFar';

export function resolveSpawnOrderMode(v: unknown): SpawnOrderMode {
  return v === 'distance' || v === 'distanceFar' ? v : 'hash';
}

/**
 * Gate values for a whole pool from its initial positions (flat
 * xyzw array, stride 4): value_i = |p_i| / max_j |p_j|, inverted
 * for the far-first mode. An all-zero pool yields all-zero values.
 */
export function buildSpawnDistanceValues(
  posData: ArrayLike<number>,
  far: boolean,
): Float32Array {
  const n = Math.floor(posData.length / 4);
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const x = posData[i * 4];
    const y = posData[i * 4 + 1];
    const z = posData[i * 4 + 2];
    const d = Math.hypot(x, y, z);
    out[i] = d;
    if (d > max) max = d;
  }
  if (max > 0) {
    for (let i = 0; i < n; i++) {
      const v = out[i] / max;
      out[i] = far ? 1 - v : v;
    }
  }
  return out;
}

/**
 * The normaliser buildSpawnDistanceValues divides by: the
 * pool's maximum initial distance from the origin (0 for an
 * all-zero pool). Exposed for the live-rules shader variant
 * (Grammar 2.0 stage 1 texture-unit fix): on a GPU whose
 * fragment texture-unit floor is already fully used by the
 * resident velocity preamble, the live variant cannot afford
 * the order texture's sampler, so its spawnGateValue derives
 * the gate value from the initial-position texture (which
 * both sim passes already sample or can sample within
 * budget) divided by this scalar, supplied as the
 * uSpawnOrderMaxDist uniform. See
 * kalokagathia-pro/STAGE1_TEXUNIT_FIX_RECORD.md.
 */
export function spawnDistanceMaxValue(posData: ArrayLike<number>): number {
  const n = Math.floor(posData.length / 4);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(posData[i * 4], posData[i * 4 + 1], posData[i * 4 + 2]);
    if (d > max) max = d;
  }
  return max;
}

/**
 * CPU twin of the live variant's derived spawnGateValue:
 * the max-normalised initial distance recomputed from one
 * particle's initial position, clamped to [0, 1] exactly as
 * the GLSL derivation clamps. Matches the corresponding
 * entry of buildSpawnDistanceValues up to float rounding
 * (the bake divides in double precision and stores float32;
 * the shader divides in float32 — the two agree to ~1 ulp,
 * and both sim passes run the identical GLSL, so the passes
 * always agree with each other).
 */
export function spawnGateDistanceValue(
  x: number,
  y: number,
  z: number,
  maxDist: number,
): number {
  const v = Math.hypot(x, y, z) / Math.max(maxDist, 1.0e-6);
  return Math.min(1, Math.max(0, v));
}

/** A particle's gate value under the full Phase AX grammar. */
export function spawnGateValueForIndex(
  index: number,
  texSize: number,
  orderValues?: ArrayLike<number> | null,
): number {
  if (orderValues && index >= 0 && index < orderValues.length) return orderValues[index];
  return spawnHashForIndex(index, texSize);
}

/**
 * spawnStateForIndex with the full grammar: pulse cycles /
 * probability and an explicit gate value (distance order). With
 * the legacy arguments it reduces to spawnStateForIndex.
 */
export function spawnStateForIndexFull(
  index: number,
  texSize: number,
  time: number,
  dt: number,
  rate: number,
  burst: number,
  interval: number,
  duty: number,
  cycles: number,
  probability: number,
  gateValue: number,
): SpawnState {
  void index;
  void texSize;
  if (!isSpawnGateActive(rate, burst)) return 'active';
  if (gateValue >= spawnThresholdFull(time, rate, burst, interval, duty, cycles, probability)) return 'parked';
  if (gateValue >= spawnThresholdFull(time - Math.max(0, dt), rate, burst, interval, duty, cycles, probability)) return 'activating';
  return 'active';
}

// ── Spawn burst event (Phase AX) ─────────────────────────────────
// A directly authored burst: at `eventTime` seconds into the
// spawn epoch, the fraction `count` of the live pool — chosen by
// the deterministic event hash below — respawns at once through
// the shared respawn block, and the velocity pass hands those
// particles the directly specified initial velocity computed by
// spawnEventVelocity (radial → hash-random direction blend by
// `spread`, which also jitters the magnitude). Parked particles
// are not touched (they have not been born yet). The event is a
// single authored instant, not a list; the periodic grammar
// above covers repetition.

export function clampSpawnEventTime(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(600, v));
}

export function clampSpawnEventCount(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampSpawnEventSpeed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(50, v));
}

export function clampSpawnEventSpread(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Event hash in [0, 1): hash1(uv + (5.39, 8.17)). GLSL twin:
 *  `spawnEventHash` in both sim shaders. */
export function spawnEventHashForUv(u: number, v: number): number {
  return dmHash11((u + 5.39) * 127.1 + (v + 8.17) * 311.7);
}

export function spawnEventHashForIndex(index: number, texSize: number): number {
  const size = Math.max(1, Math.floor(texSize));
  const idx = Math.max(0, Math.floor(index));
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  return spawnEventHashForUv(u, v);
}

/** The event fires on the single frame whose step crosses its time. */
export function spawnEventFiresAt(time: number, dt: number, eventTime: number): boolean {
  const t = clampSpawnEventTime(eventTime);
  return time - Math.max(0, dt) < t && time >= t;
}

/** Whether this particle belongs to the event's cohort. */
export function spawnEventSelects(hash: number, count: number): boolean {
  return hash < clampSpawnEventCount(count);
}

function eventHashOffset(u: number, v: number, ou: number, ov: number): number {
  return dmHash11((u + ou) * 127.1 + (v + ov) * 311.7);
}

/**
 * The general directed initial velocity (Grammar 2.0 stage 2,
 * E2): the spawn event's velocity law with the base direction
 * authored instead of read from the position. `base` is used
 * AS GIVEN (callers pass a unit vector — the event passes the
 * radial direction, the emitter passes its normalised axis),
 * direction = normalize(mix(base, hashSphere, spread)),
 * magnitude = speed · mix(1, 0.25 + 0.75 · hash, spread), with
 * the event's exact hash draws and arithmetic, so the GLSL
 * twin (kaloEmitterVelocity in the velocity helpers) and the
 * event's own twin agree term for term.
 */
export function directedInitialVelocity(
  base: Vec3Like,
  u: number,
  v: number,
  speed: number,
  spread: number,
): Vec3Like {
  const sp = clampSpawnEventSpeed(speed);
  const sr = clampSpawnEventSpread(spread);
  const th = eventHashOffset(u, v, 2.71, 6.13) * Math.PI * 2;
  const phi = Math.acos(2 * eventHashOffset(u, v, 9.43, 4.29) - 1);
  const magHash = eventHashOffset(u, v, 7.77, 1.93);
  const rx = Math.sin(phi) * Math.cos(th);
  const ry = Math.sin(phi) * Math.sin(th);
  const rz = Math.cos(phi);
  let dx = base.x + (rx - base.x) * sr;
  let dy = base.y + (ry - base.y) * sr;
  let dz = base.z + (rz - base.z) * sr;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const mag = sp * (1 + (0.25 + 0.75 * magHash - 1) * sr);
  return { x: dx * mag, y: dy * mag, z: dz * mag };
}

/**
 * The initial velocity the event hands one particle, as a pure
 * function of its position and texel UV (the GLSL twin in the
 * velocity pass uses the identical hash draws): the general
 * directed velocity with the radial direction as its base
 * (the +Y fallback for a particle at the origin is the
 * historical one).
 */
export function spawnEventVelocity(
  pos: Vec3Like,
  u: number,
  v: number,
  speed: number,
  spread: number,
): Vec3Like {
  const plen = Math.hypot(pos.x, pos.y, pos.z);
  const base: Vec3Like = plen > 0.0001
    ? { x: pos.x / plen, y: pos.y / plen, z: pos.z / plen }
    : { x: 0, y: 1, z: 0 };
  return directedInitialVelocity(base, u, v, speed, spread);
}

/**
 * Per-texel spawn hash in [0, 1): the position shader's hash1
 * (Phase DM: dmHash11 of the historical dot grammar) evaluated at
 * p = uv + (7.77, 3.13). The GLSL twin is `spawnHash` in both sim
 * shaders; keep the constants in sync.
 */
export function spawnHashForUv(u: number, v: number): number {
  return dmHash11((u + 7.77) * 127.1 + (v + 3.13) * 311.7);
}

export function spawnHashForIndex(index: number, texSize: number): number {
  const size = Math.max(1, Math.floor(texSize));
  const idx = Math.max(0, Math.floor(index));
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  return spawnHashForUv(u, v);
}

export type SpawnState = 'active' | 'activating' | 'parked';

/**
 * A particle's spawn state at spawn-time `time`, where `dt` is the
 * frame step: 'parked' while its hash is at/above the current
 * threshold, 'activating' on the single frame the threshold
 * crosses its hash (the frame the position pass respawns it), and
 * 'active' afterwards.
 */
export function spawnStateForIndex(
  index: number,
  texSize: number,
  time: number,
  dt: number,
  rate: number,
  burst: number,
): SpawnState {
  if (!isSpawnGateActive(rate, burst)) return 'active';
  const h = spawnHashForIndex(index, texSize);
  if (h >= spawnThresholdAt(time, rate, burst)) return 'parked';
  if (h >= spawnThresholdAt(time - Math.max(0, dt), rate, burst)) return 'activating';
  return 'active';
}

/** How many of the pool's particles are live (active or activating). */
export function countSpawnLive(texSize: number, time: number, rate: number, burst: number): number {
  const size = Math.max(1, Math.floor(texSize));
  const thr = spawnThresholdAt(time, rate, burst);
  let n = 0;
  for (let i = 0; i < size * size; i++) {
    if (spawnHashForIndex(i, size) < thr) n++;
  }
  return n;
}

// ── Kill conditions ───────────────────────────────────────────────

/** Boundary kill: the particle's centre is outside the bounce sphere. */
export function killBoundaryHit(pos: Vec3Like, bounceRadius: number): boolean {
  const r = Math.max(1, bounceRadius);
  const d = Math.hypot(pos.x, pos.y, pos.z);
  return d > r + 0.001;
}

/**
 * Mask kill predicate on a sampled luminance: exactly the draw
 * clip's rule (Phase X) — apply the invert flag, then reject
 * below the threshold.
 */
export function killMaskHit(luma: number, threshold: number, invert: boolean): boolean {
  const l = invert ? 1 - luma : luma;
  const t = Math.max(0, Math.min(1, threshold));
  return l < t;
}

/** Mask UV for a world XY position (the shared map UV rule). */
export function maskUvForWorld(x: number, y: number, bounceRadius: number): { u: number; v: number } {
  const scale = 1 / (2 * Math.max(1, bounceRadius));
  return {
    u: Math.max(0, Math.min(1, x * scale + 0.5)),
    v: Math.max(0, Math.min(1, y * scale + 0.5)),
  };
}

// ── Global drag / max speed ───────────────────────────────────────

export function clampGlobalDrag(v: number): number {
  if (!Number.isFinite(v)) return GPGPU_LEGACY_DRAG_RATE;
  return Math.max(0, Math.min(10, v));
}

export function clampGlobalMaxSpeed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

/**
 * The global damping step: vel *= (1 - rate * dt). At the default
 * rate this is the legacy expression verbatim (no clamping — the
 * legacy factor is unclamped too).
 */
export function applyGlobalDrag(vel: Vec3Like, dragRate: number, dt: number): Vec3Like {
  const f = 1 - clampGlobalDrag(dragRate) * dt;
  return { x: vel.x * f, y: vel.y * f, z: vel.z * f };
}

/** Global speed cap: 0 = no cap (the legacy 350 hard clamp is separate). */
export function clampVelocityToGlobalMaxSpeed(vel: Vec3Like, maxSpeed: number): Vec3Like {
  const cap = clampGlobalMaxSpeed(maxSpeed);
  if (cap <= 0) return { ...vel };
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed <= cap || speed === 0) return { ...vel };
  const k = cap / speed;
  return { x: vel.x * k, y: vel.y * k, z: vel.z * k };
}

// ── SPH surface tension (cohesion approximation) ─────────────────

/** SPH kernel weight shared with the shader: w = max(0, 1 - q^2). */
export function sphKernelWeight(distance: number, radius: number): number {
  const h = Math.max(0.001, radius);
  const q = distance / h;
  return Math.max(0, 1 - q * q);
}

export function clampSphSurfaceTension(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

/**
 * Cohesion sum for one particle: every neighbour inside the SPH
 * radius pulls the particle toward itself, weighted by the kernel
 * (the GLSL twin accumulates the identical sum in the SPH loop).
 * The shader applies the sum at tension * dt * 1.0 — a much
 * gentler gain than the pressure / viscosity forces (x15); at
 * x15 the spring heated the cloud on the Phase AB gate. Zero
 * tension or no neighbours gives the zero vector.
 *
 * Surface selectivity (Phase 15): when `selectivity` > 0 the sum
 * is scaled by mix(1, 1 - density / restDensity, selectivity) —
 * the same density-deficit weighting as the shader. The caller
 * supplies the particle's kernel density (the shader accumulates
 * its own in the same loop). Defaults keep the AB behaviour.
 */
export function sphSurfaceTensionForce(
  selfPos: Vec3Like,
  neighbours: ReadonlyArray<{ pos: Vec3Like }>,
  radius: number,
  tension: number,
  selectivity = 0,
  density = 0,
  restDensity = 1,
): Vec3Like {
  const out = { x: 0, y: 0, z: 0 };
  if (clampSphSurfaceTension(tension) <= 0) return out;
  const h = Math.max(0.001, radius);
  const h2 = h * h;
  for (const other of neighbours) {
    const dx = other.pos.x - selfPos.x;
    const dy = other.pos.y - selfPos.y;
    const dz = other.pos.z - selfPos.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= h2 || r2 <= 0.001) continue;
    const rl = Math.sqrt(r2);
    const w = sphKernelWeight(rl, h);
    // Offset-weighted (spring form), identical to the shader: the
    // pull grows with the offset and vanishes at zero distance. A
    // constant-magnitude (normalised) pull injected energy under
    // discrete integration and measurably heated / expanded the
    // cloud on the Phase AB real-GPU gate.
    out.x += (dx / h) * w;
    out.y += (dy / h) * w;
    out.z += (dz / h) * w;
  }
  if (selectivity > 0) {
    const deficit = 1 - Math.min(1, Math.max(0, density / Math.max(0.0001, restDensity)));
    const factor = 1 + (deficit - 1) * Math.min(1, Math.max(0, selectivity));
    out.x *= factor;
    out.y *= factor;
    out.z *= factor;
  }
  return out;
}

// ── SPH surface tension, Akinci form (Phase 24, design §9-1 E) ──

/**
 * Cohesion kernel of Akinci et al. 2013, in the normalised
 * coordinate q = distance / radius: (1-q)^3 q^3 on (0.5, 1],
 * 2(1-q)^3 q^3 - 1/64 on [0, 0.5], 0 outside. The sign is the
 * point: negative (repulsive, and small) at very short range,
 * positive (attractive) through the mid range with its peak
 * 1/64 at q = 0.5, and exactly 0 at q = 1 — a droplet is pulled
 * together without a hard core that discrete integration can
 * pump energy into.
 */
export function sphAkinciCohesionKernel(q: number): number {
  if (!(q >= 0) || q >= 1) return 0;
  const omq = 1 - q;
  const base = omq * omq * omq * q * q * q;
  return q <= 0.5 ? 2.0 * base - 0.015625 : base;
}

/**
 * Scale on the Akinci kernel inside the force sum. The kernel
 * peaks at 1/64, so x32 puts one sample's largest pull at 0.5 —
 * the same order as one legacy cohesion sample ((offset / h) * w
 * is at most 1). Chosen against the legacy sum's magnitude, NOT
 * against the pressure gain: the Phase AB lesson is that gains
 * in this family stay gentle and separated (the shader applies
 * the finished sum at strength * dt * 1.0, like the AB term).
 */
export const SPH_AKINCI_COHESION_SCALE = 32.0;

/**
 * Gain on the curvature term. At the default radius (h = 40)
 * the term's surface value (-lap x gate^2, see below) is ~0.05,
 * so x8 lands it at ~0.4 — a gentle bias under the cohesion
 * sum, never near the x15 pressure gain. History: the first
 * Phase 24 real-GPU gate round ran gain 25 with an unweighted
 * Laplacian and a linear gate, and the live sim heated
 * intermittently (one run contracted 19%, the next expanded
 * 15% past the no-tension control): a sample crossing the
 * kernel boundary kicked the constant-per-sample Laplacian,
 * and the sampled neighbourhood changes discontinuously. The
 * shipped form mollifies the Laplacian with the colour kernel
 * itself (samples fade at the boundary instead of kicking),
 * squares the gate, and cuts the gain to 8.
 */
export const SPH_AKINCI_CURVATURE_GAIN = 8.0;

/**
 * Hard cap on the length of the finished Akinci sum (cohesion
 * + curvature) before the strength is applied. Added in Phase
 * 24 gate round 3: at strength 3.0 one run in two still blew
 * up in the late window (+39% spread past the control) while
 * strength 1.5 was stable across three runs — the tail of the
 * sum (a dense clump whose samples align) is what explicit
 * integration pumps, so the sum is clamped to 3.0, well above
 * its typical operating magnitude (~1) and far under the
 * theoretical per-sample bound. A bounded force cannot pump
 * energy without limit in one step; this is the same
 * discipline as the separated gains, applied to the tail.
 */
export const SPH_AKINCI_FORCE_CAP = 3.0;

/**
 * Akinci two-term surface tension sum for one particle — the
 * TS twin of the GLSL accumulation in the SPH sample loop
 * (components/gpgpuShaderSimulationVelocityMainSphGrains.ts,
 * sphAkinci variant). Same discrete form, same accumulation
 * order (per neighbour: cohesion, colour gradient, Laplacian),
 * so the two can be held bit-comparable. The shader applies
 * the returned sum at strength * dt * 1.0, additively with the
 * legacy cohesion sum; `strength` here only gates the zero
 * case, exactly like sphSurfaceTensionForce's tension.
 *
 * Term 1 — cohesion: unit vector toward each neighbour times
 * the Akinci kernel (see sphAkinciCohesionKernel), x32.
 *
 * Term 2 — curvature: the colour field of the shared kernel
 * w = max(0, 1-q^2) has gradient gradC = sum of -2r / h^2 over
 * the samples (r = self - neighbour); its exact Laplacian is
 * the constant -6/h^2 per sample, accumulated here MOLLIFIED
 * by w itself (lapC = sum of -6w / h^2) so a sample fades as
 * it crosses the kernel boundary instead of kicking the sum
 * — the first Phase 24 gate round showed the unweighted form
 * heating the live sim intermittently. gradC is the surface
 * normal: it points toward the bulk and cancels for an
 * interior particle. The mean curvature estimate is the CSF
 * identity kappa = -lapC / |gradC| (divergence of the
 * normalised gradient, Hessian term dropped), and the force
 * is kappa x |gradC| x gate^2 along the inward normal — i.e.
 * -lapC along the normal, gated by |gradC| itself (the CSF
 * interface delta, in units of the radius: gate =
 * clamp(|gradC| * h * 0.25, 0, 1), applied squared so the
 * noisy mid-gate region contributes least). Inside the
 * droplet |gradC| ~ 0, so the term vanishes there; the
 * product is bounded by 6 * samples / h^2 x gain regardless
 * of how small |gradC| gets, so the term cannot spike.
 */
export function sphSurfaceTensionAkinciForce(
  selfPos: Vec3Like,
  neighbours: ReadonlyArray<{ pos: Vec3Like }>,
  radius: number,
  strength: number,
): Vec3Like {
  const out = { x: 0, y: 0, z: 0 };
  if (clampSphSurfaceTension(strength) <= 0) return out;
  const h = Math.max(0.001, radius);
  const h2 = h * h;
  let cohX = 0;
  let cohY = 0;
  let cohZ = 0;
  let gradX = 0;
  let gradY = 0;
  let gradZ = 0;
  let lap = 0;
  for (const other of neighbours) {
    const dx = other.pos.x - selfPos.x;
    const dy = other.pos.y - selfPos.y;
    const dz = other.pos.z - selfPos.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= h2 || r2 <= 0.001) continue;
    const rl = Math.sqrt(r2);
    const q = rl / h;
    const kA = sphAkinciCohesionKernel(q) * SPH_AKINCI_COHESION_SCALE;
    cohX += (dx / rl) * kA;
    cohY += (dy / rl) * kA;
    cohZ += (dz / rl) * kA;
    // r = self - neighbour = -(d), accumulated in the same
    // expression shape as the shader's (-2.0 * r) / h2.
    gradX += (-2.0 * -dx) / h2;
    gradY += (-2.0 * -dy) / h2;
    gradZ += (-2.0 * -dz) / h2;
    lap += (-6.0 / h2) * Math.max(0, 1 - q * q);
  }
  const gradLen = Math.sqrt(gradX * gradX + gradY * gradY + gradZ * gradZ);
  let curvX = 0;
  let curvY = 0;
  let curvZ = 0;
  if (gradLen > 0.000001) {
    const kappa = -lap / gradLen;
    const gate = Math.min(1, Math.max(0, gradLen * h * 0.25));
    const scale = kappa * gradLen * gate * gate * SPH_AKINCI_CURVATURE_GAIN;
    curvX = (gradX / gradLen) * scale;
    curvY = (gradY / gradLen) * scale;
    curvZ = (gradZ / gradLen) * scale;
  }
  out.x = cohX + curvX;
  out.y = cohY + curvY;
  out.z = cohZ + curvZ;
  const sumLen = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  if (sumLen > SPH_AKINCI_FORCE_CAP) {
    const s = SPH_AKINCI_FORCE_CAP / sumLen;
    out.x *= s;
    out.y *= s;
    out.z *= s;
  }
  return out;
}

/**
 * The generic surface-tension placement (Layer 1 WP5 phase C
 * judgment, wired in phase D): the Akinci law above also
 * stands as a general force-order chunk ('surface-tension')
 * that runs its OWN neighbour scan, so a pool without the SPH
 * solver can still carry the law. The mutual-exclusion
 * discipline is resolved here, on the CPU side, exactly once:
 * the SPH accumulation only runs inside `if (uSphEnabled)`,
 * so while the SPH solver stands, the SPH form applies the
 * law and the generic chunk stays out of the string; while
 * SPH is off, the generic chunk applies it. Either way the
 * law applies exactly once for a given strength key
 * (gpgpuSphSurfaceTensionAkinci, shared by both placements —
 * the strength is a property of the law, not of the solver).
 */
export function genericSurfaceTensionActive(
  config: Pick<ParticleConfig, 'gpgpuSphEnabled' | 'gpgpuSphSurfaceTensionAkinci'>,
): boolean {
  return (config.gpgpuSphSurfaceTensionAkinci || 0) > 0 && !config.gpgpuSphEnabled;
}

// ── Lifetime jitter (Layer 1 WP4, phase A) ──────────────────────
// Until this phase the age ceiling was one number for the whole
// pool: every particle wrapped at exactly gpgpuAgeMax, so a
// cohort born together also died together (the missing grammar
// behind TP §2-10, the lifetime part of tyFlow §2-06 and the
// lifetime part of RealFlow §2 emission control). The jitter
// spreads the ceiling per particle: each particle's effective
// age max is gpgpuAgeMax × m, where m is a deterministic-hash
// multiplier uniform in [1 - j, 1 + j] (mean exactly 1, so the
// pool-average lifetime is unchanged). j is the config key
// gpgpuAgeMaxJitter; at its default 0 every multiplier is
// exactly 1 and the lifecycle is the legacy one, bit for bit.
//
// This phase ships the pure functions and their key only; the
// position pass applies the multiplier in phase C. (Phase C
// has since landed: while ageJitterVariantActive stands, the
// position pass builds the age-jitter variant string —
// components/gpgpuShaderSimulationPosition.ts — and the age
// test reads uAgeMax * lifetimeMultiplier(vUv, uAgeMaxJitter),
// with uAgeMaxJitter supplied per frame by the passes.) The draw is
// a dedicated dmHash11 offset — NOT the spawn hash and NOT the
// event hash — so lifetime is decorrelated from release order
// and event cohorts, and the same value is available in the
// position pass, the velocity pass and here, so the three can
// never disagree about when a particle dies.
//
// GLSL transcription (phase C, position pass; the hash body is
// the shared dmHash11 twin, cf. auxHash in gpgpuShaderAux.ts):
//   float ageJitterHash(vec2 uv) {
//     float n = (uv.x + 11.31) * 127.1 + (uv.y + 4.77) * 311.7;
//     vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
//     p3 += dot(p3, p3.yxz + 33.33);
//     return fract((p3.x + p3.y) * p3.z);
//   }
//   float lifetimeMultiplier(vec2 uv, float jitter) {
//     float j = clamp(jitter, 0.0, 1.0);
//     return 1.0 + (2.0 * ageJitterHash(uv) - 1.0) * j;
//   }
//   // the age test at gpgpuShaderSimulationPosition.ts:604
//   // becomes, with the uAgeMaxJitter uniform supplied:
//   if (age > uAgeMax * lifetimeMultiplier(vUv, uAgeMaxJitter)) ageRespawn = true;

/** Lifetime jitter amount: 0 = uniform lifetime (default). */
export function clampAgeMaxJitter(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Lifetime hash in [0, 1): dmHash11 of the texel UV with the
 * dedicated lifetime offset (11.31, 4.77). GLSL twin:
 * `ageJitterHash` above; keep the constants in sync.
 */
export function ageJitterHashForUv(u: number, v: number): number {
  return dmHash11((u + 11.31) * 127.1 + (v + 4.77) * 311.7);
}

export function ageJitterHashForIndex(index: number, texSize: number): number {
  const size = Math.max(1, Math.floor(texSize));
  const idx = Math.max(0, Math.floor(index));
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  return ageJitterHashForUv(u, v);
}

/**
 * The lifetime multiplier for one hash draw: uniform in
 * [1 - j, 1 + j], exactly 1 at j = 0 (and for a non-finite
 * hash, so a bad draw can never kill or immortalise a
 * particle). The hash is clamped into [0, 1] defensively;
 * dmHash11 draws already land in [0, 1).
 */
export function lifetimeMultiplierFromHash(hash: number, jitter: number): number {
  const j = clampAgeMaxJitter(jitter);
  if (j <= 0) return 1;
  if (!Number.isFinite(hash)) return 1;
  const h = Math.min(1, Math.max(0, hash));
  return 1 + (2 * h - 1) * j;
}

/** A particle's lifetime multiplier from its texel UV. */
export function lifetimeMultiplierForUv(u: number, v: number, jitter: number): number {
  return lifetimeMultiplierFromHash(ageJitterHashForUv(u, v), jitter);
}

/** A particle's lifetime multiplier from its pool index. */
export function lifetimeMultiplierForIndex(index: number, texSize: number, jitter: number): number {
  return lifetimeMultiplierFromHash(ageJitterHashForIndex(index, texSize), jitter);
}

/**
 * A particle's effective age ceiling: gpgpuAgeMax spread by
 * its lifetime multiplier. This is the value phase C's age
 * test compares against (age > particleAgeMax(...)).
 */
export function particleAgeMax(
  ageMax: number,
  index: number,
  texSize: number,
  jitter: number,
): number {
  return ageMax * lifetimeMultiplierForIndex(index, texSize, jitter);
}

/**
 * True while the jitter key is above zero: the position
 * pass then builds the age-jitter variant string (phase
 * C). At the default 0 every multiplier is exactly 1, the
 * variant never stands and the shipped string is used.
 */
export function ageJitterVariantActive(
  config: { gpgpuAgeMaxJitter?: number | null },
): boolean {
  return clampAgeMaxJitter(config.gpgpuAgeMaxJitter ?? 0) > 0;
}
