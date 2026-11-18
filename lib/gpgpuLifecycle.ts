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

/** Deterministic per-cycle hash in [0, 1): hash1((k + 1, 3.13)). */
export function spawnPulseCycleHash(cycle: number): number {
  const k = Math.max(0, Math.floor(cycle));
  const s = Math.sin((k + 1) * 127.1 + 3.13 * 311.7) * 43758.5453;
  return s - Math.floor(s);
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
  const s = Math.sin((u + 5.39) * 127.1 + (v + 8.17) * 311.7) * 43758.5453;
  return s - Math.floor(s);
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
  const s = Math.sin((u + ou) * 127.1 + (v + ov) * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The initial velocity the event hands one particle, as a pure
 * function of its position and texel UV (the GLSL twin in the
 * velocity pass uses the identical hash draws): direction =
 * normalize(mix(radial, hashSphere, spread)), magnitude =
 * speed · mix(1, 0.25 + 0.75 · hash, spread).
 */
export function spawnEventVelocity(
  pos: Vec3Like,
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
  const plen = Math.hypot(pos.x, pos.y, pos.z);
  const ax = plen > 0.0001 ? pos.x / plen : 0;
  const ay = plen > 0.0001 ? pos.y / plen : 1;
  const az = plen > 0.0001 ? pos.z / plen : 0;
  let dx = ax + (rx - ax) * sr;
  let dy = ay + (ry - ay) * sr;
  let dz = az + (rz - az) * sr;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const mag = sp * (1 + (0.25 + 0.75 * magHash - 1) * sr);
  return { x: dx * mag, y: dy * mag, z: dz * mag };
}

/**
 * Per-texel spawn hash in [0, 1): the position shader's hash1
 * (fract(sin(dot(p, (127.1, 311.7))) * 43758.5453)) evaluated at
 * p = uv + (7.77, 3.13). The GLSL twin is `spawnHash` in both sim
 * shaders; keep the constants in sync.
 */
export function spawnHashForUv(u: number, v: number): number {
  const s = Math.sin((u + 7.77) * 127.1 + (v + 3.13) * 311.7) * 43758.5453;
  return s - Math.floor(s);
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
 * The caller scales by tension * dt * 15, the same application
 * factor as the pressure / viscosity forces. Zero tension or no
 * neighbours gives the zero vector.
 */
export function sphSurfaceTensionForce(
  selfPos: Vec3Like,
  neighbours: ReadonlyArray<{ pos: Vec3Like }>,
  radius: number,
  tension: number,
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
  return out;
}
