// ── Voronoi fracture (Phase AG) ────────────────────────────────
// A bake-time cell-division grammar for the morph / OBJ sampling
// base: the baked point cloud is partitioned into Voronoi cells
// around seeded sites drawn FROM the cloud itself, then each
// cell's points are pulled toward the cell centroid and pushed
// away from the shape centre, so any sampled shape reads as
// broken into chunks. Pure and deterministic: the same positions
// + cells + seed + gap always produce byte-identical output
// (seeded mulberry32, no Math.random anywhere).
//
// The transform lives in the shared morph bake
// (buildGpgpuMorphTargetDataWithNormals), so every routing that
// consumes the bake — WebGPU, WebGL and the CPU fallback — sees
// the fractured cloud; there is no per-path wiring to drift.
//
// Gap semantics: gap 0 is an exact identity (offset 0, shrink 1),
// so enabling the fracture with gap 0 changes nothing visually;
// the Enabled key is the real gate and defaults off.

import { mulberry32 } from './lSystem';

export interface VoronoiFractureOptions {
  /** Requested cell count (clamped to 2..256 and to the point count). */
  cells: number;
  /** Site-pick seed. Same seed + same cloud → same division. */
  seed: number;
  /** Separation amount, 0..1. 0 = identity transform. */
  gap: number;
}

/**
 * Build the bake's fracture option from config-shaped fields.
 * Shared by every bake call site (WebGPU builder, WebGL morph
 * texture effect, CPU fallback) so the routings can never drift:
 * returns null unless the feature is enabled.
 */
export function fractureOptionFromConfig(config: {
  gpgpuMorphFractureEnabled?: boolean;
  gpgpuMorphFractureCells?: number;
  gpgpuMorphFractureSeed?: number;
  gpgpuMorphFractureGap?: number;
}): VoronoiFractureOptions | null {
  if (!config.gpgpuMorphFractureEnabled) return null;
  return {
    cells: clampFractureCells(config.gpgpuMorphFractureCells ?? 12),
    seed: Number.isFinite(config.gpgpuMorphFractureSeed) ? Math.round(config.gpgpuMorphFractureSeed as number) : 1,
    gap: clampFractureGap(config.gpgpuMorphFractureGap ?? 0.25),
  };
}

export function clampFractureCells(v: number): number {
  if (!Number.isFinite(v)) return 12;
  // The cap literal must match RIGID_BODY_MAX in lib/rigidBodies.ts
  // (kept literal here to avoid a module cycle: rigidBodies imports
  // this module's types).
  return Math.max(2, Math.min(256, Math.floor(v)));
}

export function clampFractureGap(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Pick `cellCount` site positions from the cloud itself: a seeded
 * partial Fisher–Yates over point indices, so sites always sit on
 * the shape (never in empty space) and the division hugs the form.
 * positions is xyz-packed (3 floats per point). Returns an
 * xyz-packed Float32Array of site positions.
 */
export function buildFractureSites(
  positions: ArrayLike<number>,
  count: number,
  cellCount: number,
  seed: number,
): Float32Array {
  const n = Math.max(0, Math.floor(count));
  const k = Math.min(clampFractureCells(cellCount), n);
  const sites = new Float32Array(k * 3);
  if (k === 0 || n === 0) return sites;
  const rng = mulberry32((Math.round(seed) * 2654435761) ^ 0x85ebca6b);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    const p = idx[i] * 3;
    sites[i * 3] = positions[p] ?? 0;
    sites[i * 3 + 1] = positions[p + 1] ?? 0;
    sites[i * 3 + 2] = positions[p + 2] ?? 0;
  }
  return sites;
}

export interface FractureAssignment {
  /** Nearest-site index per point. */
  assignment: Int32Array;
  /** Mean position of each cell's members (empty cells keep the site). */
  centroids: Float32Array;
  /** Member count per cell. */
  cellCounts: Int32Array;
}

