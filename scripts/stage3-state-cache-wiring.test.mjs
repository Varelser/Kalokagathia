// Grammar 2.0 stage 3, slice S0 wiring — the state cache
// CAPTURE wiring (lib/gpgpuStateCacheCapture.ts): the frame
// provider registry, capture-plan validation, the pure
// capture session (snapshot validation + 'age' derivation
// from the position w lane), the deterministic-job driver
// (fake sequence runner + fake provider, and once through
// the REAL renderDeterministicSequence with a registered
// fake handler so the onSimFrame seam itself is exercised),
// the manifest + binary file pair round trip, and the
// edition gate's single mapping place.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S0 / §4.5.
// The live GPU readback itself (real provider over real
// render targets, real browser) is NOT covered here — it
// stays on the unconfirmed list for the real-machine gate.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s0w-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { planStateCacheCapture, createStateCacheCaptureSession, pushStateCacheCaptureFrame, finishStateCacheCapture, runStateCacheCaptureJob, buildStateCacheFiles, loadStateCacheFromFiles, stateCacheEditionForPublicLibrary, registerStateCacheFrameProvider, getStateCacheFrameProvider, STATE_CACHE_MANIFEST_FILENAME, STATE_CACHE_FRAMES_FILENAME } from './lib/gpgpuStateCacheCapture.ts';
      export { stateCacheExportAllowed, stateCacheToPointCacheData } from './lib/gpgpuStateCache.ts';
      export { registerDeterministicRenderHandler } from './lib/deterministicRender.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  planStateCacheCapture, createStateCacheCaptureSession, pushStateCacheCaptureFrame,
  finishStateCacheCapture, runStateCacheCaptureJob, buildStateCacheFiles,
  loadStateCacheFromFiles, stateCacheEditionForPublicLibrary,
  registerStateCacheFrameProvider, getStateCacheFrameProvider,
  STATE_CACHE_MANIFEST_FILENAME, STATE_CACHE_FRAMES_FILENAME,
  stateCacheExportAllowed, stateCacheToPointCacheData,
  registerDeterministicRenderHandler,
} = lib;

const TEX = 2; const COUNT = TEX * TEX;
// Snapshot in readback shape: particle i of frame f sits at
// (i + f, i * 2, -i), age (position w) = i + f * 10,
// velocity (f, 1, i).
const snapshot = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f, i * 2, -i, i + f * 10], i * 4);
    velocities.set([f, 1, i, 0], i * 4);
  }
  return { texSize: TEX, positions, velocities };
};

// ── 1. Capture plan ─────────────────────────────────────────
{
  const okPlan = planStateCacheCapture({ fps: 30, frames: 60 });
  check('1 plan ok, warmup defaults to the deterministic default (30)',
    okPlan.ok === true && okPlan.plan.warmupFrames === 30);
  check('1 explicit zero warmup is honoured',
    planStateCacheCapture({ fps: 30, frames: 60, warmupFrames: 0 }).plan?.warmupFrames === 0);
  check('1 fps 0 refused', planStateCacheCapture({ fps: 0, frames: 60 }).ok === false);
  check('1 zero frames refused', planStateCacheCapture({ fps: 30, frames: 0 }).ok === false);
  check('1 frames above the shared cap refused',
    planStateCacheCapture({ fps: 30, frames: 3601 }).ok === false);
  check('1 frames at the cap accepted',
    planStateCacheCapture({ fps: 30, frames: 3600 }).ok === true);
}

