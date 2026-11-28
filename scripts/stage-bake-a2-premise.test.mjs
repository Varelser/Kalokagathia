// Bake A-2 premise fixes (2026-11-28): the two premises
// whose absence made the A-2 resume gate unmeasurable
// (GATE_BAKE_V2_RECORD §7):
//   premise 1 — a deterministic capture job remounts the
//     scene, so an initial state applied to the live sim
//     never reached the job. Fixed by the applied-state
//     record (lib/gpgpuInitialState.ts) + the capture
//     driver's onSceneReady re-apply through the CURRENT
//     applier (lib/gpgpuStateCacheCapture.ts) + the job's
//     onSceneReady hook (lib/deterministicRender.ts).
//   premise 2 — posture had no seed entry. Fixed by the
//     initial data's orientData lane
//     (lib/gpgpuInitialData.ts), the v2 initial-state
//     driver (lib/gpgpuInitialState.ts) and the Orient
//     pass's seed entry + pending seed
//     (components/gpgpuOrientPass.ts).
// Covered here (pure / fake-GL level): the builder lane,
// the v2 driver's validation + refusal discipline, the
// record + re-apply across a simulated remount (applier
// swap), the capture job's carry-over through a fake
// sequence runner that remounts like the real manager,
// and the orient pass's seed bookkeeping with a fake GL
// (call pattern + state flags only — no real rendering).
// NOT covered here (real-machine gate, the A-2
// re-measurement): the live applier's real WebGL copies,
// the DeterministicRenderManager's actual remount, and
// whether a resumed sim matches the control bit for bit.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bake-a2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialDataFromStateFrame } from './lib/gpgpuInitialData.ts';
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export { assembleStateCacheV2 } from './lib/gpgpuStateCacheV2.ts';
      export {
        applyStateCacheFrameAsInitialState, applyStateCacheFrameV2AsInitialState,
        applyHeldStateCacheFrameV2AsInitialState, setHeldStateCacheV2, clearHeldStateCacheV2,
        getLastAppliedInitialState, clearLastAppliedInitialState, reapplyLastAppliedInitialState,
        registerStateCacheInitialStateApplier, stateCacheAgeColumnIndexV2,
      } from './lib/gpgpuInitialState.ts';
      export { runStateCacheCaptureJob } from './lib/gpgpuStateCacheCapture.ts';
      export {
        GpgpuOrientPass, requestPendingOrientSeed, takePendingOrientSeed,
        clearPendingOrientSeed, hasPendingOrientSeed,
      } from './components/gpgpuOrientPass.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildGpgpuInitialDataFromStateFrame,
  assembleStateCache, assembleStateCacheV2,
  applyStateCacheFrameAsInitialState, applyStateCacheFrameV2AsInitialState,
  applyHeldStateCacheFrameV2AsInitialState, setHeldStateCacheV2, clearHeldStateCacheV2,
  getLastAppliedInitialState, clearLastAppliedInitialState, reapplyLastAppliedInitialState,
  registerStateCacheInitialStateApplier, stateCacheAgeColumnIndexV2,
  runStateCacheCaptureJob,
  GpgpuOrientPass, requestPendingOrientSeed, takePendingOrientSeed,
  clearPendingOrientSeed, hasPendingOrientSeed,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => !!a && !!b && a.length === b.length && bits(a).equals(bits(b));

const TEX = 2;
const COUNT = TEX * TEX;
// Stored-shape frame pieces (triplets for pos/vel, a
// per-particle age column, unit quaternions for posture).
const storedPos = (f) => {
  const a = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) a.set([i + f, i * 2, -i], i * 3);
  return a;
};
const storedVel = (f) => {
  const a = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) a.set([f, 1, i], i * 3);
  return a;
};
const ages = (f) => {
  const a = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) a[i] = i + f * 10;
  return a;
};
const quats = (f) => {
  const a = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const s = 0.1 * (i + 1) + f * 0.05;
    a.set([0, s, 0, Math.sqrt(1 - s * s)], i * 4);
  }
  return a;
};
// Readback-shaped (count x 4) frame input for the assemblers.
const readback = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const p = storedPos(f); const v = storedVel(f); const ag = ages(f);
  for (let i = 0; i < COUNT; i++) {
    positions.set([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], ag[i]], i * 4);
    velocities.set([v[i * 3], v[i * 3 + 1], v[i * 3 + 2], 0], i * 4);
  }
  return { positions, velocities, attributes: { age: ag } };
};

