// Spawn allocator (Grammar 2.0 stage 2, slice E2).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E2.
//
// Until this slice the main pool's births were governed by
// three separate mechanisms that never shared a decision: the
// spawn gate released parked particles at a FRACTION of the
// pool per second (gpgpuSpawnRate), the initial burst fixed
// how many were live at t = 0, and the spawn event re-birthed
// a hash-chosen cohort at an authored instant. The Aux pool,
// by contrast, has had a real slot allocator since Phase Q:
// free slots watch for a trigger and claim births in a fixed
// deterministic order. This module ports that allocator
// semantics to the main pool as pure functions — the single
// place that decides WHO is born, in what order, and how many:
//
//  - Demand: an absolute rate (particles per second, the new
//    gpgpuSpawnRateAbsolute key) converted to a per-frame
//    quota by exact fractional accumulation (spawnAllocQuota),
//    so a rate of N/s allocates exactly N slots per second of
//    spawn time, with no probability roll. The Aux emit mode
//    converts its rate to a per-tick probability instead
//    (lib/auxEmit.ts) — the difference is deliberate: the main
//    gate is a threshold over the whole pool, so an exact
//    quota is both available and deterministic, while the Aux
//    scan is per-slot and can only roll.
//  - Order: the reuse order is FIXED — parked slots first
//    (spawn-gate parked and true-kill parked alike; among
//    them, ascending gate value, the order the gate threshold
//    itself releases in), then live slots by descending age
//    (the oldest particle is recycled first), ties by index.
//    planSpawnAllocation is the source of truth for the order.
//  - Exhaustion: when the demand exceeds the parked supply
//    the plan takes the oldest live particles — "steal the
//    oldest" — which is exactly what the pool's circulation
//    already does through the age wrap (the particle whose
//    age crosses ageMax is by construction the oldest), so
//    the default configuration's appearance is unchanged.
//
// Shader realisation: the gate's threshold driver gains an
// absolute form (spawnThresholdAbsolute — the same threshold
// grammar with the rate term replaced by rate / poolSize),
// which releases parked slots in gate-value order = tier 1
// of the plan; tier 2 is the age wrap, as above. The burst
// and the event ride the same plan: the burst is the plan's
// demand at t = 0 (gate value < burst), and the event cohort
// is planSpawnEventCohort (the historical hash selection,
// exposed through the allocator so every birth decision has
// one entry point).
//
// Envelope: the release clock itself gains an authored
// envelope (start / stop / amount curve). The clock is an
// integral — it advances at the envelope's value — so it is
// accumulated CPU-side one frame step at a time
// (advanceSpawnEnvelopeClock) and handed to both sim passes
// as uSpawnClockTime; with the envelope disabled the
// accumulator is the identity and the passes consume the
// plain spawn time. This mirrors the pulse grammar, whose
// "live time" is the same kind of accumulated clock.

import type { ParticleConfig } from '../types';
import {
  FREE_CURVE_VALUE_MAX,
  evaluateFreeCurve,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from './freeCurve';
import {
  clampSpawnBurst,
  clampSpawnRate,
  spawnEventHashForIndex,
  spawnEventSelects,
  spawnGateValueForIndex,
  spawnPulseTimeExtended,
  spawnStateForIndexFull,
} from './gpgpuLifecycle';

export type SpawnAllocatorConfig = Pick<ParticleConfig,
  | 'gpgpuSpawnRate' | 'gpgpuSpawnRateAbsolute'
  | 'gpgpuSpawnEnvelopeEnabled' | 'gpgpuSpawnEnvelopeStart'
  | 'gpgpuSpawnEnvelopeStop' | 'gpgpuSpawnEnvelopeCurve'
  | 'gpgpuSpawnRuleGateEnabled'>;

// ── Absolute rate ─────────────────────────────────────────────

/** Absolute release rate clamp: particles per second.
 *  Non-finite resolves to 0 (off) — the opt-in never fires
 *  on a broken value. */
export function clampSpawnRateAbsolute(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1_000_000, v));
}

/** True while the absolute rate drives the gate. */
export function spawnRateAbsoluteActive(
  config: Pick<ParticleConfig, 'gpgpuSpawnRateAbsolute'>,
): boolean {
  return clampSpawnRateAbsolute(config.gpgpuSpawnRateAbsolute ?? 0) > 0;
}

/** The fraction-of-pool-per-second equivalent of an absolute
 *  rate for a pool of `poolSize` particles. May exceed 1 (a
 *  rate above the pool size releases the whole parked pool
 *  in under a second); the threshold caps the result at 1. */
