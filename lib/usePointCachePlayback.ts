import { useEffect, useMemo, useRef } from 'react';
import { getAttrPointCloud, setAttrPointCloudTransient, type AttrPointCloud } from './attrPointCloud';
import {
  buildBundledSamplePointCache,
  buildPointCacheCloud,
  pointCacheFrameFloat,
  setPointCachePlaybackState,
  usePointCache,
  type PointCacheData,
} from './pointCache';
import {
  cacheRetimerFrameFloat,
  resolveCacheRetimerFromConfig,
  type CacheRetimerConfig,
  type ResolvedCacheRetimer,
} from './cacheRetimer';
import { getSequenceClockTime, isSequenceClockRunning } from './sequenceTracks';

/**
 * Point cache playback driver (Phase BZ, design A — #4 db's
 * round-2 design, 杉's decision 2026-11-19).
 *
 * The shared sequence clock is the single time source: while a
 * sequence plays, this driver maps the clock time to a cache
 * frame through the pure mapping in lib/pointCache.ts and swaps
 * the attribute point cloud through the transient (non-
 * persisting) setter, so the existing consumers (morph 'data'
 * target, attribute 'data' source) follow the moving cloud.
 *
 * Details the design left to this implementation:
 * - Frame time: the published clock reading is throttled to
 *   ~50 ms (coarser than a 24 fps cache frame), so the driver
 *   anchors on (published time, performance.now) and extrapolates
 *   between publications, re-anchoring whenever the published
 *   reading deviates (segment seams re-anchor the publisher).
 * - Binding scope: while enabled, the cache follows the clock for
 *   the whole pass (not per sequence item). The cache loops on
 *   its own duration, independent of the pass length.
 * - Stop behaviour: when the clock stops, the driver freezes on
 *   the current frame (no swap, no reset to frame 0).
 * - Ownership: once the driver has written a cloud, any external
 *   replacement (the user registering a table cloud, clearing it,
 *   a preset applying one) suspends the driver until the source
 *   or the enable flag changes — the driver never fights the
 *   user for the shared store.
 * - Disabled (the default) the driver does nothing at all: no
 *   rAF, no cloud writes — identity by construction.
 */
export function usePointCachePlayback(args: {
  enabled: boolean;
  loop: boolean;
  bundledSample: boolean;
  retimer: CacheRetimerConfig;
}): void {
  const { enabled, loop, bundledSample, retimer } = args;
  const retimerEnabled = retimer.pointCacheRetimerEnabled;
  const retimerRate = retimer.pointCacheRetimerRate;
  const retimerStartFrame = retimer.pointCacheRetimerStartFrame;
  const retimerEndFrame = retimer.pointCacheRetimerEndFrame;
  const retimerReverse = retimer.pointCacheRetimerReverse;
  const retimerInterpolation = retimer.pointCacheRetimerInterpolation;
  const storeCache = usePointCache();
  const bundledCache = useMemo(
    () => (bundledSample && !storeCache ? buildBundledSamplePointCache() : null),
    [bundledSample, storeCache],
  );
  const source: PointCacheData | null = storeCache ?? bundledCache;

  const anchorRef = useRef<{ clockTime: number; perf: number } | null>(null);
  const lastWrittenRef = useRef<AttrPointCloud | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const suspendedRef = useRef(false);

  useEffect(() => {
    anchorRef.current = null;
    lastWrittenRef.current = null;
    lastFrameRef.current = -1;
    suspendedRef.current = false;
    if (!enabled || !source) {
      setPointCachePlaybackState({ frameFloat: 0, running: false, suspended: false });
      return;
    }
    const effectiveLoop = loop && source.manifest.loop;

    // Retimer (stage 3 S2, lib/cacheRetimer.ts): one
    // resolution for whichever source plays — a loaded point
    // cache, the bundled sample, or a state cache converted
    // into this same store all share this mapping. Disabled
    // resolves to null (the legacy mapping runs untouched);
    // an invalid configuration also falls back to null here
    // — the panel surfaces the refusal reason, and playback
    // never breaks on a bad range.
    const retimerResolution = resolveCacheRetimerFromConfig({
      pointCacheRetimerEnabled: retimerEnabled,
      pointCacheRetimerRate: retimerRate,
      pointCacheRetimerStartFrame: retimerStartFrame,
      pointCacheRetimerEndFrame: retimerEndFrame,
      pointCacheRetimerReverse: retimerReverse,
      pointCacheRetimerInterpolation: retimerInterpolation,
    }, source.manifest.frameCount);
    const resolvedRetimer: ResolvedCacheRetimer | null = retimerResolution.ok ? retimerResolution.resolved : null;

    const writeFrame = (timeSeconds: number, running: boolean): void => {
      if (suspendedRef.current) return;
      const frameFloat = resolvedRetimer
        ? cacheRetimerFrameFloat(resolvedRetimer, source.manifest.frameCount, source.manifest.fps, timeSeconds, effectiveLoop)
        : pointCacheFrameFloat(source, timeSeconds, effectiveLoop);
      if (lastFrameRef.current >= 0 && Math.abs(frameFloat - lastFrameRef.current) <= 1e-4) {
        setPointCachePlaybackState({ frameFloat, running, suspended: false });
        return;
      }
      const current = getAttrPointCloud();
      if (lastWrittenRef.current && current !== lastWrittenRef.current) {
        // Someone else owns the cloud now — suspend quietly.
        suspendedRef.current = true;
        setPointCachePlaybackState({ frameFloat, running, suspended: true });
        return;
      }
      setAttrPointCloudTransient(buildPointCacheCloud(source, timeSeconds, effectiveLoop, resolvedRetimer));
      lastWrittenRef.current = getAttrPointCloud();
      lastFrameRef.current = frameFloat;
      setPointCachePlaybackState({ frameFloat, running, suspended: false });
    };

    // Land on the frame for the current clock reading immediately,
    // so enabling the feature (or applying the starter) shows the
    // cache's frame for "now" even before playback starts.
    writeFrame(getSequenceClockTime(), isSequenceClockRunning());

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (suspendedRef.current) return;
      if (!isSequenceClockRunning()) {
        // Frozen on the current frame while the clock is stopped.
        setPointCachePlaybackState({
          frameFloat: Math.max(0, lastFrameRef.current),
          running: false,
          suspended: false,
        });
        anchorRef.current = null;
        return;
      }
      const now = performance.now();
      const published = getSequenceClockTime();
      let anchor = anchorRef.current;
      if (!anchor || Math.abs(published - (anchor.clockTime + (now - anchor.perf) / 1000)) > 0.25) {
        anchor = { clockTime: published, perf: now };
        anchorRef.current = anchor;
      }
      writeFrame(anchor.clockTime + (now - anchor.perf) / 1000, true);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setPointCachePlaybackState({ frameFloat: 0, running: false, suspended: false });
    };
  }, [enabled, loop, source, retimerEnabled, retimerRate, retimerStartFrame, retimerEndFrame, retimerReverse, retimerInterpolation]);
}
