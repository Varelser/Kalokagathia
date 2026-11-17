/**
 * Placed wind volume (Phase AL).
 *
 * A spherical region that localises the global wind: inside the
 * sphere the wind contribution is scaled by the same smooth
 * falloff the 3D light uses ((1 - (d/R)^2)^2, zero at and beyond
 * the radius with a zero derivative), outside it is exactly zero.
 * Direction and gust are inherited from the global wind keys — the
 * volume is the placement grammar for the existing wind, in the
 * same way the SDF collider is a placed shape for collisions.
 *
 * The pure functions here are the reference implementation; the
 * velocity shader carries the GLSL twin with the same formula, and
 * the unit tests pin both. Strength 0 or a zero falloff yields an
 * exact zero contribution, and the whole block is skipped while
 * the volume is disabled, so the legacy velocity pass is verbatim.
 */

export interface WindVolumeParams {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  strength: number;
}

/** Falloff in [0, 1]: 1 at the centre, 0 at / beyond radius. */
export function windVolumeFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || distance >= radius) return 0;
  const q = (distance / radius) * (distance / radius);
  const x = 1 - q;
  return x * x;
}

/**
 * The volume's scalar weight for one particle position: the
 * falloff at its distance from the centre, times the volume
 * strength. This multiplies the same (direction * strength +
 * gust) vector the global wind applies, so a strength of 1 at the
 * centre reproduces the global wind exactly, locally.
 */
export function windVolumeWeight(
  px: number,
  py: number,
  pz: number,
  params: WindVolumeParams,
): number {
  const d = Math.hypot(px - params.centerX, py - params.centerY, pz - params.centerZ);
  return windVolumeFalloff(d, params.radius) * params.strength;
}
