/**
 * Terrain mesh geometry for the Phase P Mir-style mesh system.
 *
 * The Phase L 'terrain' morph target samples the seeded fBm height
 * field (terrainHeightAt in lib/gpgpuMorphTargets.ts) as POINTS.
 * This module builds the polygon counterpart: a regular grid over
 * the same normalized domain ([-1.05, 1.05]^2, the bake's extent),
 * displaced by the same field with the same field-seed mixing
 * (terrainFieldSeedFor), so for one config the mesh landscape and
 * the point landscape are the same landscape — ridges line up.
 *
 * Two shapes are produced from the one grid:
 *  - plane: x/z are the field domain, y is the height (world-scaled
 *    exactly like the bake: normalized * worldScale).
 *  - tunnel: the grid wraps a cylinder — grid x becomes the
 *    circumference, grid z the tunnel depth, height becomes radial
 *    relief pointing inward. On both wrapped axes the field is
 *    cross-fade tiled over one period (the standard tileable-fBm
 *    blend), so the circumference closes seamlessly and the depth
 *    repeats every length, which is what makes the tunnel read as
 *    endless from inside. There is no scrolling: the repetition is
 *    spatial, inside a single static length.
 *
 * Everything here is a pure function of its inputs (no RNG state),
 * so the deterministic renderer reproduces the mesh frame-for-frame.
 * Normals are NOT computed here: the component calls
 * BufferGeometry.computeVertexNormals() on the indexed geometry,
 * which is deterministic for a fixed index order.
 */

import {
  terrainFieldSeedFor,
  terrainHeightAt,
  type GpgpuMorphTerrainOptions,
} from './gpgpuMorphTargets';

/** Normalized half-extent of the terrain domain — the same 1.05 the
 *  morph bake tiles its grid over (lib/gpgpuMorphTargets.ts). */
export const TERRAIN_MESH_EXTENT = 1.05;

/** Grid resolution (segments per axis). 128x128 = 16,384 quads /
 *  32,768 triangles, comfortably 60fps on the gate GPU while the
 *  fBm detail (<= 6 octaves over this domain) stays resolved. */
export const TERRAIN_MESH_RESOLUTION = 128;

export interface TerrainMeshBuildOptions {
  /** Terrain field parameters (shared gpgpuMorphTerrain* keys). */
  terrain: GpgpuMorphTerrainOptions;
  /** Bake seed (config gpgpuSeed); mixed exactly like the bake. */
  seed: number;
  /** World-units multiplier (gpgpuMorphScale * gpgpuBounceRadius *
   *  0.48 * gpgpuTerrainMeshScale) — the bake's worldScale formula. */
  worldScale: number;
  /** Wrap the grid into a tunnel (cylinder interior). */
  tunnel: boolean;
  /** Segments per axis; defaults to TERRAIN_MESH_RESOLUTION. */
  resolution?: number;
}

export interface TerrainMeshGeometryData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/**
 * Cross-fade tiled height: blend the field with a one-period-shifted
 * copy so h(-E) == h(+E) along the wrapped axis. `axis` selects
 * which coordinate is wrapped; the other passes through.
 */
function tiledHeightAt(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
  wrapX: boolean,
  wrapZ: boolean,
): number {
  const period = TERRAIN_MESH_EXTENT * 2;
  if (!wrapX && !wrapZ) return terrainHeightAt(x, z, terrain, fieldSeed);
  // Bilinear blend of the period-shifted copies: at each wrapped
  // edge the blend lands entirely on the shifted copy, which is
  // the opposite edge's field, so both joins close exactly.
  const tx = wrapX ? (x + TERRAIN_MESH_EXTENT) / period : 0;
  const tz = wrapZ ? (z + TERRAIN_MESH_EXTENT) / period : 0;
  const sx = wrapX ? period : 0;
  const sz = wrapZ ? period : 0;
  const h00 = terrainHeightAt(x, z, terrain, fieldSeed);
  const h10 = terrainHeightAt(x - sx, z, terrain, fieldSeed);
  const h01 = terrainHeightAt(x, z - sz, terrain, fieldSeed);
  const h11 = terrainHeightAt(x - sx, z - sz, terrain, fieldSeed);
  const top = h00 * (1 - tx) + h10 * tx;
  const bottom = h01 * (1 - tx) + h11 * tx;
  return top * (1 - tz) + bottom * tz;
}

