// Phase 20 stage 0 — rigid body solver dedicated tests.
// First dedicated test file for lib/rigidBodies.ts (Phase AU):
// the solver previously had no unit tests of its own (only an
// incidental 'rigid link' mention in the phase19 XPBD tests).
// Everything here runs the REAL public API — createRigidSolver /
// stepRigidBodies / sampleRigidHeightfield /
// rigidHeightfieldNormal / writeRigidBodyTexture / resolveRigid —
// over synthetic FractureCellData tables, in the identity style
// of the phase17/19 tests (esbuild bundle, PASS/FAIL lines,
// exit code).
//
// Behaviours pinned (all read off the solver source first):
// - construction: bodies from the cell table, glue bonds only
//   between adjacent centroids, no bonds when glue is off
// - a body resting on the floor stays on the floor and sleeps
// - a falling body bounces with restitution > 0 and does not
//   bounce with restitution = 0
// - glued bodies fall together, keeping their rest offset
// - a hard floor impact breaks glue when glueStrength is low,
//   and keeps it when glueStrength is high
// - sleeping: a floating sleeping body wakes (support loss),
//   a resting sleeper wakes when a fast body impacts it
// - XPBD joints (stage 1): built only with the joint switch
//   on, rest length held from stretch and compression, large
//   compliance stays stretched, pre-solve strain past the
//   threshold breaks (0 = unbreakable), OFF build identical
// - stress breaking (stage 1): propagation queue semantics at
//   the processing level (0.5 cascades one step, 0 never
//   spreads, 1 takes the chain, threshold is strict), OFF
//   keeps the legacy break and never writes the stress field
// - OBB shapes (stage 1): fitted shapes exist only on a convex
//   build; OFF trajectories are identical to the legacy build
//   in both gate directions (shapes built but step gate off,
//   step gate on but no shapes); ON, an elongated box rests on
//   the floor at its support point (not its bounding radius),
//   stacks on another box at the box contact distance, and a
//   rotated box stops on its long axis
// - determinism: identical input series -> identical states
// - substep accounting: fixed 1/120 substeps, capped per call
// - the heightfield floor: a body rests on the field height,
//   not on floorY; a flat field's normal is exactly +Y
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20r-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        createRigidSolver, stepRigidBodies, sampleRigidHeightfield,
        rigidHeightfieldNormal, writeRigidBodyTexture, resolveRigid,
        propagateRigidBondBreaks,
        RIGID_SUBSTEP, RIGID_SUBSTEP_MAX_PER_FRAME, RIGID_BODY_MAX,
      } from './lib/rigidBodies.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  createRigidSolver, stepRigidBodies, sampleRigidHeightfield,
  rigidHeightfieldNormal, writeRigidBodyTexture, resolveRigid,
  propagateRigidBondBreaks,
  RIGID_SUBSTEP, RIGID_SUBSTEP_MAX_PER_FRAME, RIGID_BODY_MAX,
} = lib;

// ── Helpers ───────────────────────────────────────────────────
// specs: [{ pos:[x,y,z], radius, coreRadius?, count? }]
function makeCells(specs) {
  const n = specs.length;
  const centroids = new Float32Array(n * 3);
  const radii = new Float32Array(n);
  const coreRadii = new Float32Array(n);
  const cellCounts = new Int32Array(n);
  specs.forEach((s, i) => {
    centroids[i * 3] = s.pos[0]; centroids[i * 3 + 1] = s.pos[1]; centroids[i * 3 + 2] = s.pos[2];
    radii[i] = s.radius;
    coreRadii[i] = s.coreRadius ?? s.radius;
    cellCounts[i] = s.count ?? 10;
  });
  return {
    assignment: new Int32Array(0),
    localOffsets: new Float32Array(0),
    centroids, radii, coreRadii, cellCounts, bodyCount: n,
  };
}
const BASE_OPTS = {
  gravityY: -9.8,
  floorEnabled: true,
  floorY: 0,
  bounceRadius: 100,
  restitution: 0.2,
  friction: 0.5,
  glueEnabled: true,
  glueStrength: 45,
};
const opts = (over = {}) => ({ ...BASE_OPTS, ...over });
// Run whole frames of dt = 1/60 (2 substeps each) and return a
// per-frame trace hook result.
function runFrames(state, frames, stepOpts, onFrame) {
  for (let f = 0; f < frames; f++) {
    stepRigidBodies(state, 1 / 60, stepOpts);
    if (onFrame) onFrame(state, f);
  }
}
const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);

