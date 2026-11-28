// Bake layer v2 — the PANEL wiring (2026-11-28): the call
// path that takes a v2 file pair from the panel's file
// input to the v2 initial-state driver, which the A-2
// re-measurement found missing (GATE_BAKE_V2_RECORD §8:
// the v2 driver had no caller in the app and was
// tree-shaken out of the production build).
// Covered here (pure level — the panel component itself is
// React and not unit-tested; this fixes the exact lib
// spine the panel calls, in the panel's call order):
//   - detectStateCacheFormat: the manifest-format dispatch
//     the panel's handleFiles uses ('v2' / 'v1' / null,
//     where null falls back to the v1 loader verbatim);
//   - loadStateCacheFromFilesV2: the v2 loader (file
//     disambiguation twin of the v1 loader, v2 reader with
//     its per-frame hash verification), including its
//     refusals (v1 pair, missing halves, corrupt binary,
//     ambiguous binary candidates);
//   - the chain load → v2 held store → apply through the
//     REGISTERED applier (the panel passes no applier —
//     the runtime's registration is the path), with the
//     frame's posture reaching the applier bit-identically
//     and the apply recorded for capture-job carry-over;
//   - the v2→point-cache playback conversion the panel
//     feeds the loaded cache into;
//   - v1 invariance: the v1 loader still loads a v1 pair
//     and still refuses a v2 pair with its format reason.
// NOT covered here: the panel's React rendering and the
// live applier's real WebGL copies (real-machine gate,
// the A-2 re-measurement).
// Record: kalokagathia-pro/BAKE_V2_PANEL_WIRING_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakev2panel-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export { assembleStateCacheV2, stateCacheV2ToPointCacheData, STATE_CACHE_FORMAT_V2 } from './lib/gpgpuStateCacheV2.ts';
      export {
        buildStateCacheFiles, buildStateCacheFilesV2,
        loadStateCacheFromFiles, loadStateCacheFromFilesV2, detectStateCacheFormat,
        STATE_CACHE_FRAMES_FILENAME,
      } from './lib/gpgpuStateCacheCapture.ts';
      export {
        setHeldStateCacheV2, getHeldStateCacheV2, clearHeldStateCacheV2,
        applyHeldStateCacheFrameV2AsInitialState,
        registerStateCacheInitialStateApplier,
        getLastAppliedInitialState, clearLastAppliedInitialState,
      } from './lib/gpgpuInitialState.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache, assembleStateCacheV2, stateCacheV2ToPointCacheData, STATE_CACHE_FORMAT_V2,
  buildStateCacheFiles, buildStateCacheFilesV2,
  loadStateCacheFromFiles, loadStateCacheFromFilesV2, detectStateCacheFormat,
  STATE_CACHE_FRAMES_FILENAME,
  setHeldStateCacheV2, getHeldStateCacheV2, clearHeldStateCacheV2,
  applyHeldStateCacheFrameV2AsInitialState,
  registerStateCacheInitialStateApplier,
  getLastAppliedInitialState, clearLastAppliedInitialState,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => !!a && !!b && a.length === b.length && bits(a).equals(bits(b));

const TEX = 2;
const COUNT = TEX * TEX;
// Same fixture law as the A-2 premise test: stored-shape
// triplets, a per-particle age column, unit quaternions.
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
const makeV2Cache = () => {
  const res = assembleStateCacheV2({
    fps: 30,
    texSize: TEX,
    frames: [readback(0), readback(1)],
    attributeDecls: [{ name: 'age', components: 1, source: 'sim-age' }],
    orientations: [quats(0), quats(1)],
    provenance: { settingsHash: 'deadbeef', seed: 1, generator: 'monosphere', generatorVersion: 'test' },
  });
  if (!res.ok) throw new Error(`v2 fixture failed: ${res.error}`);
  return res.cache;
};
const toFileMap = (files) => {
  const enc = new TextEncoder().encode(files.manifestText);
  const manifestBuffer = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
  return new Map([
    [files.manifestFileName, manifestBuffer],
    [files.framesFileName, files.framesBuffer],
  ]);
};

const v1Files = toFileMap(buildStateCacheFiles(makeV1Cache()));
const v2Files = toFileMap(buildStateCacheFilesV2(makeV2Cache()));

// ── 1. Format dispatch ──────────────────────────────────
{
  check('1 v2 pair detected as v2', detectStateCacheFormat(v2Files) === 'v2');
  check('1 v1 pair detected as v1', detectStateCacheFormat(v1Files) === 'v1');
  check('1 missing manifest -> null (v1 loader fallback)',
    detectStateCacheFormat(new Map([['x.bin', new ArrayBuffer(4)]])) === null);
  const notJson = new Map([
    ['a.json', new TextEncoder().encode('not json').buffer],
    ['a.bin', new ArrayBuffer(4)],
  ]);
  check('1 unparseable manifest -> null', detectStateCacheFormat(notJson) === null);
  const unknown = new Map([
    ['a.json', new TextEncoder().encode(JSON.stringify({ format: 'something-else' })).buffer],
    ['a.bin', new ArrayBuffer(4)],
  ]);
  check('1 unknown format -> null', detectStateCacheFormat(unknown) === null);
}

