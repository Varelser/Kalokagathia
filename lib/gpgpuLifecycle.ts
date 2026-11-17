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
