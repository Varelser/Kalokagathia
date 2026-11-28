// Bake gate A-4 premise fix — the state-cache DEDICATED
// playback path (lib/gpgpuStateCachePlayback.ts): one frame
// of a held v2 cache becomes the two texture-shaped arrays
// the GPGPU geometry draw consumes (positions xyz+age, and
// the posture channel verbatim), so a cached frame's
// posture can be PRESENTED through uOrientTex — the path
// GATE_BAKE_V2_PREREG §A-4 assumed and GATE_BAKE_V2_RECORD
// §11 found missing.
// Covered here (pure level — the scene side's DataTexture
// uploads and the panel's React rendering are not
// unit-tested; this fixes the exact lib spine both call):
//   - buildStateCachePlaybackFrameData: position layout
//     (stored triplets + age column -> xyzw), posture
//     reaching the frame data bit-identically and detached
//     from the cache's buffers;
//   - its refusals (frame out of range, no orientation
//     channel, declared-but-missing posture data, missing
//     frame in the channel, no age column, mis-sized
//     buffers) — posture is never dropped silently;
//   - the playback store: pointing at a cache stops any
//     presentation and resets the frame position; start /
//     frame naming / stop; resolve memoization identity
//     (the scene keys texture uploads on it); target
//     texSize refusal (never resampled);
//   - existing-path invariance: the point-cache conversion
//     still drops posture BY DESIGN (droppedOrientation),
//     and the v2 initial-state driver still applies a
//     frame with its posture through a fake applier.
// Record: kalokagathia-pro/BAKE_PLAYBACK_PATH_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakeplayback-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCacheV2, stateCacheV2ToPointCacheData } from './lib/gpgpuStateCacheV2.ts';
      export {
        buildStateCachePlaybackFrameData,
        setStateCachePlaybackCache, clearStateCachePlaybackCache, getStateCachePlayback,
        setStateCachePlaybackFrameIndex, startStateCachePlayback, stopStateCachePlayback,
        resolveActiveStateCachePlaybackFrame,
      } from './lib/gpgpuStateCachePlayback.ts';
      export {
        applyStateCacheFrameV2AsInitialState,
      } from './lib/gpgpuInitialState.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCacheV2, stateCacheV2ToPointCacheData,
  buildStateCachePlaybackFrameData,
  setStateCachePlaybackCache, clearStateCachePlaybackCache, getStateCachePlayback,
  setStateCachePlaybackFrameIndex, startStateCachePlayback, stopStateCachePlayback,
  resolveActiveStateCachePlaybackFrame,
  applyStateCacheFrameV2AsInitialState,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => !!a && !!b && a.length === b.length && bits(a).equals(bits(b));

const TEX = 2;
const COUNT = TEX * TEX;
// Same fixture law as the panel-wiring test: stored-shape
// triplets, a per-particle age column, non-trivial quats.
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
const makeV2Cache = (withOrientation = true) => {
  const res = assembleStateCacheV2({
    fps: 30,
    texSize: TEX,
    frames: [readback(0), readback(1)],
    attributeDecls: [{ name: 'age', components: 1, source: 'sim-age' }],
    orientations: withOrientation ? [quats(0), quats(1)] : undefined,
    provenance: { settingsHash: 'deadbeef', seed: 1, generator: 'monosphere', generatorVersion: 'test' },
  });
  if (!res.ok) throw new Error(`v2 fixture failed: ${res.error}`);
  return res.cache;
};

// ── 1. Frame builder: layout + posture delivery ─────────
{
  const cache = makeV2Cache();
  const built = buildStateCachePlaybackFrameData({ cache, frameIndex: 1 });
  check('1 frame builds', built.ok === true, built.error ?? '');
  if (built.ok) {
    const { frame } = built;
    check('1 frame carries texSize / count / index',
      frame.texSize === TEX && frame.count === COUNT && frame.frameIndex === 1);
    // Position texture shape: xyz from the stored triplets,
    // w from the age column — the bake's layout.
    const expectedPos = new Float32Array(COUNT * 4);
    const p = storedPos(1); const ag = ages(1);
    for (let i = 0; i < COUNT; i++) expectedPos.set([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], ag[i]], i * 4);
    check('1 positionData is xyz + age, bit-identical', bitEqual(frame.positionData, expectedPos));
    check('1 orientationData reaches the draw bit-identically',
      bitEqual(frame.orientationData, quats(1)));
    // Detached copy: scribbling on the frame data must not
    // reach back into the held cache.
    frame.orientationData[0] = 999;
    frame.positionData[0] = 999;
    check('1 frame data is detached from the cache buffers',
      cache.orientations[1][0] === quats(1)[0] && cache.positions[1][0] === storedPos(1)[0]);
  }
}

