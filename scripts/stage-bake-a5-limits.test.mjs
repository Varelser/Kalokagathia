// Bake layer v2 — A-5 follow-up (a): the two-layer limit
// discipline, settled after the thinned re-measurement
// (round11, real GPU). Layer 1: the format caps
// STATE_CACHE_MAX_POINTS (65,536) / STATE_CACHE_MAX_FRAMES
// (3,600) apply to count (pool width) and frameCount —
// declaring validCount never relaxes them, because decode
// restores count-wide arrays. Layer 2: the operational
// recommendation (8,192 stored points x 240 frames) is
// stored-count based, and stateCacheStoredBinaryBytesV2
// gives the exact stored size of any manifest (the A-5
// scene: 86,507,520 bytes thinned, exactly half of the
// unthinned 173,015,040). Legacy files (no validCount)
// must keep reading exactly as before.
// Record: kalokagathia-pro/BAKE_A5_THINNING_IMPL_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bakea5lim-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `export * from './lib/gpgpuStateCacheV2.ts';`,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const {
  assembleStateCacheV2, serializeStateCacheManifestV2, parseStateCacheManifestV2,
  encodeStateCacheFramesV2, decodeStateCacheFramesV2,
  stateCacheStoredCountV2, stateCacheStoredBinaryBytesV2,
  STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_POINTS,
  STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_FRAMES,
} = lib;
// The caps live in the v1 module and are re-exported by v2's imports;
// read them from the same bundle surface via a manifest error string
// is fragile — import the v1 module through the v2 bundle is not
// possible, so the values are pinned here and cross-checked against
// the rejection messages below (which embed the live values).
const MAX_POINTS = 65536;
const MAX_FRAMES = 3600;

const PROV = { settingsHash: 'scene-hash-a5lim', seed: 3, generator: 'monosphere', generatorVersion: 'a5-limits-test' };
const DECLS = [{ name: 'age', components: 1, source: 'sim-age' }];

// ── 1. Assemble-side caps ─────────────────────────────────
{
  const over = assembleStateCacheV2({ fps: 30, texSize: 512, frames: [], provenance: PROV });
  check('1 assemble rejects count over the cap', over.ok === false);
  check('1 assemble count-cap reason states the cap and the count',
    over.ok === false && over.error.includes('上限超過') && over.error.includes('保存できません')
    && over.error.includes('262,144') && over.error.includes('65,536'), over.ok ? '' : over.error);

  const overThinned = assembleStateCacheV2({ fps: 30, texSize: 512, frames: [], provenance: PROV, validCount: 8192 });
  check('1 validCount does not relax the assemble count cap',
    overThinned.ok === false && overThinned.error.includes('上限超過'), overThinned.ok ? '' : overThinned.error);

  const frames = new Array(MAX_FRAMES + 1).fill({});
  const overFrames = assembleStateCacheV2({ fps: 30, texSize: 4, frames, provenance: PROV });
  check('1 assemble rejects frame count over the cap with the reason',
    overFrames.ok === false && overFrames.error.includes('上限超過') && overFrames.error.includes('3600'),
    overFrames.ok ? '' : overFrames.error);
}

// A small valid cache as the fixture base for manifest mutations.
const TEX = 8; const COUNT = TEX * TEX; const FRAMES = 3;
const frameInput = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const age = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f, i * 2, -i, 999], i * 4);
    velocities.set([f, 1, 0.5 * i, -7], i * 4);
    age[i] = i + f;
  }
  return { positions, velocities, attributes: { age } };
};
const orientFrame = (f) => {
  const q = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const half = (i * 0.05 + f * 0.3) / 2;
    q.set([0, Math.sin(half), 0, Math.cos(half)], i * 4);
  }
  return q;
};
const base = assembleStateCacheV2({
  fps: 30, texSize: TEX, frames: [0, 1, 2].map(frameInput),
  attributeDecls: DECLS, orientations: [0, 1, 2].map(orientFrame), provenance: PROV,
});
check('fixture assembly ok', base.ok === true, base.ok ? '' : base.error);
const baseJson = JSON.parse(serializeStateCacheManifestV2(base.cache));
const mutated = (fn) => { const j = JSON.parse(JSON.stringify(baseJson)); fn(j); return JSON.stringify(j); };

