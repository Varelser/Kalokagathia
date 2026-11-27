// Phase 49 (UE5 #35 G-D stage D2) — static box colliders.
// Acceptance (pre-registered in UE35_GD_D2_DESIGN.md; scenes
// calibrated by the phase49 diagnosis — the fractured-ball drop
// scatters by design in this solver (see the G-A stage-3
// material), so the rest assertions use single-body scenes and
// the chaotic scenes assert the invariants that must hold
// regardless of the scatter):
//  S1 identity: no statics (absent option, or empty list) keeps
//     trajectories bit-identical to the legacy step.
//  S2 parse: the JSON key sanitises as designed.
//  S3 a sphere body dropped on a plate rests ON it and sleeps.
//  S4 chaotic drop: no residual penetration at rest (all bodies).
//  S5 an OBB body (shape axis-aligned) rests on the plate:
//     support point on the plate top, no SAT overlap, settled.
//  S6 a wall is not tunnelled: frame-end penetration stays
//     ~zero (the repeated static pass invariant) and no centre
//     crosses the wall mid-plane inside its span.
//  S7 rotated boxes: Y-45 plate (sphere rest) and a Z-20 ramp
//     (OBB rest on the tilted face).
//  S8 determinism: identical inputs -> identical fingerprint.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p49-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, parseRigidStaticBoxes, resolveRigid } from './lib/rigidBodies.ts';
      import { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { DEFAULT_CONFIG };
      export { buildFractureCellData } from './lib/voronoiFracture.ts';
      export { sphereObbContact, obbSatContact, placeObb, obbSupportPoint } from './lib/rigidObb.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  createRigidSolver, stepRigidBodies, parseRigidStaticBoxes, resolveRigid, DEFAULT_CONFIG,
  buildFractureCellData, sphereObbContact, obbSatContact, placeObb, obbSupportPoint,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const BASE = {
  gravityY: -0.2 * 9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 150,
  restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
};

function scene(cells, { dx = 0, dy = 0 } = {}) {
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const COUNT = 4096;
  const positions = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const u = rnd() * 2 - 1; const th = rnd() * Math.PI * 2; const r = Math.cbrt(rnd()) * 14;
    const s = Math.sqrt(1 - u * u);
    positions[i * 4] = r * s * Math.cos(th) + dx;
    positions[i * 4 + 1] = r * u + 17 + dy;
    positions[i * 4 + 2] = r * s * Math.sin(th);
    positions[i * 4 + 3] = 1;
  }
  return buildFractureCellData(positions, COUNT, { cells, seed: 1, gap: 0.25 });
}

function fingerprint(state) {
  const out = [];
  for (const b of state.bodies) {
    out.push(b.pos[0], b.pos[1], b.pos[2], b.quat[0], b.quat[1], b.quat[2], b.quat[3],
      b.vel[0], b.vel[1], b.vel[2], b.angVel[0], b.angVel[1], b.angVel[2], b.sleeping ? 1 : 0);
  }
  out.push(state.time);
  return out;
}

/** A solver with bodies[0] active and every other body parked
 *  asleep far below (supported by the floor rule, so the
 *  support-loss wake never fires): isolates body x static. */
function singleBodySolver(convex) {
  const s = createRigidSolver(scene(2), { glueEnabled: false, startSleeping: false, convexEnabled: convex });
  for (let i = 1; i < s.bodies.length; i++) {
    s.bodies[i].pos = [0, -500, 0];
    s.bodies[i].vel = [0, 0, 0];
    s.bodies[i].sleeping = true;
  }
  const b = s.bodies[0];
  b.vel = [0, 0, 0]; b.angVel = [0, 0, 0]; b.sleeping = false;
  return [s, b];
}

/** Rotation matrix (rows) -> quaternion [x, y, z, w]. */
function quatFromMatRows(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let x; let y; let z; let w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
  return [x, y, z, w];
}

const PLATE_JSON = '[{"c":[0,5,0],"h":[30,5,30]}]';
const plate = parseRigidStaticBoxes(PLATE_JSON);

// ── S2: parse ──
check('S2a empty / broken / non-array yield []',
  parseRigidStaticBoxes('').length === 0
  && parseRigidStaticBoxes('{oops').length === 0
  && parseRigidStaticBoxes('{"c":[0,0,0]}').length === 0
  && parseRigidStaticBoxes(undefined).length === 0);
