/**
 * Script bake (C1, Layer 1 WP11 phase D) — the main-thread
 * runner that actually executes the phase-B contracts
 * (lib/gpgpuScriptBake.ts) in the Pyodide Web Worker
 * (workers/gpgpuScriptBakeWorker.ts).
 *
 * Phase D's decided form (kalokagathia-pro/
 * LAYER1_WP11_PHASED_MATERIAL.md, branch 3):
 *   - assets: self-hosted and version-pinned (Pyodide
 *     0.26.4 under public/pyodide/0.26.4/), loaded LAZILY —
 *     the Worker is constructed, and the assets fetched,
 *     only when an enabled script bake is first requested.
 *     Nothing is fetched from a CDN, ever: every asset URL
 *     derives from the one same-origin index URL.
 *   - execution caps, two stages: a per-frame cap on each
 *     single Worker execution, and a total cap across a
 *     whole bake call (a frame sequence). Startup (Worker
 *     construction through the ready handshake) is timed
 *     and reported but is NOT execution and is not capped —
 *     the prototype's lesson (PYODIDE_PROTO_IMPL_RECORD
 *     §2): on a shared CPU the Pyodide load alone can
 *     exceed an execution cap.
 *   - failure discipline (design §5, the custom-force
 *     precedent): a static-check failure, a Worker error, a
 *     cap breach, or an output that fails validation never
 *     touches the store's last good bake; the caller gets
 *     the error and the retained bake. A cap breach
 *     terminates the Worker (Pyodide is cooperative — a
 *     running script cannot be interrupted any other way);
 *     the next bake builds a fresh one.
 *   - adoption: an execution's outputs are adopted only
 *     through the phase-B connection points — the attribute
 *     bake's declared channel columns, or the initial-state
 *     conversion — and only then is the output hash
 *     recorded (hashScriptOutputs -> store.recordGoodBake).
 *     The verification-support role is that hash: a later
 *     check compares hashes instead of re-executing
 *     (design §1-3 / §4). The state-cache merge is NOT done
 *     here (the manifest provenance fields are unimplemented
 *     — phase B's scope note stands).
 *
 * This module never constructs a Worker itself: the factory
 * is injected (lib/gpgpuScriptBakeWorkerFactory.ts provides
 * the real one), which keeps the `?worker` import out of this
 * module's graph and lets the unit tests drive the caps and
 * the retention discipline with a fake worker.
 */

import {
  GpgpuScriptBakeStore,
  hashScriptOutputs,
  resolveScriptBake,
  scriptAttrBakeColumns,
  scriptInitialStateFromOutputs,
  validateScriptOutputs,
  type GpgpuScriptTarget,
  type ScriptBakeInputs,
  type ScriptGoodBake,
} from './gpgpuScriptBake';
import type { GpgpuInitialData } from './gpgpuInitialData';

/** Pyodide version the assets are pinned to (public/pyodide/<version>/). */
export const SCRIPT_PYODIDE_VERSION = '0.26.4';

/**
 * Per-frame execution cap: one Worker execution (one frame)
 * may run at most this long before the Worker is terminated
 * and the bake fails. Grounding (browser measurements,
 * kalokagathia-pro PYODIDE_BROWSER_MEASURE_RECORD.md and the
 * phase-D re-measurement in PYODIDE_WORKER_WIRING_RECORD.md):
 * the slowest measured single frame is a 1M-particle
 * attribute bake at ~0.25 s wall on a shared VM CPU (~0.11 s
 * of in-Worker execution); 2,000 ms — the granularity the
 * design's API_SPEC recorded — leaves roughly 8x headroom
 * over that worst case while still catching a hung frame in
 * seconds.
 */
export const SCRIPT_FRAME_TIMEOUT_MS = 2000;

/**
 * Total execution cap: one bake call (a single frame or a
 * whole frame sequence) may spend at most this much
 * execution time in total. Grounding: at the worst measured
 * sustained frame cost (~0.25 s), a full 240-frame bake
 * sequence — the state-cache capture length — needs ~60 s;
 * 120,000 ms covers that with 2x headroom, and it is the
 * backstop against a slow-drip runaway that stays under the
 * per-frame cap forever (2 s x N frames). Startup is
 * excluded (see the header).
 */
export const SCRIPT_TOTAL_TIMEOUT_MS = 120000;