// ── 2. Parse-side caps and boundaries ─────────────────────
{
  const overCount = parseStateCacheManifestV2(mutated((j) => { j.count = 262144; j.texSize = 512; }));
  check('2 parse rejects count over the cap', !('manifest' in overCount));
  check('2 parse count-cap reason states the cap',
    !('manifest' in overCount) && overCount.error.includes('上限超過') && overCount.error.includes('読み込めません')
    && overCount.error.includes('65,536'), 'manifest' in overCount ? '' : overCount.error);

  const overCountThinned = parseStateCacheManifestV2(mutated((j) => { j.count = 262144; j.texSize = 512; j.validCount = 8192; }));
  check('2 validCount does not relax the parse count cap',
    !('manifest' in overCountThinned) && overCountThinned.error.includes('上限超過'),
    'manifest' in overCountThinned ? '' : overCountThinned.error);

  const atCap = parseStateCacheManifestV2(mutated((j) => { j.count = MAX_POINTS; j.texSize = 256; }));
  check('2 parse accepts count exactly at the cap', 'manifest' in atCap, 'manifest' in atCap ? '' : atCap.error);

  const atCapThinned = parseStateCacheManifestV2(mutated((j) => { j.count = MAX_POINTS; j.texSize = 256; j.validCount = 8192; }));
  check('2 parse accepts at-cap count with validCount and keeps the declaration',
    'manifest' in atCapThinned && atCapThinned.manifest.validCount === 8192,
    'manifest' in atCapThinned ? '' : atCapThinned.error);

  const overFrames = parseStateCacheManifestV2(mutated((j) => {
    j.frameCount = MAX_FRAMES + 1;
    j.frameHashes = new Array(MAX_FRAMES + 1).fill('00000000');
  }));
  check('2 parse rejects frameCount over the cap with the reason',
    !('manifest' in overFrames) && overFrames.error.includes('上限超過') && overFrames.error.includes('3600'),
    'manifest' in overFrames ? '' : overFrames.error);

  const atFrames = parseStateCacheManifestV2(mutated((j) => {
    j.frameCount = MAX_FRAMES;
    j.frameHashes = new Array(MAX_FRAMES).fill('00000000');
  }));
  check('2 parse accepts frameCount exactly at the cap', 'manifest' in atFrames, 'manifest' in atFrames ? '' : atFrames.error);
}

// ── 3. Stored-size helper and the recommendation ──────────
{
  const a5Shape = {
    format: 'statecache-manifest-v2', version: 2, sourceVersion: 2,
    fps: 30, count: 16384, texSize: 128, frameCount: 240, startFrame: 0,
    loop: true, interpolation: 'linear', coordinates: { up: 'y', unit: 'm' },
    attributes: DECLS, orientation: { encoding: 'quat-f32x4' },
    provenance: PROV, frameHashes: [],
  };
  const thinnedBytes = stateCacheStoredBinaryBytesV2({ ...a5Shape, validCount: 8192 });
  check('3 stored bytes of the thinned A-5 shape equal the round11 measurement',
    thinnedBytes === 86507520, String(thinnedBytes));
  const fullBytes = stateCacheStoredBinaryBytesV2(a5Shape);
  check('3 stored bytes of the unthinned A-5 shape equal the round4 measurement',
    fullBytes === 173015040, String(fullBytes));
  check('3 thinned is exactly half of unthinned', thinnedBytes * 2 === fullBytes);
  check('3 the recommendation reproduces the measured size at 44 B per stored point per frame',
    STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_POINTS * STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_FRAMES * 44 === thinnedBytes);
  check('3 the fixture cache stored size matches its encoded length',
    stateCacheStoredBinaryBytesV2(base.cache.manifest) === encodeStateCacheFramesV2(base.cache).byteLength);
}

// ── 4. Legacy (no validCount) round trip stays intact ─────
{
  const bin = encodeStateCacheFramesV2(base.cache);
  const parsed = parseStateCacheManifestV2(serializeStateCacheManifestV2(base.cache));
  check('4 legacy manifest parses', 'manifest' in parsed, 'manifest' in parsed ? '' : parsed.error);
  if ('manifest' in parsed) {
    check('4 legacy manifest carries no validCount', parsed.manifest.validCount === undefined);
    check('4 legacy stored count is the whole pool', stateCacheStoredCountV2(parsed.manifest) === COUNT);
    const decoded = decodeStateCacheFramesV2(parsed.manifest, bin);
    check('4 legacy decode ok (hash verification included)', decoded.ok === true, decoded.ok ? '' : decoded.error);
    if (decoded.ok) {
      const reBin = encodeStateCacheFramesV2(decoded.cache);
      check('4 legacy re-encode is byte-identical',
        Buffer.from(reBin).equals(Buffer.from(bin)));
    }
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
