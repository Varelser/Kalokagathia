// Phase 46 — rigid⇄particle coupling stage 1b + stage 2
// (isolated tree project-coupling-stage2; product tree untouched).
//
// Stage 1b (torque + wake-by-force), per design
// round-materials/03-rigid-particle-coupling-design.md §3-2 1b:
// - torque: the curl force is also sampled at a body-fixed
//   surface point (local +X pole); τ = r × F, α = τ·invInertia,
//   filled by fillRigidCurlAngAccel and applied as
//   RigidStepOptions.externalAngAccel in the integrator.
// - wake: RigidStepOptions.externalWakeThreshold > 0 wakes a
//   sleeping body whose sampled |accel| reaches the threshold,
//   before integration in the same substep. 0 = stage 1.
// Identity: torque absent + threshold 0 must be bit-identical
// to the stage 1 path (phase41's runCoupled law).
//
// Stage 2 (rigid → free particles), shader-side law pinned by
// its CPU twin collideFreeParticleWithBodies:
// - position: push-out to the sphere surface, bodies in index
//   order, sequential corrections.
// - velocity: normal reflection while approaching, restitution
//   = the rigid restitution.
// The free subset itself is a spawn-hash split in the shaders
// (guarded by uRigidFreeEnabled); the source-level guards are
// checked here as strings, the collision law numerically.
import { build } from 'esbuild';
import { unlinkSync, readFileSync } from 'node:fs';
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
      export {
        createRigidSolver, stepRigidBodies, resolveRigid,
        fillRigidCurlAccel, fillRigidCurlAngAccel, rigidCurlParamsFromConfig,
        collideFreeParticleWithBodies,
      } from './lib/rigidBodies.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  createRigidSolver, stepRigidBodies, resolveRigid,
  fillRigidCurlAccel, fillRigidCurlAngAccel, rigidCurlParamsFromConfig,
  collideFreeParticleWithBodies,
} = lib;

function makeCells(specs) {
  const n = specs.length;
  const centroids = new Float32Array(n * 3);
  const radii = new Float32Array(n);
  const coreRadii = new Float32Array(n);
  const cellCounts = new Int32Array(n);
  specs.forEach((s, i) => {
    centroids[i * 3] = s.pos[0]; centroids[i * 3 + 1] = s.pos[1]; centroids[i * 3 + 2] = s.pos[2];
    radii[i] = s.radius; coreRadii[i] = s.radius; cellCounts[i] = s.count ?? 10;
  });
  return { assignment: new Int32Array(0), localOffsets: new Float32Array(0), centroids, radii, coreRadii, cellCounts, bodyCount: n };
}
function gridSpecs(count = 64) {
  const specs = [];
  const side = Math.ceil(Math.cbrt(count));
  for (let i = 0; i < count; i++) {
    const x = (i % side) - (side - 1) / 2;
    const y = Math.floor(i / side) % side;
    const z = Math.floor(i / (side * side));
    specs.push({ pos: [x * 6, 30 + y * 6, z * 6 - 6], radius: 2, count: 10 });
  }
  return specs;
}
const GRAVITY = -0.2 * 9.8 * 60;
const BASE_OPTS = {
  gravityY: GRAVITY, floorEnabled: false, floorY: 0, bounceRadius: 1000,
  restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45,
};
const CURL_CFG = {
  gpgpuCurlEnabled: true, gpgpuCurlStrength: 1, gpgpuCurlScale: 0.008,
  gpgpuCurlSpeed: 1, gpgpuCurlMode: 'curl', gpgpuCurlOctaves: 1, gpgpuCurlSymmetry: 'none',
};
const snapshot = (state) => state.bodies.map((b) => [...b.pos, ...b.quat, ...b.angVel, b.sleeping ? 1 : 0]);
const identicalSnap = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, k) => v === b[i][k]));

function run({ scale = 0.1, torque = false, wakeThreshold = 0, startSleeping = false, frames = 120 } = {}) {
  const state = createRigidSolver(makeCells(gridSpecs()), { glueEnabled: false, startSleeping });
  const accel = new Float32Array(state.bodies.length * 3);
  const angAccel = new Float32Array(state.bodies.length * 3);
  for (let f = 0; f < frames; f++) {
    const params = rigidCurlParamsFromConfig(CURL_CFG, state.time);
    fillRigidCurlAccel(state, params, 1, scale, accel);
    const opts = { ...BASE_OPTS, externalAccel: accel, externalWakeThreshold: wakeThreshold };
    if (torque) {
      fillRigidCurlAngAccel(state, params, 1, scale, angAccel);
      opts.externalAngAccel = angAccel;
    }
    stepRigidBodies(state, 1 / 60, opts);
  }
  return state;
}

