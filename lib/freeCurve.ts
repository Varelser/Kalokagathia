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
 *
 * Interpolation modes (Layer 1 WP9 phase A): the linear evaluation
 * above stays the default and its arithmetic is untouched — the
 * closed-form integral consumers (the S2 retimer line) and the
 * GLSL twin both rest on it. An asset may instead carry the
 * 'smooth' mode (see FreeCurveAsset below): a monotone cubic
 * Hermite evaluation (Fritsch–Carlson) that passes through the
 * same knots, holds the same endpoints, and never overshoots a
 * segment's endpoint values. The smooth mode is a TS-side mode
 * for now — no consumer resolves it yet, so no GLSL twin exists;
 * wiring it shader-side is a separate phase.
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
 * Evaluation at t (clamped to [0, 1]). Outside the knot range
 * the endpoint values hold. Knots return their value
 * bit-exactly, and an all-ones curve returns exactly 1.
 *
 * The default mode is the piecewise-linear evaluation — the
 * legacy arithmetic, bit-identical for every existing caller
 * (the two-argument form is unchanged). Passing 'smooth'
 * dispatches to the monotone cubic evaluation below.
 */
export function evaluateFreeCurve(
  points: readonly FreeCurvePoint[],
  t: number,
  interp: FreeCurveInterpMode = 'linear',
): number {
  if (interp === 'smooth') return evaluateFreeCurveSmooth(points, t);
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

// ── Interpolation modes (Layer 1 WP9 phase A) ────────────

/**
 * How a free curve is evaluated between its knots. 'linear' is
 * the legacy piecewise-linear evaluation and the default
 * everywhere; 'smooth' is the added monotone cubic mode. The
 * mode lives inside the asset's authoring form (FreeCurveAsset),
 * never in a config key of its own, so existing stored assets —
 * flat arrays with no mode anywhere — keep resolving to linear.
 */
export type FreeCurveInterpMode = 'linear' | 'smooth';

export const FREE_CURVE_INTERP_MODES: readonly FreeCurveInterpMode[] = ['linear', 'smooth'];

export const FREE_CURVE_DEFAULT_INTERP: FreeCurveInterpMode = 'linear';

/** Coerce arbitrary input into an interp mode: only the exact
 *  string 'smooth' selects the smooth mode; anything else
 *  (including absence) is the linear default. */
export function normalizeFreeCurveInterp(input: unknown): FreeCurveInterpMode {
  return input === 'smooth' ? 'smooth' : 'linear';
}

/**
 * Fritsch–Carlson tangents for the monotone cubic evaluation:
 * secant-averaged interior tangents, zeroed at local extrema,
 * then limited per segment (α² + β² ≤ 9, negatives clamped to
 * zero) so the Hermite interpolant is monotone wherever the
 * knots are and never leaves a segment's endpoint value range.
 * Tangents only ever shrink toward zero during the limiter
 * pass, which keeps every already-limited segment inside the
 * sufficient [0, 3]² region.
 */
function freeCurveSmoothTangents(points: readonly FreeCurvePoint[]): number[] {
  const n = points.length;
  const tangents = new Array<number>(n).fill(0);
  if (n < 2) return tangents;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const span = points[i + 1].t - points[i].t;
    secants.push(span > 0 ? (points[i + 1].v - points[i].v) / span : 0);
  }
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const d0 = secants[i - 1];
    const d1 = secants[i];
    tangents[i] = d0 === 0 || d1 === 0 || (d0 < 0) !== (d1 < 0) ? 0 : (d0 + d1) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const d = secants[i];
    if (d === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    let alpha = tangents[i] / d;
    let beta = tangents[i + 1] / d;
    if (alpha < 0) {
      tangents[i] = 0;
      alpha = 0;
    }
    if (beta < 0) {
      tangents[i + 1] = 0;
      beta = 0;
    }
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangents[i] = tau * alpha * d;
      tangents[i + 1] = tau * beta * d;
    }
  }
  return tangents;
}

/**
 * Monotone cubic (Fritsch–Carlson Hermite) evaluation at t,
 * under the same contract as the linear evaluation: t clamped
 * to [0, 1], endpoint values held outside the knot range, knots
 * returned bit-exactly, and an all-ones curve returns exactly 1
 * (all secants and tangents are 0, so every basis term collapses
 * onto the knot values). A two-point curve reduces to the linear
 * blend (both tangents equal the secant).
 */
export function evaluateFreeCurveSmooth(points: readonly FreeCurvePoint[], t: number): number {
  if (points.length === 0) return 1;
  const x = Math.min(1, Math.max(0, t));
  if (x <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.t) return last.v;
  const tangents = freeCurveSmoothTangents(points);
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      if (x === b.t) return b.v;
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      const s = (x - a.t) / span;
      const s2 = s * s;
      const s3 = s2 * s;
      return (
        (2 * s3 - 3 * s2 + 1) * a.v +
        (s3 - 2 * s2 + s) * span * tangents[i - 1] +
        (-2 * s3 + 3 * s2) * b.v +
        (s3 - s2) * span * tangents[i]
      );
    }
  }
  return last.v;
}

// ── Asset form with the mode inside ──────────────────────

/**
 * A free curve asset: the normalised knot list plus its
 * interpolation mode. The stored form stays the flat array
 * while the mode is the linear default — the object form
 * ({ points: flat array, interp }) appears only when an author
 * actually selects 'smooth', so every asset stored before the
 * mode existed resolves unchanged.
 */
export interface FreeCurveAsset {
  points: FreeCurvePoint[];
  interp: FreeCurveInterpMode;
}

/**
 * Resolve arbitrary stored input into an asset. A flat array
 * (the legacy stored form) resolves to its knots with the
 * linear default; an object carrying a `points` field resolves
 * its knots from that field and its mode from `interp`;
 * anything else falls back to the identity asset, linear.
 */
export function resolveFreeCurveAsset(input: unknown): FreeCurveAsset {
  if (Array.isArray(input)) {
    return { points: normalizeFreeCurvePoints(input), interp: FREE_CURVE_DEFAULT_INTERP };
  }
  if (input !== null && typeof input === 'object' && 'points' in input) {
    const record = input as { points?: unknown; interp?: unknown };
    return {
      points: normalizeFreeCurvePoints(record.points),
      interp: normalizeFreeCurveInterp(record.interp),
    };
  }
  return { points: normalizeFreeCurvePoints(undefined), interp: FREE_CURVE_DEFAULT_INTERP };
}

/**
 * Flatten an asset back into a storable form: the plain flat
 * array while the mode is linear (bit-identical to the legacy
 * stored form), the object form only for the smooth mode, so
 * the mode survives a store/load round trip and nothing that
 * was stored before gains a wrapper.
 */
export function flattenFreeCurveAsset(
  asset: FreeCurveAsset,
): number[] | { points: number[]; interp: FreeCurveInterpMode } {
  const flat = flattenFreeCurvePoints(asset.points);
  if (asset.interp === 'linear') return flat;
  return { points: flat, interp: asset.interp };
}

/** Evaluate an asset under its own mode. */
export function evaluateFreeCurveAsset(asset: FreeCurveAsset, t: number): number {
  return evaluateFreeCurve(asset.points, t, asset.interp);
}

/** Identity for an asset: the knot values decide (a flat
 *  all-ones curve evaluates to exactly 1 under both modes). */
export function isFreeCurveAssetIdentity(asset: FreeCurveAsset): boolean {
  return isFreeCurveIdentity(asset.points);
}