const makeV1Cache = () => {
  const res = assembleStateCache({
    fps: 30, texSize: TEX, frames: [readback(0), readback(1)], attributeNames: ['age'],
  });
  if (!res.ok) throw new Error(`v1 fixture failed: ${res.error}`);
  return res.cache;
};
const makeV2Cache = (withOrientation = true, withAge = true) => {
  const res = assembleStateCacheV2({
    fps: 30,
    texSize: TEX,
    frames: [readback(0), readback(1)],
    attributeDecls: withAge ? [{ name: 'age', components: 1, source: 'sim-age' }] : [],
    orientations: withOrientation ? [quats(0), quats(1)] : null,
    provenance: { settingsHash: 'deadbeef', seed: 1, generator: 'monosphere', generatorVersion: 'test' },
  });
  if (!res.ok) throw new Error(`v2 fixture failed: ${res.error}`);
  return res.cache;
};
const recordingApplier = (sink, refuse = null) => (request) => {
  if (refuse) return { ok: false, error: refuse };
  sink.push(request);
  return { ok: true };
};

// ── 1. Builder: the orientData lane ─────────────────────
{
  const base = buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: storedPos(1), velocities: storedVel(1), ages: ages(1),
  });
  check('1 no orientations -> no orientData lane', base !== null && base.orientData === undefined);
  const src = quats(1);
  const withO = buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: storedPos(1), velocities: storedVel(1), ages: ages(1), orientations: src,
  });
  check('1 orientations -> orientData bit-identical to the frame posture',
    withO !== null && bitEqual(withO.orientData, src));
  check('1 pos/vel lanes unchanged by the posture lane',
    withO !== null && bitEqual(withO.posData, base.posData) && bitEqual(withO.velData, base.velData));
  const snapshot = new Float32Array(src);
  src[0] = 99;
  check('1 orientData is a detached copy', withO !== null && bitEqual(withO.orientData, snapshot));
  check('1 mis-sized orientations refuse the whole conversion',
    buildGpgpuInitialDataFromStateFrame({
      count: COUNT, positions: storedPos(1), velocities: storedVel(1), ages: ages(1),
      orientations: new Float32Array(COUNT * 4 - 4),
    }) === null);
}

// ── 2. v2 driver: posture reaches the applier ───────────
{
  clearLastAppliedInitialState();
  const cache = makeV2Cache();
  const sink = [];
  const applied = applyStateCacheFrameV2AsInitialState({
    cache, frameIndex: 1, applier: recordingApplier(sink),
  });
  check('2 v2 apply ok', applied.ok === true, applied.error ?? '');
  check('2 applier received the frame posture bit-identically',
    sink.length === 1 && bitEqual(sink[0].initialData.orientData, quats(1)));
  check('2 applier received positions with the age lane restored',
    sink.length === 1 && sink[0].initialData.posData[3] === ages(1)[0]
    && sink[0].initialData.posData[0] === storedPos(1)[0]);
  check('2 successful v2 apply is recorded for job carry-over',
    getLastAppliedInitialState()?.frameIndex === 1
    && bitEqual(getLastAppliedInitialState()?.initialData.orientData, quats(1)));

  const noSink = [];
  check('2 frame out of range refused',
    applyStateCacheFrameV2AsInitialState({ cache, frameIndex: 2, applier: recordingApplier(noSink) }).ok === false
    && noSink.length === 0);
  check('2 pool texSize mismatch refused (never resampled)',
    applyStateCacheFrameV2AsInitialState({ cache, frameIndex: 0, targetTexSize: 4, applier: recordingApplier(noSink) }).ok === false
    && noSink.length === 0);
  check('2 v2 cache without the age column refused',
    applyStateCacheFrameV2AsInitialState({ cache: makeV2Cache(true, false), frameIndex: 0, applier: recordingApplier(noSink) }).ok === false
    && noSink.length === 0);
  check('2 age column index resolves through the declarations',
    stateCacheAgeColumnIndexV2(cache) === 0 && stateCacheAgeColumnIndexV2(makeV2Cache(true, false)) === -1);

  const plainSink = [];
  const plain = applyStateCacheFrameV2AsInitialState({
    cache: makeV2Cache(false), frameIndex: 0, applier: recordingApplier(plainSink),
  });
  check('2 v2 cache without posture applies with no orientData (nothing invented)',
    plain.ok === true && plainSink.length === 1 && plainSink[0].initialData.orientData === undefined);

  // Held v2 store round trip.
  clearHeldStateCacheV2();
  check('2 held v2 apply refuses while nothing is held',
    applyHeldStateCacheFrameV2AsInitialState({ frameIndex: 0, applier: recordingApplier([]) }).ok === false);
  setHeldStateCacheV2(cache, 'fixture');
  const heldSink = [];
  check('2 held v2 apply works',
    applyHeldStateCacheFrameV2AsInitialState({ frameIndex: 0, applier: recordingApplier(heldSink) }).ok === true
    && bitEqual(heldSink[0]?.initialData.orientData, quats(0)));
  clearHeldStateCacheV2();
}

