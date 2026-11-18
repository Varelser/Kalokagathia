/**
 * Grains solver resolution (Phase AQ solver, Phase BB repose).
 *
 * The single point where the velocity pass's friction uniform is
 * decided. Phase AQ made the pile's angle of repose an emergent
 * value of the Coulomb friction coefficient μ — and the AQ gate
 * measured the emergence as non-monotonic in the friction key
 * (the floor's own tangential friction and landing pressure
 * confound it). Phase BB adds the direct specification the audit
 * asked for: `gpgpuGrainsReposeAngle`, in degrees.
 *
 * Priority (documented, single-sourced here): while the repose
 * angle is > 0 it OVERRIDES the friction key — the effective
 * coefficient is μ = tan(angle), the textbook relation between a
 * Coulomb coefficient and the steepest slope that stands. At 0
 * (default) the friction key rules exactly as before, so every
 * legacy configuration is bit-identical.
 *
 * The angle is clamped to 89° for the tangent: tan(90°) is
 * unbounded, and 89° already gives μ ≈ 57 — past any physical
 * granular material, effectively a locked pile.
 */

import type { ParticleConfig } from '../types';

/** Steepest settable repose angle (the key's own range). */
export const GRAINS_REPOSE_MAX_DEG = 90;
/** Angle used for the tangent at the top of the range. */
export const GRAINS_REPOSE_TAN_CLAMP_DEG = 89;

/** True while the direct repose specification overrides the friction key. */
export function grainsReposeActive(config: ParticleConfig): boolean {
  return (config.gpgpuGrainsReposeAngle ?? 0) > 0;
}

/**
 * The friction coefficient the solver actually runs with:
 * tan(repose) while the repose key is set, the friction key
 * otherwise. Always finite and ≥ 0.
 */
export function effectiveGrainsFriction(config: ParticleConfig): number {
  const repose = Math.max(0, Math.min(GRAINS_REPOSE_MAX_DEG, config.gpgpuGrainsReposeAngle ?? 0));
  if (repose > 0) {
    const deg = Math.min(repose, GRAINS_REPOSE_TAN_CLAMP_DEG);
    return Math.tan((deg * Math.PI) / 180);
  }
  return Math.max(0, config.gpgpuGrainsFriction || 0);
}