// ── 1b-1 identity: no torque + threshold 0 == stage 1 ────────
{
  const a = snapshot(run({ torque: false, wakeThreshold: 0 }));
  const b = snapshot(run({ torque: false, wakeThreshold: 0 }));
  check('1b identity: stage-1b options at default are deterministic bit-identical', identicalSnap(a, b));
  // forceScale 0 torque must also be an exact no-op.
  const zeroT = snapshot(run({ scale: 0, torque: true }));
  const zeroN = snapshot(run({ scale: 0, torque: false }));
  check('1b identity: torque at forceScale 0 is bit-identical to no torque', identicalSnap(zeroT, zeroN));
}

// ── 1b-2 torque effect ────────────────────────────────────────
{
  const off = run({ torque: false });
  const on = run({ torque: true });
  const angOff = off.bodies.reduce((s, b) => s + Math.hypot(...b.angVel), 0);
  const angOn = on.bodies.reduce((s, b) => s + Math.hypot(...b.angVel), 0);
  console.log(`torque: sum |angVel| off ${angOff.toFixed(4)} on ${angOn.toFixed(4)}`);
  check('1b torque: angular velocity develops under torque', angOn > 0.01, `angOn ${angOn}`);
  check('1b torque: orientations diverge from torque-off', !identicalSnap(snapshot(off), snapshot(on)));
  const on2 = run({ torque: true });
  check('1b torque: deterministic bit-identical across runs', identicalSnap(snapshot(on), snapshot(on2)));
}

// ── 1b-3 wake-by-force ────────────────────────────────────────
// Scene: bodies RESTING on the floor (centre y = radius). A
// floating sleeping body wakes by support loss (the existing
// updateSleep rule) regardless of force, so the force-wake
// test must start from supported sleep — the Gate 41 G4 shape.
{
  const restSpecs = gridSpecs().map((s) => ({ ...s, pos: [s.pos[0], s.radius, s.pos[2]] }));
  const runWake = (wakeThreshold) => {
    const state = createRigidSolver(makeCells(restSpecs), { glueEnabled: false, startSleeping: true });
    const accel = new Float32Array(state.bodies.length * 3);
    for (let f = 0; f < 60; f++) {
      fillRigidCurlAccel(state, rigidCurlParamsFromConfig(CURL_CFG, state.time), 1, 0.1, accel);
      stepRigidBodies(state, 1 / 60, { ...BASE_OPTS, floorEnabled: true, externalAccel: accel, externalWakeThreshold: wakeThreshold });
    }
    return state;
  };
  const asleep = runWake(0);
  const unmoved = asleep.bodies.every((b, i) => b.sleeping && b.pos[0] === restSpecs[i].pos[0] && b.pos[1] === restSpecs[i].pos[1] && b.pos[2] === restSpecs[i].pos[2]);
  check('1b wake: threshold 0 keeps sleeping bodies asleep and unmoved (stage 1 G4)', unmoved);

  const woken = runWake(10);
  const wokenCount = woken.bodies.filter((b) => !b.sleeping).length;
  console.log(`wake: woken bodies ${wokenCount}/64 at threshold 10`);
  check('1b wake: low threshold wakes bodies under the field', wokenCount > 0);

  const high = runWake(4000);
  check('1b wake: threshold above the field max wakes nobody', high.bodies.every((b) => b.sleeping));
}

// ── resolveRigid: new keys ────────────────────────────────────
{
  const r0 = resolveRigid({});
  check('resolve: defaults are off / 0 / 0.25 (identity)', r0.forceTorque === false && r0.forceWakeThreshold === 0 && r0.freeEnabled === false && r0.freeFraction === 0.25, JSON.stringify(r0));
  const r1 = resolveRigid({ gpgpuRigidForceTorque: true, gpgpuRigidForceWakeThreshold: 99999, gpgpuRigidFreeEnabled: true, gpgpuRigidFreeFraction: 2 });
  check('resolve: clamps apply (wake <= 4000, fraction <= 0.95)', r1.forceTorque === true && r1.forceWakeThreshold === 4000 && r1.freeEnabled === true && r1.freeFraction === 0.95, JSON.stringify(r1));
}

