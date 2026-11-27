// Phase 43 (UE5 #35 G-C) — rigid XPBD joints: anchored form
// (XpbdJointSpec anchor fields realised) + swing angle limit,
// against pre-registered acceptance lines:
// - J1 build shape: anchors on -> joints carry the shared
//   midpoint anchors (±half the centroid offset), anchorRest 0,
//   identity restRelQuat and the resolved angle limit; anchors
//   off -> joints carry NO anchor fields (legacy state shape)
// - J2 wiring: resolveRigid maps the two new keys (defaults
//   off / 0, degrees clamped 0..180 -> radians)
// - J3 ball joint: with a body rotated 90° about its own centre
//   (centre distance untouched, so the centre joint sees no
//   error), the anchored joint restores anchor coincidence
//   (< 0.02) while the centre-joint control leaves the anchor
//   distance at its initial value (±0.01)
// - J4 angle limit: B rotated 80° about the shared anchor point
//   (anchor distance 0 throughout, so only the limit acts):
//   limit 30° -> final relative angle <= 32°; limit 0 control
//   -> relative angle stays 80° (±1°)
// - J5 break: anchored joints still break on the centre-strain
//   metric (threshold exceeded -> joint dead after 1 frame)
// - J6 determinism: identical anchored runs are bit-identical
// - J7 stability: a 12-body anchored scene under gravity
//   settles with no NaN and no escape after 600 frames
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p43-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, resolveRigid, quatRotate } from './lib/rigidBodies.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { createRigidSolver, stepRigidBodies, resolveRigid, quatRotate } = lib;

// ── Cell helpers (the phase42 pattern) ───────────────────────
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
const STILL = {
  gravityY: 0, floorEnabled: false, floorY: 0, bounceRadius: 150,
  restitution: 0, friction: 0, glueEnabled: false, glueStrength: 45,
};
const runFrames = (state, frames, stepOpts) => { for (let f = 0; f < frames; f++) stepRigidBodies(state, 1 / 60, stepOpts); };
const snapshot = (state) => state.bodies.map((b) => [...b.pos, ...b.vel, ...b.quat, ...b.angVel, b.sleeping ? 1 : 0]);
const identical = (a, b) => a.length === b.length && a.every((row, i) => row.every((v, k) => v === b[i][k]));
const anchorDist = (state, joint) => {
  const a = state.bodies[joint.a];
  const b = state.bodies[joint.b];
  const pA = quatRotate(a.quat, joint.anchorA);
  const pB = quatRotate(b.quat, joint.anchorB);
  return Math.hypot(
    (b.pos[0] + pB[0]) - (a.pos[0] + pA[0]),
    (b.pos[1] + pB[1]) - (a.pos[1] + pA[1]),
    (b.pos[2] + pB[2]) - (a.pos[2] + pA[2]),
  );
};
const relAngleDeg = (state, joint) => {
  const a = state.bodies[joint.a];
  const b = state.bodies[joint.b];
  // angle of qA^-1 * qB via the vector part magnitude
  const conj = [-a.quat[0], -a.quat[1], -a.quat[2], a.quat[3]];
  const q = [
    conj[3] * b.quat[0] + conj[0] * b.quat[3] + conj[1] * b.quat[2] - conj[2] * b.quat[1],
    conj[3] * b.quat[1] - conj[0] * b.quat[2] + conj[1] * b.quat[3] + conj[2] * b.quat[0],
    conj[3] * b.quat[2] + conj[0] * b.quat[1] - conj[1] * b.quat[0] + conj[2] * b.quat[3],
    conj[3] * b.quat[3] - conj[0] * b.quat[0] - conj[1] * b.quat[1] - conj[2] * b.quat[2],
  ];
  const s = Math.hypot(q[0], q[1], q[2]);
  return 2 * Math.atan2(s, Math.abs(q[3])) * 180 / Math.PI;
};
const rotZ = (deg) => {
  const half = deg * Math.PI / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};
