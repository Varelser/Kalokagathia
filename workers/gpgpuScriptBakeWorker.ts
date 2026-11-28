// C1 (Layer 1 WP11 phase D): the script-bake Web Worker — the
// only place Pyodide is loaded. Created lazily by
// lib/gpgpuScriptBakeWorkerFactory.ts on the first enabled
// script bake, so with the script bake unused (the default)
// neither the worker nor the ~25 MB of Pyodide assets is ever
// fetched (phase D judgment, branch 3 (b): self-hosted assets,
// lazy load on first enable — never a CDN).
//
// The assets are version-pinned static files under
// public/pyodide/<version>/ (Pyodide 0.26.4 + numpy 1.26.4),
// served from the same origin as the app. The client passes
// their absolute index URL in the init message; this worker
// builds every other URL from it and fetches nothing else.
//
// Protocol (id-matched, serial — the client never pipelines):
//   -> { kind: 'init', indexURL }          (exactly once, first)
//   <- { ready: true, pyodideVersion, stages } | { ready: false, error }
//   -> { id, source, seed, count, params, declaredChannels,
//        inputs: { [name]: { buffer, shape } } }
//   <- { id, ok: true, outputs: { [name]: ArrayBuffer },
//        workerExecMs, heapBytes, pyodideVersion }
//   <- { id, ok: false, error }
//
// Startup (the init message through the ready reply) is timed
// by stages and reported, but it is NOT execution: the
// client's execution caps start only after ready (the
// prototype's ready-handshake lesson — on a shared CPU the
// Pyodide load alone can exceed an execution cap).
//
// The Python side is the prototype's, verbatim in behaviour
// (kalokagathia-pro/pyodide-integration-proto/src/worker.mjs
// and browser/worker.js, both measured): the input conversion
// goes through the buffer protocol (to_py() -> memoryview ->
// np.frombuffer), the seed is supplied by the engine via
// state['seed'], and the runtime guard is a find_spec
// MetaPathFinder installed only AFTER the allowed modules are
// imported (installing it earlier breaks numpy's own first
// import — proven in the prototype).

/** The Pyodide version this worker loads (assets pinned to it). */
export const SCRIPT_PYODIDE_VERSION = '0.26.4';

const GUARD_PY = `
import sys, importlib.abc
_ALLOWED = {"math","random","numpy","statistics","fractions","decimal","itertools","functools","array","struct","hashlib","json"}
_EVICT = ("os","socket","subprocess","urllib","js","importlib","pathlib")
class _Guard(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        top = fullname.split(".")[0]
        if top not in _ALLOWED:
            raise ImportError("blocked by script guard: " + fullname)
        return None
for _name in list(sys.modules.keys()):
    if _name.split(".")[0] in _EVICT:
        del sys.modules[_name]
sys.meta_path.insert(0, _Guard())
`;

const HARNESS_PY = `
import numpy as np
def _to_array(js_proxy):
    mv = js_proxy.to_py()
    return np.array(np.frombuffer(mv, dtype=np.float32), dtype=np.float32, copy=True)
def run_bake(source, seed, count, params_json, input_specs_json, declared_channels_json):
    import json as _json
    params = _json.loads(params_json) if params_json else {}
    declared = _json.loads(declared_channels_json) if declared_channels_json else []
    specs = _json.loads(input_specs_json) if input_specs_json else {}
    state = {"seed": int(seed), "count": int(count), "params": params, "channels": {}}
    for name, spec in specs.items():
        arr = _to_array(globals()["__in_" + name])
        shape = spec.get("shape")
        if shape:
            arr = arr.reshape(shape)
        state[name] = arr
    ns = {}
    exec(compile(source, "<gpgpu-script>", "exec"), ns)
    if "bake" in ns:
        ns["bake"](state)
    elif "on_init" in ns:
        ns["on_init"](state)
    else:
        raise RuntimeError("script must define bake(state) or on_init(state)")
    out = {}
    for key in ("pos", "vel", "age"):
        if key in state and isinstance(state[key], np.ndarray):
            out[key] = np.ascontiguousarray(state[key], dtype=np.float32).tobytes()
    for name in declared:
        ch = state.get("channels", {}).get(name)
        if ch is not None:
            out["channel:" + name] = np.ascontiguousarray(ch, dtype=np.float32).tobytes()
    return out
`;

interface WorkerScope {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
  importScripts?: (...urls: string[]) => void;
  loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
  location: { href: string };
}

interface PyodideLike {
  loadPackage: (name: string) => Promise<void>;
  runPython: (code: string) => unknown;
  globals: { set: (name: string, value: unknown) => void };
  _module?: { HEAPU8: { buffer: { byteLength: number } } };
}

const ctx = self as unknown as WorkerScope;

interface BakeRequest {
  id: number;
  source: string;
  seed: number;
  count: number;
  params?: Record<string, unknown>;
  declaredChannels?: string[];
  inputs?: Record<string, { buffer: ArrayBuffer; shape?: number[] | null }>;
}

interface InitRequest {
  kind: 'init';
  indexURL: string;
}

let pyodide: PyodideLike | null = null;
let readyPromise: Promise<Record<string, number>> | null = null;

function heapBytes(): number | null {
  try {
    return pyodide && pyodide._module ? pyodide._module.HEAPU8.buffer.byteLength : null;
  } catch {
    return null;
  }
}

