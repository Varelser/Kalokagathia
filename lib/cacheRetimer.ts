/**
 * Cache retimer (Grammar 2.0 stage 3, slice S2): a pure
 * playback-side frame mapping for cached frame sequences —
 * a rate multiplier, a frame range, reverse playback and an
 * interpolation override — layered over the legacy
 * time -> frame mapping. Design:
 * kalokagathia-pro/STAGE3_DESIGN.md §2 S2.
 *
 * One grammar for both cache kinds. External point caches
 * (lib/pointCache.ts) and this app's own state caches
 * (lib/gpgpuStateCache.ts) both play through the SINGLE
 * consumer — lib/usePointCachePlayback.ts driving
 * buildPointCacheCloud (a state cache is converted to the
 * point-cache shape by stateCacheToPointCacheData and set
 * into the same store first) — and the driver resolves the
 * retimer from config through this module, so the two kinds
 * can never drift into separate retiming grammars.
 * (sampleStateCache in gpgpuStateCache.ts is a library
 * sampling helper with no app consumer; playback does not
 * flow through it.)
 *
 * Separation from timeScale: lib/playbackTime.ts scales the
 * SIMULATION's frame delta (and is locked to 1 during
 * deterministic renders). This module never touches the
 * sim — it only remaps which cached frame a clock time
 * shows.
 *
 * Identity, two layers:
 * - Disabled (the default): the driver resolves to null and
 *   passes no retimer at all, so the legacy code path in
 *   buildPointCacheCloud runs untouched.
 * - Enabled with the identity values (rate 1, full range,
 *   forward, interpolation 'inherit'): the mapping below
 *   reproduces the legacy frame choice and interpolation
 *   bit-exactly (pinned by scripts/stage3-retimer-s2.test.mjs
 *   against pointCacheFrameFloat / buildPointCacheCloud).
 *
 * Validation discipline (the cache modules' convention —
 * never silently fix a broken request): an invalid rate or
 * range is refused with the reason stated.
 * resolveCacheRetimer returns the error; the panel shows
 * it; the driver falls back to the un-retimed legacy
 * mapping rather than playing something broken.
 *
 * Interpolation is NOT double-managed: a cache manifest
 * declares its own interpolation ('linear' | 'nearest').
 * The retimer's interpolation setting defaults to 'inherit'
 * (keep the manifest's declaration); an explicit 'linear' /
 * 'nearest' overrides it, resolved in exactly one place
 * (resolveCacheRetimerInterpolation, called by
 * buildPointCacheCloud).
 *
 * Speed curve (S2 follow-up slice, 2026-11-28): a free-drawn
 * curve (lib/freeCurve.ts, the stage-2 asset shape) may
 * reshape HOW the segment is traversed — its value at a
 * normalised playback position is the instantaneous speed
 * multiplier relative to rate. The mapping stays closed
 * form: a piecewise-linear curve integrates to a piecewise
 * quadratic, evaluated analytically per segment (no numeric
 * quadrature), and the integral is normalised by its total
 * over [0, 1], so the curve redistributes speed INSIDE the
 * pass while the pass duration stays exactly what rate
 * alone dictates. An identity curve (all values 1) — and a
 * disabled curve — resolve to no curve at all, so the
 * legacy closed-form mapping below runs bit-exactly.
 * Decisions recorded with the slice: the curve is a
 * function of playback progress (not of source position);
 * reverse playback is the exact time mirror of the forward
 * warped pass (frame = start + end - forward); a curve
 * segment with value 0 freezes the frame for that stretch
 * of playback time (the progress integral is flat there —
 * no inversion is ever needed, the mapping only ever goes
 * time -> progress -> frame).
 */

