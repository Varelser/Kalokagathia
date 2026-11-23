// ── Morph-surface fibers (Phase AG) ────────────────────────────
// Strands grown from the morph bake's surface points: roots are
// seeded picks from the baked cloud, each strand leaves its root
// along the surface normal (the OBJ companion normals when the
// bake provides them, a radial direction otherwise) and bends
// toward a per-strand tangent as it grows — the guide-hair
// grammar (root on a surface, direction inherited, groomed by a
// curl amount) expressed over the sampling base.
//
// Pure and deterministic: the same cloud + options always
// produce byte-identical strands (seeded mulberry32). This is a
// display grammar only — nothing feeds back into the simulation.

import { mulberry32 } from './lSystem';

export interface MorphFiberOptions {
  /** Requested strand count (clamped to 1..4000 and to the point count). */
  count: number;
  /** Strand length in bake (world) units. */
  length: number;
  /** Curl amount 0..1: how far the tip bends toward the tangent. */
  curl: number;
  /** Root-pick + tangent-phase seed. */
  seed: number;
  /** Polyline segments per strand (fixed grammar, default 4). */
  segments?: number;
  /**
   * Grooming (Phase AL): a global groom direction the growth
   * direction aligns toward. A zero / missing vector disables
   * grooming entirely (legacy path, byte-identical).
   */
  groom?: [number, number, number];
  /** Grooming strength 0..1: 0 keeps the surface normal as the
   *  growth direction, 1 aligns it fully to the groom direction. */
  groomAlign?: number;
  /**
   * Length distribution width 0..1: per-strand deterministic
   * length multiplier in [1 - var/2, 1 + var/2]. 0 consumes no
   * extra rng draws, so the legacy strands stay byte-identical.
   */
  lengthVar?: number;
  /**
   * Groom field (Phase 15): how the groom direction varies over
   * the surface. 'uniform' / missing is the Phase AL global
   * vector. 'radial' points away from the cloud centre, 'swirl'
   * runs tangentially around the Y axis through the centre, and
   * 'noise' is a trig direction field over the root position at
   * groomFieldScale. Field modes are pure functions of position
   * (no rng draws), so root picks and phases never shift.
   */
  groomField?: 'uniform' | 'noise' | 'radial' | 'swirl';
  /** Spatial frequency of the 'noise' groom field (default 1). */
  groomFieldScale?: number;
}

export function clampMorphFiberCount(v: number): number {
  if (!Number.isFinite(v)) return 600;
  return Math.max(1, Math.min(4000, Math.floor(v)));
}

export function clampMorphFiberLength(v: number): number {
  if (!Number.isFinite(v)) return 0.35;
  return Math.max(0.01, Math.min(10, v));
}

