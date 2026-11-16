/**
 * 3D light object for the GPGPU point draw (Phase T).
 *
 * A single monochrome point light (optionally a spotlight cone)
 * that multiplies the DRAWN brightness of GPGPU points by their
 * distance / angle to the light. It never touches the simulation:
 * positions and velocities are exactly what they would be without
 * the light — only the rendered colour is scaled.
 *
 * The pure functions here are the reference implementation; the
 * point shader carries a GLSL twin (kaloLight* in
 * components/gpgpuShaderPoints.ts) with the same formulas, and the
 * unit tests pin both to the same values.
 *
 * Falloff: f(d) = (1 - (d/R)^2)^2 for d < R, else 0. At d = 0 the
 * multiplier is exactly 1 + intensity; at d = R the falloff reaches
 * 0 with a zero derivative, so the multiplier settles smoothly back
 * to 1 (the unlit value) outside the radius.
 *
 * Cone: the feather band is fixed at 1.25x the half angle — full
 * light inside the half angle, a smoothstep down to nothing at
 * 1.25x the half angle (clamped at 180 degrees, where the cone
 * covers everything anyway).
 */

export const LIGHT_CONE_FEATHER = 1.25;

export interface GpgpuLightParams {
  intensity: number;
  radius: number;
  coneEnabled: boolean;
  coneAngleDeg: number;
}

/** Distance falloff in [0, 1]: 1 at the light, 0 at / beyond radius. */
export function lightFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || distance >= radius) return 0;
  const q = (distance / radius) * (distance / radius);
  const x = 1 - q;
  return x * x;
}

/**
 * Cone factor in [0, 1] from the cosine of the angle between the
 * light-to-particle direction and the cone direction.
 */
export function lightConeFactor(cosAngle: number, halfAngleDeg: number): number {
  if (!(halfAngleDeg > 0)) return cosAngle >= 1 ? 1 : 0;
  // At a 180-degree half angle the cone covers every direction and
  // the feather edges coincide (inner == outer), so answer directly.
  if (halfAngleDeg >= 180) return 1;
  const inner = Math.cos((halfAngleDeg * Math.PI) / 180);
  const outerDeg = Math.min(halfAngleDeg * LIGHT_CONE_FEATHER, 180);
  const outer = Math.cos((outerDeg * Math.PI) / 180);
  // GLSL smoothstep(outer, inner, cosAngle), expanded so the twin
  // relationship is obvious: t clamped to [0, 1], then t*t*(3-2t).
  const t = Math.min(1, Math.max(0, (cosAngle - outer) / (inner - outer)));
  return t * t * (3 - 2 * t);
}

/**
 * The full brightness multiplier for one particle.
 * `cosAngle` is only consulted when the cone is enabled.
 * Intensity 0 (or a zero falloff) yields exactly 1.
 */
export function evaluateLightMultiplier(
  distance: number,
  cosAngle: number,
  params: GpgpuLightParams,
): number {
  let f = lightFalloff(distance, params.radius);
  if (params.coneEnabled) f *= lightConeFactor(cosAngle, params.coneAngleDeg);
  return 1 + params.intensity * f;
}

/** Normalise a cone direction; a zero vector falls back to (0, -1, 0). */
export function normalizeLightDir(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (!(len > 0) || !Number.isFinite(len)) return [0, -1, 0];
  return [x / len, y / len, z / len];
}
