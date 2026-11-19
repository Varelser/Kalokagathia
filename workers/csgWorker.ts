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
  buildCsgOperand,
  manifoldToResultData,
  runCsgBoolean,
} from '../lib/csgPrimitive';
import type {
  CsgErrorCode,
  CsgOperand,
  CsgOperationKind,
} from '../lib/csgCore';

interface OpRequest {
  id: number;
  kind: 'op';
  a: CsgOperand;
  b: CsgOperand;
  op: CsgOperationKind;
}
interface PingRequest {
  id: number;
  kind: 'ping';
}
type Request = OpRequest | PingRequest;

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
  const data = manifoldToResultData(result);
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

ctx.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  if (req.kind === 'ping') {
    ctx.postMessage({ id: req.id, ok: true, result: 'pong' });
    return;
  }
  runOp(req).catch((e: unknown) => {
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