/** Assign every point to its nearest site and compute cell centroids. */
export function assignFractureCells(
  positions: ArrayLike<number>,
  count: number,
  sites: Float32Array,
): FractureAssignment {
  const n = Math.max(0, Math.floor(count));
  const k = Math.floor(sites.length / 3);
  const assignment = new Int32Array(n);
  const centroids = new Float32Array(sites);
  const cellCounts = new Int32Array(k);
  if (k === 0 || n === 0) return { assignment, centroids, cellCounts };
  const sums = new Float64Array(k * 3);
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3] ?? 0;
    const py = positions[i * 3 + 1] ?? 0;
    const pz = positions[i * 3 + 2] ?? 0;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dx = px - sites[c * 3];
      const dy = py - sites[c * 3 + 1];
      const dz = pz - sites[c * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = c; }
    }
    assignment[i] = best;
    cellCounts[best] += 1;
    sums[best * 3] += px;
    sums[best * 3 + 1] += py;
    sums[best * 3 + 2] += pz;
  }
  for (let c = 0; c < k; c++) {
    if (cellCounts[c] > 0) {
      centroids[c * 3] = sums[c * 3] / cellCounts[c];
      centroids[c * 3 + 1] = sums[c * 3 + 1] / cellCounts[c];
      centroids[c * 3 + 2] = sums[c * 3 + 2] / cellCounts[c];
    }
  }
  return { assignment, centroids, cellCounts };
}

// ── Shared fracture tails ─────────────────────────────────────
// The sites-derived path (applyVoronoiFracture /
// buildFractureCellData) and the assignment-driven path (Phase
// 20 stage 1: a saved fragment collection's assignment fed back
// into the bake) share these tails, so a restored division goes
// through the exact same arithmetic — in the same order, with
// the same float32 roundings — as the division the bake computed
// itself. When the supplied assignment IS the sites-derived one,
// the assignment-driven results are byte-identical to the
// sites-derived ones (pinned by the phase-20 test).

/** Unpack the xyz triples of an xyzw-packed bake array. */
function unpackFractureXyz(data: Float32Array, n: number): Float32Array {
  const xyz = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    xyz[i * 3] = data[i * 4];
    xyz[i * 3 + 1] = data[i * 4 + 1];
    xyz[i * 3 + 2] = data[i * 4 + 2];
  }
  return xyz;
}

/** Mean position of the whole cloud (the shape centre). */
function fractureCloudCentre(xyz: Float32Array, n: number): [number, number, number] {
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < n; i++) { cx += xyz[i * 3]; cy += xyz[i * 3 + 1]; cz += xyz[i * 3 + 2]; }
  return [cx / n, cy / n, cz / n];
}

/**
 * The fracture transform itself, over a per-point assignment
 * into `centroids` (xyz-packed, one entry per assignment value):
 *   p' = centroid + (p − centroid) · (1 − 0.3·gap)
 *        + (centroid − shapeCentre) · gap
 * `gap` must already be clamped and non-zero (callers own the
 * gap-0 identity early-out).
 */
function applyFractureTransform(
  data: Float32Array,
  xyz: Float32Array,
  n: number,
  assignment: ArrayLike<number>,
  centroids: Float32Array,
  gap: number,
): void {
  const [cx, cy, cz] = fractureCloudCentre(xyz, n);
  const shrink = 1 - 0.3 * gap;
  for (let i = 0; i < n; i++) {
    const c = assignment[i];
    const mx = centroids[c * 3]; const my = centroids[c * 3 + 1]; const mz = centroids[c * 3 + 2];
    const o = i * 4;
    data[o] = mx + (xyz[i * 3] - mx) * shrink + (mx - cx) * gap;
    data[o + 1] = my + (xyz[i * 3 + 1] - my) * shrink + (my - cy) * gap;
    data[o + 2] = mz + (xyz[i * 3 + 2] - mz) * shrink + (mz - cz) * gap;
  }
}

/** True when every entry is a non-negative integer index. */
function isValidAssignment(assignment: ArrayLike<number>, n: number): boolean {
  if (assignment.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const v = assignment[i];
    if (!Number.isInteger(v) || v < 0) return false;
  }
  return true;
}

