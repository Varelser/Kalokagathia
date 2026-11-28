// Grammar 2.0 stage 3, slice S1 — Initial State
// (lib/gpgpuInitialState.ts + the S1 extension in
// lib/gpgpuInitialData.ts): the pure frame -> initial-data
// conversion (interleave, bit identity, the velocity w lane
// seeded at the bake's 0), the driver's validation and
// refusal discipline (frame range, pool texSize mismatch,
// the mandatory 'age' column, a missing / refusing
// applier), the held-cache store and the applier registry.
// The bake's own output is pinned by sha256 so the
// unused-path bit identity is verified, not assumed.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S1.
// NOT covered here (unconfirmed, real-machine gate): the
// live applier's WebGL copy into real render targets, and
// the determinism gate "a sim resumed from frame N matches
// the uninterrupted sim at the same time".
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialData, buildGpgpuInitialDataFromStateFrame } from './lib/gpgpuInitialData.ts';
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export { applyStateCacheFrameAsInitialState, applyHeldStateCacheFrameAsInitialState, setHeldStateCache, getHeldStateCache, clearHeldStateCache, registerStateCacheInitialStateApplier, getStateCacheInitialStateApplier, stateCacheAgeColumnIndex } from './lib/gpgpuInitialState.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildGpgpuInitialData, buildGpgpuInitialDataFromStateFrame,
  assembleStateCache,
  applyStateCacheFrameAsInitialState, applyHeldStateCacheFrameAsInitialState,
  setHeldStateCache, getHeldStateCache, clearHeldStateCache,
  registerStateCacheInitialStateApplier, getStateCacheInitialStateApplier,
  stateCacheAgeColumnIndex,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => bits(a).equals(bits(b));

// ── 1. The bake itself is untouched (unused-path identity) ──
// sha256 over posData bytes ++ velData bytes, pinned from
// the pre-S1 code (2026-11-28).
{
  const cases = [
    [4, 10, 'sphere', 12345, 8, 'e6d66c370823934ace2e279d43a09b57d27329b6dbb4afe2c505573a172b6a6e'],
    [2, 5, 'cube', 7, 6, '33ac8800cefe2726eeae3763226b45c5e113c5107e6761f0100358556ad85eac'],
  ];
  for (const [texSize, radius, shape, seed, ageMax, pin] of cases) {
    const { posData, velData } = buildGpgpuInitialData(texSize, radius, shape, seed, ageMax);
    const h = createHash('sha256');
    h.update(bits(posData));
    h.update(bits(velData));
    check(`1 bake pin ${shape}/seed ${seed}`, h.digest('hex') === pin);
  }
}

// ── 2. Builder: interleave + bit identity ───────────────────
const COUNT = 4;
const positions3 = new Float32Array([1.5, -2.25, 3.75, 0, 0, 0, -0.5, 0.25, 100.125, 7, 8, 9]);
const velocities3 = new Float32Array([-1, 2, -3, 0.5, 0.5, 0.5, 9.25, -8.5, 7.75, 0, 0, 0]);
const ages = new Float32Array([0, 1.25, 7.999, 3.5]);
{
  const built = buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: positions3, velocities: velocities3, ages,
  });
  check('2 builder returns data', built !== null);
  const expectedPos = new Float32Array(COUNT * 4);
  const expectedVel = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    expectedPos.set([positions3[i * 3], positions3[i * 3 + 1], positions3[i * 3 + 2], ages[i]], i * 4);
    expectedVel.set([velocities3[i * 3], velocities3[i * 3 + 1], velocities3[i * 3 + 2], 0], i * 4);
  }
  check('2 posData bit-identical to the manual interleave', bitEqual(built.posData, expectedPos));
  check('2 velData bit-identical, w lane (Kuramoto phase) at the bake seed 0', bitEqual(built.velData, expectedVel));
}

// ── 3. Builder: length discipline (null, never padded) ──────
{
  check('3 short positions refused', buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: new Float32Array(11), velocities: velocities3, ages,
  }) === null);
  check('3 short velocities refused', buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: positions3, velocities: new Float32Array(11), ages,
  }) === null);
  check('3 short ages refused', buildGpgpuInitialDataFromStateFrame({
    count: COUNT, positions: positions3, velocities: velocities3, ages: new Float32Array(3),
  }) === null);
  check('3 zero count refused', buildGpgpuInitialDataFromStateFrame({
    count: 0, positions: new Float32Array(0), velocities: new Float32Array(0), ages: new Float32Array(0),
  }) === null);
}

// ── A real cache, assembled through the S0 format ───────────
const TEX = 2;
// Readback-shaped frames: positions w carries 999 (a junk
// lane the format drops at assembly) while the age COLUMN
// carries the real ages — the driver must read the column.
const readbackFrame = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const age = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i * 10 + f, -i - f * 0.5, i + f * 2, 999], i * 4);
    velocities.set([f - i, i * 0.25, -f, 0], i * 4);
    age[i] = 100 + i + f * 10;
  }
  return { positions, velocities, attributes: { age } };
};
const assembled = assembleStateCache({
  fps: 30, texSize: TEX, frames: [readbackFrame(0), readbackFrame(1), readbackFrame(2)], attributeNames: ['age'],
});
check('setup cache assembled', assembled.ok === true);
const cache = assembled.cache;