// Two adjacent cells, centres 1.0 apart; small bounding radii
// (0.3) keep the sphere pair path out of these scenes
// (restDist = min(1.0, 0.6) = 0.6 < every centre distance used).
const pairCells = () => makeShapeCells([
  { pos: [0, 5, 0], half: [0.4, 0.4, 0.4], radius: 0.3, coreRadius: 0.4 },
  { pos: [1, 5, 0], half: [0.4, 0.4, 0.4], radius: 0.3, coreRadius: 0.4 },
]);

// ── J1: build shape ──────────────────────────────────────────
{
  const s = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false,
    jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
    jointAnchors: true, jointAngleLimitRad: 0.5,
  });
  check('J1: one joint built for the adjacent pair', s.joints.length === 1, `${s.joints.length}`);
  const j = s.joints[0];
  check('J1: anchors are the shared midpoint (±half offset)',
    !!j.anchorA && !!j.anchorB
    && near(j.anchorA[0], 0.5) && near(j.anchorA[1], 0) && near(j.anchorA[2], 0)
    && near(j.anchorB[0], -0.5) && near(j.anchorB[1], 0) && near(j.anchorB[2], 0),
    JSON.stringify([j.anchorA, j.anchorB]));
  check('J1: anchorRest 0, restRelQuat identity, limit stored',
    j.anchorRest === 0 && !!j.restRelQuat && near(j.restRelQuat[3], 1) && near(j.angleLimitRad, 0.5),
    JSON.stringify([j.anchorRest, j.restRelQuat, j.angleLimitRad]));
  const legacy = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false,
    jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
  });
  const jl = legacy.joints[0];
  check('J1: anchors off -> no anchor fields (legacy state shape)',
    legacy.joints.length === 1 && jl.anchorA === undefined && jl.anchorB === undefined && jl.restRelQuat === undefined,
    JSON.stringify(Object.keys(jl)));
}

// ── J2: resolveRigid wiring ──────────────────────────────────
{
  const d = resolveRigid({});
  check('J2: defaults off / 0', d.jointAnchors === false && d.jointAngleLimitRad === 0, JSON.stringify([d.jointAnchors, d.jointAngleLimitRad]));
  const r = resolveRigid({ gpgpuRigidJointAnchorEnabled: true, gpgpuRigidJointAngleLimitDeg: 45 });
  check('J2: keys resolve (45 deg -> pi/4)', r.jointAnchors === true && near(r.jointAngleLimitRad, Math.PI / 4, 1e-12), `${r.jointAngleLimitRad}`);
  const c = resolveRigid({ gpgpuRigidJointAngleLimitDeg: 270 });
  check('J2: degrees clamp at 180', near(c.jointAngleLimitRad, Math.PI, 1e-12), `${c.jointAngleLimitRad}`);
}

// ── J3: ball joint vs centre joint ───────────────────────────
{
  const mk = (anchored) => {
    const s = createRigidSolver(pairCells(), {
      glueEnabled: false, startSleeping: false,
      jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
      ...(anchored ? { jointAnchors: true } : {}),
    });
    // Rotate B by 90° about its own centre: centre distance
    // unchanged, anchor points separate by ~0.707.
    s.bodies[1].quat = rotZ(90);
    return s;
  };
  const control = mk(false);
  const cj = { a: 0, b: 1, anchorA: [0.5, 0, 0], anchorB: [-0.5, 0, 0] };
  const d0 = anchorDist(control, cj);
  runFrames(control, 60, STILL);
  check('J3: centre joint leaves the anchor error untouched',
    near(anchorDist(control, cj), d0, 0.01), `${d0} -> ${anchorDist(control, cj)}`);
  const s = mk(true);
  const j = s.joints[0];
  check('J3: anchored scene starts with the same anchor error', near(anchorDist(s, j), d0, 1e-9), `${anchorDist(s, j)} vs ${d0}`);
  runFrames(s, 60, STILL);
  check('J3: anchored joint restores anchor coincidence', anchorDist(s, j) < 0.02, `${anchorDist(s, j)}`);
}

