/**
 * Particle density field for Shine (Phase 22 stage 2, the §4
 * design by #11 白丸 — "Shine density texturing").
 *
 * What this is: a screen-space density field of the GPGPU main
 * layer, splatted from the position texture into a quarter-
 * resolution target, consumed by the LightFx Shine ray march
 * as a transmittance term. It is NOT a shadow: the light
 * position is a manual 2D UV and the field is screen-space, so
 * what it expresses is "a dense particle region weakens rays
 * passing through it" — density attenuation, never called a
 * shadow in UI or reports (the Phase Z naming discipline).
 *
 * Pieces:
 *  1. Pure math (TS) + GLSL twins that must never drift:
 *     the log compression of the raw splat accumulation and
 *     the per-segment transmittance factor.
 *  2. A tiny shared store (the lib/sceneDepth.ts precedent):
 *     the splat lives in components/sceneGpgpuSystem.tsx —
 *     that is where the position texture, the draw geometry
 *     and the point size already are, so no new publish path
 *     for the texture was needed — and the LightFx pass reads
 *     the store directly. The store is null whenever
 *     postShineDensity is 0 (the splat never runs then) and
 *     the LightFx fragment is the legacy string verbatim in
 *     that state, so the default render is unchanged.
 */

import type * as THREE from 'three';

/** Quarter-resolution splat target (design-fixed, not a key). */
export const PARTICLE_DENSITY_SCALE = 0.25;

/** Per-particle splat gain: ~50 overlapping splats reach 1.0
 *  of raw accumulation, which the log compression maps to
 *  ~0.82 — dense walls saturate gracefully instead of clipping. */
export const PARTICLE_DENSITY_SPLAT_GAIN = 0.02;

/** Raw accumulation -> normalised density: log1p scaled so
 *  raw 1.0 maps to exactly 1.0 (log(1 + 8) in the denominator). */
export function shineDensityLog(raw: number): number {
  if (!(raw > 0)) return 0;
  return Math.log(1 + raw * 8) / Math.log(9);
}

/** GLSL twin of shineDensityLog (the 0.4551196 constant is
 *  1 / ln(9)). Spliced into the LightFx fragment only in the
 *  density variant. */
export const SHINE_DENSITY_GLSL = /* glsl */ `
float kaloShineDensityLog(float raw) {
  return log(1.0 + raw * 8.0) * 0.4551196;
}
`;

/**
 * Per-segment transmittance factor (TS twin of the fragment's
 * inline term): T *= exp(-strength * K * dlog * ds), with the
 * design-fixed gain K = 3. ds is the ray segment length in
 * aspect-corrected units.
 */
export const SHINE_DENSITY_GAIN = 3.0;
export function shineDensityTransmittance(
  strength: number,
  rawDensity: number,
  ds: number,
): number {
  if (!(strength > 0) || !(ds > 0)) return 1;
  return Math.exp(-strength * SHINE_DENSITY_GAIN * shineDensityLog(rawDensity) * ds);
}

// ---------------------------------------------------------------------------
// Shared density-source store (splat publishes, LightFx reads)

export interface ParticleDensitySource {
  texture: THREE.Texture;
}

let currentSource: ParticleDensitySource | null = null;

export function setParticleDensitySource(next: ParticleDensitySource | null): void {
  if (currentSource === next) return;
  if (
    currentSource !== null && next !== null && currentSource.texture === next.texture
  ) {
    return;
  }
  currentSource = next;
}

export function getParticleDensitySource(): ParticleDensitySource | null {
  return currentSource;
}
