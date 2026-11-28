#!/usr/bin/env node
// layer1-wp5-daemon-laws.test.mjs — Layer 1 WP5 phase B: the
// daemon field laws of lib/gpgpuDaemonFields.ts (LAWS ONLY —
// no config keys, no shader wiring; phase D connects the
// drag / crown laws as field-instance kinds).
//
// RealFlow §3's daemon family was missing as placeable
// grammar: Drag existed only as one global rate, Crown and
// Sheeter had no force law at all, and the k daemons had no
// placed authoring form. This phase defines the laws as pure
// functions and pins them here:
//
// (a) placed drag: the rel-drag law localised by the shared
//     falloff — weight 1 at the centre / 0 at and beyond the
//     radius, Δv relaxing toward the target velocity (still
//     air or wind), convergence over repeated steps, and the
//     inert cases (rate 0, dt 0, outside) exactly zero.
// (b) crown: the Gaussian annulus profile peaks exactly at
//     the ring radius, the vertical envelope reuses the
//     house falloff (zero below the base plane and at /
//     beyond the height), the push at the ring is up-and-out
//     at the pinned gain, and on the axis it is straight up.
// (c) sheeter: zero without supply (count 0); the coherence
//     term relaxes toward the neighbourhood mean velocity;
//     the flattening term removes only the OUT-OF-PLANE
//     offset (an in-plane offset yields no pull), with a
//     non-unit normal normalised and a zero normal skipping
//     the flattening term.
// (d) k daemons: tolerant parse (malformed → none, defaults,
//     open range ends, the list cap), the twin judgement
//     (region + age range + density range, boundaries
//     inclusive for the ranges and exclusive for the
//     region), and a stable parse → serialize → parse round
//     trip.
//
// Run: node scripts/layer1-wp5-daemon-laws.test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-12) => near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);
const isZero = (a) => a[0] === 0 && a[1] === 0 && a[2] === 0;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const D = await load('lib/gpgpuDaemonFields.ts');

// ---- (a) placed drag ---------------------------------------------------
{
  const def = { pos: [0, 0, 0], radius: 10, strength: 2, target: [0, 0, 0] };
  check('drag weight: 1 at centre', D.daemonDragWeight(def, [0, 0, 0]) === 1);
  check('drag weight: house falloff at half radius', D.daemonDragWeight(def, [5, 0, 0]) === 0.5625);
  check('drag weight: 0 at radius', D.daemonDragWeight(def, [10, 0, 0]) === 0);
  check('drag weight: 0 beyond radius', D.daemonDragWeight(def, [20, 0, 0]) === 0);

  // Centre, vel 4 → still air, dt 0.5 at rate 2: k = 1 − e^−1.
  const dv = D.daemonDragDeltaV(def, [0, 0, 0], [4, 0, 0], 0.5);
  check('drag Δv at centre relaxes toward still air', vecNear(dv, [-2.528482235314231, 0, 0], 1e-9));
  check('drag Δv direction opposes the velocity', dv[0] < 0 && 4 + dv[0] > 0);

  // Wind target: vel 0 → target [3, 0, 0].
  const windDef = { pos: [0, 0, 0], radius: 10, strength: 2, target: [3, 0, 0] };
  const dvw = D.daemonDragDeltaV(windDef, [0, 0, 0], [0, 0, 0], 0.5);
  check('drag Δv toward a wind target', vecNear(dvw, [1.8963616764856731, 0, 0], 1e-9));

  // Repeated steps converge to the target.
  let vel = [10, 0, 0];
  for (let i = 0; i < 600; i++) {
    const step = D.daemonDragDeltaV(def, [0, 0, 0], vel, 1 / 60);
    vel = [vel[0] + step[0], vel[1] + step[1], vel[2] + step[2]];
  }
  check('drag converges to still air over steps', Math.abs(vel[0]) < 1e-6);

  check('drag inert outside the radius', isZero(D.daemonDragDeltaV(def, [20, 0, 0], [4, 0, 0], 0.5)));
  check('drag inert at rate 0', isZero(D.daemonDragDeltaV({ ...def, strength: 0 }, [0, 0, 0], [4, 0, 0], 0.5)));
  check('drag inert at dt 0', isZero(D.daemonDragDeltaV(def, [0, 0, 0], [4, 0, 0], 0)));
  check('drag inert for a non-finite rate', isZero(D.daemonDragDeltaV({ ...def, strength: NaN }, [0, 0, 0], [4, 0, 0], 0.5)));
  check('clampDaemonDragRate: range and non-finite',
    D.clampDaemonDragRate(-1) === 0 && D.clampDaemonDragRate(200) === 100
    && D.clampDaemonDragRate(2.5) === 2.5 && D.clampDaemonDragRate(NaN) === 0);
}

