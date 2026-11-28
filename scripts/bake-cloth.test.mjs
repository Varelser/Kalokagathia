// XPBD cloth bake (S3) pins, following the S-C sweep scene
// and its decision lines (BAKE_SC1_RESULT_RECORD):
// (1) A sheet dropped into the box crumples on the floor;
//     with self-collision ON the final penetrating-pair count
//     is ZERO (the sweep's v2 reached 1 pair with push-out
//     alone) and the sheet SETTLES (final mean speed small —
//     the half the sweep found missing, fixed here by the
//     contact normal-velocity pass).
// (2) Contrast: with self-collision OFF, penetrating pairs
//     remain — the comparison that proves the pass works.
// (3) Through the bake runner, a checkpoint-chained split
//     reproduces the full run's hashes (cloth state is
//     position/velocity only; topology is scene data).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'scripts', `.bake-cloth-bundle-${process.pid}`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

await build({
  entryPoints: [join(ROOT, 'lib', 'bakeCloth.ts'), join(ROOT, 'lib', 'bakeRunner.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUTDIR, outExtension: { '.js': '.mjs' },
}).catch((err) => { console.error(err); process.exit(1); });
const { createClothSheet, createClothBakeStepper, countClothPenetrations } = await import(pathToFileURL(join(OUTDIR, 'bakeCloth.mjs')).href);
const { runBakeJob, extractCheckpoint } = await import(pathToFileURL(join(OUTDIR, 'bakeRunner.mjs')).href);

const N = 24, THICK = 0.02, FPS = 60;
const runScene = (selfCollision, frames) => {
  const sheet = createClothSheet({ n: N, size: 0.7, y: 0.55, start: 0.15 });
  // Pre-fold the sheet like a closing book (right half rotated
  // up and over the centre line) so it MUST land in layers —
  // a flat drop can settle unfolded, which made the
  // self-collision-off contrast vacuous.
  const THETA = 2.4, CX = 0.5, Y0 = 0.55;
  for (let i = 0; i < N * N; i++) {
    const x = sheet.state.positions[i * 3];
    if (x > CX) {
      const dx = x - CX;
      sheet.state.positions[i * 3] = CX + dx * Math.cos(THETA);
      sheet.state.positions[i * 3 + 1] = Y0 + dx * Math.sin(THETA);
    }
  }
  const stepper = createClothBakeStepper(sheet, {
    // Winning configuration from the S3 diagnosis: late
    // collision ordering + 2 link iterations + contact
    // friction (see BAKE_IMPL_S3_RECORD for the trade-off
    // measurements behind it).
    fps: FPS, substeps: 10, thickness: THICK, selfCollision, compliance: 0, bendCompliance: 1e-3, damping: 0.01,
    solveIterations: 2, lateCollision: true, contactFriction: 0.5,
  });
  const st = sheet.state;
  let tail = 0;
  for (let f = 0; f < frames; f++) {
    stepper(st, f);
    if (f >= frames - 30) {
      let m = 0;
      for (let i = 0; i < N * N; i++) m += Math.hypot(st.velocities[i * 3], st.velocities[i * 3 + 1], st.velocities[i * 3 + 2]);
      tail += m / (N * N) / 30;
    }
  }
  let finite = true;
  for (let i = 0; i < N * N * 3; i++) if (!Number.isFinite(st.positions[i])) finite = false;
  return { pen: countClothPenetrations(st, N, THICK), tail, finite };
};

{
  const on = runScene(true, 240);
  check('cloth finite (self-collision on)', on.finite);
  check('cloth penetrating pairs == 0 (below 0.9x thickness; pairs AT thickness are resting contact)', on.pen === 0, `pen ${on.pen}`);
  check('cloth settled (tail mean speed < 0.1)', on.tail < 0.1, `tail ${on.tail.toFixed(4)}`);
  const off = runScene(false, 240);
  check('contrast: self-collision off leaves penetrations', off.pen > 0, `pen ${off.pen}`);
}

// Runner chaining (smaller sheet for speed).
{
  const n2 = 16;
  const sheet = createClothSheet({ n: n2, size: 0.7, y: 0.55, start: 0.15 });
  const mkStepper = () => createClothBakeStepper(sheet, { fps: FPS, substeps: 10, thickness: THICK, compliance: 0, bendCompliance: 1e-3, damping: 0.01, solveIterations: 2, lateCollision: true, contactFriction: 0.5 });
  const jobBase = { sceneRef: { ref: 'scene', hash: 'cloth-test' }, attributes: ['age'], includeOrientation: false, seed: 5, method: 'checkpoint-chain' };
  const runArgs = { fps: FPS, texSize: n2, generator: 'bake-cloth-test', generatorVersion: '0' };
  const clone = (s) => ({ positions: new Float32Array(s.positions), velocities: new Float32Array(s.velocities), ages: new Float32Array(s.ages) });
  const full = runBakeJob({ job: { ...jobBase, jobId: 'f', frameRange: [0, 16], startMode: 'fromInitial', outputRef: 'f-out' }, initial: clone(sheet.state), stepper: mkStepper(), ...runArgs });
  check('cloth full run ok', full.ok, full.ok ? '' : full.error);
  const partA = runBakeJob({ job: { ...jobBase, jobId: 'a', frameRange: [0, 8], startMode: 'fromInitial', outputRef: 'a-out' }, initial: clone(sheet.state), stepper: mkStepper(), ...runArgs });
  const cp = extractCheckpoint(partA.result.cache, 7);
  const partB = runBakeJob({ job: { ...jobBase, jobId: 'b', frameRange: [8, 16], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'b-out' }, checkpoint: cp.cache, stepper: mkStepper(), ...runArgs });
  check('cloth chained run ok', partB.ok, partB.ok ? '' : partB.error);
  if (full.ok && partB.ok) {
    check('cloth chained hashes == full slice',
      JSON.stringify(partB.result.cache.manifest.frameHashes) === JSON.stringify(full.result.cache.manifest.frameHashes.slice(8)));
  }
}

try { rmSync(OUTDIR, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
