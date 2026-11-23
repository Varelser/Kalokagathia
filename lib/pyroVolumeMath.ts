// Phase 19 stage 4 — Pyro volume raymarch math (CPU mirrors).
//
// The raymarch path for the Pyro grid's density field lives in
// components/gpgpuShaderPyroVolume.ts (GLSL) and
// components/scenePyroVolumeSystem.tsx (box mesh + material).
// This module is the shared, unit-testable half: the ray x box
// interval, the Beer-Lambert accumulation the fragment shader
// performs, the tier step table, and the config resolution.
// The solver files (lib/pyroGrid.ts, the grid shaders and the
// grid passes) are untouched by this stage — the render path
// only READS the scalar atlas through the existing
// PyroGridFogFeed.

import type { GpuTier } from './gpuTier';

/** Render-path selector values for gpgpuPyroVolumeRender. */
export type PyroVolumeRenderMode = 'fog' | 'raymarch';

/**
 * Resolve the render mode. Anything that is not exactly
 * 'raymarch' resolves to the legacy 'fog' path, so a missing or
 * corrupt key can never mount the new system.
 */
export function pyroVolumeRenderMode(config: { gpgpuPyroVolumeRender?: unknown }): PyroVolumeRenderMode {
  return config.gpgpuPyroVolumeRender === 'raymarch' ? 'raymarch' : 'fog';
}

/**
 * The new system mounts only in raymarch mode AND while the
 * grid solver itself is enabled (the feed is empty otherwise).
 * With the default 'fog' this is always false, which is the
 * structural half of the stage's bit-identity guarantee.
 */
export function pyroVolumeActive(config: { gpgpuPyroVolumeRender?: unknown; gpgpuPyroGridEnabled?: unknown }): boolean {
  return pyroVolumeRenderMode(config) === 'raymarch' && config.gpgpuPyroGridEnabled === true;
}

/** Tier defaults for the march step count (design 4-2). */
export const PYRO_VOLUME_TIER_STEPS: Readonly<Record<GpuTier, number>> = {
  entry: 16,
  standard: 24,
  high: 32,
  flagship: 32,
};

export const PYRO_VOLUME_STEPS_MIN = 8;
export const PYRO_VOLUME_STEPS_MAX = 64;

/**
 * Resolve the effective step count: a manual key in
 * [8, 64] wins; 0 (or anything out of range that is not a
 * finite number) falls back to the tier default.
 */
export function resolvePyroVolumeSteps(tier: GpuTier, override: number): number {
  if (Number.isFinite(override) && override >= PYRO_VOLUME_STEPS_MIN && override <= PYRO_VOLUME_STEPS_MAX) {
    return Math.floor(override);
  }
  return PYRO_VOLUME_TIER_STEPS[tier] ?? PYRO_VOLUME_TIER_STEPS.standard;
}

/** Clamp the self-shadow march step count to [0, 8]. */
export function clampPyroVolumeShadowSteps(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(8, Math.max(0, Math.floor(v)));
}

/** Clamp the extinction scale; negative / non-finite -> 0. */
export function clampPyroVolumeDensity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(8, Math.max(0, v));
}

export interface Vec3Like { x: number; y: number; z: number }

const AXES = ['x', 'y', 'z'] as const;

/**
 * Ray x axis-aligned box interval (slab method), the CPU twin
 * of the GLSL in gpgpuShaderPyroVolume.ts. `dir` need not be
 * normalised; the returned [t0, t1] are in the same parameter
 * units as `origin + t * dir`. A ray starting inside the box
 * yields t0 = 0. Returns null when the ray misses the box or
 * the box lies entirely behind the origin.
 */
export function rayBoxInterval(
  origin: Vec3Like,
  dir: Vec3Like,
  center: Vec3Like,
  halfExtent: number,
): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const axis of AXES) {
    const lo = center[axis] - halfExtent;
    const hi = center[axis] + halfExtent;
    const d = dir[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return [Math.max(0, t0), t1];
}

/**
 * Deterministic per-pixel march jitter in [0, 1): the CPU twin
 * of the fragment shader's hash of gl_FragCoord. Deterministic
 * per pixel so the march offset never flickers between frames.
 */
export function pyroVolumeJitter(px: number, py: number): number {
  let h = Math.imul(Math.floor(px) + 1, 374761393) + Math.imul(Math.floor(py) + 1, 668265263);
  h = Math.imul(h ^ (h >> 13), 1274126177);
  h ^= h >> 16;
  return (h >>> 0) / 4294967296;
}

export interface BeerLambertResult {
  /** Accumulated opacity in [0, 1]. */
  alpha: number;
  /** Remaining transmittance in [0, 1]. */
  transmittance: number;
  /** Density-weighted mean temperature of the absorbed light. */
  temperature: number;
}

/**
 * Beer-Lambert accumulation, the CPU twin of the fragment
 * march: for each sample, optical depth tau = density *
 * densityScale * segLen, sample alpha = 1 - exp(-tau), and the
 * running colour/alpha accumulate front-to-back with the
 * running transmittance. Mirrors the shader's early-out: once
 * transmittance drops below 0.02 the remaining samples no
 * longer change the result (the loop still walks them here so
 * the mirror stays a pure function of its inputs; the returned
 * values are identical).
 */
export function pyroVolumeBeerLambert(
  densities: ArrayLike<number>,
  temperatures: ArrayLike<number>,
  segLen: number,
  densityScale: number,
): BeerLambertResult {
  let transmittance = 1;
  let alpha = 0;
  let tempAccum = 0;
  const n = Math.min(densities.length, temperatures.length);
  for (let i = 0; i < n; i += 1) {
    const sigma = Math.max(0, densities[i]) * densityScale;
    const a = 1 - Math.exp(-sigma * segLen);
    const w = transmittance * a;
    alpha += w;
    tempAccum += w * Math.max(0, temperatures[i]);
    transmittance *= 1 - a;
  }
  return {
    alpha,
    transmittance,
    temperature: alpha > 1e-12 ? tempAccum / alpha : 0,
  };
}

/**
 * Cube-domain transmittance toward a light direction, the CPU
 * twin of the fragment shader's self-shadow march: steps from
 * `from` along `dir` (normalised) for `segmentLength` world
 * units in `steps` equal steps, sampling density through the
 * caller's field function (world position -> density).
 */
export function pyroVolumeCubeTransmittance(
  sampleDensity: (p: Vec3Like) => number,
  from: Vec3Like,
  dir: Vec3Like,
  segmentLength: number,
  steps: number,
  densityScale: number,
): number {
  if (steps <= 0 || segmentLength <= 0) return 1;
  const segLen = segmentLength / steps;
  let transmittance = 1;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) * segLen;
    const d = sampleDensity({
      x: from.x + dir.x * t,
      y: from.y + dir.y * t,
      z: from.z + dir.z * t,
    });
    transmittance *= Math.exp(-Math.max(0, d) * densityScale * segLen);
  }
  return transmittance;
}