// ── Construction ──────────────────────────────────────────────
{
  const cells = makeCells([
    { pos: [0, 1, 0], radius: 0.4, count: 12 },
    { pos: [0.5, 1, 0], radius: 0.4, count: 30 },
    { pos: [10, 1, 0], radius: 0.4, count: 5 },
  ]);
  const s = createRigidSolver(cells, { glueEnabled: true, startSleeping: false });
  check('construction: one body per cell', s.bodies.length === 3);
  check('construction: mass = cell count, position = centroid',
    s.bodies[1].mass === 30 && near(s.bodies[1].pos[0], 0.5) && near(s.bodies[1].pos[1], 1));
  check('construction: glue bond only between the adjacent pair',
    s.bonds.length === 1 && s.bonds[0].a === 0 && s.bonds[0].b === 1 && s.bonds[0].alive,
    `bonds=${JSON.stringify(s.bonds.map((b) => [b.a, b.b]))}`);
  check('construction: bond rest length is the centroid distance', near(s.bonds[0].restLength, 0.5, 1e-6));
  const noGlue = createRigidSolver(cells, { glueEnabled: false, startSleeping: false });
  check('construction: glue off -> no bonds', noGlue.bonds.length === 0);
  const sleepy = createRigidSolver(cells, { glueEnabled: true, startSleeping: true });
  check('construction: startSleeping honoured', sleepy.bodies.every((b) => b.sleeping));
}

// ── Substep accounting ────────────────────────────────────────
{
  const s = createRigidSolver(makeCells([{ pos: [0, 5, 0], radius: 0.5 }]), { glueEnabled: false, startSleeping: false });
  check('substeps: dt=0 runs none', stepRigidBodies(s, 0, opts()) === 0 && s.time === 0);
  const ran = stepRigidBodies(s, 1 / 60, opts());
  check('substeps: 1/60 s = 2 fixed substeps', ran === 2 && near(s.time, 2 * RIGID_SUBSTEP, 1e-9), `ran=${ran} time=${s.time}`);
  const capped = stepRigidBodies(s, 5, opts());
  check('substeps: a huge dt is capped per call', capped === RIGID_SUBSTEP_MAX_PER_FRAME, `capped=${capped}`);
}

// ── Resting on the floor + sleep entry ────────────────────────
{
  const s = createRigidSolver(makeCells([{ pos: [0, 0.5, 0], radius: 0.5 }]), { glueEnabled: false, startSleeping: false });
  let wokeAgain = false;
  runFrames(s, 180, opts({ restitution: 0.2 }), (st, f) => { if (f > 150 && !st.bodies[0].sleeping) wokeAgain = true; });
  const b = s.bodies[0];
  check('rest: body stays on the floor (centre = radius)', near(b.pos[1], 0.5, 1e-3), `y=${b.pos[1]}`);
  check('rest: body is (nearly) still', Math.hypot(b.vel[0], b.vel[1], b.vel[2]) < 0.1, `vel=${b.vel}`);
  check('sleep: a resting body falls asleep and stays asleep', b.sleeping === true && !wokeAgain);
}

