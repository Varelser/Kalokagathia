// Phase 48 (UE5 #35 G-B stage B2) — body budget 64 → 256.
// Acceptance:
//  - the budget constants and the fracture clamp agree at 256;
//  - a 256-cell bake really yields 256 bodies;
//  - at 256 bodies the broad phase stays BIT-IDENTICAL to the
//    legacy all-pairs reference (the B1 structural guarantee must
//    survive the budget raise);
//  - a 256-body drop settles sanely (finite, contained, sleep
//    engages);
//  - the GPU supply arrays (body texture backing, cluster LUT)
//    are sized and filled for the full 256 rows.
// Perf numbers are printed as information for the B3 stage
// (substep-budget judgement), not asserted — the VM is shared.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p48-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, writeRigidBodyTexture, RIGID_BODY_MAX } from './lib/rigidBodies.ts';
      export { buildFractureCellData, clampFractureCells } from './lib/voronoiFracture.ts';
      export { buildClusterColorLut, buildBodyClusterColorLut, RIGID_CLUSTER_COLOR_COUNT } from './lib/rigidClusterColors.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  createRigidSolver, stepRigidBodies, writeRigidBodyTexture, RIGID_BODY_MAX,
  buildFractureCellData, clampFractureCells,
  buildClusterColorLut, buildBodyClusterColorLut, RIGID_CLUSTER_COLOR_COUNT,
} = await import(pathToFileURL(BUNDLE).href);
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

// ── T1/T2: budget constants and clamp ──
check('T1 RIGID_BODY_MAX is 256', RIGID_BODY_MAX === 256, `got ${RIGID_BODY_MAX}`);
check('T1b cluster colour count follows the budget', RIGID_CLUSTER_COLOR_COUNT === 256,
  `got ${RIGID_CLUSTER_COLOR_COUNT}`);
check('T2 clamp caps at 256', clampFractureCells(300) === 256 && clampFractureCells(256) === 256,
  `300→${clampFractureCells(300)}`);
check('T2b clamp passes mid values and the low end through',
  clampFractureCells(100) === 100 && clampFractureCells(1) === 2 && clampFractureCells(64) === 64);

// ── T3: a 256-cell bake yields 256 bodies ──
const cells256 = scene(256);
check('T3 256-cell bake bodyCount is 256', cells256.bodyCount === 256, `got ${cells256.bodyCount}`);

// ── T4: broadphase ≡ legacy at 256 bodies (sphere path) ──
{
  const mk = (broadphase) => {
    const s = createRigidSolver(scene(256), { glueEnabled: false, startSleeping: false, convexEnabled: false });
    return { s, opts: { ...BASE, broadphase } };
  };
  const ref = mk(false);
  const got = mk(true);
  let divergedAt = -1;
  const FRAMES = 600;
  for (let f = 0; f < FRAMES; f++) {
    stepRigidBodies(ref.s, 1 / 60, ref.opts);
    stepRigidBodies(got.s, 1 / 60, got.opts);
    if (f % 120 === 119 || f === FRAMES - 1) {
      const a = fingerprint(ref.s);
      const b = fingerprint(got.s);
      if (a.length !== b.length) { divergedAt = f; break; }
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) { divergedAt = f; break; }
      }
      if (divergedAt >= 0) break;
    }
  }
  check('T4 sphere 256 bodies × 600 frames bit-identical', divergedAt < 0,
    divergedAt >= 0 ? `first divergence at frame ${divergedAt}` : '');
}

// ── T5: 256-body settle — finite, contained, sleep engages ──
const settled = createRigidSolver(scene(256), { glueEnabled: false, startSleeping: false, convexEnabled: false });
{
  const t0 = performance.now();
  const FRAMES = 3600;
  for (let f = 0; f < FRAMES; f++) stepRigidBodies(settled, 1 / 60, { ...BASE, broadphase: true });
  const msPerFrame = (performance.now() - t0) / FRAMES;
  let finite = true;
  let maxR = 0;
  for (const b of settled.bodies) {
    for (const v of [...b.pos, ...b.vel, ...b.angVel]) if (!Number.isFinite(v)) finite = false;
    maxR = Math.max(maxR, Math.hypot(b.pos[0], b.pos[1], b.pos[2]));
  }
  const sleeping = settled.bodies.filter((b) => b.sleeping).length;
  check('T5a settle stays finite', finite);
  check('T5b settle stays contained (|pos| < 160)', maxR < 160, `maxR=${maxR.toFixed(1)}`);
  check('T5c sleep engages at 256 bodies', sleeping > 0, `sleeping=${sleeping}/256`);
  console.log(`INFO  settle 256 bodies: ${msPerFrame.toFixed(3)} ms/frame (VM reference, broadphase on, incl. active phase)`);
  // Perf probe on the settled pile (mostly sleeping / resting contacts).
  const t1 = performance.now();
  for (let f = 0; f < 240; f++) stepRigidBodies(settled, 1 / 60, { ...BASE, broadphase: true });
  console.log(`INFO  settled pile 256 bodies: ${((performance.now() - t1) / 240).toFixed(3)} ms/frame (VM reference)`);
}

// ── T6: body texture backing covers all 256 rows ──
{
  const out = new Float32Array(RIGID_BODY_MAX * 4 * 4);
  writeRigidBodyTexture(settled, out);
  const last = settled.bodies[255];
  check('T6 texture row for body 255 carries its radius',
    out[255 * 4 + 3] === last.radius, `tex=${out[255 * 4 + 3]} body=${last.radius}`);
  check('T6b texture row 1 of body 255 carries its quaternion w (float32-packed)',
    out[(RIGID_BODY_MAX + 255) * 4 + 3] === Math.fround(last.quat[3]),
    `tex=${out[(RIGID_BODY_MAX + 255) * 4 + 3]} body=${last.quat[3]}`);
}

// ── T7: cluster LUT sized for 256 ──
check('T7 default LUT has 256 entries', buildClusterColorLut().length === 256 * 4,
  `len=${buildClusterColorLut().length}`);
check('T7b per-body LUT of the 256 bake has 256 entries',
  buildBodyClusterColorLut(cells256).length === 256 * 4,
  `len=${buildBodyClusterColorLut(cells256).length}`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
