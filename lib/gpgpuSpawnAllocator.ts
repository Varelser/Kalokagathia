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
//
// Event list (Layer 1 WP4 phase B): the single authored
// event generalises to a time-ordered list. Each event's
// fraction demand resolves to the exact absolute count the
// historical hash selection re-birthed (the cohort size), and
// the firing events' demands are allocated against the pool
// in time order through the same fixed reuse order — the
// main pool gains event BIRTHS, not just event re-births,
// without extending the REP output (stage-2 decision 1).
// The shader realisation (phase C) adds a firing event's
// demand to the gate threshold; SpawnEventDemand is the
// typed currency it consumes.

import type { ParticleConfig } from '../types';
import {
  FREE_CURVE_VALUE_MAX,
  evaluateFreeCurve,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from './freeCurve';
import {
  clampSpawnBurst,
  clampSpawnEventCount,
  clampSpawnEventTime,
  clampSpawnRate,
  spawnEventFiresAt,
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

// ── Event list + main-pool event demand ───────────────────────

/**
 * One authored spawn event in list form (Layer 1 WP4
 * phase B): at `time` seconds into the spawn epoch, the
 * fraction `count` of the pool is demanded as births. This
 * is the historical single event (Phase AX, the
 * gpgpuSpawnEventTime / gpgpuSpawnEventCount keys) generalised
 * to a list — a list of length 1 IS the historical event.
 * The authored currency stays the fraction (the existing
 * key's semantics); the allocator's currency is the absolute
 * count, resolved by resolveSpawnEventDemand.
 */
export interface SpawnEventSpec {
  /** Seconds into the spawn epoch (clampSpawnEventTime range). */
  time: number;
  /** Fraction of the pool demanded, in [0, 1] once clamped. */
  count: number;
}

/**
 * One event's demand in the allocator's currency: an
 * absolute number of births due at `time`. This is the form
 * the phase-C shader realisation consumes — at the event's
 * frame the gate threshold gains `count` more releases,
 * taken in the fixed reuse order by planSpawnEventDemands.
 */
export interface SpawnEventDemand {
  /** Seconds into the spawn epoch. */
  time: number;
  /** Births demanded by this event (a non-negative integer). */
  count: number;
}

/**
 * The authored list, normalised: times and counts clamped
 * to the event grammar's ranges, sorted by time (events at
 * the same time keep their authored order — the sort is
 * stable by construction). Pure and deterministic.
 */
export function normalizeSpawnEventSpecs(
  events: readonly SpawnEventSpec[],
): SpawnEventSpec[] {
  const tagged = events.map((e, order) => ({
    time: clampSpawnEventTime(e.time),
    count: clampSpawnEventCount(e.count),
    order,
  }));
  tagged.sort((a, b) => (a.time - b.time) || (a.order - b.order));
  return tagged.map(({ time, count }) => ({ time, count }));
}

/**
 * One event's absolute demand: the number of births the
 * historical event re-birthed at this fraction — the exact
 * size of the hash-selected cohort (planSpawnEventCohort),
 * so a single event's demand is identical in size to the
 * legacy behaviour, by the existing hash selection.
 */
export function resolveSpawnEventDemand(
  spec: SpawnEventSpec,
  texSize: number,
): SpawnEventDemand {
  return {
    time: clampSpawnEventTime(spec.time),
    count: planSpawnEventCohort(texSize, spec.count).length,
  };
}

/** The whole authored list resolved to absolute demands,
 *  in time order. */
export function resolveSpawnEventDemands(
  events: readonly SpawnEventSpec[],
  texSize: number,
): SpawnEventDemand[] {
  return normalizeSpawnEventSpecs(events).map((s) => resolveSpawnEventDemand(s, texSize));
}

/**
 * The demands firing on the frame step (time - dt, time]:
 * an event fires on the single frame whose step crosses its
 * time — the legacy spawnEventFiresAt rule, per event. The
 * input is expected in time order (resolveSpawnEventDemands'
 * output is); the result preserves that order.
 */
export function spawnEventDemandsFiringAt(
  demands: readonly SpawnEventDemand[],
  time: number,
  dt: number,
): SpawnEventDemand[] {
  return demands.filter((d) => spawnEventFiresAt(time, dt, d.time));
}

/**
 * The cumulative demand due at spawn-time `time`: the sum
 * of the counts of every event whose time has been reached.
 * This is the threshold-facing form — a gate threshold that
 * adds event demand releases exactly this many extra births
 * by `time`.
 */
export function spawnEventDemandDueBy(
  demands: readonly SpawnEventDemand[],
  time: number,
): number {
  const t = Number.isFinite(time) ? time : 0;
  let total = 0;
  for (const d of demands) {
    if (t >= clampSpawnEventTime(d.time)) {
      total += Math.max(0, Math.floor(Number.isFinite(d.count) ? d.count : 0));
    }
  }
  return total;
}

/** One firing event's allocation: the demand and the slots
 *  it claimed, in the fixed reuse order. */
export interface SpawnEventAllocation {
  demand: SpawnEventDemand;
  indices: number[];
}

/**
 * The main-pool event plan for one frame step: every event
 * firing on this step is processed IN TIME ORDER, and each
 * event's demand is allocated from the slots the earlier
 * events did not claim, in the fixed reuse order (parked
 * first by ascending gate value, then the oldest live —
 * planSpawnAllocation). An event whose demand exceeds the
 * remaining supply is truncated to what remains (the
 * allocator's exhaustion rule already steals the oldest
 * live slots; past the pool size there is nothing left to
 * steal). Pure and deterministic: the same slots, demands
 * and step always plan the same allocations.
 */
export function planSpawnEventDemands(
  slots: readonly SpawnAllocSlot[],
  demands: readonly SpawnEventDemand[],
  time: number,
  dt: number,
): SpawnEventAllocation[] {
  const firing = spawnEventDemandsFiringAt(demands, time, dt);
  const used = new Set<number>();
  return firing.map((demand) => {
    const remaining = slots.filter((s) => !used.has(s.index));
    const want = Math.max(0, Math.floor(Number.isFinite(demand.count) ? demand.count : 0));
    const indices = planSpawnAllocation(remaining, want);
    for (const i of indices) used.add(i);
    return { demand, indices };
  });
}

// ── Event demand wiring (Layer 1 WP4 phase C) ─────────────

/** The config keys that author the spawn event. */
export type SpawnEventDemandConfig = Pick<ParticleConfig,
  | 'gpgpuSpawnEventEnabled' | 'gpgpuSpawnEventTime' | 'gpgpuSpawnEventCount'>;

/**
 * The event list the config authors: the single authored
 * event (the Phase AX keys) in phase B's list form — a list
 * of length 1 IS the historical event. Empty while the
 * event key is off, so every consumer below collapses to
 * the legacy behaviour.
 */
export function authoredSpawnEventSpecs(
  config: SpawnEventDemandConfig,
): SpawnEventSpec[] {
  if (!config.gpgpuSpawnEventEnabled) return [];
  return [{
    time: config.gpgpuSpawnEventTime ?? 0,
    count: config.gpgpuSpawnEventCount ?? 0,
  }];
}

let authoredDemandsMemo: { key: string; demands: SpawnEventDemand[] } | null = null;

/**
 * The authored list resolved to absolute demands. The
 * resolution counts the event cohort over the whole pool,
 * so it is memoised on the (texSize, event keys) triple —
 * the passes and the variant resolver ask every frame /
 * render and must stay O(1) amortised. Pure: the memo only
 * ever returns the deterministic resolution of its key.
 */
export function authoredSpawnEventDemands(
  config: SpawnEventDemandConfig,
  texSize: number,
): SpawnEventDemand[] {
  const size = Math.max(1, Math.floor(texSize));
  const key = `${size}|${config.gpgpuSpawnEventEnabled ? 1 : 0}|${config.gpgpuSpawnEventTime ?? 0}|${config.gpgpuSpawnEventCount ?? 0}`;
  if (authoredDemandsMemo && authoredDemandsMemo.key === key) return authoredDemandsMemo.demands;
  const demands = resolveSpawnEventDemands(authoredSpawnEventSpecs(config), size);
  authoredDemandsMemo = { key, demands };
  return demands;
}

/**
 * True while an authored event with a positive demand
 * stands: the sim passes then build the event-demand gate
 * variant strings. At the defaults (event off, or a zero
 * count) this is false and every string is the shipped one.
 */
export function spawnEventDemandVariantActive(
  config: SpawnEventDemandConfig,
  texSize: number,
): boolean {
  return authoredSpawnEventDemands(config, texSize).some((d) => d.count > 0);
}

/**
 * The gate threshold's event-demand term at spawn-time
 * `time`: the cumulative demand due by then
 * (spawnEventDemandDueBy over the authored list) as a
 * fraction of the pool. The passes upload this for the
 * current frame (uSpawnEventDueFrac) and for the previous
 * frame (uSpawnEventDuePrevFrac, at time - dt), so the
 * gate's activation test sees the step exactly on the
 * firing frame. 0 while no event is authored.
 */
export function spawnEventDemandFracAt(
  config: SpawnEventDemandConfig,
  texSize: number,
  time: number,
): number {
  const demands = authoredSpawnEventDemands(config, texSize);
  if (demands.length === 0) return 0;
  const size = Math.max(1, Math.floor(texSize));
  return spawnEventDemandDueBy(demands, time) / (size * size);
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
