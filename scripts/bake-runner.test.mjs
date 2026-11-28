// Bake runner (S0 common base) pins:
// (1) A full run and a checkpoint-chained split run of the
//     same deterministic stepper produce identical frame
//     hashes after mergeBakeJobParts — the CPU-side resume
//     consistency the whole bake split rests on.
// (2) An independent-recompute part (fromInitial, frames
//     before the range discarded) merges to the same hashes.
// (3) A checkpoint whose hash does not match checkpointRef
//     is refused, and a checkpoint at the wrong frame is
//     refused.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.bake-runner-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

await build({
  entryPoints: [join(ROOT, 'lib', 'bakeRunner.ts')],
  bundle: true, format: 'esm', platform: 'node',
  outfile: BUNDLE,
}).catch((err) => { console.error(err); process.exit(1); });

const runner = await import(pathToFileURL(BUNDLE).href);
const { runBakeJob, extractCheckpoint } = runner;
const cacheMod = await import(pathToFileURL(BUNDLE).href);
const { mergeBakeJobParts } = cacheMod;

const TEX = 4, COUNT = TEX * TEX, FPS = 60, SEED = 42, HASH = 'scene-hash-test';
const initial = () => {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const ages = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (i % 4) * 0.1; positions[i * 3 + 1] = 1 + Math.floor(i / 4) * 0.1; positions[i * 3 + 2] = 0;
    velocities[i * 3] = 0.01 * i; velocities[i * 3 + 1] = 0; velocities[i * 3 + 2] = 0.005 * i;
    ages[i] = i * 0.01;
  }
  return { positions, velocities, ages };
};
const stepper = (state, t) => {
  const dt = 1 / FPS;
  for (let i = 0; i < COUNT; i++) {
    state.velocities[i * 3 + 1] -= 9.8 * dt;
    state.positions[i * 3] += state.velocities[i * 3] * dt;
    state.positions[i * 3 + 1] += state.velocities[i * 3 + 1] * dt;
    state.positions[i * 3 + 2] += state.velocities[i * 3 + 2] * dt;
    if (state.positions[i * 3 + 1] < 0) { state.positions[i * 3 + 1] = 0; state.velocities[i * 3 + 1] *= -0.5; }
    state.ages[i] += dt;
  }
  void t;
};
const jobBase = { sceneRef: { ref: 'scene', hash: HASH }, attributes: ['age'], includeOrientation: false, seed: SEED, method: 'checkpoint-chain' };
const runArgs = { fps: FPS, texSize: TEX, generator: 'bake-runner-test', generatorVersion: '0' };

// Full run [0, 24)
const full = runBakeJob({ job: { ...jobBase, jobId: 'full', frameRange: [0, 24], startMode: 'fromInitial', outputRef: 'full-out' }, initial: initial(), stepper, ...runArgs });
check('full run ok', full.ok, full.ok ? '' : full.error);

// Split: [0,12) then checkpoint-chain [12,24)
const partA = runBakeJob({ job: { ...jobBase, jobId: 'a', frameRange: [0, 12], startMode: 'fromInitial', outputRef: 'a-out' }, initial: initial(), stepper, ...runArgs });
check('part A ok', partA.ok, partA.ok ? '' : partA.error);
const cp = extractCheckpoint(partA.result.cache, 11);
check('checkpoint extract ok', cp.ok, cp.ok ? '' : cp.error);
const partB = runBakeJob({
  job: { ...jobBase, jobId: 'b', frameRange: [12, 24], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'b-out' },
  checkpoint: cp.cache, stepper, ...runArgs,
});
check('part B (chained) ok', partB.ok, partB.ok ? '' : partB.error);

const merged = mergeBakeJobParts([
  { job: { ...jobBase, jobId: 'a', frameRange: [0, 12], startMode: 'fromInitial', outputRef: 'a-out' }, cache: partA.result.cache },
  { job: { ...jobBase, jobId: 'b', frameRange: [12, 24], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'b-out' }, cache: partB.result.cache },
]);
check('merge chained ok', merged.ok, merged.ok ? '' : merged.error);
if (merged.ok && full.ok) {
  check('chained hashes == full hashes', JSON.stringify(merged.cache.manifest.frameHashes) === JSON.stringify(full.result.cache.manifest.frameHashes));
}

// Independent recompute for [12,24)
const partB2 = runBakeJob({
  job: { ...jobBase, jobId: 'b2', frameRange: [12, 24], startMode: 'fromInitial', outputRef: 'b2-out', method: 'independent-recompute' },
  initial: initial(), stepper, ...runArgs,
});
check('part B2 (recompute) ok', partB2.ok, partB2.ok ? '' : partB2.error);
if (partB2.ok) {
  check('recompute hashes == full slice', JSON.stringify(partB2.result.cache.manifest.frameHashes) === JSON.stringify(full.result.cache.manifest.frameHashes.slice(12)));
}

// Refusals
const badHash = runBakeJob({
  job: { ...jobBase, jobId: 'bad', frameRange: [12, 24], startMode: 'fromCheckpoint', checkpointRef: { ref: 'x', hash: 'deadbeef', frameIndex: 11 }, outputRef: 'bad-out' },
  checkpoint: cp.cache, stepper, ...runArgs,
});
check('wrong checkpoint hash refused', !badHash.ok);
const badFrame = runBakeJob({
  job: { ...jobBase, jobId: 'bad2', frameRange: [13, 24], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'bad2-out' },
  checkpoint: cp.cache, stepper, ...runArgs,
});
check('checkpoint at non-boundary frame refused', !badFrame.ok);

try { unlinkSync(BUNDLE); } catch {}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
