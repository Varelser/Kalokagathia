#!/usr/bin/env node
// stage5-pipeline-cross-s5.test.mjs — Limit plan stage 5,
// slice S5: cross-group finish (分岐E) + WebGPU reasoned
// disabling (分岐F). Materials: STAGE5_DESIGN_MATERIALS.md
// §4, STAGE5_PREP_INVENTORY.md §6.2, STAGE5_DECISIONS.md
// 分岐E / 分岐F. Model: lib/pipelineCross.ts (+ the S5
// compiler additions in lib/pipelineCompiler.ts).
//
// Pins:
// (a) aggregate availability is the REAL supply: count /
//     fraction / mean / max over the CPU membership are
//     twin-computable; centroid is unavailable (no position
//     supply) and computes to null; no REP variable exists
//     for any of them (the compiler reports a wired
//     group-aggregate with reason 'group-aggregate-twin-only'
//     instead of silently ignoring the wire);
// (b) same-evaluation designation: graph params
//     (crossImmediate / timing 'immediate') survive compile
//     (immediateRuleIds) and the S3 persist round trip;
//     without a designation the cross step is exactly the
//     snapshot twin (1 phase);
// (c) the E4-b diagnostic quantity: with the cross pair
//     (set-group -> state-reading observer), the default
//     form first observes the transition at step 1 (one
//     evaluation late) and the designated form at step 0,
//     with 2 phases per step;
// (d) WebGPU disabling is reasoned and in lockstep with
//     the real route predicate (liveRulesWgslCoverable):
//     den / hit conditions, display / spawn consumers,
//     snapshot-group baked fallback, attr-dynamic slot
//     reads each disable their node with a structured code;
//     a coverable graph disables nothing; the cross
//     designation is a note, not a disable; the graph
//     always remains saveable (分岐F);
// (e) fracture (inventory §6.2 item ii remainder): the
//     palette offers it, an action node compiles to a
//     fracture rule, and the twin sets the fracture bit.
//
// Run: node scripts/stage5-pipeline-cross-s5.test.mjs

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
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
const PS = await load('lib/pipelinePersist.ts');
const CV = await load('lib/pipelineCanvas.ts');

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const graphOf = (nodes, edges = []) => G.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;
const box = (rule, extra = {}) => ({
  id: `box-${rule.id}`, kind: 'rule-box', label: rule.id, enabled: true,
  params: { rule, ...extra },
});

// ---- (a) group aggregates: the real supply --------------------------------------
{
  const defs = [{
    id: 'ga', name: 'A',
    source: { kind: 'predicate', predicate: { slot: 0, mode: 'above', low: 0.5, high: 1, invert: false } },
  }];
  const attr = new Float32Array([
    0.9, 0, 0, 0,
    0.2, 0, 0, 0,
    0.8, 0, 0, 0,
    0.1, 0, 0, 0,
  ]);
  check('a1 count is twin-computable', X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'count' }) === 2);
  check('a2 fraction', X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'fraction' }) === 0.5);
  check('a3 mean-slot', Math.abs(X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'mean-slot', slot: 0 }) - 0.85) < 1e-6);
  check('a4 max-slot', Math.abs(X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'max-slot', slot: 0 }) - 0.9) < 1e-6);
  check('a5 mean-var over caller rows', X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'mean-var', values: [10, 20, 30, 40] }) === 20);
  check('a6 max-var', X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'max-var', values: [10, 20, 30, 40] }) === 30);
  check('a7 centroid is unavailable and computes null',
    X.PIPELINE_GROUP_AGGREGATE_AVAILABILITY.centroid.status === 'unavailable'
    && X.computePipelineGroupAggregate(defs, 'ga', attr, 4, { kind: 'centroid' }) === null);
  check('a8 twin kinds are marked twin', X.PIPELINE_GROUP_AGGREGATE_AVAILABILITY.count.status === 'twin'
    && X.PIPELINE_GROUP_AGGREGATE_AVAILABILITY['mean-var'].status === 'twin');
  check('a9 unknown group computes null', X.computePipelineGroupAggregate(defs, 'nope', attr, 4, { kind: 'count' }) === null);
  const emptyDefs = [{
    id: 'ge', name: 'E',
    source: { kind: 'predicate', predicate: { slot: 0, mode: 'above', low: 0.95, high: 1, invert: false } },
  }];
  check('a10 empty group: count 0, mean null',
    X.computePipelineGroupAggregate(emptyDefs, 'ge', attr, 4, { kind: 'count' }) === 0
    && X.computePipelineGroupAggregate(emptyDefs, 'ge', attr, 4, { kind: 'mean-slot', slot: 0 }) === null);

  // A wired group-aggregate is reported, never silently ignored.
  const graph = graphOf([
    { id: 'gdef', kind: 'group-def', label: 'GA', enabled: true, params: { id: 'ga' } },
    { id: 'agg', kind: 'group-aggregate', label: 'Agg', enabled: true, params: {} },
    { id: 'act', kind: 'set-state', label: 'Act', enabled: true, params: { state: 2, ruleId: 'agg-rule' } },
  ], [
    { id: 'e1', from: 'gdef', to: 'agg', kind: 'data', fromPort: 'group', toPort: 'group' },
    { id: 'e2', from: 'agg', to: 'act', kind: 'data', fromPort: 'value', toPort: 'condition' },
  ]);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  check('a11 wired aggregate reported with reason',
    compiled.issues.some((i) => i.nodeId === 'agg' && i.reason === 'group-aggregate-twin-only'));
}