// ── Falling and bouncing ──────────────────────────────────────
{
  const drop = (restitution) => {
    const s = createRigidSolver(makeCells([{ pos: [0, 3, 0], radius: 0.5 }]), { glueEnabled: false, startSleeping: false });
    let touched = false;
    let reboundMax = 0;
    runFrames(s, 240, opts({ restitution }), (st) => {
      const y = st.bodies[0].pos[1];
      if (y <= 0.51) touched = true;
      else if (touched) reboundMax = Math.max(reboundMax, y);
    });
    return { s, touched, reboundMax };
  };
  const bouncy = drop(0.5);
  check('bounce: falling body reaches the floor', bouncy.touched);
  check('bounce: restitution 0.5 rebounds clearly', bouncy.reboundMax > 0.9, `reboundMax=${bouncy.reboundMax}`);
  const dead = drop(0);
  check('bounce: restitution 0 does not rebound', dead.touched && dead.reboundMax < 0.6, `reboundMax=${dead.reboundMax}`);
  check('bounce: restitution 0 settles on the floor', near(dead.s.bodies[0].pos[1], 0.5, 1e-3), `y=${dead.s.bodies[0].pos[1]}`);
}

// ── Glue: fall together, break on impact ──────────────────────
{
  const pair = () => makeCells([
    { pos: [0, 3, 0], radius: 0.5 },
    { pos: [0.9, 3, 0], radius: 0.5 },
  ]);
  // Falling together in free space (no floor): the weld holds
  // the rest offset while both bodies fall.
  const free = createRigidSolver(pair(), { glueEnabled: true, startSleeping: false });
  runFrames(free, 60, opts({ floorEnabled: false }));
  check('glue: bonded pair falls together (offset kept)',
    near(dist(free.bodies[0], free.bodies[1]), 0.9, 0.05), `d=${dist(free.bodies[0], free.bodies[1])}`);
  check('glue: bonded pair actually fell', free.bodies[0].pos[1] < 1 && free.bodies[1].pos[1] < 1,
    `y=${free.bodies[0].pos[1]},${free.bodies[1].pos[1]}`);
  check('glue: bond survives free fall', free.bonds[0].alive === true);

  // Hard landing: with a low strength the floor impact breaks
  // the bond; with a high strength it survives the same drop.
  const weak = createRigidSolver(pair(), { glueEnabled: true, startSleeping: false });
  runFrames(weak, 240, opts({ restitution: 0, glueStrength: 1 }));
  check('glue: strong impact breaks the bond (low strength)', weak.bonds[0].alive === false);
  const strong = createRigidSolver(pair(), { glueEnabled: true, startSleeping: false });
  runFrames(strong, 240, opts({ restitution: 0, glueStrength: 1000 }));
  check('glue: same impact keeps the bond (high strength)', strong.bonds[0].alive === true);
  check('glue: kept pair lands side by side',
    near(strong.bodies[0].pos[1], 0.5, 0.05) && near(strong.bodies[1].pos[1], 0.5, 0.05)
    && near(dist(strong.bodies[0], strong.bodies[1]), 0.9, 0.1),
    `y=${strong.bodies[0].pos[1]},${strong.bodies[1].pos[1]} d=${dist(strong.bodies[0], strong.bodies[1])}`);
}

// ── Sleeping: support loss and impact waking ──────────────────
{
  // A lone sleeping body in mid-air has no floor support: its
  // component wakes and it starts falling.
  const floating = createRigidSolver(makeCells([{ pos: [0, 3, 0], radius: 0.5 }]), { glueEnabled: false, startSleeping: true });
  runFrames(floating, 30, opts());
  check('sleep: floating sleeper wakes (support loss)', floating.bodies[0].sleeping === false);
  check('sleep: woken body falls', floating.bodies[0].pos[1] < 2.9, `y=${floating.bodies[0].pos[1]}`);

  // A sleeper resting on the floor stays asleep until a fast
  // body lands on it.
  const s = createRigidSolver(makeCells([
    { pos: [0, 0.5, 0], radius: 0.5 },
    { pos: [0, 4, 0], radius: 0.5 },
  ]), { glueEnabled: false, startSleeping: false });
  s.bodies[0].sleeping = true;
  let stayedAsleepFirstFrames = null;
  let wokeEver = false;
  runFrames(s, 120, opts({ restitution: 0, glueEnabled: false }), (st, f) => {
    if (f === 5) stayedAsleepFirstFrames = st.bodies[0].sleeping;
    if (!st.bodies[0].sleeping) wokeEver = true;
  });
  check('sleep: floor-supported sleeper stays asleep while undisturbed', stayedAsleepFirstFrames === true);
  check('sleep: a hard impact from the falling body wakes the sleeper', wokeEver === true);
}

