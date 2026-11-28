// Layer 1 WP11 phase D — script-bake Worker wiring tests.
//
// What is pinned here (phase D's decided form, see
// lib/gpgpuScriptBakeRunner.ts):
// (a) lazy load: no Worker is constructed at runner
//     construction, nor for an OFF bake; the first enabled
//     bake constructs exactly one, later bakes reuse it;
// (b) the wire contract: the init message carries the
//     asset index URL, bake messages carry the phase-B
//     inputs (pos/vel/age triplets with shapes) and the
//     declared channels;
// (c) adoption: attrBake outputs come back as declared
//     channel columns and the output hash is recorded in
//     the store; initialState outputs convert to
//     GpgpuInitialData;
// (d) failure retention: a Worker error and a NaN output
//     both leave the last good bake and the recorded hash
//     untouched;
// (e) the per-frame cap: a Worker that never replies is
//     terminated at the frame cap, the bake fails as a
//     timeout, and the next bake builds a fresh Worker;
// (f) startup exclusion: a slow ready handshake does not
//     consume either cap;
// (g) the total cap: a frame sequence whose frames each
//     stay under the frame cap still fails at the total
//     cap, terminates the Worker, and records NOTHING
//     (sequence adoption is all-or-nothing);
// (h) asset discipline: no http(s) URL literal anywhere in
//     the wiring sources — every asset URL derives from
//     the one same-origin index URL.
//
// The Worker is a scripted fake: the real Pyodide execution
// is measured in the browser harness (see
// kalokagathia-pro/PYODIDE_WORKER_WIRING_RECORD.md).
//
// Run: node scripts/layer1-wp11-script-bake-worker.test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const S = await load('lib/gpgpuScriptBake.ts');
const R = await load('lib/gpgpuScriptBakeRunner.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fake worker -------------------------------------------------------------

function goodOutputs(count, fill = 0.25) {
  const mk = (n) => {
    const a = new Float32Array(n).fill(fill);
    return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
  };
  return {
    pos: mk(count * 3),
    vel: mk(count * 3),
    age: mk(count),
    'channel:rand': mk(count),
  };
}

class FakeWorker {
  constructor(script) {
    this.script = script;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.bakeCount = 0;
    this.lastInit = null;
    this.lastBake = null;
  }
  postMessage(msg) {
    if (msg && msg.kind === 'init') {
      this.lastInit = msg;
      const delay = this.script.readyDelayMs ?? 0;
      setTimeout(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: this.script.readyReply ?? { ready: true, pyodideVersion: '0.26.4', stages: { readyTotalMs: delay } } });
      }, delay);
      return;
    }
    this.bakeCount += 1;
    this.lastBake = msg;
    const behavior = this.script.onBake ? this.script.onBake(msg, this.bakeCount) : undefined;
    if (behavior === 'never') return;
    const delay = behavior?.delayMs ?? 0;
    setTimeout(() => {
      if (this.terminated) return;
      const reply = behavior?.reply ?? {
        id: msg.id, ok: true, outputs: goodOutputs(msg.count), workerExecMs: 1, pyodideVersion: '0.26.4',
      };
      this.onmessage?.({ data: reply });
    }, delay);
  }
  terminate() { this.terminated = true; }
}

function makeRunner(script, opts = {}) {
  const state = { factoryCalls: 0, workers: [] };
  const store = new S.GpgpuScriptBakeStore(opts.config ?? {});
  const runner = new R.GpgpuScriptBakeRunner(store, {
    workerFactory: () => {
      state.factoryCalls += 1;
      const w = new FakeWorker(script);
      state.workers.push(w);
      return w;
    },
    assetIndexUrl: 'https://example.invalid/app/pyodide/0.26.4/',
    frameTimeoutMs: opts.frameTimeoutMs,
    totalTimeoutMs: opts.totalTimeoutMs,
  });
  return { store, runner, state };
}

const COUNT = 8;
function makeInputs() {
  const posData = new Float32Array(COUNT * 4);
  const velData = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT * 4; i++) { posData[i] = i / 10; velData[i] = i / 20; }
  return S.scriptBakeInputsFromInitialData(posData, velData);
}
const ENABLED = {
  gpgpuScriptEnabled: true,
  gpgpuScriptTarget: 'attrBake',
  gpgpuScriptSource: 'import numpy as np\ndef bake(state):\n    state["channels"]["rand"] = state["pos"][:, 0]\n',
  gpgpuScriptSeed: 42,
};

