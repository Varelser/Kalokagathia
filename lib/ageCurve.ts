/**
 * Age curves (Phase U): a fixed-position 5-point curve over the
 * normalised particle age t in [0, 1]. Points sit at t = 0, 0.25,
 * 0.5, 0.75, 1 and are linearly interpolated — the deliberate,
 * bounded form of Particular-style "draw a curve over life": no
 * free control points, no editor surface, just five sliders.
 *
 * The curve is a MULTIPLIER layered on the legacy age paths
 * (AgeSize start/end, fade in/out): with every point at 1 the factor
 * is exactly 1 at every t, so enabling a curve and leaving it flat
 * reproduces the legacy output bit-for-bit. The GLSL twin of
 * `evaluateAgeCurve` lives in components/gpgpuShaderPoints.ts
 * (kaloEvalCurve5) and must stay numerically identical: same knot
 * positions, same piecewise-linear blend.
 */

export const AGE_CURVE_POINT_COUNT = 5;

/** Upper clamp for a single curve point (matches the UI sliders). */
export const AGE_CURVE_POINT_MAX = 4;

export const AGE_CURVE_IDENTITY: readonly number[] = [1, 1, 1, 1, 1];

/**
 * Coerce arbitrary input into a clean 5-point curve: exactly five
 * finite numbers clamped to [0, AGE_CURVE_POINT_MAX]. Non-array
 * input and missing / non-finite entries fall back per-point to the
 * supplied fallback (identity by default), so a malformed preset can
 * never push NaN into a shader uniform.
 */
export function normalizeAgeCurvePoints(
  input: unknown,
  fallback: readonly number[] = AGE_CURVE_IDENTITY,
): number[] {
  const source = Array.isArray(input) ? input : [];
  const points: number[] = [];
  for (let i = 0; i < AGE_CURVE_POINT_COUNT; i++) {
    const raw = source[i];
    const fb = typeof fallback[i] === 'number' && Number.isFinite(fallback[i]) ? fallback[i] : 1;
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : fb;
    points.push(Math.min(AGE_CURVE_POINT_MAX, Math.max(0, value)));
  }
  return points;
}

/**
 * Piecewise-linear evaluation at normalised age t (clamped to
 * [0, 1]). Knot positions are exact: t=0 returns points[0], t=1
 * returns points[4], and the interior knots return their point
 * bit-exactly (the chained blend below would otherwise accumulate
 * rounding). An all-ones curve returns exactly 1 for every t.
 */
export function evaluateAgeCurve(points: readonly number[], t: number): number {
  const x = Math.min(1, Math.max(0, t)) * (AGE_CURVE_POINT_COUNT - 1);
  if (Number.isInteger(x)) return points[x];
  let v = points[0];
  v = v + (points[1] - v) * Math.min(1, Math.max(0, x));
  v = v + (points[2] - v) * Math.min(1, Math.max(0, x - 1));
  v = v + (points[3] - v) * Math.min(1, Math.max(0, x - 2));
  v = v + (points[4] - v) * Math.min(1, Math.max(0, x - 3));
  return v;
}

/** True when the curve is the identity (every point exactly 1). */
export function isAgeCurveIdentity(points: readonly number[]): boolean {
  return points.length === AGE_CURVE_POINT_COUNT && points.every((p) => p === 1);
}

/**
 * Closed-form integral of the curve from 0 to x (x clamped to
 * [0, 1]): the area under the piecewise-linear shape, computed
 * segment by segment (trapezoids for full segments, the exact
 * quadratic for the partial one). An all-ones curve integrates to
 * exactly x. Phase AC uses this for Rotation over Lifetime: the
 * geometry spin angle advances by spinSpeed × ageMax × this
 * integral over the particle's normalised age, so the spin rate —
 * not the angle — is what the curve multiplies, with no
 * accumulation state. The GLSL twin (kaloCurveIntegral5) lives in
 * components/gpgpuShaderVolumes.ts and follows the same segment
 * arithmetic.
 */
export function integrateAgeCurve(points: readonly number[], xInput: number): number {
  const x = Math.min(1, Math.max(0, xInput));
  const h = 1 / (AGE_CURVE_POINT_COUNT - 1);
  const segArea = (i: number) => (h * (points[i] + points[i + 1])) / 2;
  if (x <= h) {
    const f = x / h;
    return h * (points[0] * f + ((points[1] - points[0]) * f * f) / 2);
  }
  if (x <= 2 * h) {
    const f = (x - h) / h;
    return segArea(0) + h * (points[1] * f + ((points[2] - points[1]) * f * f) / 2);
  }
  if (x <= 3 * h) {
    const f = (x - 2 * h) / h;
    return segArea(0) + segArea(1) + h * (points[2] * f + ((points[3] - points[2]) * f * f) / 2);
  }
  const f = (x - 3 * h) / h;
  return segArea(0) + segArea(1) + segArea(2) + h * (points[3] * f + ((points[4] - points[3]) * f * f) / 2);
}

export interface AgeCurvePreset {
  id: string;
  label: string;
  points: readonly number[];
}

/** One-tap shapes written into the point list by the UI chips. */
export const AGE_CURVE_PRESETS: readonly AgeCurvePreset[] = [
  { id: 'flat', label: '一定', points: [1, 1, 1, 1, 1] },
  { id: 'rise', label: '右上がり', points: [0.2, 0.55, 0.9, 1.3, 1.7] },
  { id: 'fall', label: '右下がり', points: [1.7, 1.3, 0.9, 0.55, 0.2] },
  { id: 'mountain', label: '山', points: [0.3, 1.2, 2.2, 1.2, 0.3] },
  { id: 'valley', label: '谷', points: [1.8, 0.9, 0.25, 0.9, 1.8] },
];
