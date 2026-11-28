// FLIP bake stepper (S1) pins:
// (1) A liquid block released in a closed box stays finite
//     and inside the domain for 120 steps, and its centre of
//     mass settles downward (gravity does work, the floor
//     holds it).
// (2) The end state is calmer than the fall: mean speed in
//     the last step is below the peak mean speed.
// (3) Through the bake runner, two identical runs produce
//     identical frame hashes (determinism), and a chained
//     split run matches the full run's hashes.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'scripts', `.bake-flip-bundle-${process.pid}`);
const BUNDLE = join(OUTDIR, 'bakeFlip.mjs');
const BUNDLE2 = join(OUTDIR, 'bakeRunner.mjs');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

await build({
  entryPoints: [join(ROOT, 'lib', 'bakeFlip.ts'), join(ROOT, 'lib', 'bakeRunner.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUTDIR, outExtension: { '.js': '.mjs' },
}).catch((err) => { console.error(err); process.exit(1); });
const mod = await import(pathToFileURL(BUNDLE).href);
const { createFlipBakeStepper } = mod;
const { runBakeJob, extractCheckpoint } = await import(pathToFileURL(BUNDLE2).href);

const N = 16, FPS = 60;
// 4096 particles: 2x2x2 per cell in a 16x8x16 block (lower half, x/z full).
const PER = 2, BX = 16, BY = 8, BZ = 16;
const COUNT = BX * BY * BZ * PER * PER * PER;
const initial = () => {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT);
  const ages = new Float32Array(COUNT);
  let p = 0;
  for (let cz = 0; cz < BZ; cz++) for (let cy = 0; cy < BY; cy++) for (let cx = 0; cx < BX; cx++) {
    for (let oz = 0; oz < PER; oz++) for (let oy = 0; oy < PER; oy++) for (let ox = 0; ox < PER; ox++) {
      positions[p * 3] = (cx + (ox + 0.5) / PER) / N;
      positions[p * 3 + 1] = (cy + (oy + 0.5) / PER) / N;
      positions[p * 3 + 2] = (cz + (oz + 0.5) / PER) / N;
      p++;
    }
  }
  return { positions, velocities: new Float32Array(COUNT * 3), ages };
};

const stepper = createFlipBakeStepper({ n: N, fps: FPS, pressureIterations: 40 });
const state = initial();
let peakMean = 0, lastMean = 0, comY0 = 0, comY1 = 0;
for (let i = 0; i < COUNT; i++) comY0 += state.positions[i * 3 + 1];
comY0 /= COUNT;
for (let s = 0; s < 120; s++) {
  stepper(state, s);
  let mean = 0;
  for (let i = 0; i < COUNT; i++) mean += Math.hypot(state.velocities[i * 3], state.velocities[i * 3 + 1], state.velocities[i * 3 + 2]);
  mean /= COUNT;
  peakMean = Math.max(peakMean, mean); lastMean = mean;
}
let finite = true, inside = true;
for (let i = 0; i < COUNT; i++) {
  comY1 += state.positions[i * 3 + 1];
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(state.positions[i * 3 + a]) || !Number.isFinite(state.velocities[i * 3 + a])) finite = false;
    if (state.positions[i * 3 + a] < 0 || state.positions[i * 3 + a] > 1) inside = false;
  }
}
comY1 /= COUNT;
check('finite after 120 steps', finite);
check('inside domain', inside);
check('centre of mass settled downward', comY1 < comY0, `comY ${comY0.toFixed(4)} -> ${comY1.toFixed(4)}`);
check('last mean speed below peak', lastMean < peakMean, `peak ${peakMean.toFixed(3)} last ${lastMean.toFixed(3)}`);
check('last mean speed bounded (< 2 m/s)', lastMean < 2, `last ${lastMean.toFixed(3)}`);

// Runner determinism + chaining at texSize 128 (16384 particles).
const TEX = 128;
const jobBase = { sceneRef: { ref: 'scene', hash: 'flip-test' }, attributes: ['age'], includeOrientation: false, seed: 7, method: 'checkpoint-chain' };
const runArgs = { fps: FPS, texSize: TEX, generator: 'bake-flip-test', generatorVersion: '0' };
const mkStepper = () => createFlipBakeStepper({ n: N, fps: FPS, pressureIterations: 20 });
const full = runBakeJob({ job: { ...jobBase, jobId: 'f', frameRange: [0, 12], startMode: 'fromInitial', outputRef: 'f-out' }, initial: initial(), stepper: mkStepper(), ...runArgs });
check('runner full ok', full.ok, full.ok ? '' : full.error);
const full2 = runBakeJob({ job: { ...jobBase, jobId: 'f', frameRange: [0, 12], startMode: 'fromInitial', outputRef: 'f-out' }, initial: initial(), stepper: mkStepper(), ...runArgs });
check('deterministic hashes', full.ok && full2.ok && JSON.stringify(full.result.cache.manifest.frameHashes) === JSON.stringify(full2.result.cache.manifest.frameHashes));
const partA = runBakeJob({ job: { ...jobBase, jobId: 'a', frameRange: [0, 6], startMode: 'fromInitial', outputRef: 'a-out' }, initial: initial(), stepper: mkStepper(), ...runArgs });
const cp = extractCheckpoint(partA.result.cache, 5);
const partB = runBakeJob({ job: { ...jobBase, jobId: 'b', frameRange: [6, 12], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'b-out' }, checkpoint: cp.cache, stepper: mkStepper(), ...runArgs });
check('chained part ok', partB.ok, partB.ok ? '' : partB.error);
if (full.ok && partB.ok) {
  check('chained hashes == full slice', JSON.stringify(partB.result.cache.manifest.frameHashes) === JSON.stringify(full.result.cache.manifest.frameHashes.slice(6)));
}

try { rmSync(OUTDIR, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
