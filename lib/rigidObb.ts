/**
 * Oriented bounding boxes (OBB) for rigid bodies (Phase 20
 * stage 1) — pure functions, no solver state.
 *
 * Scope (Sugi decision 2026-11-24): stage 1 shape collision
 * goes as far as OBBs. Convex hulls are NOT built here; the
 * shape is abstracted behind this module's small surface
 * (build → place → SAT test / support point) so a hull shape
 * can be added later behind the same calls.
 *
 * What this module provides:
 * - buildObbFromPoints: fit an OBB to a point set by principal
 *   component analysis (covariance eigenvectors), the standard
 *   fit for the fracture cells' local offsets.
 * - buildObbForCell / buildObbsForCells: the same fit for one
 *   body of a FractureCellData table (points = the body's
 *   localOffsets, i.e. offsets from the body's centroid in the
 *   bake frame).
 * - placeObb: put a local OBB into the world with a rigid
 *   body's position + quaternion (rigidBodies.ts convention:
 *   quaternions are [x, y, z, w], rotation uses the same
 *   quatRotate formula as lib/rigidBodies.ts).
 * - obbSatContact: 15-axis separating-axis test between two
 *   world OBBs.
 * - obbSupportPoint / obbFloorSupportOffset: support queries.
 *
 * Determinism: no Math.random, no wall clock. The Jacobi
 * eigensolver runs a fixed pivot order with fixed tie-breaking,
 * eigenvector signs are canonicalised (below), and axes are
 * ordered by descending eigenvalue with stable tie-breaking —
 * the same input points always produce the same OBB, bit for
 * bit.
 *
 * Sign / handedness conventions:
 * - Each principal axis is flipped so its largest-|component|
 *   entry is positive (first such entry wins ties).
 * - Axis 2 is then REPLACED by cross(axis0, axis1), so the
 *   frame is always right-handed and orthonormal.
 *
 * Degenerate inputs (documented behaviour, never NaN):
 * - 0 points: buildObbFromPoints returns null;
 *   buildObbForCell returns null for an empty body.
 * - 1 point / all points identical: covariance is zero, the
 *   axes fall back to the identity frame.
 * - Collinear or planar sets: the missing directions still get
 *   a Jacobi axis, and every half extent is clamped below by
 *   OBB_MIN_HALF_EXTENT so the box never collapses to zero
 *   thickness (a zero-thickness box would make the SAT test
 *   and support queries ill-defined).
 */

import type { FractureCellData } from './voronoiFracture';

export type Vec3 = [number, number, number];

/** Smallest half extent on any axis (see header: degenerates). */
export const OBB_MIN_HALF_EXTENT = 0.001;

/** An OBB in some frame: centre, orthonormal axes, half extents. */
export interface RigidObb {
  /** Box centre in the frame the points were given in. */
  center: Vec3;
  /** Orthonormal principal axes (right-handed), by descending variance. */
  axes: [Vec3, Vec3, Vec3];
  /** Half extent along each axis, >= OBB_MIN_HALF_EXTENT. */
  halfExtents: Vec3;
}

/** Result of the SAT test between two world OBBs. */
export interface ObbContact {
  hit: boolean;
  /**
   * Separation normal, oriented from A toward B (the direction
   * B must move to separate). Unit length when hit is true;
   * [0, 0, 0] when separated.
   */
  normal: Vec3;
  /** Penetration depth along `normal` (>= 0 when hit). */
  depth: number;
  /**
   * Approximate contact point: midpoint between A's support
   * point along +normal and B's support point along -normal.
   * [0, 0, 0] when separated.
   */
  point: Vec3;
}

const SEPARATED: ObbContact = { hit: false, normal: [0, 0, 0], depth: 0, point: [0, 0, 0] };

// ── Vector / quaternion helpers (rigidBodies.ts style) ──────

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-12) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Rotate vector v by quaternion q ([x,y,z,w]) — the same
 *  formula as lib/rigidBodies.ts quatRotate. */