async function loadPyodideFactory(indexURL: string): Promise<(opts: { indexURL: string }) => Promise<PyodideLike>> {
  // Built workers are classic (IIFE) workers: importScripts +
  // the UMD entry (pyodide.js) is the prototype-proven path.
  // Module workers expose importScripts but throw when it is
  // called ("Module scripts don't support importScripts()"),
  // so the classic path is attempted and any throw falls
  // through to the same pinned package's ESM entry
  // (pyodide.mjs), dynamically imported. Both entries ship
  // in the pinned asset directory; no URL outside indexURL
  // is ever constructed.
  if (typeof ctx.importScripts === 'function') {
    try {
      ctx.importScripts(indexURL + 'pyodide.js');
      if (typeof ctx.loadPyodide === 'function') return ctx.loadPyodide;
    } catch {
      // Module worker — fall through to the ESM entry.
    }
  }
  const mod = (await import(/* @vite-ignore */ indexURL + 'pyodide.mjs')) as {
    loadPyodide: (opts: { indexURL: string }) => Promise<PyodideLike>;
  };
  return mod.loadPyodide;
}

async function init(indexURL: string): Promise<Record<string, number>> {
  const stages: Record<string, number> = {};
  let t = performance.now();
  const loadPyodide = await loadPyodideFactory(indexURL);
  stages.loadEntryMs = performance.now() - t;

  t = performance.now();
  pyodide = await loadPyodide({ indexURL });
  stages.coreReadyMs = performance.now() - t;
  stages.heapAfterCore = heapBytes() ?? -1;

  t = performance.now();
  await pyodide.loadPackage('numpy');
  stages.numpyLoadMs = performance.now() - t;
  stages.heapAfterNumpy = heapBytes() ?? -1;

  t = performance.now();
  // The guard goes in only after the allowed modules are
  // imported (see the header note).
  pyodide.runPython('import numpy, numpy.random, math, random, statistics, fractions, decimal, itertools, functools, array, struct, hashlib, json');
  pyodide.runPython(GUARD_PY);
  pyodide.runPython(HARNESS_PY);
  stages.setupMs = performance.now() - t;
  stages.heapAfterSetup = heapBytes() ?? -1;

  stages.readyTotalMs = stages.loadEntryMs + stages.coreReadyMs + stages.numpyLoadMs + stages.setupMs;
  return stages;
}

async function handleBake(m: BakeRequest): Promise<void> {
  const { id } = m;
  try {
    if (!readyPromise) throw new Error('Worker が初期化されていません (init が先です)。');
    await readyPromise;
    if (!pyodide) throw new Error('Pyodide が初期化されていません。');
    const specs: Record<string, { shape: number[] | null }> = {};
    for (const [name, spec] of Object.entries(m.inputs ?? {})) {
      pyodide.globals.set(`__in_${name}`, new Float32Array(spec.buffer));
      specs[name] = { shape: spec.shape ?? null };
    }
    pyodide.globals.set('__source', m.source);
    pyodide.globals.set('__seed', m.seed);
    pyodide.globals.set('__count', m.count);
    pyodide.globals.set('__params_json', JSON.stringify(m.params ?? {}));
    pyodide.globals.set('__specs_json', JSON.stringify(specs));
    pyodide.globals.set('__declared_json', JSON.stringify(m.declaredChannels ?? []));
    const t0 = performance.now();
    const result = pyodide.runPython(
      'run_bake(__source, __seed, __count, __params_json, __specs_json, __declared_json)',
    ) as {
      toJs: (opts: { dict_converter: unknown }) => unknown;
      destroy: () => void;
    };
    const workerExecMs = performance.now() - t0;
    // toJs with dict_converter yields a plain object on the
    // UMD entry and may yield a Map on the ESM entry —
    // normalise both.
    const jsResult = result.toJs({ dict_converter: Object.fromEntries }) as unknown;
    const entries: [string, { toJs?: () => Uint8Array; destroy?: () => void }][] =
      jsResult instanceof Map
        ? [...(jsResult as Map<string, { toJs?: () => Uint8Array; destroy?: () => void }>).entries()]
        : Object.entries(jsResult as Record<string, { toJs?: () => Uint8Array; destroy?: () => void }>);
    const outputs: Record<string, ArrayBuffer> = {};
    const transfers: Transferable[] = [];
    for (const [name, bytesProxy] of entries) {
      const u8 = bytesProxy && bytesProxy.toJs ? bytesProxy.toJs() : (bytesProxy as unknown as Uint8Array);
      const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      outputs[name] = buf;
      transfers.push(buf);
      if (bytesProxy && bytesProxy.destroy) bytesProxy.destroy();
    }
    result.destroy();
    ctx.postMessage(
      { id, ok: true, outputs, workerExecMs, heapBytes: heapBytes(), pyodideVersion: SCRIPT_PYODIDE_VERSION },
      transfers,
    );
  } catch (e) {
    ctx.postMessage({
      id,
      ok: false,
      error: String(e && (e as Error).message ? (e as Error).message : e).slice(0, 4000),
    });
  }
}

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data as (InitRequest | BakeRequest) | null;
  if (!m || typeof m !== 'object') return;
  if ((m as InitRequest).kind === 'init') {
    if (readyPromise) return; // init is exactly-once; later ones are ignored
    readyPromise = init((m as InitRequest).indexURL);
    readyPromise.then(
      (stages) => ctx.postMessage({ ready: true, pyodideVersion: SCRIPT_PYODIDE_VERSION, stages }),
      (err: unknown) =>
        ctx.postMessage({
          ready: false,
          error: String(err && (err as Error).message ? (err as Error).message : err),
        }),
    );
    return;
  }
  if (typeof (m as BakeRequest).id === 'number') {
    void handleBake(m as BakeRequest);
  }
};
