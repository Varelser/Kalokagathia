/**
 * Grains solver resolution (Phase AQ solver, Phase BB repose).
 *
 * The single point where the velocity pass's friction uniform is
 * decided. Phase AQ made the pile's angle of repose an emergent
 * value of the Coulomb friction coefficient μ — and the AQ gate
 * measured the emergence as non-monotonic in the friction key
 * (the floor's own tangential friction and landing pressure
 * confound it). Phase BB adds the direct specification the audit
 * asked for: `gpgpuGrainsReposeAngle`, in degrees.
 *
 * Priority (documented, single-sourced here): while the repose
 * angle is > 0 it OVERRIDES the friction key — the effective
 * coefficient is μ = tan(angle), the textbook relation between a
 * Coulomb coefficient and the steepest slope that stands. At 0
 * (default) the friction key rules exactly as before, so every
 * legacy configuration is bit-identical.
 *
 * The angle is clamped to 89° for the tangent: tan(90°) is
 * unbounded, and 89° already gives μ ≈ 57 — past any physical
 * granular material, effectively a locked pile.
 */

import type { ParticleConfig } from '../types';

/** Steepest settable repose angle (the key's own range). */
export const GRAINS_REPOSE_MAX_DEG = 90;
/** Angle used for the tangent at the top of the range. */
export const GRAINS_REPOSE_TAN_CLAMP_DEG = 89;

