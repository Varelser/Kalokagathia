/**
 * Phase CW (CSG U6): STL / glTF file -> CSG mesh operand
 * text. Imports are normalised at the border: the file is
 * parsed by the three-stdlib loaders, welded with the same
 * 1e-6 quantisation as the OBJ path, and serialised into
 * the existing OBJ text key (gpgpuCsgMeshObjText). Every
 * downstream step — parse, gate (a), worker construction —
 * is the proven U5 pipe (lib/csgMeshOperand.ts); there is
 * no second mesh path.
 *
 * Discipline (commander rulings on the Phase CT
 * conditions, 2026-11-20):
 * - RAW units (M3): coordinates are used exactly as the
 *   file carries them. No normalisation, no scale; the
 *   size keys do not apply to mesh operands.
 * - glTF node transforms are BAKED into the positions at
 *   load (the baked coordinates are then the raw units).
 *   Only the FIRST mesh of the scene is taken.
 * - EXT_mesh_manifold is not interpreted: a glTF is read
 *   as an ordinary mesh. 3MF is out of scope.
 * - No repair: welding only identifies coincident
 *   vertices. Open or self-intersecting input is refused
 *   downstream by gate (a) with its reason.
 * - Normals / UV / materials do not enter operands
 *   (CSG meshes are position-only, Phase CC M5).
 */
import { GLTFLoader, STLLoader } from 'three-stdlib';
import type { BufferGeometry } from 'three';
import { weldMeshPositions, type CsgMeshParse } from './csgMeshOperand';

/** Import file size ceiling (bytes). */
export const MESH_IMPORT_MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Welded triangle ceiling for an imported mesh. The OBJ
 *  text form grows with the triangle count, and the text
 *  lives in the config (presets / share links), so the
 *  ceiling keeps an import storable. */
export const MESH_IMPORT_MAX_TRIANGLES = 60_000;
/** Character ceiling for the mesh OBJ text key. Raised
 *  from the U5-era 200,000 so welded imports fit; the
 *  textarea and both file paths share it. */
export const MESH_OBJ_TEXT_MAX_CHARS = 4_000_000;

export type CsgMeshImportResult =
  | {
      ok: true;
      objText: string;
      format: 'stl' | 'gltf';
      /** Welded counts (what the panel will report). */
      vertexCount: number;
      triangleCount: number;
    }
  | { ok: false; reason: string };

/** Serialise a welded mesh as OBJ text. Numbers use the
 *  shortest round-trip form (String(v)) so the reparsed
 *  values are bit-identical doubles and the second weld
 *  in parseCsgMeshText sees exactly the same classes. */
export function serializeMeshToObjText(mesh: CsgMeshParse): string {
  const parts: string[] = [];
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    parts.push('v ' + String(p[i]) + ' ' + String(p[i + 1]) + ' ' + String(p[i + 2]));
  }
  const idx = mesh.indices;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    parts.push('f ' + (idx[t] + 1) + ' ' + (idx[t + 1] + 1) + ' ' + (idx[t + 2] + 1));
  }
  return parts.join('\n') + '\n';
}

function geometryToRawMesh(geometry: BufferGeometry): { positions: Float32Array; indices: Uint32Array } | null {
  const pos = geometry.getAttribute('position');
  if (!pos) return null;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const index = geometry.getIndex();
  let indices: Uint32Array;
  if (index) {
    indices = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  } else {
    indices = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) indices[i] = i;
  }
  return { positions, indices };
}

function finishImport(
  raw: { positions: Float32Array; indices: Uint32Array } | null,
  format: 'stl' | 'gltf',
): CsgMeshImportResult {
  if (!raw || raw.indices.length === 0) {
    return { ok: false, reason: 'メッシュの面が読み取れませんでした。' };
  }
  const welded = weldMeshPositions(raw.positions, raw.indices);
  if (welded.triangleCount === 0) {
    return { ok: false, reason: '有効な三角形がありませんでした（頂点の重なりで全ての面が潰れました）。' };
  }
  if (welded.triangleCount > MESH_IMPORT_MAX_TRIANGLES) {
    return {
      ok: false,
      reason:
        '三角形が多すぎます（' + welded.triangleCount.toLocaleString() + ' 件、上限 ' +
        MESH_IMPORT_MAX_TRIANGLES.toLocaleString() + ' 件）。 OBJテキストとして保存できる大きさに限るため、面を減らしたファイルで読み込んでください。',
    };
  }
  const objText = serializeMeshToObjText(welded);
  if (objText.length > MESH_OBJ_TEXT_MAX_CHARS) {
    return { ok: false, reason: '変換後のテキストが上限（' + MESH_OBJ_TEXT_MAX_CHARS.toLocaleString() + ' 文字）を超えました。面を減らしたファイルで読み込んでください。' };
  }
  return { ok: true, objText, format, vertexCount: welded.vertexCount, triangleCount: welded.triangleCount };
}

/** STL (binary or ASCII) -> OBJ text via STLLoader. */
export function importStlBuffer(buffer: ArrayBuffer): CsgMeshImportResult {
  let geometry: BufferGeometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    return { ok: false, reason: 'STLとして読み取れませんでした。' };
  }
  return finishImport(geometryToRawMesh(geometry), 'stl');
}

/** glTF / GLB -> OBJ text via GLTFLoader. Node transforms
 *  are baked; only the first mesh in scene order is used.
 *  A .gltf that references external .bin / texture files
 *  cannot be resolved from a single picked file and is
 *  refused with guidance toward .glb. */
export async function importGltfBuffer(buffer: ArrayBuffer, isTextGltf: boolean): Promise<CsgMeshImportResult> {
  let gltf;
  try {
    gltf = await new GLTFLoader().parseAsync(buffer, '');
  } catch {
    return {
      ok: false,
      reason: isTextGltf
        ? 'glTFとして読み取れませんでした。外部の .bin や画像を参照する .gltf は、単一ファイルでは読み込めません。.glb 形式（1ファイルに埋め込み済み）で読み込んでください。'
        : 'glTFとして読み取れませんでした。',
    };
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let firstMesh: import('three').Mesh | null = null;
  scene.traverse((obj) => {
    if (firstMesh) return;
    const mesh = obj as import('three').Mesh;
    if (mesh.isMesh) firstMesh = mesh;
  });
  if (!firstMesh) {
    return { ok: false, reason: 'glTFの中にメッシュが見つかりませんでした。' };
  }
  const mesh: import('three').Mesh = firstMesh;
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  return finishImport(geometryToRawMesh(geometry), 'gltf');
}

/** Dispatch by file extension. The caller supplies the
 *  file's bytes; nothing is fetched. */
export async function importMeshFileToObjText(fileName: string, buffer: ArrayBuffer): Promise<CsgMeshImportResult> {
  if (buffer.byteLength > MESH_IMPORT_MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: 'ファイルが大きすぎます（上限 ' + Math.floor(MESH_IMPORT_MAX_FILE_BYTES / (1024 * 1024)) + ' MB）。',
    };
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.stl')) return importStlBuffer(buffer);
  if (lower.endsWith('.glb')) return importGltfBuffer(buffer, false);
  if (lower.endsWith('.gltf')) return importGltfBuffer(buffer, true);
  return { ok: false, reason: '対応していないファイル形式です（.stl / .glb / .gltf のいずれかで読み込んでください）。' };
}
