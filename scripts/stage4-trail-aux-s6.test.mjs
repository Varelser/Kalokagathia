#!/usr/bin/env node
// stage4-trail-aux-s6.test.mjs — Limit plan stage 4, slice S6:
// the trail mechanism change (Aux-type trail). Design:
// kalokagathia-pro/STAGE4_DESIGN_MATERIALS.md §4 (案A) / §0,
// STAGE4_PREP_INVENTORY.md §4 / §5. CPU twins and semantics:
// lib/trailAux.ts; the GLSL twin is the mode-6 branch of the
// Aux event chunk (components/gpgpuShaderAux.ts).
//
// Pins:
// (a) at the defaults (gpgpuTrailMode 'history') the Aux
//     vel/pos/inherit assembled strings are the pre-slice
//     strings byte-for-byte (sha256 pins measured pre-slice),
//     no trail text exists in any stock or other-variant
//     string, and the trail variant adds exactly one mode-6
//     branch to each of the three builders;
// (b) the flow accounting (interval / rate / pool cap): the
//     steady-state demand, capacity, drop rate and alive
//     counts follow the design's three control points;
// (c) the parent resolution: slot -> parent is the chunk
//     arithmetic's candidate 0 (the sparkTrail mapping),
//     emit ticks follow the slot phase, and the life
//     resolution (explicit wins, else derived from
//     gpgpuTrailLength) matches the design formula;
// (d) wiring: in 'aux' mode the history ring is not built
//     (empty trailRTs), the history draws close, the Aux
//     passes run at gpgpuAuxMode 'none', and the Aux pool's
//     point draw mounts — all read as source pins, since the
//     React / three.js runtime is out of this suite's reach.
//     The real-GPU gate G4-5 judgement (80% on-trajectory
//     presence etc.) is out of this slice by design.
//
// Run: node scripts/stage4-trail-aux-s6.test.mjs

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const T = await load('lib/trailAux.ts');
const AUX = await load('components/gpgpuShaderAux.ts');
const PLANS = await load('lib/sceneRenderRoutingPlans.ts');

// ---- (a) default identity --------------------------------
check('stock AUX_VEL_FRAG is the pre-slice string',
  sha256(AUX.AUX_VEL_FRAG) === '9bdf0c431b4330df19bfb24aa96016e6b5d312fd13c5105cc960b56c2df1653e');
check('stock AUX_POS_FRAG is the pre-slice string',
  sha256(AUX.AUX_POS_FRAG) === 'cfe2304d5b8aa3958fb975c8e35f4aa882cbe7a518e2ed096bc59c238aebab3b');
check('stock AUX_INHERIT_FRAG is the pre-slice string',
  sha256(AUX.AUX_INHERIT_FRAG) === '5556a8cfb29febe9bde7c6268308d5b7de73b3d39e08ed50d7a51fe3bd054383');
check('default builders return the stock strings',
  AUX.buildAuxVelFrag() === AUX.AUX_VEL_FRAG
  && AUX.buildAuxPosFrag() === AUX.AUX_POS_FRAG
  && AUX.buildAuxInheritFrag() === AUX.AUX_INHERIT_FRAG);
check('no trail text in stock or other-variant strings',
  !AUX.AUX_VEL_FRAG.includes('uTrailEmit')
  && !AUX.buildAuxVelFrag({ emit: true }).includes('uTrailEmit')
  && !AUX.buildAuxPosFrag({ ruleSpawn: true }).includes('uTrailEmit')
  && !AUX.buildAuxInheritFrag({ sdfSplash: true }).includes('uTrailEmit'));
const trailVel = AUX.buildAuxVelFrag({ trail: true });
const trailPos = AUX.buildAuxPosFrag({ trail: true });
const trailInh = AUX.buildAuxInheritFrag({ trail: true });
check('trail variant adds exactly one mode-6 branch per builder',
  (trailVel.match(/uAuxMode == 6/g) || []).length === 1
  && (trailPos.match(/uAuxMode == 6/g) || []).length === 1
  && (trailInh.match(/uAuxMode == 6/g) || []).length === 1);
check('trail variant declares both emit uniforms in all three builders',
  trailVel.includes('uniform float uTrailEmitInterval;')
  && trailVel.includes('uniform float uTrailEmitRate;')
  && trailPos.includes('uniform float uTrailEmitInterval;')
  && trailInh.includes('uniform float uTrailEmitInterval;'));
