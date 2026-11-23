// Phase CC: CSG worker — the only place manifold-3d is loaded.
// Created lazily by lib/csg.ts on the first CSG execution, so
// with CSG unused (the default) neither the worker nor the WASM
// is ever fetched (final CSG brief: 既定 OFF で従来同一).
//
// Protocol (id-matched, serial — the client never pipelines):
//   -> { id, kind: 'ping' }
//   -> { id, kind: 'op', a, b, op }   operands are CsgOperand
//   <- { id, ok: true, result }       CsgResultData (buffers transferred)
//   <- { id, ok: false, code, message, fatal? }
//
// Error discipline (brief §フェーズ3, fixed by the round-8 gate
// measurements): construction goes through the single
// Manifold.ofMesh site in lib/csgPrimitive.ts inside a broad
// catch; error *strings* are never used for classification — a
// thrown ManifoldError maps to NOT_MANIFOLD whatever its
// message, and the worker stays alive; any other throw maps to
// UNKNOWN and is flagged fatal so the client recreates the
// worker (the divide-by-zero case was never reproduced, so the
// WASM instance's survival is unproven — safe side wins).

import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { ManifoldToplevel } from 'manifold-3d';
import {
  applyCsgFinish,
  buildCsgOperand,
  manifoldToResultData,
  runCsgBoolean,
} from '../lib/csgPrimitive';
import type {
  CsgErrorCode,
  CsgFinishKind,
  CsgOperand,
  CsgOperationKind,
} from '../lib/csgCore';
import {
  classifyContours,
  type CrossSectionExtrudeRequest,
  type VectorBoolOp,
  type VectorBooleanResultData,
  type VectorContour,
} from '../lib/vectorBoolean';

interface OpRequest {
  id: number;
  kind: 'op';
  a: CsgOperand;
  b: CsgOperand;
  op: CsgOperationKind;
  finish?: CsgFinishKind;
  refineDivisions?: number;
}
interface PingRequest {
  id: number;
  kind: 'ping';
}
/** Phase 17 stage 2: 2D vector Boolean over CrossSection. */
interface VectorBooleanRequest {
  id: number;
  kind: 'vectorBoolean';
  aContours: VectorContour[];
  bContours: VectorContour[];
  op: VectorBoolOp;
}
/** Phase 17 stage 2: holed-shape extrusion over CrossSection
 *  (the dedicated path of the stage-0 spike 2; the stage-3
 *  text-extrude foundation). */
interface CrossSectionExtrudeMessage extends CrossSectionExtrudeRequest {
  id: number;
  kind: 'crossSectionExtrude';
}
type Request = OpRequest | PingRequest | VectorBooleanRequest | CrossSectionExtrudeMessage;

const ctx = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

let wasm: ManifoldToplevel | null = null;
let wasmLoadError: string | null = null;

async function ensureWasm(): Promise<ManifoldToplevel> {
  if (wasm) return wasm;
  if (wasmLoadError) {
    throw Object.assign(new Error(wasmLoadError), { csgCode: 'WASM_LOAD_FAILED' as CsgErrorCode });
  }
  try {
    const loaded = await Module({ locateFile: () => wasmUrl });
    loaded.setup();
    wasm = loaded;
    return wasm;
  } catch (e) {
    wasmLoadError =
      'CSG の WASM（manifold-3d）を読み込めませんでした: ' +
      String(e instanceof Error ? e.message : e).slice(0, 160);
    throw Object.assign(new Error(wasmLoadError), { csgCode: 'WASM_LOAD_FAILED' as CsgErrorCode });
  }
}

