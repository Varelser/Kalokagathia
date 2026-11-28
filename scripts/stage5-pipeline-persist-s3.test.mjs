#!/usr/bin/env node
// stage5-pipeline-persist-s3.test.mjs — Limit plan stage 5,
// slice S3: pipeline persistence (the two representations
// of one core). Decisions: STAGE5_DECISIONS.md 分岐A (the
// graph is the single internal core, the row list is a full
// editing surface, a save writes both representations, the
// round trip is lossless) and 分岐C (force column and
// canvas are two views of one data). Model:
// lib/pipelinePersist.ts on lib/pipelineCompiler.ts (S2)
// and lib/pipelineGraph.ts (S1).
//
// The graph lives in a NEW config key, gpgpuPipelineGraph
// (default ''), because preset records and share links
// carry whole config objects — a localStorage-only graph
// (the Designer precedent for partial compositions) would
// silently degrade to its compiled row list in every
// preset / link. The fingerprint record was re-recorded
// for exactly this one added key.
//
// Pins:
// (a) key registration: the default is '' and saving an
//     empty graph / an empty row list produces exactly the
//     unset patch (all three keys '') — the M1 control of
//     the stage-5 gate draft;
// (b) graph save writes both representations: the graph
//     key round-trips, the live-rules key is the compiled
//     row list, the force-order key is the compiled order,
//     and the saved config is self-consistent and reloads
//     as source 'graph'; a second save is idempotent;
// (c) migration: a row-list-only config (no graph key)
//     loads as source 'rowlist', its reconstructed core
//     compiles back to the same rules and order, and
//     saving that core produces a consistent both-forms
//     config;
// (d) row-list editing (last save wins, no silent merge):
//     a direct row-list edit after a graph save is flagged
//     by the consistency diagnostic and does NOT change
//     what load returns, until the row-list save adopts it
//     explicitly — after which the core reflects the edit
//     losslessly and the cycle is stable;
// (e) refusal / reporting: an invalid graph is refused
//     wholesale on save (no patch), an invalid stored graph
//     key loads as source 'invalid-graph' with a reason,
//     and a color rule survives the whole cycle as an
//     opaque node;
// (f) slot assignments are surfaced by the graph save but
//     the patch contains exactly the three owned keys (the
//     attribute keys are the wiring slice's business).
//
// Run: node scripts/stage5-pipeline-persist-s3.test.mjs

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

const PS = await load('lib/pipelinePersist.ts');
const P = await load('lib/pipelineGraph.ts');
const C = await load('lib/pipelineCompiler.ts');
const L = await load('lib/gpgpuParticleRulesLive.ts');
const F = await load('lib/gpgpuForceOrder.ts');
const D = await load('lib/appStateDefaultGpgpu.ts');

const graphOf = (nodes, edges = []) => P.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;

const ROWLIST = [
  { id: 'age-wind-gate', enabled: true, target: { type: 'all' }, condition: '(age > 0.5) * (age < 0.9)', action: { type: 'force-gate', force: 'wind' } },
  { id: 'fast-to-state2', enabled: true, target: { type: 'all' }, condition: 'vel > 2.0', action: { type: 'set-state', state: 2 } },
  { id: 'coef-truekill', enabled: true, target: { type: 'all' }, condition: 'a > 0.25', action: { type: 'true-kill' } },
];
// A non-default force order: the first three chunk names reversed.
const CHAIN = [...F.GPGPU_FORCE_CHUNK_NAMES.slice(0, 3)].reverse();
const FORCE_KEY = F.serializeGpgpuForceOrder(CHAIN);
check('0a fixture force key is non-default', FORCE_KEY !== '');