check('trail branch sheds candidate 0 only, with the sparkTrail velocity coefficient',
  trailVel.includes('if (s == 0)')
  && trailVel.includes('gAuxSpawnVel = mVel.xyz * 0.15;'));
check('trail mode id is 6', T.TRAIL_AUX_MODE_ID === 6);
check('mode resolution: only the exact value aux selects aux',
  T.resolveTrailMode({ gpgpuTrailMode: 'aux' }) === 'aux'
  && T.resolveTrailMode({ gpgpuTrailMode: 'history' }) === 'history'
  && T.resolveTrailMode({ gpgpuTrailMode: 'bogus' }) === 'history');
check('activity predicate needs the trail enabled AND aux mode',
  T.trailAuxActive({ gpgpuTrailEnabled: true, gpgpuTrailMode: 'aux' }) === true
  && T.trailAuxActive({ gpgpuTrailEnabled: false, gpgpuTrailMode: 'aux' }) === false
  && T.trailAuxActive({ gpgpuTrailEnabled: true, gpgpuTrailMode: 'history' }) === false);

// ---- (b) flow accounting ---------------------------------
// Defaults-shaped case: 16384 main, 4096 aux, interval 2,
// rate 1, derived life for length 8 = 8*2/60 = 0.2667 s.
// Spawn period 2/60 = 0.0333 s << life, so slots saturate:
// alive per parent = 1, drop = 1 - period/life = 0.875.
const life8 = T.resolveTrailAuxLifeSeconds({ gpgpuTrailAuxLife: 0, gpgpuTrailLength: 8, gpgpuTrailEmitInterval: 2 });
check('derived life for length 8 / interval 2 is 16/60 s', approx(life8, 16 / 60, 1e-12));
const flowSat = T.trailAuxFlow({ mainCount: 16384, auxCount: 4096, interval: 2, rate: 1, lifeSeconds: life8 });
check('flow: covered parents are min(main, aux)', flowSat.coveredParents === 4096);
check('flow: saturated pool holds exactly one point per parent',
  approx(flowSat.pointsPerParent, 1) && approx(flowSat.aliveSteady, 4096));
check('flow: saturated drop rate is 1 - period/life',
  approx(flowSat.dropRate, 1 - (2 / 60) / life8));
check('flow: spawn period is interval / (60 * rate)',
  approx(flowSat.spawnPeriodSeconds, 2 / 60));
// Unsaturated case: life shorter than the period — every
// emit tick lands, drop 0, alive = demand * life.
const flowFree = T.trailAuxFlow({ mainCount: 1000, auxCount: 1000, interval: 30, rate: 1, lifeSeconds: 0.25 });
check('flow: unsaturated case drops nothing', flowFree.dropRate === 0);
check('flow: unsaturated alive is demand * life',
  approx(flowFree.aliveSteady, 1000 * (60 / 30) * 0.25) && approx(flowFree.pointsPerParent, 0.5));
// Rate halves demand and doubles the period.
const flowHalf = T.trailAuxFlow({ mainCount: 500, auxCount: 500, interval: 2, rate: 0.5, lifeSeconds: 0.01 });
check('flow: rate scales demand and period',
  approx(flowHalf.demandPerSecond, 500 * 30 * 0.5) && approx(flowHalf.spawnPeriodSeconds, 2 / 30));
// Pool larger than the population: coverage caps at main.
check('flow: coverage caps at the main population',
  T.trailAuxFlow({ mainCount: 100, auxCount: 4096, interval: 2, rate: 1, lifeSeconds: 1 }).coveredParents === 100);
// Degenerate inputs never produce flow.
check('flow: zero rate / zero life / empty pool produce no flow',
  T.trailAuxFlow({ mainCount: 100, auxCount: 100, interval: 2, rate: 0, lifeSeconds: 1 }).spawnsPerSecond === 0
  && T.trailAuxFlow({ mainCount: 100, auxCount: 100, interval: 2, rate: 1, lifeSeconds: 0 }).spawnsPerSecond === 0
  && T.trailAuxFlow({ mainCount: 0, auxCount: 100, interval: 2, rate: 1, lifeSeconds: 1 }).coveredParents === 0);
check('interval and rate resolution clamps',
  T.resolveTrailEmitInterval(0) === 1 && T.resolveTrailEmitInterval(999) === 240
  && T.resolveTrailEmitInterval(2.6) === 3 && T.resolveTrailEmitInterval(NaN) === 2
  && T.resolveTrailEmitRate(-1) === 0 && T.resolveTrailEmitRate(2) === 1 && T.resolveTrailEmitRate(NaN) === 1);

