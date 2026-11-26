// Phase 42 (Round 84 gap 6) — UE5 #35 G-A: OBB box inertia
// (stage 1) + pair broad-phase widening (stage 2), against the
// design's pre-registered acceptance lines
// (materials/round84-gaps/06-ue5-35-top-gap-design.md):
// - A1 inertia correctness: box tensor analytic values and the
//   frame-transformed angular response within 1e-6 relative;
//   key off -> bit-identical legacy trajectories
// - A2 stability: fracture scenes (12 and 64 bodies) settle by
//   frame 600, no divergence / NaN / escape at frame 1200
// - A3 settled SAT penetration max <= 0.05 (proposal line —
//   the measured distribution is printed either way)
// - A4 determinism: identical runs bit-identical
// - A5 cost: 64-body step increase < 5% (median, interleaved)
// - Stage 2: a pair at its rest distance whose rotated boxes
//   interpenetrate now reaches SAT and separates; a pair whose
//   boxes do not touch passes through untouched
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p42-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const relNear = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, resolveRigid } from './lib/rigidBodies.ts';
      export { obbBoxInertia, obbInertiaResponse, obbInertiaFactor, placeObb, obbSatContact } from './lib/rigidObb.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { createRigidSolver, stepRigidBodies, resolveRigid, obbBoxInertia, obbInertiaResponse, obbInertiaFactor, placeObb, obbSatContact } = lib;

// ── Cell helpers (the phase20-rigid-obb pattern) ──────────────
function makeShapeCells(specs) {
  const assignment = [];
  const offsets = [];
  const centroids = new Float32Array(specs.length * 3);
  const radii = new Float32Array(specs.length);
  const coreRadii = new Float32Array(specs.length);
  const cellCounts = new Int32Array(specs.length);
  specs.forEach((s, bi) => {
    centroids[bi * 3] = s.pos[0]; centroids[bi * 3 + 1] = s.pos[1]; centroids[bi * 3 + 2] = s.pos[2];
    radii[bi] = s.radius;
    coreRadii[bi] = s.coreRadius ?? 0.3;
    cellCounts[bi] = s.count ?? 8;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      assignment.push(bi);
      offsets.push(sx * s.half[0], sy * s.half[1], sz * s.half[2]);
    }
  });
  return { assignment: new Int32Array(assignment), localOffsets: new Float32Array(offsets), centroids, radii, coreRadii, cellCounts, bodyCount: specs.length };
}
const BASE_OPTS = {
  gravityY: -0.2 * 9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 150,
  restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
  convexEnabled: true,
};
const runFrames = (state, frames, stepOpts) => { for (let f = 0; f < frames; f++) stepRigidBodies(state, 1 / 60, stepOpts); };
const snapshot = (state) => state.bodies.map((b) => [...b.pos, ...b.vel, ...b.quat, ...b.angVel, b.sleeping ? 1 : 0]);
const identical = (a, b) => a.length === b.length && a.every((row, i) => row.every((v, k) => v === b[i][k]));