// ── J4: angle limit ──────────────────────────────────────────
{
  const mk = (limitRad) => {
    const s = createRigidSolver(pairCells(), {
      glueEnabled: false, startSleeping: false,
      jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
      jointAnchors: true, jointAngleLimitRad: limitRad,
    });
    // Rotate B by 80° about the shared anchor point: B's centre
    // moves so its anchor stays on the shared point, so the
    // distance constraint sees no error and only the limit acts.
    const q = rotZ(80);
    const rB = quatRotate(q, [-0.5, 0, 0]);
    s.bodies[1].quat = q;
    s.bodies[1].pos = [0.5 - rB[0], 5 - rB[1], 0 - rB[2]];
    return s;
  };
  const control = mk(0);
  runFrames(control, 30, STILL);
  check('J4: no limit -> relative angle stays 80°', near(relAngleDeg(control, control.joints[0]), 80, 1), `${relAngleDeg(control, control.joints[0])}`);
  check('J4: no limit -> anchor stays coincident', anchorDist(control, control.joints[0]) < 0.01, `${anchorDist(control, control.joints[0])}`);
  const s = mk(30 * Math.PI / 180);
  runFrames(s, 30, STILL);
  check('J4: limit 30° -> relative angle clamped', relAngleDeg(s, s.joints[0]) <= 32, `${relAngleDeg(s, s.joints[0])}`);
  check('J4: limit keeps the anchor coincident', anchorDist(s, s.joints[0]) < 0.05, `${anchorDist(s, s.joints[0])}`);
}

// ── J5: break on the centre-strain metric ────────────────────
{
  const s = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false,
    jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0.1,
    jointAnchors: true,
  });
  s.bodies[1].pos = [3, 5, 0]; // centre strain = |3 - 1| / 1 = 2 > 0.1
  runFrames(s, 1, STILL);
  check('J5: anchored joint breaks on centre strain', s.joints[0].alive === false);
}

// ── J6: determinism ──────────────────────────────────────────
{
  const traj = () => {
    const s = createRigidSolver(pairCells(), {
      glueEnabled: false, startSleeping: false,
      jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
      jointAnchors: true, jointAngleLimitRad: 0.6,
    });
    s.bodies[1].quat = rotZ(65);
    s.bodies[1].vel = [0.3, 0, 0.1];
    runFrames(s, 120, STILL);
    return snapshot(s);
  };
  check('J6: identical anchored runs are bit-identical', identical(traj(), traj()));
}

// ── J7: stability of an anchored assembly ────────────────────
{
  const specs = [];
  for (let ix = 0; ix < 3; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
    specs.push({ pos: [ix * 0.9, 3 + iy * 0.9, iz * 0.9], half: [0.42, 0.42, 0.42], radius: 0.73, coreRadius: 0.45, count: 8 });
  }
  const s = createRigidSolver(makeShapeCells(specs), {
    glueEnabled: false, startSleeping: false,
    jointEnabled: true, jointCompliance: 0, jointBreakThreshold: 0,
    jointAnchors: true, jointAngleLimitRad: 1.0,
  });
  check('J7: assembly built with joints', s.joints.length > 0, `${s.joints.length}`);
  runFrames(s, 600, {
    gravityY: -0.2 * 9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 150,
    restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
  });
  const finite = s.bodies.every((b) => b.pos.every(Number.isFinite) && b.quat.every(Number.isFinite));
  const bounded = s.bodies.every((b) => Math.hypot(b.pos[0], b.pos[1], b.pos[2]) < 150);
  check('J7: 600 frames, no NaN, no escape', finite && bounded,
    JSON.stringify(s.bodies.map((b) => b.pos.map((v) => +v.toFixed(2)))));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
