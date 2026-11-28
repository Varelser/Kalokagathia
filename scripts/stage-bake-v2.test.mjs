// C2 bake-layer extension — state cache v2 (orientation
// channel, extended attribute declarations, provenance),
// bake-job split / checkpoint chaining / merge, and v1
// read compatibility. Design:
// kalokagathia-pro/expanded-ruler/bake-layer-design.md.
// Record: kalokagathia-pro/BAKE_V2_IMPL_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakev2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export * from './lib/gpgpuStateCacheV2.ts';
      export { assembleStateCache, serializeStateCacheManifest, parseStateCacheManifest, encodeStateCacheFrames } from './lib/gpgpuStateCache.ts';
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
  quatSlerp, sampleStateCacheV2, sampleStateCacheV2AtFrame, stateCacheV2ToPointCacheData,
  extractStateCacheFrameV2, buildCheckpointRef, verifyCheckpointCanSeedInitialState,
  validateBakeJobDescriptor, splitStateCacheV2, mergeBakeJobParts, replaceBakeJobPart,
  BAKE_SPLIT_DEFAULT_METHOD, STATE_CACHE_FORMAT_V2,
  assembleStateCache, serializeStateCacheManifest, parseStateCacheManifest, encodeStateCacheFrames,
} = lib;

const TEX = 4; const COUNT = TEX * TEX;
const PROV = { settingsHash: 'scene-hash-abc', seed: 42, generator: 'monosphere', generatorVersion: 'stage-v2-test' };
const DECLS = [
  { name: 'age', components: 1, source: 'sim-age' },
  { name: 'heat', components: 1, source: 'script-bake' },
];
// Frame f: pos (i+f, 2i, -i), vel (f, 1, i/2); age = i+f, heat = 10i+f.
// Orientation: rotation about Y by angle f * 90deg -> quat (0, sin(a/2), 0, cos(a/2)).
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
  const a = (f * Math.PI) / 2;
  for (let i = 0; i < COUNT; i++) q.set([0, Math.sin(a / 2), 0, Math.cos(a / 2)], i * 4);
  return q;
};
const FRAMES = 6;
const made = assembleStateCacheV2({
  fps: 30, texSize: TEX,
  frames: Array.from({ length: FRAMES }, (_, f) => frameInput(f)),
  attributeDecls: DECLS,
  orientations: Array.from({ length: FRAMES }, (_, f) => orientFrame(f)),
  provenance: PROV,
});
check('1 assembly ok', made.ok === true, made.error ?? '');
const cache = made.cache;

// ── 1. Assembly / manifest shape ────────────────────────────
check('1 format is v2 / version 2', cache.manifest.format === STATE_CACHE_FORMAT_V2 && cache.manifest.version === 2);
check('1 orientation declared quat-f32x4', cache.manifest.orientation?.encoding === 'quat-f32x4');
check('1 attribute decls carry source', cache.manifest.attributes[1].source === 'script-bake' && cache.manifest.attributes[0].components === 1);
check('1 provenance recorded', cache.manifest.provenance.settingsHash === 'scene-hash-abc' && cache.manifest.provenance.seed === 42);
check('1 hash covers orientation (same pos/vel, different quat -> different hash)',
  hashStateCacheFrameV2(cache.positions[0], cache.velocities[0], [cache.attrFrames[0][0], cache.attrFrames[1][0]], cache.orientations[0])
  !== hashStateCacheFrameV2(cache.positions[0], cache.velocities[0], [cache.attrFrames[0][0], cache.attrFrames[1][0]], cache.orientations[1]));

// ── 2. Assembly refusals ────────────────────────────────────
check('2 missing provenance refused', assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeDecls: DECLS, provenance: null }).ok === false);
check('2 attribute without source refused', assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeDecls: [{ name: 'x2', components: 1, source: '' }], provenance: PROV }).ok === false);
check('2 components != 1 refused', assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeDecls: [{ name: 'vec', components: 3, source: 'sim' }], provenance: PROV }).ok === false);
check('2 partial orientation refused', assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1)], attributeDecls: DECLS, orientations: [orientFrame(0)], provenance: PROV }).ok === false);
check('2 non-normalized quaternion refused', (() => {
  const bad = orientFrame(0); bad[0] = 5;
  return assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeDecls: DECLS, orientations: [bad], provenance: PROV }).ok === false;
})());
check('2 missing declared attribute refused', (() => {
  const f = frameInput(0); delete f.attributes.heat;
  return assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [f], attributeDecls: DECLS, provenance: PROV }).ok === false;
})());

