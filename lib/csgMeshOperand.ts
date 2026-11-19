/**
 * Phase CJ (CSG second release, U5): OBJ text -> CSG mesh
 * operand. The missing producer for the mesh operand
 * variant that Phase CC's pipe already carries
 * (CsgOperand { type: 'mesh' }, gate (a) in lib/csg.ts,
 * construction in lib/csgPrimitive.ts).
 *
 * Discipline (brief U5, commander ruling 2026-11-20
 * closing the M3 gap):
 * - RAW units: the OBJ coordinates are used exactly as
 *   written. No normalisation, no scale; the size keys
 *   do not apply to mesh operands. Placement is the
 *   per-operand offset only.
 * - The parser is the existing parseObjGeometry
 *   (lib/objMorph.ts) — no second OBJ parser.
 * - Vertices are welded at 1e-6 (the same quantisation
 *   gate (a) judges with) so the judged form and the
 *   constructed form agree. Welding only IDENTIFIES
 *   coincident vertices; it moves nothing and fills
 *   nothing — no repair. Open or self-intersecting
 *   input is still refused downstream by gate (a)
 *   with its reason.
 * - Normals / UV / material ids do not enter operands
 *   (CSG meshes are position-only, Phase CC M5).
 */
import type { CsgOperand } from './csgCore';
import { parseObjGeometry } from './objMorph';

const WELD_SCALE = 1e6;

export interface CsgMeshParse {
  /** Welded positions (before any offset). */
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export type CsgMeshOperandResult =
  | { ok: true; operand: CsgOperand; vertexCount: number; triangleCount: number }
  | { ok: false; reason: string };

/** Weld coincident vertices (1e-6 quantisation, the
 *  gate's own) and drop triangles that degenerate in
 *  the process. Pure identification: coordinates are
 *  copied from the first vertex of each weld class. */
export function weldMeshPositions(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): CsgMeshParse {
  const remap = new Map<string, number>();
  const outPos: number[] = [];
  const remapArr = new Uint32Array(Math.floor(positions.length / 3));
  for (let v = 0; v < remapArr.length; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const key =
      Math.round(x * WELD_SCALE) + ',' +
      Math.round(y * WELD_SCALE) + ',' +
      Math.round(z * WELD_SCALE);
    let idx = remap.get(key);
    if (idx === undefined) {
      idx = outPos.length / 3;
      remap.set(key, idx);
      outPos.push(x, y, z);
    }
    remapArr[v] = idx;
  }
  const outIdx: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = remapArr[indices[t]];
    const b = remapArr[indices[t + 1]];
    const c = remapArr[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    outIdx.push(a, b, c);
  }
  return {
    positions: new Float32Array(outPos),
    indices: new Uint32Array(outIdx),
    vertexCount: outPos.length / 3,
    triangleCount: outIdx.length / 3,
  };
}

/** Parse OBJ text into welded mesh data (no offset).
 *  Returns null when the text is not a usable OBJ. */
export function parseCsgMeshText(text: string): CsgMeshParse | null {
  const parsed = parseObjGeometry(text || '');
  if (!parsed || parsed.triangles.length === 0) return null;
  const welded = weldMeshPositions(parsed.vertices, parsed.triangles);
  if (welded.triangleCount === 0) return null;
  return welded;
}

/** Build a mesh operand from OBJ text + placement
 *  offset. Gate (a) itself runs in lib/csg.ts before
 *  transfer (and the worker re-checks construction),
 *  so a refusal there carries the gate's reason. */
export function buildMeshOperandFromObj(
  text: string,
  offset: readonly [number, number, number],
): CsgMeshOperandResult {
  const mesh = parseCsgMeshText(text);
  if (!mesh) {
    return {
      ok: false,
      reason: 'OBJとして読み取れませんでした。頂点（v）と面（f）を含むOBJテキストが必要です。',
    };
  }
  const [ox, oy, oz] = offset;
  let positions = mesh.positions;
  if (ox !== 0 || oy !== 0 || oz !== 0) {
    positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      positions[i] = mesh.positions[i] + ox;
      positions[i + 1] = mesh.positions[i + 1] + oy;
      positions[i + 2] = mesh.positions[i + 2] + oz;
    }
  }
  return {
    ok: true,
    operand: { type: 'mesh', positions, indices: mesh.indices },
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  };
}
