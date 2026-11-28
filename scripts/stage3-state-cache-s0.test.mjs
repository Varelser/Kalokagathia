// Grammar 2.0 stage 3, slice S0 — the simulation state cache
// (lib/gpgpuStateCache.ts): assembly from the existing
// readback buffers, the versioned self format (manifest +
// one binary blob), bit-exact round trip with per-frame hash
// verification, refusal discipline, playback sampling, and
// conversion onto the existing point-cache playback path.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S0.
// Record: kalokagathia-pro/STAGE3_S0_IMPL_RECORD.md.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s0-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCache, serializeStateCacheManifest, parseStateCacheManifest, encodeStateCacheFrames, decodeStateCacheFrames, stateCacheFrameFloat, sampleStateCache, stateCacheToPointCacheData, hashStateCacheFrame, stateCacheExportAllowed, STATE_CACHE_MAX_POINTS } from './lib/gpgpuStateCache.ts';
      export { pointCacheFrameFloat, buildPointCacheCloud } from './lib/pointCache.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache, serializeStateCacheManifest, parseStateCacheManifest,
  encodeStateCacheFrames, decodeStateCacheFrames, stateCacheFrameFloat,
  sampleStateCache, stateCacheToPointCacheData, hashStateCacheFrame,
  stateCacheExportAllowed, STATE_CACHE_MAX_POINTS,
  pointCacheFrameFloat, buildPointCacheCloud,
} = lib;

const TEX = 4; const COUNT = TEX * TEX;
// Readback-shaped frame: particle i sits at (i + f, i * 2, -i),
// velocity (f, 1, 0.5 * i); w lane carries junk that must drop.
const frameInput = (f, withAttr = true) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const heat = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f, i * 2, -i, 999], i * 4);
    velocities.set([f, 1, 0.5 * i, -7], i * 4);
    heat[i] = i * 10 + f;
  }
  return { positions, velocities, attributes: withAttr ? { heat } : {} };
};

// ── 1. Assembly ─────────────────────────────────────────────
const made = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1), frameInput(2)], attributeNames: ['heat'] });
check('1 assembly ok', made.ok === true, made.error ?? '');
const cache = made.cache;
check('1 w lane dropped, triplets stored',
  cache.positions[1][0] === 1 && cache.positions[1][3] === 1 + 1 && cache.positions[0].length === COUNT * 3
  && cache.velocities[2][2] === 0);
check('1 attribute column carried per frame', cache.attrFrames[0][2][5] === 52);
check('1 manifest hashes recorded', cache.manifest.frameHashes.length === 3
  && cache.manifest.frameHashes[0] === hashStateCacheFrame(cache.positions[0], cache.velocities[0]));

// ── 2. Assembly refusals ────────────────────────────────────
check('2 point cap refused (texSize 512)', assembleStateCache({ fps: 30, texSize: 512, frames: [frameInput(0)] }).ok === false);
check('2 zero frames refused', assembleStateCache({ fps: 30, texSize: TEX, frames: [] }).ok === false);
check('2 missing attribute refused', assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0, false)], attributeNames: ['heat'] }).ok === false);
check('2 short readback buffer refused', (() => {
  const bad = frameInput(0); bad.positions = new Float32Array(8);
  return assembleStateCache({ fps: 30, texSize: TEX, frames: [bad] }).ok === false;
})());
check('2 attribute named x refused', assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeNames: ['x'] }).ok === false);

// ── 3. Manifest round trip + refusals ───────────────────────
{
  const parsed = parseStateCacheManifest(serializeStateCacheManifest(cache));
  check('3 manifest round trip', 'manifest' in parsed && parsed.manifest.frameCount === 3 && parsed.manifest.attributes[0] === 'heat');
  const wrongFormat = JSON.parse(serializeStateCacheManifest(cache)); wrongFormat.format = 'other';
  check('3 wrong format refused', 'error' in parseStateCacheManifest(JSON.stringify(wrongFormat)));
  const wrongVersion = JSON.parse(serializeStateCacheManifest(cache)); wrongVersion.version = 99;
  check('3 wrong version refused with the version named', 'error' in parseStateCacheManifest(JSON.stringify(wrongVersion)));
  const badTex = JSON.parse(serializeStateCacheManifest(cache)); badTex.texSize = 5;
  check('3 texSize/count mismatch refused', 'error' in parseStateCacheManifest(JSON.stringify(badTex)));
  const badHashes = JSON.parse(serializeStateCacheManifest(cache)); badHashes.frameHashes = ['abcd'];
  check('3 frameHashes length mismatch refused', 'error' in parseStateCacheManifest(JSON.stringify(badHashes)));
}