const sampleGraph = () => graphOf([
  { id: 'box1', kind: 'rule-box', label: 'Age wind gate', enabled: true, params: { rule: ROWLIST[0] } },
  { id: 'cond1', kind: 'expression', label: 'Cond', enabled: true, params: { expr: 'vel > 2.0' } },
  { id: 'act1', kind: 'set-state', label: 'To state 2', enabled: true, params: { state: 2, ruleId: 'fast-to-state2' } },
  { id: 'expr1', kind: 'expression', label: 'Coef expr', enabled: true, params: { expr: 'clamp(age * 1.5, 0.0, 1.0)', outputSlot: 'a' } },
  { id: 'cond2', kind: 'expression', label: 'Cond 2', enabled: true, params: { expr: 'a > 0.25' } },
  { id: 'act2', kind: 'true-kill', label: 'True kill', enabled: true, params: { ruleId: 'coef-truekill' } },
  ...CHAIN.map((name) => ({ id: `chunk:${name}`, kind: 'force-chunk', label: name, enabled: true, params: { chunk: name } })),
], [
  { id: 'w1', from: 'cond1', to: 'act1', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  { id: 'w2', from: 'expr1', to: 'cond2', kind: 'data', fromPort: 'value', toPort: 'in' },
  { id: 'w3', from: 'cond2', to: 'act2', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ...CHAIN.slice(1).map((name, i) => ({ id: `fseq-${i}`, from: `chunk:${CHAIN[i]}`, to: `chunk:${name}`, kind: 'sequence' })),
]);

// ---- (a) registration + empty == unset ------------------------------------------
{
  check('a1 gpgpuPipelineGraph default is empty string', D.APP_STATE_DEFAULT_GPGPU.gpgpuPipelineGraph === '');
  const emptySave = PS.savePipelineGraphToConfig(PS.EMPTY_PIPELINE_GRAPH);
  check('a2 empty graph save is ok', emptySave.ok === true);
  check('a3 empty graph save patch is the unset patch',
    sameJson(emptySave.patch, { gpgpuPipelineGraph: '', gpgpuParticleRulesLive: '', gpgpuForceOrder: '' }));
  const applied = PS.applyPipelineConfigPatch(
    { gpgpuPipelineGraph: 'x', gpgpuParticleRulesLive: 'y', gpgpuForceOrder: 'z', other: 1 },
    emptySave.patch,
  );
  check('a4 applying the unset patch clears all three keys and keeps other keys',
    applied.gpgpuPipelineGraph === '' && applied.gpgpuParticleRulesLive === ''
    && applied.gpgpuForceOrder === '' && applied.other === 1);
  const emptyRowSave = PS.savePipelineRowListToConfig('', '');
  check('a5 empty row-list save patch is the unset patch',
    sameJson(emptyRowSave.patch, { gpgpuPipelineGraph: '', gpgpuParticleRulesLive: '', gpgpuForceOrder: '' }));
  const loaded = PS.loadPipelineCore({});
  check('a6 unset config loads as empty', loaded.source === 'empty' && PS.isEmptyPipelineGraph(loaded.graph));
  const loadedDefaults = PS.loadPipelineCore({
    gpgpuPipelineGraph: D.APP_STATE_DEFAULT_GPGPU.gpgpuPipelineGraph,
    gpgpuParticleRulesLive: D.APP_STATE_DEFAULT_GPGPU.gpgpuParticleRulesLive,
    gpgpuForceOrder: D.APP_STATE_DEFAULT_GPGPU.gpgpuForceOrder,
  });
  check('a7 all-default config loads as empty (legacy behaviour)', loadedDefaults.source === 'empty');
}

// ---- (b) graph save writes both representations ---------------------------------
let savedPatch;
{
  const graph = sampleGraph();
  check('b0 sample graph validates', graph !== null && graph !== undefined);
  const saved = PS.savePipelineGraphToConfig(graph, { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'] });
  check('b1 graph save ok', saved.ok === true && saved.patch !== null);
  savedPatch = saved.patch;
  check('b2 graph key round-trips to the same graph',
    P.serializePipelineGraph(P.parsePipelineGraph(savedPatch.gpgpuPipelineGraph)) === savedPatch.gpgpuPipelineGraph);
  const compiled = C.compilePipelineGraph(graph, { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'] });
  check('b3 live key is the compiled row list',
    savedPatch.gpgpuParticleRulesLive === L.serializeLiveParticleRules(compiled.rules));
  check('b4 compiled rules deep-equal the hand row list',
    sameJson(L.parseLiveParticleRules(savedPatch.gpgpuParticleRulesLive), L.parseLiveParticleRules(JSON.stringify(ROWLIST))));
  check('b5 force key is the compiled non-default order', savedPatch.gpgpuForceOrder === FORCE_KEY);
  check('b6 saved config is self-consistent', PS.checkPipelineConfigConsistency(savedPatch).consistent === true);
  const loaded = PS.loadPipelineCore(savedPatch);
  check('b7 saved config loads as source graph', loaded.source === 'graph');
  check('b8 loaded graph serialises identically', P.serializePipelineGraph(loaded.graph) === savedPatch.gpgpuPipelineGraph);
  const savedAgain = PS.savePipelineGraphToConfig(loaded.graph, { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'] });
  check('b9 load -> save is idempotent (lossless round trip)', sameJson(savedAgain.patch, savedPatch));
  // A graph with nodes that compiles to nothing is NOT the unset state.
  const poolOnly = graphOf([{ id: 'pool', kind: 'pool-source', label: 'Pool', enabled: true }]);
  const poolSave = PS.savePipelineGraphToConfig(poolOnly);
  check('b10 node-ful graph with no rules keeps its graph key',
    poolSave.ok && poolSave.patch.gpgpuPipelineGraph !== ''
    && poolSave.patch.gpgpuParticleRulesLive === '' && poolSave.patch.gpgpuForceOrder === '');
  check('b11 pool-only config loads as source graph', PS.loadPipelineCore(poolSave.patch).source === 'graph');
}

// ---- (c) migration from a row-list-only config ----------------------------------
{
  const legacy = { gpgpuParticleRulesLive: JSON.stringify(ROWLIST), gpgpuForceOrder: FORCE_KEY };
  const loaded = PS.loadPipelineCore(legacy);
  check('c1 legacy config loads as source rowlist', loaded.source === 'rowlist');
  const compiled = C.compilePipelineGraph(loaded.graph);
  check('c2 reconstructed core compiles to the same rules',
    sameJson(compiled.rules, L.resolveLiveParticleRules(legacy.gpgpuParticleRulesLive)));
  check('c3 reconstructed core compiles to the same force order', compiled.forceOrderKey === FORCE_KEY);
  const saved = PS.savePipelineGraphToConfig(loaded.graph);
  check('c4 saving the migrated core writes both representations',
    saved.ok && saved.patch.gpgpuPipelineGraph !== ''
    && saved.patch.gpgpuParticleRulesLive === L.serializeLiveParticleRules(L.parseLiveParticleRules(legacy.gpgpuParticleRulesLive))
    && saved.patch.gpgpuForceOrder === FORCE_KEY);
  check('c5 migrated config is self-consistent', PS.checkPipelineConfigConsistency(saved.patch).consistent === true);
  check('c6 migrated config now loads as source graph', PS.loadPipelineCore(saved.patch).source === 'graph');
  // A default force order contributes no chain nodes.
  const noOrder = PS.loadPipelineCore({ gpgpuParticleRulesLive: JSON.stringify(ROWLIST) });
  check('c7 default order reconstructs without chunk nodes',
    noOrder.graph.nodes.every((n) => n.kind !== 'force-chunk'));
}

// ---- (d) row-list editing: last save wins, no silent merge ----------------------
{
  const editedRules = [
    ...ROWLIST,
    { id: 'late-kill', enabled: true, target: { type: 'all' }, condition: 'age > 0.95', action: { type: 'kill' } },
  ];
  const editedLive = JSON.stringify(editedRules);
  const diverged = { ...savedPatch, gpgpuParticleRulesLive: editedLive };
  const diag = PS.checkPipelineConfigConsistency(diverged);
  check('d1 direct row-list edit is flagged as divergence', diag.consistent === false && diag.graphPresent === true);
  const loadedDiverged = PS.loadPipelineCore(diverged);
  check('d2 load does not silently merge the edit (graph core unchanged)',
    loadedDiverged.source === 'graph'
    && P.serializePipelineGraph(loadedDiverged.graph) === savedPatch.gpgpuPipelineGraph);
  const adopted = PS.savePipelineRowListToConfig(editedLive, diverged.gpgpuForceOrder);
  check('d3 row-list save rebuilds the graph key', adopted.patch.gpgpuPipelineGraph !== ''
    && adopted.patch.gpgpuPipelineGraph !== savedPatch.gpgpuPipelineGraph);
  check('d4 adopted patch keeps the edited row list canonically',
    adopted.patch.gpgpuParticleRulesLive === L.serializeLiveParticleRules(L.parseLiveParticleRules(editedLive)));
  const loadedAdopted = PS.loadPipelineCore(adopted.patch);
  const compiledAdopted = C.compilePipelineGraph(loadedAdopted.graph);
  check('d5 adopted core compiles back to the edited rules (lossless)',
    sameJson(compiledAdopted.rules, L.resolveLiveParticleRules(editedLive)));
  check('d6 adopted core keeps the force order', compiledAdopted.forceOrderKey === FORCE_KEY);
  check('d7 adopted config is self-consistent', PS.checkPipelineConfigConsistency(adopted.patch).consistent === true);
  const adoptedAgain = PS.savePipelineRowListToConfig(adopted.patch.gpgpuParticleRulesLive, adopted.patch.gpgpuForceOrder);
  check('d8 row-list save cycle is stable', sameJson(adoptedAgain.patch, adopted.patch));
}

// ---- (e) refusal, invalid storage, opaque preservation ---------------------------
{
  const cyclic = {
    format: 'pipeline-graph-v1',
    nodes: [
      { id: 'n1', kind: 'expression', label: 'A', enabled: true, params: { expr: '1' } },
      { id: 'n2', kind: 'expression', label: 'B', enabled: true, params: { expr: '2' } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', kind: 'data' },
      { id: 'e2', from: 'n2', to: 'n1', kind: 'data' },
    ],
  };
  const refused = PS.savePipelineGraphToConfig(cyclic);
  check('e1 cyclic graph save is refused wholesale', refused.ok === false && refused.patch === null);
  check('e2 refusal carries a reason', typeof refused.reason === 'string' && refused.reason.length > 0);
  const invalidLoad = PS.loadPipelineCore({ gpgpuPipelineGraph: '{"format":"nope","nodes":[],"edges":[]}' });
  check('e3 invalid stored graph loads as invalid-graph with reason',
    invalidLoad.source === 'invalid-graph' && typeof invalidLoad.reason === 'string' && invalidLoad.reason.length > 0);
  check('e4 invalid stored graph is reported inconsistent',
    PS.checkPipelineConfigConsistency({ gpgpuPipelineGraph: '{"format":"nope","nodes":[],"edges":[]}' }).consistent === false);
  const colorRules = [
    { id: 'paint', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'color', color: [1, 0.5, 0] } },
  ];
  const colorLive = JSON.stringify(colorRules);
  const migrated = PS.loadPipelineCore({ gpgpuParticleRulesLive: colorLive });
  check('e5 color rule migrates to an opaque node',
    migrated.graph.nodes.some((n) => n.kind === 'opaque'));
  const colorSaved = PS.savePipelineGraphToConfig(migrated.graph);
  check('e6 opaque content survives graph save back into the row list',
    colorSaved.ok && colorSaved.patch.gpgpuParticleRulesLive === L.serializeLiveParticleRules(L.parseLiveParticleRules(colorLive)));
}

// ---- (f) slots surfaced, patch owns exactly three keys ---------------------------
{
  const saved = PS.savePipelineGraphToConfig(sampleGraph(), { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'] });
  check('f1 slot assignment is surfaced in the save result',
    saved.slots !== null && saved.slots.assignments.some((a) => a.name === 'a'));
  check('f2 patch contains exactly the three owned keys',
    sameJson(Object.keys(saved.patch).sort(), ['gpgpuForceOrder', 'gpgpuParticleRulesLive', 'gpgpuPipelineGraph']));
}

console.log(`stage5-pipeline-persist-s3: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
