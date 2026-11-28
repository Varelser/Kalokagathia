// Bake layer v2 — the CAPTURE / SAVE wiring
// (lib/gpgpuStateCacheCapture.ts on top of the v2 format):
// the frame snapshot's orientation channel (supplied by the
// Orient pass's published current target in the live app),
// the capture session's whole-channel discipline, the v2
// finish (assembleStateCacheV2 with declared sources +
// provenance), the v2 job driver and file pair, and the
// guarantee that the v1 path is byte-for-byte the legacy
// one. The live GPU readback itself (real provider over
// real render targets) is NOT covered here — it is the
// real-machine gate's subject (GATE_BAKE_V2_PREREG A-1/A-2).
// Design: kalokagathia-pro/expanded-ruler/bake-layer-design.md.
// Record: kalokagathia-pro/BAKE_V2_WIRING_IMPL_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakev2w-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export {
        createStateCacheCaptureSession, pushStateCacheCaptureFrame,
        finishStateCacheCapture, finishStateCacheCaptureV2,
        runStateCacheCaptureJob, runStateCacheCaptureJobV2,
        buildStateCacheFiles, buildStateCacheFilesV2,
        buildStateCacheCaptureProvenance, loadStateCacheFromFiles,
      } from './lib/gpgpuStateCacheCapture.ts';
      export {
        parseStateCacheManifestV2, decodeStateCacheFramesV2,
        extractStateCacheFrameV2, buildCheckpointRef,
        verifyCheckpointCanSeedInitialState, STATE_CACHE_FORMAT_V2,
      } from './lib/gpgpuStateCacheV2.ts';
      export { parseStateCacheManifest } from './lib/gpgpuStateCache.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  createStateCacheCaptureSession, pushStateCacheCaptureFrame,
  finishStateCacheCapture, finishStateCacheCaptureV2,
  runStateCacheCaptureJob, runStateCacheCaptureJobV2,
  buildStateCacheFiles, buildStateCacheFilesV2,
  buildStateCacheCaptureProvenance, loadStateCacheFromFiles,
  parseStateCacheManifestV2, decodeStateCacheFramesV2,
  extractStateCacheFrameV2, buildCheckpointRef,
  verifyCheckpointCanSeedInitialState, STATE_CACHE_FORMAT_V2,
  parseStateCacheManifest,
} = lib;

const TEX = 2; const COUNT = TEX * TEX;
// Snapshot in readback shape (same law as the S0 wiring
// test): particle i of frame f sits at (i + f, i * 2, -i),
// age (position w) = i + f * 10, velocity (f, 1, i).
const snapshot = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f, i * 2, -i, i + f * 10], i * 4);
    velocities.set([f, 1, i, 0], i * 4);
  }
  return { texSize: TEX, positions, velocities };
};
// Posture in the Orient RT's shape: unit quaternion about
// the fixed Y axis, angle f * 0.25 + i * 0.1 for particle i
// of frame f (x, y, z, w order).
const orientFrame = (f) => {
  const q = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const half = (f * 0.25 + i * 0.1) / 2;
    q.set([0, Math.sin(half), 0, Math.cos(half)], i * 4);
  }
  return q;
};
const orientedSnapshot = (f) => {
  const s = snapshot(f);
  s.orientations = orientFrame(f);
  return s;
};
const fakeSequence = async (job, onProgress, onPart) => {
  for (let i = 0; i < job.frames; i++) {
    await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
    onProgress(i + 1, job.frames);
  }
  if (onPart) await onPart({ blob: null, part: 1, partCount: 1, firstFrame: 0, frames: job.frames, manifest: null });
  return [];
};
const PROV = buildStateCacheCaptureProvenance({
  settingsSnapshot: { gpgpuSeed: 42, gpgpuOrientEnabled: true },
  seed: 42,
  generatorVersion: 'wiring-test',
});

// ── 1. Session channel discipline ───────────────────────
{
  const s = createStateCacheCaptureSession({ fps: 30 });
  check('1 oriented pushes accepted, channel decided present',
    [0, 1].every((f) => pushStateCacheCaptureFrame(s, orientedSnapshot(f)).ok)
    && s.orientationChannel === true && s.orientations.length === 2);
  const short = createStateCacheCaptureSession({ fps: 30 });
  const bad = orientedSnapshot(0);
  bad.orientations = new Float32Array(COUNT * 3);
  check('1 short orientation buffer refused',
    pushStateCacheCaptureFrame(short, bad).ok === false);
  const appears = createStateCacheCaptureSession({ fps: 30 });
  pushStateCacheCaptureFrame(appears, snapshot(0));
  check('1 channel appearing mid-take refused',
    pushStateCacheCaptureFrame(appears, orientedSnapshot(1)).ok === false);
  const vanishes = createStateCacheCaptureSession({ fps: 30 });
  pushStateCacheCaptureFrame(vanishes, orientedSnapshot(0));
  check('1 channel vanishing mid-take refused',
    pushStateCacheCaptureFrame(vanishes, snapshot(1)).ok === false);
  const plain = createStateCacheCaptureSession({ fps: 30 });
  pushStateCacheCaptureFrame(plain, snapshot(0));
  check('1 un-oriented take decides channel absent',
    plain.orientationChannel === false && plain.orientations.length === 0);
}