// ── 3. Manifest + binary round trip ─────────────────────────
{
  const parsed = parseStateCacheManifestV2(serializeStateCacheManifestV2(cache));
  check('3 manifest round trip', 'manifest' in parsed && parsed.manifest.frameCount === FRAMES && parsed.manifest.sourceVersion === 2);
  const noProv = JSON.parse(serializeStateCacheManifestV2(cache)); delete noProv.provenance;
  check('3 v2 manifest without provenance refused', 'error' in parseStateCacheManifestV2(JSON.stringify(noProv)));
  const badEnc = JSON.parse(serializeStateCacheManifestV2(cache)); badEnc.orientation = { encoding: 'quat-f16' };
  check('3 unknown orientation encoding refused', 'error' in parseStateCacheManifestV2(JSON.stringify(badEnc)));
  const bytes = encodeStateCacheFramesV2(cache);
  const back = decodeStateCacheFramesV2(cache.manifest, bytes);
  check('3 decode ok', back.ok === true, back.error ?? '');
  let identical = back.ok;
  if (back.ok) {
    for (let f = 0; f < FRAMES; f++) {
      identical = identical
        && back.cache.positions[f].every((v, i) => v === cache.positions[f][i])
        && back.cache.velocities[f].every((v, i) => v === cache.velocities[f][i])
        && back.cache.orientations[f].every((v, i) => v === cache.orientations[f][i])
        && back.cache.attrFrames[1][f].every((v, i) => v === cache.attrFrames[1][f][i]);
    }
  }
  check('3 round trip bit-identical incl. orientation + extended attributes', identical);
  check('3 short buffer refused', decodeStateCacheFramesV2(cache.manifest, bytes.slice(0, bytes.byteLength - 4)).ok === false);
  // Corrupt ONLY an orientation byte: last frame's orientation region.
  const corrupt = bytes.slice(0);
  new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 0xff;
  const corruptResult = decodeStateCacheFramesV2(cache.manifest, corrupt);
  check('3 orientation-only corruption caught by frame hash', corruptResult.ok === false && corruptResult.error.includes('ハッシュ'), corruptResult.error ?? '');
  const corruptAttr = bytes.slice(0);
  new Uint8Array(corruptAttr)[COUNT * 6 * 4 + 2] ^= 0xff; // inside frame 0 attribute region
  check('3 attribute corruption caught by frame hash', decodeStateCacheFramesV2(cache.manifest, corruptAttr).ok === false);
}

// ── 4. v1 compatibility ─────────────────────────────────────
{
  const v1 = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1)], attributeNames: ['age'] });
  check('4 v1 fixture assembled', v1.ok === true);
  // Note: v1 frameInput attributes use {heat} only in our helper for 'age' declared? assemble uses attributes record keys.
  if (v1.ok) {
    const parsed = parseStateCacheManifestV2(serializeStateCacheManifest(v1.cache));
    check('4 v2 reader accepts v1 manifest', 'manifest' in parsed && parsed.manifest.sourceVersion === 1 && parsed.manifest.orientation === null);
    if ('manifest' in parsed) {
      const back = decodeStateCacheFramesV2(parsed.manifest, encodeStateCacheFrames(v1.cache));
      check('4 v2 reader decodes v1 binary', back.ok === true, back.error ?? '');
      if (back.ok) {
        const s = sampleStateCacheV2(back.cache, 0, false);
        check('4 v1 sample yields identity quaternion by declaration', s.hasOrientation === false && s.orientations[3] === 1 && s.orientations[0] === 0);
      }
    }
  }
  const v1Reader = parseStateCacheManifest(serializeStateCacheManifestV2(cache));
  check('4 v1 reader refuses v2 manifest (existing behaviour, no forward compat)', 'error' in v1Reader);
}

