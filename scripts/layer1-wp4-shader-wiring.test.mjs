#!/usr/bin/env node
// layer1-wp4-shader-wiring.test.mjs — Layer 1 WP4 phase C:
// the shader realisation of phase A (lifetime jitter) and
// phase B (spawn event list + main-pool event demand).
//
// Phase A shipped the pure functions + the gpgpuAgeMaxJitter
// key; phase B shipped the event list grammar and the
// allocator's demand currency (lib/gpgpuSpawnAllocator.ts).
// Phase C wires both into the sim passes as string-level
// variants (the Phase 19 discipline — the default strings
// stay byte-identical):
//
//  - Age jitter: while the key is above zero, the position
//    fragment's age test reads the per-particle ceiling
//    uAgeMax * lifetimeMultiplier(vUv, uAgeMaxJitter), with
//    the GLSL twins of ageJitterHashForUv /
//    lifetimeMultiplierFromHash spliced in before main().
//  - Event demand: while an authored spawn event with a
//    positive demand stands, the spawn gate's threshold
//    expressions (both passes, stock and allocator forms)
//    gain the cumulative demand due at their time — resolved
//    CPU-side as pool fractions (spawnEventDemandDueBy over
//    the authored list) and uploaded as uSpawnEventDueFrac
//    (at uSpawnTime) / uSpawnEventDuePrevFrac (at
//    uSpawnTime - uDelta), so the activation test sees the
//    step exactly on the firing frame and a firing event
//    releases its demand of parked slots in gate-value
//    order (tier 1 of planSpawnEventDemands) as main-pool
//    event births, alongside the legacy cohort re-birth.
//
// Pins:
// (a) default byte-identity: the default builders return
//     the shipped strings, whose sha256 + length match the
//     phase18 baseline record; neither new uniform name
//     appears in any default string.
// (b) age-jitter variant: uniform + helpers spliced before
//     main(), the age test replaced, the legacy line gone;
//     the GLSL form's numbers equal the TS twins on a grid
//     (the hash1 composition IS the twin's argument).
// (c) event-demand variant: both passes gain the due term
//     in stock AND allocator forms; the emitter-velocity
//     activation segment follows when it also stands.
// (d) CPU resolvers: the authored list is the single event
//     in list form; the fraction at t equals
//     spawnEventDemandDueBy over the resolved list / pool,
//     stepping exactly at the event time; variant activity
//     needs an enabled event with a positive demand.
// (e) wiring: the assets resolve both variants (factories,
//     variant keys, swap effects + deps) and pre-declare
//     the uniform entries; the passes supply the values in
//     the spawn supply areas — and every demand supply sits
//     BEFORE the stage-6 liquid block in
//     gpgpuSimulationPasses.ts (that block is untouched).
//     (第45期統合: 液体は杉判断(c)で除外のため、液体ブロック
//     は存在せず、(e) の液体側チェックは不在の確認に反転
//     している。)
//
// Run: node scripts/layer1-wp4-shader-wiring.test.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp4c-bundle-${process.pid}.mjs`);

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const count = (s, needle) => s.split(needle).length - 1;

