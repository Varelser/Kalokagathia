/**
 * Visible light volume for the 3D light (Phase Y, Lux).
 *
 * Phase T gave the scene a 3D light OBJECT that brightens GPGPU
 * points; Phase D's Lux is a screen-space glow/cone in PostFx.
 * Neither draws light that is visible in EMPTY space. This module
 * is the pure reference for the missing piece: a volumetric cone
 * (spotlight beam) / sphere (point glow volume) centred on the
 * Phase T light, drawn as a dedicated mesh with a raymarch-style
 * shader (components/LightVolume.tsx carries the GLSL twin).
 *
 * Method (Phase Y brief §0-3, decided by the integration side):
 * the beam is accumulated over `steps` axial samples of an
 * analytic density function — NOT a full-screen raymarch and NOT
 * intersected with scene depth. There is therefore no occlusion:
 * the volume draws over / through geometry, and its edges are
 * softened by the `softness` key instead of a depth fade. That
 * limit is stated in the UI, the changelog and the audit.
 *
 * Everything here is a pure function of its inputs (no DOM, no
 * clock, no RNG): the same parameters give bit-identical values,
 * and the unit tests pin the GLSL twin to these formulas.
 *
 * Density (cone): at axial fraction s in [0, 1] (0 = apex at the
 * light, 1 = far end), the axial profile is (1 - s)^1.3. A
 * fragment's view chord through the volume is approximated by
 * chord = |dot(surfaceNormal, viewDir)| in [0, 1] (1 through the
 * middle of the silhouette, 0 at its rim — the standard
 * fake-volume chord), and
 *   density(s, chord) = (1 - s)^1.3 * chord^edge,
 * with edge = mix(0.8, 2.2, softness). The fragment at axial
 * fraction u accumulates the mean of the axial profile over the
 * samples s_i = u * i / steps (left-edge samples, like a naive
 * raymarch), weighted by the chord —
 * few steps band visibly along the axis, many steps converge to
 * the smooth integral. (Evaluating a radial density ON the
 * mesh surface would be identically zero — the surface is by
 * definition at radial fraction 1 — which is why the chord
 * weight, not a radial term, carries the cross-beam falloff.)
 *
 * Density (sphere): the chord profile (1 - f^2) averaged over
 * the step samples f_i = (i + 0.5) / steps, weighted by chord.
 */

export interface LightVolumeParams {
  shape: 'cone' | 'sphere';
  /** Brightness multiplier; 0 draws nothing. */
  intensity: number;
  /** Cone length / sphere radius in world units. */
  length: number;
  /** Cone half angle in degrees (sphere ignores it). */
  angleDeg: number;
  /** Axial sample count, clamped to [1, 32]. */
  steps: number;
  /** Edge softness, clamped to [0, 1]. */
  softness: number;
}

export const LIGHT_VOLUME_MAX_STEPS = 32;

export function clampVolumeSteps(steps: number): number {
  if (!Number.isFinite(steps)) return 12;
  return Math.max(1, Math.min(LIGHT_VOLUME_MAX_STEPS, Math.round(steps)));
}

export function clampVolumeSoftness(softness: number): number {
  if (!Number.isFinite(softness)) return 0.5;
  return Math.max(0, Math.min(1, softness));
}

/** Edge exponent from softness: softness 0 = hard-ish, 1 = very soft. */
export function volumeEdgeExponent(softness: number): number {
  const s = clampVolumeSoftness(softness);
  return 0.8 + (2.2 - 0.8) * s;
}

/** Cone radius at axial fraction s (0 at the apex). */
export function coneRadiusAt(s: number, length: number, angleDeg: number): number {
  const half = (Math.max(0, Math.min(89, angleDeg)) * Math.PI) / 180;
  return Math.tan(half) * Math.max(0, length) * Math.max(0, Math.min(1, s));
}

/** Cone density at axial fraction s for a view chord in [0, 1]. */
export function coneDensityAt(s: number, chord: number, params: LightVolumeParams): number {
  const ss = Math.max(0, Math.min(1, s));
  const cc = Math.max(0, Math.min(1, chord));
  const axial = Math.pow(1 - ss, 1.3);
  return axial * Math.pow(cc, volumeEdgeExponent(params.softness));
}

/**
 * The accumulated cone brightness at a fragment whose axial
 * fraction is u and whose view chord is `chord`: the mean of
 * `steps` axial density samples in [0, u], times intensity.
 * This is exactly the GLSL loop.
 */
export function accumulateConeVolume(u: number, chord: number, params: LightVolumeParams): number {
  const steps = clampVolumeSteps(params.steps);
  const uu = Math.max(0, Math.min(1, u));
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    const s = uu * (i / steps);
    acc += coneDensityAt(s, chord, params);
  }
  return params.intensity * (acc / steps);
}

/** Sphere chord profile at sample fraction f in [0, 1]. */
export function sphereDensityAt(f: number): number {
  const ff = Math.max(0, Math.min(1, f));
  return 1 - ff * ff;
}

/**
 * The accumulated sphere brightness for a view chord in [0, 1]:
 * the mean of `steps` chord-profile samples, weighted by
 * chord^edge, times intensity (x1.4 headroom, clamped by the
 * shader's final clamp). GLSL twin.
 */
export function accumulateSphereVolume(chord: number, params: LightVolumeParams): number {
  const steps = clampVolumeSteps(params.steps);
  const cc = Math.max(0, Math.min(1, chord));
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    acc += sphereDensityAt(i / steps);
  }
  return params.intensity * (acc / steps) * Math.pow(cc, volumeEdgeExponent(params.softness)) * 1.4;
}

/** Whether the volume would draw anything at all. */
export function lightVolumeDraws(params: LightVolumeParams & { enabled: boolean }): boolean {
  return params.enabled && params.intensity > 0 && params.length > 0;
}