// ── 3. Record + re-apply across a simulated remount ─────
{
  clearLastAppliedInitialState();
  const cache = makeV1Cache();
  const liveSink = [];
  const applied = applyStateCacheFrameAsInitialState({
    cache, frameIndex: 1, applier: recordingApplier(liveSink),
  });
  check('3 v1 apply ok and recorded', applied.ok === true && getLastAppliedInitialState()?.frameIndex === 1);

  // Remount simulation: a NEW applier registers (the fresh
  // runtime), the old one is gone.
  const jobSink = [];
  const unregisterJob = registerStateCacheInitialStateApplier(recordingApplier(jobSink));
  const reapplied = reapplyLastAppliedInitialState();
  check('3 re-apply through the current applier ok', reapplied.ok === true, reapplied.error ?? '');
  check('3 the fresh applier received the recorded state bit-identically',
    jobSink.length === 1
    && bitEqual(jobSink[0].initialData.posData, liveSink[0].initialData.posData)
    && bitEqual(jobSink[0].initialData.velData, liveSink[0].initialData.velData));
  unregisterJob();

  // A refused apply never overwrites the record.
  clearLastAppliedInitialState();
  const refused = applyStateCacheFrameAsInitialState({
    cache, frameIndex: 0, applier: recordingApplier([], 'no'),
  });
  check('3 refused apply leaves no record',
    refused.ok === false && getLastAppliedInitialState() === null);
  check('3 re-apply with no record refuses with the reason',
    reapplyLastAppliedInitialState(recordingApplier([])).ok === false);
  clearLastAppliedInitialState();
}