// ---- (b)+(c) cross timing: designation, twin contrast, diagnostic ----------------
const SG = { id: 'join-a', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'set-group', id: 'ga' } };
const OBS = { id: 'observe-a', enabled: true, target: { type: 'all' }, condition: 'state == 1', action: { type: 'set-state', state: 7 } };
const INPUT = { slots: [0, 0, 0, 0, 0, 0, 0, 0], vars: { vel: 0, age: 1, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6 } };
{
  check('b1 proxy state value of ga is 1', P.liveGroupStateValue([SG, OBS], 'ga') === 1);
  const classified = P.classifyLiveRules(P.resolveLiveParticleRules(JSON.stringify([SG, OBS])), OPTS);

  const plain = P.evaluateLiveRuleStep(classified, INPUT);
  const crossPlain = X.evaluatePipelineCrossStep(classified, INPUT, [], []);
  check('b2 no designation = exactly the snapshot twin, 1 phase',
    crossPlain.phases === 1 && sameJson(
      { mask: crossPlain.mask, state: crossPlain.state, matched: crossPlain.matched, display: crossPlain.display },
      { mask: plain.mask, state: plain.state, matched: plain.matched, display: plain.display }));

  const diagDefault = X.runPipelineCrossDiagnostic(classified, INPUT, [], 'observe-a', [], 3);
  check('c1 default form observes the transition one step late',
    diagDefault.firstObserverStep === 1 && diagDefault.steps.every((s) => s.phases === 1));
  check('c2 default step 0 matched only the set-group rule',
    sameJson(diagDefault.steps[0].matched, ['join-a']) && diagDefault.steps[0].state === 1);

  const diagImmediate = X.runPipelineCrossDiagnostic(classified, INPUT, [], 'observe-a', ['observe-a'], 3);
  check('c3 designated form observes the transition in the same step',
    diagImmediate.firstObserverStep === 0 && diagImmediate.steps[0].phases === 2
    && diagImmediate.steps[0].state === 7);

  const graph = graphOf([box(SG), box(OBS, { crossImmediate: true })]);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  check('b3 designation surfaces as immediateRuleIds',
    sameJson(compiled.immediateRuleIds, ['observe-a']));
  check('b4 ruleNodeIds are parallel to rules',
    compiled.ruleNodeIds.length === compiled.rules.length
    && compiled.ruleNodeIds[1] === 'box-observe-a');
  const graphTiming = graphOf([box(SG), box(OBS, { timing: 'immediate' })]);
  check('b5 timing form also designates',
    sameJson(C.compilePipelineGraphToLiveRules(graphTiming).immediateRuleIds, ['observe-a']));
  const graphPlain = graphOf([box(SG), box(OBS)]);
  check('b6 no designation compiles to no immediate ids',
    C.compilePipelineGraphToLiveRules(graphPlain).immediateRuleIds.length === 0);

  const saved = PS.savePipelineGraphToConfig(graph);
  check('b7 designated graph saves', saved.ok === true && !!saved.patch);
  const reloaded = PS.loadPipelineCore(saved.patch);
  check('b8 designation survives the persist round trip',
    sameJson(C.compilePipelineGraphToLiveRules(reloaded.graph).immediateRuleIds, ['observe-a']));
}