export function obbQuatRotate(
  q: [number, number, number, number],
  v: Vec3,
): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

// ── Deterministic Jacobi eigensolver (symmetric 3×3) ────────

/**
 * Eigen-decomposition of a symmetric 3×3 matrix by cyclic
 * Jacobi rotations. Pivot selection scans the three
 * off-diagonal entries in a fixed order and takes the first
 * strict maximum, sweeps repeat until the off-diagonal mass is
 * below 1e-12 or 64 sweeps elapsed — both bounds fixed, so the
 * result is a pure function of the input.
 * Returns eigenvalues with their eigenvectors as COLUMNS of
 * `vectors` (vectors[i] is the eigenvector for values[i]),
 * unsorted.
 */
function jacobiEigen(m: [Vec3, Vec3, Vec3]): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
  const a: number[][] = [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ];
  // v accumulates the rotations; columns are the eigenvectors.
  const v: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const pivots: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12) break;
    for (const [p, q] of pivots) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-15) continue;
      // Standard Jacobi rotation (Numerical Recipes): t solves
      // t^2 + 2*tau*t - 1 = 0 with tau = (aqq-app)/(2*apq); this
      // (c, s) zeroes a[p][q] under A <- J^T A J, V <- V J.
      const app = a[p][p];
      const aqq = a[q][q];
      const tau = (aqq - app) / (2 * apq);
      const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        if (k === p || k === q) continue;
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[p][k] = a[k][p];
        a[k][q] = s * akp + c * akq;
        a[q][k] = a[k][q];
      }
      a[p][p] = app - t * apq;
      a[q][q] = aqq + t * apq;
      a[p][q] = 0;
      a[q][p] = 0;
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [
      [v[0][0], v[1][0], v[2][0]],
      [v[0][1], v[1][1], v[2][1]],
      [v[0][2], v[1][2], v[2][2]],
    ],
  };
}

/** Canonicalise an axis sign: largest-|component| entry > 0. */
function canonicalSign(axis: Vec3): Vec3 {
  let idx = 0;
  if (Math.abs(axis[1]) > Math.abs(axis[idx])) idx = 1;
  if (Math.abs(axis[2]) > Math.abs(axis[idx])) idx = 2;
  return axis[idx] < 0 ? [-axis[0], -axis[1], -axis[2]] : axis;
}

// ── Construction ─────────────────────────────────────────────

/**
 * Fit an OBB to an xyz-packed point set (3 floats per point,
 * the FractureCellData.localOffsets layout).
 *
 * Method: covariance of the points about their mean, principal
 * axes from the Jacobi eigensolver (descending eigenvalue,
 * stable on ties), then the box is re-centred on the midpoint
 * of the projected min/max so it tightly encloses every point
 * along each axis. Returns null for an empty set.
 */