// ── 2. v2 job → v2 files → v2 reader round trip ─────────
let capturedV2 = null;
{
  let call = 0;
  const driven = await runStateCacheCaptureJobV2(
    { fps: 30, frames: 4, warmupFrames: 0, provenance: PROV },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => orientedSnapshot(call++) },
  );
  check('2 v2 job assembles', driven.ok === true, driven.error ?? '');
  if (driven.ok) {
    capturedV2 = driven.cache;
    const m = driven.cache.manifest;
    check('2 manifest is v2 with the orientation declaration',
      m.format === STATE_CACHE_FORMAT_V2 && m.version === 2
      && m.orientation !== null && m.orientation.encoding === 'quat-f32x4');
    check('2 attribute declarations carry capture-side sources',
      m.attributes.length === 1 && m.attributes[0].name === 'age'
      && m.attributes[0].components === 1 && m.attributes[0].source === 'sim-age');
    check('2 provenance stamped from the builder',
      m.provenance !== null && m.provenance.seed === 42
      && m.provenance.generator === 'monosphere'
      && m.provenance.generatorVersion === 'wiring-test'
      && typeof m.provenance.settingsHash === 'string' && m.provenance.settingsHash.length === 8);
    const files = buildStateCacheFilesV2(driven.cache);
    const parsed = parseStateCacheManifestV2(files.manifestText);
    check('2 v2 manifest parses back', 'manifest' in parsed, parsed.error ?? '');
    if ('manifest' in parsed) {
      const decoded = decodeStateCacheFramesV2(parsed.manifest, files.framesBuffer);
      check('2 v2 reader decodes the pair (its own hash validation passes)',
        decoded.ok === true, decoded.error ?? '');
      if (decoded.ok) {
        let orientBitEqual = true;
        let posBitEqual = true;
        for (let f = 0; f < 4; f++) {
          const want = orientFrame(f);
          const got = decoded.cache.orientations[f];
          for (let i = 0; i < COUNT * 4; i++) if (got[i] !== want[i]) orientBitEqual = false;
          const snap = snapshot(f);
          for (let i = 0; i < COUNT; i++) {
            if (decoded.cache.positions[f][i * 3] !== snap.positions[i * 4]
              || decoded.cache.positions[f][i * 3 + 1] !== snap.positions[i * 4 + 1]
              || decoded.cache.positions[f][i * 3 + 2] !== snap.positions[i * 4 + 2]) posBitEqual = false;
          }
        }
        check('2 orientations round-trip bit-exact', orientBitEqual);
        check('2 positions round-trip bit-exact', posBitEqual);
        check('2 age column is the derived w lane after the round trip',
          decoded.cache.attrFrames[0][2][3] === 3 + 2 * 10);
        check('2 frame hashes survive the round trip unchanged',
          decoded.cache.manifest.frameHashes.join(',') === m.frameHashes.join(','));
      }
    }
  }
}

// ── 3. v2 job over an un-oriented take ──────────────────
{
  let call = 0;
  const driven = await runStateCacheCaptureJobV2(
    { fps: 30, frames: 2, warmupFrames: 0, provenance: PROV },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => snapshot(call++) },
  );
  check('3 un-oriented take assembles as v2 declaring no channel',
    driven.ok === true && driven.cache.manifest.orientation === null
    && driven.cache.orientations === null,
    driven.error ?? '');
  check('3 v2 job still refuses the public edition',
    (await runStateCacheCaptureJobV2(
      { fps: 30, frames: 2, edition: 'public', provenance: PROV },
      undefined,
      { runSequence: fakeSequence, getProvider: () => () => orientedSnapshot(0) },
    )).ok === false);
  // The counter lives OUTSIDE the getter: the real
  // registry getter is referentially transparent (every
  // call returns the currently registered provider) and
  // the driver resolves the provider per frame, so a fake
  // getter must follow the same contract (the S0 wiring
  // test's vanishing case documents the same trap).
  let vanishN = 0;
  const vanishingProvider = () => (vanishN++ === 0 ? orientedSnapshot(0) : snapshot(1));
  const midError = await runStateCacheCaptureJobV2(
    { fps: 30, frames: 3, warmupFrames: 0, provenance: PROV },
    undefined,
    { runSequence: fakeSequence, getProvider: () => vanishingProvider },
  );
  check('3 channel vanishing mid-job aborts the v2 take with the reason',
    midError.ok === false && midError.error.includes('姿勢'));
}

