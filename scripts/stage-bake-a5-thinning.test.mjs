// Bake layer v2 — A-5 follow-up (b): valid-count thinning.
// The v2 manifest may declare validCount (< count): the
// binary stores only the leading validCount particles per
// frame and channel (the scene's valid set — the draw range
// applyLodPolicy publishes), the frame hashes cover exactly
// those stored bytes, and decoding restores count-wide
// channels with the sim's parked convention in the tail
// (position (0, -99999, 0), velocity / attributes zero,
// orientation identity). Files without validCount — every
// file the pre-thinning writer produced — must read exactly
// as before. Record: kalokagathia-pro/BAKE_A5_THINNING_IMPL_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakea5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export * from './lib/gpgpuStateCacheV2.ts';
      export {
        createStateCacheCaptureSession, pushStateCacheCaptureFrame,
        finishStateCacheCaptureV2, runStateCacheCaptureJobV2,
        buildStateCacheFilesV2, loadStateCacheFromFilesV2,
        buildStateCacheCaptureProvenance,
      } from './lib/gpgpuStateCacheCapture.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCacheV2, serializeStateCacheManifestV2, parseStateCacheManifestV2,
  encodeStateCacheFramesV2, decodeStateCacheFramesV2, hashStateCacheFrameV2,
  stateCacheFrameFloatCountV2, stateCacheStoredCountV2, STATE_CACHE_PARKED_POSITION,
  extractStateCacheFrameV2, verifyCheckpointCanSeedInitialState,
  splitStateCacheV2, mergeBakeJobParts, buildCheckpointRef, BAKE_SPLIT_DEFAULT_METHOD,
  createStateCacheCaptureSession, pushStateCacheCaptureFrame,
  finishStateCacheCaptureV2, runStateCacheCaptureJobV2,
  buildStateCacheFilesV2, loadStateCacheFromFilesV2,
  buildStateCacheCaptureProvenance,
} = lib;

