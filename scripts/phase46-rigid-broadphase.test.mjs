// Phase 46 (UE5 #35 G-B stage B1) — spatial-hash broad phase.
// Acceptance: with the broad phase ON (the default), trajectories
// must be BIT-IDENTICAL to the legacy all-pairs double loop
// (broadphase: false) across the standard scenes — sphere path,
// OBB path, glue + anchored joints, and a long settle that puts
// bodies to sleep. The broad phase only drops pairs whose centre
// distance is beyond rA + rB + maxRadius; such pairs cannot
// interact (restDist ≤ rA + rB by construction), and the margin
// covers bodies pushed into range by earlier corrections in the
// same pass.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p46-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies } from './lib/rigidBodies.ts';
      export { buildFractureCellData } from './lib/voronoiFracture.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const { createRigidSolver, stepRigidBodies, buildFractureCellData } = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const BASE = {
  gravityY: -0.2 * 9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 150,
  restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
};

function scene(cells, gap = 0.25) {
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const COUNT = 4096;
  const positions = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const u = rnd() * 2 - 1; const th = rnd() * Math.PI * 2; const r = Math.cbrt(rnd()) * 14;
    const s = Math.sqrt(1 - u * u);
    positions[i * 4] = r * s * Math.cos(th);
    positions[i * 4 + 1] = r * u + 17;
    positions[i * 4 + 2] = r * s * Math.sin(th);
    positions[i * 4 + 3] = 1;
  }
  return buildFractureCellData(positions, COUNT, { cells, seed: 1, gap });
}

function fingerprint(state) {
  const out = [];
  for (const b of state.bodies) {
    out.push(b.pos[0], b.pos[1], b.pos[2], b.quat[0], b.quat[1], b.quat[2], b.quat[3],
      b.vel[0], b.vel[1], b.vel[2], b.angVel[0], b.angVel[1], b.angVel[2], b.sleeping ? 1 : 0);
  }
  for (const bond of state.bonds) out.push(bond.alive ? 1 : 0, bond.stress);
  for (const joint of state.joints) out.push(joint.alive ? 1 : 0, joint.lambda);
  out.push(state.time);
  return out;
}

function runPair(name, cells, solverOpts, stepOpts, frames, gap) {
  const mk = (broadphase) => {
    const s = createRigidSolver(scene(cells, gap), solverOpts);
    const opts = { ...BASE, ...stepOpts, broadphase };
    let divergedAt = -1;
    return { s, opts, divergedAt };
  };
  const ref = mk(false);
  const got = mk(true);
  let divergedAt = -1;
  for (let f = 0; f < frames; f++) {
    stepRigidBodies(ref.s, 1 / 60, ref.opts);
    stepRigidBodies(got.s, 1 / 60, got.opts);
    if (f % 120 === 119 || f === frames - 1) {
      const a = fingerprint(ref.s);
      const b = fingerprint(got.s);
      if (a.length !== b.length) { divergedAt = f; break; }
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) { divergedAt = f; break; }
      }
      if (divergedAt >= 0) break;
    }
  }
  check(name, divergedAt < 0, divergedAt >= 0 ? `first divergence at frame ${divergedAt}` : '');
  return { ref: ref.s, got: got.s };
}

// B1: sphere path, 64 bodies, drop + settle.
runPair('B1 sphere 64 bodies × 1200 frames bit-identical',
  64, { glueEnabled: false, startSleeping: false, convexEnabled: false }, {}, 1200);

// B2: OBB path (SAT narrow phase behind the same broad phase).
runPair('B2 convex 64 bodies × 1200 frames bit-identical',
  64, { glueEnabled: false, startSleeping: false, convexEnabled: true }, { convexEnabled: true }, 1200);

// B3: glue + anchored joints (bonded pairs skip the contact path;
// joint solving runs after the pair pass on both modes).
runPair('B3 glue + anchored joints 24 bodies × 900 frames bit-identical',
  24, { glueEnabled: true, startSleeping: false, convexEnabled: false, jointEnabled: true, jointAnchors: true },
  { glueEnabled: true, jointEnabled: true }, 900);

// B4: long settle — sleep engages; sleeping pairs and the
// support-loss waking path must agree too.
const b4 = runPair('B4 sleep settle 64 bodies × 3600 frames bit-identical',
  64, { glueEnabled: false, startSleeping: false, convexEnabled: false }, {}, 3600);
check('B4b the settle actually put bodies to sleep',
  b4.got.bodies.some((b) => b.sleeping),
  `sleeping=${b4.got.bodies.filter((b) => b.sleeping).length}`);

// B5: tight bake (gap 0) with lively restitution — dense,
// chaotic corrections inside a single pass stress the margin.
runPair('B5 tight bake restitution 0.6, 64 bodies × 900 frames bit-identical',
  64, { glueEnabled: false, startSleeping: false, convexEnabled: false }, { restitution: 0.6 }, 900, 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
