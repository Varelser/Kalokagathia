#!/usr/bin/env node
// stage5-rep-two-phase.test.mjs — Limit plan stage 5,
// slice S5 follow-up: the GPU REP 2-phase wiring (分岐E).
// Materials: STAGE5_DECISIONS.md 分岐E,
// STAGE5_S5_CROSS_IMPL_RECORD.md (the handover this closes),
// STAGE5_CLOSEOUT.md. Model: lib/pipelineCross.ts
// resolveRepTwoPhase; wiring: components/sceneGpgpuSystem.tsx
// + components/gpgpuRuleEvalPass.ts.
//
// Pins:
// (a) designation resolution is a pure function whose
//     verdict agrees with the CPU twin's phase decision
//     (evaluatePipelineCrossStep) in every shape: designated
//     + live, no designation, row-list only (no graph),
//     timing form, designation on a baked-only rule, on a
//     disabled rule, on a rule absent from the effective
//     list, and over the predation-merged list;
// (b) the scene wiring: the designation is resolved from
//     the stored graph over the predation-merged rules, the
//     REP signature carries the designation (conditionally,
//     so undesignated signatures are unchanged), the REP
//     runs twice per evaluation only while designated, the
//     fracture readback sits after the second run, and the
//     predation hold pass still runs once per evaluation,
//     before the REP;
// (c) invariance: the designation changes neither the
//     compiled rules nor the generated fragment — only the
//     execution count.
//
// The WebGPU route is deliberately NOT pinned here: it
// stays snapshot-only and the designation surfaces there
// as the note 'cross-immediate-snapshot-fallback' (S5).
//
// Run: node scripts/stage5-rep-two-phase.test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const count = (src, needle) => src.split(needle).length - 1;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const X = await load('lib/pipelineCross.ts');
const C = await load('lib/pipelineCompiler.ts');
const P = await load('lib/gpgpuParticleRulesLive.ts');
const G = await load('lib/pipelineGraph.ts');
const PR = await load('lib/gpgpuPredation.ts');

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const graphOf = (nodes, edges = []) => G.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;
const box = (rule, extra = {}) => ({
  id: `box-${rule.id}`, kind: 'rule-box', label: rule.id, enabled: true,
  params: { rule, ...extra },
});

// The S5 cross pair: join-a writes the group state, observe-a
// reads it back (state == 1) and transitions to state 7.
const SG = { id: 'join-a', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'set-group', id: 'ga' } };
const OBS = { id: 'observe-a', enabled: true, target: { type: 'all' }, condition: 'state == 1', action: { type: 'set-state', state: 7 } };
const INPUT = { slots: [0, 0, 0, 0, 0, 0, 0, 0], vars: { vel: 0, age: 1, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6 } };
const RULES = P.resolveLiveParticleRules(JSON.stringify([SG, OBS]));

/** The twin's phase verdict for a graph + effective rules. */
const twinPhases = (graph, rules, opts = OPTS) => {
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  const classified = P.classifyLiveRules(rules, opts);
  return X.evaluatePipelineCrossStep(classified, INPUT, opts.groupDefs ?? [], compiled.immediateRuleIds).phases;
};

