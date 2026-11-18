/**
 * Published terrain heightfield (Phase BA) — the erosion bake's
 * height data as a CPU-referenceable array.
 *
 * Phase AP's erosion sim produces exactly one baked field
 * (`ErodedTerrainField` in lib/gpgpuMorphTargets.ts): a 129×129
 * grid over the field domain [-1.05, +1.05]^2, heights in field
 * units, read through a bilinear sampler by the morph bake and
 * the scatter grammar. Until now that field never reached a
 * solver: the rigid-body floor (Phase AU) was a flat plane.
 *
 * This module is the publication point. It wraps the baked field
 * in WORLD units — the space the rigid bodies live in — so any
 * CPU consumer (the RBD floor today) can sample the same
 * landscape the bake carved:
 *
 *  - resolution: `size` × `size` grid points (129, the erosion
 *    grid — TERRAIN_EROSION_GRID_SIZE), row-major, row 0 is
 *    z = -extent, index = row * size + col with col along +X.
 *  - range: the square domain [-extent, +extent]^2 on the XZ
 *    plane, extent = 1.05 × worldScale, step = 2·extent/(size-1).
 *  - heights: world units (field height × worldScale), where
 *    worldScale = gpgpuMorphScale × gpgpuBounceRadius × 0.48 —
 *    the morph bake's own world scale, because the bodies bind
 *    to the morph cloud. (The terrain MESH layer has its own
 *    extra display scale, gpgpuTerrainMeshScale; the floor does
 *    not follow it — at mesh scale ≠ 1 the visible mesh and the
 *    floor diverge by that factor, by design.)
 *  - sampling: bilinear over the grid, clamped to the domain
 *    edge — the same rule as sampleErodedField.
 *
 * Publication is conditional by construction: the field exists
 * only while the erosion grammar is active (Water or Thermal
 * above 0, plane mode — tunnel mode strips the erosion options
 * in terrainOptionsFromConfig, exactly like the derived maps).
 * With no baked field this module returns null and consumers
 * fall back to whatever they did before (the RBD floor falls
 * back to the flat plane at gpgpuFloorY). The analytic
 * (un-eroded) field is NOT published here: the publication is
 * the bake artifact, not a re-derivation.
 *
 * Other consumers, audited for Phase BA item 4: the particle
 * terrain collider and the slope force read a GPU texture baked
 * by lib/terrainDerivedMaps.ts from its OWN copy of the base
 * grid run through the same erodeHeightGridInPlace sim, so they
 * describe the same landscape cell for cell — but they do not
 * (and cannot, being shaders) read this array. The morph bake,
 * the scatter grammar and now the RBD floor share the single
 * ErodedTerrainField object this module wraps.
 */

import {
  getErodedTerrainField,
  terrainFieldSeedFor,
  type ErodedTerrainField,
} from './gpgpuMorphTargets';
import { terrainOptionsFromConfig } from './terrainDerivedMaps';
import type { ParticleConfig } from '../types';

export interface TerrainHeightfield {
  /** Grid side length (129). */
  size: number;
  /** Half-extent of the domain in world units: XZ ∈ [-extent, +extent]^2. */
  extent: number;
  /** Grid spacing in world units. */
  step: number;
  /** Row-major heights in world units; row 0 = z = -extent, col along +X. */
  heights: Float32Array;
  /** The world scale the field units were multiplied by. */
  worldScale: number;
}

let wrapperCache: { field: ErodedTerrainField; worldScale: number; wrapped: TerrainHeightfield } | null = null;

/**
 * The published heightfield for a config, or null when no baked
 * field exists (erosion grammar off, or tunnel mode). The
 * underlying ErodedTerrainField is itself single-entry cached in
 * gpgpuMorphTargets, so resolving per frame is a cache hit; the
 * world-unit copy is rebuilt only when the field object or the
 * world scale changes.
 */
export function getTerrainHeightfield(config: ParticleConfig): TerrainHeightfield | null {
  const terrain = terrainOptionsFromConfig(config);
  const fieldSeed = terrainFieldSeedFor(config.gpgpuSeed, terrain.seed);
  const field = getErodedTerrainField(terrain, fieldSeed);
  if (!field) return null;
  const worldScale = config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48;
  if (!Number.isFinite(worldScale) || worldScale <= 0) return null;
  if (wrapperCache && wrapperCache.field === field && wrapperCache.worldScale === worldScale) {
    return wrapperCache.wrapped;
  }
  const heights = new Float32Array(field.heights.length);
  for (let i = 0; i < heights.length; i++) heights[i] = field.heights[i] * worldScale;
  const wrapped: TerrainHeightfield = {
    size: field.size,
    extent: field.extent * worldScale,
    step: field.step * worldScale,
    heights,
    worldScale,
  };
  wrapperCache = { field, worldScale, wrapped };
  return wrapped;
}

/**
 * Bilinear sample of the published field at a world (x, z),
 * clamped to the domain edge — the sampleErodedField rule in
 * world units.
 */
export function sampleTerrainHeightfield(field: TerrainHeightfield, x: number, z: number): number {
  const n = field.size;
  const gx = Math.max(0, Math.min(n - 1, (x + field.extent) / field.step));
  const gz = Math.max(0, Math.min(n - 1, (z + field.extent) / field.step));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const h = field.heights;
  const h00 = h[iz * n + ix];
  const h10 = h[iz * n + ix + 1];
  const h01 = h[(iz + 1) * n + ix];
  const h11 = h[(iz + 1) * n + ix + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/**
 * Surface normal of the published field at a world (x, z):
 * normalize(-dh/dx, 1, -dh/dz) by central differences of the
 * sampler with one grid step (the gradient is dimensionless —
 * height and XZ share the world scale).
 */
export function terrainHeightfieldNormal(
  field: TerrainHeightfield,
  x: number,
  z: number,
): [number, number, number] {
  const eps = field.step;
  const gx = (sampleTerrainHeightfield(field, x + eps, z) - sampleTerrainHeightfield(field, x - eps, z)) / (2 * eps);
  const gz = (sampleTerrainHeightfield(field, x, z + eps) - sampleTerrainHeightfield(field, x, z - eps)) / (2 * eps);
  const inv = 1 / Math.hypot(gx, 1, gz);
  return [-gx * inv, inv, -gz * inv];
}