// ---- (a) lazy load -----------------------------------------------------------
{
  const { runner, state } = makeRunner({}, { config: {} }); // OFF by default
  check('a construction does not build a worker', state.factoryCalls === 0 && runner.workerStarted === false);
  const off = await runner.bakeOne({ inputs: makeInputs() });
  check('a an OFF bake fails as OFF and still builds no worker',
    off.ok === false && state.factoryCalls === 0 && runner.workerStarted === false);
}
{
  const { runner, state } = makeRunner({}, { config: ENABLED });
  const one = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('a the first enabled bake builds exactly one worker', one.ok === true && state.factoryCalls === 1);
  const two = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('a the second bake reuses the worker', two.ok === true && state.factoryCalls === 1);
  runner.dispose();
}

// ---- (b) wire contract ---------------------------------------------------------
{
  const { runner, state } = makeRunner({}, { config: ENABLED });
  await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  const w = state.workers[0];
  check('b the init message carries the asset index URL',
    w.lastInit && w.lastInit.kind === 'init' && w.lastInit.indexURL === 'https://example.invalid/app/pyodide/0.26.4/');
  const msg = w.lastBake;
  check('b the bake message carries source/seed/count from the plan',
    msg.source === ENABLED.gpgpuScriptSource && msg.seed === 42 && msg.count === COUNT);
  check('b the bake message carries pos/vel/age triplets with shapes',
    msg.inputs.pos.shape.join(',') === `${COUNT},3` && msg.inputs.vel.shape.join(',') === `${COUNT},3`
    && msg.inputs.age.shape.join(',') === `${COUNT}`
    && msg.inputs.pos.buffer.byteLength === COUNT * 3 * 4);
  check('b the bake message carries the declared channels',
    Array.isArray(msg.declaredChannels) && msg.declaredChannels.join(',') === 'rand');
  runner.dispose();
}

// ---- (c) adoption --------------------------------------------------------------
{
  const { store, runner } = makeRunner({}, { config: ENABLED });
  const res = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('c attrBake adoption returns the declared channel column',
    res.ok === true && res.channels && res.channels.rand instanceof Float32Array && res.channels.rand.length === COUNT);
  check('c the output hash is recorded in the store',
    res.ok === true && store.current.gpgpuScriptOutputHash === res.hash && /^[0-9a-f]{64}$/.test(res.hash));
  check('c the recorded hash equals hashScriptOutputs of the outputs',
    res.ok === true && res.hash === S.hashScriptOutputs(res.outputs));
  check('c the last good bake is recorded with the source hash',
    store.lastGoodBake !== null && store.lastGoodBake.hash === res.hash
    && store.lastGoodBake.sourceHash === S.hashScriptSource(ENABLED.gpgpuScriptSource));
  runner.dispose();
}
{
  const cfg = { ...ENABLED, gpgpuScriptTarget: 'initialState' };
  const { runner } = makeRunner({}, { config: cfg });
  const res = await runner.bakeOne({ inputs: makeInputs() });
  check('c initialState adoption converts to GpgpuInitialData',
    res.ok === true && res.initialState && res.initialState.posData.length === COUNT * 4
    && res.initialState.velData.length === COUNT * 4);
  runner.dispose();
}

// ---- (d) failure retention -------------------------------------------------------
{
  let call = 0;
  const { store, runner } = makeRunner({
    onBake: (msg) => {
      call += 1;
      if (call === 2) return { reply: { id: msg.id, ok: false, error: 'RuntimeError: boom' } };
      if (call === 3) {
        const outputs = goodOutputs(msg.count);
        new Float32Array(outputs['channel:rand'])[0] = Number.NaN;
        return { reply: { id: msg.id, ok: true, outputs, workerExecMs: 1, pyodideVersion: '0.26.4' } };
      }
      return undefined;
    },
  }, { config: ENABLED });
  const good = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('d setup: the first bake succeeds', good.ok === true);
  const err = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('d a worker error fails and retains the good bake',
    err.ok === false && err.retained !== null && err.retained.hash === good.hash
    && store.current.gpgpuScriptOutputHash === good.hash);
  const nan = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('d a NaN output is refused and retains the good bake',
    nan.ok === false && store.lastGoodBake !== null && store.lastGoodBake.hash === good.hash
    && store.current.gpgpuScriptOutputHash === good.hash);
  runner.dispose();
}

// ---- (e) per-frame cap -------------------------------------------------------------
{
  let call = 0;
  const { runner, state } = makeRunner({
    onBake: () => { call += 1; return call === 1 ? 'never' : undefined; },
  }, { config: ENABLED, frameTimeoutMs: 60, totalTimeoutMs: 5000 });
  const t0 = performance.now();
  const res = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  const elapsed = performance.now() - t0;
  check('e a silent worker fails as a frame timeout near the cap',
    res.ok === false && res.timedOut === true && res.timeoutStage === 'frame' && elapsed >= 50 && elapsed < 2000);
  check('e the frame cap terminates the worker', state.workers[0].terminated === true);
  const next = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('e the next bake builds a fresh worker and succeeds',
    next.ok === true && state.factoryCalls === 2);
  runner.dispose();
}