/** True while the direct repose specification overrides the friction key. */
export function grainsReposeActive(config: ParticleConfig): boolean {
  return (config.gpgpuGrainsReposeAngle ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Phase 19 completion: position projection + neighbourhood scan.      */
/*                                                                     */
/* Phase AQ's two documented limits were (a) no position projection    */
/* — contact was force-only, so deep compression kept interpenetration */
/* — and (b) a statistical subsample neighbourhood (max 64, default    */
/* 16, drawn from the first texture row's span), so contacts could be  */
/* missed entirely. Phase 19 closes both, Grains-only:                 */
/*                                                                     */
/* (a) `gpgpuGrainsProjection` (0..1, default 1) — while Grains is on  */
/* and the strength is > 0, the position pass adds a Jacobi-style      */
/* projection segment: every overlapping pair pushes each member half */
/* the overlap apart along the contact normal, scaled by the strength */
/* (see grainsProjectionCorrection). Grains off, or strength 0, is the */
/* exact legacy position pass.                                         */
/*                                                                     */
/* (b) `gpgpuGrainsNeighborhood` (0 = legacy subsample, 1 = complete)  */
/* — the complete scan walks the WHOLE position texture in texel       */
/* order (stride 1) up to GRAINS_SCAN_BUDGET texels; only pools larger */
/* than the budget fall back to a deterministic integer stride over    */
/* the full span (never the legacy first-row span). The default pool   */
/* (65,536 particles = 256x256 texels) is inside the budget, so the    */
/* scan there is exhaustive: no neighbour in range is ever skipped.    */
/* The SPH loop keeps the legacy subsample untouched either way.       */
/*                                                                     */
/* The functions below are the TS twins of the GLSL segments in        */
/* gpgpuShaderSimulationVelocityMainSphGrains.ts (contact scan) and    */
/* gpgpuShaderSimulationPosition.ts (projection segment); the unit     */
/* test (scripts/phase19-grains.test.mjs) pins them.                   */
/* ------------------------------------------------------------------ */

/** Texel budget of the complete neighbourhood scan (256x256). */
export const GRAINS_SCAN_BUDGET = 65536;

/** Projection strength resolved from the key: clamped 0..1. */
export function resolveGrainsProjection(config: ParticleConfig): number {
  const v = config.gpgpuGrainsProjection ?? 1;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** True while the position-pass projection segment runs. */
export function grainsProjectionActive(config: ParticleConfig): boolean {
  return !!config.gpgpuGrainsEnabled && resolveGrainsProjection(config) > 0;
}

/** Neighbourhood mode resolved from the key: 0 legacy, 1 complete. */
export function grainsNeighborhoodMode(config: ParticleConfig): 0 | 1 {
  return (config.gpgpuGrainsNeighborhood ?? 0) >= 1 ? 1 : 0;
}

export interface GrainsScanPlan {
  /** Number of candidate samples the loop visits. */
  count: number;
  /** Step between successive candidate texel indices. */
  stride: number;
  /** Span the candidates are drawn from (texel-index space). */
  span: number;
}

/**
 * The candidate scan plan shared by the velocity contact loop and
 * the position projection segment (GLSL twins included).
 *
 * Legacy (mode 0): exactly the Phase AQ plan — `samples` candidates
 * at the fractional stride texSize / samples over the first
 * texSize texel indices.
 *
 * Complete (mode 1): candidates over the whole texture
 * (texSize^2 indices). Stride 1 while the span fits the budget —
 * an exhaustive walk — otherwise the smallest integer stride that
 * brings the count inside the budget.
 */
export function grainsScanPlan(texSize: number, mode: 0 | 1, legacySamples: number): GrainsScanPlan {
  const t = Math.max(1, Math.floor(texSize));
  if (mode === 0) {
    const count = Math.max(2, Math.min(64, Math.floor(legacySamples) || 2));
    return { count, stride: t / count, span: t };
  }
  const span = t * t;
  const stride = span > GRAINS_SCAN_BUDGET ? Math.ceil(span / GRAINS_SCAN_BUDGET) : 1;
  return { count: Math.ceil(span / stride), stride, span };
}

/**
 * Candidate texel indices of a scan plan, in visit order. In
 * complete mode with stride 1 this is every texel of the texture —
 * the property the Phase 19 test pins against a brute-force
 * neighbour search. (Legacy indices are fractional in the shader;
 * this list floors them, which is the texel the nearest-filtered
 * fetch lands on for the .5-centred legacy UV mapping in practice —
 * the plan's count/stride, not this list, is the legacy contract.)
 */
export function grainsScanIndices(texSize: number, mode: 0 | 1, legacySamples: number): number[] {
  const plan = grainsScanPlan(texSize, mode, legacySamples);
  const out: number[] = [];
  for (let i = 0; i < plan.count; i++) out.push(Math.floor(i * plan.stride));
  return out;
}

export interface GrainsVec3 { x: number; y: number; z: number }

/**
 * Brute-force complete neighbour search (the ground truth):
 * indices of every particle closer than the grain diameter to
 * `positions[index]`, using the shader's own contact window
 * (dist^2 > 0.0001, so coincident particles are not contacts).
 */
export function grainsNeighborsBruteForce(
  positions: readonly GrainsVec3[], index: number, diameter: number,
): number[] {
  const gd = Math.max(diameter, 0.001);
  const gd2 = gd * gd;
  const p = positions[index];
  const out: number[] = [];
  for (let j = 0; j < positions.length; j++) {
    if (j === index) continue;
    const dx = p.x - positions[j].x;
    const dy = p.y - positions[j].y;
    const dz = p.z - positions[j].z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < gd2 && d2 > 0.0001) out.push(j);
  }
  return out;
}

/**
 * Neighbours found through a scan plan: the candidates the plan
 * visits, filtered by the same contact window. With the complete
 * plan (stride 1) this equals grainsNeighborsBruteForce exactly.
 */
export function grainsNeighborsViaScan(
  positions: readonly GrainsVec3[], index: number, diameter: number,
  texSize: number, mode: 0 | 1, legacySamples: number,
): number[] {
  const gd = Math.max(diameter, 0.001);
  const gd2 = gd * gd;
  const p = positions[index];
  const out: number[] = [];
  for (const j of grainsScanIndices(texSize, mode, legacySamples)) {
    if (j === index || j >= positions.length) continue;
    const dx = p.x - positions[j].x;
    const dy = p.y - positions[j].y;
    const dz = p.z - positions[j].z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < gd2 && d2 > 0.0001) out.push(j);
  }
  return out;
}

/**
 * Jacobi projection correction for one particle (TS twin of the
 * position-pass segment): for every neighbour in the scan, half
 * the overlap along the contact normal, summed, scaled by the
 * strength, with the total clamped to one diameter so a dense
 * pile cannot overshoot in a single pass. Applying the correction
 * to both members of a pair (each computes its own, mirrored)
 * separates the pair by overlap x strength.
 */
export function grainsProjectionCorrection(
  positions: readonly GrainsVec3[], index: number, diameter: number, strength: number,
  texSize: number, mode: 0 | 1, legacySamples: number,
): GrainsVec3 {
  const gd = Math.max(diameter, 0.001);
  const gd2 = gd * gd;
  const s = Math.min(1, Math.max(0, strength));
  const p = positions[index];
  let cx = 0; let cy = 0; let cz = 0;
  if (s > 0) {
    for (const j of grainsScanIndices(texSize, mode, legacySamples)) {
      if (j === index || j >= positions.length) continue;
      const dx = p.x - positions[j].x;
      const dy = p.y - positions[j].y;
      const dz = p.z - positions[j].z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < gd2 && d2 > 0.0001) {
        const dist = Math.sqrt(d2);
        const push = ((gd - dist) * 0.5) / dist;
        cx += dx * push; cy += dy * push; cz += dz * push;
      }
    }
    cx *= s; cy *= s; cz *= s;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (len > gd) { const k = gd / len; cx *= k; cy *= k; cz *= k; }
  }
  return { x: cx, y: cy, z: cz };
}

