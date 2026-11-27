/**
 * Rigid cluster colours (Phase 20 stage 1 — the colour
 * foundation for fragment cluster colouring).
 *
 * A bake's fracture division groups its bodies into static
 * clusters (the glue-bond connected components derived in
 * lib/fragmentCollection.ts). Colouring by cluster needs one
 * colour per cluster id that is:
 *
 * - DETERMINISTIC: the same cluster id always yields the same
 *   colour, on every machine and every run — no RNG state, no
 *   dependence on how many clusters the division happens to
 *   have, so a body's colour is stable across re-bakes that
 *   keep its cluster id.
 * - MUTED: saturation and lightness are held down (see
 *   CLUSTER_COLOR_PALETTE) so a coloured cloud stays in the
 *   app's restrained register instead of turning into confetti.
 * - TABLE-READY: buildClusterColorLut packs the colours as a
 *   flat RGBA float array, sized for the RIGID_CLUSTER_COLOR_COUNT×1
 *   LUT texture the draw path will sample by cluster id (the count
 *   = the rigid body budget, RIGID_BODY_MAX in lib/rigidBodies.ts;
 *   a cluster id can never exceed the body count).
 *
 * The wiring (Phase 20 stage 1 integration): the runtime
 * builds a per-body LUT with buildBodyClusterColorLut at bake
 * time and the points draw vertex shader resolves
 * cell texture .w (body index) → LUT row → cluster colour.
 * The palette lives in the single constant below precisely so
 * it can be swapped in one place.
 */

import { deriveFragmentClusters, deriveGlueBonds } from './fragmentCollection';
import { RIGID_BODY_MAX } from './rigidBodies';
import type { FractureCellData } from './voronoiFracture';

/** Cluster / body budget the LUT is sized for. */
export const RIGID_CLUSTER_COLOR_COUNT = RIGID_BODY_MAX;

/**
 * The palette knobs, isolated for later replacement.
 * Hue is NOT stored: it is derived from the cluster id by the
 * golden-angle step below, which spreads neighbouring ids far
 * apart on the wheel while keeping every id's hue fixed.
 */
export const CLUSTER_COLOR_PALETTE = {
  /** Golden-angle hue step in degrees (id → hue multiplier). */
  hueStepDeg: 137.508,
  /** HSL saturation, 0..1 (held low: muted, not candy). */
  saturation: 0.38,
  /** HSL lightness, 0..1 (mid-bright so colours read on both
   *  dark and light geometry shading). */
  lightness: 0.58,
  /** Alpha written into every LUT entry. */
  alpha: 1,
} as const;

/** Neutral fallback for an out-of-range / non-finite id. */
const CLUSTER_COLOR_FALLBACK: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 1];

/** HSL (h in degrees, s/l in 0..1) → RGB in 0..1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

/**
 * The colour of one cluster id as [r, g, b, a] floats in 0..1.
 * Pure and deterministic: id → hue by the golden-angle step,
 * fixed saturation / lightness from CLUSTER_COLOR_PALETTE.
 * Negative, non-integer or non-finite ids yield the neutral
 * fallback rather than a wrapped colour, so a bad id is visible
 * as grey instead of silently aliasing another cluster.
 */
export function clusterColorForIndex(index: number): [number, number, number, number] {
  if (!Number.isInteger(index) || index < 0) return [...CLUSTER_COLOR_FALLBACK];
  const hue = (index * CLUSTER_COLOR_PALETTE.hueStepDeg) % 360;
  const [r, g, b] = hslToRgb(hue, CLUSTER_COLOR_PALETTE.saturation, CLUSTER_COLOR_PALETTE.lightness);
  return [r, g, b, CLUSTER_COLOR_PALETTE.alpha];
}

/**
 * Pack `count` cluster colours (ids 0..count-1) into a flat
 * RGBA float array of count × 4 entries — the backing store of
 * the RIGID_CLUSTER_COLOR_COUNT×1 LUT texture. `count` defaults to the full budget
 * and is clamped into 0..RIGID_CLUSTER_COLOR_COUNT.
 */
export function buildClusterColorLut(count: number = RIGID_CLUSTER_COLOR_COUNT): Float32Array {
  const n = Number.isFinite(count)
    ? Math.max(0, Math.min(RIGID_CLUSTER_COLOR_COUNT, Math.floor(count)))
    : 0;
  const lut = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = clusterColorForIndex(i);
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = a;
  }
  return lut;
}

/**
 * The per-BODY LUT the draw path consumes (Phase 20 stage 1
 * integration): a full RIGID_CLUSTER_COLOR_COUNT × RGBA array
 * whose row b is the colour of the static cluster body b
 * belongs to in this bake's cell table. Clusters are the
 * bake-time glue-bond connected components — the same
 * derivation a saved fragment collection stores
 * (deriveGlueBonds + deriveFragmentClusters over the cell
 * table) — so the colouring and the collection asset always
 * agree about what a cluster is. Bodies past the bake's body
 * count keep the neutral fallback colour (never sampled: cell
 * indices only name real bodies). Pure and deterministic.
 */
export function buildBodyClusterColorLut(cellData: FractureCellData): Float32Array {
  const lut = new Float32Array(RIGID_CLUSTER_COLOR_COUNT * 4);
  for (let b = 0; b < RIGID_CLUSTER_COLOR_COUNT; b++) {
    const [r, g, bl, a] = clusterColorForIndex(-1);
    lut[b * 4] = r;
    lut[b * 4 + 1] = g;
    lut[b * 4 + 2] = bl;
    lut[b * 4 + 3] = a;
  }
  const clusters = deriveFragmentClusters(
    cellData.bodyCount,
    cellData.cellCounts,
    deriveGlueBonds(cellData),
  );
  for (const cluster of clusters) {
    const [r, g, b, a] = clusterColorForIndex(cluster.id);
    for (const body of cluster.bodies) {
      if (body < 0 || body >= RIGID_CLUSTER_COLOR_COUNT) continue;
      lut[body * 4] = r;
      lut[body * 4 + 1] = g;
      lut[body * 4 + 2] = b;
      lut[body * 4 + 3] = a;
    }
  }
  return lut;
}