export function spawnRateFractionEquivalent(ratePerSec: number, poolSize: number): number {
  const size = Math.max(1, Math.floor(Number.isFinite(poolSize) ? poolSize : 1));
  return clampSpawnRateAbsolute(ratePerSec) / size;
}

/**
 * The gate threshold with the absolute rate driving it: the
 * full pulse grammar (lib/gpgpuLifecycle.ts) with the rate
 * term replaced by the fraction equivalent. burst / pulse
 * semantics are unchanged, so with rate = fraction × poolSize
 * this equals spawnThresholdFull at that fraction — except
 * that the fraction is NOT clamped to [0.01, 1] here (the
 * absolute form's whole point is rates the fraction clamp
 * cannot express); the result is still capped at 1.
 */
export function spawnThresholdAbsolute(
  time: number,
  ratePerSec: number,
  poolSize: number,
  burst: number,
  interval: number,
  duty: number,
  cycles: number,
  probability: number,
): number {
  const b = clampSpawnBurst(burst);
  if (b >= 1) return 1;
  const frac = spawnRateFractionEquivalent(ratePerSec, poolSize);
  const live = spawnPulseTimeExtended(time, interval, duty, cycles, probability);
  return Math.min(1, b + frac * live);
}

/**
 * The effective fraction rate the sim passes upload as
 * uSpawnRateEff while the allocator variant is built: the
 * absolute rate's fraction equivalent when the absolute key
 * is set, the legacy clamped fraction otherwise (in which
 * case the variant is only built for the envelope, and the
 * value equals what uSpawnRate already carries).
 */
export function resolveSpawnRateEff(config: SpawnAllocatorConfig, texSize: number): number {
  if (spawnRateAbsoluteActive(config)) {
    const size = Math.max(1, Math.floor(texSize));
    return spawnRateFractionEquivalent(config.gpgpuSpawnRateAbsolute, size * size);
  }
  return clampSpawnRate(config.gpgpuSpawnRate ?? 1);
}

// ── Quota + allocation plan ───────────────────────────────────

/**
 * One frame of quota from an absolute rate: exact fractional
 * accumulation. `carry` is the allocator's only state — feed
 * the returned carry into the next frame. The 1e-9 epsilon
 * keeps an exact rate (30/s at 60 fps = 0.5/frame) from
 * drifting a particle late on binary rounding; it can never
 * allocate a particle more than 1e-9 of a frame early.
 */
export function spawnAllocQuota(
  ratePerSec: number,
  dt: number,
  carry: number,
): { count: number; carry: number } {
  const rate = clampSpawnRateAbsolute(ratePerSec);
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const c0 = Number.isFinite(carry) ? Math.min(1, Math.max(0, carry)) : 0;
  const total = c0 + rate * step;
  const count = Math.floor(total + 1e-9);
  return { count, carry: total - count };
}

/** One pool slot as the allocator sees it. `parked` covers
 *  both park forms (spawn-gate unreleased, live true-kill);
 *  `gateValue` is the gate's comparison value; `age` is the
 *  particle's current age in seconds. */
export interface SpawnAllocSlot {
  index: number;
  parked: boolean;
  gateValue: number;
  age: number;
}

/**
 * The allocation plan for `demand` births, in the FIXED
 * reuse order: parked slots first (ascending gate value,
 * ties by index), then live slots by descending age (ties
 * by index — the oldest first, the exhaustion rule). Pure
 * and deterministic: the same slots and demand always plan
 * the same indices in the same order. Demand is clamped to
 * the pool size; a non-positive demand plans nothing.
 */
export function planSpawnAllocation(
  slots: readonly SpawnAllocSlot[],
  demand: number,
): number[] {
  const want = Math.max(0, Math.min(slots.length, Math.floor(Number.isFinite(demand) ? demand : 0)));
  if (want <= 0) return [];
  const parked = slots
    .filter((s) => s.parked)
    .sort((a, b) => (a.gateValue - b.gateValue) || (a.index - b.index));
  const live = slots
    .filter((s) => !s.parked)
    .sort((a, b) => (b.age - a.age) || (a.index - b.index));
  return parked.concat(live).slice(0, want).map((s) => s.index);
}

/**
 * The pool's slots under the full gate grammar at spawn-time
 * `time` (the frame step `dt` distinguishes the activating
 * frame, which counts as already allocated): parked = the
 * gate state 'parked', gate values from the lifecycle twins
 * (hash order, or the baked distance values when supplied).
 * Ages are the caller's to fill — the gate itself does not
 * track them, so they default to 0 here.
 */