export function buildObbFromPoints(
  points: ArrayLike<number>,
  count: number,
): RigidObb | null {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || points.length < n * 3) return null;

  // Mean (float64 accumulation, point order — deterministic).
  let mx = 0; let my = 0; let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += points[i * 3]; my += points[i * 3 + 1]; mz += points[i * 3 + 2];
  }
  mx /= n; my /= n; mz /= n;

  // Covariance (upper triangle; scale is irrelevant to axes).
  let cxx = 0; let cxy = 0; let cxz = 0;
  let cyy = 0; let cyz = 0; let czz = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i * 3] - mx;
    const dy = points[i * 3 + 1] - my;
    const dz = points[i * 3 + 2] - mz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }

  let axes: [Vec3, Vec3, Vec3];
  const trace = cxx + cyy + czz;
  if (trace < 1e-15) {
    // Single point / all points identical: identity frame.
    axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  } else {
    const { values, vectors } = jacobiEigen([
      [cxx, cxy, cxz],
      [cxy, cyy, cyz],
      [cxz, cyz, czz],
    ]);
    // Descending eigenvalue order; ties keep the lower
    // original index first (stable, deterministic).
    const order = [0, 1, 2].sort((i, j) => (values[j] - values[i]) || (i - j));
    const a0 = canonicalSign(normalize(vectors[order[0]]));
    const a1raw = canonicalSign(normalize(vectors[order[1]]));
    // Re-orthogonalise a1 against a0 (Jacobi output is already
    // orthonormal up to rounding; this only removes drift).
    const d = dot(a1raw, a0);
    const a1 = normalize([
      a1raw[0] - d * a0[0],
      a1raw[1] - d * a0[1],
      a1raw[2] - d * a0[2],
    ]);
    // Right-handed frame: axis 2 = axis0 × axis1 (see header).
    const a2 = cross(a0, a1);
    axes = [a0, a1, a2];
  }

  // Project onto the axes and take min/max per axis.
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [
      points[i * 3] - mx,
      points[i * 3 + 1] - my,
      points[i * 3 + 2] - mz,
    ];
    for (let k = 0; k < 3; k++) {
      const s = dot(p, axes[k]);
      if (s < min[k]) min[k] = s;
      if (s > max[k]) max[k] = s;
    }
  }
  const halfExtents: Vec3 = [
    Math.max(OBB_MIN_HALF_EXTENT, (max[0] - min[0]) / 2),
    Math.max(OBB_MIN_HALF_EXTENT, (max[1] - min[1]) / 2),
    Math.max(OBB_MIN_HALF_EXTENT, (max[2] - min[2]) / 2),
  ];
  const mid: Vec3 = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ];
  const center: Vec3 = [
    mx + axes[0][0] * mid[0] + axes[1][0] * mid[1] + axes[2][0] * mid[2],
    my + axes[0][1] * mid[0] + axes[1][1] * mid[1] + axes[2][1] * mid[2],
    mz + axes[0][2] * mid[0] + axes[1][2] * mid[1] + axes[2][2] * mid[2],
  ];
  return { center, axes, halfExtents };
}

/**
 * Fit the OBB of one fracture body: its points are the
 * localOffsets of every point whose assignment is `bodyIndex`
 * (offsets from the body's centroid, bake frame). Returns null
 * when the body holds no points.
 */
export function buildObbForCell(
  cells: FractureCellData,
  bodyIndex: number,
): RigidObb | null {
  const n = cells.assignment.length;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cells.assignment[i] !== bodyIndex) continue;
    pts.push(
      cells.localOffsets[i * 3],
      cells.localOffsets[i * 3 + 1],
      cells.localOffsets[i * 3 + 2],
    );
  }
  if (pts.length === 0) return null;
  return buildObbFromPoints(pts, pts.length / 3);
}

/** Fit every body's OBB (null entries for empty bodies). */
export function buildObbsForCells(cells: FractureCellData): Array<RigidObb | null> {
  const out: Array<RigidObb | null> = [];
  for (let b = 0; b < cells.bodyCount; b++) out.push(buildObbForCell(cells, b));
  return out;
}

// ── Placement ────────────────────────────────────────────────

/**
 * Place a local OBB into the world: centre and axes rotated by
 * the body's quaternion and translated by its position (the
 * rigidBodies.ts body state). Half extents carry over.
 */
export function placeObb(
  obb: RigidObb,
  pos: Vec3,
  quat: [number, number, number, number],
): RigidObb {
  const rc = obbQuatRotate(quat, obb.center);
  return {
    center: [pos[0] + rc[0], pos[1] + rc[1], pos[2] + rc[2]],
    axes: [
      obbQuatRotate(quat, obb.axes[0]),
      obbQuatRotate(quat, obb.axes[1]),
      obbQuatRotate(quat, obb.axes[2]),
    ],
    halfExtents: [...obb.halfExtents] as Vec3,
  };
}

// ── Support queries ──────────────────────────────────────────

