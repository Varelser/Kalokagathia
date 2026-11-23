/**
 * Phase 17 stage 1: CSG wiring helpers — scene import,
 * result chaining and the morph take-in backup plan.
 *
 * All functions here are pure (no worker, no WASM, no
 * clock): they only reshape data the app already holds,
 * so the "CSG disabled = nothing is loaded" discipline
 * of lib/csg.ts is untouched. Conversions run only when
 * the user presses the corresponding panel button.
 *
 * Coordinate discipline for the scene import: the source
 * is the OBJ-mesh display geometry built by
 * lib/objMesh.ts buildObjMeshGeometryData, which is
 * NORMALISED (bounding-box centre at the origin,
 * bounding-sphere radius 1) exactly like the morph
 * sampler. The imported operand therefore lives in that
 * normalised display space, NOT in the raw units of the
 * morph OBJ source text. The panel states this next to
 * the import button.
 */
import { buildIndexedObjText, meshVolume } from './csgCore';
import { buildObjMeshGeometryData } from './objMesh';

export type SceneObjMeshImportResult =
  | {
      ok: true;
      objText: string;
      vertexCount: number;
      triangleCount: number;
      /** Signed volume of the normalised display geometry
       *  (independent cross-check via meshVolume). */
      volume: number;
    }
  | { ok: false; reason: string };

/** Morph OBJ source text -> indexed OBJ text of the
 *  normalised display geometry, ready to be stored in
 *  the CSG mesh operand text key. Returns a reason and
 *  no text when there is no usable geometry, so the
 *  caller can leave every key unchanged. */
export function buildSceneObjMeshOperandText(morphObjSource: string): SceneObjMeshImportResult {
  if (!morphObjSource || morphObjSource.trim() === '') {
    return { ok: false, reason: 'モーフ経路のOBJソースが空です。先にOBJを読み込むか、CSG結果をモーフへ取り込んでください。' };
  }
  const data = buildObjMeshGeometryData(morphObjSource);
  if (!data) {
    return { ok: false, reason: 'モーフ経路のOBJソースからジオメトリを読み取れませんでした（頂点と面を含むOBJが必要です）。' };
  }
  return {
    ok: true,
    objText: buildIndexedObjText(data.positions, data.indices, 'scene-obj-mesh'),
    vertexCount: data.vertexCount,
    triangleCount: data.triangleCount,
    volume: meshVolume(data.positions, data.indices),
  };
}

/** CSG result -> indexed OBJ text for chaining the result
 *  back in as a mesh operand (single-step chain; the
 *  multi-step form is the result history in
 *  lib/csgHistory.ts). */
export function buildResultChainOperandText(result: {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}): string {
  return buildIndexedObjText(result.positions, result.indices, 'csg-result-chain');
}

/** The B mesh operand's effective text: the B-only key
 *  wins when it is non-empty; an empty B key falls back
 *  to the shared mesh text (pre-stage-1 presets carry no
 *  B key at all, which the default '' reproduces). */
export function resolveCsgMeshTextB(sharedText: string, bText: string): string {
  return bText !== '' ? bText : sharedText;
}

/** Plan for taking a CSG result into the morph path: the
 *  current morph source is backed up FIRST, then the
 *  result text replaces it. Pure planning — the panel
 *  applies the two updates in this order. */
export function planMorphTakeIn(
  currentMorphObjSource: string,
  resultObjText: string,
): { backupObjText: string; morphObjSource: string } {
  return { backupObjText: currentMorphObjSource, morphObjSource: resultObjText };
}

/** Plan for undoing a morph take-in: restore the morph
 *  source from the backup key. */
export function planMorphRestore(backupObjText: string): { morphObjSource: string } {
  return { morphObjSource: backupObjText };
}