// ── A1: analytic tensor values ────────────────────────────────
{
  const obb = { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [2, 0.5, 0.5] };
  const I = obbBoxInertia(obb, 12);
  check('A1: box inertia analytic (half 2/0.5/0.5, m 12 -> [2, 17, 17])',
    near(I[0], 2, 1e-12) && near(I[1], 17, 1e-12) && near(I[2], 17, 1e-12), JSON.stringify(I));
  const inv = [1 / I[0], 1 / I[1], 1 / I[2]];
  const dw1 = obbInertiaResponse(obb, [0, 0, 0, 1], inv, [3, 0, 0]);
  check('A1: response about the long axis uses I_x', relNear(dw1[0], 3 / 2) && near(dw1[1], 0, 1e-12) && near(dw1[2], 0, 1e-12), JSON.stringify(dw1));
  const dw2 = obbInertiaResponse(obb, [0, 0, 0, 1], inv, [0, 0, 5]);
  check('A1: response about a short axis uses I_z', relNear(dw2[2], 5 / 17) && near(dw2[0], 0, 1e-12), JSON.stringify(dw2));
  // Rotated 90 deg about Z: world X now maps to the box's Y axis.
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const dwR = obbInertiaResponse(obb, q, inv, [4, 0, 0]);
  check('A1: rotated response (torque about world X -> box Y inertia)',
    relNear(dwR[0], 4 / 17) && near(dwR[1], 0, 1e-9) && near(dwR[2], 0, 1e-9), JSON.stringify(dwR));
  const f = obbInertiaFactor(obb, [0, 0, 0, 1], inv, [0, 2, 0]);
  check('A1: factor (r x n) along Y -> |rn|^2 / I_y', relNear(f, 4 / 17), `${f}`);
  // Stored per-body axis data on a convex build.
  const cells = makeShapeCells([{ pos: [0, 3, 0], half: [1, 0.25, 0.25], radius: Math.hypot(1, 0.25, 0.25), count: 8 }]);
  const s = createRigidSolver(cells, { glueEnabled: false, startSleeping: false, convexEnabled: true });
  const b = s.bodies[0];
  const Ix = (8 / 3) * (0.25 * 0.25 + 0.25 * 0.25);
  const Iy = (8 / 3) * (1 * 1 + 0.25 * 0.25);
  check('A1: body stores per-axis inverse inertia of its fitted box',
    !!b.invInertiaAxis && relNear(b.invInertiaAxis[0], 1 / Ix) && relNear(b.invInertiaAxis[1], 1 / Iy) && relNear(b.invInertiaAxis[2], 1 / Iy),
    JSON.stringify(b.invInertiaAxis));
  const r = resolveRigid({ gpgpuRigidConvexEnabled: true, gpgpuRigidConvexInertia: true });
  check('A1: resolveRigid resolves the inertia key', r.convexEnabled === true && r.convexInertia === true);
}

// ── A1/A6: key-off identity + tensor-on divergence ────────────
{
  const cells = () => makeShapeCells([
    { pos: [0, 3, 0], half: [1, 0.25, 0.25], radius: 1.03 },
    { pos: [0.9, 3.4, 0.2], half: [1, 0.25, 0.25], radius: 1.03 },
    { pos: [-1.2, 5, -0.4], half: [0.8, 0.4, 0.3], radius: 0.94 },
  ]);
  const traj = (stepOpts) => {
    const s = createRigidSolver(cells(), { glueEnabled: false, startSleeping: false, convexEnabled: true });
    runFrames(s, 240, { ...BASE_OPTS, ...stepOpts });
    return snapshot(s);
  };
  const legacy = traj({});
  const inertiaOff = traj({ convexInertiaEnabled: false });
  check('A6: convexInertia off is bit-identical to the legacy convex path', identical(legacy, inertiaOff));
  const inertiaOn = traj({ convexInertiaEnabled: true });
  check('A1: tensor on changes the elongated bodies trajectory', !identical(legacy, inertiaOn));
  // Inertia key without the convex step gate must stay inert.
  const noConvex = traj({ convexEnabled: false, convexInertiaEnabled: true });
  const sphere = (() => {
    const s = createRigidSolver(cells(), { glueEnabled: false, startSleeping: false, convexEnabled: true });
    runFrames(s, 240, { ...BASE_OPTS, convexEnabled: false });
    return snapshot(s);
  })();
  check('A6: inertia key without convex is bit-identical to the sphere path', identical(noConvex, sphere));
}

// ── Stage 2: broad-phase widening ─────────────────────────────
{
  const R = Math.hypot(2, 0.4, 0.4);
  const mk = (posB) => createRigidSolver(makeShapeCells([
    { pos: [0, 5, 0], half: [2, 0.4, 0.4], radius: R },
    { pos: posB, half: [2, 0.4, 0.4], radius: R },
  ]), { glueEnabled: false, startSleeping: false, convexEnabled: true });
  const still = { ...BASE_OPTS, gravityY: 0, floorEnabled: false };
  // Centres exactly at rest distance (3.4 = build distance),
  // boxes overlapping by 0.6 along X (the minimum-penetration
  // axis: Y/Z overlap is 0.8): the old gate skipped this pair
  // (d >= target); the widened gate must reach SAT.
  const s1 = mk([3.4, 5, 0]);
  const before = s1.bodies[1].pos[0] - s1.bodies[0].pos[0];
  runFrames(s1, 1, still);
  const after = s1.bodies[1].pos[0] - s1.bodies[0].pos[0];
  check('stage2: interpenetrating pair at rest distance separates via SAT', after > before + 0.3, `${before} -> ${after}`);
  // Bounding spheres overlap but boxes do not touch (Y offset
  // 0.9 > 0.8 combined half height): the pair must pass through
  // untouched (positions compared with float32 tolerance).
  const s2 = mk([3.4, 5.9, 0]);
  runFrames(s2, 1, still);
  check('stage2: non-touching boxes pass through untouched',
    near(s2.bodies[0].pos[0], 0, 1e-6) && near(s2.bodies[1].pos[0], 3.4, 1e-6) && near(s2.bodies[1].pos[1], 5.9, 1e-6),
    JSON.stringify(s2.bodies.map((b) => b.pos)));
}