/**
 * Apply the fracture transform in place to an xyzw-packed bake
 * array (4 floats per point, w untouched):
 *   p' = centroid + (p − centroid) · (1 − 0.3·gap)
 *        + (centroid − shapeCentre) · gap
 * Returns the number of non-empty cells. With gap = 0 the array
 * is bit-identical afterwards.
 */
export function applyVoronoiFracture(
  data: Float32Array,
  count: number,
  options: VoronoiFractureOptions,
): { cells: number; nonEmptyCells: number } {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || data.length < n * 4) return { cells: 0, nonEmptyCells: 0 };
  // Unpack xyz once (sites/assignment work on 3-packed data).
  const xyz = unpackFractureXyz(data, n);
  const sites = buildFractureSites(xyz, n, options.cells, options.seed);
  const k = Math.floor(sites.length / 3);
  if (k === 0) return { cells: 0, nonEmptyCells: 0 };
  const { assignment, centroids, cellCounts } = assignFractureCells(xyz, n, sites);
  const gap = clampFractureGap(options.gap);
  let nonEmpty = 0;
  for (let c = 0; c < k; c++) if (cellCounts[c] > 0) nonEmpty += 1;
  if (gap === 0) return { cells: k, nonEmptyCells: nonEmpty };
  applyFractureTransform(data, xyz, n, assignment, centroids, gap);
  return { cells: k, nonEmptyCells: nonEmpty };
}

/**
 * The assignment-driven twin of applyVoronoiFracture (Phase 20
 * stage 1, fragment restore): the division is GIVEN — a saved
 * fragment collection's per-point body assignment, compacted
 * over non-empty bodies — instead of derived from sites, and
 * each body's centroid is recomputed as the mean of its members
 * in the pre-transform cloud. Everything after that is the
 * shared transform tail, so when the given assignment is the
 * one the sites path would have produced (with the same gap),
 * the transformed cloud is byte-identical to
 * applyVoronoiFracture's output.
 *
 * A malformed assignment (wrong length, negative or
 * non-integer entries) changes nothing and reports zero cells.
 * With gap = 0 the array is bit-identical afterwards.
 * Returns the assignment's index span as `cells` (max index + 1)
 * and the number of bodies that actually hold points.
 */