/* ------------------------------------------------------------------ */
/* Phase 19 fix2: spatial cell sort for the complete neighbourhood.    */
/*                                                                     */
/* The complete scan as shipped in stage 1 priced every texel          */
/* against every other texel in BOTH the velocity contact loop and     */
/* the position projection segment — 65,536 candidate fetches per      */
/* particle per pass, measured at 264 ms/frame on the real-GPU         */
/* gate (vs 54 ms default). Fix2 replaces the mode-1 candidate         */
/* source with a spatial cell index, built once per frame from the     */
/* same frame-start position texture both consumers already read:      */
/*                                                                     */
/*   1. a cell-key pass writes vec4(uv.x, uv.y, cellKey, 1) per        */
/*      texel — the SORT_DEPTH_FRAG payload layout;                    */
/*   2. the existing bitonic machinery sorts the pool by key           */
/*      (descending by .z, the depth sort's final order);              */
/*   3. each consumer binary-searches the sorted texture for the       */
/*      27 cells around its own cell and walks each cell's run,        */
/*      applying the brute-force per-candidate test verbatim.          */
/*                                                                     */
/* Grid grounding: the position pass clamps every particle into        */
/* the bounce sphere at |pos| <= uBounceRadius x 1.05 (its sphere      */
/* clamp runs every frame, after the projection segment; respawns      */
/* land inside the sphere, and the velocity tail reflects at           */
/* uBounceRadius), so live grains live in that sphere. The grid        */
/* spans [-E, E]^3 with E = radius x 1.05 + one grain diameter of      */
/* margin. The cell size is the grain diameter gd, raised to             */
/* span / 256 when the span would need more than 256 cells per         */
/* axis — the key (cx * dimY + cy) * dimZ + cz must stay below          */
/* 2^24 to be exact in float32, which caps every dim at 256. With      */
/* cell size h >= gd, any particle within gd of me lies in my cell     */
/* or one of the 26 adjacent cells (componentwise index distance       */
/* < gd / h <= 1), so the 27-cell search is complete.                  */
/*                                                                     */
/* Particles CAN sit outside the grid (spawn-gate parking at           */
/* y = -99999, pointer-paint teleports, rigid-body points): their      */
/* cell coords clamp into the boundary layer. Clamping is a            */
/* per-axis monotone contraction on indices (|clamp(a) - clamp(b)|     */
/* <= |a - b|), so a true neighbour's clamped index still differs      */
/* from mine by at most 1 per axis and is always visited; clamped      */
/* strangers only ADD candidates, which the exact distance test        */
/* (r2 < gd2, r2 > 0.0001) then rejects. The neighbour SET below is     */
/* therefore exactly the brute-force set — including the shader's      */
/* own self-exclusion rule (texel-uv distance < 1.5 texels, i.e.       */
/* the 3x3 texel block around the seeker), which the GLSL applies      */
/* per candidate in both implementations. Only the accumulation        */
/* ORDER changes in mode 1 (cell order instead of texel order);        */
/* mode 1 has never had a bit-identity guarantee.                      */
/*                                                                     */
/* The sort pool and passes exist only while grainsCellSortActive      */
/* (Grains on AND neighbourhood mode 1) — mode 0 allocates nothing.    */
/* Where the sort cannot run (replica stacks, whose runner receives    */
/* no sort pool), the passes resolve uGrainsCellSort false and the     */
/* shaders keep the stage-1 complete scan as their fallback branch.    */
/* ------------------------------------------------------------------ */

/** Per-axis cell cap of the sort grid (the float32 key budget). */
export const GRAINS_CELL_MAX_DIM = 256;

export interface GrainsCellGrid {
  /** World coordinate of cell (0, 0, 0)'s minimum corner (= -extent). */
  origin: number;
  /** Half-span E of the grid box: bounceRadius x 1.05 + gd. */
  extent: number;
  /** Cell size h: the grain diameter, raised so dims fit the cap. */
  cellSize: number;
  dimX: number;
  dimY: number;
  dimZ: number;
}

/** True while the cell sort feeds the complete neighbourhood. */
export function grainsCellSortActive(config: ParticleConfig): boolean {
  return !!config.gpgpuGrainsEnabled && grainsNeighborhoodMode(config) === 1;
}

/**
 * The sort grid for a bounce radius and grain diameter. Uniform
 * on all axes (the position bound is a sphere): dims are equal,
 * each <= GRAINS_CELL_MAX_DIM, and the maximum key is < 2^24.
 *
 * Pile solver (Stage C): while the pile plan is active the cell
 * size is the support radius h instead of the grain diameter —
 * `supportRadius` carries h in, and the grid margin grows to
 * max(gd, h) so the boundary layer keeps a full cell of slack.
 * With cell = h the 27-cell search is complete for the h window
 * by the same argument as the header above (index distance
 * < window / cell = 1). Without the argument the result is the
 * legacy grid bit-for-bit.
 */