// ── 4. Driver: round trip is bit-identical ──────────────────
{
  let seen = null;
  const applier = (req) => { seen = req; return { ok: true }; };
  const result = applyStateCacheFrameAsInitialState({ cache, frameIndex: 1, applier });
  check('4 apply ok', result.ok === true && result.frameIndex === 1 && result.texSize === TEX);
  check('4 applier received the frame + texSize', seen !== null && seen.frameIndex === 1 && seen.texSize === TEX);
  const src = readbackFrame(1);
  const expectedPos = new Float32Array(COUNT * 4);
  const expectedVel = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    expectedPos.set([src.positions[i * 4], src.positions[i * 4 + 1], src.positions[i * 4 + 2], src.attributes.age[i]], i * 4);
    expectedVel.set([src.velocities[i * 4], src.velocities[i * 4 + 1], src.velocities[i * 4 + 2], 0], i * 4);
  }
  check('4 restored posData bit-identical (xyz from the frame, w from the age column — not the dropped 999 lane)',
    bitEqual(seen.initialData.posData, expectedPos));
  check('4 restored velData bit-identical (xyz from the frame, w = 0)',
    bitEqual(seen.initialData.velData, expectedVel));
}

// ── 5. Driver: refusals ─────────────────────────────────────
{
  const applier = () => ({ ok: true });
  check('5 frame -1 refused', applyStateCacheFrameAsInitialState({ cache, frameIndex: -1, applier }).ok === false);
  check('5 frame == frameCount refused', applyStateCacheFrameAsInitialState({ cache, frameIndex: 3, applier }).ok === false);
  check('5 fractional frame refused', applyStateCacheFrameAsInitialState({ cache, frameIndex: 1.5, applier }).ok === false);
  check('5 pool texSize mismatch refused',
    applyStateCacheFrameAsInitialState({ cache, frameIndex: 0, targetTexSize: 3, applier }).ok === false);
  check('5 pool texSize match accepted',
    applyStateCacheFrameAsInitialState({ cache, frameIndex: 0, targetTexSize: TEX, applier }).ok === true);
  check('5 explicit null applier refused',
    applyStateCacheFrameAsInitialState({ cache, frameIndex: 0, applier: null }).ok === false);
  const refused = applyStateCacheFrameAsInitialState({
    cache, frameIndex: 0, applier: () => ({ ok: false, error: 'applier-says-no' }),
  });
  check('5 applier refusal propagated with its reason', refused.ok === false && refused.error === 'applier-says-no');

  const noAge = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [{ positions: readbackFrame(0).positions, velocities: readbackFrame(0).velocities }],
    attributeNames: [],
  });
  check('setup age-less cache assembled', noAge.ok === true);
  const noAgeResult = applyStateCacheFrameAsInitialState({ cache: noAge.cache, frameIndex: 0, applier });
  check('5 cache without the age column refused', noAgeResult.ok === false);
  check('5 age refusal states the reason', noAgeResult.ok === false && noAgeResult.error.includes('age'));
  check('5 age column index: present / absent',
    stateCacheAgeColumnIndex(cache) === 0 && stateCacheAgeColumnIndex(noAge.cache) === -1);
  const cased = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [{ positions: readbackFrame(0).positions, velocities: readbackFrame(0).velocities, attributes: { Age: readbackFrame(0).attributes.age } }],
    attributeNames: ['Age'],
  });
  check('5 age column match is case-insensitive', cased.ok === true && stateCacheAgeColumnIndex(cased.cache) === 0
    && applyStateCacheFrameAsInitialState({ cache: cased.cache, frameIndex: 0, applier }).ok === true);
}

// ── 6. Held store + applier registry ────────────────────────
{
  clearHeldStateCache();
  check('6 nothing held refuses', applyHeldStateCacheFrameAsInitialState({ frameIndex: 0, applier: () => ({ ok: true }) }).ok === false);
  setHeldStateCache(cache, 'テストキャッシュ');
  check('6 held cache readable', getHeldStateCache()?.sourceName === 'テストキャッシュ'
    && getHeldStateCache()?.cache === cache);
  check('6 held apply with an explicit applier',
    applyHeldStateCacheFrameAsInitialState({ frameIndex: 2, applier: () => ({ ok: true }) }).ok === true);
  check('6 no registered applier refuses',
    getStateCacheInitialStateApplier() === null
    && applyHeldStateCacheFrameAsInitialState({ frameIndex: 0 }).ok === false);
  let seen = null;
  const unregister = registerStateCacheInitialStateApplier((req) => { seen = req; return { ok: true }; });
  check('6 registered applier is used', applyHeldStateCacheFrameAsInitialState({ frameIndex: 0 }).ok === true && seen?.frameIndex === 0);
  unregister();
  check('6 unregister clears only its own applier',
    getStateCacheInitialStateApplier() === null
    && applyHeldStateCacheFrameAsInitialState({ frameIndex: 0 }).ok === false);
  clearHeldStateCache();
  check('6 cleared store refuses again', applyHeldStateCacheFrameAsInitialState({ frameIndex: 0, applier: () => ({ ok: true }) }).ok === false);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