// ── Heightfield floor ─────────────────────────────────────────
{
  const flat = { size: 3, extent: 1.05, step: 1.05, heights: new Float32Array(9).fill(1) };
  check('heightfield: flat field samples its height everywhere',
    near(sampleRigidHeightfield(flat, 0, 0), 1) && near(sampleRigidHeightfield(flat, 0.7, -0.4), 1));
  const n = rigidHeightfieldNormal(flat, 0, 0);
  check('heightfield: flat field normal is exactly +Y', near(n[0], 0) && near(n[1], 1) && near(n[2], 0), `n=${n}`);
  const s = createRigidSolver(makeCells([{ pos: [0, 1.5, 0], radius: 0.5 }]), { glueEnabled: false, startSleeping: false });
  runFrames(s, 120, opts({ heightfield: flat, floorY: 0 }));
  check('heightfield: body rests on the field height, not floorY', near(s.bodies[0].pos[1], 1.5, 1e-3), `y=${s.bodies[0].pos[1]}`);
}

// ── Determinism ───────────────────────────────────────────────
{
  const scenario = () => createRigidSolver(makeCells([
    { pos: [0, 3, 0], radius: 0.5 },
    { pos: [0.9, 3.2, 0.2], radius: 0.5 },
    { pos: [-1.5, 5, -0.5], radius: 0.4 },
  ]), { glueEnabled: true, startSleeping: false });
  const a = scenario();
  const b = scenario();
  runFrames(a, 180, opts({ restitution: 0.35 }));
  runFrames(b, 180, opts({ restitution: 0.35 }));
  const same = a.bodies.every((body, i) => body.pos.every((v, k) => v === b.bodies[i].pos[k])
    && body.vel.every((v, k) => v === b.bodies[i].vel[k])
    && body.quat.every((v, k) => v === b.bodies[i].quat[k])
    && body.sleeping === b.bodies[i].sleeping)
    && a.bonds.every((bond, i) => bond.alive === b.bonds[i].alive)
    && a.time === b.time;
  check('determinism: identical input series -> identical states', same);
}