// ---- (c) parent resolution and inheritance ---------------
// Chunk arithmetic: main 16384, aux 4096 -> chunk 4, so
// slot s watches parent 4s (candidate 0 of its chunk).
check('parent of slot s is chunk * s (candidate 0)',
  T.trailAuxParentIndex(0, 16384, 4096) === 0
  && T.trailAuxParentIndex(1, 16384, 4096) === 4
  && T.trailAuxParentIndex(4095, 16384, 4096) === 16380);
check('parent mapping is a bijection onto the chunk starts',
  (() => {
    const seen = new Set();
    for (let s = 0; s < 4096; s++) seen.add(T.trailAuxParentIndex(s, 16384, 4096));
    return seen.size === 4096 && [...seen].every((p) => p % 4 === 0);
  })());
check('pool larger than the population wraps by mod',
  T.trailAuxParentIndex(5, 4, 16) === 1 && T.trailAuxParentIndex(4, 4, 16) === 0);
check('equal pools map slot to itself',
  T.trailAuxParentIndex(7, 100, 100) === 7);
check('degenerate parent inputs resolve to -1',
  T.trailAuxParentIndex(0, 0, 10) === -1 && T.trailAuxParentIndex(-1, 10, 10) === -1);
// Emit ticks: slot phase = slot mod interval; a slot fires
// exactly on (tick - phase) mod interval == 0.
check('slot phases stagger the emit ticks',
  T.trailSlotPhase(0, 2) === 0 && T.trailSlotPhase(1, 2) === 1 && T.trailSlotPhase(5, 2) === 1);
check('emit tick test follows the phase',
  T.isTrailEmitTick(4, 0, 2) === true && T.isTrailEmitTick(4, 1, 2) === false
  && T.isTrailEmitTick(5, 1, 2) === true && T.isTrailEmitTick(0, 3, 4) === false
  && T.isTrailEmitTick(3, 3, 4) === true);
check('over one period each slot fires exactly once',
  (() => {
    for (const iv of [1, 2, 3, 7]) {
      for (let s = 0; s < 50; s++) {
        let n = 0;
        for (let t = 0; t < iv; t++) if (T.isTrailEmitTick(t, s, iv)) n += 1;
        if (n !== 1) return false;
      }
    }
    return true;
  })());
// Life resolution: explicit wins; derived follows
// length * interval / 60 with the history clamps.
check('explicit life wins and clamps',
  T.resolveTrailAuxLifeSeconds({ gpgpuTrailAuxLife: 2, gpgpuTrailLength: 8, gpgpuTrailEmitInterval: 2 }) === 2
  && T.resolveTrailAuxLifeSeconds({ gpgpuTrailAuxLife: 999, gpgpuTrailLength: 8, gpgpuTrailEmitInterval: 2 }) === 60);
check('derived life follows length * interval / 60',
  approx(T.resolveTrailAuxLifeSeconds({ gpgpuTrailAuxLife: 0, gpgpuTrailLength: 16, gpgpuTrailEmitInterval: 1 }), 16 / 60, 1e-12)
  && approx(T.resolveTrailAuxLifeSeconds({ gpgpuTrailAuxLife: 0, gpgpuTrailLength: 2, gpgpuTrailEmitInterval: 4 }), 8 / 60, 1e-12));
// History memory accounting: 16 RTs of texSize^2 RGBA float.
check('history ring bytes at texSize 256 are 16 MiB',
  T.trailHistoryBytes(256) === 16 * 256 * 256 * 16 && T.trailHistoryBytes(256) === 16777216
  && T.TRAIL_HISTORY_RT_COUNT === 16);

// ---- (d) wiring pins --------------------------------------
const routeCfg = (over) => ({
  gpgpuTrailEnabled: true, gpgpuTrailMode: 'history',
  gpgpuRibbonEnabled: true, gpgpuTubeEnabled: true, ...over,
});
const routeOn = { enabled: true, resolvedEngine: 'webgl-gpgpu' };
check('history mode keeps the legacy render plan predicates',
  PLANS.doesGpgpuRouteRenderTrailPoints(routeOn, routeCfg({})) === true
  && PLANS.doesGpgpuRouteRenderRibbons(routeOn, routeCfg({})) === true
  && PLANS.doesGpgpuRouteRenderTubes(routeOn, routeCfg({})) === true);
