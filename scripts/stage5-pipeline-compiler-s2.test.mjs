#!/usr/bin/env node
// stage5-pipeline-compiler-s2.test.mjs — Limit plan stage 5,
// slice S2: pipeline compiler (graph -> live row list /
// force-order key, and back). Decisions: STAGE5_DECISIONS.md
// 分岐A (one graph core, row list a full editing surface,
// round trip lossless, unrepresentable elements kept as
// opaque), 分岐C (column and canvas are two views of one
// data). Materials: STAGE5_DESIGN_MATERIALS.md §5 + §8.5.
// Ports and extends prototype P1 (15 checks) and P1x
// (7 checks) into the tree. Model: lib/pipelineCompiler.ts
// on lib/pipelineGraph.ts (slice S1).
//
// Pins:
// (a) graph -> rules: rule-box (entity form) and
//     fine-grained expression+action compile to rules that
//     resolve, generate a REP fragment and drive the CPU
//     twin byte-/value-identically to the hand-written
//     row-list equivalent (P1 checks 1-3);
// (b) synthetic rule-boxes (S1 form) compile, and an
//     S1-expanded box compiles to the same rule;
// (c) round trip: rules -> graph -> rules is lossless,
//     including a color rule carried as an opaque node,
//     and graph -> rules -> graph -> rules is stable;
// (d) force column: a force-chunk chain compiles to the
//     existing order key, the MainForces fragment matches
//     the string-key form byte for byte, reordering really
//     changes the fragment, no chain means the stock
//     fragment, variant gating survives (P1 checks 4-5),
//     and key -> graph -> key round-trips;
// (e) Logic: And/Or/Not nodes lower to the native form;
//     the lowered condition string is exactly the native
//     hand-written form, its REP fragment matches, and it
//     evaluates to the boolean truth table (P1x L1-L3);
// (f) slot discipline: new names take the lowest writable
//     slot, existing names reuse their slot, reserved /
//     invalid / duplicate / ext / exhausted requests are
//     refused with reasons, the reserved mirror matches
//     the attribute module's behaviour, and the supply
//     channel (dyn fragment + REP + twin) works end to
//     end (P1x S1-S3);
// (g) uncompilable content is reported and preserved as
//     opaque, never dropped silently.
//
// Run: node scripts/stage5-pipeline-compiler-s2.test.mjs

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

const C = await load('lib/pipelineCompiler.ts');
const P = await load('lib/pipelineGraph.ts');
const L = await load('lib/gpgpuParticleRulesLive.ts');
const F = await load('lib/gpgpuForceOrder.ts');
const M = await load('components/gpgpuShaderSimulationVelocityMainForces.ts');
const X = await load('lib/expression.ts');
const XG = await load('lib/expressionGlsl.ts');
const A = await load('lib/gpgpuAttributes.ts');

const OPTS = { names: ['a', 'b', 'c', 'd'], names2: ['i', 'j', 'k', 'l'], groupDefs: [], densityAvailable: false };
const graphOf = (nodes, edges = []) => P.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;

