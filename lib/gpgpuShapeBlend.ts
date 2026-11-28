// Shape blend (Layer 1 WP8, phase E).
//
// Vertex-correspondence blending of two point sets — the
// blendshape / shape-key mechanism: the two sets are put
// into index correspondence and interpolated directly at a
// fixed parameter t. Point i of the result is a weighted
// mean of point i of A and point i of B; nothing moves over
// time and there is no dynamics in this module at all.
//
// This is a DIFFERENT mechanism from the morph in
// lib/gpgpuMorphTargets.ts, and the header states it plainly
// because the two are easy to conflate: the morph there is
// point-cloud ATTRACTION — every particle owns one target
// point and a spring pulls it there over frames (k =
// morphStrength * dt, with a snap branch), so a shape change
// is a target-cloud swap whose transition is whatever the
// spring does. Here there is no spring, no per-frame state
// and no target cloud: the blend is a pure function of the
// two point sets and t, evaluated once, and the in-between
// shapes are exact interpolants rather than transients.
// The two compose (a blend can bake the cloud an attraction
// morph then pulls toward), but neither replaces the other.
//
// Correspondence and the resample rule: point i corresponds
// to point i. When the counts differ, both sets are first
// resampled to the output count by INDEX-SPACE LINEAR
// INTERPOLATION at the midpoint parameters: output point i
// samples the source at
//
//   s = (i + 0.5) * fromCount / toCount - 0.5,
//
// clamped to [0, fromCount - 1], lerping between floor(s)
// and ceil(s) — the (i + 0.5) / n midpoint convention the
// path and placement grammars sample with. The rule treats
// the point list as an ordered polyline in index space (it
// does NOT close the loop), and it is exactly the identity
// when fromCount == toCount (s = i), so equal-count blends
// read their inputs bit for bit. The same rule resamples
// every lane (positions, normals, alpha).
//
// Lane rules: positions always blend. Normals blend only
// when BOTH sides supply them (lerp, then renormalise; a
// zero-length result stays zero) — a one-sided normal lane
// has no counterpart to interpolate against, so the result
// carries none. Alpha blends whenever at least one side
// supplies it, a missing lane counting as 1 (the bake's own
// default alpha, lib/gpgpuShapeStack.ts's cloud packing);
// both missing keeps the lane absent. Endpoints are exact:
// t = 0 returns the (resampled) A set and t = 1 the
// (resampled) B set as copies, never a lerp against the
// other side, so the endpoints hold bit for bit.

/** The point-set shape the blend reads and returns — the
 *  shape stack's resolved shape (lib/gpgpuShapeStack.ts
 *  ShapeStackPoints is structurally this). */
export interface ShapeBlendPointSet {
  count: number;
  /** Flat xyz triples, count * 3. */
  positions: Float32Array;
  /** Flat xyz triples, count * 3, or null. */
  normals: Float32Array | null;
  /** Per-point alpha, count wide, or null. */
  alpha: Float32Array | null;
}

/** Clamp a blend parameter into [0, 1]; non-finite is 0. */
export function clampBlendT(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Resample one lane (width components per point) from
 * fromCount points to toCount points by the index-space
 * rule in the header. Equal counts return a copy of the
 * input, bit for bit. An unusable target count returns an
 * empty lane.
 */
export function resampleBlendLane(
  data: Float32Array,
  fromCount: number,
  toCount: number,
  width: number,
): Float32Array {
  if (!Number.isInteger(toCount) || toCount < 1 || !Number.isInteger(fromCount) || fromCount < 1) {
    return new Float32Array(0);
  }
  if (fromCount === toCount) return new Float32Array(data.subarray(0, fromCount * width));
  const out = new Float32Array(toCount * width);
  for (let i = 0; i < toCount; i++) {
    let s = ((i + 0.5) * fromCount) / toCount - 0.5;
    if (s < 0) s = 0;
    else if (s > fromCount - 1) s = fromCount - 1;
    const lo = Math.floor(s);
    const hi = Math.min(fromCount - 1, lo + 1);
    const f = s - lo;
    for (let c = 0; c < width; c++) {
      const a = data[lo * width + c];
      const b = data[hi * width + c];
      out[i * width + c] = a + (b - a) * f;
    }
  }
  return out;
}

/**
 * Resample a whole point set to a new count (every lane by
 * the header's rule; absent lanes stay absent).
 */
export function resampleShapePointSet(
  points: ShapeBlendPointSet,
  toCount: number,
): ShapeBlendPointSet {
  return {
    count: toCount,
    positions: resampleBlendLane(points.positions, points.count, toCount, 3),
    normals: points.normals ? resampleBlendLane(points.normals, points.count, toCount, 3) : null,
    alpha: points.alpha ? resampleBlendLane(points.alpha, points.count, toCount, 1) : null,
  };
}

function lerpLane(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/**
 * Blend two point sets at parameter t. The output count is
 * `targetCount` when a usable one is given, else the larger
 * of the two input counts; both sides are resampled to it
 * by the header's rule before the lerp. t is clamped to
 * [0, 1] and the endpoints return the resampled side
 * verbatim (see the header's lane rules).
 */
export function blendShapePointSets(
  a: ShapeBlendPointSet,
  b: ShapeBlendPointSet,
  t: number,
  targetCount?: number,
): ShapeBlendPointSet {
  const tt = clampBlendT(t);
  const count =
    targetCount !== undefined && Number.isInteger(targetCount) && targetCount >= 1
      ? targetCount
      : Math.max(a.count, b.count);
  const ra = resampleShapePointSet(a, count);
  const rb = resampleShapePointSet(b, count);
  if (tt === 0) return ra;
  if (tt === 1) return rb;
  const positions = lerpLane(ra.positions, rb.positions, tt);
  let normals: Float32Array | null = null;
  if (ra.normals && rb.normals) {
    const blended = lerpLane(ra.normals, rb.normals, tt);
    for (let i = 0; i < count; i++) {
      const x = blended[i * 3];
      const y = blended[i * 3 + 1];
      const z = blended[i * 3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) {
        blended[i * 3] = x / len;
        blended[i * 3 + 1] = y / len;
        blended[i * 3 + 2] = z / len;
      }
    }
    normals = blended;
  }
  let alpha: Float32Array | null = null;
  if (ra.alpha || rb.alpha) {
    const aLane = ra.alpha ?? new Float32Array(count).fill(1);
    const bLane = rb.alpha ?? new Float32Array(count).fill(1);
    alpha = lerpLane(aLane, bLane, tt);
  }
  return { count, positions, normals, alpha };
}