async function runOp(req: OpRequest): Promise<void> {
  const w = await ensureWasm();
  const a = buildCsgOperand(w, req.a);
  const b = buildCsgOperand(w, req.b);
  for (const [label, m] of [['A', a], ['B', b]] as const) {
    const st = m.status();
    if (st !== 'NoError') {
      throw Object.assign(
        new Error(`被演算子 ${label} が多様体として構築できませんでした（status: ${st}）。`),
        { csgCode: 'NOT_MANIFOLD' as CsgErrorCode },
      );
    }
  }
  const result = runCsgBoolean(a, b, req.op);
  // Boolean ops are lazy: force evaluation before reading anything.
  if (result.isEmpty()) {
    ctx.postMessage({ id: req.id, ok: false, code: 'EMPTY_RESULT', message: '演算結果は空です（体積 0）。' });
    return;
  }
  // Finish (Phase CG hull / Phase CH refine): the finish
  // replaces the result before the output re-check, so the
  // gate (c) verdict and the reported numbers describe the
  // finished solid the user actually receives.
  const finished = applyCsgFinish(result, req.finish ?? 'none', req.refineDivisions);
  if (req.finish === 'hull' || req.finish === 'refine') {
    const st = finished.status();
    if (st !== 'NoError') {
      throw Object.assign(
        new Error(
          req.finish === 'refine'
            ? `細分化に失敗しました（status: ${st}）。`
            : `ハル（凸包）化に失敗しました（status: ${st}）。`,
        ),
        { csgCode: 'NOT_MANIFOLD' as CsgErrorCode },
      );
    }
  }
  const data = manifoldToResultData(finished);
  if (!data.gate.ok && !data.gate.skipped) {
    throw Object.assign(
      new Error('演算結果が出力再検査を通りませんでした: ' + data.gate.reason),
      { csgCode: 'UNKNOWN' as CsgErrorCode },
    );
  }
  ctx.postMessage(
    { id: req.id, ok: true, result: data },
    [data.positions.buffer as ArrayBuffer, data.indices.buffer as ArrayBuffer],
  );
}

async function runVectorBoolean(req: VectorBooleanRequest): Promise<void> {
  const w = await ensureWasm();
  const { CrossSection } = w;
  const a = CrossSection.ofPolygons(req.aContours, 'EvenOdd');
  const b = CrossSection.ofPolygons(req.bContours, 'EvenOdd');
  let result;
  switch (req.op) {
    case 'union':
      result = a.add(b);
      break;
    case 'difference':
      result = a.subtract(b);
      break;
    case 'intersection':
      result = a.intersect(b);
      break;
    case 'xor':
      // No native xor in CrossSection: (A−B)+(B−A), the
      // composition measured in the stage-0 spike 1.
      result = a.subtract(b).add(b.subtract(a));
      break;
  }
  if (result.isEmpty()) {
    const empty: VectorBooleanResultData = { contours: [], area: 0, islandCount: 0, holeCount: 0 };
    ctx.postMessage({ id: req.id, ok: true, result: empty });
    return;
  }
  const raw: VectorContour[] = result.toPolygons().map((poly) =>
    poly.map(([x, y]) => [x, y] as [number, number]),
  );
  // Normalise through the single classification site so the
  // returned contours follow the module convention (islands
  // CCW, holes CW) and the counts describe roles, not winding
  // accidents of the engine output.
  const classified = classifyContours(raw);
  const data: VectorBooleanResultData = {
    contours: classified.contours,
    area: result.area(),
    islandCount: classified.islandCount,
    holeCount: classified.holeCount,
  };
  ctx.postMessage({ id: req.id, ok: true, result: data });
}