// ---- (a) resolution agrees with the twin -----------------------------------------
{
  const graphDes = graphOf([box(SG), box(OBS, { crossImmediate: true })]);
  const res = X.resolveRepTwoPhase(G.serializePipelineGraph(graphDes), RULES, OPTS);
  check('a1 designated + live resolves two-phase',
    res.twoPhase === true && sameJson(res.immediateRuleIds, ['observe-a'])
    && sameJson(res.liveImmediateRuleIds, ['observe-a']));
  check('a2 twin agrees (2 phases)', twinPhases(graphDes, RULES) === 2 && res.twoPhase === (twinPhases(graphDes, RULES) === 2));

  const graphTiming = graphOf([box(SG), box(OBS, { timing: 'immediate' })]);
  check('a3 timing form resolves two-phase',
    X.resolveRepTwoPhase(G.serializePipelineGraph(graphTiming), RULES, OPTS).twoPhase === true
    && twinPhases(graphTiming, RULES) === 2);

  const graphPlain = graphOf([box(SG), box(OBS)]);
  const resPlain = X.resolveRepTwoPhase(G.serializePipelineGraph(graphPlain), RULES, OPTS);
  check('a4 no designation = one phase, twin agrees',
    resPlain.twoPhase === false && resPlain.immediateRuleIds.length === 0
    && twinPhases(graphPlain, RULES) === 1);

  check('a5 row-list only (empty graph text) designates nothing',
    X.resolveRepTwoPhase('', RULES, OPTS).twoPhase === false
    && X.resolveRepTwoPhase(undefined, RULES, OPTS).twoPhase === false
    && X.resolveRepTwoPhase(null, RULES, OPTS).immediateRuleIds.length === 0);
  check('a6 unparseable graph text designates nothing',
    X.resolveRepTwoPhase('{not json', RULES, OPTS).twoPhase === false);

  // Designation on a rule that is not in the effective list:
  // the intersection is over the effective (merged) list,
  // not over the graph's own compiled rules.
  const onlySg = P.resolveLiveParticleRules(JSON.stringify([SG]));
  const resAbsent = X.resolveRepTwoPhase(G.serializePipelineGraph(graphDes), onlySg, OPTS);
  check('a7 designation on an absent rule does not stand phase 2 up',
    resAbsent.twoPhase === false && sameJson(resAbsent.immediateRuleIds, ['observe-a'])
    && resAbsent.liveImmediateRuleIds.length === 0
    && twinPhases(graphDes, onlySg) === 1);

  // Designation on a baked-only rule (snapshot group target
  // classifies baked-fallback): no second phase.
  const snapDefs = [{ id: 'snap', name: 'S', source: { kind: 'snapshot', indicesB64: 'AAAAAA==' } }];
  const snapRule = { id: 'snap-rule', enabled: true, target: { type: 'group', id: 'snap' }, condition: '', action: { type: 'kill' } };
  const graphSnap = graphOf([box(snapRule, { crossImmediate: true })]);
  const snapOpts = { ...OPTS, groupDefs: snapDefs };
  const snapRules = P.resolveLiveParticleRules(JSON.stringify([snapRule]));
  const resSnap = X.resolveRepTwoPhase(G.serializePipelineGraph(graphSnap), snapRules, snapOpts);
  check('a8 designation on a baked-fallback rule does not stand phase 2 up',
    resSnap.twoPhase === false && resSnap.liveImmediateRuleIds.length === 0
    && twinPhases(graphSnap, snapRules, snapOpts) === 1);

  // Designation on a disabled rule: classification drops it.
  const obsOff = { ...OBS, enabled: false };
  const graphOff = graphOf([box(SG), box(obsOff, { crossImmediate: true })]);
  const offRules = P.resolveLiveParticleRules(JSON.stringify([SG, obsOff]));
  check('a9 designation on a disabled rule does not stand phase 2 up',
    X.resolveRepTwoPhase(G.serializePipelineGraph(graphOff), offRules, OPTS).twoPhase === false
    && twinPhases(graphOff, offRules) === 1);

  // Predation-merged list: the resolution runs over the
  // merged list the REP is built from. With predation off
  // the merged list is the user list; with it on, generated
  // rules ride after and the user designation still lands.
  const mergedOff = PR.resolveLiveRulesWithPredation({ gpgpuParticleRulesLive: JSON.stringify([SG, OBS]) });
  check('a10 merged list (predation off) resolves two-phase',
    sameJson(mergedOff.map((r) => r.id), ['join-a', 'observe-a'])
    && X.resolveRepTwoPhase(G.serializePipelineGraph(graphDes), mergedOff, OPTS).twoPhase === true);
  const mergedOn = PR.resolveLiveRulesWithPredation({
    gpgpuParticleRulesLive: JSON.stringify([SG, OBS]),
    gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'kill', gpgpuPredationBirth: true,
  });
  check('a11 merged list (predation on) keeps the designation live',
    mergedOn.length > mergedOff.length
    && X.resolveRepTwoPhase(G.serializePipelineGraph(graphDes), mergedOn, OPTS).twoPhase === true
    && twinPhases(graphDes, mergedOn) === 2);
}