export function clampMorphFiberCurl(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampMorphFiberGroomAlign(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampMorphFiberLengthVar(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export interface MorphFiberResult {
  /** LineSegments positions, 2 vertices (6 floats) per segment. */
  positions: Float32Array;
  /** LineSegments grayscale colours (root bright → tip dim). */
  colors: Float32Array;
  strandCount: number;
  segmentCount: number;
}

/**
 * Build the strand polylines. `points` / `normals` are xyz-packed
 * (3 floats per point); normals may be null or all-zero (shell /
 * non-OBJ targets), in which case the radial direction from the
 * cloud centre is used. Points at the centre (zero radial) fall
 * back to +Y.
 */
export function buildMorphFiberStrands(
  points: ArrayLike<number>,
  normals: ArrayLike<number> | null,
  pointCount: number,
  options: MorphFiberOptions,
): MorphFiberResult {
  const n = Math.max(0, Math.floor(pointCount));
  const segsPerStrand = Math.max(1, Math.min(8, Math.floor(options.segments ?? 4)));
  const want = Math.min(clampMorphFiberCount(options.count), n);
  if (n === 0 || want === 0) {
    return { positions: new Float32Array(0), colors: new Float32Array(0), strandCount: 0, segmentCount: 0 };
  }
  const length = clampMorphFiberLength(options.length);
  const curl = clampMorphFiberCurl(options.curl);
  // Grooming (Phase AL): resolved once. groomAlign 0 or a zero
  // groom vector keeps the legacy per-strand path untouched.
  const groomAlign = clampMorphFiberGroomAlign(options.groomAlign ?? 0);
  const lengthVar = clampMorphFiberLengthVar(options.lengthVar ?? 0);
  const groomRaw = options.groom ?? [0, 0, 0];
  const groomLen = Math.hypot(groomRaw[0], groomRaw[1], groomRaw[2]);
  // Groom field (Phase 15): a non-uniform field supplies its own
  // direction per root, so grooming can be active with a zero
  // global vector. 'uniform' keeps the Phase AL condition exactly.
  const groomField = options.groomField ?? 'uniform';
  const useField = groomField !== 'uniform';
  const groomFieldScale = Number.isFinite(options.groomFieldScale)
    ? Math.min(20, Math.max(0.05, options.groomFieldScale as number))
    : 1;
  const grooming = groomAlign > 0 && (useField || groomLen > 1e-9);
  const gx = grooming && groomLen > 1e-9 ? groomRaw[0] / groomLen : 0;
  const gy = grooming && groomLen > 1e-9 ? groomRaw[1] / groomLen : 0;
  const gz = grooming && groomLen > 1e-9 ? groomRaw[2] / groomLen : 0;
  const rng = mulberry32((Math.round(options.seed) * 2654435761) ^ 0x27d4eb2f);

  // Cloud centre for the radial normal fallback.
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += points[i * 3] ?? 0; cy += points[i * 3 + 1] ?? 0; cz += points[i * 3 + 2] ?? 0;
  }
  cx /= n; cy /= n; cz /= n;

  // Seeded partial Fisher–Yates root picks (same pattern as the
  // fracture sites): roots always sit on the surface.
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const roots = new Int32Array(want);
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    roots[i] = idx[i];
  }

  const positions = new Float32Array(want * segsPerStrand * 6);
  const colors = new Float32Array(want * segsPerStrand * 6);
  let v = 0;
  for (let s = 0; s < want; s++) {
    const p = roots[s] * 3;
    const px = points[p] ?? 0; const py = points[p + 1] ?? 0; const pz = points[p + 2] ?? 0;
    // Normal: bake normal when usable, else radial.
    let nx = normals ? (normals[p] ?? 0) : 0;
    let ny = normals ? (normals[p + 1] ?? 0) : 0;
    let nz = normals ? (normals[p + 2] ?? 0) : 0;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 0.5) {
      nx = px - cx; ny = py - cy; nz = pz - cz;
      nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) { nx = 0; ny = 1; nz = 0; nl = 1; }
    }
    nx /= nl; ny /= nl; nz /= nl;
    // Deterministic tangent: seeded phase in the plane ⊥ n.
    const phi = rng() * Math.PI * 2;
    // Basis (t1, t2) perpendicular to n.
    const ax = Math.abs(ny) < 0.9 ? 0 : 1;
    const ay = Math.abs(ny) < 0.9 ? 1 : 0;
    let t1x = ny * 0 - nz * ay; // cross(n, a) with a = (ax, ay, 0)
    let t1y = nz * ax - nx * 0;
    let t1z = nx * ay - ny * ax;
    const t1l = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1l; t1y /= t1l; t1z /= t1l;
    const t2x = ny * t1z - nz * t1y;
    const t2y = nz * t1x - nx * t1z;
    const t2z = nx * t1y - ny * t1x;
    const tx = Math.cos(phi) * t1x + Math.sin(phi) * t2x;
    const ty = Math.cos(phi) * t1y + Math.sin(phi) * t2y;
    const tz = Math.cos(phi) * t1z + Math.sin(phi) * t2z;
    // Grooming (Phase AL): blend the growth direction from the
    // surface normal toward the groom direction, and re-project
    // the bend tangent onto the plane perpendicular to it. Only
    // entered while grooming is active — the legacy variables are
    // used verbatim otherwise.
    let dirX = nx; let dirY = ny; let dirZ = nz;
    let tanX = tx; let tanY = ty; let tanZ = tz;
    if (grooming) {
      // Groom direction for this strand: the global vector, or —
      // in a field mode — a pure function of the root position
      // (no rng draws, so picks and phases never shift). A
      // degenerate field value falls back to the global vector.
      let dx = gx; let dy = gy; let dz = gz;
      if (useField) {
        let fx = 0; let fy = 0; let fz = 0;
        if (groomField === 'radial') {
          fx = px - cx; fy = py - cy; fz = pz - cz;
        } else if (groomField === 'swirl') {
          fx = pz - cz; fy = 0; fz = -(px - cx);
        } else {
          const s = groomFieldScale;
          fx = Math.sin(py * s * 3.1 + pz * s * 1.7);
          fy = Math.sin(pz * s * 2.3 + px * s * 2.9);
          fz = Math.sin(px * s * 1.9 + py * s * 2.7);
        }
        const fl = Math.hypot(fx, fy, fz);
        if (fl > 1e-9) { dx = fx / fl; dy = fy / fl; dz = fz / fl; }
      }
      let bx = nx * (1 - groomAlign) + dx * groomAlign;
      let by = ny * (1 - groomAlign) + dy * groomAlign;
      let bz = nz * (1 - groomAlign) + dz * groomAlign;
      const bl = Math.hypot(bx, by, bz);
      if (bl > 1e-9) {
        bx /= bl; by /= bl; bz /= bl;
        dirX = bx; dirY = by; dirZ = bz;
        const dot = tx * dirX + ty * dirY + tz * dirZ;
        let px2 = tx - dot * dirX;
        let py2 = ty - dot * dirY;
        let pz2 = tz - dot * dirZ;
        const pl = Math.hypot(px2, py2, pz2);
        if (pl > 1e-9) {
          px2 /= pl; py2 /= pl; pz2 /= pl;
          tanX = px2; tanY = py2; tanZ = pz2;
        } else {
          tanX = 0; tanY = 0; tanZ = 0;
        }
      }
    }
    // Length distribution (Phase AL): the extra rng draw happens
    // only while lengthVar > 0, keeping the legacy stream (and
    // therefore every strand) byte-identical at 0.
    let strandLength = length;
    if (lengthVar > 0) {
      const lr = rng();
      strandLength = length * (1 + (2 * lr - 1) * lengthVar * 0.5);
    }
    // Polyline: step along the growth direction, bend
    // quadratically toward the tangent.
    let prevX = px; let prevY = py; let prevZ = pz;
    for (let k = 1; k <= segsPerStrand; k++) {
      const f = k / segsPerStrand;
      const bend = curl * strandLength * 0.5 * f * f;
      const qx = px + dirX * (strandLength * f) + tanX * bend;
      const qy = py + dirY * (strandLength * f) + tanY * bend;
      const qz = pz + dirZ * (strandLength * f) + tanZ * bend;
      const b0 = 0.8 - 0.5 * ((k - 1) / segsPerStrand);
      const b1 = 0.8 - 0.5 * f;
      positions[v * 6] = prevX; positions[v * 6 + 1] = prevY; positions[v * 6 + 2] = prevZ;
      positions[v * 6 + 3] = qx; positions[v * 6 + 4] = qy; positions[v * 6 + 5] = qz;
      colors[v * 6] = b0; colors[v * 6 + 1] = b0; colors[v * 6 + 2] = b0;
      colors[v * 6 + 3] = b1; colors[v * 6 + 4] = b1; colors[v * 6 + 5] = b1;
      v += 1;
      prevX = qx; prevY = qy; prevZ = qz;
    }
  }
  return { positions, colors, strandCount: want, segmentCount: want * segsPerStrand };
}