check('aux mode closes all three history draws',
  PLANS.doesGpgpuRouteRenderTrailPoints(routeOn, routeCfg({ gpgpuTrailMode: 'aux' })) === false
  && PLANS.doesGpgpuRouteRenderRibbons(routeOn, routeCfg({ gpgpuTrailMode: 'aux' })) === false
  && PLANS.doesGpgpuRouteRenderTubes(routeOn, routeCfg({ gpgpuTrailMode: 'aux' })) === false);
const trailAssetsSrc = read('components/useGpgpuTrailAssets.ts');
check('history ring is built only outside aux mode (empty array in aux mode)',
  trailAssetsSrc.includes('auxTrail ? [] : Array.from({ length: MAX_TRAIL }, () => makeRT(texSize))')
  && trailAssetsSrc.includes('const auxTrail = trailAuxActive(config);'));
const visualSrc = read('components/gpgpuVisualUpdates.ts');
check('history recording and uniform sync skip an empty ring',
  visualSrc.includes('if (trailRTs.length === 0) return;')
  && visualSrc.includes('if (config.gpgpuTrailEnabled && trailRTs.length > 0)')
  && visualSrc.includes('if (config.gpgpuRibbonEnabled && trailRTs.length > 0)')
  && visualSrc.includes('if (config.gpgpuTubeEnabled && trailRTs.length > 0)'));
const passesSrc = read('components/gpgpuSimulationPasses.ts');
check('passes run at auxMode none while trail-driven, with mode id 6 and the resolved trail life',
  passesSrc.includes("if (config.gpgpuAuxMode === 'none' && !trailDriven) return;")
  && passesSrc.includes("? TRAIL_AUX_MODE_ID\n    : (AUX_MODE_IDS[config.gpgpuAuxMode] ?? 0);")
  && passesSrc.includes('velU.uAuxLife.value = trailDriven ? resolveTrailAuxLifeSeconds(config) : config.gpgpuAuxLife;')
  && passesSrc.includes('velU.uTrailEmitInterval.value = resolveTrailEmitInterval(config.gpgpuTrailEmitInterval);'));
const sceneSrc = read('components/sceneGpgpuSystem.tsx');
check('scene runs the Aux block while trail-driven at auxMode none',
  sceneSrc.includes("(config.gpgpuAuxMode !== 'none' || trailAuxActive(config)) && auxRtRef.current"));
const outputsSrc = read('components/gpgpuRenderOutputs.tsx');
check('the Aux pool point draw mounts while trail-driven (the trail draw)',
  outputsSrc.includes("(config.gpgpuAuxMode !== 'none' || trailAuxActive(config)) && ("));
const assetsSrc = read('components/useGpgpuSimulationAssets.ts');
check('simulation assets follow the trail variant and own the emit uniforms',
  assetsSrc.includes('trail: trailAuxActive(config)')
  && assetsSrc.includes('uTrailEmitInterval: { value: 2 }')
  && assetsSrc.includes('config.gpgpuTrailEnabled, config.gpgpuTrailMode,'));

// ── Trail A/B minimisations (stage-4 gate fix round 6,
// STAGE4_FIX11_AUX_AB_RECORD): diag-only branch variants.
// The stock trail builds must be untouched: 'A' (and the
// option's absence) reproduces them byte-for-byte in all
// three builders, the option is inert without `trail`, and
// each B stage changes exactly the trail branch — marker
// present, exactly one mode-6 branch, and the stage's own
// removed element absent from the branch vocabulary.
check('trailAb A reproduces the stock trail builds byte-for-byte',
  AUX.buildAuxVelFrag({ trail: true, trailAb: 'A' }) === trailVel
  && AUX.buildAuxPosFrag({ trail: true, trailAb: 'A' }) === trailPos
  && AUX.buildAuxInheritFrag({ trail: true, trailAb: 'A' }) === trailInh);
check('trailAb is inert without the trail variant',
  AUX.buildAuxVelFrag({ trailAb: 'B1' }) === AUX.AUX_VEL_FRAG
  && AUX.buildAuxPosFrag({ trailAb: 'B1' }) === AUX.AUX_POS_FRAG
  && AUX.buildAuxInheritFrag({ trailAb: 'B1' }) === AUX.AUX_INHERIT_FRAG);
check('AUX_TRAIL_AB_STAGES lists A and B1..B6',
  Array.isArray(AUX.AUX_TRAIL_AB_STAGES)
  && AUX.AUX_TRAIL_AB_STAGES.join(',') === 'A,B1,B2,B3,B4,B5,B6');