// ---- (d) WebGPU reasoned disabling, in lockstep with the route predicate --------
{
  const nodeOf = (cov, ruleId) => cov.nodes.find((n) => n.ruleId === ruleId);
  const agree = (cov, compiledRules, opts = {}) => cov.coverable
    === P.liveRulesWgslCoverable(compiledRules, { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true, ...opts });

  const okRule = { id: 'ok-rule', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'force-gate', force: 'wind' } };
  const gOk = graphOf([box(okRule)]);
  const covOk = X.analyzePipelineWebGpuCoverage(gOk, { names: NAMES, names2: NAMES2 });
  check('d1 coverable graph: coverable, node enabled, no reasons',
    covOk.coverable === true && nodeOf(covOk, 'ok-rule').disabled === false
    && nodeOf(covOk, 'ok-rule').reasons.length === 0);
  check('d2 coverable agrees with the route predicate',
    agree(covOk, C.compilePipelineGraphToLiveRules(gOk).rules));

  const denRule = { id: 'den-rule', enabled: true, target: { type: 'all' }, condition: 'den > 0.5', action: { type: 'kill' } };
  const gDen = graphOf([box(denRule)]);
  const covDen = X.analyzePipelineWebGpuCoverage(gDen, { names: NAMES, names2: NAMES2 });
  check('d3 den condition disables its node with the variable code',
    covDen.coverable === false && nodeOf(covDen, 'den-rule').disabled === true
    && nodeOf(covDen, 'den-rule').reasons.some((r) => r.code === 'condition-variable-no-wgsl-home'));
  check('d4 den verdict agrees with the route predicate',
    agree(covDen, C.compilePipelineGraphToLiveRules(gDen).rules));
  check('d5 the uncoverable graph still saves (branch F)',
    PS.savePipelineGraphToConfig(gDen).ok === true);

  const hitRule = { id: 'hit-rule', enabled: true, target: { type: 'all' }, condition: 'hit > 0', action: { type: 'kill' } };
  const covHit = X.analyzePipelineWebGpuCoverage(graphOf([box(hitRule)]), { names: NAMES, names2: NAMES2 });
  check('d6 hit condition disables with the variable code',
    nodeOf(covHit, 'hit-rule').disabled === true
    && nodeOf(covHit, 'hit-rule').reasons.some((r) => r.code === 'condition-variable-no-wgsl-home'));

  const extRule = { id: 'ext-rule', enabled: true, target: { type: 'all' }, condition: 'slot5 > 0.5', action: { type: 'kill' } };
  const covExt = X.analyzePipelineWebGpuCoverage(graphOf([box(extRule)]), { names: NAMES, names2: NAMES2 });
  check('d7 ext slot condition disables with the variable code',
    nodeOf(covExt, 'ext-rule').disabled === true
    && nodeOf(covExt, 'ext-rule').reasons.some((r) => r.code === 'condition-variable-no-wgsl-home'));

  const dispRule = { id: 'disp-rule', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'display', size: 2, opacity: 1 } };
  const covDisp = X.analyzePipelineWebGpuCoverage(graphOf([box(dispRule)]), { names: NAMES, names2: NAMES2 });
  check('d8 display action disables with the consumer code',
    covDisp.coverable === false && nodeOf(covDisp, 'disp-rule').disabled === true
    && nodeOf(covDisp, 'disp-rule').reasons.some((r) => r.code === 'action-consumer-off-route'));

  const spawnRule = { id: 'spawn-rule', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'spawn' } };
  const covSpawn = X.analyzePipelineWebGpuCoverage(graphOf([box(spawnRule)]), { names: NAMES, names2: NAMES2 });
  check('d9 spawn action disables with the consumer code',
    nodeOf(covSpawn, 'spawn-rule').disabled === true
    && nodeOf(covSpawn, 'spawn-rule').reasons.some((r) => r.code === 'action-consumer-off-route'));

  const snapDefs = [{ id: 'snap', name: 'S', source: { kind: 'snapshot', indicesB64: 'AAAAAA==' } }];
  const snapRule = { id: 'snap-rule', enabled: true, target: { type: 'group', id: 'snap' }, condition: '', action: { type: 'kill' } };
  const covSnap = X.analyzePipelineWebGpuCoverage(graphOf([box(snapRule)]), { names: NAMES, names2: NAMES2, groupDefs: snapDefs });
  check('d10 snapshot group target disables with the baked-fallback code',
    covSnap.coverable === false && nodeOf(covSnap, 'snap-rule').disabled === true
    && nodeOf(covSnap, 'snap-rule').reasons.some((r) => r.code === 'route-baked-fallback'));

  const slotRule = { id: 'slot-rule', enabled: true, target: { type: 'all' }, condition: 'a > 0.5', action: { type: 'kill' } };
  const gSlot = graphOf([box(slotRule)]);
  const covDyn = X.analyzePipelineWebGpuCoverage(gSlot, { names: NAMES, names2: NAMES2, attrDynamicActive: true });
  check('d11 attr-dynamic slot read disables with its code',
    covDyn.coverable === false && nodeOf(covDyn, 'slot-rule').disabled === true
    && nodeOf(covDyn, 'slot-rule').reasons.some((r) => r.code === 'attr-dynamic-slot-read'));
  check('d12 the same graph is coverable without the dynamic stage',
    X.analyzePipelineWebGpuCoverage(gSlot, { names: NAMES, names2: NAMES2 }).coverable === true);

  const gCross = graphOf([box(okRule, { crossImmediate: true })]);
  const covCross = X.analyzePipelineWebGpuCoverage(gCross, { names: NAMES, names2: NAMES2 });
  check('d13 cross designation is a note, not a disable',
    covCross.coverable === true && nodeOf(covCross, 'ok-rule').disabled === false
    && nodeOf(covCross, 'ok-rule').reasons.some((r) => r.code === 'cross-immediate-snapshot-fallback' && r.severity === 'note'));

  const covAgg = X.analyzePipelineWebGpuCoverage(graphOf([
    { id: 'gdef', kind: 'group-def', label: 'GA', enabled: true, params: { id: 'ga' } },
    { id: 'agg', kind: 'group-aggregate', label: 'Agg', enabled: true, params: {} },
    { id: 'act', kind: 'set-state', label: 'Act', enabled: true, params: { state: 2, ruleId: 'agg-rule' } },
  ], [
    { id: 'e1', from: 'gdef', to: 'agg', kind: 'data', fromPort: 'group', toPort: 'group' },
    { id: 'e2', from: 'agg', to: 'act', kind: 'data', fromPort: 'value', toPort: 'condition' },
  ]), { names: NAMES, names2: NAMES2 });
  check('d14 wired aggregate node is disabled with the twin-only code',
    covAgg.nodes.some((n) => n.nodeId === 'agg' && n.disabled === true
      && n.reasons.some((r) => r.code === 'group-aggregate-twin-only')));

  check('d15 type capability reflects the real WGSL supply',
    X.PIPELINE_WEBGPU_TYPE_CAPABILITY.StateId.supported === true
    && X.PIPELINE_WEBGPU_TYPE_CAPABILITY.Mask.supported === true
    && X.PIPELINE_WEBGPU_TYPE_CAPABILITY.Display.supported === false);
}