check('S2b a valid box parses (centre / half extents / identity axes)',
  plate.length === 1 && plate[0].center[1] === 5 && plate[0].halfExtents[0] === 30
  && plate[0].axes[0][0] === 1 && plate[0].axes[1][1] === 1 && plate[0].axes[2][2] === 1);
{
  const mixed = parseRigidStaticBoxes(JSON.stringify([
    { c: [0, 5, 0], h: [10, 5, 10] },
    { c: [0, 5], h: [10, 5, 10] },
    { c: [0, 5, 0], h: [0.001, 5, 10] },
    { c: [99999, 5, 0], h: [10, 5, 10] },
    'nonsense',
  ]));
  check('S2c bad entries drop individually, half extents clamp',
    mixed.length === 2 && mixed[1].halfExtents[0] === 0.05, `len=${mixed.length}`);
  const many = parseRigidStaticBoxes(JSON.stringify(
    Array.from({ length: 20 }, () => ({ c: [0, 5, 0], h: [1, 1, 1] }))));
  check('S2d the list clamps at 16', many.length === 16, `len=${many.length}`);
  const rot = parseRigidStaticBoxes('[{"c":[0,5,0],"h":[30,5,30],"e":[0,45,0]}]')[0];
  const c45 = Math.cos(Math.PI / 4); const s45 = Math.sin(Math.PI / 4);
  check('S2e Y-45 rotation lands on the axes',
    Math.abs(rot.axes[0][0] - c45) < 1e-9 && Math.abs(rot.axes[0][2] + s45) < 1e-9
    && Math.abs(rot.axes[2][0] - s45) < 1e-9 && Math.abs(rot.axes[2][2] - c45) < 1e-9,
    `axes=${JSON.stringify(rot.axes)}`);
}

// ── S2f: wiring (default / resolve / descriptions) ──
{
  const { readFileSync } = await import('node:fs');
  check('S2f default is empty and resolveRigid reads the key',
    DEFAULT_CONFIG.gpgpuRigidStaticBoxes === ''
    && resolveRigid(DEFAULT_CONFIG).staticBoxes.length === 0
    && resolveRigid({ ...DEFAULT_CONFIG, gpgpuRigidStaticBoxes: PLATE_JSON }).staticBoxes.length === 1);
  check('S2g description + catalog spec present',
    readFileSync(join(ROOT, 'lib/parameterDescriptions.ts'), 'utf8').includes("gpgpuRigidStaticBoxes: '")
    && readFileSync(join(ROOT, 'lib/aiControlCatalog.ts'), 'utf8').includes("['gpgpuRigidStaticBoxes',"));
}

// ── S1: identity without statics ──
{
  const mk = (stepOpts) => {
    const s = createRigidSolver(scene(64), { glueEnabled: false, startSleeping: false, convexEnabled: false });
    for (let f = 0; f < 1200; f++) stepRigidBodies(s, 1 / 60, { ...BASE, ...stepOpts });
    return fingerprint(s);
  };
  const a = mk({});
  const b = mk({ staticBoxes: [] });
  const c = mk({ staticBoxes: null });
  const same = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);
  check('S1 absent / empty / null statics are all bit-identical', same(a, b) && same(a, c));
}

// ── S3: sphere body rests on the plate ──
{
  const [s, b] = singleBodySolver(false);
  b.pos = [0, 10 + b.radius + 2, 0];
  for (let f = 0; f < 1800; f++) stepRigidBodies(s, 1 / 60, { ...BASE, staticBoxes: plate });
  const bottom = b.pos[1] - b.radius;
  check('S3a the body rests on the plate top (bottom == 10)',
    Math.abs(bottom - 10) <= 0.01, `bottom=${bottom.toFixed(4)}`);
  check('S3b the body sleeps on the plate', b.sleeping === true);
  const ct = sphereObbContact(b.pos, b.radius, plate[0]);
  check('S3c no residual penetration', !ct.hit || ct.depth <= 0.01,
    `depth=${ct.hit ? ct.depth.toFixed(4) : 'none'}`);
}

// ── S4: chaotic drop, no residual penetration ──
{
  const s = createRigidSolver(scene(64, { dy: 16 }), { glueEnabled: false, startSleeping: false, convexEnabled: false });
  for (let f = 0; f < 3600; f++) stepRigidBodies(s, 1 / 60, { ...BASE, staticBoxes: plate });
  let worst = 0;
  let finite = true;
  for (const b of s.bodies) {
    for (const v of [...b.pos, ...b.vel]) if (!Number.isFinite(v)) finite = false;
    const ct = sphereObbContact(b.pos, b.radius, plate[0]);
    if (ct.hit) worst = Math.max(worst, ct.depth);
  }
  check('S4 chaotic drop settles finite with no residual penetration (<= 0.05)',
    finite && worst <= 0.05, `worst=${worst.toFixed(4)}`);
}