// ---- (b) crown ----------------------------------------------------------
{
  check('crown ring profile: 1 at the ring radius', D.daemonCrownRingProfile(5, 5, 2.5) === 1);
  check('crown ring profile: e^−1 one width out', near(D.daemonCrownRingProfile(7.5, 5, 2.5), 0.36787944117144233));
  check('crown ring profile: e^−1 one width in', near(D.daemonCrownRingProfile(2.5, 5, 2.5), 0.36787944117144233));
  check('crown ring profile: degenerate radius is 0', D.daemonCrownRingProfile(5, 0, 2.5) === 0);
  check('crown ring profile: width 0 reads as radius / 2',
    D.daemonCrownRingProfile(7.5, 5, 0) === D.daemonCrownRingProfile(7.5, 5, 2.5));

  const def = { pos: [0, 0, 0], radius: 5, strength: 1, height: 10, width: 2.5 };
  check('crown weight: full at ring + base', D.daemonCrownWeight(def, [5, 0, 0]) === 1);
  check('crown weight: house falloff at half height', D.daemonCrownWeight(def, [5, 5, 0]) === 0.5625);
  check('crown weight: 0 at the height', D.daemonCrownWeight(def, [5, 10, 0]) === 0);
  check('crown weight: 0 below the base plane', D.daemonCrownWeight(def, [5, -1, 0]) === 0);
  check('crown weight: ring profile on the axis', near(D.daemonCrownWeight(def, [0, 0, 0]), Math.exp(-4)));

  // At the ring on the base plane: direction (1, 1, 0) / √2 at gain 30.
  const f = D.daemonCrownForce(def, [5, 0, 0], 1 / 60);
  check('crown force at ring: up-and-out at 45°', vecNear(f, [0.35355339059327373, 0.35355339059327373, 0]));
  check('crown force at ring: magnitude is strength × dt × gain', near(Math.hypot(f[0], f[1], f[2]), 0.5));
  // On the axis the push is straight up, scaled by the ring profile there.
  const fa = D.daemonCrownForce(def, [0, 0, 0], 1 / 60);
  check('crown force on the axis: straight up', vecNear(fa, [0, Math.exp(-4) * 0.5, 0]));
  check('crown force inert below the base plane', isZero(D.daemonCrownForce(def, [5, -1, 0], 1 / 60)));
  check('crown force inert beyond the height', isZero(D.daemonCrownForce(def, [5, 12, 0], 1 / 60)));
  check('crown force inert at dt 0', isZero(D.daemonCrownForce(def, [5, 0, 0], 0)));
  check('crown force peaks at the ring, not the centre',
    Math.hypot(...D.daemonCrownForce(def, [5, 0, 0], 1 / 60)) > Math.hypot(...D.daemonCrownForce(def, [0, 0, 0], 1 / 60)));
}

// ---- (c) sheeter --------------------------------------------------------
{
  const supply = { meanVel: [0, 0, 0], meanPos: [0, 0, 0], normal: [0, 1, 0], count: 5 };
  check('sheeter: no supply (count 0) is zero',
    isZero(D.sheeterDeltaV({ rate: 2, sheetRate: 1 }, { ...supply, count: 0 }, [0, 3, 0], [4, 0, 0], 0.5)));
  check('sheeter: dt 0 is zero',
    isZero(D.sheeterDeltaV({ rate: 2, sheetRate: 1 }, supply, [0, 3, 0], [4, 0, 0], 0)));
  check('sheeter: both rates 0 is zero',
    isZero(D.sheeterDeltaV({ rate: 0, sheetRate: 0 }, supply, [0, 3, 0], [4, 0, 0], 0.5)));

  // Coherence only (sheetRate 0, on the mean plane): rel-drag form.
  const coh = D.sheeterDeltaV({ rate: 2, sheetRate: 0 }, supply, [0, 0, 0], [4, 0, 0], 0.5);
  check('sheeter coherence relaxes toward the mean velocity', vecNear(coh, [-2.528482235314231, 0, 0], 1e-9));

  // Flattening only: 3 above the mean plane, non-unit normal normalised.
  const flat = D.sheeterDeltaV(
    { rate: 0, sheetRate: 1 },
    { meanVel: [0, 0, 0], meanPos: [0, 0, 0], normal: [0, 2, 0], count: 3 },
    [0, 3, 0], [0, 0, 0], 0.5,
  );
  check('sheeter flattening removes the out-of-plane offset', vecNear(flat, [0, -1.5, 0]));
  // An in-plane offset produces NO pull (no in-plane redistribution).
  const inPlane = D.sheeterDeltaV(
    { rate: 0, sheetRate: 1 },
    { meanVel: [0, 0, 0], meanPos: [0, 0, 0], normal: [0, 1, 0], count: 3 },
    [3, 0, 0], [0, 0, 0], 0.5,
  );
  check('sheeter: in-plane offset yields no pull', isZero(inPlane));
  // A zero normal skips the flattening term.
  const noNormal = D.sheeterDeltaV(
    { rate: 0, sheetRate: 1 },
    { meanVel: [0, 0, 0], meanPos: [0, 0, 0], normal: [0, 0, 0], count: 3 },
    [0, 3, 0], [0, 0, 0], 0.5,
  );
  check('sheeter: zero normal skips flattening', isZero(noNormal));
  check('clampSheeterRate: range and non-finite',
    D.clampSheeterRate(-1) === 0 && D.clampSheeterRate(200) === 100
    && D.clampSheeterRate(0.5) === 0.5 && D.clampSheeterRate(Infinity) === 0);
}