// ── 4. Binary round trip ────────────────────────────────────
{
  const bytes = encodeStateCacheFrames(cache);
  const back = decodeStateCacheFrames(cache.manifest, bytes);
  check('4 decode ok', back.ok === true, back.error ?? '');
  let identical = back.ok;
  if (back.ok) {
    for (let f = 0; f < 3; f++) {
      identical = identical
        && back.cache.positions[f].every((v, i) => v === cache.positions[f][i])
        && back.cache.velocities[f].every((v, i) => v === cache.velocities[f][i])
        && back.cache.attrFrames[0][f].every((v, i) => v === cache.attrFrames[0][f][i]);
    }
  }
  check('4 round trip bit-identical (positions / velocities / attributes)', identical);
  check('4 short buffer refused', decodeStateCacheFrames(cache.manifest, bytes.slice(0, bytes.byteLength - 4)).ok === false);
  const corrupt = bytes.slice(0);
  new Uint8Array(corrupt)[10] ^= 0xff;
  const corruptResult = decodeStateCacheFrames(cache.manifest, corrupt);
  check('4 corrupted byte refused by frame hash', corruptResult.ok === false && corruptResult.error.includes('ハッシュ'));
}

// ── 5. Playback sampling ────────────────────────────────────
{
  check('5 frame float mapping matches pointCacheFrameFloat', (() => {
    const conv = stateCacheToPointCacheData(cache);
    if (!conv.ok) return false;
    for (const t of [0, 0.05, 0.1, 1.0, 2.7]) {
      if (stateCacheFrameFloat(cache, t, true) !== pointCacheFrameFloat(conv.data, t, true)) return false;
      if (stateCacheFrameFloat(cache, t, false) !== pointCacheFrameFloat(conv.data, t, false)) return false;
    }
    return true;
  })());
  // fps 30: t = 1.5/30 sits halfway between frames 1 and 2.
  const mid = sampleStateCache(cache, 1.5 / 30, false);
  check('5 linear midpoint interpolates positions and velocities',
    mid.positions[0] === 1.5 && mid.velocities[0] === 1.5);
  const nearestCache = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1)], interpolation: 'nearest' }).cache;
  check('5 nearest snaps', sampleStateCache(nearestCache, 0.4 / 30, false).positions[0] === 0
    && sampleStateCache(nearestCache, 0.6 / 30, false).positions[0] === 1);
}

// ── 6. Point-cache conversion ───────────────────────────────
{
  const conv = stateCacheToPointCacheData(cache);
  check('6 conversion ok under point-cache caps', conv.ok === true, conv.error ?? '');
  if (conv.ok) {
    const cloud = buildPointCacheCloud(conv.data, 0, true);
    check('6 converted cache plays through buildPointCacheCloud',
      !!cloud && cloud.table.rows.length === COUNT && cloud.positions.length === COUNT * 3
      && cloud.positions[15] === 5 && cloud.positions[16] === 10 && cloud.positions[17] === -5);
  }
  const big = assembleStateCache({ fps: 30, texSize: 128, frames: [{ positions: new Float32Array(128 * 128 * 4), velocities: new Float32Array(128 * 128 * 4) }] });
  check('6 assembly allows the main-pool size the format cap names', big.ok === true && big.cache.manifest.count === 16384);
  check('6 conversion refuses beyond the playback cap with the reason',
    big.ok && stateCacheToPointCacheData(big.cache).ok === false);
  check('6 format cap constant is the 256-squared pool', STATE_CACHE_MAX_POINTS === 65536);
}

// ── 7. Edition gate + hash sensitivity ──────────────────────
check('7 public edition disables export, full / unspecified allow',
  stateCacheExportAllowed('public') === false && stateCacheExportAllowed('full') === true && stateCacheExportAllowed() === true);
check('7 frame hash is sensitive to a single value',
  hashStateCacheFrame(cache.positions[0], cache.velocities[0]) !== hashStateCacheFrame(cache.positions[1], cache.velocities[0]));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