// ---- (b) scene wiring pins ---------------------------------------------------------
{
  const scene = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  const pass = readFileSync(join(ROOT, 'components', 'gpgpuRuleEvalPass.ts'), 'utf8');
  const cross = readFileSync(join(ROOT, 'lib', 'pipelineCross.ts'), 'utf8');

  check('b1 scene imports and calls the pure resolution',
    scene.includes("from '../lib/pipelineCross'")
    && scene.includes('resolveRepTwoPhase(config.gpgpuPipelineGraph, ruleLiveRules,'));
  check('b2 the REP fragment is built from the same merged list the resolution reads',
    scene.includes('const ruleLiveRules = resolveLiveRulesWithPredation(config);')
    && scene.includes('buildRuleEvalFragment(\n    ruleLiveRules,'));
  check('b3 the signature carries the designation, conditionally (undesignated = legacy string)',
    scene.includes("${ruleLiveTwoPhase ? '|x2' : ''}"));

  const runNeedle = 'ruleEvalPass.run(glCtx, ruleEvalBindings)';
  const firstRun = scene.indexOf(runNeedle);
  const secondRun = scene.indexOf(runNeedle, firstRun + 1);
  check('b4 the REP run is called exactly twice, both over the shared bindings',
    count(scene, runNeedle) === 2 && firstRun >= 0 && secondRun > firstRun
    && scene.includes('const ruleEvalBindings = {'));
  const gateIdx = scene.indexOf('if (ruleLiveTwoPhase) {', firstRun);
  check('b5 the second run is gated on the designation, after the first run',
    gateIdx > firstRun && gateIdx < secondRun);

  const noteIdx = scene.indexOf('runtime.noteLiveFractureMask', secondRun);
  const readbackIdx = scene.indexOf('glCtx.readRenderTargetPixels(', secondRun);
  check('b6 the fracture readback reads the final target, after the second run',
    readbackIdx > secondRun && noteIdx > readbackIdx
    && scene.slice(secondRun, noteIdx).includes('ruleEvalPass.currentTarget'));

  check('b7 the hold pass still accumulates once per evaluation, before the REP',
    count(scene, 'predHoldPassRef.current.run(') === 1
    && scene.indexOf('predHoldPassRef.current.run(') < firstRun
    && scene.slice(gateIdx, secondRun).includes('NOT run again'));

  check('b8 the pass documents the two-run parity',
    pass.includes('Two-phase evaluations') && pass.includes('ping-pong parity')
    && pass.includes("the SECOND run's target"));
  check('b9 the cross header records the wiring as done (handover closed)',
    !cross.includes('deliberately NOT done')
    && cross.includes('wired into the WebGL GPU REP')
    && cross.includes('The WebGPU route is NOT 2-phased'));
}

// ---- (c) invariance: only the execution count changes ------------------------------
{
  const graphDes = graphOf([box(SG), box(OBS, { crossImmediate: true })]);
  const graphPlain = graphOf([box(SG), box(OBS)]);
  const rulesDes = C.compilePipelineGraphToLiveRules(graphDes).rules;
  const rulesPlain = C.compilePipelineGraphToLiveRules(graphPlain).rules;
  check('c1 the designation does not alter the compiled rules',
    sameJson(rulesDes, rulesPlain));
  const fragDes = P.buildRuleEvalFragment(rulesDes, OPTS);
  const fragPlain = P.buildRuleEvalFragment(rulesPlain, OPTS);
  const fragRows = P.buildRuleEvalFragment(RULES, OPTS);
  check('c2 the generated fragment is identical with and without the designation',
    fragDes !== null && fragDes === fragPlain && fragDes === fragRows);
  check('c3 the WGSL twin is likewise untouched by the designation',
    P.buildRuleEvalWgsl(rulesDes, OPTS) === P.buildRuleEvalWgsl(rulesPlain, OPTS));
}

console.log(`stage5-rep-two-phase: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