// ── XPBD joints (Phase 20 stage 1) ────────────────────────────
{
  const pairCells = () => makeCells([
    { pos: [0, 3, 0], radius: 0.5 },
    { pos: [0.9, 3, 0], radius: 0.5 },
  ]);
  // Construction: joints follow the glue adjacency rule, and
  // exist only while the joint switch is on at build time.
  const withJoint = createRigidSolver(pairCells(), { glueEnabled: false, startSleeping: false, jointEnabled: true });
  check('joint: built for the adjacent pair (glue off)', withJoint.joints.length === 1
    && withJoint.joints[0].a === 0 && withJoint.joints[0].b === 1 && withJoint.joints[0].alive,
    `joints=${withJoint.joints.length}`);
  check('joint: rest length is the centroid distance', near(withJoint.joints[0].restLength, 0.9, 1e-6));
  check('joint: defaults are rigid + unbreakable',
    withJoint.joints[0].compliance === 0 && withJoint.joints[0].breakThreshold === 0);
  const noJoint = createRigidSolver(pairCells(), { glueEnabled: true, startSleeping: false });
  check('joint: not built while the switch is off', noJoint.joints.length === 0);

  // Rest-length hold: pull the pair apart in free space (no
  // glue, no floor, no gravity) — a rigid joint restores the
  // rest distance, from both stretch and compression.
  const hold = (startDist) => {
    const s = createRigidSolver(pairCells(), { glueEnabled: false, startSleeping: false, jointEnabled: true });
    s.bodies[1].pos[0] = startDist;
    runFrames(s, 10, opts({ floorEnabled: false, gravityY: 0, glueEnabled: false }));
    return dist(s.bodies[0], s.bodies[1]);
  };
  check('joint: stretched pair returns to the rest length', near(hold(1.5), 0.9, 0.02), `d=${hold(1.5)}`);
  check('joint: compressed pair returns to the rest length', near(hold(0.4), 0.9, 0.02), `d=${hold(0.4)}`);

  // Compliance: with a large α the same stretch is barely
  // corrected over the same frames — the joint stays stretched.
  const soft = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false, jointEnabled: true, jointCompliance: 1,
  });
  soft.bodies[1].pos[0] = 1.5;
  runFrames(soft, 5, opts({ floorEnabled: false, gravityY: 0, glueEnabled: false }));
  check('joint: large compliance stays stretched', dist(soft.bodies[0], soft.bodies[1]) > 1.3,
    `d=${dist(soft.bodies[0], soft.bodies[1])}`);

  // Breaking: judged on the pre-solve strain. Threshold 0.2
  // breaks at distance 1.5 (strain 0.67); threshold 0 never
  // breaks (and the solve restores the rest length instead).
  const breaking = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false, jointEnabled: true, jointBreakThreshold: 0.2,
  });
  breaking.bodies[1].pos[0] = 1.5;
  runFrames(breaking, 5, opts({ floorEnabled: false, gravityY: 0, glueEnabled: false }));
  check('joint: strain past the threshold breaks the joint', breaking.joints[0].alive === false);
  const unbreakable = createRigidSolver(pairCells(), {
    glueEnabled: false, startSleeping: false, jointEnabled: true, jointBreakThreshold: 0,
  });
  unbreakable.bodies[1].pos[0] = 1.5;
  runFrames(unbreakable, 10, opts({ floorEnabled: false, gravityY: 0, glueEnabled: false }));
  check('joint: threshold 0 is unbreakable', unbreakable.joints[0].alive === true
    && near(dist(unbreakable.bodies[0], unbreakable.bodies[1]), 0.9, 0.02));

  // OFF identity: default build and explicit jointEnabled:false
  // produce byte-identical trajectories (and no joints).
  const traj = (buildOpts) => {
    const s = createRigidSolver(makeCells([
      { pos: [0, 3, 0], radius: 0.5 },
      { pos: [0.9, 3.2, 0.2], radius: 0.5 },
      { pos: [-1.5, 5, -0.5], radius: 0.4 },
    ]), buildOpts);
    runFrames(s, 120, opts({ restitution: 0.35 }));
    return s;
  };
  const tA = traj({ glueEnabled: true, startSleeping: false });
  const tB = traj({ glueEnabled: true, startSleeping: false, jointEnabled: false, jointCompliance: 0, jointBreakThreshold: 0 });
  check('joint: OFF build is identical to the legacy build',
    tA.joints.length === 0 && tB.joints.length === 0
    && tA.bodies.every((body, i) => body.pos.every((v, k) => v === tB.bodies[i].pos[k])
      && body.vel.every((v, k) => v === tB.bodies[i].vel[k])));
}