const TEX = 8; const COUNT = TEX * TEX; const VALID = 40; const FRAMES = 3;
const PROV = { settingsHash: 'scene-hash-a5', seed: 7, generator: 'monosphere', generatorVersion: 'a5-thinning-test' };
const DECLS = [
  { name: 'age', components: 1, source: 'sim-age' },
  { name: 'heat', components: 1, source: 'script-bake' },
];
// Frame f, particle i: pos (i + f, 2i, -i), vel (f, 1, i / 2);
// age = i + f, heat = 10i + f; orientation = rotation about Y
// by angle i * 0.05 + f * 0.3 (unit quat, x,y,z,w order).
const frameInput = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const age = new Float32Array(COUNT);
  const heat = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f, i * 2, -i, 999], i * 4);
    velocities.set([f, 1, 0.5 * i, -7], i * 4);
    age[i] = i + f; heat[i] = i * 10 + f;
  }
  return { positions, velocities, attributes: { age, heat } };
};
const orientFrame = (f) => {
  const q = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const half = (i * 0.05 + f * 0.3) / 2;
    q.set([0, Math.sin(half), 0, Math.cos(half)], i * 4);
  }
  return q;
};
// The stored shapes the format derives from the inputs above.
const storedPos = (f) => { const a = new Float32Array(COUNT * 3); for (let i = 0; i < COUNT; i++) a.set([i + f, i * 2, -i], i * 3); return a; };
const storedVel = (f) => { const a = new Float32Array(COUNT * 3); for (let i = 0; i < COUNT; i++) a.set([f, 1, 0.5 * i], i * 3); return a; };
const storedAge = (f) => { const a = new Float32Array(COUNT); for (let i = 0; i < COUNT; i++) a[i] = i + f; return a; };
const storedHeat = (f) => { const a = new Float32Array(COUNT); for (let i = 0; i < COUNT; i++) a[i] = i * 10 + f; return a; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const prefixEq = (full, expectedFull, n, per) => {
  for (let i = 0; i < n * per; i++) if (full[i] !== expectedFull[i]) return false;
  return true;
};

const frames = [0, 1, 2].map(frameInput);
const orients = [0, 1, 2].map(orientFrame);

// ── 1. Assembly with validCount ────────────────────────────
const thinned = assembleStateCacheV2({
  fps: 30, texSize: TEX, frames, attributeDecls: DECLS,
  orientations: orients, provenance: PROV, validCount: VALID,
});
check('1 thinned assembly ok', thinned.ok === true, thinned.error ?? '');
let cache = null;
if (thinned.ok) {
  cache = thinned.cache;
  check('1 manifest declares validCount, count stays the pool size',
    cache.manifest.validCount === VALID && cache.manifest.count === COUNT);
  check('1 stored count helper follows the declaration',
    stateCacheStoredCountV2(cache.manifest) === VALID);
  check('1 stored frame float count is thinned',
    stateCacheFrameFloatCountV2(cache.manifest) === VALID * (6 + 2 + 4),
    String(stateCacheFrameFloatCountV2(cache.manifest)));
  check('1 in-memory channels stay count-wide',
    cache.positions[0].length === COUNT * 3 && cache.orientations[0].length === COUNT * 4);
}

// ── 2. Hash domain = the stored bytes ──────────────────────
if (cache) {
  let hashOk = true; let differsFromFull = true;
  for (let f = 0; f < FRAMES; f++) {
    const storedHash = hashStateCacheFrameV2(
      storedPos(f).subarray(0, VALID * 3), storedVel(f).subarray(0, VALID * 3),
      [storedAge(f).subarray(0, VALID), storedHeat(f).subarray(0, VALID)],
      orientFrame(f).subarray(0, VALID * 4),
    );
    if (cache.manifest.frameHashes[f] !== storedHash) hashOk = false;
    const fullHash = hashStateCacheFrameV2(storedPos(f), storedVel(f), [storedAge(f), storedHeat(f)], orientFrame(f));
    if (cache.manifest.frameHashes[f] === fullHash) differsFromFull = false;
  }
  check('2 frame hashes equal the hash of the stored prefixes', hashOk);
  check('2 frame hashes are NOT the whole-pool hash (domain really thinned)', differsFromFull);
}

// ── 3. Encode size + manifest round trip ───────────────────
let bin = null;
if (cache) {
  bin = encodeStateCacheFramesV2(cache);
  check('3 binary is the thinned size', bin.byteLength === VALID * 12 * FRAMES * 4, `${bin.byteLength}`);
  const text = serializeStateCacheManifestV2(cache);
  check('3 serialized manifest carries validCount', text.includes(`"validCount":${VALID}`));
  const parsed = parseStateCacheManifestV2(text);
  check('3 manifest parse round trip keeps validCount',
    !('error' in parsed) && parsed.manifest.validCount === VALID && parsed.manifest.count === COUNT,
    parsed.error ?? '');
}

// ── 4. Decode: prefix verbatim, tail parked ────────────────
let decoded = null;
if (cache && bin) {
  const dec = decodeStateCacheFramesV2(cache.manifest, bin);
  check('4 thinned decode ok (hashes verify over stored bytes)', dec.ok === true, dec.error ?? '');
  if (dec.ok) {
    decoded = dec.cache;
    let prefixOk = true; let tailOk = true;
    for (let f = 0; f < FRAMES; f++) {
      const c = decoded;
      if (!prefixEq(c.positions[f], storedPos(f), VALID, 3)) prefixOk = false;
      if (!prefixEq(c.velocities[f], storedVel(f), VALID, 3)) prefixOk = false;
      if (!prefixEq(c.attrFrames[0][f], storedAge(f), VALID, 1)) prefixOk = false;
      if (!prefixEq(c.attrFrames[1][f], storedHeat(f), VALID, 1)) prefixOk = false;
      if (!prefixEq(c.orientations[f], orientFrame(f), VALID, 4)) prefixOk = false;
      for (let i = VALID; i < COUNT; i++) {
        const p = c.positions[f];
        if (p[i * 3] !== STATE_CACHE_PARKED_POSITION[0] || p[i * 3 + 1] !== STATE_CACHE_PARKED_POSITION[1] || p[i * 3 + 2] !== STATE_CACHE_PARKED_POSITION[2]) tailOk = false;
        const v = c.velocities[f];
        if (v[i * 3] !== 0 || v[i * 3 + 1] !== 0 || v[i * 3 + 2] !== 0) tailOk = false;
        if (c.attrFrames[0][f][i] !== 0 || c.attrFrames[1][f][i] !== 0) tailOk = false;
        const q = c.orientations[f];
        if (q[i * 4] !== 0 || q[i * 4 + 1] !== 0 || q[i * 4 + 2] !== 0 || q[i * 4 + 3] !== 1) tailOk = false;
      }
    }
    check('4 decoded prefix is byte-identical to the stored inputs (all channels)', prefixOk);
    check('4 decoded tail is the parked convention (parked pos / zero vel+attrs / identity quat)', tailOk);
    check('4 decoded channels are count-wide',
      decoded.positions[0].length === COUNT * 3 && decoded.attrFrames[0][0].length === COUNT);
    const re = encodeStateCacheFramesV2(decoded);
    check('4 re-encoding the decoded cache reproduces the thinned binary byte for byte',
      re.byteLength === bin.byteLength && eq(new Uint8Array(re), new Uint8Array(bin)));
  }
}

// ── 5. Legacy files (no validCount) read as before ─────────
{
  const legacy = assembleStateCacheV2({
    fps: 30, texSize: TEX, frames, attributeDecls: DECLS,
    orientations: orients, provenance: PROV,
  });
  check('5 legacy assembly ok and declares no validCount',
    legacy.ok === true && legacy.cache.manifest.validCount === undefined, legacy.error ?? '');
  if (legacy.ok) {
    const lbin = encodeStateCacheFramesV2(legacy.cache);
    check('5 legacy binary is the whole-pool size', lbin.byteLength === COUNT * 12 * FRAMES * 4, `${lbin.byteLength}`);
    const parsed = parseStateCacheManifestV2(serializeStateCacheManifestV2(legacy.cache));
    check('5 legacy manifest parses with validCount absent',
      !('error' in parsed) && parsed.manifest.validCount === undefined);
    const dec = decodeStateCacheFramesV2(legacy.cache.manifest, lbin);
    check('5 legacy decode ok', dec.ok === true, dec.error ?? '');
    if (dec.ok) {
      let allEq = true;
      for (let f = 0; f < FRAMES; f++) {
        if (!eq(dec.cache.positions[f], storedPos(f))) allEq = false;
        if (!eq(dec.cache.velocities[f], storedVel(f))) allEq = false;
        if (!eq(dec.cache.attrFrames[0][f], storedAge(f))) allEq = false;
        if (!eq(dec.cache.attrFrames[1][f], storedHeat(f))) allEq = false;
        if (!eq(dec.cache.orientations[f], orientFrame(f))) allEq = false;
      }
      check('5 legacy decode is the full data everywhere (no parked tail)', allEq);
    }
  }
}

// ── 6. Invalid validCount refused with the reason ──────────
{
  const base = { fps: 30, texSize: TEX, frames, attributeDecls: DECLS, orientations: orients, provenance: PROV };
  check('6 assemble refuses validCount 0',
    assembleStateCacheV2({ ...base, validCount: 0 }).ok === false);
  check('6 assemble refuses validCount above count',
    assembleStateCacheV2({ ...base, validCount: COUNT + 1 }).ok === false);
  check('6 assemble refuses non-integer validCount',
    assembleStateCacheV2({ ...base, validCount: VALID + 0.5 }).ok === false);
  check('6 assemble refuses negative validCount',
    assembleStateCacheV2({ ...base, validCount: -3 }).ok === false);
  const full = assembleStateCacheV2({ ...base, validCount: COUNT });
  check('6 validCount == count assembles and declares nothing (legacy shape)',
    full.ok === true && full.cache.manifest.validCount === undefined, full.error ?? '');
  if (cache) {
    const text = serializeStateCacheManifestV2(cache);
    for (const [label, bad] of [['0', 0], ['above count', COUNT + 1], ['non-integer', VALID + 0.5], ['string', '40']]) {
      const mutated = text.replace(`"validCount":${VALID}`, `"validCount":${JSON.stringify(bad)}`);
      const parsed = parseStateCacheManifestV2(mutated);
      check(`6 parse refuses validCount ${label}`, 'error' in parsed, parsed.manifest ? 'parsed ok' : '');
    }
    const asCount = parseStateCacheManifestV2(text.replace(`"validCount":${VALID}`, `"validCount":${COUNT}`));
    check('6 parse accepts validCount == count and normalises it away',
      !('error' in asCount) && asCount.manifest.validCount === undefined, asCount.error ?? '');
  }
}

// ── 7. Capture wiring carries validCount to the file ───────
{
  const prov = buildStateCacheCaptureProvenance({
    settingsSnapshot: { gpgpuSeed: 7 }, seed: 7, generatorVersion: 'a5-test',
  });
  // Session snapshots: readback shape, age in the position w
  // lane (i + f * 10), posture about Y.
  const snap = (f) => {
    const positions = new Float32Array(COUNT * 4);
    const velocities = new Float32Array(COUNT * 4);
    const orientations = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      positions.set([i + f, i * 2, -i, i + f * 10], i * 4);
      velocities.set([f, 1, i, 0], i * 4);
      const half = (i * 0.05 + f * 0.3) / 2;
      orientations.set([0, Math.sin(half), 0, Math.cos(half)], i * 4);
    }
    return { texSize: TEX, positions, velocities, orientations };
  };
  const session = createStateCacheCaptureSession({ fps: 30, validCount: VALID });
  check('7 session pushes accepted',
    [0, 1].every((f) => pushStateCacheCaptureFrame(session, snap(f)).ok));
  const finished = finishStateCacheCaptureV2(session, prov);
  check('7 session finish declares validCount',
    finished.ok === true && finished.cache.manifest.validCount === VALID, finished.error ?? '');
  if (finished.ok) {
    const files = buildStateCacheFilesV2(finished.cache);
    // age is the session's only attribute: floats per stored
    // frame = VALID * (6 + 1 + 4), 2 frames.
    check('7 saved binary is thinned', files.framesBuffer.byteLength === VALID * 11 * 2 * 4,
      `${files.framesBuffer.byteLength}`);
    const loaded = loadStateCacheFromFilesV2(new Map([
      [files.manifestFileName, new TextEncoder().encode(files.manifestText).buffer],
      [files.framesFileName, files.framesBuffer],
    ]));
    check('7 thinned file pair loads back', loaded.ok === true, loaded.error ?? '');
    if (loaded.ok) {
      let ok = true;
      for (let i = 0; i < VALID; i++) {
        if (loaded.cache.positions[1][i * 3] !== i + 1) ok = false;
        if (loaded.cache.attrFrames[0][1][i] !== i + 10) ok = false;
      }
      for (let i = VALID; i < COUNT; i++) {
        if (loaded.cache.positions[1][i * 3 + 1] !== -99999) ok = false;
      }
      check('7 loaded cache: prefix is the take, tail is parked', ok);
    }
  }
  const plain = createStateCacheCaptureSession({ fps: 30 });
  [0, 1].forEach((f) => pushStateCacheCaptureFrame(plain, snap(f)));
  const plainDone = finishStateCacheCaptureV2(plain, prov);
  check('7 session without validCount keeps the legacy shape',
    plainDone.ok === true && plainDone.cache.manifest.validCount === undefined, plainDone.error ?? '');

  const fakeSequence = async (job, onProgress, onPart) => {
    for (let i = 0; i < job.frames; i++) {
      await job.onSimFrame({ index: i, timeSeconds: (i + 1) / job.fps });
      onProgress(i + 1, job.frames);
    }
    if (onPart) await onPart({ blob: null, part: 1, partCount: 1, firstFrame: 0, frames: job.frames, manifest: null });
    return [];
  };
  let call = 0;
  const driven = await runStateCacheCaptureJobV2(
    { fps: 30, frames: 2, warmupFrames: 0, provenance: prov, validCount: VALID },
    undefined,
    { runSequence: fakeSequence, getProvider: () => () => snap(call++) },
  );
  check('7 v2 job with validCount assembles a thinned cache',
    driven.ok === true && driven.cache.manifest.validCount === VALID, driven.error ?? '');
}