for (const stage of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
  const v = AUX.buildAuxVelFrag({ trail: true, trailAb: stage });
  const p = AUX.buildAuxPosFrag({ trail: true, trailAb: stage });
  const i = AUX.buildAuxInheritFrag({ trail: true, trailAb: stage });
  check(`trailAb ${stage} minimises all three builders with its marker`,
    v !== trailVel && p !== trailPos && i !== trailInh
    && v.includes(`aux-trail-ab-stage: ${stage}`)
    && p.includes(`aux-trail-ab-stage: ${stage}`)
    && i.includes(`aux-trail-ab-stage: ${stage}`)
    && (v.match(/uAuxMode == 6/g) || []).length === 1);
}
{
  const b1 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B1' });
  const b2 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B2' });
  const b3 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B3' });
  const b4 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B4' });
  const b5 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B5' });
  const b6 = AUX.buildAuxVelFrag({ trail: true, trailAb: 'B6' });
  check('trailAb B1 removes every condition (force-fire)',
    !b1.includes('trailTick') && !b1.includes('trailAlive') && !b1.includes('clamp(uTrailEmitRate'));
  check('trailAb B2 keeps only the tick phase',
    b2.includes('trailTick') && !b2.includes('trailAlive') && !b2.includes('clamp(uTrailEmitRate'));
  check('trailAb B3 keeps only the gate',
    !b3.includes('trailTick') && !b3.includes('trailAlive') && b3.includes('clamp(uTrailEmitRate'));
  check('trailAb B4 keeps only parent aliveness',
    !b4.includes('trailTick') && b4.includes('trailAlive') && !b4.includes('clamp(uTrailEmitRate'));
  check('trailAb B5 keeps the stock conditions with a constant spawn velocity',
    b5.includes('trailTick') && b5.includes('trailAlive') && b5.includes('clamp(uTrailEmitRate')
    && b5.includes('gAuxSpawnVel = vec3(0.0);'));
  check('trailAb B6 reformulates the tick phase as a positive-safe double-mod',
    b6.includes('trailPhaseMod + trailInterval') && b6.includes('trailAlive') && b6.includes('clamp(uTrailEmitRate'));
}
check('trailAb wiring: assets register the applier and rebuild with the stage, scene exposes the diag switch',
  assetsSrc.includes('registerAuxTrailAbApplier')
  && assetsSrc.includes('noteAuxTrailAbApplied')
  && assetsSrc.includes('trail, trailAb })')
  && sceneSrc.includes('setAuxTrailAbStage')
  && sceneSrc.includes('captureAuxTrailAbInfo')
  && sceneSrc.includes('requestAuxTrailAbStage'));

// ── FIX13 (stage-4 gate fix round 8,
// STAGE4_FIX13_RCP_MOD_RECORD): the stock trail phase
// test is boundary-avoiding — mod(tick - auxIdx + 0.5,
// interval) < 1.0 — because the original two-step form
// fed exact multiples of a non-power-of-2 interval into
// mod(), which the ANGLE/Metal fast reciprocal evaluates
// as the interval itself (gate phase 8 measured the
// declared phase column [0,1,2,3,4,5,6,1] and a
// permanently false test in steady state). The FIX11 A/B
// minimisations above keep the original form verbatim:
// they are diag-only triage instruments, not the product
// path. Equivalence with the CPU twin is pinned in exact
// arithmetic below (the GPU-side robustness itself is
// what the real-GPU gate re-measures).
check('FIX13: stock trail branch uses the boundary-avoiding phase test in all three builders',
  trailVel.includes('mod(tick - auxIdx + 0.5, trailInterval) < 1.0')
  && trailPos.includes('mod(tick - auxIdx + 0.5, trailInterval) < 1.0')
  && trailInh.includes('mod(tick - auxIdx + 0.5, trailInterval) < 1.0')
  && !trailVel.includes('float trailPhase = mod(auxIdx, trailInterval);')
  && !trailPos.includes('float trailPhase = mod(auxIdx, trailInterval);')
  && !trailInh.includes('float trailPhase = mod(auxIdx, trailInterval);'));
check('FIX13: the aux / whitewater / fluid initialisation copies all copy verbatim (NoBlending)',
  (() => {
    const runtimeSrc = read('components/useGpgpuRuntime.ts');
    return runtimeSrc.includes('auxCopyMat.blending = THREE.NoBlending;')
      && runtimeSrc.includes('wwCopyMat.blending = THREE.NoBlending;')
      && runtimeSrc.includes('fluidCopyMat.blending = THREE.NoBlending;');
  })());
