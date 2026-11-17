/**
 * Terrain derived maps (Phase AE): the height field as a source
 * of information, not just a surface.
 *
 * The terrain field (lib/gpgpuMorphTargets.ts `terrainHeightAt`,
 * shared by the morph target and the polygon mesh) is sampled on
 * the mesh's own vertex grid ([-TERRAIN_MESH_EXTENT, +E]^2,
 * 129 x 129) and differentiated once, deterministically:
 *
 *  - normal map    — RGB = normalize(-dh/dx, 1, -dh/dz) remapped
 *                    to [0, 1] (tangent-space convention, +Y up).
 *  - slope map     — luma = |gradient| normalised by the grid's
 *                    own maximum, so the steepest cell in THIS
 *                    terrain is white and flat ground is black.
 *  - curvature map — luma = 0.5 + 0.5 * laplacian / max|laplacian|
 *                    (mid grey = flat, bright = convex ridge,
 *                    dark = concave hollow).
 *  - gradient tex  — the shader-facing bake for the slope force:
 *                    R/G encode the unit DOWNHILL direction,
 *                    B the normalised slope magnitude.
 *  - collider tex  — the shader-facing bake for the terrain
 *                    collider (Phase AI): RG pack the height as a
 *                    16-bit value, B/A carry the gradient
 *                    components; decoded by the sim shaders with
 *                    a manual bilinear (see TerrainDerivedMaps).
 *
 * Everything is a pure function of (terrain params, bake seed):
 * the same config bakes bit-identically, which the unit tests
 * pin. Row order in every bake is row 0 = fz = -E (the v = 0
 * side), matching what lib/mapImageTexture.ts produces when it
 * decodes an image (it flips rows), so an internally supplied
 * derived texture samples identically to the exported PNG of the
 * same map loaded back as an image.
 *
 * Supply: a derived map reaches the Layer Maps and the raster /
 * kill mask through a sentinel source string
 * (`terrain-derived:slope` etc.) stored in the EXISTING source
 * keys (gpgpuMapSizeSource / ... / gpgpuMaskSource) — no new
 * config keys for the maps themselves. `resolveMapSourceTexture`
 * is the single resolution point: sentinel sources resolve here,
 * everything else delegates to the Phase X image cache.
 */

import * as THREE from 'three';
import {
  terrainFieldSeedFor,
  terrainHeightAt,
  type GpgpuMorphTerrainOptions,
} from './gpgpuMorphTargets';
import { TERRAIN_MESH_EXTENT, TERRAIN_MESH_RESOLUTION } from './terrainMesh';
import { getMapImageTexture, type MapImageTextureState } from './mapImageTexture';
import { resolveAfMapSourceTexture } from './mapSourceSupply';
import type { ParticleConfig } from '../types';

export type TerrainDerivedMapKind = 'normal' | 'slope' | 'curvature';

export const TERRAIN_DERIVED_KINDS: readonly TerrainDerivedMapKind[] = ['normal', 'slope', 'curvature'];

/** Vertex-grid side length of the derived bakes: the terrain
 *  mesh's own grid (TERRAIN_MESH_RESOLUTION segments + 1). */
export const TERRAIN_DERIVED_SIZE = TERRAIN_MESH_RESOLUTION + 1;

export const TERRAIN_DERIVED_SOURCE_PREFIX = 'terrain-derived:';

export function terrainDerivedSource(kind: TerrainDerivedMapKind): string {
  return TERRAIN_DERIVED_SOURCE_PREFIX + kind;
}

export function parseTerrainDerivedSource(source: string): TerrainDerivedMapKind | null {
  if (!source || !source.startsWith(TERRAIN_DERIVED_SOURCE_PREFIX)) return null;
  const kind = source.slice(TERRAIN_DERIVED_SOURCE_PREFIX.length);
  return kind === 'normal' || kind === 'slope' || kind === 'curvature' ? kind : null;
}

export function isTerrainDerivedSource(source: string): boolean {
  return parseTerrainDerivedSource(source) !== null;
}

// ---------------------------------------------------------------------------
// Height grid + differentiation (pure)