/**
 * The OBB's support point in direction `dir` (the point of the
 * box farthest along dir; dir need not be unit). Sign ties
 * (dir perpendicular to an axis) resolve to the + side, so the
 * result is deterministic.
 */
export function obbSupportPoint(obb: RigidObb, dir: Vec3): Vec3 {
  const out: Vec3 = [...obb.center] as Vec3;
  for (let k = 0; k < 3; k++) {
    const s = dot(dir, obb.axes[k]) >= 0 ? obb.halfExtents[k] : -obb.halfExtents[k];
    out[0] += obb.axes[k][0] * s;
    out[1] += obb.axes[k][1] * s;
    out[2] += obb.axes[k][2] * s;
  }
  return out;
}

/**
 * Signed offset of the box's lowest support point from its
 * centre along the floor normal: dot(support(-normal) -
 * centre, normal), always <= 0 for a unit normal. The floor
 * penetration of a placed body is -(this offset) measured
 * against the centre's height above the floor — the OBB
 * replacement for the sphere's `- radius` in the floor test.
 */
export function obbFloorSupportOffset(obb: RigidObb, floorNormal: Vec3): number {
  const p = obbSupportPoint(obb, [-floorNormal[0], -floorNormal[1], -floorNormal[2]]);
  return (
    (p[0] - obb.center[0]) * floorNormal[0]
    + (p[1] - obb.center[1]) * floorNormal[1]
    + (p[2] - obb.center[2]) * floorNormal[2]
  );
}

// ── SAT collision test ───────────────────────────────────────

/** Projection radius of an OBB onto a unit axis. */
function projectionRadius(obb: RigidObb, axis: Vec3): number {
  return (
    obb.halfExtents[0] * Math.abs(dot(axis, obb.axes[0]))
    + obb.halfExtents[1] * Math.abs(dot(axis, obb.axes[1]))
    + obb.halfExtents[2] * Math.abs(dot(axis, obb.axes[2]))
  );
}

/**
 * Separating-axis test between two world OBBs over the 15
 * candidate axes (3 + 3 face normals, 9 edge cross products;
 * near-parallel cross axes are skipped). On a hit, returns the
 * minimum-penetration axis as `normal`, oriented from A to B,
 * the penetration `depth`, and the support-midpoint `point`.
 * On separation returns { hit: false, ... } (see SEPARATED).
 */
export function obbSatContact(a: RigidObb, b: RigidObb): ObbContact {
  const d: Vec3 = [
    b.center[0] - a.center[0],
    b.center[1] - a.center[1],
    b.center[2] - a.center[2],
  ];
  const candidates: Vec3[] = [
    a.axes[0], a.axes[1], a.axes[2],
    b.axes[0], b.axes[1], b.axes[2],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const c = cross(a.axes[i], b.axes[j]);
      if (Math.hypot(c[0], c[1], c[2]) > 1e-6) candidates.push(normalize(c));
    }
  }
  let bestDepth = Infinity;
  let bestNormal: Vec3 = [1, 0, 0];
  for (const rawAxis of candidates) {
    const axis = normalize(rawAxis);
    const dist = dot(d, axis);
    const overlap = projectionRadius(a, axis) + projectionRadius(b, axis) - Math.abs(dist);
    if (overlap < 0) return { ...SEPARATED, normal: [0, 0, 0], point: [0, 0, 0] };
    if (overlap < bestDepth) {
      bestDepth = overlap;
      // Orient A -> B: flip when B lies on the - side.
      bestNormal = dist < 0 ? [-axis[0], -axis[1], -axis[2]] : axis;
    }
  }
  const pa = obbSupportPoint(a, bestNormal);
  const pb = obbSupportPoint(b, [-bestNormal[0], -bestNormal[1], -bestNormal[2]]);
  return {
    hit: true,
    normal: bestNormal,
    depth: bestDepth,
    point: [
      (pa[0] + pb[0]) / 2,
      (pa[1] + pb[1]) / 2,
      (pa[2] + pb[2]) / 2,
    ],
  };
}