// ---- (e) fracture: palette, compile, twin bit -------------------------------------
{
  check('e1 palette offers fracture', CV.pipelinePaletteKinds().includes('fracture'));
  const graph = graphOf([
    { id: 'cond', kind: 'expression', label: 'Cond', enabled: true, params: { expr: 'age > 0.5' } },
    { id: 'fx', kind: 'fracture', label: 'Fracture', enabled: true, params: { ruleId: 'fx-rule' } },
  ], [
    { id: 'w1', from: 'cond', to: 'fx', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ]);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  check('e2 fracture action node compiles to a fracture rule',
    compiled.rules.length === 1 && compiled.rules[0].action.type === 'fracture');
  const classified = P.classifyLiveRules(compiled.rules, OPTS);
  const hit = P.evaluateLiveRuleStep(classified, INPUT);
  check('e3 twin sets the fracture bit on a match',
    (hit.mask & P.LIVE_RULE_FRACTURE_BIT) !== 0 && hit.matched.includes('fx-rule'));
  const miss = P.evaluateLiveRuleStep(classified, { ...INPUT, vars: { ...INPUT.vars, age: 0 } });
  check('e4 no fracture bit without a match', (miss.mask & P.LIVE_RULE_FRACTURE_BIT) === 0);
}

console.log(`stage5-pipeline-cross-s5: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
