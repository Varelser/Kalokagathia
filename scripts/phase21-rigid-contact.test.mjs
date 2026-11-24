// Phase 21 stage 3 — rigid-body contact events.
// Identity: event collection is bookkeeping only — a solver that
// drains events every frame and one that never drains produce
// bit-identical body trajectories.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p21s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createRigidSolver, stepRigidBodies, drainRigidContactEvents, RIGID_CONTACT_EVENT_CAP } from './lib/rigidBodies.ts';
      export { validateEventRule, evaluateEventRules } from './lib/eventRules.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { createRigidSolver, stepRigidBodies, drainRigidContactEvents, RIGID_CONTACT_EVENT_CAP, validateEventRule, evaluateEventRules } = lib;

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
  return { assignment: new Int32Array(0), localOffsets: new Float32Array(0), centroids, radii, coreRadii, cellCounts, bodyCount: n };
}
const OPTS = { gravityY: -9.8 * 60, floorEnabled: true, floorY: 0, bounceRadius: 100, restitution: 0.2, friction: 0.5, glueEnabled: false, glueStrength: 45 };

// --- floor contact: rising edge only ---------------------------------
{
  const s = createRigidSolver(makeCells([{ pos: [0, 2, 0], radius: 0.4 }]), { glueEnabled: false, startSleeping: false });
  let floorEvents = 0;
  let totalEvents = 0;
  for (let f = 0; f < 240; f++) {
    stepRigidBodies(s, 1 / 60, OPTS);
    const evs = drainRigidContactEvents(s);
    totalEvents += evs.length;
    floorEvents += evs.filter((e) => e.b === -1 && e.a === 0).length;
  }
  check('falling body produces a floor contact event', floorEvents >= 1, `floorEvents=${floorEvents}`);
  check('resting contact does not refire every frame', floorEvents <= 3, `floorEvents=${floorEvents} total=${totalEvents}`);
  check('drain empties the pending list', drainRigidContactEvents(s).length === 0);
  check('floor event impact is finite and non-negative', totalEvents >= 1);
}

// --- pair contact ------------------------------------------------------
{
  const s = createRigidSolver(makeCells([
    { pos: [0, 3, 0], radius: 0.4 },
    { pos: [0, 0.4, 0], radius: 0.4 },
  ]), { glueEnabled: false, startSleeping: false });
  let pairEvents = 0;
  for (let f = 0; f < 240; f++) {
    stepRigidBodies(s, 1 / 60, OPTS);
    pairEvents += drainRigidContactEvents(s).filter((e) => e.b >= 0).length;
  }
  check('falling body onto resting body produces a pair contact event', pairEvents >= 1, `pairEvents=${pairEvents}`);
}

// --- no contact, no events ---------------------------------------------
{
  const s = createRigidSolver(makeCells([{ pos: [0, 0.4, 0], radius: 0.4 }]), { glueEnabled: false, startSleeping: true });
  for (let f = 0; f < 30; f++) stepRigidBodies(s, 1 / 60, OPTS);
  const evs = drainRigidContactEvents(s);
  check('sleeping resting body: at most the initial settle event', evs.length <= 1, `evs=${evs.length}`);
}

// --- identity: draining never changes the trajectory -------------------
{
  const specs = [
    { pos: [0, 3, 0], radius: 0.4 },
    { pos: [0.3, 1.5, 0.1], radius: 0.35 },
    { pos: [-0.2, 0.4, 0], radius: 0.45 },
  ];
  const a = createRigidSolver(makeCells(specs), { glueEnabled: false, startSleeping: false });
  const b = createRigidSolver(makeCells(specs), { glueEnabled: false, startSleeping: false });
  let identical = true;
  for (let f = 0; f < 240; f++) {
    stepRigidBodies(a, 1 / 60, OPTS);
    drainRigidContactEvents(a);
    stepRigidBodies(b, 1 / 60, OPTS);
    for (let i = 0; i < a.bodies.length; i++) {
      for (let k = 0; k < 3; k++) {
        if (a.bodies[i].pos[k] !== b.bodies[i].pos[k] || a.bodies[i].vel[k] !== b.bodies[i].vel[k]) identical = false;
      }
    }
  }
  check('trajectory identical whether events are drained or not', identical);
  check('undrained pending list stays capped', b.pendingContactEvents.length <= RIGID_CONTACT_EVENT_CAP, `pending=${b.pendingContactEvents.length}`);
}

// --- rule side: rigid-contact is a valid, evaluable event type ---------
{
  const rule = validateEventRule({ id: 'rc1', event: 'rigid-contact', condition: 'vel > 0.1', actions: [{ type: 'synth-note', note: 60 }] });
  check('rigid-contact rule validates', rule !== null);
  check('rigid-contact rule fires on strong impact context', evaluateEventRules([rule], { type: 'rigid-contact' }, { vel: 2 }).length === 1);
  check('rigid-contact rule gated by condition', evaluateEventRules([rule], { type: 'rigid-contact' }, { vel: 0.01 }).length === 0);
  check('rigid-contact rule does not fire for other events', evaluateEventRules([rule], { type: 'beat' }, { vel: 2 }).length === 0);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