export interface TerrainHeightGrid {
  size: number;
  /** Row-major heights, row 0 = fz = -extent. */
  heights: Float32Array;
  extent: number;
  /** Grid spacing in field units. */
  step: number;
}

export function buildTerrainHeightGrid(
  terrain: GpgpuMorphTerrainOptions,
  seed: number,
  size: number = TERRAIN_DERIVED_SIZE,
): TerrainHeightGrid {
  const n = Math.max(2, Math.floor(size));
  const extent = TERRAIN_MESH_EXTENT;
  const step = (extent * 2) / (n - 1);
  const fieldSeed = terrainFieldSeedFor(seed, terrain.seed);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const fz = -extent + j * step;
    for (let i = 0; i < n; i++) {
      const fx = -extent + i * step;
      heights[j * n + i] = terrainHeightAt(fx, fz, terrain, fieldSeed);
    }
  }
  return { size: n, heights, extent, step };
}

export interface TerrainDerivedMaps {
  size: number;
  /** RGBA bakes, row 0 = fz = -extent (see module doc). */
  normal: Uint8ClampedArray;
  slope: Uint8ClampedArray;
  curvature: Uint8ClampedArray;
  /** Shader bake: RG = unit downhill direction, B = |grad| / max. */
  gradient: Uint8ClampedArray;
  /**
   * Collider bake (Phase AI): RG = the height packed as a 16-bit
   * value over [-maxAbsHeight, +maxAbsHeight] (R = high byte,
   * G = low byte), B/A = the gradient components gx/gz encoded
   * over [-maxGradient, +maxGradient]. The sim shaders decode it
   * with a manual bilinear (hardware filtering would corrupt the
   * packed height at low-byte wraps), so the texture is created
   * with NearestFilter.
   */
  collider: Uint8ClampedArray;
  maxGradient: number;
  maxAbsCurvature: number;
  /** Maximum |height| over the grid — the collider pack range and
   *  the decode scale (× worldScale) for the packed height. */
  maxAbsHeight: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toByte(v: number): number {
  return Math.round(clamp01(v) * 255);
}

/**
 * Differentiate a height grid into the four bakes. Works on any
 * square grid, so the unit tests can feed analytic shapes (a
 * sine wave, a flat plane) and compare against theory.
 */
export function deriveMapsFromHeightGrid(heights: ArrayLike<number>, size: number, step: number): TerrainDerivedMaps {
  const n = Math.max(2, Math.floor(size));
  const count = n * n;
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  const lap = new Float32Array(count);
  let maxGradient = 0;
  let maxAbsCurvature = 0;
  const invStep = 1 / Math.max(step, 1e-9);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const hl = heights[j * n + Math.max(0, i - 1)];
      const hr = heights[j * n + Math.min(n - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * n + i];
      const hu = heights[Math.min(n - 1, j + 1) * n + i];
      const spanX = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * step;
      const spanZ = (Math.min(n - 1, j + 1) - Math.max(0, j - 1)) * step;
      const dx = (hr - hl) / Math.max(spanX, 1e-9);
      const dz = (hu - hd) / Math.max(spanZ, 1e-9);
      gx[idx] = dx;
      gz[idx] = dz;
      const g = Math.sqrt(dx * dx + dz * dz);
      if (g > maxGradient) maxGradient = g;
      // The Laplacian needs a full stencil; border cells reuse
      // the centre value for the missing neighbour (zero second
      // derivative contribution on that axis), which keeps the
      // border flat-biased instead of inventing curvature.
      const hc = heights[idx];
      const lapX = ((i > 0 ? heights[idx - 1] : hc) + (i < n - 1 ? heights[idx + 1] : hc) - 2 * hc) * invStep * invStep;
      const lapZ = ((j > 0 ? heights[idx - n] : hc) + (j < n - 1 ? heights[idx + n] : hc) - 2 * hc) * invStep * invStep;
      lap[idx] = lapX + lapZ;
      const a = Math.abs(lap[idx]);
      if (a > maxAbsCurvature) maxAbsCurvature = a;
    }
  }
  let maxAbsHeight = 0;
  for (let idx = 0; idx < count; idx++) {
    const a = Math.abs(heights[idx]);
    if (a > maxAbsHeight) maxAbsHeight = a;
  }
  const normal = new Uint8ClampedArray(count * 4);
  const slope = new Uint8ClampedArray(count * 4);
  const curvature = new Uint8ClampedArray(count * 4);
  const gradient = new Uint8ClampedArray(count * 4);
  const collider = new Uint8ClampedArray(count * 4);
  const gradNorm = maxGradient > 0 ? 1 / maxGradient : 0;
  const curvNorm = maxAbsCurvature > 0 ? 1 / maxAbsCurvature : 0;
  for (let idx = 0; idx < count; idx++) {
    const o = idx * 4;
    const dx = gx[idx];
    const dz = gz[idx];
    const invLen = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    normal[o] = toByte(-dx * invLen * 0.5 + 0.5);
    normal[o + 1] = toByte(invLen * 0.5 + 0.5);
    normal[o + 2] = toByte(-dz * invLen * 0.5 + 0.5);
    normal[o + 3] = 255;
    const g = Math.sqrt(dx * dx + dz * dz);
    const s = g * gradNorm;
    const sb = toByte(s);
    slope[o] = sb; slope[o + 1] = sb; slope[o + 2] = sb; slope[o + 3] = 255;
    const cb = toByte(0.5 + 0.5 * lap[idx] * curvNorm);
    curvature[o] = cb; curvature[o + 1] = cb; curvature[o + 2] = cb; curvature[o + 3] = 255;
    if (g > 1e-12) {
      gradient[o] = toByte(-dx / g * 0.5 + 0.5);
      gradient[o + 1] = toByte(-dz / g * 0.5 + 0.5);
    } else {
      gradient[o] = 128; gradient[o + 1] = 128;
    }
    gradient[o + 2] = sb;
    gradient[o + 3] = 255;
    // Collider pack (Phase AI): height as a 16-bit value over
    // [-maxAbsHeight, +maxAbsHeight]; gradient components over
    // [-maxGradient, +maxGradient] (0.5 when the field is flat).
    const hv = maxAbsHeight > 0 ? clamp01(heights[idx] / maxAbsHeight * 0.5 + 0.5) : 0.5;
    const packed = Math.round(hv * 65535);
    collider[o] = (packed >> 8) & 255;
    collider[o + 1] = packed & 255;
    collider[o + 2] = toByte(maxGradient > 0 ? dx * gradNorm * 0.5 + 0.5 : 0.5);
    collider[o + 3] = toByte(maxGradient > 0 ? dz * gradNorm * 0.5 + 0.5 : 0.5);
  }
  return { size: n, normal, slope, curvature, gradient, collider, maxGradient, maxAbsCurvature, maxAbsHeight };
}

