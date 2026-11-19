// Phase CK: CSG result export — the export side of the
// CSG feature set (final brief D3/D8/D14, G0 export
// remainder, checklist C1–C5).
//
// Formats, in the D3 order:
//   - GLB with EXT_mesh_manifold, metres / Y-up (the
//     app's own convention, no transform), written
//     through manifold-3d's own glTF helpers so the
//     manifold run data round-trips losslessly.
//   - 3MF for slicers, millimetres / Z-up. The
//     library's 3MF writer does NOT convert units or
//     axes (measured in the Phase CK spike: it writes
//     the glTF-convention coordinates verbatim under a
//     "millimeter" unit declaration, which a slicer
//     reads as 1/1000 scale and lying on its side —
//     exactly the failure D8 recorded). The D8
//     conversion is therefore applied explicitly here
//     as exportTransform / importTransform.
//   - STL (binary), compatibility only.
//
// Before anything is written, the mesh is checked to
// be a closed manifold (the same gate (a) judgement
// used for CSG inputs). The library's 3MF writer
// silently drops non-EXT meshes; this module refuses
// with the gate's reason instead (checklist C3).
//
// This module is loaded lazily (dynamic import from
// the CSG panel) so the glTF machinery stays out of
// the initial bundle until a user actually exports.

import { Document, WebIO } from '@gltf-transform/core';
import * as gltfIo from 'manifold-3d/lib/gltf-io.js';
import * as exp3mf from 'manifold-3d/lib/export-3mf.js';
import { checkWatertightGate } from './csgGate';
import type { CsgResultData } from './csgCore';

export type CsgExportFormat = 'glb' | '3mf' | 'stl';

/** D8 export transform: glTF/app space (metres, Y-up,
 * (x, y, z)) to 3MF space (millimetres, Z-up):
 * (x, -z, y) * 1000. The axis permutation is a proper
 * rotation (determinant +1), so triangle winding and
 * signed volume orientation are preserved; the signed
 * volume scales by exactly 1e9. */
export function exportTransformPositions(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] * 1000;
    out[i + 1] = -src[i + 2] * 1000;
    out[i + 2] = src[i + 1] * 1000;
  }
  return out;
}

/** D8 import transform: the exact inverse of
 * exportTransformPositions — 3MF space (millimetres,
 * Z-up) back to glTF/app space (metres, Y-up):
 * (x, z, -y) / 1000. */
export function importTransformPositions(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] / 1000;
    out[i + 1] = src[i + 2] / 1000;
    out[i + 2] = -src[i + 1] / 1000;
  }
  return out;
}

/** Checklist C3: refuse to export anything that is
 * not a closed manifold, with the gate's reason,
 * instead of letting a writer drop it silently.
 * Meshes above the gate's face cap report `skipped`;
 * a CSG result is a Manifold construction by origin,
 * so a skipped check is not a refusal. */
export function assertExportableMesh(positions: Float32Array, indices: Uint32Array): void {
  const gate = checkWatertightGate(positions, indices);
  if (!gate.ok && !gate.skipped) {
    throw new Error(`書き出せる閉じたメッシュではありません: ${gate.reason}`);
  }
}

/** The ManifoldMesh shape manifold-3d's glTF writer
 * consumes, built from a plain indexed result mesh:
 * a single run, position-only. The runtime shape is
 * what the Phase CK spike verified end-to-end; the
 * library's own Mesh type carries additional optional
 * channels this result does not have. */
function toManifoldMesh(positions: Float32Array, indices: Uint32Array) {
  return {
    numProp: 3,
    numVert: positions.length / 3,
    numTri: indices.length / 3,
    vertProperties: positions,
    triVerts: indices,
    runIndex: new Uint32Array([0, indices.length]),
    runOriginalID: new Uint32Array([1]),
    mergeFromVert: new Uint32Array(0),
    mergeToVert: new Uint32Array(0),
    faceID: new Uint32Array(0),
  };
}

function buildGltfDocument(positions: Float32Array, indices: Uint32Array): Document {
  const doc = new Document();
  gltfIo.setupIO(new WebIO());
  const material = doc.createMaterial('csg-result');
  const properties = new Map<number, gltfIo.Properties>();
  properties.set(1, { material, attributes: ['POSITION'] });
  const mesh = gltfIo.writeMesh(
    doc,
    toManifoldMesh(positions, indices) as unknown as Parameters<typeof gltfIo.writeMesh>[1],
    properties,
    true,
  );
  doc.createScene('scene').addChild(doc.createNode('csg-result').setMesh(mesh));
  return doc;
}

/** GLB with EXT_mesh_manifold, metres / Y-up. */
export async function exportCsgResultGlb(result: CsgResultData): Promise<ArrayBuffer> {
  assertExportableMesh(result.positions, result.indices);
  const doc = buildGltfDocument(result.positions, result.indices);
  return gltfIo.toArrayBuffer(doc);
}

/** 3MF, millimetres / Z-up (D8 transform applied). */
export async function exportCsgResult3mf(result: CsgResultData): Promise<ArrayBuffer> {
  assertExportableMesh(result.positions, result.indices);
  const transformed = exportTransformPositions(result.positions);
  const doc = buildGltfDocument(transformed, result.indices);
  return exp3mf.toArrayBuffer(doc, { header: { unit: 'millimeter' } });
}

/** Binary STL, app space (metres / Y-up), face
 * normals recomputed. Compatibility format only (D3). */
export function exportCsgResultStl(result: CsgResultData): ArrayBuffer {
  assertExportableMesh(result.positions, result.indices);
  const { positions, indices } = result;
  const triangles = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(offset, positions[v], true);
      view.setFloat32(offset + 4, positions[v + 1], true);
      view.setFloat32(offset + 8, positions[v + 2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}

export interface CsgExportOutput {
  bytes: ArrayBuffer;
  filename: string;
  mime: string;
}

export async function exportCsgResult(
  result: CsgResultData,
  format: CsgExportFormat,
): Promise<CsgExportOutput> {
  if (format === 'glb') {
    return {
      bytes: await exportCsgResultGlb(result),
      filename: 'monosphere-csg-result.glb',
      mime: 'model/gltf-binary',
    };
  }
  if (format === '3mf') {
    return {
      bytes: await exportCsgResult3mf(result),
      filename: 'monosphere-csg-result.3mf',
      mime: 'model/3mf',
    };
  }
  return {
    bytes: exportCsgResultStl(result),
    filename: 'monosphere-csg-result.stl',
    mime: 'application/octet-stream',
  };
}