await build({
  stdin: {
    contents: `
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { lifetimeMultiplierForUv, ageJitterVariantActive, clampAgeMaxJitter } from './lib/gpgpuLifecycle.ts';
      export { dmHash11 } from './lib/gpgpuRandom.ts';
      export { authoredSpawnEventSpecs, authoredSpawnEventDemands, spawnEventDemandVariantActive, spawnEventDemandFracAt, resolveSpawnEventDemands, spawnEventDemandDueBy, planSpawnEventCohort } from './lib/gpgpuSpawnAllocator.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ── (a) default byte-identity ────────────────────────────
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  check('a SIM_POS_FRAG matches the phase18 pin (length + sha256)',
    M.SIM_POS_FRAG.length === baseline.parts.SIM_POS_FRAG.length
    && sha256(M.SIM_POS_FRAG) === baseline.parts.SIM_POS_FRAG.sha256);
  check('a SIM_VEL_FRAG matches the phase18 pin (length + sha256)',
    M.SIM_VEL_FRAG.length === baseline.parts.SIM_VEL_FRAG.length
    && sha256(M.SIM_VEL_FRAG) === baseline.parts.SIM_VEL_FRAG.sha256);
  check('a buildPositionFragment() is the shipped string', M.buildPositionFragment() === M.SIM_POS_FRAG);
  check('a buildPositionFragment({}) is the shipped string', M.buildPositionFragment({}) === M.SIM_POS_FRAG);
  check('a buildPositionFragment with both new options off is the shipped string',
    M.buildPositionFragment({ ageJitter: false, spawnEventDemand: false }) === M.SIM_POS_FRAG);
  check('a buildVelocityFragment(\'\') is the shipped string', M.buildVelocityFragment('') === M.SIM_VEL_FRAG);
  check('a buildVelocityFragment with the demand option off is the shipped string',
    M.buildVelocityFragment('', undefined, { spawnEventDemand: false }) === M.SIM_VEL_FRAG);
  check('a no new uniform name in the default position string',
    !M.SIM_POS_FRAG.includes('uAgeMaxJitter') && !M.SIM_POS_FRAG.includes('lifetimeMultiplier')
    && !M.SIM_POS_FRAG.includes('uSpawnEventDue'));
  check('a no new uniform name in the default velocity string',
    !M.SIM_VEL_FRAG.includes('uSpawnEventDue') && !M.SIM_VEL_FRAG.includes('uAgeMaxJitter'));
}

// ── (b) age-jitter variant ───────────────────────────────
{
  const frag = M.buildPositionFragment({ ageJitter: true });
  check('b jitter variant differs from the shipped string', frag !== M.SIM_POS_FRAG);
  check('b uAgeMaxJitter declared exactly once', count(frag, 'uniform float uAgeMaxJitter;') === 1);
  check('b ageJitterHash is the twin composition',
    frag.includes('float ageJitterHash(vec2 uv) {\n    return hash1(uv + vec2(11.31, 4.77));\n  }'));
  check('b lifetimeMultiplier body present',
    frag.includes('float lifetimeMultiplier(vec2 uv, float jitter) {\n    float j = clamp(jitter, 0.0, 1.0);\n    return 1.0 + (2.0 * ageJitterHash(uv) - 1.0) * j;\n  }'));
  check('b helpers land before main()',
    frag.indexOf('float lifetimeMultiplier') > -1 && frag.indexOf('float lifetimeMultiplier') < frag.indexOf('void main() {'));
  check('b age test reads the per-particle ceiling',
    frag.includes('if (age > uAgeMax * lifetimeMultiplier(vUv, uAgeMaxJitter)) ageRespawn = true;'));
  check('b legacy age line gone', !frag.includes('if (age > uAgeMax) ageRespawn = true;'));
  // The GLSL form evaluated in JS: hash1(p) is dmHash11 at
  // (p.x * 127.1 + p.y * 311.7), so the shader's
  // ageJitterHash(uv) is dmHash11 at the twin's argument.
  const glslMultiplier = (u, v, j) => {
    const h = M.dmHash11((u + 11.31) * 127.1 + (v + 4.77) * 311.7);
    const jj = Math.min(1, Math.max(0, j));
    return 1 + (2 * h - 1) * jj;
  };
  let allEqual = true;
  for (const u of [0.001, 0.125, 0.5, 0.999]) {
    for (const v of [0.003, 0.25, 0.75, 0.997]) {
      for (const j of [0, 0.25, 0.5, 1]) {
        if (M.lifetimeMultiplierForUv(u, v, j) !== glslMultiplier(u, v, j)) allEqual = false;
      }
    }
  }
  check('b GLSL form equals the TS twin on the uv x jitter grid', allEqual);
  check('b variant activity follows the clamped key',
    M.ageJitterVariantActive({ gpgpuAgeMaxJitter: 0 }) === false
    && M.ageJitterVariantActive({ gpgpuAgeMaxJitter: 0.25 }) === true
    && M.ageJitterVariantActive({ gpgpuAgeMaxJitter: -1 }) === false
    && M.ageJitterVariantActive({}) === false
    && M.ageJitterVariantActive({ gpgpuAgeMaxJitter: NaN }) === false);
  check('b clamp mirrors the passes supply clamp',
    M.clampAgeMaxJitter(2) === 1 && M.clampAgeMaxJitter(-0.5) === 0 && M.clampAgeMaxJitter(0.3) === 0.3);
}

// ── (c) event-demand variant strings ─────────────────────
{
  const posDemand = M.buildPositionFragment({ spawnEventDemand: true });
  check('c position demand: thrNow gains the due fraction',
    posDemand.includes('float thrNow = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime) + uSpawnEventDueFrac);'));
  check('c position demand: thrPrev gains the previous due fraction',
    posDemand.includes('float thrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta) + uSpawnEventDuePrevFrac);'));
  check('c position demand: legacy threshold lines gone',
    !posDemand.includes('float thrNow = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime));')
    && !posDemand.includes('float thrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta));'));
  check('c position demand: uniforms declared once each',
    count(posDemand, 'uniform float uSpawnEventDueFrac;') === 1
    && count(posDemand, 'uniform float uSpawnEventDuePrevFrac;') === 1);
  const posAllocDemand = M.buildPositionFragment({ spawnAlloc: true, spawnEventDemand: true });
  check('c position alloc+demand: thrNow composes over the allocator clock',
    posAllocDemand.includes('float thrNow = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockTime) + uSpawnEventDueFrac);'));
  check('c position alloc+demand: thrPrev composes over the allocator clock',
    posAllocDemand.includes('float thrPrev = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockPrev) + uSpawnEventDuePrevFrac);'));
  const posAlloc = M.buildPositionFragment({ spawnAlloc: true });
  check('c position alloc alone carries no demand term', !posAlloc.includes('uSpawnEventDue'));

  const velDemand = M.buildVelocityFragment('', undefined, { spawnEventDemand: true });
  check('c velocity demand: gate line gains the due fraction',
    velDemand.includes('float sThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime) + uSpawnEventDueFrac);'));
  check('c velocity demand: preamble declares the uniforms',
    count(velDemand, 'uniform float uSpawnEventDueFrac;') === 1
    && count(velDemand, 'uniform float uSpawnEventDuePrevFrac;') === 1);
  const velAllocDemand = M.buildVelocityFragment('', undefined, { spawnAlloc: true, spawnEventDemand: true });
  check('c velocity alloc+demand: gate line composes over the allocator clock',
    velAllocDemand.includes('float sThr = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockTime) + uSpawnEventDueFrac);'));
  const velEmitDemand = M.buildVelocityFragment('', undefined, { emitterVelocity: true, spawnEventDemand: true });
  check('c emitter-velocity + demand: activation thresholds gain both due fractions',
    velEmitDemand.includes('float eThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime) + uSpawnEventDueFrac);')
    && velEmitDemand.includes('float eThrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta) + uSpawnEventDuePrevFrac);'));
  const velEmit = M.buildVelocityFragment('', undefined, { emitterVelocity: true });
  check('c emitter-velocity alone carries no demand term', !velEmit.includes('uSpawnEventDue'));
}

// ── (d) CPU resolvers ────────────────────────────────────
{
  const off = { gpgpuSpawnEventEnabled: false, gpgpuSpawnEventTime: 2, gpgpuSpawnEventCount: 0.25 };
  const on = { gpgpuSpawnEventEnabled: true, gpgpuSpawnEventTime: 2, gpgpuSpawnEventCount: 0.25 };
  const zero = { gpgpuSpawnEventEnabled: true, gpgpuSpawnEventTime: 2, gpgpuSpawnEventCount: 0 };
  check('d authored specs: disabled authors nothing', M.authoredSpawnEventSpecs(off).length === 0);
  check('d authored specs: enabled authors the single event in list form',
    JSON.stringify(M.authoredSpawnEventSpecs(on)) === JSON.stringify([{ time: 2, count: 0.25 }]));
  check('d variant activity needs an enabled event with positive demand',
    M.spawnEventDemandVariantActive(off, 16) === false
    && M.spawnEventDemandVariantActive(zero, 16) === false
    && M.spawnEventDemandVariantActive(on, 16) === true);
  const cohort = M.planSpawnEventCohort(16, 0.25).length;
  check('d cohort is positive at texSize 16 / count 0.25', cohort > 0);
  check('d fraction is 0 before the event time',
    M.spawnEventDemandFracAt(on, 16, 0) === 0 && M.spawnEventDemandFracAt(on, 16, 1.999) === 0);
  check('d fraction steps to cohort / pool at the event time',
    M.spawnEventDemandFracAt(on, 16, 2) === cohort / 256
    && M.spawnEventDemandFracAt(on, 16, 100) === cohort / 256);
  check('d the step lands exactly on the firing frame',
    M.spawnEventDemandFracAt(on, 16, 2) - M.spawnEventDemandFracAt(on, 16, 2 - 1 / 60) === cohort / 256);
  let matchesDueBy = true;
  for (const t of [0, 0.5, 1.999, 2, 2.5, 10, 600]) {
    const expected = M.spawnEventDemandDueBy(M.resolveSpawnEventDemands([{ time: 2, count: 0.25 }], 16), t) / 256;
    if (M.spawnEventDemandFracAt(on, 16, t) !== expected) matchesDueBy = false;
  }
  check('d fraction equals spawnEventDemandDueBy / pool over the time sweep', matchesDueBy);
  check('d disabled config resolves to 0 at every time',
    M.spawnEventDemandFracAt(off, 16, 0) === 0 && M.spawnEventDemandFracAt(off, 16, 100) === 0);
  check('d authored demands resolve through the phase B list form',
    JSON.stringify(M.authoredSpawnEventDemands(on, 16))
    === JSON.stringify(M.resolveSpawnEventDemands([{ time: 2, count: 0.25 }], 16)));
}

// ── (e) wiring ───────────────────────────────────────────
{
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('e assets: velocity options resolve the demand variant',
    assets.includes('spawnEventDemand: spawnEventDemandVariantActive(config, texSize ?? 0),'));
  check('e assets: position factory + swap effect resolve both variants',
    count(assets, 'spawnEventDemand: spawnEventDemandVariantActive(config, texSize),') === 2
    && count(assets, 'ageJitter: ageJitterVariantActive(config),') === 2);
  check('e assets: variant keys carry both flags',
    assets.includes('${opts.spawnEventDemand ? 1 : 0}')
    && assets.includes('${spawnEventDemandVariantActive(c, texSize)}:${ageJitterVariantActive(c)}'));
  check('e assets: uniform entries pre-declared (due x2 materials, jitter x1)',
    count(assets, 'uSpawnEventDueFrac:') === 2 && count(assets, 'uSpawnEventDuePrevFrac:') === 2
    && count(assets, 'uAgeMaxJitter:') === 1);
  check('e assets: swap effects depend on the event + jitter keys',
    assets.includes('config.gpgpuSpawnEventEnabled, config.gpgpuSpawnEventTime, config.gpgpuSpawnEventCount, config.gpgpuAgeMaxJitter,')
    && assets.includes('config.gpgpuSpawnEventEnabled, config.gpgpuSpawnEventTime, config.gpgpuSpawnEventCount, config.gpgpuEmitterVelMode,'));
  check('e passes: imports the demand resolver + the jitter clamp',
    passes.includes("import { resolveSpawnRateEff, spawnEventDemandFracAt } from '../lib/gpgpuSpawnAllocator';")
    && passes.includes("import { clampAgeMaxJitter } from '../lib/gpgpuLifecycle';"));
  check('e passes: due fractions supplied for both passes, now + prev',
    count(passes, 'spawnEventDemandFracAt(config, texSize, args.spawnTime ?? time)') === 2
    && count(passes, 'spawnEventDemandFracAt(config, texSize, (args.spawnTime ?? time) - dt)') === 2);
  check('e passes: jitter supplied clamped next to uAgeMax',
    passes.includes('posSimMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;')
    && passes.includes('posSimMat.uniforms.uAgeMaxJitter.value = clampAgeMaxJitter(config.gpgpuAgeMaxJitter ?? 0);'));
  // 第45期統合: 液体は杉判断(c)で除外 — the stage-6 liquid
  // block is not part of this tree. The demand supplies stand
  // (checked above and below); the checks here pin the liquid
  // block's absence instead of its position/contents.
  const liquidStart = passes.indexOf('const liquidPass = args.liquidPass ?? null;');
  check('e passes: the demand supplies are present (spawnEventDemandFracAt / uAgeMaxJitter stand)',
    passes.lastIndexOf('spawnEventDemandFracAt') > -1
    && passes.lastIndexOf('uAgeMaxJitter') > -1);
  check('e passes: no stage-6 liquid block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    liquidStart === -1
    && !passes.includes('const plan = planLiquidSubsteps(dt, liquid);')
    && !passes.includes('liquidPass.run(gl, { posTex: posIn.texture, restDensity });'));
}

console.log(`layer1-wp4-shader-wiring: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
