// Phase 47 (UE5 #35 G-D stage D1) — multi-sample sphere floor.
// The sphere floor path used to sample the terrain only under
// each body's centre, so a large body could sink its rim into
// a slope beside the centre. With gpgpuRigidFloorMultiSample on,
// the body rests on the highest of the centre + four ring
// samples (0.7·radius) under its disc.
// Acceptance:
//   D1a  on a FLAT heightfield the option is bit-identical to
//        the legacy centre rule over a full drop + settle.
//   D1b  mechanism: one penetrating body on a slope is lifted
//        to exactly ringMax + radius (vs centre + radius for
//        the legacy rule) in a single substep.
//   D1c  determinism on the slope scene.
//   D1d  key wiring: default false, resolveRigid reads it,
//        description + AI catalog spec present.
import { build } from 'esbuild';
import { unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p47-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, resolveRigid, sampleRigidHeightfield } from './lib/rigidBodies.ts';
      export { buildFractureCellData } from './lib/voronoiFracture.ts';
      import { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { DEFAULT_CONFIG };
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { createRigidSolver, stepRigidBodies, resolveRigid, sampleRigidHeightfield, buildFractureCellData, DEFAULT_CONFIG } = lib;

const BASE = {
  gravityY: -0.2 * 9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 150,
  restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
};

function makeField(fn) {
  const size = 64;
  const extent = 150;
  const step = (2 * extent) / (size - 1);
  const heights = new Float32Array(size * size);
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      heights[iz * size + ix] = fn(-extent + ix * step, -extent + iz * step);
    }
  }
  return { size, extent, step, heights };
}
const flatField = makeField(() => 2.5);
const slopeField = makeField((x) => 0.1 * x);

function scene(cells) {
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
  return buildFractureCellData(positions, COUNT, { cells, seed: 1, gap: 0.25 });
}

function fingerprint(state) {
  const out = [];
  for (const b of state.bodies) out.push(b.pos[0], b.pos[1], b.pos[2], b.vel[0], b.vel[1], b.vel[2], b.sleeping ? 1 : 0);
  return out;
}

// D1a: flat heightfield — bit-identical.
{
  const run = (multi) => {
    const s = createRigidSolver(scene(24), { glueEnabled: false });
    const opts = { ...BASE, heightfield: flatField, floorMultiSample: multi };
    for (let f = 0; f < 900; f++) stepRigidBodies(s, 1 / 60, opts);
    return fingerprint(s);
  };
  const a = run(false);
  const b = run(true);
  check('D1a flat heightfield: multi-sample bit-identical over 900 frames',
    a.length === b.length && a.every((v, k) => v === b[k]));
}

// D1b: mechanism on a slope — one substep, exact rest heights.
{
  const setupBody = () => {
    const s = createRigidSolver(scene(12), { glueEnabled: false });
    for (let k = 1; k < s.bodies.length; k++) s.bodies[k].pos[1] += 500;
    const body = s.bodies[0];
    body.pos[0] = 0; body.pos[2] = 0;
    body.pos[1] = body.radius - 1; // penetrating by 1 under the centre rule (centre height 0)
    body.vel = [0, 0, 0]; body.angVel = [0, 0, 0];
    return { s, body };
  };
  const legacy = setupBody();
  stepRigidBodies(legacy.s, 1 / 120, { ...BASE, heightfield: slopeField, floorMultiSample: false });
  const multi = setupBody();
  stepRigidBodies(multi.s, 1 / 120, { ...BASE, heightfield: slopeField, floorMultiSample: true });
  const r = legacy.body.radius;
  const ringMax = Math.max(
    sampleRigidHeightfield(slopeField, 0, 0),
    sampleRigidHeightfield(slopeField, 0.7 * r, 0),
    sampleRigidHeightfield(slopeField, -0.7 * r, 0),
    sampleRigidHeightfield(slopeField, 0, 0.7 * r),
    sampleRigidHeightfield(slopeField, 0, -0.7 * r),
  );
  check('D1b legacy rests at centre height + radius',
    Math.abs(legacy.body.pos[1] - (0 + r)) < 1e-9, `y=${legacy.body.pos[1]} r=${r}`);
  check('D1b multi-sample rests at ring max + radius (higher on the slope)',
    Math.abs(multi.body.pos[1] - (ringMax + r)) < 1e-9 && multi.body.pos[1] > legacy.body.pos[1],
    `y=${multi.body.pos[1]} expected=${ringMax + r}`);
}

// D1c: determinism on the slope scene with the option on.
{
  const run = () => {
    const s = createRigidSolver(scene(24), { glueEnabled: false });
    const opts = { ...BASE, heightfield: slopeField, floorMultiSample: true };
    for (let f = 0; f < 600; f++) stepRigidBodies(s, 1 / 60, opts);
    return fingerprint(s);
  };
  const a = run();
  const b = run();
  check('D1c slope scene deterministic', a.length === b.length && a.every((v, k) => v === b[k]));
  check('D1c2 slope scene stays finite', a.every(Number.isFinite));
}

// D1d: wiring.
check('D1d default off + resolveRigid reads the key',
  DEFAULT_CONFIG.gpgpuRigidFloorMultiSample === false
  && resolveRigid(DEFAULT_CONFIG).floorMultiSample === false
  && resolveRigid({ ...DEFAULT_CONFIG, gpgpuRigidFloorMultiSample: true }).floorMultiSample === true);
check('D1d description + catalog spec present',
  readFileSync(join(ROOT, 'lib/parameterDescriptions.ts'), 'utf8').includes("gpgpuRigidFloorMultiSample: '")
  && readFileSync(join(ROOT, 'lib/aiControlCatalog.ts'), 'utf8').includes("['gpgpuRigidFloorMultiSample',"));
check('D1d key count grew by exactly one (1567 in this tree)',
  readFileSync(join(ROOT, 'lib/rigidBodies.ts'), 'utf8').includes('floorMultiSampleY'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
