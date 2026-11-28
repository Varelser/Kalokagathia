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
 *
 * Falloff SHAPES (Layer 1 WP5, phase A): the curve above is the
 * default shape ('smooth'). Two further shapes — 'linear' and
 * 'smoothstep' — are defined alongside it below so placed fields
 * (lib/gpgpuFieldInstances.ts) can select a curve per instance.
 * The default shape delegates to windVolumeFalloff itself, so
 * every existing consumer keeps bit-identical values; the GLSL
 * twins of the new shapes are spliced by the shader phase (WP5
 * phase D) from the formulas documented on falloffShapeValue.
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

// ── Falloff shapes ───────────────────────────────────────────
//
// A shape is a curve over the normalised distance t = d / R,
// always 1 at the centre and 0 at / beyond the radius:
//
//   'smooth'     (1 - t^2)^2            — the legacy curve above
//   'linear'     1 - t
//   'smoothstep' s(t) = u^2 (3 - 2u) with u = 1 - t
//
// The identifiers are authoring strings (the field-instance
// `falloff` field carries one); anything unrecognised resolves
// to the default shape, so a bad value can never change the
// legacy behaviour.

export type FalloffShape = 'smooth' | 'linear' | 'smoothstep';

export const FALLOFF_SHAPES: readonly FalloffShape[] = ['smooth', 'linear', 'smoothstep'];

/** The shape every pre-WP5 consumer already uses. */
export const DEFAULT_FALLOFF_SHAPE: FalloffShape = 'smooth';

/** Resolve an authored shape value; unknown values (including
 *  non-strings) fall back to the default shape. */
export function resolveFalloffShape(value: unknown): FalloffShape {
  return value === 'linear' || value === 'smoothstep' || value === 'smooth'
    ? value
    : DEFAULT_FALLOFF_SHAPE;
}

/**
 * One shape's falloff in [0, 1] at a distance. The default
 * shape delegates to windVolumeFalloff, so its values are
 * bit-identical to the legacy curve by construction. The other
 * shapes share the legacy guards (a non-positive radius or a
 * distance at / beyond it is exactly 0, the centre is exactly
 * 1) and are monotonic non-increasing in distance.
 */
export function falloffShapeValue(shape: FalloffShape, distance: number, radius: number): number {
  if (shape === 'linear' || shape === 'smoothstep') {
    if (!(radius > 0) || distance >= radius) return 0;
    if (distance <= 0) return 1;
    const u = 1 - distance / radius;
    return shape === 'linear' ? u : u * u * (3 - 2 * u);
  }
  return windVolumeFalloff(distance, radius);
}

/** Falloff under an authored shape value (resolved through
 *  resolveFalloffShape, so unknown values give the default
 *  shape's values). */
export function shapedFalloff(shape: unknown, distance: number, radius: number): number {
  return falloffShapeValue(resolveFalloffShape(shape), distance, radius);
}