// ---- (d) k daemons ------------------------------------------------------
{
  check('k parse: empty / malformed / non-array yield none',
    D.parseDaemonKillDefs('').length === 0
    && D.parseDaemonKillDefs('not json').length === 0
    && D.parseDaemonKillDefs('{"a":1}').length === 0
    && D.parseDaemonKillDefs(undefined).length === 0);
  const mixed = D.parseDaemonKillDefs('[1, null, {"pos":[1,2,3]}]');
  check('k parse: non-objects skipped, defaults filled',
    mixed.length === 1 && mixed[0].pos[0] === 1 && mixed[0].pos[1] === 2 && mixed[0].pos[2] === 3
    && mixed[0].radius === 60 && mixed[0].ageMin === 0 && mixed[0].ageMax === Infinity
    && mixed[0].densityMin === 0 && mixed[0].densityMax === Infinity);
  const authored = D.parseDaemonKillDefs(
    '[{"pos":[0,0,0],"radius":10,"ageMin":2,"ageMax":5,"densityMin":0.1,"densityMax":0.9}]',
  );
  check('k parse: authored values kept',
    authored.length === 1 && authored[0].radius === 10 && authored[0].ageMin === 2
    && authored[0].ageMax === 5 && authored[0].densityMin === 0.1 && authored[0].densityMax === 0.9);
  const many = D.parseDaemonKillDefs(JSON.stringify(Array.from({ length: 20 }, () => ({}))));
  check('k parse: list capped at DAEMON_KILL_MAX', many.length === D.DAEMON_KILL_MAX);

  const def = authored[0];
  const at = (pos, age, density) => D.daemonKillMatches(def, pos, { age, density });
  check('k match: inside region + ranges', at([0, 0, 0], 3, 0.5) === true);
  check('k match: range boundaries inclusive', at([0, 0, 0], 2, 0.1) === true && at([0, 0, 0], 5, 0.9) === true);
  check('k match: age outside', at([0, 0, 0], 1, 0.5) === false && at([0, 0, 0], 5.5, 0.5) === false);
  check('k match: density outside', at([0, 0, 0], 3, 0.05) === false && at([0, 0, 0], 3, 1) === false);
  check('k match: region boundary excluded', at([10, 0, 0], 3, 0.5) === false && at([9.9, 0, 0], 3, 0.5) === true);
  check('k match: non-finite sample never matches', at([0, 0, 0], NaN, 0.5) === false && at([0, 0, 0], 3, Infinity) === false);
  const open = D.parseDaemonKillDefs('[{"radius":10}]')[0];
  check('k match: open ends accept any age / density',
    D.daemonKillMatches(open, [0, 0, 0], { age: 10000, density: 10000 }) === true);
  check('k match: zero radius never matches',
    D.daemonKillMatches({ ...open, radius: 0 }, [0, 0, 0], { age: 0, density: 0 }) === false);
  check('k matchAny: second def matches',
    D.daemonKillMatchesAny([def, open], [0, 0, 0], { age: 100, density: 0.5 }) === true
    && D.daemonKillMatchesAny([def], [0, 0, 0], { age: 100, density: 0.5 }) === false);

  check('k serialize: empty list is null', D.serializeDaemonKillDefs([]) === null);
  const roundTrip = D.parseDaemonKillDefs(D.serializeDaemonKillDefs([def, open]));
  check('k round trip: parse → serialize → parse is stable',
    roundTrip.length === 2
    && roundTrip[0].radius === 10 && roundTrip[0].ageMin === 2 && roundTrip[0].ageMax === 5
    && roundTrip[0].densityMin === 0.1 && roundTrip[0].densityMax === 0.9
    && roundTrip[1].ageMax === Infinity && roundTrip[1].densityMax === Infinity);
}

if (failures > 0) {
  console.error(`layer1-wp5-daemon-laws: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`layer1-wp5-daemon-laws: ${checks}/${checks} checks passed`);