export function spawnGateSlots(
  texSize: number,
  time: number,
  dt: number,
  rate: number,
  burst: number,
  interval: number,
  duty: number,
  cycles: number,
  probability: number,
  orderValues?: ArrayLike<number> | null,
  ages?: ArrayLike<number> | null,
): SpawnAllocSlot[] {
  const size = Math.max(1, Math.floor(texSize));
  const out: SpawnAllocSlot[] = [];
  for (let i = 0; i < size * size; i++) {
    const gateValue = spawnGateValueForIndex(i, size, orderValues);
    const state = spawnStateForIndexFull(
      i, size, time, dt, rate, burst, interval, duty, cycles, probability, gateValue,
    );
    out.push({
      index: i,
      parked: state === 'parked',
      gateValue,
      age: ages && i < ages.length ? ages[i] : 0,
    });
  }
  return out;
}

/**
 * The spawn event's cohort, through the allocator: the
 * historical deterministic hash selection (Phase AX),
 * returned in index order. The event already respawns
 * through the shared respawn block; this is its plan form.
 */
export function planSpawnEventCohort(texSize: number, count: number): number[] {
  const size = Math.max(1, Math.floor(texSize));
  const out: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (spawnEventSelects(spawnEventHashForIndex(i, size), count)) out.push(i);
  }
  return out;
}

// ── Envelope ──────────────────────────────────────────────────

export interface SpawnEnvelope {
  enabled: boolean;
  /** Seconds into the spawn epoch before which the clock is 0. */
  start: number;
  /** Seconds at/after which the clock stops; 0 = no stop. */
  stop: number;
  /** Amount curve over the normalised window (free curve asset). */
  curve: readonly FreeCurvePoint[];
}

/** Envelope window clamp (the spawn event's time range). */
export function clampSpawnEnvelopeTime(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(600, v));
}

/** Resolve the envelope from the config keys. */
export function resolveSpawnEnvelope(config: SpawnAllocatorConfig): SpawnEnvelope {
  return {
    enabled: !!config.gpgpuSpawnEnvelopeEnabled,
    start: clampSpawnEnvelopeTime(config.gpgpuSpawnEnvelopeStart ?? 0),
    stop: clampSpawnEnvelopeTime(config.gpgpuSpawnEnvelopeStop ?? 0),
    curve: normalizeFreeCurvePoints(config.gpgpuSpawnEnvelopeCurve ?? []),
  };
}

/**
 * The envelope's value at spawn-time `time`: the rate the
 * release clock advances at. Disabled = 1 (the plain clock).
 * Before Start = 0; at/after Stop (when set) = 0; inside the
 * window the curve evaluated at the normalised position;
 * with no Stop the curve's tail value applies after Start
 * (the identity curve therefore gives exactly 1 — the plain
 * clock — even while enabled).
 */
export function spawnEnvelopeValueAt(time: number, env: SpawnEnvelope): number {
  if (!env.enabled) return 1;
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  if (t < env.start) return 0;
  const hasStop = env.stop > env.start;
  if (hasStop && t >= env.stop) return 0;
  const phase = hasStop ? Math.min(1, Math.max(0, (t - env.start) / (env.stop - env.start))) : 1;
  const v = evaluateFreeCurve(env.curve, phase);
  return Math.min(FREE_CURVE_VALUE_MAX, Math.max(0, v));
}

/**
 * One frame step of the envelope clock: clock += value × dt.
 * The scene accumulates this from the spawn epoch (resetting
 * on the same key change that restarts the epoch) and the
 * passes consume the result as uSpawnClockTime, with the
 * previous frame's value as uSpawnClockPrev. Disabled, the
 * step is dt verbatim, so the accumulated clock IS the spawn
 * time.
 */
export function advanceSpawnEnvelopeClock(
  clock: number,
  time: number,
  dt: number,
  env: SpawnEnvelope,
): number {
  const c = Number.isFinite(clock) ? clock : 0;
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  return c + spawnEnvelopeValueAt(time, env) * step;
}

// ── Variant activity ──────────────────────────────────────────

/** True while either allocator driver is in play (absolute
 *  rate or envelope): the sim passes then build the spawn
 *  allocator variant strings. At the defaults this is false
 *  and every string is the shipped one. */
export function spawnAllocVariantActive(config: SpawnAllocatorConfig): boolean {
  return spawnRateAbsoluteActive(config) || !!config.gpgpuSpawnEnvelopeEnabled;
}

/** The rule spawn gate's key half (the variant also requires
 *  an effective live rule list — resolved by the wiring,
 *  like the live kill). */
export function spawnRuleGateKeyOn(
  config: Pick<ParticleConfig, 'gpgpuSpawnRuleGateEnabled'>,
): boolean {
  return !!config.gpgpuSpawnRuleGateEnabled;
}
