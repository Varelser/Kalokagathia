/**
 * OBJ mesh geometry for the Phase V Mir-style mesh side of the OBJ
 * import.
 *
 * The morph system (Phase J/O) reads the imported OBJ document
 * (config gpgpuMorphObjSource) as a point cloud. This module gives
 * the same document its polygon face: it parses the source with the
 * shared parser (lib/objMorph.ts parseObjGeometry — the mesh side
 * never keeps a second copy of the data) and builds render-ready
 * geometry data, normalised EXACTLY like the morph sampler
 * (centred on the bounding-box centre, scaled so the bounding
 * sphere radius is 1), so a mesh and the point cloud sampled from
 * the same source coincide in morph space.
 *
 * Repetition: copies are arranged on a centred cube grid. The grid
 * side is ceil(cbrt(repeat)) and copies are taken in x-fastest
 * order, so repeat 1 is a single copy at the origin, 2..8 fill a
 * 2x2x2 block progressively, 9..27 a 3x3x3 block, and so on up to
 * the 64 cap. The spacing is in normalised units: the mesh's
 * bounding sphere has diameter 2, so 2.15 leaves a small gap
 * between neighbouring copies' bounding spheres. This grammar is
 * deliberately independent of the morph replica grammar (Phase K):
 * the replicas split one baked cloud inside the simulation, while
 * these copies are separate scene meshes of the source geometry.
 *
 * Everything here is a pure function of its inputs (no RNG, no
 * clock), so deterministic renders reproduce the mesh exactly.
 */

import { parseObjGeometry } from './objMorph';

export interface ObjMeshGeometryData {
  /** Normalised vertex positions, flat xyz triples. */
  positions: Float32Array;
  /** Per-vertex normals (from the shared parser), flat xyz. */
  normals: Float32Array;
  /** Triangle indices into the vertex arrays. */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Repetition cap: a 4x4x4 grid at most (64 draw copies). */
export const OBJ_MESH_MAX_REPEAT = 64;

/** Grid spacing in normalised units (bounding-sphere diameter 2
 *  plus a small gap). */
export const OBJ_MESH_REPEAT_SPACING = 2.15;

/**
 * Build render geometry from an OBJ document: the shared parser's
 * vertices / triangles / normals, normalised with the same
 * centre + bounding-sphere formula the morph sampler applies in
 * lib/objMorph.ts (kept in step deliberately — the two must agree
 * so mesh and cloud coincide). Returns null when the document has
 * no usable geometry (the component then draws nothing and the UI
 * states why).
 */
export function buildObjMeshGeometryData(objText: string): ObjMeshGeometryData | null {
  const geometry = parseObjGeometry(objText);
  if (!geometry) return null;
  const { vertices, triangles, vertexNormals, vertexCount, triangleCount } = geometry;

  // Bounding box centre + bounding-sphere radius (the sampler's
  // normalisation in lib/objMorph.ts, same formula).
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    const d = Math.hypot(vertices[i] - cx, vertices[i + 1] - cy, vertices[i + 2] - cz);
    if (d > radius) radius = d;
  }
  if (!(radius > 0)) return null;
  const invRadius = 1 / radius;

  const positions = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    positions[i] = (vertices[i] - cx) * invRadius;
    positions[i + 1] = (vertices[i + 1] - cy) * invRadius;
    positions[i + 2] = (vertices[i + 2] - cz) * invRadius;
  }
  return {
    positions,
    normals: vertexNormals,
    indices: triangles,
    vertexCount,
    triangleCount,
  };
}

/** Clamp a configured repeat count into [1, OBJ_MESH_MAX_REPEAT]. */
export function clampObjMeshRepeat(repeat: number): number {
  if (!Number.isFinite(repeat)) return 1;
  return Math.max(1, Math.min(OBJ_MESH_MAX_REPEAT, Math.round(repeat)));
}

/**
 * Copy offsets for the repetition grid, in normalised units (flat
 * xyz triples, `clampObjMeshRepeat(repeat)` entries). The grid is
 * centred on the origin, so a fully filled cube's offsets sum to
 * zero on every axis.
 */
export function objMeshRepeatOffsets(repeat: number): Float32Array {
  const n = clampObjMeshRepeat(repeat);
  const side = Math.ceil(Math.cbrt(n));
  const out = new Float32Array(n * 3);
  let o = 0;
  for (let iz = 0; iz < side && o < n * 3; iz++) {
    for (let iy = 0; iy < side && o < n * 3; iy++) {
      for (let ix = 0; ix < side && o < n * 3; ix++) {
        out[o] = (ix - (side - 1) / 2) * OBJ_MESH_REPEAT_SPACING;
        out[o + 1] = (iy - (side - 1) / 2) * OBJ_MESH_REPEAT_SPACING;
        out[o + 2] = (iz - (side - 1) / 2) * OBJ_MESH_REPEAT_SPACING;
        o += 3;
      }
    }
  }
  return out;
}

/**
 * World scale of one OBJ mesh copy: the morph bake's world scale
 * (gpgpuMorphScale * gpgpuBounceRadius * 0.48 — the same formula
 * the terrain mesh uses) times the mesh's own scale key, so at
 * scale 1 the mesh spans exactly the morph point cloud's world
 * footprint.
 */
export function objMeshWorldScale(morphScale: number, bounceRadius: number, meshScale: number): number {
  return morphScale * bounceRadius * 0.48 * meshScale;
}