check('FIX13: boundary-avoiding phase test and phase declaration are exactly equivalent to the CPU twin',
  (() => {
    const modp = (x, n) => ((x % n) + n) % n;
    for (const iv of [1, 2, 3, 4, 5, 6, 7, 30, 240]) {
      for (let s = 0; s < 512; s++) {
        if (modp(s + 0.5, iv) - 0.5 !== s % iv) return false;
        for (let t = -120; t < 600; t++) {
          if ((modp(t - s + 0.5, iv) < 1.0) !== T.isTrailEmitTick(t, s, iv)) return false;
        }
      }
    }
    return true;
  })());

// ── Tick probe + GPU uniform read (stage-4 gate fix
// round 7, STAGE4_FIX12_AUX_GPU_PROBE_RECORD): diag-only.
// The probe fragment is the source material's own string
// up to its main, with only the output replaced by the
// tick declaration; the state module arms one side at a
// time and keeps the samples per side.
{
  const probeVel = AUX.buildAuxTickProbeFrag(trailVel);
  const probePos = AUX.buildAuxTickProbeFrag(trailPos);
  const cutVel = trailVel.lastIndexOf('void main()');
  check('tick probe builds from the trail vel/pos strings with the source prefix verbatim',
    typeof probeVel === 'string' && typeof probePos === 'string'
    && probeVel.startsWith(trailVel.slice(0, cutVel))
    && probePos.startsWith(trailPos.slice(0, trailPos.lastIndexOf('void main()')))
    && (probeVel.match(/void main\(\)/g) || []).length === 1);
  // FIX13 (fix round 8) updated the declared expressions
  // to the boundary-avoiding phrasing, mirroring the stock
  // branch; the pre-FIX13 pins named the original two-step
  // form whose failure this probe exposed in gate phase 8.
  check('tick probe main declares the trail tick expressions verbatim and never calls the event test',
    probeVel.includes('aux-tick-probe')
    && probeVel.includes('float tick = floor(uTime * 60.0);')
    && probeVel.includes('float trailPhase = mod(auxIdx + 0.5, trailInterval) - 0.5;')
    && probeVel.includes('mod(tick - auxIdx + 0.5, trailInterval) < 1.0')
    && probeVel.includes('gl_FragColor = vec4(tick, trailPhase, trailTick, uTrailEmitInterval);')
    && !probeVel.slice(cutVel).includes('findAuxEvent('));
  check('tick probe refuses a fragment without the trail interval uniform or without a main',
    AUX.buildAuxTickProbeFrag(AUX.AUX_VEL_FRAG) === null
    && AUX.buildAuxTickProbeFrag('uniform float uTrailEmitInterval;') === null);
}
const TPD = await load('lib/auxTickProbeDiag.ts');
{
  const s0 = TPD.getAuxTickProbeState();
  check('tick probe state starts unarmed with no samples',
    s0.armedSide === null && s0.velSample === null && s0.posSample === null);
  TPD.armAuxTickProbe('vel');
  check('tick probe arms one side', TPD.auxTickProbeArmedSide() === 'vel');
  TPD.noteAuxTickProbeSample('vel', [[12, 0, 1, 6], [12, 1, 0, 6]], 0.2, 30, 29);
  const s1 = TPD.getAuxTickProbeState();
  check('tick probe sample lands per side and disarms only its own side',
    s1.armedSide === null
    && s1.velSample !== null && s1.velSample.texels.length === 2
    && s1.velSample.texels[0][0] === 12 && s1.velSample.time === 0.2
    && s1.velSample.velRenders === 30 && s1.posSample === null);
  check('tick probe state reads are copies (mutation does not leak into the store)',
    (() => { const c = TPD.getAuxTickProbeState(); c.velSample.texels[0][0] = -1; return TPD.getAuxTickProbeState().velSample.texels[0][0] === 12; })());
}
check('tick probe wiring: runner renders the armed side into its own target, scene exposes both diag entries',
  passesSrc.includes('auxTickProbeArmedSide')
  && passesSrc.includes('buildAuxTickProbeFrag')
  && passesSrc.includes('noteAuxTickProbeSample')
  && passesSrc.includes('mat.uniforms = src.uniforms')
  && sceneSrc.includes('captureAuxProgramUniforms')
  && sceneSrc.includes('captureAuxTickProbeStats')
  && sceneSrc.includes('getUniform')
  && sceneSrc.includes('armAuxTickProbe'));

console.log(`stage4-trail-aux-s6: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
