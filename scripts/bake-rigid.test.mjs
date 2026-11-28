// XPBD rigid bake (S2) pins, mirroring the Colab sweep scenes
// (BAKE_SR1_RESULT_RECORD):
// (1) Friction stack settles: 128 spheres in a walled box,
//     substeps 5, mu 0.5 — max pair penetration stays under
//     1% of diameter and the mean speed over the last frames
//     is small (the impulse approximation failed this scene
//     in the sweep; XPBD passed at 0.00091 / 0.0151 there).
// (2) Joint chain stretch: 32 links, first body static —
//     substeps 10 keeps max stretch error under 2% and beats
//     substeps 1 by a wide margin.
// (3) THE S2 GATE — resume without contact history: a
//     checkpoint-chained split run reproduces the full run's
//     frame hashes exactly, because the XPBD form here keeps
//     no cross-frame contact state.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'scripts', `.bake-rigid-bundle-${process.pid}`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

await build({
  entryPoints: [join(ROOT, 'lib', 'bakeRigid.ts'), join(ROOT, 'lib', 'bakeRunner.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUTDIR, outExtension: { '.js': '.mjs' },
}).catch((err) => { console.error(err); process.exit(1); });
const { stepRigidBake, runRigidBakeJob } = await import(pathToFileURL(join(OUTDIR, 'bakeRigid.mjs')).href);
const { extractCheckpoint } = await import(pathToFileURL(join(OUTDIR, 'bakeRunner.mjs')).href);

const mkState = (count) => ({
  count,
  positions: new Float32Array(count * 3),
  velocities: new Float32Array(count * 3),
  quats: new Float32Array(count * 4),
  angVels: new Float32Array(count * 3),
  radii: new Float32Array(count),
  invMasses: new Float32Array(count),
  ages: new Float32Array(count),
});

// (1) Settling pile: 128 spheres, r=0.06, jittered grid drop.
{
  const COUNT = 128, R = 0.06;
  const st = mkState(COUNT);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < COUNT; i++) {
    const gx = i % 6, gy = Math.floor(i / 36), gz = Math.floor(i / 6) % 6;
    st.positions[i * 3] = 0.2 + gx * 0.12 + (rnd() - 0.5) * 0.01;
    st.positions[i * 3 + 1] = 0.25 + gy * 0.13 + (rnd() - 0.5) * 0.01;
    st.positions[i * 3 + 2] = 0.2 + gz * 0.12 + (rnd() - 0.5) * 0.01;
    st.quats[i * 4 + 3] = 1;
    st.radii[i] = R; st.invMasses[i] = 1;
  }
  const opts = { fps: 60, substeps: 5, friction: 0.5 };
  let tailSpeed = 0;
  for (let f = 0; f < 240; f++) {
    stepRigidBake(st, opts);
    if (f >= 210) {
      let m = 0;
      for (let i = 0; i < COUNT; i++) m += Math.hypot(st.velocities[i * 3], st.velocities[i * 3 + 1], st.velocities[i * 3 + 2]);
      tailSpeed += m / COUNT / 30;
    }
  }
  let maxPen = 0, finite = true;
  for (let i = 0; i < COUNT; i++) {
    for (let a = 0; a < 3; a++) if (!Number.isFinite(st.positions[i * 3 + a])) finite = false;
    for (let j = i + 1; j < COUNT; j++) {
      const d = Math.hypot(st.positions[j * 3] - st.positions[i * 3], st.positions[j * 3 + 1] - st.positions[i * 3 + 1], st.positions[j * 3 + 2] - st.positions[i * 3 + 2]);
      maxPen = Math.max(maxPen, (2 * R - d) / (2 * R));
    }
  }
  check('pile finite', finite);
  check('pile penetration < 1% of diameter', maxPen < 0.01, `maxPen ${(maxPen * 100).toFixed(3)}%`);
  check('pile settled (tail mean speed < 0.05)', tailSpeed < 0.05, `tail ${tailSpeed.toFixed(4)}`);
}

// (2) Chain stretch.
const chainError = (substeps) => {
  const LINKS = 32, REST = 0.025;
  const st = mkState(LINKS + 1);
  for (let i = 0; i <= LINKS; i++) {
    st.positions[i * 3] = 0.1 + i * REST; st.positions[i * 3 + 1] = 0.9; st.positions[i * 3 + 2] = 0.5;
    st.quats[i * 4 + 3] = 1; st.radii[i] = 0.008; st.invMasses[i] = i === 0 ? 0 : 1;
  }
  const joints = [];
  for (let i = 0; i < LINKS; i++) joints.push({ a: i, b: i + 1, restLength: REST, compliance: 0 });
  for (let f = 0; f < 120; f++) stepRigidBake(st, { fps: 60, substeps, friction: 0, joints });
  let maxErr = 0;
  for (let i = 0; i < LINKS; i++) {
    const d = Math.hypot(st.positions[(i + 1) * 3] - st.positions[i * 3], st.positions[(i + 1) * 3 + 1] - st.positions[i * 3 + 1], st.positions[(i + 1) * 3 + 2] - st.positions[i * 3 + 2]);
    maxErr = Math.max(maxErr, Math.abs(d - REST) / REST);
  }
  return maxErr;
};
{
  const e10 = chainError(10), e1 = chainError(1);
  check('chain sub10 stretch < 2%', e10 < 0.02, `e10 ${e10.toFixed(4)}`);
  check('chain sub10 much better than sub1', e10 < e1 * 0.2, `e1 ${e1.toFixed(3)} e10 ${e10.toFixed(4)}`);
}

// (3) Runner gate: chained == full.
{
  const TEX = 16, COUNT = TEX * TEX, R = 0.03;
  const mkInitial = () => {
    const st = mkState(COUNT);
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < COUNT; i++) {
      st.positions[i * 3] = 0.15 + (i % 16) * 0.045 + (rnd() - 0.5) * 0.005;
      st.positions[i * 3 + 1] = 0.3 + Math.floor(i / 16) * 0.05;
      st.positions[i * 3 + 2] = 0.3 + (rnd() - 0.5) * 0.3;
      st.quats[i * 4 + 3] = 1; st.radii[i] = R; st.invMasses[i] = 1;
    }
    return st;
  };
  const jobBase = { sceneRef: { ref: 'scene', hash: 'rigid-test' }, attributes: ['age', 'angVelX', 'angVelY', 'angVelZ'], includeOrientation: true, seed: 3, method: 'checkpoint-chain' };
  const stepOptions = { fps: 60, substeps: 5, friction: 0.5 };
  const runArgs = { texSize: TEX, generator: 'bake-rigid-test', generatorVersion: '0', stepOptions };
  const full = runRigidBakeJob({ job: { ...jobBase, jobId: 'f', frameRange: [0, 24], startMode: 'fromInitial', outputRef: 'f-out' }, initial: mkInitial(), ...runArgs });
  check('rigid full run ok', full.ok, full.ok ? '' : full.error);
  const partA = runRigidBakeJob({ job: { ...jobBase, jobId: 'a', frameRange: [0, 12], startMode: 'fromInitial', outputRef: 'a-out' }, initial: mkInitial(), ...runArgs });
  const cp = extractCheckpoint(partA.result.cache, 11);
  const init = mkInitial();
  const partB = runRigidBakeJob({
    job: { ...jobBase, jobId: 'b', frameRange: [12, 24], startMode: 'fromCheckpoint', checkpointRef: partA.result.lastCheckpoint, outputRef: 'b-out' },
    checkpoint: cp.cache, radii: init.radii, invMasses: init.invMasses, ...runArgs,
  });
  check('rigid chained run ok', partB.ok, partB.ok ? '' : partB.error);
  if (full.ok && partB.ok) {
    check('GATE: resume without contact history == full (hashes)',
      JSON.stringify(partB.result.cache.manifest.frameHashes) === JSON.stringify(full.result.cache.manifest.frameHashes.slice(12)));
  }
}

try { rmSync(OUTDIR, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