// ── 2. Capture session ──────────────────────────────────────
{
  const session = createStateCacheCaptureSession({ fps: 30 });
  check('2 pushes accepted', [0, 1, 2].every((f) => pushStateCacheCaptureFrame(session, snapshot(f)).ok));
  const finished = finishStateCacheCapture(session);
  check('2 finish assembles a cache', finished.ok === true, finished.error ?? '');
  if (finished.ok) {
    check('2 age attribute derived from the position w lane',
      finished.cache.manifest.attributes[0] === 'age'
      && finished.cache.attrFrames[0][1][3] === 3 + 10
      && finished.cache.attrFrames[0][2][0] === 20);
    check('2 positions stored as triplets from the readback buffers',
      finished.cache.positions[2][0] === 2 && finished.cache.positions[2][3] === 1 + 2);
  }
  const mismatch = createStateCacheCaptureSession({ fps: 30 });
  pushStateCacheCaptureFrame(mismatch, snapshot(0));
  const bigSnap = { texSize: 4, positions: new Float32Array(64), velocities: new Float32Array(64) };
  check('2 texSize change mid-capture refused',
    pushStateCacheCaptureFrame(mismatch, bigSnap).ok === false);
  const short = createStateCacheCaptureSession({ fps: 30 });
  check('2 short readback buffer refused',
    pushStateCacheCaptureFrame(short, { texSize: TEX, positions: new Float32Array(8), velocities: new Float32Array(COUNT * 4) }).ok === false);
  const needy = createStateCacheCaptureSession({ fps: 30, attributeNames: ['heat'] });
  check('2 missing declared attribute refused',
    pushStateCacheCaptureFrame(needy, snapshot(0)).ok === false);
  const supplied = createStateCacheCaptureSession({ fps: 30, attributeNames: ['heat'] });
  const withHeat = snapshot(0);
  withHeat.attributes = { heat: new Float32Array(COUNT).fill(7) };
  check('2 supplied attribute carried',
    pushStateCacheCaptureFrame(supplied, withHeat).ok === true
    && finishStateCacheCapture(supplied).cache?.attrFrames[0][0][2] === 7);
  check('2 empty session refuses to finish',
    finishStateCacheCapture(createStateCacheCaptureSession({ fps: 30 })).ok === false);
}

// ── 3. Job driver with injected deps ────────────────────────
const fakeSequence = async (job, onProgress, onPart) => {
  for (let i = 0; i < job.frames; i++) {
    await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
    onProgress(i + 1, job.frames);
  }
  if (onPart) await onPart({ blob: null, part: 1, partCount: 1, firstFrame: 0, frames: job.frames, manifest: null });
  return [];
};
{
  let call = 0;
  const provider = () => snapshot(call++);
  const driven = await runStateCacheCaptureJob(
    { fps: 30, frames: 4, warmupFrames: 0 },
    undefined,
    { runSequence: fakeSequence, getProvider: () => provider },
  );
  check('3 driver assembles the provider frames in order',
    driven.ok === true && driven.cache.manifest.frameCount === 4
    && driven.cache.positions[3][0] === 3 && driven.cache.velocities[2][0] === 2,
    driven.error ?? '');
  check('3 driver refuses with no provider connected',
    (await runStateCacheCaptureJob({ fps: 30, frames: 2 }, undefined, { runSequence: fakeSequence, getProvider: () => null })).ok === false);
  let providerCalls = 0;
  const gated = await runStateCacheCaptureJob(
    { fps: 30, frames: 2, edition: 'public' },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => { providerCalls += 1; return snapshot(0); } },
  );
  check('3 public edition refused before any provider call',
    gated.ok === false && providerCalls === 0 && gated.error.includes('公開版'));
  const errored = await runStateCacheCaptureJob(
    { fps: 30, frames: 3 },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => ({ error: 'no-frame-yet' }) },
  );
  check('3 provider error aborts the take with the reason',
    errored.ok === false && errored.error.includes('no-frame-yet'));
  // The counter lives OUTSIDE the getter: the real
  // registry getter is referentially transparent (every
  // call returns the currently registered provider), and
  // the driver now resolves the provider per frame, so a
  // fake getter must follow the same contract.
  let vanishN = 0;
  const vanishing = await runStateCacheCaptureJob(
    { fps: 30, frames: 3 },
    undefined,
    {
      runSequence: fakeSequence,
      getProvider: () => () => (vanishN++ === 0 ? snapshot(0) : null),
    },
  );
  check('3 provider going silent mid-take aborts', vanishing.ok === false);
  check('3 driver refuses an over-cap plan before running',
    (await runStateCacheCaptureJob({ fps: 30, frames: 9999 }, undefined, { runSequence: fakeSequence, getProvider: () => provider })).ok === false);
}