// ── Stage 2 collision law (CPU twin of the GLSL) ─────────────
{
  const bodies = [{ pos: [0, 0, 0], radius: 10 }, { pos: [30, 0, 0], radius: 5 }];
  const inside = collideFreeParticleWithBodies([3, 0, 0], [-5, 0, 0], bodies, 0.2);
  check('S2: penetration is pushed out to the surface', Math.abs(Math.hypot(...inside.pos) - 10) < 1e-9, `${inside.pos}`);
  check('S2: approaching velocity reflects with restitution', Math.abs(inside.vel[0] - 1) < 1e-9 && inside.vel[1] === 0, `${inside.vel}`); // -5 -> +5*0.2
  const away = collideFreeParticleWithBodies([3, 0, 0], [5, 0, 0], bodies, 0.2);
  check('S2: leaving velocity is not reflected (position still pushed out)', away.vel[0] === 5 && Math.abs(Math.hypot(...away.pos) - 10) < 1e-9);
  const outside = collideFreeParticleWithBodies([100, 50, 0], [1, 2, 3], bodies, 0.2);
  check('S2: outside particle is untouched', outside.contacts === 0 && outside.pos[0] === 100 && outside.vel[1] === 2);
  const centre = collideFreeParticleWithBodies([0, 0, 0], [0, -1, 0], bodies, 0.5);
  check('S2: degenerate centre hit exits along +Y', Math.abs(centre.pos[1] - 10) < 1e-9 && Math.abs(centre.vel[1] - 0.5) < 1e-9, `${centre.pos} ${centre.vel}`);
  const second = collideFreeParticleWithBodies([27, 0, 0], [0, 0, 0], bodies, 0.2);
  check('S2: second body is visited in index order', second.contacts === 1 && Math.abs(Math.hypot(second.pos[0] - 30, second.pos[1], second.pos[2]) - 5) < 1e-9);
}

// ── Stage 2 shader guards (source level) ─────────────────────
{
  const vel = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationVelocityMainForces.ts'), 'utf8');
  const velTail = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationVelocityMainTail.ts'), 'utf8');
  const pos = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationPosition.ts'), 'utf8');
  const passes = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  check('S2 shader: velocity rigid branch is free-guarded', vel.includes('if (uRigidEnabled && !rigidFree)'));
  check('S2 shader: position rigid branch is free-guarded', pos.includes('if (uRigidEnabled && !rigidFree)'));
  check('S2 shader: velocity tail reflects free particles', velTail.includes('if (rigidFree)') && velTail.includes('uRigidFreeBounce'));
  check('S2 shader: position tail pushes free particles out', pos.includes('if (rigidFree)') && pos.includes('uRigidBodyCount'));
  check('S2 passes: free uniforms are wired from resolveRigid', passes.includes('rigid.freeEnabled') && passes.includes('rigid.freeFraction') && passes.includes('rigidBodyCount'));
}

// ── Stage 2 variant discipline (assembled strings) ───────────
// Phase 19 discipline: the stock assemblies must carry no
// trace of the feature; the rigidFree options splice it in.
{
  const BUNDLE2 = join(ROOT, 'scripts', `.p46-bundle2-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: `
        export { buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
        export { buildPositionFragment } from './components/gpgpuShaderSimulationPosition.ts';
      `,
      resolveDir: ROOT, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE2, logLevel: 'silent',
  });
  const shaders = await import(pathToFileURL(BUNDLE2).href);
  unlinkSync(BUNDLE2);
  const stockVel = shaders.buildVelocityFragment('', undefined, undefined);
  const freeVel = shaders.buildVelocityFragment('', undefined, { rigidFree: true });
  const stockPos = shaders.buildPositionFragment();
  const freePos = shaders.buildPositionFragment({ rigidFree: true });
  check('S2 variant: stock velocity assembly has no free-particle trace', !stockVel.includes('rigidFree') && !stockVel.includes('uRigidFree'));
  check('S2 variant: stock position assembly has no free-particle trace', !stockPos.includes('rigidFree') && !stockPos.includes('uRigidFree'));
  check('S2 variant: velocity variant carries guard + reflection',
    freeVel.includes('if (uRigidEnabled && !rigidFree)') && freeVel.includes('vel -= n * vn * (1.0 + uRigidFreeBounce);'));
  check('S2 variant: position variant carries guard + push-out',
    freePos.includes('if (uRigidEnabled && !rigidFree)') && freePos.includes('pos = bp.xyz + n * bp.w;'));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