// ── A2 + A3 + A4: settle, penetration, determinism ────────────
function fractureScene(count) {
  const specs = [];
  const side = Math.ceil(Math.cbrt(count));
  for (let i = 0; i < count; i++) {
    const x = (i % side) - (side - 1) / 2;
    const y = Math.floor(i / side) % side;
    const z = Math.floor(i / (side * side));
    specs.push({ pos: [x * 2.2, 6 + y * 1.2, z * 2.2 - 2], half: [0.9, 0.3, 0.5], radius: Math.hypot(0.9, 0.3, 0.5), count: 8 });
  }
  return makeShapeCells(specs);
}
for (const count of [12, 64]) {
  const run = () => {
    const s = createRigidSolver(fractureScene(count), { glueEnabled: false, startSleeping: false, convexEnabled: true });
    const opts = { ...BASE_OPTS, convexInertiaEnabled: true };
    let settledAt600 = false;
    for (let f = 0; f < 1200; f++) {
      stepRigidBodies(s, 1 / 60, opts);
      if (f === 599) {
        settledAt600 = s.bodies.every((b) => b.sleeping || Math.hypot(...b.vel) < 2.5);
      }
    }
    return { s, settledAt600 };
  };
  const { s, settledAt600 } = run();
  check(`A2 (${count} bodies): settled by frame 600`, settledAt600);
  const finite = s.bodies.every((b) => b.pos.every(Number.isFinite) && b.vel.every(Number.isFinite) && b.quat.every(Number.isFinite));
  check(`A2 (${count} bodies): no NaN at frame 1200`, finite);
  const escaped = s.bodies.some((b) => Math.hypot(...b.pos) > 150 * 1.05);
  check(`A2 (${count} bodies): no containment escape`, !escaped);
  // A3: max SAT depth over shaped pairs in the settled pile.
  let maxDepth = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    for (let j = i + 1; j < s.bodies.length; j++) {
      const a = s.bodies[i], b = s.bodies[j];
      if (!a.shape || !b.shape) continue;
      const c = obbSatContact(placeObb(a.shape, a.pos, a.quat), placeObb(b.shape, b.pos, b.quat));
      if (c.hit) maxDepth = Math.max(maxDepth, c.depth);
    }
  }
  console.log(`A3 (${count} bodies): settled max SAT depth ${maxDepth.toFixed(4)}`);
  check(`A3 (${count} bodies): settled SAT depth <= 0.05 (proposal line)`, maxDepth <= 0.05, `${maxDepth}`);
  if (count === 12) {
    const again = run();
    check('A4: identical tensor-on runs are bit-identical', identical(snapshot(s), snapshot(again.s)));
  }
}

// ── A5: step cost, tensor on vs off (64 bodies, pile) ─────────
{
  const timeRun = (inertia) => {
    const s = createRigidSolver(fractureScene(64), { glueEnabled: false, startSleeping: false, convexEnabled: true });
    const t0 = performance.now();
    runFrames(s, 240, { ...BASE_OPTS, convexInertiaEnabled: inertia });
    return performance.now() - t0;
  };
  timeRun(false); timeRun(true); // warmup
  const off = [], on = [];
  for (let r = 0; r < 9; r++) { off.push(timeRun(false)); on.push(timeRun(true)); }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const offMs = med(off), onMs = med(on);
  const inc = ((onMs - offMs) / offMs) * 100;
  console.log(`A5 cost: inertia off ${offMs.toFixed(1)}ms, on ${onMs.toFixed(1)}ms, increase ${inc.toFixed(2)}% (240 frames x 64 bodies, median of 9 interleaved)`);
  check('A5: step cost increase < 5%', inc < 5, `${inc.toFixed(2)}%`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