export function buildTerrainMeshGeometryData(
  options: TerrainMeshBuildOptions,
): TerrainMeshGeometryData {
  const { terrain, seed, worldScale, tunnel } = options;
  const res = Math.max(8, Math.min(256, Math.floor(options.resolution ?? TERRAIN_MESH_RESOLUTION)));
  const fieldSeed = terrainFieldSeedFor(seed, terrain.seed);
  const extent = TERRAIN_MESH_EXTENT;
  const vertsPerAxis = res + 1;
  const vertexCount = vertsPerAxis * vertsPerAxis;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(res * res * 6);

  // Tunnel radius: half the plane's world width, so the tunnel's
  // circumference (~2*pi*R) roughly matches the wrapped field width
  // and the relief scale stays comparable to the plane mode.
  const tunnelRadius = extent * worldScale;
  const tunnelLength = extent * 2 * worldScale;

  for (let j = 0; j < vertsPerAxis; j++) {
    const v = j / res;
    const fz = -extent + v * extent * 2;
    for (let i = 0; i < vertsPerAxis; i++) {
      const u = i / res;
      const fx = -extent + u * extent * 2;
      const idx = j * vertsPerAxis + i;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
      if (!tunnel) {
        const h = terrainHeightAt(fx, fz, terrain, fieldSeed);
        positions[idx * 3] = fx * worldScale;
        positions[idx * 3 + 1] = h * worldScale;
        positions[idx * 3 + 2] = fz * worldScale;
      } else {
        // Wrap x around the circumference and tile z along the
        // depth so both joins are seamless.
        const h = tiledHeightAt(fx, fz, terrain, fieldSeed, true, true);
        const theta = u * Math.PI * 2;
        const r = tunnelRadius - h * worldScale;
        positions[idx * 3] = Math.cos(theta) * r;
        positions[idx * 3 + 1] = Math.sin(theta) * r;
        positions[idx * 3 + 2] = -tunnelLength / 2 + v * tunnelLength;
      }
    }
  }

  let o = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * vertsPerAxis + i;
      const b = a + 1;
      const c = a + vertsPerAxis;
      const d = c + 1;
      // Plane: CCW seen from +Y (front up). Tunnel: the same winding
      // faces outward; the material is DoubleSide so the interior
      // (the viewed side) renders and three.js flips its normals.
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }

  return {
    positions,
    uvs,
    indices,
    vertexCount,
    triangleCount: res * res * 2,
  };
}

/**
 * Terrain texture UV transform (Phase V): the standard map
 * transform uv' = uv * repeat + offset, applied by three.js from
 * the texture's repeat / offset fields. This pure form exists so
 * the semantics are unit-testable and documented in one place; the
 * defaults (repeat 1, offsets 0) are the identity, which is what
 * keeps pre-Phase-V renders bit-identical.
 */
export function terrainTextureUvTransform(
  u: number,
  v: number,
  repeat: number,
  offsetX: number,
  offsetY: number,
): [number, number] {
  return [u * repeat + offsetX, v * repeat + offsetY];
}

/**
 * Tunnel scroll offset (Phase V): how far the tunnel terrain has
 * travelled toward the viewer after `timeSeconds` of scene time at
 * `speed` world units per second, folded into [0, tunnelLength).
 * The tunnel field is periodic over exactly one tunnel length
 * (the cross-fade tiling in buildTerrainMeshGeometryData), so the
 * fold is invisible — the wrap lands on identical geometry. The
 * offset is a pure function of accumulated scene time: during a
 * deterministic render the stepped clock makes it a function of
 * the frame index, and speed 0 yields exactly 0 (the legacy static
 * tunnel) for every t.
 */
export function tunnelScrollOffset(timeSeconds: number, speed: number, tunnelLength: number): number {
  if (!(tunnelLength > 0) || !Number.isFinite(timeSeconds) || !Number.isFinite(speed)) return 0;
  const raw = timeSeconds * speed;
  const folded = raw % tunnelLength;
  return folded < 0 ? folded + tunnelLength : folded;
}

// ---------------------------------------------------------------------------
// Procedural surface textures (monochrome, canvas-baked, cached)

export type TerrainMeshProceduralTextureKind = 'gradient' | 'grid';

const TEXTURE_SIZE = 512;
const textureCache = new Map<string, HTMLCanvasElement>();

/**
 * Bake a monochrome canvas texture for the mesh surface. 'gradient'
 * is a soft vertical ramp with faint contour bands (reads as strata
 * over the relief); 'grid' is a survey grid (fine lines + stronger
 * major lines) on a mid-grey ground. Both are pure greys — the mesh
 * colour discipline is monochrome-first.
 */
export function getTerrainMeshProceduralCanvas(
  kind: TerrainMeshProceduralTextureKind,
): HTMLCanvasElement {
  const cached = textureCache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (kind === 'gradient') {
      const grad = ctx.createLinearGradient(0, TEXTURE_SIZE, 0, 0);
      grad.addColorStop(0, '#3a3f46');
      grad.addColorStop(0.5, '#8b939c');
      grad.addColorStop(1, '#e8ebee');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      // Faint contour bands so the mapping is visible on slopes.
      ctx.fillStyle = 'rgba(20,22,26,0.20)';
      for (let y = 0; y < TEXTURE_SIZE; y += 32) ctx.fillRect(0, y, TEXTURE_SIZE, 2);
    } else {
      ctx.fillStyle = '#6d747c';
      ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      ctx.strokeStyle = 'rgba(230,234,238,0.35)';
      ctx.lineWidth = 1;
      for (let p = 0; p <= TEXTURE_SIZE; p += 32) {
        ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, TEXTURE_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(TEXTURE_SIZE, p + 0.5); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(240,243,246,0.8)';
      ctx.lineWidth = 2;
      for (let p = 0; p <= TEXTURE_SIZE; p += 128) {
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, TEXTURE_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(TEXTURE_SIZE, p); ctx.stroke();
      }
    }
  }
  textureCache.set(kind, canvas);
  return canvas;
}