export function buildTerrainDerivedMaps(
  terrain: GpgpuMorphTerrainOptions,
  seed: number,
  size: number = TERRAIN_DERIVED_SIZE,
): TerrainDerivedMaps {
  const grid = buildTerrainHeightGrid(terrain, seed, size);
  return deriveMapsFromHeightGrid(grid.heights, grid.size, grid.step);
}

export function terrainDerivedMapBytes(maps: TerrainDerivedMaps, kind: TerrainDerivedMapKind): Uint8ClampedArray {
  return kind === 'normal' ? maps.normal : kind === 'slope' ? maps.slope : maps.curvature;
}

/** Luma grid of one derived map (row 0 = fz = -extent), for the
 *  raster-mask numeric bake the UI captures on assignment. */
export function terrainDerivedMapLuma(maps: TerrainDerivedMaps, kind: TerrainDerivedMapKind): Float32Array {
  const bytes = terrainDerivedMapBytes(maps, kind);
  const out = new Float32Array(maps.size * maps.size);
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * bytes[i * 4] + 0.7152 * bytes[i * 4 + 1] + 0.0722 * bytes[i * 4 + 2]) / 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config-side helpers

export function terrainOptionsFromConfig(config: ParticleConfig): GpgpuMorphTerrainOptions {
  return {
    amplitude: config.gpgpuMorphTerrainAmplitude,
    frequency: config.gpgpuMorphTerrainFrequency,
    octaves: config.gpgpuMorphTerrainOctaves,
    seed: config.gpgpuMorphTerrainSeed,
    kind: config.gpgpuMorphTerrainKind,
    terraceSteps: config.gpgpuMorphTerrainTerraceSteps,
  };
}