// ── Stress breaking + propagation (Phase 20 stage 1) ──────────
{
  // Chain of 4 bodies -> 3 bonds in a row (indices 0,1,2).
  const chain = () => createRigidSolver(makeCells([
    { pos: [0, 3, 0], radius: 0.5 },
    { pos: [0.9, 3, 0], radius: 0.5 },
    { pos: [1.8, 3, 0], radius: 0.5 },
    { pos: [2.7, 3, 0], radius: 0.5 },
  ]), { glueEnabled: true, startSleeping: false });

  // Propagation semantics, driven at the processing level:
  // bond 0 carries stress 1.2 (over the 0.5 threshold).
  const gradual = chain();
  gradual.bonds[0].stress = 1.2;
  const brokenGradual = propagateRigidBondBreaks(gradual, 0.5);
  check('stress: propagation 0.5 cascades one step then stops',
    brokenGradual === 2 && gradual.bonds[0].alive === false && gradual.bonds[1].alive === false
    && gradual.bonds[2].alive === true,
    `broken=${brokenGradual} alive=${gradual.bonds.map((b) => b.alive)}`);
  check('stress: the surviving bond keeps the added stress',
    near(gradual.bonds[2].stress, 0.3, 1e-9), `stress=${gradual.bonds[2].stress}`);
  const noSpread = chain();
  noSpread.bonds[0].stress = 1.2;
  const brokenNone = propagateRigidBondBreaks(noSpread, 0);
  check('stress: propagation 0 does not spread',
    brokenNone === 1 && noSpread.bonds[1].alive === true && noSpread.bonds[2].alive === true
    && noSpread.bonds[1].stress === 0 && noSpread.bonds[2].stress === 0);
  const fullSpread = chain();
  fullSpread.bonds[0].stress = 1.2;
  const brokenAll = propagateRigidBondBreaks(fullSpread, 1);
  check('stress: propagation 1 cascades through the whole chain',
    brokenAll === 3 && fullSpread.bonds.every((b) => !b.alive), `broken=${brokenAll}`);
  const under = chain();
  under.bonds[0].stress = 0.5;
  check('stress: stress at the threshold does not break (strict >)',
    propagateRigidBondBreaks(under, 1) === 0 && under.bonds.every((b) => b.alive));

  // Integration — OFF keeps the legacy behaviour verbatim: the
  // weak-glue drop breaks the bond AND the stress field is
  // never written (stays exactly 0).
  const pairCells = () => makeCells([
    { pos: [0, 3, 0], radius: 0.5 },
    { pos: [0.9, 3, 0], radius: 0.5 },
  ]);
  const legacy = createRigidSolver(pairCells(), { glueEnabled: true, startSleeping: false });
  runFrames(legacy, 240, opts({ restitution: 0, glueStrength: 1, stressBreakEnabled: false }));
  check('stress OFF: legacy impact break still fires', legacy.bonds[0].alive === false);
  check('stress OFF: the stress field is never written', legacy.bonds[0].stress === 0);

  // Integration — ON: the same weak drop breaks through the
  // stress path (normalised impact 7/1 > 0.5), with the stress
  // value recorded on the bond.
  const stressed = createRigidSolver(pairCells(), { glueEnabled: true, startSleeping: false });
  runFrames(stressed, 240, opts({ restitution: 0, glueStrength: 1, stressBreakEnabled: true, stressPropagation: 0 }));
  check('stress ON: the weak drop breaks via stress', stressed.bonds[0].alive === false);
  check('stress ON: the bond stress was recorded', stressed.bonds[0].stress > 0.5,
    `stress=${stressed.bonds[0].stress}`);
}

