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
  /** Requested cell count (clamped to 2..64 and to the point count). */
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
  return Math.max(2, Math.min(64, Math.floor(v)));
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
  const xyz = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    xyz[i * 3] = data[i * 4];
    xyz[i * 3 + 1] = data[i * 4 + 1];
    xyz[i * 3 + 2] = data[i * 4 + 2];
  }
  const sites = buildFractureSites(xyz, n, options.cells, options.seed);
  const k = Math.floor(sites.length / 3);
  if (k === 0) return { cells: 0, nonEmptyCells: 0 };
  const { assignment, centroids, cellCounts } = assignFractureCells(xyz, n, sites);
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < n; i++) { cx += xyz[i * 3]; cy += xyz[i * 3 + 1]; cz += xyz[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  const gap = clampFractureGap(options.gap);
  const shrink = 1 - 0.3 * gap;
  let nonEmpty = 0;
  for (let c = 0; c < k; c++) if (cellCounts[c] > 0) nonEmpty += 1;
  if (gap === 0) return { cells: k, nonEmptyCells: nonEmpty };
  for (let i = 0; i < n; i++) {
    const c = assignment[i];
    const mx = centroids[c * 3]; const my = centroids[c * 3 + 1]; const mz = centroids[c * 3 + 2];
    const o = i * 4;
    data[o] = mx + (data[o] - mx) * shrink + (mx - cx) * gap;
    data[o + 1] = my + (data[o + 1] - my) * shrink + (my - cy) * gap;
    data[o + 2] = mz + (data[o + 2] - mz) * shrink + (mz - cz) * gap;
  }
  return { cells: k, nonEmptyCells: nonEmpty };
}