export function grainsCellGrid(bounceRadius: number, grainDiameter: number, supportRadius?: number): GrainsCellGrid {
  const gd = Math.max(Number.isFinite(grainDiameter) ? grainDiameter : 0, 0.001);
  const r = Math.max(0, Number.isFinite(bounceRadius) ? bounceRadius : 0);
  const h = Number.isFinite(supportRadius) ? Math.max(gd, supportRadius as number) : gd;
  const extent = r * 1.05 + h;
  const span = extent * 2;
  const cellSize = Math.max(h, span / GRAINS_CELL_MAX_DIM);
  const dim = Math.min(GRAINS_CELL_MAX_DIM, Math.max(1, Math.ceil(span / cellSize)));
  return { origin: -extent, extent, cellSize, dimX: dim, dimY: dim, dimZ: dim };
}

/** Clamped cell coords of a world position (GLSL twin: grainsCellOf). */
export function grainsCellCoords(grid: GrainsCellGrid, p: GrainsVec3): [number, number, number] {
  const axis = (v: number, dim: number) => {
    const c = Math.floor((v - grid.origin) / grid.cellSize);
    return Math.min(dim - 1, Math.max(0, c));
  };
  return [axis(p.x, grid.dimX), axis(p.y, grid.dimY), axis(p.z, grid.dimZ)];
}

/** Sort key of a cell: (cx * dimY + cy) * dimZ + cz, always < 2^24. */
export function grainsCellKey(grid: GrainsCellGrid, cx: number, cy: number, cz: number): number {
  return (cx * grid.dimY + cy) * grid.dimZ + cz;
}

/**
 * The shader brute-force neighbour set (the ground truth for the
 * cell search): every texel inside the contact window
 * (dist^2 < gd^2, dist^2 > 0.0001), minus the shader's own
 * self-exclusion — candidates whose texel uv sits within 1.5
 * texels of the seeker's (the 3x3 texel block around it) are
 * skipped by the GLSL before the distance test, in the legacy
 * scan and in the cell search alike.
 */
export function grainsNeighborsBruteForceUv(
  positions: readonly GrainsVec3[], texSize: number, index: number, diameter: number,
): number[] {
  const gd = Math.max(diameter, 0.001);
  const gd2 = gd * gd;
  const t = Math.max(1, Math.floor(texSize));
  const ix = index % t;
  const iy = Math.floor(index / t);
  const p = positions[index];
  const out: number[] = [];
  for (let j = 0; j < positions.length; j++) {
    const jx = j % t;
    const jy = Math.floor(j / t);
    const du = jx - ix;
    const dv = jy - iy;
    if (du * du + dv * dv < 2.25) continue;
    const dx = p.x - positions[j].x;
    const dy = p.y - positions[j].y;
    const dz = p.z - positions[j].z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < gd2 && d2 > 0.0001) out.push(j);
  }
  return out;
}

/**
 * Neighbours found through the cell sort (CPU twin of the GLSL
 * lookup): keys are computed per texel, the pool is sorted by
 * key DESCENDING (the bitonic output order), each of the 27
 * neighbour cells is located with a descending lower-bound
 * binary search, and its run is walked applying the same
 * per-candidate tests as the brute force. Returns the same set
 * as grainsNeighborsBruteForceUv, in ascending texel order.
 */