async function runCrossSectionExtrude(req: CrossSectionExtrudeMessage): Promise<void> {
  const w = await ensureWasm();
  const { CrossSection } = w;
  // Re-verification of the stage-0 spike 2 acceptance conditions:
  // (a) the CrossSection area must equal the net area of the
  // classified input (islands − holes) — a mismatch means the
  // fill interpretation diverged from the caller's intent and
  // the shape would silently differ;
  const classified = classifyContours(req.contours);
  if (classified.contours.length === 0 || !(classified.netArea > 0)) {
    throw Object.assign(
      new Error('押し出しの断面に面積のある閉じた図形がありません。'),
      { csgCode: 'EMPTY_RESULT' as CsgErrorCode },
    );
  }
  const cs = CrossSection.ofPolygons(classified.contours, 'EvenOdd');
  const areaTol = 1e-6 * Math.max(1, classified.netArea);
  if (Math.abs(cs.area() - classified.netArea) > areaTol) {
    throw Object.assign(
      new Error(
        `断面の面積が一致しません（入力 ${classified.netArea} / 構築 ${cs.area()}）。輪郭の重なりや向きを確認してください。`,
      ),
      { csgCode: 'NOT_MANIFOLD' as CsgErrorCode },
    );
  }
  const solid = cs.extrude(
    req.height,
    Math.max(0, Math.floor(req.divisions) || 0),
    req.twistDegrees,
    [req.scaleTop, req.scaleTop],
    true,
  );
  // (b) construction status must be clean;
  if (solid.isEmpty()) {
    throw Object.assign(
      new Error('押し出し結果は空です。'),
      { csgCode: 'EMPTY_RESULT' as CsgErrorCode },
    );
  }
  const st = solid.status();
  if (st !== 'NoError') {
    throw Object.assign(
      new Error(`押し出しが多様体として構築できませんでした（status: ${st}）。`),
      { csgCode: 'NOT_MANIFOLD' as CsgErrorCode },
    );
  }
  const data = manifoldToResultData(solid);
  if (!data.gate.ok && !data.gate.skipped) {
    throw Object.assign(
      new Error('押し出し結果が出力再検査を通りませんでした: ' + data.gate.reason),
      { csgCode: 'UNKNOWN' as CsgErrorCode },
    );
  }
  // (c) volume must equal area × height. Twist and top scale
  // change the volume by design (the CSG extrude discipline),
  // so the equality is enforced exactly where it is an identity:
  // the untwisted, unscaled case — which includes every holed
  // glyph of the stage-3 path at its default settings.
  if (req.twistDegrees === 0 && req.scaleTop === 1) {
    const expected = cs.area() * req.height;
    const volTol = 1e-6 * Math.max(1, Math.abs(expected));
    if (Math.abs(data.volume - expected) > volTol) {
      throw Object.assign(
        new Error(
          `押し出しの体積が面積×高さと一致しません（体積 ${data.volume} / 期待 ${expected}）。`,
        ),
        { csgCode: 'NOT_MANIFOLD' as CsgErrorCode },
      );
    }
  }
  ctx.postMessage(
    {
      id: req.id,
      ok: true,
      result: {
        positions: data.positions,
        indices: data.indices,
        volume: data.volume,
        triangles: data.triangles,
        area: cs.area(),
      },
    },
    [data.positions.buffer as ArrayBuffer, data.indices.buffer as ArrayBuffer],
  );
}

ctx.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  if (req.kind === 'ping') {
    ctx.postMessage({ id: req.id, ok: true, result: 'pong' });
    return;
  }
  const run = req.kind === 'vectorBoolean'
    ? runVectorBoolean(req)
    : req.kind === 'crossSectionExtrude'
      ? runCrossSectionExtrude(req)
      : runOp(req);
  run.catch((e: unknown) => {
    const tagged = (e as { csgCode?: CsgErrorCode } | null)?.csgCode;
    if (tagged) {
      ctx.postMessage({
        id: req.id,
        ok: false,
        code: tagged,
        message: e instanceof Error ? e.message : String(e),
        fatal: tagged === 'WASM_LOAD_FAILED',
      });
      return;
    }
    // One-line classification rule (round-9 gate check, point 4):
    // a ManifoldError is NOT_MANIFOLD whatever its message says,
    // and the worker may be reused; anything else is UNKNOWN and
    // the client must recreate the worker. (The class is exposed
    // on the module at runtime but missing from the .d.ts
    // toplevel, hence the structural cast.)
    const ManifoldErrorClass = wasm
      ? (wasm as unknown as { ManifoldError?: new (...args: never[]) => Error }).ManifoldError
      : undefined;
    if (ManifoldErrorClass && e instanceof ManifoldErrorClass) {
      ctx.postMessage({
        id: req.id,
        ok: false,
        code: 'NOT_MANIFOLD' as CsgErrorCode,
        message:
          '入力が閉じた多様体ではありません（' +
          String(e instanceof Error ? e.message : e).slice(0, 120) +
          '）。開いたメッシュや位相の壊れたメッシュは CSG の被演算子にできません。',
      });
      return;
    }
    ctx.postMessage({
      id: req.id,
      ok: false,
      code: 'UNKNOWN' as CsgErrorCode,
      message: 'CSG 演算中に予期しないエラーが発生しました: ' + String(e instanceof Error ? e.message : e).slice(0, 160),
      fatal: true,
    });
  });
};