// ── 5. Slerp sampling ───────────────────────────────────────
{
  const mid = quatSlerp([0, 0, 0, 1], [0, 1, 0, 0], 0.5);
  check('5 slerp midpoint of identity->180degY is 90degY',
    Math.abs(mid[1] - Math.SQRT1_2) < 1e-6 && Math.abs(mid[3] - Math.SQRT1_2) < 1e-6, mid.join(','));
  const shortArc = quatSlerp([0, 0, 0, 1], [0, -Math.sin(0.1), 0, -Math.cos(0.1)], 1);
  check('5 slerp takes the short arc (sign flip)', Math.abs(shortArc[1] - Math.sin(0.1)) < 1e-6 && Math.abs(shortArc[3] - Math.cos(0.1)) < 1e-6, shortArc.join(','));
  // Halfway between frame 0 (identity) and frame 1 (90degY): 45degY.
  const s = sampleStateCacheV2AtFrame(cache, 0.5);
  check('5 sampled orientation at frame 0.5 is 45degY via slerp',
    s.hasOrientation && Math.abs(s.orientations[1] - Math.sin(Math.PI / 8)) < 1e-5 && Math.abs(s.orientations[3] - Math.cos(Math.PI / 8)) < 1e-5,
    s.orientations.slice(0, 4).join(','));
  check('5 sampled positions at frame 0.5 are the linear midpoint', s.positions[0] === 0.5);
  const near = assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1)], attributeDecls: DECLS, orientations: [orientFrame(0), orientFrame(1)], provenance: PROV, interpolation: 'nearest' });
  check('5 nearest snaps orientation', near.ok && sampleStateCacheV2(near.cache, 0.4 / 30, false).orientations[3] === 1);
}

// ── 6. Point-cache conversion reports the drop ──────────────
{
  const conv = stateCacheV2ToPointCacheData(cache);
  check('6 conversion ok and orientation drop is reported', conv.ok === true && conv.droppedOrientation === true && conv.note.includes('落としました'), conv.error ?? '');
}

// ── 7. Checkpoint extraction + S1 seeding ───────────────────
{
  const cp = extractStateCacheFrameV2(cache, 2);
  check('7 checkpoint extraction ok', cp.ok === true, cp.error ?? '');
  if (cp.ok) {
    check('7 checkpoint is single frame with global startFrame', cp.cache.manifest.frameCount === 1 && cp.cache.manifest.startFrame === 2);
    check('7 checkpoint frame equals original boundary frame',
      cp.cache.positions[0].every((v, i) => v === cache.positions[2][i])
      && cp.cache.orientations[0].every((v, i) => v === cache.orientations[2][i]));
    const bytes = encodeStateCacheFramesV2(cp.cache);
    check('7 checkpoint binary round trip', decodeStateCacheFramesV2(cp.cache.manifest, bytes).ok === true);
    const seed = verifyCheckpointCanSeedInitialState(cp.cache);
    check('7 checkpoint seeds S1 initial state (pos/vel/age lanes exact)', seed.ok === true, seed.error ?? '');
    const ref = buildCheckpointRef(cache, 2, 'cp://frame2');
    check('7 checkpoint ref hash equals frame hash', ref.hash === cache.manifest.frameHashes[2] && ref.frameIndex === 2);
  }
  check('7 out-of-range checkpoint refused', extractStateCacheFrameV2(cache, 99).ok === false);
  const noAge = assembleStateCacheV2({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeDecls: [DECLS[1]], orientations: [orientFrame(0)], provenance: PROV });
  check('7 checkpoint without age cannot seed S1', noAge.ok && verifyCheckpointCanSeedInitialState(extractStateCacheFrameV2(noAge.cache, 0).cache).ok === false);
}