// ── OBB shape collision (Phase 20 stage 1) ────────────────────
{
  // Cells whose points are the 8 corners of an axis-aligned box
  // (half extents per spec), so the fitted OBB is that box.
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
      cellCounts[bi] = 8;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        assignment.push(bi);
        offsets.push(sx * s.half[0], sy * s.half[1], sz * s.half[2]);
      }
    });
    return {
      assignment: new Int32Array(assignment),
      localOffsets: new Float32Array(offsets),
      centroids, radii, coreRadii, cellCounts, bodyCount: specs.length,
    };
  }
  const ELONG_HALF = [1, 0.25, 0.25];
  const ELONG_RADIUS = Math.hypot(1, 0.25, 0.25);
  const elongCells = (positions) => makeShapeCells(
    positions.map((pos) => ({ pos, half: ELONG_HALF, radius: ELONG_RADIUS })),
  );

  // Construction: shapes are fitted only on a convex build.
  const convex = createRigidSolver(elongCells([[0, 3, 0], [0, 4.6, 0]]),
    { glueEnabled: false, startSleeping: false, convexEnabled: true });
  check('obb: convex build attaches a fitted shape to every body',
    convex.bodies.every((b) => !!b.shape));
  check('obb: fitted half extents match the point box',
    !!convex.bodies[0].shape
    && near(convex.bodies[0].shape.halfExtents[0], 1, 1e-6)
    && near(convex.bodies[0].shape.halfExtents[1], 0.25, 1e-6)
    && near(convex.bodies[0].shape.halfExtents[2], 0.25, 1e-6),
    JSON.stringify(convex.bodies[0].shape && convex.bodies[0].shape.halfExtents));
  const plain = createRigidSolver(elongCells([[0, 3, 0]]), { glueEnabled: false, startSleeping: false });
  check('obb: default build attaches no shape', plain.bodies.every((b) => b.shape === undefined));
  const explicitOff = createRigidSolver(elongCells([[0, 3, 0]]),
    { glueEnabled: false, startSleeping: false, convexEnabled: false });
  check('obb: explicit convex:false build attaches no shape',
    explicitOff.bodies.every((b) => b.shape === undefined));

  // OFF identity in both gate directions: (a) shapes built but
  // the step gate off, (b) the step gate on but no shapes built
  // — both must reproduce the legacy trajectory bit for bit.
  const traj = (buildOpts, stepOpts) => {
    const s = createRigidSolver(elongCells([[0, 3, 0], [0.9, 3.2, 0.2], [-1.5, 5, -0.5]]), buildOpts);
    runFrames(s, 120, stepOpts);
    return s;
  };
  const sameTraj = (x, y) => x.bodies.every((body, i) => body.pos.every((v, k) => v === y.bodies[i].pos[k])
    && body.vel.every((v, k) => v === y.bodies[i].vel[k])
    && body.quat.every((v, k) => v === y.bodies[i].quat[k])
    && body.sleeping === y.bodies[i].sleeping);
  const legacyTraj = traj({ glueEnabled: true, startSleeping: false }, opts({ restitution: 0.35 }));
  const gateOffTraj = traj(
    { glueEnabled: true, startSleeping: false, convexEnabled: true },
    opts({ restitution: 0.35, convexEnabled: false }),
  );
  check('obb OFF: shapes built + step gate off -> legacy trajectory', sameTraj(legacyTraj, gateOffTraj));
  const noShapeTraj = traj(
    { glueEnabled: true, startSleeping: false },
    opts({ restitution: 0.35, convexEnabled: true }),
  );
  check('obb OFF: step gate on + no shapes -> legacy trajectory', sameTraj(legacyTraj, noShapeTraj));

  // Floor: an elongated box placed just above its support rest
  // height settles at centre = half height (0.25) with OBB on,
  // while the sphere path rests it at the bounding radius.
  const floorRest = (convexOn) => {
    const s = createRigidSolver(elongCells([[0, 0.3, 0]]),
      { glueEnabled: false, startSleeping: false, convexEnabled: convexOn });
    runFrames(s, 240, opts({ restitution: 0, glueEnabled: false, convexEnabled: convexOn }));
    return s.bodies[0];
  };
  const boxRest = floorRest(true);
  check('obb floor: box rests on its support point (centre = half height)',
    near(boxRest.pos[1], 0.25, 0.05), `y=${boxRest.pos[1]}`);
  const sphereRest = floorRest(false);
  check('obb floor OFF: the same body rests at its bounding radius',
    near(sphereRest.pos[1], ELONG_RADIUS, 0.05), `y=${sphereRest.pos[1]}`);

  // Pair stacking in free space (no gravity, no floor): the top
  // box approaches at a fixed speed. OBB on, it stacks at the
  // box contact distance (0.25 + 0.25); rotated 90° about z it
  // stops on its long axis (1 + 0.25). OBB off, the sphere rest
  // distance (the initial 1.6) is never closed.
  const stack = (convexOn, rotateTop) => {
    const s = createRigidSolver(elongCells([[0, 0, 0], [0, 1.6, 0]]),
      { glueEnabled: false, startSleeping: false, convexEnabled: convexOn });
    if (rotateTop) s.bodies[1].quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    // Approach speed 3: above the sleep speed threshold, so the
    // moving box cannot fall asleep mid-flight before contact.
    s.bodies[1].vel[1] = -3;
    runFrames(s, 30, opts({
      gravityY: 0, floorEnabled: false, glueEnabled: false,
      restitution: 0, friction: 0.5, convexEnabled: convexOn,
    }));
    return dist(s.bodies[0], s.bodies[1]);
  };
  const stacked = stack(true, false);
  check('obb pair: elongated boxes stack at the box contact distance',
    stacked > 0.4 && stacked < 0.7, `d=${stacked}`);
  const sphereStack = stack(false, false);
  check('obb pair OFF: spheres never close the rest distance',
    sphereStack > 1.4, `d=${sphereStack}`);
  const cornerStack = stack(true, true);
  check('obb pair: a rotated box stops on its long axis',
    cornerStack > 1.0 && cornerStack < 1.5, `d=${cornerStack}`);

  // Config resolution for the new key.
  check('resolveRigid: convex defaults off, resolves on',
    resolveRigid({}).convexEnabled === false
    && resolveRigid({ gpgpuRigidConvexEnabled: true }).convexEnabled === true);
}

