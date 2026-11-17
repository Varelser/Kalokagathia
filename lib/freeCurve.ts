/**
 * Free control-point curve (Phase AJ).
 *
 * The bounded counterpart to the fixed 5-point age curves
 * (lib/ageCurve.ts): points sit at FREE positions t in [0, 1] with
 * values in [0, FREE_CURVE_VALUE_MAX], stored in config as one flat
 * array [t0, v0, t1, v1, …] so presets and project files carry the
 * asset like any other key. Evaluation is piecewise-linear — the
 * same interpolation family as the age curves — and an all-ones
 * curve evaluates to exactly 1 everywhere, which is what makes the
 * identity suppression in the simulation passes sound.
 *
 * The GLSL twin lives in components/gpgpuShaderSimulationPosition.ts
 * (kaloEvalFreeCurve over a uniform vec2 array) and must stay
 * numerically identical: same sorted knots, same piecewise-linear
 * blend, same endpoint clamping.
 */

export const FREE_CURVE_MIN_POINTS = 2;
export const FREE_CURVE_MAX_POINTS = 8;
export const FREE_CURVE_VALUE_MAX = 4;

/** The identity asset: flat 1 from t=0 to t=1. */
export const FREE_CURVE_IDENTITY: readonly number[] = [0, 1, 1, 1];

export interface FreeCurvePoint {
  t: number;
  v: number;
}

/**
 * Coerce arbitrary input into a clean point list: pairs are read
 * from the flat array, non-finite pairs dropped, t clamped to
 * [0, 1] and v to [0, FREE_CURVE_VALUE_MAX], sorted by t with
 * duplicate t collapsed (the later point wins, matching how an
 * editor would overwrite a knot). Fewer than MIN points falls back
 * to the identity asset; more than MAX keeps the first MAX after
 * sorting.
 */
export function normalizeFreeCurvePoints(input: unknown): FreeCurvePoint[] {
  const flat = Array.isArray(input) ? input : [];
  const byT = new Map<number, number>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const rawT = flat[i];
    const rawV = flat[i + 1];
    if (typeof rawT !== 'number' || typeof rawV !== 'number') continue;
    if (!Number.isFinite(rawT) || !Number.isFinite(rawV)) continue;
    const t = Math.min(1, Math.max(0, rawT));
    const v = Math.min(FREE_CURVE_VALUE_MAX, Math.max(0, rawV));
    byT.set(t, v);
  }
  const points = [...byT.entries()]
    .map(([t, v]) => ({ t, v }))
    .sort((a, b) => a.t - b.t)
    .slice(0, FREE_CURVE_MAX_POINTS);
  if (points.length < FREE_CURVE_MIN_POINTS) {
    return [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
    ];
  }
  return points;
}

/** Flatten a point list back into the stored config form. */
export function flattenFreeCurvePoints(points: readonly FreeCurvePoint[]): number[] {
  const flat: number[] = [];
  points.forEach((point) => {
    flat.push(point.t, point.v);
  });
  return flat;
}

/**
 * Piecewise-linear evaluation at t (clamped to [0, 1]). Outside
 * the knot range the endpoint values hold. Knots return their
 * value bit-exactly, and an all-ones curve returns exactly 1.
 */
export function evaluateFreeCurve(points: readonly FreeCurvePoint[], t: number): number {
  if (points.length === 0) return 1;
  const x = Math.min(1, Math.max(0, t));
  if (x <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.t) return last.v;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      if (x === b.t) return b.v;
      const span = b.t - a.t;
      const f = span > 0 ? (x - a.t) / span : 0;
      return a.v + (b.v - a.v) * f;
    }
  }
  return last.v;
}

/** True when every point is exactly 1 (the curve is the identity). */
export function isFreeCurveIdentity(points: readonly FreeCurvePoint[]): boolean {
  return points.length >= FREE_CURVE_MIN_POINTS && points.every((point) => point.v === 1);
}