export function grainsNeighborsViaCellSearch(
  positions: readonly GrainsVec3[], texSize: number, index: number, diameter: number,
  grid: GrainsCellGrid,
): number[] {
  const gd = Math.max(diameter, 0.001);
  const gd2 = gd * gd;
  const t = Math.max(1, Math.floor(texSize));
  const n = positions.length;
  const ix = index % t;
  const iy = Math.floor(index / t);
  const p = positions[index];
  // Sorted pool: descending by key (stable order inside a key
  // run is irrelevant — the walk visits the whole run).
  const entries = positions.map((pos, j) => {
    const [cx, cy, cz] = grainsCellCoords(grid, pos);
    return { j, key: grainsCellKey(grid, cx, cy, cz) };
  });
  entries.sort((a, b) => b.key - a.key);
  const keys = entries.map((e) => e.key);
  // First index whose key is <= K (descending lower bound).
  const lowerBound = (k: number): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (keys[mid] > k) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const [mx, my, mz] = grainsCellCoords(grid, p);
  const found = new Set<number>();
  for (let gx = -1; gx <= 1; gx++) {
    for (let gy = -1; gy <= 1; gy++) {
      for (let gz = -1; gz <= 1; gz++) {
        const cx = mx + gx;
        const cy = my + gy;
        const cz = mz + gz;
        if (cx < 0 || cy < 0 || cz < 0 || cx >= grid.dimX || cy >= grid.dimY || cz >= grid.dimZ) continue;
        const key = grainsCellKey(grid, cx, cy, cz);
        for (let s = lowerBound(key); s < n && keys[s] === key; s++) {
          const j = entries[s].j;
          const jx = j % t;
          const jy = Math.floor(j / t);
          const du = jx - ix;
          const dv = jy - iy;
          if (du * du + dv * dv < 2.25) continue;
          const dx = p.x - positions[j].x;
          const dy = p.y - positions[j].y;
          const dz = p.z - positions[j].z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < gd2 && d2 > 0.0001) found.add(j);
        }
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The friction coefficient the solver actually runs with:
 * tan(repose) while the repose key is set, the friction key
 * otherwise. Always finite and ≥ 0.
 */
export function effectiveGrainsFriction(config: ParticleConfig): number {
  const repose = Math.max(0, Math.min(GRAINS_REPOSE_MAX_DEG, config.gpgpuGrainsReposeAngle ?? 0));
  if (repose > 0) {
    const deg = Math.min(repose, GRAINS_REPOSE_TAN_CLAMP_DEG);
    return Math.tan((deg * Math.PI) / 180);
  }
  return Math.max(0, config.gpgpuGrainsFriction || 0);
}

/* ------------------------------------------------------------------ */
/* Grains Stage C: the pile solver (H8 density recipe).                */
/*                                                                     */
/* The recipe the CPU/Taichi prototypes established (runs 5/9/10 +     */
/* the 16,384-particle Colab production run):                          */
/*                                                                     */
/*   (1) support radius h = grain diameter x SupportScale (default     */
/*       2.0) — at h = gd a resting lattice has NO neighbours inside   */
/*       the window, so the density constraint cannot see a pile;      */
/*   (2) rest density rho0 = the Poly6 kernel density of a touching    */
/*       FCC lattice at that h, x RestDensityFactor (default 1.1;      */
/*       gd 8 / h 16 gives 0.002749 x 1.1 = 0.003024);                 */
/*   (3) tangential friction INSIDE every solver iteration (the        */
/*       prototype's main finding — friction outside the iterations    */
/*       left the pile with no holding mechanism);                     */
/*   (4) XSPH velocity smoothing, gated per particle on the            */
/*       neighbourhood having settled (the user's decision: on         */
/*       automatically once the motion calms — early XSPH flattened    */
/*       the forming pile in prototype run 7).                         */
/*                                                                     */
/* The solver is an addition, default OFF: while off, no pile pass     */
/* runs, no pile variant string is built and every legacy path is      */
/* verbatim. The functions below are the TS twins of the GLSL in       */
/* gpgpuShaderSimulationGrainsPile.ts (lambda + delta passes) and      */
/* the XSPH segment of the velocity shader; scripts/                   */
/* phase19-grains.test.mjs pins them.                                  */
/* ------------------------------------------------------------------ */

/** Density-constraint stiffness of the prototype (per iteration). */
export const GRAINS_PILE_STIFFNESS = 0.25;
/** Lambda denominator epsilon of the prototype. */
export const GRAINS_PILE_LAMBDA_EPS = 0.01;
/**
 * Settle gate: full XSPH at or below this neighbourhood mean speed.
 * Recalibrated at the Stage C real-GPU gate (2026-11-26): the
 * prototype band (0.75/1.75) never opened in the product, whose
 * independent velocity texture leaves a settled pile at a mean
 * speed of ~2.3 (meanSpeed2 ~6.7) while the falling stream runs
 * at ~8 and above. The band now sits between those two measured
 * regimes.
 */
export const GRAINS_XSPH_GATE_LOW = 2.0;
/** Settle gate: no XSPH at or above this neighbourhood mean speed. */
export const GRAINS_XSPH_GATE_HIGH = 4.5;

/** True while the pile solver runs (Grains on AND pile on). */
export function grainsPileActive(config: ParticleConfig): boolean {
  return !!config.gpgpuGrainsEnabled && !!config.gpgpuGrainsPileEnabled;
}

/** Solver iterations resolved from the key: integer 1..6, default 3. */
export function resolveGrainsIterations(config: ParticleConfig): number {
  const v = Math.round(config.gpgpuGrainsIterations ?? 3);
  return Number.isFinite(v) ? Math.min(6, Math.max(1, v)) : 3;
}

/** Support-radius factor resolved from the key: 1..3, default 2. */
export function resolveGrainsSupportScale(config: ParticleConfig): number {
  const v = config.gpgpuGrainsSupportScale ?? 2;
  return Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : 2;
}

/** Support radius h = grain diameter x the resolved factor. */
export function grainsSupportRadius(config: ParticleConfig): number {
  return Math.max(0.001, config.gpgpuGrainsSize || 0) * resolveGrainsSupportScale(config);
}

/** Rest-density factor resolved from the key: 0.8..1.4, default 1.1. */
export function resolveGrainsRestDensityFactor(config: ParticleConfig): number {
  const v = config.gpgpuGrainsRestDensityFactor ?? 1.1;
  return Number.isFinite(v) ? Math.min(1.4, Math.max(0.8, v)) : 1.1;
}

/** XSPH strength resolved from the key: 0..1, default 0.5. */
export function resolveGrainsXsphStrength(config: ParticleConfig): number {
  const v = config.gpgpuGrainsXsphStrength ?? 0.5;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

/** Velocity-update blend resolved from the key: 0..1, default 1. */
export function resolveGrainsVelocityBlend(config: ParticleConfig): number {
  const v = config.gpgpuGrainsVelocityBlend ?? 1;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** Per-frame damping of the reconstructed velocity (prototype). */
export const GRAINS_VELOCITY_DAMPING = 0.995;
/** Parked-particle sentinel: positions at or below this y are parked. */
export const GRAINS_PARKED_Y = -90000;
/** Teleport mask: displacements beyond grains size x this are not velocity. */
export const GRAINS_VELOCITY_TELEPORT_SCALE = 8;
/**
 * 案E dense damping: the reconstructed velocity is scaled by an
 * extra factor that engages only where the local density (the
 * pile lambda pass's rho, relative to rho0) marks the particle
 * as pile interior. The factor ramps from 1 at rho/rho0 =
 * GRAINS_VELOCITY_DENSE_LO to GRAINS_VELOCITY_DENSE_DAMP at
 * GRAINS_VELOCITY_DENSE_HI, so the surface and the falling
 * stream keep the plain 案A behaviour while the interior —
 * whose residual speed2 floor (~2.29 in gate round 2) is fed
 * by neighbour coupling, not by free motion — is damped every
 * frame. Gate round 3 (案C) proved the post-solve position
 * cannot be the reconstruction source at any cap, so 案E keeps
 * the 案A pre-solve source and adds only this factor.
 */
export const GRAINS_VELOCITY_DENSE_DAMP = 0.8;
/** Density ratio where the dense damping starts to engage. */
export const GRAINS_VELOCITY_DENSE_LO = 0.8;
/** Density ratio where the dense damping is fully engaged. */
export const GRAINS_VELOCITY_DENSE_HI = 1.1;

/** 案E density factor for a rho/rho0 ratio (smoothstep ramp). */
export function grainsVelocityDenseFactor(rhoRatio: number): number {
  const lo = GRAINS_VELOCITY_DENSE_LO;
  const hi = GRAINS_VELOCITY_DENSE_HI;
  const t = Math.min(1, Math.max(0, (rhoRatio - lo) / (hi - lo)));
  const s = t * t * (3 - 2 * t);
  return 1 + (GRAINS_VELOCITY_DENSE_DAMP - 1) * s;
}

export interface GrainsVec3 { x: number; y: number; z: number }

/**
 * Reconstruct the velocity from the frame's actual displacement,
 * inverting the product's (non-Verlet) integration
 * pos += vel x dt x speed x 60. At dt = 1/60 and speed = 1 the
 * reconstruction is the displacement itself — the prototype's
 * finish-frame rule.
 */
export function grainsReconstructVelocity(
  disp: GrainsVec3, dt: number, speed: number,
): GrainsVec3 {
  const denom = Math.max(dt * 60 * speed, 1e-9);
  return { x: disp.x / denom, y: disp.y / denom, z: disp.z / denom };
}

/**
 * TS twin of the velocity-update pass (GRAINS_VELOCITY_UPDATE_FRAG):
 * blend the velocity texture value toward the reconstructed
 * velocity x damping, unless a mask marks the texel as not-a-move:
 * parked sentinel on either side, an age discontinuity (respawn /
 * reset: age wrapped backwards, or the age advance differs from dt
 * by more than 2dt), or a teleport-scale displacement. Returns the
 * input velocity unchanged for masked texels and for blend 0.
 * The posOut argument is the position-pass output (the pile base
 * snapshot), NOT the post-solve position: gate rounds 1 and 3
 * proved that reconstructing from the solved position turns the
 * solve's saturated push-out into an ejection pump at any
 * displacement cap. When opts.rho / opts.rho0 are supplied （案E）,
 * the reconstructed velocity is additionally scaled by
 * grainsVelocityDenseFactor(rho / rho0) — see that constant's
 * comment. Without them the factor is 1 (plain 案A).
 */
export function grainsApplyVelocityUpdate(
  vel: GrainsVec3,
  posIn: GrainsVec3 & { age: number },
  posOut: GrainsVec3 & { age: number },
  opts: { dt: number; speed: number; blend: number; grainsSize: number; rho?: number; rho0?: number },
): GrainsVec3 {
  const { dt, speed, blend, grainsSize } = opts;
  if (!(blend > 0) || !(dt > 0)) return vel;
  if (posIn.y <= GRAINS_PARKED_Y || posOut.y <= GRAINS_PARKED_Y) return vel;
  if (posOut.age < posIn.age) return vel;
  if (Math.abs(posOut.age - posIn.age - dt) > 2 * dt) return vel;
  const disp = { x: posOut.x - posIn.x, y: posOut.y - posIn.y, z: posOut.z - posIn.z };
  const dist = Math.hypot(disp.x, disp.y, disp.z);
  if (dist > Math.max(0.001, grainsSize) * GRAINS_VELOCITY_TELEPORT_SCALE) return vel;
  const recon = grainsReconstructVelocity(disp, dt, speed);
  const dense = (opts.rho !== undefined && opts.rho0 !== undefined && opts.rho0 > 0)
    ? grainsVelocityDenseFactor(opts.rho / opts.rho0)
    : 1;
  const d = GRAINS_VELOCITY_DAMPING * dense;
  return {
    x: vel.x + (recon.x * d - vel.x) * blend,
    y: vel.y + (recon.y * d - vel.y) * blend,
    z: vel.z + (recon.z * d - vel.z) * blend,
  };
}

/** Poly6 kernel W(d, h) = 315 / (64 pi h^9) x (h^2 - d^2)^3, 0 outside h. */
export function grainsPoly6(dist: number, support: number): number {
  const h = Math.max(support, 0.001);
  if (!(dist >= 0) || dist >= h) return 0;
  const coef = 315 / (64 * Math.PI * Math.pow(h, 9));
  const t = h * h - dist * dist;
  return coef * t * t * t;
}

/**
 * The kernel density of a touching FCC lattice at support h —
 * the prototype's lattice_rho0(): lattice constant a = gd x
 * sqrt(2), the four FCC basis points, shells out to |offset| 2,
 * every lattice point strictly inside h (the self point at
 * d = 0 included). gd 8 / h 16 gives 0.002749.
 */
export function grainsLatticeRho0(diameter: number, support: number): number {
  const gd = Math.max(diameter, 0.001);
  const h = Math.max(support, 0.001);
  const a = gd * Math.SQRT2;
  const basis: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0],
  ];
  let rho = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      for (let k = -2; k <= 2; k++) {
        for (const b of basis) {
          const x = (i + b[0]) * a;
          const y = (j + b[1]) * a;
          const z = (k + b[2]) * a;
          const d = Math.sqrt(x * x + y * y + z * z);
          if (d < h - 1e-9) rho += grainsPoly6(d, h);
        }
      }
    }
  }
  return rho;
}

/** Effective rest density: lattice density x the resolved factor. */
export function grainsEffectiveRho0(config: ParticleConfig): number {
  return grainsLatticeRho0(Math.max(0.001, config.gpgpuGrainsSize || 0), grainsSupportRadius(config))
    * resolveGrainsRestDensityFactor(config);
}

export interface GrainsPilePlan {
  active: boolean;
  iterations: number;
  supportScale: number;
  /** Support radius h in world units. */
  supportRadius: number;
  restDensityFactor: number;
  /** Effective rest density rho0 (lattice x factor). */
  rho0: number;
  xsphStrength: number;
  /** Density stiffness x the legacy projection strength key. */
  stiffness: number;
  /** Velocity-update blend (0..1) from the key. */
  velocityBlend: number;
  /**
   * True while the velocity-update pass runs: pile active, blend
   * above 0, and neither Verlet nor rigid bodies on (both own
   * their velocity semantics; the design keeps them exclusive in
   * v1). Single resolution point, like the rest of the plan.
   */
  velocityUpdateActive: boolean;
}

/**
 * The single resolution every pile consumer shares (passes,
 * runtime allocation, variant selection) — the Stage B residual
 * lesson: consumers resolving separately is what desynchronised
 * the projection from the contact loop there. Inactive plans
 * still carry the resolved values, so callers never branch on
 * the raw keys themselves.
 */
export function resolveGrainsPilePlan(config: ParticleConfig): GrainsPilePlan {
  return {
    active: grainsPileActive(config),
    iterations: resolveGrainsIterations(config),
    supportScale: resolveGrainsSupportScale(config),
    supportRadius: grainsSupportRadius(config),
    restDensityFactor: resolveGrainsRestDensityFactor(config),
    rho0: grainsEffectiveRho0(config),
    xsphStrength: resolveGrainsXsphStrength(config),
    stiffness: GRAINS_PILE_STIFFNESS * resolveGrainsProjection(config),
    velocityBlend: resolveGrainsVelocityBlend(config),
    velocityUpdateActive:
      grainsPileActive(config) &&
      resolveGrainsVelocityBlend(config) > 0 &&
      !config.gpgpuVerletEnabled &&
      !config.gpgpuRigidEnabled,
  };
}

/**
 * The XSPH settle gate (TS twin of the velocity-shader segment):
 * 1 while the neighbourhood mean speed is at or below GATE_LOW,
 * 0 at or above GATE_HIGH, smoothstep between. Speeds are in
 * per-frame displacement units — the product velocity integrates
 * to one frame of travel at uSpeed 1, the prototype's scale
 * (falling grains exceed 2; its settled creep measured ~0.4).
 */
export function grainsXsphGate(meanSpeed: number): number {
  const v = Number.isFinite(meanSpeed) ? meanSpeed : 0;
  const t = Math.min(1, Math.max(0, (v - GRAINS_XSPH_GATE_LOW) / (GRAINS_XSPH_GATE_HIGH - GRAINS_XSPH_GATE_LOW)));
  return 1 - t * t * (3 - 2 * t);
}

/** Indices of every particle strictly inside `radius` of index (d > 0). */
export function grainsNeighborsWithin(
  positions: readonly GrainsVec3[], index: number, radius: number,
): number[] {
  const r = Math.max(radius, 0.001);
  const r2 = r * r;
  const p = positions[index];
  const out: number[] = [];
  for (let j = 0; j < positions.length; j++) {
    if (j === index) continue;
    const dx = p.x - positions[j].x;
    const dy = p.y - positions[j].y;
    const dz = p.z - positions[j].z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2 && d2 > 0) out.push(j);
  }
  return out;
}