import {
  evaluateFreeCurve,
  isFreeCurveIdentity,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from './freeCurve';

export type CacheRetimerInterpolation = 'inherit' | 'linear' | 'nearest';

/** endFrame value meaning "the cache's own last frame". */
export const CACHE_RETIMER_END_LAST = -1;

export interface CacheRetimerSettings {
  /** Playback rate multiplier (> 0). 1 is the legacy speed. */
  rate: number;
  /** First frame of the retimed range (0-based frame index). */
  startFrame: number;
  /** Last frame of the retimed range, or CACHE_RETIMER_END_LAST. */
  endFrame: number;
  /** Play the range backwards (from its end to its start). */
  reverse: boolean;
  /** 'inherit' keeps the manifest's declared interpolation. */
  interpolation: CacheRetimerInterpolation;
  /** Speed curve on/off. Absent / false = no curve. */
  speedCurveEnabled?: boolean;
  /** Speed curve control points as the stored flat array
   *  [t0, v0, t1, v1, …] (lib/freeCurve.ts asset shape). */
  speedCurvePoints?: readonly number[];
}

export const CACHE_RETIMER_IDENTITY: CacheRetimerSettings = {
  rate: 1,
  startFrame: 0,
  endFrame: CACHE_RETIMER_END_LAST,
  reverse: false,
  interpolation: 'inherit',
  speedCurveEnabled: false,
  speedCurvePoints: [0, 1, 1, 1],
};

/**
 * A speed curve prepared for the analytic warp: the [0, 1]
 * partition at every knot, the curve value at each
 * partition point, and the cumulative integral there. The
 * curve is piecewise linear between partition points, so
 * the integral inside one part is a quadratic evaluated
 * exactly by the trapezoid of the endpoint values.
 */
export interface ResolvedCacheRetimerSpeedCurve {
  points: FreeCurvePoint[];
  xs: number[];
  vs: number[];
  cumulative: number[];
  /** Integral over the whole [0, 1] (> 0 by construction). */
  total: number;
}

/** A validated retimer with the end frame resolved to an
 *  absolute frame index (startFrame <= endFrame always). */
export interface ResolvedCacheRetimer {
  rate: number;
  startFrame: number;
  endFrame: number;
  reverse: boolean;
  interpolation: CacheRetimerInterpolation;
  /** Prepared speed curve, or null when the curve is
   *  disabled or the identity curve (legacy mapping). */
  speedCurve: ResolvedCacheRetimerSpeedCurve | null;
}

/**
 * Prepare a normalised point list into the analytic-warp
 * shape. Returns null when the total integral is not
 * positive (an all-zero curve can never advance playback).
 */
export function resolveCacheRetimerSpeedCurve(
  points: readonly FreeCurvePoint[],
): ResolvedCacheRetimerSpeedCurve | null {
  const xsSet = new Set<number>([0, 1]);
  points.forEach((point) => xsSet.add(point.t));
  const xs = [...xsSet].sort((a, b) => a - b);
  const vs = xs.map((x) => evaluateFreeCurve(points, x));
  const cumulative: number[] = [0];
  for (let i = 0; i + 1 < xs.length; i++) {
    cumulative.push(cumulative[i] + ((xs[i + 1] - xs[i]) * (vs[i] + vs[i + 1])) / 2);
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return null;
  return { points: [...points], xs, vs, cumulative, total };
}

/**
 * Warped source progress for a normalised playback
 * position u in [0, 1]: the curve's integral up to u,
 * normalised by its total. progress(0) = 0 and
 * progress(1) = 1 exactly; the result is monotonic
 * non-decreasing (flat exactly where the curve is 0).
 */
export function cacheRetimerSpeedCurveProgress(
  curve: ResolvedCacheRetimerSpeedCurve,
  u: number,
): number {
  const x = Math.min(1, Math.max(0, u));
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const { xs, vs, cumulative } = curve;
  let i = 0;
  while (i + 2 < xs.length && xs[i + 1] < x) i++;
  const spanX = xs[i + 1] - xs[i];
  const dx = x - xs[i];
  const vx = spanX > 0 ? vs[i] + ((vs[i + 1] - vs[i]) * dx) / spanX : vs[i];
  const area = cumulative[i] + (dx * (vs[i] + vx)) / 2;
  return area / curve.total;
}

export type CacheRetimerResolveResult =
  | { ok: true; resolved: ResolvedCacheRetimer }
  | { ok: false; error: string };

const fail = (error: string): CacheRetimerResolveResult => ({ ok: false, error });

/**
 * Validate raw settings against a concrete cache frame
 * count and resolve the end sentinel. Every refusal names
 * the offending value and the valid range.
 */
export function resolveCacheRetimer(settings: CacheRetimerSettings, frameCount: number): CacheRetimerResolveResult {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    return fail(`キャッシュのフレーム数が不正です（${String(frameCount)}）。リタイマーを適用できません。`);
  }
  const { rate, startFrame, reverse, interpolation } = settings;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return fail(`リタイマーの再生倍率は 0 より大きい有限の数値が必要です（現在: ${String(rate)}）。`);
  }
  if (!Number.isInteger(startFrame)) {
    return fail(`リタイマーの開始フレームは整数が必要です（現在: ${String(startFrame)}）。`);
  }
  if (startFrame < 0 || startFrame > frameCount - 1) {
    return fail(`リタイマーの開始フレーム ${startFrame} がキャッシュの範囲（0〜${frameCount - 1}）の外です。`);
  }
  let endFrame = settings.endFrame;
  if (endFrame === CACHE_RETIMER_END_LAST) {
    endFrame = frameCount - 1;
  } else {
    if (!Number.isInteger(endFrame)) {
      return fail(`リタイマーの終了フレームは整数（または -1 = 最終フレーム）が必要です（現在: ${String(endFrame)}）。`);
    }
    if (endFrame < 0 || endFrame > frameCount - 1) {
      return fail(`リタイマーの終了フレーム ${endFrame} がキャッシュの範囲（0〜${frameCount - 1}、または -1 = 最終フレーム）の外です。`);
    }
  }
  if (endFrame < startFrame) {
    return fail(`リタイマーの終了フレーム ${endFrame} が開始フレーム ${startFrame} より前です（区間が逆転しています）。`);
  }
  if (interpolation !== 'inherit' && interpolation !== 'linear' && interpolation !== 'nearest') {
    return fail(`リタイマーの補間方式は "inherit" / "linear" / "nearest" のいずれかが必要です（現在: ${String(interpolation)}）。`);
  }
  // Speed curve: coerced through the free-curve asset
  // convention (lib/freeCurve.ts). The identity curve
  // resolves to no curve at all (legacy mapping); an
  // all-zero curve is refused — it could never advance.
  let speedCurve: ResolvedCacheRetimerSpeedCurve | null = null;
  if (settings.speedCurveEnabled) {
    const points = normalizeFreeCurvePoints(settings.speedCurvePoints);
    if (!isFreeCurveIdentity(points)) {
      speedCurve = resolveCacheRetimerSpeedCurve(points);
      if (!speedCurve) {
        return fail('リタイマーの速度カーブの値が全て 0 です（再生が進みません）。0 より大きい値を含むカーブにしてください。');
      }
    }
  }
  return { ok: true, resolved: { rate, startFrame, endFrame, reverse: !!reverse, interpolation, speedCurve } };
}