/** The minimal Worker surface the runner drives. */
export interface ScriptBakeWorkerLike {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface ScriptBakeRunnerOptions {
  /** Builds the real (or fake, in tests) Worker. Called lazily. */
  workerFactory: () => ScriptBakeWorkerLike;
  /** Absolute same-origin URL of the pinned asset directory (ends with '/'). */
  assetIndexUrl: string;
  /** Overrides for the two caps (tests use small values). */
  frameTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface ScriptBakeRequest {
  /** Execution inputs (the phase-B ScriptBakeInputs shape). */
  inputs: ScriptBakeInputs;
  /** Declared attribute channels the script may write (attrBake). */
  declaredChannels?: readonly string[];
  /** Extra JSON-serialisable parameters handed to the script as state['params']. */
  params?: Record<string, unknown>;
}

export type ScriptBakeSuccess = {
  ok: true;
  target: GpgpuScriptTarget;
  /** Raw adopted outputs (all lanes the script wrote). */
  outputs: Record<string, Float32Array>;
  /** Declared channel columns (attrBake target only). */
  channels?: Record<string, Float32Array>;
  /** Converted initial state (initialState target only). */
  initialState?: GpgpuInitialData;
  /** The recorded output hash (also store.current's output-hash key). */
  hash: string;
  pyodideVersion: string;
  /** In-Worker execution time of the (last) frame, as reported by the Worker. */
  workerExecMs: number;
  /** Startup time of the Worker if this call constructed it, else 0. */
  startupMs: number;
};

export type ScriptBakeFailure = {
  ok: false;
  error: string;
  /** The store's last good bake — untouched by the failure. */
  retained: ScriptGoodBake | null;
  /** True when a cap breach terminated the Worker. */
  timedOut?: boolean;
  /** Which cap fired, when timedOut. */
  timeoutStage?: 'frame' | 'total';
};

export type ScriptBakeResult = ScriptBakeSuccess | ScriptBakeFailure;

export type ScriptBakeSequenceResult =
  | { ok: true; frames: ScriptBakeSuccess[]; hash: string; startupMs: number }
  | ScriptBakeFailure;

interface WorkerReadyReply {
  ready: boolean;
  error?: string;
  pyodideVersion?: string;
  stages?: Record<string, number>;
}

interface WorkerBakeReply {
  id: number;
  ok: boolean;
  error?: string;
  outputs?: Record<string, ArrayBuffer>;
  workerExecMs?: number;
  pyodideVersion?: string;
}

export class GpgpuScriptBakeRunner {
  readonly store: GpgpuScriptBakeStore;
  private readonly workerFactory: () => ScriptBakeWorkerLike;
  private readonly assetIndexUrl: string;
  private readonly frameTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private worker: ScriptBakeWorkerLike | null = null;
  private readyPromise: Promise<WorkerReadyReply> | null = null;
  private startupMsValue = 0;
  private seq = 0;
  private pending = new Map<number, (reply: WorkerBakeReply) => void>();
  /** Serialises bakes: the Worker protocol is one-in-flight. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(store: GpgpuScriptBakeStore, options: ScriptBakeRunnerOptions) {
    this.store = store;
    this.workerFactory = options.workerFactory;
    this.assetIndexUrl = options.assetIndexUrl;
    this.frameTimeoutMs = options.frameTimeoutMs ?? SCRIPT_FRAME_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? SCRIPT_TOTAL_TIMEOUT_MS;
  }

  /** True once the Worker has been constructed (lazy-load has fired). */
  get workerStarted(): boolean {
    return this.worker !== null;
  }

  /** Startup duration of the current Worker (0 before the first bake). */
  get startupMs(): number {
    return this.startupMsValue;
  }

  private spawn(): ScriptBakeWorkerLike {
    const w = this.workerFactory();
    const t0 = performance.now();
    this.readyPromise = new Promise<WorkerReadyReply>((resolve) => {
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as WorkerReadyReply | null;
        if (m && typeof m === 'object' && 'ready' in m) {
          this.startupMsValue = performance.now() - t0;
          resolve(m); // a Promise resolves once; later messages fall through
        }
        this.dispatch(e);
      };
    });
    w.onerror = () => {
      for (const [, p] of this.pending) p({ id: -1, ok: false, error: 'Worker でエラーが発生しました。' });
      this.pending.clear();
      if (this.worker === w) this.worker = null;
    };
    w.postMessage({ kind: 'init', indexURL: this.assetIndexUrl });
    this.worker = w;
    return w;
  }

  private dispatch(e: MessageEvent): void {
    const m = e.data as WorkerBakeReply | null;
    if (!m || typeof m !== 'object' || typeof m.id !== 'number') return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    p(m);
  }