// ── 4. Capture job carry-over (fake remounting runner) ──
{
  clearLastAppliedInitialState();
  const cache = makeV1Cache();
  const liveSink = [];
  applyStateCacheFrameAsInitialState({ cache, frameIndex: 1, applier: recordingApplier(liveSink) });

  const snapshot = (f) => {
    const positions = new Float32Array(COUNT * 4);
    const velocities = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      positions.set([i + f, i * 2, -i, i + f * 10], i * 4);
      velocities.set([f, 1, i, 0], i * 4);
    }
    return { texSize: TEX, positions, velocities };
  };
  const provider = () => snapshot(0);
  // A sequence runner that behaves like the real manager:
  // it "remounts" first (a new applier registers), awaits
  // onSceneReady, then steps the captured frames.
  const makeRunner = (jobSink, refuse = null) => async (job, onProgress) => {
    registerStateCacheInitialStateApplier(recordingApplier(jobSink, refuse));
    if (job.onSceneReady) await job.onSceneReady();
    for (let i = 0; i < job.frames; i++) {
      await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
      onProgress(i + 1, job.frames);
    }
    return { frames: [], width: 0, height: 0, warmupFrames: job.warmupFrames ?? 0, loop: null };
  };

  const jobSink = [];
  const jobResult = await runStateCacheCaptureJob(
    { fps: 30, frames: 3, warmupFrames: 0 },
    undefined,
    { runSequence: makeRunner(jobSink), getProvider: () => provider },
  );
  check('4 capture job with a recorded state completes', jobResult.ok === true, jobResult.error ?? '');
  check('4 the job-side applier received the recorded state (carry-over)',
    jobSink.length === 1 && bitEqual(jobSink[0].initialData.posData, liveSink[0].initialData.posData));

  const refuseSink = [];
  const refusedJob = await runStateCacheCaptureJob(
    { fps: 30, frames: 3, warmupFrames: 0 },
    undefined,
    { runSequence: makeRunner(refuseSink, 'job pool not ready'), getProvider: () => provider },
  );
  check('4 a failed re-apply refuses the whole capture with the reason',
    refusedJob.ok === false && (refusedJob.error ?? '').includes('引き継ぎ'),
    refusedJob.error ?? '');

  clearLastAppliedInitialState();
  const freshSink = [];
  const freshJob = await runStateCacheCaptureJob(
    { fps: 30, frames: 3, warmupFrames: 0 },
    undefined,
    { runSequence: makeRunner(freshSink), getProvider: () => provider },
  );
  check('4 with no record the job is the legacy take (no re-apply)',
    freshJob.ok === true && freshSink.length === 0, freshJob.error ?? '');
}

// ── 5. Orient pass: seed entry + pending seed ───────────
{
  clearPendingOrientSeed();
  check('5 no pending seed initially', hasPendingOrientSeed() === false);
  const seedA = quats(0);
  requestPendingOrientSeed(seedA, TEX);
  check('5 pending seed registered', hasPendingOrientSeed() === true);
  check('5 a pass of another size does not consume it',
    takePendingOrientSeed(4) === null && hasPendingOrientSeed() === true);
  const seedB = quats(1);
  requestPendingOrientSeed(seedB, TEX);
  check('5 a newer request replaces the pending seed',
    takePendingOrientSeed(TEX) === seedB && hasPendingOrientSeed() === false);
  check('5 take is one-shot', takePendingOrientSeed(TEX) === null);

  // Fake GL: records the render-target pattern only.
  const makeFakeGl = () => {
    const calls = { targets: [], renders: 0 };
    return {
      calls,
      getRenderTarget: () => null,
      setRenderTarget: (t) => { calls.targets.push(t); },
      render: () => { calls.renders += 1; },
    };
  };
  const pass = new GpgpuOrientPass(TEX);
  const gl = makeFakeGl();
  check('5 seedFromData refuses a mis-sized buffer and changes nothing',
    pass.seedFromData(gl, new Float32Array(8)) === false && pass.stateStarted === false);
  check('5 seedFromData copies into both ping-pong targets and starts the state',
    pass.seedFromData(gl, quats(0)) === true && gl.calls.renders === 2 && pass.stateStarted === true);

  // Pending seed consumption on the first run after
  // construction (the job-remount shape).
  clearPendingOrientSeed();
  requestPendingOrientSeed(quats(1), TEX);
  const pass2 = new GpgpuOrientPass(TEX);
  const gl2 = makeFakeGl();
  const tex = pass2.run(gl2, {
    posTex: null, velTex: null, attrTex: null, ageEnabled: true, dt: 1 / 30,
    orient: { mode: 'axis', speedRad: 0, random: 0, damping: 0, slot: -1 },
  });
  check('5 first run consumes the pending seed (2 seed copies + 1 step render)',
    tex !== null && gl2.calls.renders === 3 && hasPendingOrientSeed() === false && pass2.stateStarted === true,
    `renders=${gl2.calls.renders}`);
  const gl3 = makeFakeGl();
  pass2.run(gl3, {
    posTex: null, velTex: null, attrTex: null, ageEnabled: true, dt: 1 / 30,
    orient: { mode: 'axis', speedRad: 0, random: 0, damping: 0, slot: -1 },
  });
  check('5 later runs are the legacy single render (seed consumed once)',
    gl3.calls.renders === 1);
  pass.dispose();
  pass2.dispose();
  clearPendingOrientSeed();
  clearLastAppliedInitialState();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