// ── 4. v1 path unchanged ────────────────────────────────
{
  let call = 0;
  const driven = await runStateCacheCaptureJob(
    { fps: 30, frames: 3, warmupFrames: 0 },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => orientedSnapshot(call++) },
  );
  check('4 v1 job over oriented snapshots still assembles v1',
    driven.ok === true && driven.cache.manifest.format === 'statecache-manifest-v1',
    driven.error ?? '');
  if (driven.ok) {
    check('4 v1 values are the legacy ones (posture is not in the format)',
      driven.cache.positions[2][0] === 2 && driven.cache.velocities[2][0] === 2
      && driven.cache.manifest.attributes[0] === 'age');
    // The v2 reader accepts the v1 pair (read compatibility
    // is the reader's designed behaviour, unchanged).
    const files = buildStateCacheFiles(driven.cache);
    const parsed = parseStateCacheManifestV2(files.manifestText);
    check('4 v2 reader still reads the v1 pair as v1 (no orientation)',
      'manifest' in parsed && parsed.manifest.sourceVersion === 1 && parsed.manifest.orientation === null);
  }
  // And the v1 reader refuses a v2 pair with its format
  // mismatch — the designed no-forward-compatibility.
  if (capturedV2) {
    const files = buildStateCacheFilesV2(capturedV2);
    const asMap = new Map([
      [files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer],
      [files.framesFileName, files.framesBuffer],
    ]);
    const loaded = loadStateCacheFromFiles(asMap);
    check('4 v1 loader refuses the v2 pair (format mismatch, unchanged)',
      loaded.ok === false);
    const parsedV1 = parseStateCacheManifest(files.manifestText);
    check('4 v1 manifest parser refuses the v2 manifest', 'error' in parsedV1);
  }
}

// ── 5. Provenance builder ───────────────────────────────
{
  const a = buildStateCacheCaptureProvenance({
    settingsSnapshot: { b: 2, a: { y: 1, x: 2 } }, seed: 7, generatorVersion: 'v',
  });
  const b = buildStateCacheCaptureProvenance({
    settingsSnapshot: { a: { x: 2, y: 1 }, b: 2 }, seed: 7, generatorVersion: 'v',
  });
  check('5 settings hash is key-order independent', a.settingsHash === b.settingsHash);
  const c = buildStateCacheCaptureProvenance({
    settingsSnapshot: { a: { x: 2, y: 1 }, b: 3 }, seed: 7, generatorVersion: 'v',
  });
  check('5 settings hash changes with the settings', a.settingsHash !== c.settingsHash);
  check('5 fields pass through (generator fixed to this app)',
    a.generator === 'monosphere' && a.seed === 7 && a.generatorVersion === 'v');
  const s = createStateCacheCaptureSession({ fps: 30 });
  pushStateCacheCaptureFrame(s, orientedSnapshot(0));
  check('5 v2 finish without provenance is refused by the format',
    finishStateCacheCaptureV2(s, null).ok === false);
  check('5 v1 finish of the same session is unaffected',
    finishStateCacheCapture(s).ok === true);
}

// ── 6. Checkpoint seam over a wired capture ─────────────
{
  check('6 captured cache available for the seam checks', capturedV2 !== null);
  if (capturedV2) {
    const cut = extractStateCacheFrameV2(capturedV2, 2);
    check('6 checkpoint cut is a single frame', cut.ok === true && cut.cache.manifest.frameCount === 1);
    if (cut.ok) {
      const ref = buildCheckpointRef(capturedV2, 2, 'wiring-test-checkpoint');
      check('6 checkpoint ref hash equals the source frame hash',
        ref.hash === capturedV2.manifest.frameHashes[2]
        && cut.cache.manifest.frameHashes[0] === ref.hash);
      check('6 checkpoint carries its posture frame',
        cut.cache.orientations !== null && cut.cache.orientations.length === 1);
      const seed = verifyCheckpointCanSeedInitialState(cut.cache);
      check('6 checkpoint seeds the S1 conversion at data level',
        seed.ok === true, seed.error ?? '');
    }
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