// ── S5: OBB body rests on the plate ──
{
  const [s, b] = singleBodySolver(true);
  const A = b.shape.axes;
  b.quat = quatFromMatRows([A[0], A[1], A[2]]); // shape axis-aligned with the world
  const placed0 = placeObb(b.shape, [0, 0, 0], b.quat);
  b.pos = [0, 10 + placed0.halfExtents[1] + Math.abs(placed0.center[1]) + 2, 0];
  for (let f = 0; f < 1800; f++) stepRigidBodies(s, 1 / 60, { ...BASE, convexEnabled: true, staticBoxes: plate });
  const sup = obbSupportPoint(placeObb(b.shape, b.pos, b.quat), [0, -1, 0]);
  const ct = obbSatContact(placeObb(b.shape, b.pos, b.quat), plate[0]);
  const speed = Math.hypot(...b.vel);
  check('S5a the OBB body rests on the plate top (support == 10)',
    Math.abs(sup[1] - 10) <= 0.05, `supportY=${sup[1].toFixed(3)} pos=(${b.pos.map((v) => v.toFixed(1)).join(',')})`);
  check('S5b no SAT overlap at rest and the body is settled (speed < 3)',
    (!ct.hit || ct.depth <= 0.05) && speed < 3,
    `depth=${ct.hit ? ct.depth.toFixed(4) : 'none'} speed=${speed.toFixed(2)}`);
}

// ── S6: wall ──
{
  const wall = parseRigidStaticBoxes('[{"c":[8,40,0],"h":[3,40,30]}]');
  const s = createRigidSolver(scene(64, { dx: -10 }), { glueEnabled: false, startSleeping: false, convexEnabled: false });
  const side = s.bodies.map((b) => Math.sign(b.pos[0] - 8));
  let crossings = 0;
  let worstPen = 0;
  for (let f = 0; f < 2400; f++) {
    stepRigidBodies(s, 1 / 60, { ...BASE, staticBoxes: wall });
    s.bodies.forEach((b, i) => {
      const ct = sphereObbContact(b.pos, b.radius, wall[0]);
      if (ct.hit) worstPen = Math.max(worstPen, ct.depth);
      const now = Math.sign(b.pos[0] - 8);
      if (side[i] !== 0 && now !== 0 && now !== side[i] && Math.abs(b.pos[2]) < 30 && b.pos[1] < 80) crossings += 1;
      if (now !== 0) side[i] = now;
    });
  }
  check('S6a frame-end penetration of the wall stays ~zero (<= 0.05)',
    worstPen <= 0.05, `worst=${worstPen.toFixed(4)}`);
  check('S6b no centre crosses the wall mid-plane inside its span',
    crossings === 0, `crossings=${crossings}`);
}

// ── S7: rotated boxes ──
{
  const y45 = parseRigidStaticBoxes('[{"c":[0,5,0],"h":[30,5,30],"e":[0,45,0]}]');
  const [s, b] = singleBodySolver(false);
  b.pos = [0, 10 + b.radius + 2, 0];
  for (let f = 0; f < 1800; f++) stepRigidBodies(s, 1 / 60, { ...BASE, staticBoxes: y45 });
  const bottom = b.pos[1] - b.radius;
  check('S7a a sphere body rests on the Y-45 plate (top still at y=10)',
    Math.abs(bottom - 10) <= 0.01 && b.sleeping, `bottom=${bottom.toFixed(4)} sleep=${b.sleeping}`);

  const ramp = parseRigidStaticBoxes('[{"c":[0,5,0],"h":[120,5,120],"e":[0,0,20]}]');
  const [s2, b2] = singleBodySolver(true);
  b2.pos = [0, 30, 0];
  for (let f = 0; f < 2400; f++) stepRigidBodies(s2, 1 / 60, { ...BASE, convexEnabled: true, staticBoxes: ramp });
  const placed = placeObb(b2.shape, b2.pos, b2.quat);
  const ct = obbSatContact(placed, ramp[0]);
  const up = ramp[0].axes[1];
  const sup = obbSupportPoint(placed, [-up[0], -up[1], -up[2]]);
  const distToTop = (sup[0] - ramp[0].center[0]) * up[0]
    + (sup[1] - ramp[0].center[1]) * up[1]
    + (sup[2] - ramp[0].center[2]) * up[2] - ramp[0].halfExtents[1];
  check('S7b an OBB body rests on the Z-20 ramp face (support on the top plane)',
    (!ct.hit || ct.depth <= 0.05) && Math.abs(distToTop) <= 0.2 && b2.sleeping,
    `distToTop=${distToTop.toFixed(3)} depth=${ct.hit ? ct.depth.toFixed(4) : 'none'} sleep=${b2.sleeping} pos=(${b2.pos.map((v) => v.toFixed(1)).join(',')})`);
}

// ── S8: determinism ──
{
  const run = () => {
    const s = createRigidSolver(scene(32, { dy: 16 }), { glueEnabled: false, startSleeping: false, convexEnabled: false });
    for (let f = 0; f < 900; f++) stepRigidBodies(s, 1 / 60, { ...BASE, staticBoxes: plate });
    return fingerprint(s);
  };
  const a = run(); const b = run();
  check('S8 identical inputs give identical trajectories',
    a.length === b.length && a.every((v, k) => v === b[k]));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
