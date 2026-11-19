// Phase CA: Pyro grid solver foundation (sub-phases 1-3 of the
// grid plan, #6 round-4/round-5 briefs). A second, grid-based
// solver alongside the particle-side Pyro solver: the 3D grid is
// packed into a 2D texture atlas (one z slice per tile) and stepped
// with the classic stable-fluids pipeline (semi-Lagrangian
// advection, buoyancy, explicit scalar diffusion, pressure
// projection). Everything here is pure data — layouts, tier
// resolution, solver constants — so the node test-suite can pin the
// arithmetic without a GPU. The GLSL lives in
// components/gpgpuShaderPyroGrid.ts, the pass orchestration in
// components/gpgpuPyroGridPasses.ts.
//
// Discretisation follows the FLIP precedent exactly (the MAC-
// consistent pair): divergence uses backward differences, the
// gradient subtraction uses forward differences, so their
// composition is the compact 7-point Laplacian and no
// checkerboard mode appears. Sampling uses cell-centre convention:
// cell i's centre is at grid position i, the valid sample range is
// [0, N-1] per axis, and out-of-range reads clamp to the edge cell
// (ClampToEdge; Repeat would bleed neighbouring slices across tile
// borders).

import { GPGPU_TEX_SIZE_CAPS, type GpuTier } from './gpuTier';

// Atlas layouts (round-2 section 1.1, fixed): cols x rows tiles of
// N x N pixels each. 96^3 uses 100 tiles for 96 slices (4 unused).
export const PYRO_GRID_LAYOUTS: Readonly<Record<number, { cols: number; rows: number }>> = {
  32: { cols: 8, rows: 4 },
  48: { cols: 8, rows: 6 },
  64: { cols: 8, rows: 8 },
  96: { cols: 10, rows: 10 },
};

export const PYRO_GRID_RESOLUTIONS: readonly number[] = [32, 48, 64, 96];

// Performance-tier defaults (Sugi's decision, plan A): entry 32^3,
// standard 48^3, high / flagship 64^3. 96^3 is a manual override
// on flagship only (its 960x960 atlas exceeds the lower tiers'
// texture caps anyway — see resolvePyroGridResolution).
export const PYRO_GRID_TIER_DEFAULTS: Readonly<Record<GpuTier, number>> = {
  entry: 32,
  standard: 48,
  high: 64,
  flagship: 64,
};

export function pyroGridAtlasSize(n: number): { width: number; height: number } | null {
  const layout = PYRO_GRID_LAYOUTS[n];
  if (!layout) return null;
  return { width: layout.cols * n, height: layout.rows * n };
}

// Resolves the effective grid resolution. override 0 = auto (tier
// default); a manual override is honoured only when its atlas fits
// the tier's GPGPU texture cap — an oversized request falls back
// to the tier default rather than allocating past the cap (96^3 on
// a 512-cap tier would need a 960px atlas). Unknown overrides also
// fall back to the tier default.
export function resolvePyroGridResolution(tier: GpuTier, override: number): number {
  const fallback = PYRO_GRID_TIER_DEFAULTS[tier];
  if (!override || !PYRO_GRID_LAYOUTS[override]) return fallback;
  const size = pyroGridAtlasSize(override);
  const cap = GPGPU_TEX_SIZE_CAPS[tier];
  if (!size || size.width > cap || size.height > cap) return fallback;
  return override;
}

// Atlas uv of a cell's centre texel (mirrors pyroUvOfCell in the
// GLSL common chunk; the test-suite round-trips the pair).
export function pyroGridCellUv(
  n: number,
  cell: { x: number; y: number; z: number },
): { u: number; v: number } | null {
  const layout = PYRO_GRID_LAYOUTS[n];
  const size = pyroGridAtlasSize(n);
  if (!layout || !size) return null;
  const tileX = cell.z % layout.cols;
  const tileY = Math.floor(cell.z / layout.cols);
  return {
    u: (tileX * n + cell.x + 0.5) / size.width,
    v: (tileY * n + cell.y + 0.5) / size.height,
  };
}

// Solver pass count per step: 2 advection + 1 buoyancy/walls +
// 1 scalar update + 1 divergence + N Jacobi + 1 gradient
// subtraction = 6 + N. Jacobi 20 -> 26 passes (the plan's full
// solver figure), the FLIP-matching default 16 -> 22. The two
// pressure clears per step follow the FLIP accounting convention
// and are not counted (same as FLIP's clearInto calls).
export function pyroGridPassCount(jacobiIterations: number): number {
  return 6 + Math.max(0, Math.floor(jacobiIterations));
}

export const PYRO_GRID_JACOBI_DEFAULT = 16;
export const PYRO_GRID_JACOBI_MAX = 32;

// Solver constants (cell units: velocities are cells/second,
// positions are cell indices). Buoyancy works in cell space, not
// the particle solver's world-space gravity: the grid domain is
// N cells across the same world extent the particles treat as
// ~450 units, so the world-space 9.8-based acceleration would be
// two orders of magnitude too weak in cells/second. The values
// are calibrated so the plume regime matches the round-1 CPU
// spike (32^3, Jacobi 20, 60 steps): total density 1262 (spike
// 1166.7), centroid y 0.214 (spike 0.249), spread 4.90 cells
// (spike 4.94), max speed 0.80 cells/step (spike 0.73) — the
// phaseca test-suite's CPU mirror pins these statistics.
export const PYRO_GRID_BUOY_ACCEL = 250.0; // cells/s^2 per unit (alpha * T)
export const PYRO_GRID_TEMP_COOL_RATE = 0.22; // 1/s at cooling key 1.0
export const PYRO_GRID_DENSITY_DECAY_RATE = 0.03; // 1/s
export const PYRO_GRID_SCALAR_DIFFUSE = 0.05; // explicit, per step (stable <= 1/6)
export const PYRO_GRID_EMIT_DENSITY = 80.0; // density/s at falloff 1
export const PYRO_GRID_EMIT_TEMP_RATE = 8.0; // 1/s relaxation toward emit temp
export const PYRO_GRID_SOURCE_Y = 2.0; // cells above the floor
export const PYRO_GRID_MAX_SPEED_CELLS = 4.0; // x N, cells/s clamp

export function pyroGridSourceRadius(n: number): number {
  return Math.max(2.0, n / 12);
}

// Runtime status for the passes -> diagnostics consumers (same
// store shape as the custom-force status). Written by the pass
// runner each stepped frame; read by the gate via the app (and by
// later UI phases). Never written when the grid is disabled.
export type PyroGridRuntimeStatus = {
  active: boolean;
  resolution: number;
  passesPerStep: number;
  framesStepped: number;
};

let pyroGridStatus: PyroGridRuntimeStatus = {
  active: false,
  resolution: 0,
  passesPerStep: 0,
  framesStepped: 0,
};

export function setPyroGridRuntimeStatus(next: PyroGridRuntimeStatus): void {
  pyroGridStatus = next;
}

export function getPyroGridRuntimeStatus(): PyroGridRuntimeStatus {
  return pyroGridStatus;
}