  private killWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* already gone */ }
      this.worker = null;
      this.readyPromise = null;
    }
    for (const [, p] of this.pending) p({ id: -1, ok: false, error: 'Worker が終了されました。' });
    this.pending.clear();
  }

  /**
   * Ensure the Worker exists and its ready handshake has
   * settled successfully. Startup happens here — outside
   * every execution cap — so callers start their cap clocks
   * only after this resolves.
   */
  private async ensureReady(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.worker) this.spawn();
    const ready = await (this.readyPromise as Promise<WorkerReadyReply>);
    if (!ready.ready) {
      return { ok: false, error: `Worker の初期化に失敗しました: ${ready.error ?? 'unknown'}` };
    }
    return { ok: true };
  }

  /**
   * One Worker execution with the per-frame cap. Resolves
   * with the Worker's reply, or a synthetic failure when the
   * cap fires (the Worker is terminated — a running Pyodide
   * script cannot be interrupted any other way).
   */
  private async callWorker(
    plan: { source: string; seed: number },
    request: ScriptBakeRequest,
  ): Promise<{ reply: WorkerBakeReply; timedOut: boolean }> {
    const ready = await this.ensureReady();
    if (!ready.ok) {
      return { reply: { id: -1, ok: false, error: ready.error }, timedOut: false };
    }
    const w = this.worker as ScriptBakeWorkerLike;
    const id = ++this.seq;
    const { inputs } = request;
    const wireInputs: Record<string, { buffer: ArrayBuffer; shape: number[] }> = {
      pos: { buffer: sliceBuffer(inputs.pos), shape: [inputs.count, 3] },
      vel: { buffer: sliceBuffer(inputs.vel), shape: [inputs.count, 3] },
      age: { buffer: sliceBuffer(inputs.age), shape: [inputs.count] },
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.killWorker();
        resolve({
          reply: { id, ok: false, error: `フレーム実行時間が上限 ${this.frameTimeoutMs}ms を超えたため Worker を終了しました。` },
          timedOut: true,
        });
      }, this.frameTimeoutMs);
      this.pending.set(id, (reply) => { clearTimeout(timer); resolve({ reply, timedOut: false }); });
      w.postMessage({
        id,
        source: plan.source,
        seed: plan.seed,
        count: inputs.count,
        params: request.params ?? {},
        declaredChannels: [...(request.declaredChannels ?? [])],
        inputs: wireInputs,
      });
    });
  }

  /** Adopt one execution's outputs through the phase-B connection points. */
  private adopt(
    target: GpgpuScriptTarget,
    outputs: Record<string, Float32Array>,
    request: ScriptBakeRequest,
  ): { ok: true; channels?: Record<string, Float32Array>; initialState?: GpgpuInitialData } | { ok: false; error: string } {
    const count = request.inputs.count;
    if (target === 'attrBake') {
      const cols = scriptAttrBakeColumns(outputs, count, request.declaredChannels ?? []);
      if (!cols.ok) return cols;
      return { ok: true, channels: cols.channels };
    }
    if (target === 'initialState') {
      const st = scriptInitialStateFromOutputs(outputs, count);
      if (!st.ok) return st;
      return { ok: true, initialState: st.data };
    }
    // fieldBake: no lib consumer exists yet in the tree; the
    // outputs are validated against the generic rules and
    // adopted as-is (the hash still records them).
    const v = validateScriptOutputs(outputs, { count });
    if (!v.ok) return v;
    return { ok: true };
  }

  private async bakeOneInner(request: ScriptBakeRequest): Promise<ScriptBakeResult> {
    const fail = (error: string, extra: Partial<ScriptBakeFailure> = {}): ScriptBakeFailure => ({
      ok: false, error, retained: this.store.lastGoodBake, ...extra,
    });
    const resolved = resolveScriptBake(this.store.current);
    if (!resolved.ok) return fail(resolved.error);
    if (!resolved.plan) return fail('スクリプトベイクが OFF のためベイクしません (従来動作と同一)。');
    const plan = resolved.plan;
    const startedBefore = this.workerStarted;
    const ready = await this.ensureReady();
    if (!ready.ok) return fail(ready.error);
    // The total cap's clock starts here — after the ready
    // handshake — so startup is outside it.
    const deadline = performance.now() + this.totalTimeoutMs;
    const { reply, timedOut } = await this.callWorker(plan, request);
    if (timedOut) return fail(reply.error ?? 'フレーム実行時間が上限を超えました。', { timedOut: true, timeoutStage: 'frame' });
    if (!reply.ok) return fail(reply.error ?? 'Worker 実行に失敗しました。');
    if (performance.now() > deadline) {
      this.killWorker();
      return fail(`呼び出し全体の実行時間が上限 ${this.totalTimeoutMs}ms を超えました。`, { timedOut: true, timeoutStage: 'total' });
    }
    const outputs: Record<string, Float32Array> = {};
    for (const [name, buf] of Object.entries(reply.outputs ?? {})) {
      outputs[name] = new Float32Array(buf);
    }
    const adopted = this.adopt(plan.target, outputs, request);
    if (!adopted.ok) return fail(adopted.error);
    const hash = hashScriptOutputs(outputs);
    this.store.recordGoodBake(outputs, hash);
    return {
      ok: true,
      target: plan.target,
      outputs,
      channels: adopted.channels,
      initialState: adopted.initialState,
      hash,
      pyodideVersion: reply.pyodideVersion ?? SCRIPT_PYODIDE_VERSION,
      workerExecMs: reply.workerExecMs ?? 0,
      startupMs: startedBefore ? 0 : this.startupMsValue,
    };
  }

  /**
   * Bake a single frame. The per-frame cap bounds the Worker
   * execution; the total cap bounds the whole call (for a
   * single frame the frame cap is the binding one). Startup
   * is outside both.
   */
  bakeOne(request: ScriptBakeRequest): Promise<ScriptBakeResult> {
    const run = this.queue.then(() => this.bakeOneInner(request));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Bake a sequence of frames under the two-stage caps: each
   * frame gets the per-frame cap, and the sequence as a
   * whole gets the total cap (execution time only — startup
   * excluded). Adoption is all-or-nothing: the store's last
   * good bake moves only when every frame has executed and
   * validated, so a sequence that fails midway retains the
   * previous working bake, exactly like a single failure.
   */
  bakeFrames(requests: readonly ScriptBakeRequest[]): Promise<ScriptBakeSequenceResult> {
    const run = this.queue.then(async (): Promise<ScriptBakeSequenceResult> => {
      const fail = (error: string, extra: Partial<ScriptBakeFailure> = {}): ScriptBakeFailure => ({
        ok: false, error, retained: this.store.lastGoodBake, ...extra,
      });
      if (requests.length === 0) return fail('フレーム列が空です。');
      const resolved = resolveScriptBake(this.store.current);
      if (!resolved.ok) return fail(resolved.error);
      if (!resolved.plan) return fail('スクリプトベイクが OFF のためベイクしません (従来動作と同一)。');
      const plan = resolved.plan;
      const startedBefore = this.workerStarted;
      const ready = await this.ensureReady();
      if (!ready.ok) return fail(ready.error);
      // The total cap's clock starts here — after the ready
      // handshake — so startup stays outside it, and the
      // sequence drives its executions directly against this
      // one shared deadline.
      const deadline = performance.now() + this.totalTimeoutMs;
      const frames: ScriptBakeSuccess[] = [];
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const { reply, timedOut } = await this.callWorker(plan, request);
        if (timedOut) {
          return fail(`フレーム ${i} の実行時間が上限 ${this.frameTimeoutMs}ms を超えたため Worker を終了しました。`, { timedOut: true, timeoutStage: 'frame' });
        }
        if (!reply.ok) return fail(reply.error ?? 'Worker 実行に失敗しました。');
        if (performance.now() > deadline) {
          this.killWorker();
          return fail(`呼び出し全体の実行時間が上限 ${this.totalTimeoutMs}ms を超えました (フレーム ${i})。`, { timedOut: true, timeoutStage: 'total' });
        }
        const outputs: Record<string, Float32Array> = {};
        for (const [name, buf] of Object.entries(reply.outputs ?? {})) {
          outputs[name] = new Float32Array(buf);
        }
        const adopted = this.adopt(plan.target, outputs, request);
        if (!adopted.ok) return fail(adopted.error);
        frames.push({
          ok: true,
          target: plan.target,
          outputs,
          channels: adopted.channels,
          initialState: adopted.initialState,
          hash: '', // filled below, once the whole sequence is known good
          pyodideVersion: reply.pyodideVersion ?? SCRIPT_PYODIDE_VERSION,
          workerExecMs: reply.workerExecMs ?? 0,
          startupMs: 0,
        });
      }
      // All frames good: record them in order (the store's
      // output hash ends at the last frame's, the sequence's
      // representative bake).
      let lastHash = '';
      for (const frame of frames) {
        lastHash = hashScriptOutputs(frame.outputs);
        frame.hash = lastHash;
        this.store.recordGoodBake(frame.outputs, lastHash);
      }
      return { ok: true, frames, hash: lastHash, startupMs: startedBefore ? 0 : this.startupMsValue };
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Terminate the Worker (the next bake builds a fresh one). */
  dispose(): void {
    this.killWorker();
  }
}

function sliceBuffer(a: Float32Array): ArrayBuffer {
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}