// ---- (f) startup exclusion ---------------------------------------------------------
{
  const { runner } = makeRunner({ readyDelayMs: 300 }, {
    config: ENABLED, frameTimeoutMs: 120, totalTimeoutMs: 200,
  });
  const res = await runner.bakeOne({ inputs: makeInputs(), declaredChannels: ['rand'] });
  check('f a 300ms startup with 120/200ms caps still succeeds (caps start after ready)',
    res.ok === true && res.startupMs >= 250);
  runner.dispose();
}

// ---- (g) total cap + sequence atomicity ----------------------------------------------
{
  const { store, runner, state } = makeRunner({
    onBake: () => ({ delayMs: 40 }),
  }, { config: ENABLED, frameTimeoutMs: 1000, totalTimeoutMs: 90 });
  const reqs = Array.from({ length: 5 }, () => ({ inputs: makeInputs(), declaredChannels: ['rand'] }));
  const res = await runner.bakeFrames(reqs);
  check('g a sequence of in-frame-cap frames fails at the total cap',
    res.ok === false && res.timedOut === true && res.timeoutStage === 'total');
  check('g the total cap terminates the worker', state.workers[0].terminated === true);
  check('g nothing is recorded for a failed sequence',
    store.lastGoodBake === null && store.current.gpgpuScriptOutputHash === '');
  runner.dispose();
}
{
  const { store, runner } = makeRunner({}, { config: ENABLED });
  const reqs = Array.from({ length: 3 }, () => ({ inputs: makeInputs(), declaredChannels: ['rand'] }));
  const res = await runner.bakeFrames(reqs);
  check('g a good sequence succeeds with one result per frame',
    res.ok === true && res.frames.length === 3);
  check('g the store ends at the last frame\u2019s hash',
    res.ok === true && store.current.gpgpuScriptOutputHash === res.hash
    && res.hash === res.frames[2].hash && store.lastGoodBake !== null && store.lastGoodBake.hash === res.hash);
  runner.dispose();
}
{
  let call = 0;
  const { store, runner } = makeRunner({
    onBake: (msg) => {
      call += 1;
      if (call === 2) return { reply: { id: msg.id, ok: false, error: 'RuntimeError: mid-sequence' } };
      return undefined;
    },
  }, { config: ENABLED });
  const reqs = Array.from({ length: 3 }, () => ({ inputs: makeInputs(), declaredChannels: ['rand'] }));
  const res = await runner.bakeFrames(reqs);
  check('g a mid-sequence error records nothing (all-or-nothing)',
    res.ok === false && store.lastGoodBake === null && store.current.gpgpuScriptOutputHash === '');
  runner.dispose();
}

// ---- worker init failure --------------------------------------------------------------
{
  const { runner } = makeRunner({ readyReply: { ready: false, error: 'wasm load failed' } }, { config: ENABLED });
  const res = await runner.bakeOne({ inputs: makeInputs() });
  check('init failure surfaces as a bake failure with the reason',
    res.ok === false && /初期化に失敗/.test(res.error) && res.retained === null);
  runner.dispose();
}

// ---- (h) asset discipline --------------------------------------------------------------
{
  const runnerSrc = readFileSync(join(ROOT, 'lib/gpgpuScriptBakeRunner.ts'), 'utf8');
  const factorySrc = readFileSync(join(ROOT, 'lib/gpgpuScriptBakeWorkerFactory.ts'), 'utf8');
  const workerSrc = readFileSync(join(ROOT, 'workers/gpgpuScriptBakeWorker.ts'), 'utf8');
  check('h no http(s) URL literal in the wiring sources',
    !/https?:\/\//.test(runnerSrc) && !/https?:\/\//.test(factorySrc) && !/https?:\/\//.test(workerSrc));
  check('h the factory derives the asset URL from the app base + pinned version path',
    factorySrc.includes('pyodide/${SCRIPT_PYODIDE_VERSION}/') && factorySrc.includes('BASE_URL'));
  check('h the runner pins the Pyodide version',
    R.SCRIPT_PYODIDE_VERSION === '0.26.4');
  check('h the caps are the decided product values',
    R.SCRIPT_FRAME_TIMEOUT_MS === 2000 && R.SCRIPT_TOTAL_TIMEOUT_MS === 120000);
  await sleep(0);
}

console.log(`layer1-wp11-script-bake-worker: ${checks - failures}/${checks} checks passed`);
if (failures > 0) { console.error(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