// ── 8. Job descriptors, split, merge ────────────────────────
const jobFor = (cachePart, range, idx, parts) => {
  const base = {
    jobId: `job-${idx}`,
    sceneRef: { ref: 'scene://main', hash: PROV.settingsHash },
    frameRange: range,
    attributes: DECLS.map((d) => d.name),
    includeOrientation: true,
    seed: PROV.seed,
    outputRef: `out://part-${idx}`,
    method: BAKE_SPLIT_DEFAULT_METHOD,
  };
  if (idx === 0) return { ...base, startMode: 'fromInitial' };
  const prev = parts[idx - 1];
  const lastLocal = prev.manifest.frameCount - 1;
  return { ...base, startMode: 'fromCheckpoint', checkpointRef: buildCheckpointRef(prev, lastLocal, `cp://job-${idx}`) };
};
{
  check('8 default split method is checkpoint-chain (method B is not default)', BAKE_SPLIT_DEFAULT_METHOD === 'checkpoint-chain');
  check('8 job without checkpointRef refused when fromCheckpoint', validateBakeJobDescriptor({
    jobId: 'j', sceneRef: { ref: 's', hash: 'h' }, frameRange: [3, 6], startMode: 'fromCheckpoint',
    attributes: [], includeOrientation: false, seed: 1, outputRef: 'o',
  }).ok === false);
  const split = splitStateCacheV2(cache, [[0, 3], [3, 6]]);
  check('8 split ok', split.ok === true, split.error ?? '');
  check('8 split with a gap refused', splitStateCacheV2(cache, [[0, 2], [4, 6]]).ok === false);
  check('8 split with overlap refused', splitStateCacheV2(cache, [[0, 4], [3, 6]]).ok === false);
  check('8 split not covering the tail refused', splitStateCacheV2(cache, [[0, 3]]).ok === false);
  if (split.ok) {
    const parts = split.parts.map((p, i) => ({ job: jobFor(p, [[0, 3], [3, 6]][i], i, split.parts), cache: p }));
    const merged = mergeBakeJobParts(parts);
    check('8 merge ok', merged.ok === true, merged.error ?? '');
    if (merged.ok) {
      let identical = merged.cache.manifest.frameCount === FRAMES
        && merged.cache.manifest.frameHashes.every((h, i) => h === cache.manifest.frameHashes[i]);
      for (let f = 0; f < FRAMES; f++) {
        identical = identical
          && merged.cache.positions[f].every((v, i) => v === cache.positions[f][i])
          && merged.cache.orientations[f].every((v, i) => v === cache.orientations[f][i]);
      }
      check('8 split -> checkpoint-chain -> merge reproduces the whole cache', identical);
      const reBytes = encodeStateCacheFramesV2(merged.cache);
      check('8 merged binary equals original binary', Buffer.from(reBytes).equals(Buffer.from(encodeStateCacheFramesV2(cache))));
    }
    // Gap between ranges at merge time.
    const gapped = [
      parts[0],
      { job: { ...parts[1].job, frameRange: [4, 6] }, cache: parts[1].cache },
    ];
    check('8 merge refuses a frame-range gap', mergeBakeJobParts(gapped).ok === false);
    const overlapped = [
      parts[0],
      { job: { ...parts[1].job, frameRange: [2, 6] }, cache: parts[1].cache },
    ];
    check('8 merge refuses a frame-range overlap', mergeBakeJobParts(overlapped).ok === false);
    const seedMismatch = [
      parts[0],
      { job: { ...parts[1].job, seed: 999 }, cache: parts[1].cache },
    ];
    check('8 merge refuses seed mismatch', mergeBakeJobParts(seedMismatch).ok === false);
    const sceneMismatch = [
      parts[0],
      { job: { ...parts[1].job, sceneRef: { ref: 'scene://main', hash: 'other-hash' } }, cache: parts[1].cache },
    ];
    check('8 merge refuses scene hash mismatch', mergeBakeJobParts(sceneMismatch).ok === false);
    const badSeam = [
      parts[0],
      { job: { ...parts[1].job, checkpointRef: { ref: 'cp://x', hash: 'deadbeef', frameIndex: 2 } }, cache: parts[1].cache },
    ];
    const badSeamResult = mergeBakeJobParts(badSeam);
    check('8 merge refuses a broken checkpoint seam', badSeamResult.ok === false && badSeamResult.error.includes('チェックポイント'), badSeamResult.error ?? '');
    // Replacement of exactly one range (failed-range re-run).
    const rerun = splitStateCacheV2(cache, [[0, 3], [3, 6]]).parts[1];
    const replaced = replaceBakeJobPart(parts, 'job-1', { job: parts[1].job, cache: rerun });
    check('8 same-range replacement ok', replaced.ok === true, replaced.error ?? '');
    if (replaced.ok) check('8 merge still ok after replacement', mergeBakeJobParts(replaced.parts).ok === true);
    check('8 different-range replacement refused', replaceBakeJobPart(parts, 'job-1', { job: { ...parts[1].job, frameRange: [3, 5] }, cache: rerun }).ok === false);
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