// ── 4. The real sequence seam (registered handler + provider) ──
{
  let call = 0;
  const unregisterProvider = registerStateCacheFrameProvider(() => snapshot(call++));
  const unregisterHandler = registerDeterministicRenderHandler(async (job, onProgress) => {
    // Emulates DeterministicRenderManager's contract: per
    // captured frame it awaits onFrame, then onSimFrame
    // while the stepped state is still current.
    for (let i = 0; i < job.frames; i++) {
      if (job.onFrame) {
        await job.onFrame({ index: i, blob: new Uint8Array([137, 80, 78, 71]), width: 2, height: 2 });
      }
      if (job.onSimFrame) {
        await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
      }
      onProgress(i + 1, job.frames);
    }
    return { frames: [], width: 2, height: 2, warmupFrames: job.warmupFrames ?? 0, loop: null };
  });
  const seamed = await runStateCacheCaptureJob({ fps: 30, frames: 3, warmupFrames: 0 });
  check('4 driver over the real renderDeterministicSequence captures via onSimFrame',
    seamed.ok === true && seamed.cache.manifest.frameCount === 3 && seamed.cache.positions[1][0] === 1,
    seamed.error ?? '');
  unregisterHandler();
  unregisterProvider();
  check('4 registry is empty again after unregister', getStateCacheFrameProvider() === null);
}

// ── 5. File pair round trip ─────────────────────────────────
let savedCache = null;
{
  const session = createStateCacheCaptureSession({ fps: 24 });
  pushStateCacheCaptureFrame(session, snapshot(0));
  pushStateCacheCaptureFrame(session, snapshot(1));
  savedCache = finishStateCacheCapture(session).cache;
  const files = buildStateCacheFiles(savedCache);
  check('5 file names are the module constants',
    files.manifestFileName === STATE_CACHE_MANIFEST_FILENAME && files.framesFileName === STATE_CACHE_FRAMES_FILENAME);
  const map = new Map([
    [files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer],
    [files.framesFileName, files.framesBuffer],
  ]);
  const loaded = loadStateCacheFromFiles(map);
  check('5 load ok', loaded.ok === true, loaded.error ?? '');
  let identical = loaded.ok;
  if (loaded.ok) {
    for (let f = 0; f < 2; f++) {
      identical = identical
        && loaded.cache.positions[f].every((v, i) => v === savedCache.positions[f][i])
        && loaded.cache.velocities[f].every((v, i) => v === savedCache.velocities[f][i])
        && loaded.cache.attrFrames[0][f].every((v, i) => v === savedCache.attrFrames[0][f][i]);
    }
  }
  check('5 round trip bit-identical (positions / velocities / age)', identical);
  check('5 loaded cache converts onto the point-cache playback path',
    loaded.ok === true && stateCacheToPointCacheData(loaded.cache).ok === true);
  const noBin = new Map([[files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer]]);
  check('5 missing binary refused', loadStateCacheFromFiles(noBin).ok === false);
  const noJson = new Map([[files.framesFileName, files.framesBuffer]]);
  check('5 missing manifest refused', loadStateCacheFromFiles(noJson).ok === false);
  const corruptBuffer = files.framesBuffer.slice(0);
  new Uint8Array(corruptBuffer)[8] ^= 0xff;
  const corrupt = new Map([
    [files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer],
    [files.framesFileName, corruptBuffer],
  ]);
  check('5 corrupted binary refused by frame hash', loadStateCacheFromFiles(corrupt).ok === false);
  const withExtra = new Map(map);
  withExtra.set('extra.bin', files.framesBuffer.slice(0));
  check('5 canonical binary name wins over extra files',
    loadStateCacheFromFiles(withExtra).ok === true);
  const ambiguous = new Map([
    [files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer],
    ['a.bin', files.framesBuffer.slice(0)],
    ['b.bin', files.framesBuffer.slice(0)],
  ]);
  check('5 ambiguous binaries with no canonical name refused',
    loadStateCacheFromFiles(ambiguous).ok === false);
}