export interface GrainsDensityState { rho: number[]; lambda: number[] }

/**
 * Density + lambda for every particle (TS twin of the pile
 * lambda pass): rho from the Poly6 sum (self term included),
 * C = rho / rho0 - 1, lambda = -C / ((sum |grad C|^2 +
 * |sum grad C|^2) / rho0^2 + eps), with the Spiky gradient.
 * Particles with no neighbour inside h get lambda 0.
 */
export function grainsComputeDensityLambdas(
  positions: readonly GrainsVec3[], support: number, rho0: number,
): GrainsDensityState {
  const h = Math.max(support, 0.001);
  const r0 = Math.max(rho0, 1e-9);
  const spikyCoef = -45 / (Math.PI * Math.pow(h, 6));
  const rho: number[] = new Array(positions.length).fill(0);
  const lambda: number[] = new Array(positions.length).fill(0);
  for (let i = 0; i < positions.length; i++) {
    let r = grainsPoly6(0, h);
    let gsx = 0; let gsy = 0; let gsz = 0; let gsq = 0;
    let cnt = 0;
    for (const j of grainsNeighborsWithin(positions, i, h)) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      const dz = positions[i].z - positions[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cnt++;
      r += grainsPoly6(d, h);
      const gc = (spikyCoef * (h - d) * (h - d)) / d;
      const gx = gc * dx; const gy = gc * dy; const gz = gc * dz;
      gsx += gx; gsy += gy; gsz += gz;
      gsq += gx * gx + gy * gy + gz * gz;
    }
    rho[i] = r;
    if (cnt > 0) {
      const denom = (gsq + gsx * gsx + gsy * gsy + gsz * gsz) / (r0 * r0) + GRAINS_PILE_LAMBDA_EPS;
      lambda[i] = -(r / r0 - 1) / denom;
    }
  }
  return { rho, lambda };
}

