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
 * NOT included: a free-drawn speed curve. The stage-2 free
 * curves (lib/freeCurve.ts) are simulation-side assets —
 * per-key Enabled + Points pairs consumed by shader passes
 * and edited through the GPGPU panel's curve editor; the
 * playback panel has no curve-editor wiring, and a time
 * warp would turn this closed-form mapping into a numeric
 * integral. Rate + range + reverse + interpolation only.
 */

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
}

export const CACHE_RETIMER_IDENTITY: CacheRetimerSettings = {
  rate: 1,
  startFrame: 0,
  endFrame: CACHE_RETIMER_END_LAST,
  reverse: false,
  interpolation: 'inherit',
};

/** A validated retimer with the end frame resolved to an
 *  absolute frame index (startFrame <= endFrame always). */
export interface ResolvedCacheRetimer {
  rate: number;
  startFrame: number;
  endFrame: number;
  reverse: boolean;
  interpolation: CacheRetimerInterpolation;
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
  return { ok: true, resolved: { rate, startFrame, endFrame, reverse: !!reverse, interpolation } };
}

/** True when a resolved retimer reproduces the legacy
 *  mapping exactly (rate 1, full range, forward, inherit). */
export function isCacheRetimerIdentity(resolved: ResolvedCacheRetimer, frameCount: number): boolean {
  return resolved.rate === 1
    && resolved.startFrame === 0
    && resolved.endFrame === frameCount - 1
    && resolved.reverse === false
    && resolved.interpolation === 'inherit';
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
  const offset = loop ? raw % (span + 1) : Math.min(raw, span);
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
  }, frameCount);
  if (!result.ok) return result;
  return { ok: true, resolved: result.resolved };
}