// ── 2. Frame builder refusals ───────────────────────────
{
  const cache = makeV2Cache();
  check('2 frame above range refused',
    buildStateCachePlaybackFrameData({ cache, frameIndex: 2 }).ok === false);
  check('2 negative frame refused',
    buildStateCachePlaybackFrameData({ cache, frameIndex: -1 }).ok === false);
  check('2 non-integer frame refused',
    buildStateCachePlaybackFrameData({ cache, frameIndex: 0.5 }).ok === false);

  const noPosture = makeV2Cache(false);
  const refused = buildStateCachePlaybackFrameData({ cache: noPosture, frameIndex: 0 });
  check('2 cache without the orientation channel refused (never played back posture-less)',
    refused.ok === false && refused.error.includes('姿勢チャンネルが無い'),
    refused.error ?? '');

  const declaredMissing = makeV2Cache();
  declaredMissing.orientations = null; // manifest still declares the channel
  const dm = buildStateCachePlaybackFrameData({ cache: declaredMissing, frameIndex: 0 });
  check('2 declared-but-missing posture data refused',
    dm.ok === false && dm.error.includes('姿勢データがありません'), dm.error ?? '');

  const missingFrame = makeV2Cache();
  missingFrame.orientations = [quats(0)];
  const mf = buildStateCachePlaybackFrameData({ cache: missingFrame, frameIndex: 1 });
  check('2 frame missing from the channel refused',
    mf.ok === false && mf.error.includes('姿勢データが姿勢チャンネルにありません'), mf.error ?? '');

  const noAge = makeV2Cache();
  noAge.manifest = { ...noAge.manifest, attributes: [{ name: 'other', components: 1, source: 'x' }] };
  const na = buildStateCachePlaybackFrameData({ cache: noAge, frameIndex: 0 });
  check('2 cache without the age column refused',
    na.ok === false && na.error.includes('age'), na.error ?? '');

  const misSized = makeV2Cache();
  misSized.positions = [new Float32Array(3), misSized.positions[1]];
  check('2 mis-sized frame buffers refused',
    buildStateCachePlaybackFrameData({ cache: misSized, frameIndex: 0 }).ok === false);
}

// ── 3. Store: point / name / start / stop / resolve ─────
{
  clearStateCachePlaybackCache();
  check('3 resolve is null with no cache', resolveActiveStateCachePlaybackFrame() === null);
  check('3 start refuses with no cache', startStateCachePlayback().ok === false);
  check('3 frame naming refuses with no cache', setStateCachePlaybackFrameIndex(0).ok === false);

  const cache = makeV2Cache();
  setStateCachePlaybackCache(cache, 'fixture');
  const store0 = getStateCachePlayback();
  check('3 pointing stores the cache, stopped, at frame 0',
    !!store0 && store0.cache === cache && store0.active === false && store0.frameIndex === 0);
  check('3 resolve is null while stopped', resolveActiveStateCachePlaybackFrame() === null);

  check('3 frame naming out of range refused', setStateCachePlaybackFrameIndex(2).ok === false);
  const started = startStateCachePlayback({ frameIndex: 1, targetTexSize: TEX });
  check('3 start succeeds with matching texSize', started.ok === true, started.error ?? '');
  const resolved1 = resolveActiveStateCachePlaybackFrame();
  check('3 resolve returns the named frame',
    !!resolved1 && resolved1.frameIndex === 1 && bitEqual(resolved1.orientationData, quats(1)));
  check('3 resolve is memoized (stable identity across calls)',
    resolveActiveStateCachePlaybackFrame() === resolved1);

  const renamed = setStateCachePlaybackFrameIndex(0);
  check('3 frame can be re-named while active', renamed.ok === true);
  const resolved0 = resolveActiveStateCachePlaybackFrame();
  check('3 resolve follows the re-named frame',
    !!resolved0 && resolved0 !== resolved1 && resolved0.frameIndex === 0
      && bitEqual(resolved0.orientationData, quats(0)));

  stopStateCachePlayback();
  check('3 stop ends the presentation', resolveActiveStateCachePlaybackFrame() === null
    && getStateCachePlayback()?.active === false);

  const mismatch = startStateCachePlayback({ targetTexSize: TEX * 2 });
  check('3 start refuses a texSize mismatch (never resampled)',
    mismatch.ok === false && mismatch.error.includes('リサンプル'),
    mismatch.error ?? '');
  check('3 a refused start leaves the presentation stopped',
    getStateCachePlayback()?.active === false && resolveActiveStateCachePlaybackFrame() === null);

  // Re-pointing at a new cache mid-presentation: stops and
  // resets, so a stale frame index is never reinterpreted.
  startStateCachePlayback({ frameIndex: 1 });
  const other = makeV2Cache();
  setStateCachePlaybackCache(other, 'other');
  const store1 = getStateCachePlayback();
  check('3 re-pointing stops the presentation and resets the frame',
    !!store1 && store1.cache === other && store1.active === false && store1.frameIndex === 0);
  check('3 resolve is null after re-pointing', resolveActiveStateCachePlaybackFrame() === null);

  const noPosture = makeV2Cache(false);
  setStateCachePlaybackCache(noPosture, 'posture-less');
  const refusedStart = startStateCachePlayback();
  check('3 start refuses a posture-less cache with the builder reason',
    refusedStart.ok === false && refusedStart.error.includes('姿勢チャンネルが無い'),
    refusedStart.error ?? '');
  clearStateCachePlaybackCache();
}

// ── 4. Existing paths unchanged ─────────────────────────
{
  const cache = makeV2Cache();
  const converted = stateCacheV2ToPointCacheData(cache);
  check('4 point-cache conversion still drops posture BY DESIGN',
    converted.ok === true && converted.droppedOrientation === true,
    converted.ok ? '' : converted.error ?? '');

  let applied = null;
  const appliedResult = applyStateCacheFrameV2AsInitialState({
    cache,
    frameIndex: 1,
    applier: (request) => { applied = request; return { ok: true }; },
  });
  check('4 v2 initial-state driver still applies with posture',
    appliedResult.ok === true && !!applied && bitEqual(applied.initialData.orientData, quats(1)),
    appliedResult.error ?? '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