// ── Texture supply + config resolution ────────────────────────
{
  const s = createRigidSolver(makeCells([{ pos: [1, 2, 3], radius: 0.5 }]), { glueEnabled: false, startSleeping: false });
  const out = new Float32Array(RIGID_BODY_MAX * 4 * 4);
  writeRigidBodyTexture(s, out);
  check('texture: row 0 packs position + radius',
    out[0] === 1 && out[1] === 2 && out[2] === 3 && out[3] === 0.5);
  check('texture: row 1 packs the quaternion', out[(RIGID_BODY_MAX + 0) * 4 + 3] === 1);
  check('texture: row 2 packs velocity + sleeping flag',
    out[(2 * RIGID_BODY_MAX + 0) * 4 + 3] === 0);
  const r = resolveRigid({
    gpgpuRigidEnabled: true, gpgpuRigidRestitution: 5, gpgpuRigidFriction: -1,
    gpgpuRigidGlueEnabled: true, gpgpuRigidGlueStrength: 99999,
    gpgpuRigidStartSleeping: false, gpgpuRigidFloorTerrain: true,
  });
  check('resolveRigid: clamps restitution/friction/strength',
    r.active === true && r.restitution === 1 && r.friction === 0 && r.glueStrength === 1000 && r.floorTerrain === true,
    JSON.stringify(r));
  check('resolveRigid: phase 20 keys default to identity',
    r.jointEnabled === false && r.jointCompliance === 0 && r.jointBreakThreshold === 0
    && r.stressBreakEnabled === false && r.stressPropagation === 0.5,
    JSON.stringify(r));
  const r2 = resolveRigid({
    gpgpuRigidJointEnabled: true, gpgpuRigidJointCompliance: -2, gpgpuRigidJointBreakThreshold: 0.3,
    gpgpuRigidStressBreakEnabled: true, gpgpuRigidStressPropagation: 7,
  });
  check('resolveRigid: phase 20 keys resolve + clamp',
    r2.jointEnabled === true && r2.jointCompliance === 0 && r2.jointBreakThreshold === 0.3
    && r2.stressBreakEnabled === true && r2.stressPropagation === 1,
    JSON.stringify(r2));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