function derivedCacheKey(config: ParticleConfig): string {
  return [
    config.gpgpuMorphTerrainAmplitude,
    config.gpgpuMorphTerrainFrequency,
    config.gpgpuMorphTerrainOctaves,
    config.gpgpuMorphTerrainSeed,
    // Phase AI: the generation recipe reshapes every bake, so it
    // is part of the cache identity.
    config.gpgpuMorphTerrainKind,
    config.gpgpuMorphTerrainTerraceSteps,
    config.gpgpuSeed,
  ].join('|');
}

const mapsCache = new Map<string, TerrainDerivedMaps>();

export function getTerrainDerivedMaps(config: ParticleConfig): TerrainDerivedMaps {
  const key = derivedCacheKey(config);
  const existing = mapsCache.get(key);
  if (existing) return existing;
  const maps = buildTerrainDerivedMaps(terrainOptionsFromConfig(config), config.gpgpuSeed);
  mapsCache.clear();
  mapsCache.set(key, maps);
  return maps;
}

// ---------------------------------------------------------------------------
// THREE textures (cached; the cache holds one terrain generation
// at a time — a parameter change replaces it wholesale)

interface DerivedTextureEntry {
  key: string;
  maps: TerrainDerivedMaps;
  byKind: Map<TerrainDerivedMapKind, THREE.DataTexture>;
  gradientTex: THREE.DataTexture | null;
  colliderTex: THREE.DataTexture | null;
}

let textureEntry: DerivedTextureEntry | null = null;

