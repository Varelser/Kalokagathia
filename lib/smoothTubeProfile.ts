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

// ── Ribbon width / height profiles (Phase AM) ──────────────────
// The Sweep/Loft remainder: the ring's N component (width) and
// B component (height) scale independently along the tube's
// length, each by a free-curve profile (lib/freeCurve.ts) over
// the same ring parameter t the taper uses. The identity
// profile evaluates to exactly 1, so with the default profiles
// the vertex math is the legacy computation bit for bit (a
// multiply by 1.0). Scales clamp to [0, 2] like the custom
// section profile.

import {
  evaluateFreeCurve,
  type FreeCurvePoint,
} from './freeCurve';
import { clampTubeSectionCustomScale } from './tubeSectionProfile';

/** Width (N) or height (B) scale of ring t under a profile. */
export function tubeRibbonScaleAt(
  profile: readonly FreeCurvePoint[] | null | undefined,
  t: number,
): number {
  if (!profile || profile.length < 2) return 1;
  const tt = Math.max(0, Math.min(1, t));
  return clampTubeSectionCustomScale(evaluateFreeCurve(profile, tt));
}
