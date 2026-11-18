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

export type ObjMeshRepeatMode = 'grid' | 'radial';

export interface ObjMeshCopyTransform {
  /** Offset in normalised units (flat xyz in `offset`). */
  offset: [number, number, number];
  /** Extra Y rotation for this copy, degrees. */
  rotYDeg: number;
  /** Scale multiplier for this copy. */
  scale: number;
}

/**
 * Per-copy transforms for the repetition grammar (Phase AA3): the
 * Phase V centred cube grid gains the replica-style chain — copy i
 * rotates by rotationDeg * i and scales by scaleStep^i — and a
 * 'radial' layout that places the copies on a circle of radius
 * OBJ_MESH_REPEAT_SPACING, each rotated to face outward plus its
 * chain rotation. With mode 'grid', rotation 0 and scaleStep 1 the
 * result is exactly the Phase V layout (offsets identical, no
 * rotation, unit scale).
 */
export function objMeshRepeatTransforms(
  repeat: number,
  mode: ObjMeshRepeatMode,
  rotationDeg: number,
  scaleStep: number,
): ObjMeshCopyTransform[] {
  const n = clampObjMeshRepeat(repeat);
  const rot = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  const step = Number.isFinite(scaleStep) && scaleStep > 0 ? scaleStep : 1;
  const out: ObjMeshCopyTransform[] = [];
  if (mode === 'radial') {
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (i * Math.PI * 2) / n;
      out.push({
        offset: n === 1
          ? [0, 0, 0]
          : [Math.cos(a) * OBJ_MESH_REPEAT_SPACING, 0, Math.sin(a) * OBJ_MESH_REPEAT_SPACING],
        rotYDeg: (n === 1 ? 0 : (-a * 180) / Math.PI) + rot * i,
        scale: Math.pow(step, i),
      });
    }
    return out;
  }
  const offsets = objMeshRepeatOffsets(n);
  for (let i = 0; i < n; i++) {
    out.push({
      offset: [offsets[i * 3], offsets[i * 3 + 1], offsets[i * 3 + 2]],
      rotYDeg: rot * i,
      scale: Math.pow(step, i),
    });
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

/* ------------------------------------------------------------------ */
/* Particle geometry mode 'obj' (Phase AO)                             */

/**
 * Triangle budget for the 'obj' particle geometry mode. The shared
 * OBJ parser has no size limits of its own (the morph sampler and
 * the mesh display subsample / draw once), but the geometry mode
 * replicates the base geometry per particle instance, so an
 * unbounded source would multiply straight into the vertex cost.
 * Over-budget sources fall back to the octahedron base — the UI
 * states the fallback instead of switching silently.
 */
export const OBJ_GEOM_TRIANGLE_BUDGET = 4096;

/**
 * Base radius of the 'obj' particle geometry: the built-in shapes
 * sit in the 0.6..0.82 class (octahedron 0.7), and the OBJ data is
 * normalised to bounding-sphere radius 1, so it is scaled by this
 * factor to land in the same class.
 */
export const OBJ_GEOM_RADIUS = 0.7;

export type ObjGeomSourceState = 'empty' | 'invalid' | 'over-budget' | 'ok';

/** Light source classification for the UI note (parse only). */
export function describeObjGeomSource(objText: string): { state: ObjGeomSourceState; triangleCount: number } {
  if (!objText || objText.trim().length === 0) return { state: 'empty', triangleCount: 0 };
  const geometry = parseObjGeometry(objText);
  if (!geometry) return { state: 'invalid', triangleCount: 0 };
  return {
    state: geometry.triangleCount > OBJ_GEOM_TRIANGLE_BUDGET ? 'over-budget' : 'ok',
    triangleCount: geometry.triangleCount,
  };
}

export interface ObjGeomBaseData {
  /** Positions scaled to OBJ_GEOM_RADIUS, flat xyz triples. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

/**
 * Base geometry data for the 'obj' particle geometry mode: the
 * shared mesh geometry data (same normalisation as the morph
 * sampler) scaled into the built-in shapes' radius class. Returns
 * null when the source is empty, unparseable or over the triangle
 * budget — the caller falls back to the octahedron base and the UI
 * note (describeObjGeomSource) states which case it is.
 */
export function buildObjGeomBaseData(objText: string): ObjGeomBaseData | null {
  if (!objText || objText.trim().length === 0) return null;
  const data = buildObjMeshGeometryData(objText);
  if (!data) return null;
  if (data.triangleCount > OBJ_GEOM_TRIANGLE_BUDGET) return null;
  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i++) positions[i] = data.positions[i] * OBJ_GEOM_RADIUS;
  return { positions, normals: data.normals, indices: data.indices, triangleCount: data.triangleCount };
}