/** True when a resolved retimer reproduces the legacy
 *  mapping exactly (rate 1, full range, forward, inherit). */
export function isCacheRetimerIdentity(resolved: ResolvedCacheRetimer, frameCount: number): boolean {
  return resolved.rate === 1
    && resolved.startFrame === 0
    && resolved.endFrame === frameCount - 1
    && resolved.reverse === false
    && resolved.interpolation === 'inherit'
    && resolved.speedCurve === null;
}

/** The one place the interpolation override is resolved:
 *  'inherit' keeps the manifest's declared interpolation. */
export function resolveCacheRetimerInterpolation(
  resolved: ResolvedCacheRetimer,
  manifestInterpolation: 'linear' | 'nearest',
): 'linear' | 'nearest' {
  return resolved.interpolation === 'inherit' ? manifestInterpolation : resolved.interpolation;
}

/**
 * Fractional frame position for a clock time under a
 * resolved retimer. Pure, like pointCacheFrameFloat.
 *
 * The segment is [startFrame, endFrame] (span = end - start).
 * Forward playback starts at startFrame; reverse starts at
 * endFrame. With loop, the position cycles over the segment
 * INCLUDING the wrap from endFrame back to startFrame (the
 * cycle length is span + 1, exactly like the legacy full-
 * range cycle of frameCount), so the returned value may sit
 * up to one frame outside [startFrame, endFrame] — the
 * bracketing in cacheRetimerBracket resolves that wrap.
 * Without loop the position clamps at the segment ends.
 */