// ---- (a) graph -> rules, P1 port ------------------------------------------------
const ROWLIST = [
  { id: 'age-wind-gate', enabled: true, target: { type: 'all' }, condition: '(age > 0.5) * (age < 0.9)', action: { type: 'force-gate', force: 'wind' } },
  { id: 'fast-to-state2', enabled: true, target: { type: 'all' }, condition: 'vel > 2.0', action: { type: 'set-state', state: 2 } },
  { id: 'coef-truekill', enabled: true, target: { type: 'all' }, condition: 'a > 0.25', action: { type: 'true-kill' } },
];
{
  const graph = graphOf([
    { id: 'box1', kind: 'rule-box', label: 'Age wind gate', enabled: true, params: { rule: ROWLIST[0] } },
    { id: 'cond1', kind: 'expression', label: 'Cond', enabled: true, params: { expr: 'vel > 2.0' } },
    { id: 'act1', kind: 'set-state', label: 'To state 2', enabled: true, params: { state: 2, ruleId: 'fast-to-state2' } },
    { id: 'expr1', kind: 'expression', label: 'Coef expr', enabled: true, params: { expr: 'clamp(smoothstep(0.0, 1.0, age) * 1.5, 0.0, 1.0)', outputSlot: 'a' } },
    { id: 'cond2', kind: 'expression', label: 'Cond 2', enabled: true, params: { expr: 'a > 0.25' } },
    { id: 'act2', kind: 'true-kill', label: 'True kill', enabled: true, params: { ruleId: 'coef-truekill' } },
  ], [
    { id: 'w1', from: 'cond1', to: 'act1', kind: 'data', fromPort: 'bool', toPort: 'condition' },
    { id: 'w2', from: 'expr1', to: 'cond2', kind: 'data', fromPort: 'value', toPort: 'in' },
    { id: 'w3', from: 'cond2', to: 'act2', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ]);
  check('a0 P1-shaped graph validates', graph !== null && graph !== undefined);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  const rowResolved = L.resolveLiveParticleRules(JSON.stringify(ROWLIST));
  check('a1 compiled rule count matches row list', compiled.rules.length === rowResolved.length);
  check('a2 compiled rules deep-equal row-list rules after resolver',
    sameJson(compiled.rules, rowResolved));
  check('a3 nothing fell opaque in the P1 shape', compiled.opaqueNodeIds.length === 0);
  const fragC = L.buildRuleEvalFragment(compiled.rules, OPTS);
  const fragR = L.buildRuleEvalFragment(rowResolved, OPTS);
  check('a4 REP fragment exists for both forms', typeof fragC === 'string' && typeof fragR === 'string');
  check('a5 REP fragment byte-identical', fragC === fragR);
  const clsC = L.classifyLiveRules(compiled.rules, OPTS);
  const clsR = L.classifyLiveRules(rowResolved, OPTS);
  const samples = [
    { vel: 0, age: 0.7, slots: [0.5, 0, 0, 0, 0, 0, 0, 0] },
    { vel: 3, age: 0.2, slots: [0.1, 0, 0, 0, 0, 0, 0, 0] },
    { vel: 3, age: 0.7, slots: [0.5, 0, 0, 0, 0, 0, 0, 0] },
    { vel: 0, age: 0.1, slots: [0, 0, 0, 0, 0, 0, 0, 0] },
  ];
  let twinOk = true;
  for (const s of samples) {
    const input = { slots: s.slots, vars: { vel: s.vel, age: s.age, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6 } };
    if (!sameJson(L.evaluateLiveRuleStep(clsC, input), L.evaluateLiveRuleStep(clsR, input))) twinOk = false;
  }
  check('a6 CPU twin agrees on all samples', twinOk);
  check('a7 empty rules produce no REP fragment',
    L.buildRuleEvalFragment(L.resolveLiveParticleRules(''), OPTS) === null);
}

// ---- (b) synthetic rule-box + S1 expansion ---------------------------------------
{
  const boxGraph = graphOf([
    {
      id: 'rule:kill-old', kind: 'rule-box', label: 'Kill old', enabled: true,
      params: { condition: 'age > 0.9', actionKind: 'kill', ruleId: 'kill-old' },
    },
  ]);
  const fromBox = C.compilePipelineGraphToLiveRules(boxGraph);
  check('b1 synthetic box compiles to one rule', fromBox.rules.length === 1);
  check('b2 synthetic box rule shape',
    fromBox.rules[0].id === 'kill-old'
    && fromBox.rules[0].condition === 'age > 0.9'
    && fromBox.rules[0].action.type === 'kill');
  const expanded = P.expandPipelineGraph(boxGraph);
  check('b3 expanded graph validates', P.validatePipelineGraph(expanded).ok);
  const fromExpanded = C.compilePipelineGraphToLiveRules(expanded);
  check('b4 expanded box compiles to the same rule', sameJson(fromExpanded.rules, fromBox.rules));
  // Entity form carried directly in params (designer-shaped).
  const entityGraph = graphOf([
    {
      id: 'rule:direct', kind: 'rule-box', label: 'Direct', enabled: false,
      params: { id: 'direct', enabled: true, target: { type: 'all' }, condition: 'age > 0.1', action: { type: 'fracture' } },
    },
  ]);
  const fromEntity = C.compilePipelineGraphToLiveRules(entityGraph);
  check('b5 entity-in-params box compiles, node enabled wins',
    fromEntity.rules.length === 1 && fromEntity.rules[0].action.type === 'fracture'
    && fromEntity.rules[0].enabled === false);
}

// ---- (c) round trip ----------------------------------------------------------------
{
  const original = L.parseLiveParticleRules(JSON.stringify([
    { id: 'r-gate', enabled: true, target: { type: 'group', id: 'g1' }, condition: 'age > 0.5', action: { type: 'force-gate', force: 'curl' } },
    { id: 'r-state', enabled: false, target: { type: 'all' }, condition: '', action: { type: 'set-state', state: 7 } },
    { id: 'r-group', enabled: true, target: { type: 'all' }, condition: 'vel > 1.0', action: { type: 'set-group', id: 'g2' } },
    { id: 'r-display', enabled: true, target: { type: 'all' }, condition: 'age < 0.2', action: { type: 'display', size: 0.5, opacity: 0.25 } },
    { id: 'r-spawn', enabled: true, target: { type: 'all' }, condition: 'age > 0.8', action: { type: 'spawn' } },
    { id: 'r-color', enabled: true, target: { type: 'all' }, condition: 'age > 0.3', action: { type: 'color', color: [1, 0.5, 0] } },
  ]));
  check('c1 fixture rules parse', original.length === 6);
  const graph = C.liveRulesToPipelineGraph(original);
  check('c2 rules -> graph validates', P.validatePipelineGraph(graph).ok);
  check('c3 color rule becomes an opaque node, the rest rule-boxes',
    graph.nodes.filter((n) => n.kind === 'opaque').length === 1
    && graph.nodes.filter((n) => n.kind === 'rule-box').length === 5);
  const back = C.compilePipelineGraphToLiveRules(graph);
  check('c4 graph -> rules is lossless (serialised equality)',
    L.serializeLiveParticleRules(back.rules) === L.serializeLiveParticleRules(original));
  check('c5 the opaque payload compiles back verbatim, not counted opaque',
    back.opaqueNodeIds.length === 0
    && back.rules.some((r) => r.id === 'r-color' && r.action.type === 'color'));
  const graph2 = C.liveRulesToPipelineGraph(back.rules);
  check('c6 graph -> rules -> graph is stable', sameJson(graph2, graph));
  const back2 = C.compilePipelineGraphToLiveRules(graph2);
  check('c7 second round trip still lossless',
    L.serializeLiveParticleRules(back2.rules) === L.serializeLiveParticleRules(original));
}

// ---- (d) force column ---------------------------------------------------------------
{
  const orderNames = ['pyro-buoyancy', 'turbulence', 'audio-blast', 'nbody', 'wind', 'curl', 'pyro-disturbance', 'boids', 'kuramoto', 'particle-life', 'attractor', 'levy', 'vortex'];
  const chain = graphOf(orderNames.map((name) => ({
    id: `chunk:${name}`, kind: 'force-chunk', label: name, enabled: true, params: { chunk: name },
  })), orderNames.slice(1).map((name, i) => ({
    id: `seq-${i}`, from: `chunk:${orderNames[i]}`, to: `chunk:${name}`, kind: 'sequence',
  })));
  const key = C.pipelineGraphToForceOrderKey(chain);
  check('d1 chain compiles to a non-default order key', key !== '' && !F.isDefaultGpgpuForceOrder(key));
  check('d2 compiled key equals the string-key serialisation',
    key === F.serializeGpgpuForceOrder(orderNames));
  const fragGraph = M.buildMainForcesFragment(key);
  const fragKey = M.buildMainForcesFragment(orderNames.join(','));
  check('d3 MainForces fragment byte-identical (graph vs string key)', fragGraph === fragKey);
  check('d4 reordered fragment actually differs from default', fragGraph !== M.VEL_FRAG_MAIN_FORCES);
  check('d5 no chain -> empty key and stock fragment',
    C.pipelineGraphToForceOrderKey(graphOf([])) === ''
    && M.buildMainForcesFragment(C.pipelineGraphToForceOrderKey(graphOf([]))) === M.VEL_FRAG_MAIN_FORCES);
  const withMeander = F.serializeGpgpuForceOrder([...F.normalizeGpgpuForceOrder(''), 'meander'].filter((v, i, a) => a.indexOf(v) === i));
  check('d6 variant gating survives (meander named, variant off -> default fragment)',
    M.buildMainForcesFragment(withMeander) === M.VEL_FRAG_MAIN_FORCES);
  const rtGraph = C.forceOrderKeyToPipelineGraph(key);
  check('d7 key -> graph validates and holds every chunk',
    P.validatePipelineGraph(rtGraph).ok && rtGraph.nodes.length === F.normalizeGpgpuForceOrder('').length);
  check('d8 key -> graph -> key round-trips', C.pipelineGraphToForceOrderKey(rtGraph) === key);
  check('d9 default key -> graph -> empty key',
    C.pipelineGraphToForceOrderKey(C.forceOrderKeyToPipelineGraph('')) === '');
  const badChain = graphOf([
    { id: 'chunk:nope', kind: 'force-chunk', label: 'nope', enabled: true, params: { chunk: 'nope' } },
  ]);
  check('d10 unknown chunk names are dropped by the order discipline',
    C.pipelineGraphToForceOrderKey(badChain) === '');
}

// ---- (e) Logic lowering ---------------------------------------------------------------
{
  const graph = graphOf([
    { id: 'e1', kind: 'expression', label: 'E1', enabled: true, params: { expr: 'age > 0.5' } },
    { id: 'e2', kind: 'expression', label: 'E2', enabled: true, params: { expr: 'vel > 2.0' } },
    { id: 'e3', kind: 'expression', label: 'E3', enabled: true, params: { expr: 'state == 2' } },
    { id: 'e4', kind: 'expression', label: 'E4', enabled: true, params: { expr: 'age > 0.9' } },
    { id: 'or1', kind: 'logic-or', label: 'Or', enabled: true },
    { id: 'not1', kind: 'logic-not', label: 'Not', enabled: true },
    { id: 'and1', kind: 'logic-and', label: 'And', enabled: true },
    { id: 'act', kind: 'force-gate', label: 'Gate', enabled: true, params: { force: 'wind', ruleId: 'logic-rule' } },
  ], [
    { id: 'w1', from: 'e2', to: 'or1', kind: 'data', fromPort: 'bool', toPort: 'in' },
    { id: 'w2', from: 'e3', to: 'or1', kind: 'data', fromPort: 'bool', toPort: 'in' },
    { id: 'w3', from: 'e4', to: 'not1', kind: 'data', fromPort: 'bool', toPort: 'in' },
    { id: 'w4', from: 'e1', to: 'and1', kind: 'data', fromPort: 'bool', toPort: 'in' },
    { id: 'w5', from: 'or1', to: 'and1', kind: 'data', fromPort: 'result', toPort: 'in' },
    { id: 'w6', from: 'not1', to: 'and1', kind: 'data', fromPort: 'result', toPort: 'in' },
    { id: 'w7', from: 'and1', to: 'act', kind: 'data', fromPort: 'result', toPort: 'condition' },
  ]);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  const expected = '(age > 0.5) * (clamp((vel > 2.0) + (state == 2), 0.0, 1.0)) * ((1.0 - (age > 0.9)))';
  check('e1 logic graph compiles to one rule', compiled.rules.length === 1);
  check('e2 lowered condition is exactly the native hand-written form',
    compiled.rules[0].condition === expected, );
  const native = L.resolveLiveParticleRules(JSON.stringify([
    { id: 'logic-rule', enabled: true, target: { type: 'all' }, condition: expected, action: { type: 'force-gate', force: 'wind' } },
  ]));
  check('e3 REP fragment for lowered logic == native form',
    L.buildRuleEvalFragment(compiled.rules, OPTS) === L.buildRuleEvalFragment(native, OPTS)
    && typeof L.buildRuleEvalFragment(compiled.rules, OPTS) === 'string');
  let truth = true;
  for (const age of [0.2, 0.7, 0.95]) for (const vel of [0, 3]) for (const state of [0, 2]) {
    const c = X.compileExpression(expected, ['age', 'vel', 'state']);
    if (!c.ok) { truth = false; break; }
    const got = X.evaluateCompiledExpressionWithVars(c.ast, { age, vel, state });
    const want = (age > 0.5 && (vel > 2.0 || state === 2) && !(age > 0.9)) ? 1 : 0;
    if (got !== want) truth = false;
  }
  check('e4 lowered form matches boolean logic on the sample grid (18 cases)', truth);
  // Band node synthesis is the native product form too.
  const bandGraph = graphOf([
    { id: 'band1', kind: 'band', label: 'Band', enabled: true, params: { variable: 'age', low: 0.5, high: 0.9 } },
    { id: 'act', kind: 'kill', label: 'Kill', enabled: true, params: { ruleId: 'band-kill' } },
  ], [
    { id: 'w1', from: 'band1', to: 'act', kind: 'data', fromPort: 'result', toPort: 'condition' },
  ]);
  check('e5 band node synthesises the native product form',
    C.compilePipelineGraphToLiveRules(bandGraph).rules[0].condition === '(age >= 0.5) * (age <= 0.9)');
}

// ---- (f) slot discipline + supply channel ----------------------------------------------
{
  const COEF_EXPR = 'clamp(smoothstep(0.0, 1.0, age) * 1.5, 0.0, 1.0)';
  const slotGraph = (nodes) => graphOf(nodes);
  const exprNode = (id, outputSlot, expr = 'age * 2.0') => ({
    id, kind: 'expression', label: id, enabled: true, params: { expr, outputSlot },
  });

  const assigned = C.assignPipelineExpressionSlots(slotGraph([exprNode('n1', 'coef', COEF_EXPR)]));
  check('f1 new name takes the lowest writable slot',
    assigned.assignments.length === 1 && assigned.assignments[0].slot === 0
    && assigned.assignments[0].source === 'assigned');
  check('f2 proposed names carry the new name at its slot',
    sameJson(assigned.names, ['coef', 'b', 'c', 'd']));
  check('f3 dyn exprs carry the expression at its slot',
    assigned.dynExprs[0] === COEF_EXPR && assigned.dynExprs[1] === '');

  const existing = C.assignPipelineExpressionSlots(slotGraph([exprNode('n1', 'a')]));
  check('f4 existing name reuses its slot',
    existing.assignments.length === 1 && existing.assignments[0].slot === 0
    && existing.assignments[0].source === 'existing');

  const reserved = C.assignPipelineExpressionSlots(slotGraph([
    exprNode('r1', 'x'), exprNode('r2', 'vel'), exprNode('r3', 'den'),
    exprNode('r4', 'clamp'), exprNode('r5', 't'),
  ]));
  check('f5 reserved names are all refused as reserved-name',
    reserved.assignments.length === 0 && reserved.rejections.length === 5
    && reserved.rejections.every((r) => r.reason === 'reserved-name'));
  let mirrorOk = true;
  for (const name of C.PIPELINE_SLOT_RESERVED_NAMES) {
    if (A.resolveAttrNameSlot(name, [name, 'b', 'c', 'd'], ['i', 'j', 'k', 'l']) !== -1) mirrorOk = false;
  }
  check('f6 reserved mirror matches the attribute module (every reserved name is inert there)', mirrorOk);

  const invalid = C.assignPipelineExpressionSlots(slotGraph([exprNode('n1', '1abc')]));
  check('f7 invalid name refused', invalid.rejections.length === 1
    && invalid.rejections[0].reason === 'invalid-name');

  const dup = C.assignPipelineExpressionSlots(slotGraph([exprNode('n1', 'coef'), exprNode('n2', 'coef')]));
  check('f8 duplicate output name: first wins, second refused',
    dup.assignments.length === 1 && dup.rejections.length === 1
    && dup.rejections[0].reason === 'duplicate-output-name' && dup.rejections[0].nodeId === 'n2');

  const full = C.assignPipelineExpressionSlots(slotGraph([
    exprNode('n1', 's1'), exprNode('n2', 's2'), exprNode('n3', 's3'),
    exprNode('n4', 's4'), exprNode('n5', 's5'),
  ]));
  check('f9 fifth new name finds no free writable slot',
    full.assignments.length === 4 && full.rejections.length === 1
    && full.rejections[0].reason === 'no-free-slot');

  const ext = C.assignPipelineExpressionSlots(
    slotGraph([exprNode('n1', 'coef')]),
    ['a', 'b', 'c', 'd'], ['coef', 'j', 'k', 'l'],
  );
  check('f10 a name living on an ext slot is read-only for the dyn channel',
    ext.assignments.length === 0 && ext.rejections.length === 1
    && ext.rejections[0].reason === 'ext-slot-read-only');

  // End-to-end supply (P1x S1-S3): graph -> slots -> dyn + REP + twin.
  const supplyGraph = graphOf([
    { id: 'expr1', kind: 'expression', label: 'Coef', enabled: true, params: { expr: COEF_EXPR, outputSlot: 'coef' } },
    { id: 'cond', kind: 'expression', label: 'Cond', enabled: true, params: { expr: 'coef > 0.25' } },
    { id: 'act', kind: 'true-kill', label: 'Kill', enabled: true, params: { ruleId: 'coef-kill' } },
  ], [
    { id: 'w1', from: 'expr1', to: 'cond', kind: 'data', fromPort: 'value', toPort: 'in' },
    { id: 'w2', from: 'cond', to: 'act', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ]);
  const whole = C.compilePipelineGraph(supplyGraph);
  check('f11 whole-graph compile returns rules + key + slots together',
    whole.rules.length === 1 && whole.forceOrderKey === '' && whole.slots.assignments.length === 1);
  const dynFrag = XG.buildAttrDynFragment(whole.slots.dynExprs, whole.slots.names, whole.slots.names2);
  check('f12 attr-dyn fragment builds for the assigned coefficient expression',
    typeof dynFrag === 'string' && dynFrag.includes('simAgeN'));
  const supplyOpts = { names: whole.slots.names, names2: whole.slots.names2, groupDefs: [], densityAvailable: false };
  check('f13 REP fragment builds for a condition reading the supplied slot',
    typeof L.buildRuleEvalFragment(whole.rules, supplyOpts) === 'string');
  const classified = L.classifyLiveRules(whole.rules, supplyOpts);
  let supplyOk = true;
  for (const age of [0.1, 0.3, 0.6, 1.0]) {
    const c = X.compileExpression(COEF_EXPR, ['age', 'x', 't']);
    const coef = X.evaluateCompiledExpressionWithVars(c.ast, { age, x: 0, t: 0 });
    const step = L.evaluateLiveRuleStep(classified, {
      slots: [coef, 0, 0, 0, 0, 0, 0, 0],
      vars: { vel: 0, age, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, coef },
    });
    if (step.matched.includes('coef-kill') !== (coef > 0.25)) supplyOk = false;
  }
  check('f14 end-to-end: expression value supplied via slot drives the condition', supplyOk);
}

// ---- (g) opaque preservation --------------------------------------------------------------
{
  const graph = graphOf([
    { id: 'act', kind: 'set-group', label: 'Set group', enabled: true, params: { ruleId: 'nowhere' } },
    { id: 'op', kind: 'opaque', label: 'Kept', enabled: true, params: { rawRule: { id: 'kept', enabled: true, target: { type: 'all' }, condition: 'age > 0.1', action: { type: 'kill' } } } },
  ]);
  const compiled = C.compilePipelineGraphToLiveRules(graph);
  check('g1 uncompilable action node is reported, not dropped silently',
    compiled.rules.every((r) => r.id !== 'nowhere')
    && compiled.opaqueNodeIds.includes('act')
    && compiled.issues.some((i) => i.nodeId === 'act' && i.reason === 'action-not-compilable'));
  check('g2 opaque node payload compiles back verbatim',
    compiled.rules.some((r) => r.id === 'kept' && r.action.type === 'kill'));
  const dupGraph = graphOf([
    { id: 'b1', kind: 'rule-box', label: 'B1', enabled: true, params: { rule: ROWLIST[0] } },
    { id: 'b2', kind: 'rule-box', label: 'B2', enabled: true, params: { rule: ROWLIST[0] } },
  ]);
  const dupCompiled = C.compilePipelineGraphToLiveRules(dupGraph);
  check('g3 duplicate rule ids: first wins, second is kept opaque with an issue',
    dupCompiled.rules.length === 1 && dupCompiled.opaqueNodeIds.includes('b2')
    && dupCompiled.issues.some((i) => i.reason === 'duplicate-rule-id'));
}

console.log(`stage5-pipeline-compiler-s2: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
