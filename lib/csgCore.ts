// Phase CC: shared CSG vocabulary — primitive specs, operation
// kinds, mesh data, error codes, and the small pure helpers the
// client, the worker and the tests all share (final CSG brief,
// #5: 第1弾 = primitives + union / difference / intersection
// through a worker, result into the morph path).
//
// Nothing here imports manifold-3d or three: specs and mesh data
// are plain typed arrays so they cross the worker boundary and
// run under the plain-node test loader unchanged.

import type { CsgGateReport } from './csgGate';

export type CsgPrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus';
export type CsgOperationKind = 'union' | 'difference' | 'intersection';

/** Post-processing applied to a boolean result inside the
 *  worker (Phase CG, brief unit U3). Hull is a FINISH, not
 *  an operand (brief decision D12): it replaces the result
 *  with its convex hull, bridging disjoint components into
 *  one genus-0 solid. 'none' keeps the boolean result as
 *  is and keeps the pre-CG cache key byte-identical. */
export type CsgFinishKind = 'none' | 'hull' | 'refine';
export const CSG_FINISH_KINDS: readonly CsgFinishKind[] = ['none', 'hull', 'refine'];
export function isCsgFinishKind(v: unknown): v is CsgFinishKind {
  return v === 'none' || v === 'hull' || v === 'refine';
}

/** Phase CH (U4 revised): plain subdivision count for the refine
 *  finish. refine() splits every edge into n pieces (n^2 triangles
 *  per face) with NO surface movement, so volume and topology are
 *  preserved exactly. Tangent-based smoothing (Manifold.smooth /
 *  smoothOut + refine) is NOT shipped: measured on manifold-3d
 *  3.5.4, smooth+refine(2) inflates a cube 8.0 -> 16.68 and the
 *  crease-sharpened variant's output fails the watertight
 *  re-check with hundreds of unshared edges (see PHASE_CH_REPORT).
 *  Revisit smoothing together with the 3.5.5 decision (D15). */
export const CSG_REFINE_DIVISIONS_MIN = 2;
export const CSG_REFINE_DIVISIONS_MAX = 3;
export function clampCsgRefineDivisions(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 2;
  return Math.min(CSG_REFINE_DIVISIONS_MAX, Math.max(CSG_REFINE_DIVISIONS_MIN, n));
}

/** Phase CF (CSG second release, U1): extrusion profiles. The
 *  profile is generated deterministically from the spec, so a
 *  spec fully identifies the operand (cache keys, panel state).
 *  Free-form point input is U2's open question; the raw-polygon
 *  entry point lives in lib/csgExtrude.ts. */
export type CsgExtrudeProfileKind = 'square' | 'circle' | 'polygon';
export const CSG_EXTRUDE_PROFILE_KINDS: readonly CsgExtrudeProfileKind[] = [
  'square', 'circle', 'polygon',
];

export interface CsgExtrudeSpec {
  profile: CsgExtrudeProfileKind;
  /** Square edge / circle diameter / polygon circumdiameter. */
  size: number;
  /** Circle segments / polygon sides (square ignores it). */
  segments: number;
  /** Extrusion height (the solid is centred on z afterwards). */
  height: number;
  /** Twist interpolation divisions (nDivisions). */
  divisions: number;
  /** Twist over the height, degrees. Twist changes the volume
   *  and the change depends on `divisions` (library behaviour,
   *  measured in the round-11 API spike) — it is not an error. */
  twistDegrees: number;
  /** Uniform top scale. The builder converts this to a Vec2
   *  pair before calling the library: passing the bare number
   *  to Manifold.extrude silently rescales (1 -> x0.5 volume),
   *  the trap measured in the final brief. Never pass it raw. */
  scaleTop: number;
  /** World offset applied after construction. */
  offset: readonly [number, number, number];
}

export const CSG_PRIMITIVE_KINDS: readonly CsgPrimitiveKind[] = [
  'cube', 'sphere', 'cylinder', 'cone', 'torus',
];
export const CSG_OPERATION_KINDS: readonly CsgOperationKind[] = [
  'union', 'difference', 'intersection',
];

export interface CsgPrimitiveSpec {
  kind: CsgPrimitiveKind;
  /** Base size: cube edge / sphere diameter / cylinder height /
   *  cone height / torus outer diameter scale (see csgWorker). */
  size: number;
  /** Circular segments for sphere / cylinder / cone / torus. */
  segments: number;
  /** World offset applied after construction. */
  offset: readonly [number, number, number];
}

