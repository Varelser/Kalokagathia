/**
 * Smooth Tube cross-section profile (Phase AA3).
 *
 * The history tube (components/sceneGpgpuSmoothTube.tsx) builds a
 * circular cross-section of `gpgpuSmoothTubeRadius` at every history
 * ring. Tao's tube grammar also tapers that cross-section along its
 * length; this module is the pure profile behind the taper key:
 * ring t (0 = oldest history, 1 = newest) gets radius factor
 * mix(1 - taper, 1, t) — the newest ring always keeps the full
 * radius, the tail thins toward (1 - taper) of it. Taper 0 (the
 * default) is exactly 1 everywhere, so legacy tubes are unchanged.
 */

export function clampSmoothTubeTaper(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Radius at ring parameter t in [0, 1] for the given taper. */
export function smoothTubeRadiusAt(baseRadius: number, t: number, taper: number): number {
  const tt = Math.max(0, Math.min(1, t));
  const k = clampSmoothTubeTaper(taper);
  return baseRadius * (1 - k + k * tt);
}
