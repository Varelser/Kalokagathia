import { dmHash11 } from './gpgpuRandom';
/**
 * Geometry spin random range (Phase AH).
 *
 * The instanced-geometry self-rotation (GEOM_VERT in
 * components/gpgpuShaderVolumes.ts) spun every instance at the
 * same rate `uSpinSpeed`, differing only by phase. This module is
 * the TS twin of the per-particle speed multiplier the shader now
 * applies: a second hash of the texel UV (the phase hash's family,
 * at a different offset so phase and speed are decorrelated)
 * picks a multiplier in [1 - r, 1 + r], where r is
 * `gpgpuGeomSpinRandom`. r = 0 makes the multiplier exactly 1 —
 * the shader skips the hash entirely on that branch — so the
 * default render is bit-identical. The multiplier is applied to
 * uSpinSpeed BEFORE both the plain path and the Phase AC age-curve
 * integral path, so the random range composes with Rotation over
 * Lifetime instead of replacing it.
 */

export function clampGeomSpinRandom(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Second texel hash in [0, 1): the GEOM_VERT phase hash family
 * (the Phase DM vector hash12) evaluated at p = uv + (19.19, 7.77).
 * Keep the offset in sync with `spinHash2` in the shader.
 */

export function spinRandomHashForUv(u: number, v: number): number {
  return dmHash11((u + 19.19) * 269.5 + (v + 7.77) * 183.3);
}

/** Per-particle spin speed multiplier in [1 - r, 1 + r]. */
export function spinRandomMultiplier(u: number, v: number, randomRange: number): number {
  const r = clampGeomSpinRandom(randomRange);
  if (r <= 0) return 1;
  const h = spinRandomHashForUv(u, v);
  return 1 - r + 2 * r * h;
}