// ── 8. Checkpoint + split/merge on thinned caches ──────────
if (decoded) {
  const cp = extractStateCacheFrameV2(decoded, 1);
  check('8 checkpoint of a thinned cache keeps the declaration',
    cp.ok === true && cp.cache.manifest.validCount === VALID, cp.error ?? '');
  if (cp.ok) {
    const seed = verifyCheckpointCanSeedInitialState(cp.cache);
    check('8 thinned checkpoint still seeds S1 (count-wide lanes)', seed.ok === true, seed.error ?? '');
  }
  const split = splitStateCacheV2(decoded, [[0, 2], [2, 3]]);
  check('8 split of a thinned cache ok', split.ok === true, split.error ?? '');
  if (split.ok) {
    const jobFor = (range, idx, parts) => {
      const baseJob = {
        jobId: `a5-job-${idx}`,
        sceneRef: { ref: 'scene://main', hash: PROV.settingsHash },
        frameRange: range,
        attributes: DECLS.map((d) => d.name),
        includeOrientation: true,
        seed: PROV.seed,
        outputRef: `out://a5-part-${idx}`,
        method: BAKE_SPLIT_DEFAULT_METHOD,
      };
      if (idx === 0) return { ...baseJob, startMode: 'fromInitial' };
      const prev = parts[idx - 1];
      return {
        ...baseJob, startMode: 'fromCheckpoint',
        checkpointRef: buildCheckpointRef(prev, prev.manifest.frameCount - 1, `cp://a5-job-${idx}`),
      };
    };
    const parts = split.parts.map((p, i) => ({ job: jobFor([[0, 2], [2, 3]][i], i, split.parts), cache: p }));
    const merged = mergeBakeJobParts(parts);
    check('8 merge of thinned parts verifies (hash recompute over stored prefixes)',
      merged.ok === true, merged.error ?? '');
    if (merged.ok) {
      check('8 merged cache keeps validCount and frame hashes',
        merged.cache.manifest.validCount === VALID
        && merged.cache.manifest.frameHashes.every((h, f) => h === decoded.manifest.frameHashes[f]));
    }
    const mixed = [
      parts[0],
      { job: parts[1].job, cache: { ...parts[1].cache, manifest: { ...parts[1].cache.manifest, validCount: VALID - 1 } } },
    ];
    check('8 merge refuses parts with differing validCount', mergeBakeJobParts(mixed).ok === false);
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