function makeDerivedDataTexture(bytes: Uint8ClampedArray, size: number): THREE.DataTexture {
  const data = new Uint8Array(bytes.length);
  data.set(bytes);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The collider texture is the one NearestFilter bake: the packed
 * 16-bit height must reach the shader unfiltered, because the
 * manual bilinear in the sim shaders decodes each corner texel
 * before interpolating (hardware filtering interpolates the two
 * bytes independently and corrupts the value at low-byte wraps).
 */
function makeColliderDataTexture(bytes: Uint8ClampedArray, size: number): THREE.DataTexture {
  const data = new Uint8Array(bytes.length);
  data.set(bytes);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function getTextureEntry(config: ParticleConfig): DerivedTextureEntry {
  const key = derivedCacheKey(config);
  if (textureEntry && textureEntry.key === key) return textureEntry;
  if (textureEntry) {
    textureEntry.byKind.forEach((t) => t.dispose());
    textureEntry.gradientTex?.dispose();
    textureEntry.colliderTex?.dispose();
  }
  textureEntry = { key, maps: getTerrainDerivedMaps(config), byKind: new Map(), gradientTex: null, colliderTex: null };
  return textureEntry;
}

export function getTerrainDerivedTexture(kind: TerrainDerivedMapKind, config: ParticleConfig): MapImageTextureState {
  const entry = getTextureEntry(config);
  let tex = entry.byKind.get(kind);
  if (!tex) {
    tex = makeDerivedDataTexture(terrainDerivedMapBytes(entry.maps, kind), entry.maps.size);
    entry.byKind.set(kind, tex);
  }
  return { texture: tex, ready: true };
}

/**
 * The single resolution point for Layer Map / mask sources:
 * sentinel sources resolve to the live derived texture (which
 * tracks the terrain parameters), everything else delegates to
 * the Phase X image cache.
 */
export function resolveMapSourceTexture(source: string, config: ParticleConfig): MapImageTextureState {
  const kind = parseTerrainDerivedSource(source);
  if (kind) return getTerrainDerivedTexture(kind, config);
  // Phase AF supplies (text / path / edge sentinels) resolve in
  // lib/mapSourceSupply.ts; everything else is an image source.
  const af = resolveAfMapSourceTexture(source, config);
  if (af) return af;
  return getMapImageTexture(source);
}

/**
 * Slope force gate, resolved CPU-side like the Phase AB kill
 * mask: the force exists only while the terrain itself is live
 * (mesh enabled, plane mode — the tunnel wraps the field, so a
 * planar downhill direction is meaningless there).
 */
export function isSlopeForceActive(config: ParticleConfig): boolean {
  return !!config.gpgpuSlopeForceEnabled
    && !!config.gpgpuTerrainMeshEnabled
    && !config.gpgpuTerrainMeshTunnel;
}

export function getTerrainSlopeGradientTexture(config: ParticleConfig): THREE.Texture | null {
  if (!isSlopeForceActive(config)) return null;
  const entry = getTextureEntry(config);
  if (!entry.gradientTex) {
    entry.gradientTex = makeDerivedDataTexture(entry.maps.gradient, entry.maps.size);
  }
  return entry.gradientTex;
}

/** World-units multiplier of the terrain field (the mesh's own
 *  worldScale: normalized position × this = world position, and
 *  field height × this = world height). */
export function terrainMeshWorldScale(config: ParticleConfig): number {
  return Math.max(
    config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48 * config.gpgpuTerrainMeshScale,
    0,
  );
}

/** World half-extent of the terrain plane (mesh worldScale x E). */
export function terrainSlopeWorldExtent(config: ParticleConfig): number {
  return TERRAIN_MESH_EXTENT * terrainMeshWorldScale(config);
}

// ---------------------------------------------------------------------------
// Terrain collider (Phase AI)

/**
 * Collider gate, resolved CPU-side exactly like the slope force:
 * the height field only exists as a collider while the terrain
 * itself is live (mesh enabled, plane mode — the tunnel wraps the
 * field, so a planar height test is meaningless there).
 */
export function isTerrainColliderActive(config: ParticleConfig): boolean {
  return !!config.gpgpuTerrainColliderEnabled
    && !!config.gpgpuTerrainMeshEnabled
    && !config.gpgpuTerrainMeshTunnel;
}

export function getTerrainColliderTexture(config: ParticleConfig): THREE.Texture | null {
  if (!isTerrainColliderActive(config)) return null;
  const entry = getTextureEntry(config);
  if (!entry.colliderTex) {
    entry.colliderTex = makeColliderDataTexture(entry.maps.collider, entry.maps.size);
  }
  return entry.colliderTex;
}

/**
 * Decode scale for the packed collider height, in world units:
 * world height = (packed × 2 − 1) × maxAbsHeight × worldScale.
 * 0 for a flat field (every packed value is then the midpoint and
 * the decoded height is 0 regardless).
 */
export function terrainColliderHeightWorld(config: ParticleConfig): number {
  return getTerrainDerivedMaps(config).maxAbsHeight * terrainMeshWorldScale(config);
}

/** Decode scale for the packed collider gradient components:
 *  field gradient = (byte × 2 − 1) × maxGradient. The gradient is
 *  world-scale invariant (height and XZ share the world scale). */
export function terrainColliderGradientScale(config: ParticleConfig): number {
  return getTerrainDerivedMaps(config).maxGradient;
}

// ---------------------------------------------------------------------------
// Canvas / PNG (browser side; follows the terrainMesh canvas
// precedent — image rows are flipped so the map reads as a map,
// north = +Z up)

export function getTerrainDerivedMapCanvas(
  kind: TerrainDerivedMapKind,
  terrain: GpgpuMorphTerrainOptions,
  seed: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const maps = buildTerrainDerivedMaps(terrain, seed);
  const n = maps.size;
  const bytes = terrainDerivedMapBytes(maps, kind);
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(n, n);
  const rowBytes = n * 4;
  for (let y = 0; y < n; y++) {
    const srcRow = n - 1 - y; // canvas top = fz = +extent
    imageData.data.set(bytes.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes), y * rowBytes);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
