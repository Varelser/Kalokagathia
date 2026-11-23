// Phase CC: CSG client — the main-thread side of the CSG
// worker (workers/csgWorker.ts, manifold-3d WASM).
//
// Discipline fixed by the final CSG brief:
//   - the worker is created lazily on the first execution, so
//     with CSG unused nothing is fetched or compiled;
//   - requests are serial (one in flight, id-matched replies);
//   - a 5 s timeout (D9: the slowest measured case, coincident
//     sphere union at 128 segments, is ~0.46 s, and the cold
//     start ~0.16 s — 5 s leaves roughly 8x headroom);
//   - results are cached by operand/operation key and replayed
//     without re-running;
//   - mesh operands pass gate (a) (lib/csgGate.ts) on this
//     thread before anything is transferred; a structural
//     failure is refused here with the gate's reason and the
//     worker is never touched;
//   - a fatal worker reply (non-ManifoldError throw or a WASM
//     load failure) or a timeout destroys the worker; the next
//     execution builds a fresh one.

import CsgWorkerClass from '../workers/csgWorker?worker';
import { checkWatertightGate } from './csgGate';
import { resolveExtrudePolygons, validateExtrudePolygons } from './csgExtrude';
import {
  CSG_TIMEOUT_MS,
  CsgError,
  csgCacheKey,
  type CsgErrorCode,
  type CsgFinishKind,
  type CsgOperand,
  type CsgOperationKind,
  type CsgResultData,
} from './csgCore';
import {
  validateContours,
  type CrossSectionExtrudeRequest,
  type CrossSectionExtrudeResultData,
  type VectorBoolOp,
  type VectorBooleanResultData,
  type VectorContour,
} from './vectorBoolean';

interface WorkerReply {
  id: number;
  ok: boolean;
  result?: CsgResultData | VectorBooleanResultData | CrossSectionExtrudeResultData | 'pong';
  code?: CsgErrorCode;
  message?: string;
  fatal?: boolean;
}

let worker: Worker | null = null;
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<number, {
  resolve: (reply: WorkerReply) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const cache = new Map<string, CsgResultData>();

export interface CsgRunRecord {
  a: CsgOperand;
  b: CsgOperand;
  op: CsgOperationKind;
  finish: CsgFinishKind;
  refineDivisions: number;
  result: CsgResultData;
  fromCache: boolean;
}
let lastRun: CsgRunRecord | null = null;
export function getLastCsgRun(): CsgRunRecord | null {
  return lastRun;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new CsgWorkerClass();
  w.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.fatal) destroyWorker();
    entry.resolve(reply);
  };
  w.onerror = () => {
    // A worker-level error (e.g. module load failure) rejects
    // everything in flight as UNKNOWN; the next run recreates.
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, code: 'UNKNOWN', message: 'CSG ワーカーでエラーが発生しました。', fatal: true });
    }
    destroyWorker();
  };
  worker = w;
  return w;
}

function destroyWorker() {
  if (worker) {
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
  }
}

type WorkerRequestMessage =
  | { kind: 'op' | 'ping'; a?: CsgOperand; b?: CsgOperand; op?: CsgOperationKind; finish?: CsgFinishKind; refineDivisions?: number }
  | { kind: 'vectorBoolean'; aContours: VectorContour[]; bContours: VectorContour[]; op: VectorBoolOp }
  | ({ kind: 'crossSectionExtrude' } & CrossSectionExtrudeRequest);

function postRequest(message: WorkerRequestMessage): Promise<WorkerReply> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<WorkerReply>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      destroyWorker();
      resolve({
        id,
        ok: false,
        code: 'TIMEOUT',
        message: `CSG 演算が ${CSG_TIMEOUT_MS / 1000} 秒以内に終わりませんでした。分割数を下げるか、被演算子を単純にして再試行してください。`,
        fatal: true,
      });
    }, CSG_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    w.postMessage({ ...message, id });
  });
}

/** Run one CSG operation. Throws CsgError with a typed code:
 *  NOT_MANIFOLD (gate or construction refused the input),
 *  EMPTY_RESULT (a normal outcome — the result is the empty
 *  set), WASM_LOAD_FAILED, TIMEOUT, UNKNOWN. */