// ── 7. Remount swap (stage 5 gate M1 finding) ───────────────
// The deterministic job remounts the scene, and the
// remounted system registers a NEW frame provider. A job
// that captured the provider at start would keep reading
// the pre-remount system's frozen last frame. The driver
// must resolve the provider per frame instead.
{
  // (a) Injected deps: the sequence swaps the current
  // provider before stepping, as a remount does.
  const frozen = () => snapshot(999);
  let newCall = 0;
  const fresh = () => snapshot(newCall++);
  let current = frozen;
  const remountingSequence = async (job, onProgress, onPart) => {
    current = fresh;
    for (let i = 0; i < job.frames; i++) {
      await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
      onProgress(i + 1, job.frames);
    }
    if (onPart) await onPart({ blob: null, part: 1, partCount: 1, firstFrame: 0, frames: job.frames, manifest: null });
    return [];
  };
  const swapped = await runStateCacheCaptureJob(
    { fps: 30, frames: 3, warmupFrames: 0 },
    undefined,
    { runSequence: remountingSequence, getProvider: () => current },
  );
  check('7 frames come from the post-remount provider, not the frozen pre-remount one',
    swapped.ok === true && swapped.cache.manifest.frameCount === 3
    && swapped.cache.positions[0][0] === 0 && swapped.cache.positions[1][0] === 1
    && swapped.cache.positions[2][0] === 2,
    swapped.error ?? '');

  // (b) Real registry + real renderDeterministicSequence:
  // the handler re-registers a provider at its start,
  // exactly what the remounted scene system's effect does.
  let seamCall = 0;
  const unregisterOld = registerStateCacheFrameProvider(() => snapshot(999));
  let unregisterNew = null;
  const unregisterHandler = registerDeterministicRenderHandler(async (job, onProgress) => {
    unregisterNew = registerStateCacheFrameProvider(() => snapshot(seamCall++));
    for (let i = 0; i < job.frames; i++) {
      if (job.onFrame) {
        await job.onFrame({ index: i, blob: new Uint8Array([137, 80, 78, 71]), width: 2, height: 2 });
      }
      if (job.onSimFrame) {
        await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
      }
      onProgress(i + 1, job.frames);
    }
    return { frames: [], width: 2, height: 2, warmupFrames: job.warmupFrames ?? 0, loop: null };
  });
  const seamed = await runStateCacheCaptureJob({ fps: 30, frames: 3, warmupFrames: 0 });
  check('7 real seam: remount re-registration is picked up per frame',
    seamed.ok === true && seamed.cache.manifest.frameCount === 3
    && seamed.cache.positions[0][0] === 0 && seamed.cache.positions[2][0] === 2,
    seamed.error ?? '');
  unregisterHandler();
  if (unregisterNew) unregisterNew();
  unregisterOld();
  check('7 registry is empty again after unregister', getStateCacheFrameProvider() === null);
}

// ── 8. Edition mapping (single place) ───────────────────────
check('8 public library maps to the public edition and is refused',
  stateCacheEditionForPublicLibrary(true) === 'public'
  && stateCacheExportAllowed(stateCacheEditionForPublicLibrary(true)) === false);
check('8 private library maps to the full edition and is allowed',
  stateCacheEditionForPublicLibrary(false) === 'full'
  && stateCacheExportAllowed(stateCacheEditionForPublicLibrary(false)) === true);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