export function cacheRetimerFrameFloat(
  resolved: ResolvedCacheRetimer,
  frameCount: number,
  fps: number,
  timeSeconds: number,
  loop: boolean,
): number {
  if (frameCount <= 1) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return resolved.reverse ? resolved.endFrame : resolved.startFrame;
  const span = resolved.endFrame - resolved.startFrame;
  const raw = Math.max(0, timeSeconds) * fps * resolved.rate;
  if (!resolved.speedCurve) {
    const offset = loop ? raw % (span + 1) : Math.min(raw, span);
    return resolved.reverse ? resolved.endFrame - offset : resolved.startFrame + offset;
  }
  // Speed curve: travel inside the pass is measured in the
  // same units as the legacy offset (frames of the cycle),
  // normalised to u in [0, 1], warped through the curve's
  // normalised integral, and scaled back — so the pass
  // duration (cycle / (fps * rate)) is unchanged and only
  // the distribution of speed inside the pass moves.
  const cycle = loop ? span + 1 : span;
  if (cycle <= 0) return resolved.startFrame;
  const travel = loop ? raw % cycle : Math.min(raw, cycle);
  const offset = cacheRetimerSpeedCurveProgress(resolved.speedCurve, travel / cycle) * cycle;
  return resolved.reverse ? resolved.endFrame - offset : resolved.startFrame + offset;
}

/**
 * Resolve a fractional frame position (from
 * cacheRetimerFrameFloat) into the bracketing frame pair
 * and blend factor, honouring the segment wrap when
 * looping. With the identity retimer this reproduces the
 * legacy bracketing in buildPointCacheCloud bit-exactly:
 * i1 wraps modulo frameCount when looping, clamps to the
 * last frame otherwise, and 'nearest' snaps with the same
 * rounding.
 */
export function cacheRetimerBracket(
  resolved: ResolvedCacheRetimer,
  frameFloat: number,
  loop: boolean,
  interpolation: 'linear' | 'nearest',
): { i0: number; i1: number; frac: number } {
  const { startFrame, endFrame } = resolved;
  const cycle = endFrame - startFrame + 1;
  const wrap = (index: number): number => startFrame + (((index - startFrame) % cycle) + cycle) % cycle;
  if (interpolation === 'nearest') {
    const rounded = Math.round(frameFloat);
    const idx = loop ? wrap(rounded) : Math.min(endFrame, Math.max(startFrame, rounded));
    return { i0: idx, i1: idx, frac: 0 };
  }
  const lo = Math.floor(frameFloat);
  const frac = frameFloat - lo;
  if (loop) {
    return { i0: wrap(lo), i1: wrap(lo + 1), frac };
  }
  const i0 = Math.min(endFrame, Math.max(startFrame, lo));
  return { i0, i1: Math.min(i0 + 1, endFrame), frac };
}

/* ---------------- config bridge ---------------- */

/** The config-key shape the retimer reads (the
 *  pointCacheRetimer* keys in ParticleConfig). */
export interface CacheRetimerConfig {
  pointCacheRetimerEnabled: boolean;
  pointCacheRetimerRate: number;
  pointCacheRetimerStartFrame: number;
  pointCacheRetimerEndFrame: number;
  pointCacheRetimerReverse: boolean;
  pointCacheRetimerInterpolation: CacheRetimerInterpolation;
  pointCacheRetimerSpeedCurveEnabled: boolean;
  pointCacheRetimerSpeedCurvePoints: number[];
}

/**
 * Resolve the retimer for one cache from config. Disabled
 * resolves to `{ ok: true, resolved: null }` — the caller
 * passes no retimer and the legacy mapping runs untouched.
 * An enabled-but-invalid configuration returns the refusal
 * reason; callers that cannot surface it (the driver) fall
 * back to the un-retimed legacy mapping.
 */
export function resolveCacheRetimerFromConfig(
  config: CacheRetimerConfig,
  frameCount: number,
): { ok: true; resolved: ResolvedCacheRetimer | null } | { ok: false; error: string } {
  if (!config.pointCacheRetimerEnabled) return { ok: true, resolved: null };
  const result = resolveCacheRetimer({
    rate: config.pointCacheRetimerRate,
    startFrame: config.pointCacheRetimerStartFrame,
    endFrame: config.pointCacheRetimerEndFrame,
    reverse: config.pointCacheRetimerReverse,
    interpolation: config.pointCacheRetimerInterpolation,
    speedCurveEnabled: config.pointCacheRetimerSpeedCurveEnabled,
    speedCurvePoints: config.pointCacheRetimerSpeedCurvePoints,
  }, frameCount);
  if (!result.ok) return result;
  return { ok: true, resolved: result.resolved };
}