export function runCsgOperation(
  a: CsgOperand,
  b: CsgOperand,
  op: CsgOperationKind,
  finish: CsgFinishKind = 'none',
  refineDivisions: number = 2,
): Promise<CsgResultData> {
  const key = csgCacheKey(a, b, op, finish, refineDivisions);
  const run = async (): Promise<CsgResultData> => {
    const hit = cache.get(key);
    if (hit) {
      lastRun = { a, b, op, finish, refineDivisions, result: hit, fromCache: true };
      return hit;
    }
    // Gate (a) on mesh operands, before transfer; the same
    // discipline for extrusion profiles (Phase CF): the
    // pre-checks of lib/csgExtrude.ts run here so a refused
    // profile never reaches the worker either.
    for (const operand of [a, b]) {
      if (operand.type === 'mesh') {
        const gate = checkWatertightGate(operand.positions, operand.indices);
        if (!gate.ok && !gate.skipped) {
          throw new CsgError('NOT_MANIFOLD', gate.reason);
        }
      } else if (operand.type === 'extrude') {
        const check = validateExtrudePolygons(resolveExtrudePolygons(operand.spec));
        if (!check.ok) {
          throw new CsgError('NOT_MANIFOLD', check.reason);
        }
      }
    }
    const reply = await postRequest({ kind: 'op', a, b, op, finish, refineDivisions });
    if (!reply.ok) {
      throw new CsgError(reply.code ?? 'UNKNOWN', reply.message ?? 'CSG 演算に失敗しました。');
    }
    const result = reply.result as CsgResultData;
    cache.set(key, result);
    lastRun = { a, b, op, finish, refineDivisions, result, fromCache: false };
    return result;
  };
  // Serialise: chain onto the previous run whatever its outcome.
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function clearCsgCache() {
  cache.clear();
  lastRun = null;
}

// ---------------------------------------------------------------------------
// Phase 17 stage 2: vector Boolean + CrossSection extrusion.
// Same worker, same serial queue and timeout discipline as the
// CSG ops above; nothing is cached (2D results are small and the
// composition is an explicit, button-driven capture). The worker
// is still created lazily on the first explicit execution only,
// so with the feature unused nothing is fetched or compiled.
// ---------------------------------------------------------------------------

/** Run one 2D vector Boolean over CrossSection in the worker.
 *  Operands are validated on this thread first (the gate (a)
 *  discipline): a self-intersecting or empty operand is refused
 *  here with its reason and the worker is never touched. An
 *  empty boolean outcome (e.g. a disjoint intersection) is a
 *  normal result with zero contours, not an error. */
export function runVectorBoolean(
  aContours: VectorContour[],
  bContours: VectorContour[],
  op: VectorBoolOp,
): Promise<VectorBooleanResultData> {
  const run = async (): Promise<VectorBooleanResultData> => {
    const va = validateContours(aContours, 'A');
    if (!va.ok) throw new CsgError('NOT_MANIFOLD', va.reason);
    const vb = validateContours(bContours, 'B');
    if (!vb.ok) throw new CsgError('NOT_MANIFOLD', vb.reason);
    const reply = await postRequest({ kind: 'vectorBoolean', aContours, bContours, op });
    if (!reply.ok) {
      throw new CsgError(reply.code ?? 'UNKNOWN', reply.message ?? 'ベクタ合成に失敗しました。');
    }
    return reply.result as VectorBooleanResultData;
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Extrude a (possibly holed) contour set through CrossSection
 *  in the worker — the dedicated holed-shape path of the
 *  stage-0 spike 2. The existing Manifold.extrude path and its
 *  simple-polygon validation are untouched. The worker
 *  re-verifies the spike's acceptance conditions (area match,
 *  NoError status, volume = area × height in the untwisted /
 *  unscaled case) and refuses with a reason instead of
 *  returning a partial shape. */
export function runCrossSectionExtrude(
  request: CrossSectionExtrudeRequest,
): Promise<CrossSectionExtrudeResultData> {
  const run = async (): Promise<CrossSectionExtrudeResultData> => {
    const v = validateContours(request.contours, '断面');
    if (!v.ok) throw new CsgError('NOT_MANIFOLD', v.reason);
    if (!(request.height > 0)) {
      throw new CsgError('NOT_MANIFOLD', '押し出しの高さは正の値にしてください。');
    }
    const reply = await postRequest({ kind: 'crossSectionExtrude', ...request });
    if (!reply.ok) {
      throw new CsgError(reply.code ?? 'UNKNOWN', reply.message ?? '押し出しに失敗しました。');
    }
    return reply.result as CrossSectionExtrudeResultData;
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