/**
 * One Jacobi density correction for one particle (TS twin of
 * the pile delta pass): stiffness x sum_j (lambda_i + lambda_j)
 * / rho0 x grad W_ij, the total clamped to half a diameter —
 * the prototype's anti-explosion bound.
 */
export function grainsDensityCorrection(
  positions: readonly GrainsVec3[], index: number, support: number, rho0: number,
  stiffness: number, lambdas: readonly number[], diameter: number,
): GrainsVec3 {
  const h = Math.max(support, 0.001);
  const r0 = Math.max(rho0, 1e-9);
  const gd = Math.max(diameter, 0.001);
  const spikyCoef = -45 / (Math.PI * Math.pow(h, 6));
  let cx = 0; let cy = 0; let cz = 0;
  for (const j of grainsNeighborsWithin(positions, index, h)) {
    const dx = positions[index].x - positions[j].x;
    const dy = positions[index].y - positions[j].y;
    const dz = positions[index].z - positions[j].z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gc = (spikyCoef * (h - d) * (h - d)) / d;
    const s = ((lambdas[index] + lambdas[j]) / r0) * gc;
    cx += s * dx; cy += s * dy; cz += s * dz;
  }
  cx *= stiffness; cy *= stiffness; cz *= stiffness;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const cap = gd / 2;
  if (len > cap) { const k = cap / len; cx *= k; cy *= k; cz *= k; }
  return { x: cx, y: cy, z: cz };
}