// ── 2. v2 load: the pair round-trips with posture ───────
let loadedV2 = null;
{
  const loaded = loadStateCacheFromFilesV2(v2Files);
  check('2 v2 pair loads', loaded.ok === true, loaded.error ?? '');
  if (loaded.ok) {
    loadedV2 = loaded.cache;
    check('2 manifest is the v2 format', loaded.cache.manifest.format === STATE_CACHE_FORMAT_V2);
    check('2 orientation channel present', loaded.cache.orientations !== null
      && loaded.cache.manifest.orientation?.encoding === 'quat-f32x4');
    check('2 orientations bit-identical to the fixture',
      bitEqual(loaded.cache.orientations[0], quats(0)) && bitEqual(loaded.cache.orientations[1], quats(1)));
    check('2 positions bit-identical to the fixture',
      bitEqual(loaded.cache.positions[1], storedPos(1)));
    check('2 age column survives as attribute frame 0',
      bitEqual(loaded.cache.attrFrames[0][1], ages(1)));
  }
}

// ── 3. v2 loader refusals ───────────────────────────────
{
  const v1ThroughV2 = loadStateCacheFromFilesV2(v1Files);
  check('3 v1 pair refused by the v2 loader (one format per loader)',
    v1ThroughV2.ok === false && v1ThroughV2.error.includes(STATE_CACHE_FORMAT_V2),
    v1ThroughV2.error ?? '');
  const onlyManifest = new Map([[...v2Files.entries()][0]]);
  check('3 missing .bin refused', loadStateCacheFromFilesV2(onlyManifest).ok === false);
  const onlyBin = new Map([[...v2Files.entries()][1]]);
  check('3 missing .json refused', loadStateCacheFromFilesV2(onlyBin).ok === false);
  const corruptBuffer = v2Files.get('monosphere-state-cache.bin').slice(0);
  new Uint8Array(corruptBuffer)[0] ^= 0xff;
  const corrupt = new Map([
    ['monosphere-state-cache.json', v2Files.get('monosphere-state-cache.json')],
    ['monosphere-state-cache.bin', corruptBuffer],
  ]);
  const corruptResult = loadStateCacheFromFilesV2(corrupt);
  check('3 corrupt binary refused by the frame-hash verification',
    corruptResult.ok === false && corruptResult.error.includes('ハッシュ'),
    corruptResult.error ?? '');
  const withExtra = new Map(v2Files);
  withExtra.set('notes.txt', new TextEncoder().encode('memo').buffer);
  check('3 extra file alongside the canonical frames name still resolves',
    loadStateCacheFromFilesV2(withExtra).ok === true);
  const ambiguous = new Map([
    ['monosphere-state-cache.json', v2Files.get('monosphere-state-cache.json')],
    ['a.bin', v2Files.get('monosphere-state-cache.bin')],
    ['b.bin', v2Files.get('monosphere-state-cache.bin')],
  ]);
  check('3 two unnamed binary candidates refused as ambiguous',
    loadStateCacheFromFilesV2(ambiguous).ok === false);
  check('3 canonical frames filename is the shared constant',
    STATE_CACHE_FRAMES_FILENAME === 'monosphere-state-cache.bin');
}

// ── 4. The panel chain: hold -> apply via the registry ──
{
  clearHeldStateCacheV2();
  clearLastAppliedInitialState();
  const refused = applyHeldStateCacheFrameV2AsInitialState({ frameIndex: 0 });
  check('4 apply with nothing held refuses with the held-store reason',
    refused.ok === false && refused.error.includes('保持されていません'),
    refused.error ?? '');
  setHeldStateCacheV2(loadedV2, '読み込んだ状態キャッシュ（v2）');
  const heldNow = getHeldStateCacheV2();
  check('4 held store round-trips with its source name',
    heldNow !== null && heldNow.cache === loadedV2
    && heldNow.sourceName === '読み込んだ状態キャッシュ（v2）');
  const sink = [];
  const unregister = registerStateCacheInitialStateApplier((request) => {
    sink.push(request);
    return { ok: true };
  });
  // The panel passes no applier: the registered runtime
  // applier is the path, exactly as in the app.
  const applied = applyHeldStateCacheFrameV2AsInitialState({ frameIndex: 1 });
  check('4 held v2 frame applies through the registered applier',
    applied.ok === true, applied.error ?? '');
  check('4 applier received the frame posture bit-identically',
    sink.length === 1 && bitEqual(sink[0].initialData.orientData, quats(1)));
  check('4 applier received positions with the age lane restored',
    sink.length === 1 && sink[0].initialData.posData[3] === ages(1)[0]
    && sink[0].initialData.posData[0] === storedPos(1)[0]);
  check('4 the apply is recorded for capture-job carry-over',
    getLastAppliedInitialState()?.frameIndex === 1
    && bitEqual(getLastAppliedInitialState()?.initialData.orientData, quats(1)));
  unregister();
  const noApplier = applyHeldStateCacheFrameV2AsInitialState({ frameIndex: 0 });
  check('4 apply with no applier registered refuses (channel not connected)',
    noApplier.ok === false && noApplier.error.includes('接続されていません'),
    noApplier.error ?? '');
  clearHeldStateCacheV2();
  check('4 cleared held store reads back empty', getHeldStateCacheV2() === null);
}

// ── 5. Playback conversion the panel feeds ──────────────
{
  const converted = stateCacheV2ToPointCacheData(loadedV2);
  check('5 v2 -> point-cache conversion succeeds for playback',
    converted.ok === true, converted.error ?? '');
  check('5 conversion reports the dropped orientation honestly',
    converted.ok === true && converted.droppedOrientation === true
    && converted.note.includes('姿勢'));
}

// ── 6. v1 invariance ────────────────────────────────────
{
  const v1Loaded = loadStateCacheFromFiles(v1Files);
  check('6 v1 pair still loads through the v1 loader', v1Loaded.ok === true, v1Loaded.error ?? '');
  const v2ThroughV1 = loadStateCacheFromFiles(v2Files);
  check('6 v2 pair still refused by the v1 loader with its format reason',
    v2ThroughV1.ok === false && v2ThroughV1.error.includes('format'),
    v2ThroughV1.error ?? '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