export function applyVoronoiFractureWithAssignment(
  data: Float32Array,
  count: number,
  assignment: ArrayLike<number>,
  gapValue: number,
): { cells: number; nonEmptyCells: number } {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || data.length < n * 4) return { cells: 0, nonEmptyCells: 0 };
  if (!isValidAssignment(assignment, n)) return { cells: 0, nonEmptyCells: 0 };
  const xyz = unpackFractureXyz(data, n);
  let cells = 0;
  for (let i = 0; i < n; i++) if (assignment[i] + 1 > cells) cells = assignment[i] + 1;
  // Body centroids: member means, accumulated in float64 and
  // stored through a Float32Array exactly like
  // assignFractureCells, so the values round the same way.
  const sums = new Float64Array(cells * 3);
  const counts = new Int32Array(cells);
  for (let i = 0; i < n; i++) {
    const c = assignment[i];
    counts[c] += 1;
    sums[c * 3] += xyz[i * 3];
    sums[c * 3 + 1] += xyz[i * 3 + 1];
    sums[c * 3 + 2] += xyz[i * 3 + 2];
  }
  const centroids = new Float32Array(cells * 3);
  let nonEmpty = 0;
  for (let c = 0; c < cells; c++) {
    if (counts[c] > 0) {
      nonEmpty += 1;
      centroids[c * 3] = sums[c * 3] / counts[c];
      centroids[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
      centroids[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
  }
  const gap = clampFractureGap(gapValue);
  if (gap === 0) return { cells, nonEmptyCells: nonEmpty };
  applyFractureTransform(data, xyz, n, assignment, centroids, gap);
  return { cells, nonEmptyCells: nonEmpty };
}

// ── Rigid body cell data (Phase AU) ────────────────────────────
// The assignment applyVoronoiFracture computes internally and
// discards, taken out as an additional output for the CPU rigid
// body solver (lib/rigidBodies.ts): which body each point
// belongs to, the point's offset from its body's centre (in the
// POST-transform cloud, so the solver's initial placement
// reproduces the baked shape exactly), and the body table
// (transformed centroid / bounding radius / RMS radius / member
// count). Pure and deterministic, and read-only over `data`:
// asking for the cell data never changes the bake itself. Must
// be called with the PRE-transform data and the same options the
// bake's own fracture pass uses (or gap 0 when the fracture is
// disabled), so the two computations agree point for point.

export interface FractureCellData {
  /** Per-point body index, compacted over non-empty cells. */
  assignment: Int32Array;
  /** Per-point local offset from its body's transformed centroid, xyz-packed. */
  localOffsets: Float32Array;
  /** Body centroids after the fracture transform, xyz-packed. */
  centroids: Float32Array;
  /** Bounding radius per body (max |local offset|). */
  radii: Float32Array;
  /** RMS radius per body. */
  coreRadii: Float32Array;
  /** Member count per body. */
  cellCounts: Int32Array;
  bodyCount: number;
}

/**
 * The shared cell-data tail: given the pre-transform cloud and
 * a COMPACTED assignment (indices 0..bodyCount-1, every body
 * non-empty), recompute each body's centroid (member mean),
 * transformed centroid, per-point local offsets and radii.
 * Member sums accumulate in float64 in point order and the
 * pre-transform centroids pass through a Float32Array, exactly
 * as assignFractureCells produces them — so the sites path and
 * the assignment path agree bit for bit on the same division.
 * `gap` must already be clamped.
 */
function buildCellDataFromCompactAssignment(
  xyz: Float32Array,
  n: number,
  assignment: Int32Array,
  bodyCount: number,
  gap: number,
): FractureCellData {
  const [cx, cy, cz] = fractureCloudCentre(xyz, n);
  const shrink = 1 - 0.3 * gap;
  const sums = new Float64Array(bodyCount * 3);
  const outCounts = new Int32Array(bodyCount);
  for (let i = 0; i < n; i++) {
    const b = assignment[i];
    outCounts[b] += 1;
    sums[b * 3] += xyz[i * 3];
    sums[b * 3 + 1] += xyz[i * 3 + 1];
    sums[b * 3 + 2] += xyz[i * 3 + 2];
  }
  const centroids = new Float32Array(bodyCount * 3);
  const outCentroids = new Float32Array(bodyCount * 3);
  for (let b = 0; b < bodyCount; b++) {
    centroids[b * 3] = sums[b * 3] / outCounts[b];
    centroids[b * 3 + 1] = sums[b * 3 + 1] / outCounts[b];
    centroids[b * 3 + 2] = sums[b * 3 + 2] / outCounts[b];
    // The transformed centroid: the shrink acts around the
    // centroid itself, so only the centre-push moves it.
    outCentroids[b * 3] = centroids[b * 3] + (centroids[b * 3] - cx) * gap;
    outCentroids[b * 3 + 1] = centroids[b * 3 + 1] + (centroids[b * 3 + 1] - cy) * gap;
    outCentroids[b * 3 + 2] = centroids[b * 3 + 2] + (centroids[b * 3 + 2] - cz) * gap;
  }
  const localOffsets = new Float32Array(n * 3);
  const radii = new Float32Array(bodyCount);
  const coreRadii = new Float32Array(bodyCount);
  const sumSq = new Float64Array(bodyCount);
  for (let i = 0; i < n; i++) {
    const b = assignment[i];
    const mx = centroids[b * 3]; const my = centroids[b * 3 + 1]; const mz = centroids[b * 3 + 2];
    const px = mx + (xyz[i * 3] - mx) * shrink + (mx - cx) * gap;
    const py = my + (xyz[i * 3 + 1] - my) * shrink + (my - cy) * gap;
    const pz = mz + (xyz[i * 3 + 2] - mz) * shrink + (mz - cz) * gap;
    localOffsets[i * 3] = px - outCentroids[b * 3];
    localOffsets[i * 3 + 1] = py - outCentroids[b * 3 + 1];
    localOffsets[i * 3 + 2] = pz - outCentroids[b * 3 + 2];
    // Measure the radii from the STORED (float32) offsets, so
    // the bounding radius covers exactly what consumers read.
    const sx = localOffsets[i * 3];
    const sy = localOffsets[i * 3 + 1];
    const sz = localOffsets[i * 3 + 2];
    const d2 = sx * sx + sy * sy + sz * sz;
    sumSq[b] += d2;
    const d = Math.sqrt(d2);
    if (d > radii[b]) radii[b] = d;
  }
  for (let b = 0; b < bodyCount; b++) {
    coreRadii[b] = Math.sqrt(sumSq[b] / Math.max(1, outCounts[b]));
  }
  return {
    assignment,
    localOffsets,
    centroids: outCentroids,
    radii,
    coreRadii,
    cellCounts: outCounts,
    bodyCount,
  };
}

export function buildFractureCellData(
  data: Float32Array,
  count: number,
  options: VoronoiFractureOptions,
): FractureCellData | null {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || data.length < n * 4) return null;
  const xyz = unpackFractureXyz(data, n);
  const sites = buildFractureSites(xyz, n, options.cells, options.seed);
  const k = Math.floor(sites.length / 3);
  if (k === 0) return null;
  const { assignment, cellCounts } = assignFractureCells(xyz, n, sites);
  // Compact the non-empty cells into body indices.
  const bodyOf = new Int32Array(k).fill(-1);
  let bodyCount = 0;
  for (let c = 0; c < k; c++) if (cellCounts[c] > 0) { bodyOf[c] = bodyCount; bodyCount += 1; }
  if (bodyCount === 0) return null;
  const compactAssignment = new Int32Array(n);
  for (let i = 0; i < n; i++) compactAssignment[i] = bodyOf[assignment[i]];
  return buildCellDataFromCompactAssignment(xyz, n, compactAssignment, bodyCount, clampFractureGap(options.gap));
}

/**
 * The assignment-driven twin of buildFractureCellData (Phase
 * 20 stage 1, fragment restore): rebuild the body table from a
 * GIVEN division — a saved fragment collection's assignment —
 * over the pre-transform cloud, with `gap` the effective gap
 * the restored bake will use. Centroids, local offsets and
 * radii are recomputed from the cloud through the same shared
 * tail as the sites path, so when the given assignment is the
 * sites-derived one for the same options, the result is
 * byte-identical to buildFractureCellData's.
 *
 * The assignment must be compacted: length === count, every
 * entry an integer in 0..bodyCount-1 and every body in that
 * span non-empty (exactly the form parseFragmentCollection
 * validates). Anything else returns null.
 */
export function buildFractureCellDataFromAssignment(
  data: Float32Array,
  count: number,
  assignment: ArrayLike<number>,
  gapValue: number,
): FractureCellData | null {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || data.length < n * 4) return null;
  if (!isValidAssignment(assignment, n)) return null;
  let bodyCount = 0;
  for (let i = 0; i < n; i++) if (assignment[i] + 1 > bodyCount) bodyCount = assignment[i] + 1;
  if (bodyCount === 0) return null;
  const compactAssignment = Int32Array.from(assignment as ArrayLike<number>);
  const seen = new Int32Array(bodyCount);
  for (let i = 0; i < n; i++) seen[compactAssignment[i]] += 1;
  for (let b = 0; b < bodyCount; b++) if (seen[b] === 0) return null;
  const xyz = unpackFractureXyz(data, n);
  return buildCellDataFromCompactAssignment(xyz, n, compactAssignment, bodyCount, clampFractureGap(gapValue));
}