export type CsgOperand =
  | { type: 'primitive'; spec: CsgPrimitiveSpec }
  | { type: 'extrude'; spec: CsgExtrudeSpec }
  | { type: 'mesh'; positions: Float32Array; indices: Uint32Array | null };

export interface CsgMeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CsgResultData extends CsgMeshData {
  volume: number;
  triangles: number;
  /** Output re-check (gate (c)) performed inside the worker. */
  gate: CsgGateReport;
}

/** Typed error codes crossing the worker boundary (brief §フェーズ3).
 *  EMPTY_RESULT is a normal outcome (e.g. A − A), not a failure. */
export type CsgErrorCode =
  | 'NOT_MANIFOLD'
  | 'EMPTY_RESULT'
  | 'WASM_LOAD_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export class CsgError extends Error {
  code: CsgErrorCode;
  constructor(code: CsgErrorCode, message: string) {
    super(message);
    this.name = 'CsgError';
    this.code = code;
  }
}

export const CSG_TIMEOUT_MS = 5000;

export function isCsgPrimitiveKind(v: unknown): v is CsgPrimitiveKind {
  return typeof v === 'string' && (CSG_PRIMITIVE_KINDS as readonly string[]).includes(v);
}
export function isCsgExtrudeProfileKind(v: unknown): v is CsgExtrudeProfileKind {
  return typeof v === 'string' && (CSG_EXTRUDE_PROFILE_KINDS as readonly string[]).includes(v);
}
export function isCsgOperationKind(v: unknown): v is CsgOperationKind {
  return typeof v === 'string' && (CSG_OPERATION_KINDS as readonly string[]).includes(v);
}

/** Signed volume of a triangle mesh by the divergence theorem.
 *  Used as an independent cross-check of the worker's reported
 *  volume in tests, and for display when a result is re-measured
 *  on the main thread. */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number> | null): number {
  let volume = 0;
  const faceCount = indices ? indices.length / 3 : positions.length / 9;
  for (let f = 0; f < faceCount; f++) {
    const ia = (indices ? indices[f * 3] : f * 3) * 3;
    const ib = (indices ? indices[f * 3 + 1] : f * 3 + 1) * 3;
    const ic = (indices ? indices[f * 3 + 2] : f * 3 + 2) * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** Indexed OBJ text for the morph path. Indexed on purpose: the
 *  CSG / SDF coexistence check (#3, round 9) requires the indexed
 *  form so the morph sampler's vertex normals stay smooth (a
 *  non-indexed dump would facet them), and the same source text
 *  feeds the OBJ mesh renderer and the mesh-SDF bake. */
export function buildIndexedObjText(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  name: string,
): string {
  const lines: string[] = [`# Kalokagathia CSG result`, `o ${name}`];
  const vCount = Math.floor(positions.length / 3);
  for (let i = 0; i < vCount; i++) {
    lines.push(
      `v ${positions[i * 3].toFixed(6)} ${positions[i * 3 + 1].toFixed(6)} ${positions[i * 3 + 2].toFixed(6)}`,
    );
  }
  for (let f = 0; f + 2 < indices.length; f += 3) {
    lines.push(`f ${indices[f] + 1} ${indices[f + 1] + 1} ${indices[f + 2] + 1}`);
  }
  return lines.join('\n') + '\n';
}

/** FNV-1a over the raw bytes of a typed array (same hash family
 *  the mesh-SDF bake uses for its source text). */
export function hashTypedArray(arr: Float32Array | Uint32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function csgOperandKey(operand: CsgOperand): string {
  if (operand.type === 'primitive') {
    const s = operand.spec;
    return `p:${s.kind}:${s.size}:${s.segments}:${s.offset[0]},${s.offset[1]},${s.offset[2]}`;
  }
  if (operand.type === 'extrude') {
    const s = operand.spec;
    return `x:${s.profile}:${s.size}:${s.segments}:${s.height}:${s.divisions}:` +
      `${s.twistDegrees}:${s.scaleTop}:${s.offset[0]},${s.offset[1]},${s.offset[2]}`;
  }
  return `m:${operand.positions.length}:${hashTypedArray(operand.positions)}:` +
    (operand.indices ? hashTypedArray(operand.indices) : 'flat');
}

export function csgCacheKey(
  a: CsgOperand,
  b: CsgOperand,
  op: CsgOperationKind,
  finish: CsgFinishKind = 'none',
  refineDivisions: number = 2,
): string {
  const base = `${csgOperandKey(a)}|${op}|${csgOperandKey(b)}`;
  if (finish === 'none') return base;
  if (finish === 'refine') return `${base}|f:refine:${clampCsgRefineDivisions(refineDivisions)}`;
  return `${base}|f:${finish}`;
}
