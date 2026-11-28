#!/usr/bin/env node
// stage5-pipeline-graph-s1.test.mjs — Limit plan stage 5,
// slice S1: pipeline graph core (pure layer). Decisions:
// STAGE5_DECISIONS.md 分岐A (one graph core), 分岐B
// (rule-box hierarchy), 分岐D (strict types, proposals not
// silent conversions). Materials: STAGE5_DESIGN_MATERIALS.md
// §2/§3/§8.5. Model: lib/pipelineGraph.ts.
//
// Pins:
// (a) model + validation: serialise/parse round trip is
//     lossless; broken payloads are refused wholesale with a
//     reason (format, duplicate ids, missing endpoints,
//     unknown kinds, cycles, bad rule-box children);
// (b) registry: the core node kinds exist with typed ports,
//     force-chunk names resolve against the real chunk list;
// (c) type checker: same-type wires pass, Bool->Scalar and
//     StateId->Scalar are the only implicit conversions, and
//     Vec3->Scalar yields a structured Length-insertion
//     proposal instead of a silent conversion;
// (d) evaluation order: topological with document-order
//     tie-break, deterministic across runs;
// (e) logic lowering: And -> product, Or -> clamped sum,
//     Not -> (1.0 - x), Xor -> symmetric form; the lowered
//     forms evaluate to boolean truth tables;
// (f) rule-box hierarchy: a box expands to expression +
//     action nodes and collapses back to the same box;
// (g) designer-blocks-v1 compatibility: a designer model
//     converts to a pipeline graph and back without loss.
//
// Run: node scripts/stage5-pipeline-graph-s1.test.mjs

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

const P = await load('lib/pipelineGraph.ts');
const D = await load('lib/designerBlocks.ts');
const R = await load('lib/gpgpuParticleRules.ts');
const G = await load('lib/gpgpuGroups.ts');

// ---- fixtures ---------------------------------------------------------------
const graph = {
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'pool', kind: 'pool-source', label: 'Pool', enabled: true },
    { id: 'age', kind: 'sim-var', label: 'Age', enabled: true, params: { name: 'age' } },
    { id: 'band1', kind: 'band', label: 'Age band', enabled: true, params: { low: 0.5, high: 0.9 } },
    { id: 'gate', kind: 'force-gate', label: 'Gate wind', enabled: true, params: { force: 'wind' } },
    {
      id: 'rule:kill-old', kind: 'rule-box', label: 'Kill old', enabled: false,
      params: { condition: 'age > 0.9', actionKind: 'kill', force: 'gravity' },
    },
  ],
  edges: [
    { id: 'e1', from: 'age', to: 'band1', kind: 'data', fromPort: 'value', toPort: 'value' },
    { id: 'e2', from: 'band1', to: 'gate', kind: 'data', fromPort: 'result', toPort: 'condition' },
    { id: 'e3', from: 'pool', to: 'gate', kind: 'data', fromPort: 'group', toPort: 'target' },
    { id: 'e4', from: 'gate', to: 'rule:kill-old', kind: 'sequence' },
  ],
};

// ---- (a) model + validation ---------------------------------------------------
{
  const v = P.validatePipelineGraph(graph);
  check('a1 fixture graph validates', v.ok);
  const text = P.serializePipelineGraph(v.graph);
  const back = P.parsePipelineGraph(text);
  check('a2 serialise/parse round trip is lossless', sameJson(back, v.graph));
  check('a3 empty text parses to null', P.parsePipelineGraph('') === null);
  check('a4 garbage parses to null', P.parsePipelineGraph('{nope') === null);

  const refuse = (name, mutate, reason) => {
    const broken = JSON.parse(JSON.stringify(graph));
    mutate(broken);
    const r = P.validatePipelineGraph(broken);
    check(name, !r.ok && r.reason === reason);
  };
  refuse('a5 format mismatch refused', (b) => { b.format = 'pipeline-graph-v0'; }, 'format-mismatch');
  refuse('a6 duplicate node id refused', (b) => { b.nodes.push({ ...b.nodes[0] }); }, 'duplicate-node-id');
  refuse('a7 duplicate edge id refused', (b) => { b.edges.push({ ...b.edges[0] }); }, 'duplicate-edge-id');
  refuse('a8 missing endpoint refused', (b) => { b.edges[0].to = 'ghost'; }, 'edge-endpoint-missing');
  refuse('a9 unknown node kind refused', (b) => { b.nodes[0].kind = 'no-such-kind'; }, 'invalid-node');
  refuse('a10 cycle refused', (b) => {
    b.edges.push({ id: 'e9', from: 'rule:kill-old', to: 'age', kind: 'flow' });
  }, 'cycle-detected');
  refuse('a11 self-loop refused as cycle', (b) => {
    b.edges.push({ id: 'e9', from: 'age', to: 'age', kind: 'flow' });
  }, 'cycle-detected');
  refuse('a12 child missing refused', (b) => { b.nodes[4].children = ['ghost']; }, 'child-node-missing');
  refuse('a13 child self-reference refused', (b) => { b.nodes[4].children = ['rule:kill-old']; }, 'child-self-reference');
  refuse('a14 nodes not array refused', (b) => { b.nodes = {}; }, 'nodes-not-array');
  check('a15 serialise of invalid graph throws', (() => {
    try { P.serializePipelineGraph({ format: 'pipeline-graph-v1', nodes: [], edges: [{ id: 'x', from: 'a', to: 'b', kind: 'data' }] }); return false; }
    catch { return true; }
  })());
}

// ---- (b) registry ---------------------------------------------------------------
{
  const requiredKinds = [
    'rule-box', 'expression', 'compare', 'band', 'state-is', 'group-is',
    'logic-and', 'logic-or', 'logic-not', 'logic-xor',
    'math-add', 'math-mul', 'math-clamp', 'math-ternary', 'math-func',
    'vec-length', 'vec-split', 'vec-make', 'vec-dot', 'vec-cross',
    'bool-to-scalar', 'state-to-scalar', 'map-range',
    'force-gate', 'set-state', 'set-group', 'kill', 'true-kill',
    'fracture', 'display', 'spawn', 'custom-force', 'force-chunk',
    'constant', 'sim-var', 'slot-read', 'hit', 'prev', 'group-aggregate',
    'channel-read', 'channel-write',
  ];
  check('b1 all core node kinds are registered',
    requiredKinds.every((k) => P.pipelineNodeDefinition(k) !== null));
  check('b2 unknown kind has no definition', P.pipelineNodeDefinition('nope') === null);
  check('b3 compare ports are Scalar in, Bool out',
    P.pipelinePortType('compare', 'input', 'a') === 'Scalar'
    && P.pipelinePortType('compare', 'output', 'result') === 'Bool');
  check('b4 force-gate target port is Group',
    P.pipelinePortType('force-gate', 'input', 'target') === 'Group');
  check('b5 display output is Display type',
    P.pipelinePortType('display', 'output', 'display') === 'Display');
  check('b6 value types are exactly the seven of DESIGN §2',
    sameJson([...P.PIPELINE_VALUE_TYPES],
      ['Scalar', 'Vec3', 'Bool', 'StateId', 'Mask', 'Group', 'Display']));
  check('b7 force-chunk resolves a real chunk name',
    P.pipelineForceChunkName({ id: 'f', kind: 'force-chunk', label: 'F', enabled: true, params: { chunk: 'wind' } }) === 'wind');
  check('b8 force-chunk rejects an unknown chunk name',
    P.pipelineForceChunkName({ id: 'f', kind: 'force-chunk', label: 'F', enabled: true, params: { chunk: 'nope' } }) === null);
}

// ---- (c) type checker -------------------------------------------------------------
{
  const typed = (edges) => ({
    format: 'pipeline-graph-v1',
    nodes: [
      { id: 'v', kind: 'sim-var', label: 'V', enabled: true },
      { id: 'cmp', kind: 'compare', label: 'C', enabled: true },
      { id: 'add', kind: 'math-add', label: 'A', enabled: true },
      { id: 'st', kind: 'state-is', label: 'S', enabled: true },
    ],
    edges,
  });
  // Bool -> Scalar is sanctioned implicit (compare.result -> math-add.a).
  const implicit = P.checkPipelineGraphTypes(typed([
    { id: 'w1', from: 'cmp', to: 'add', kind: 'data', fromPort: 'result', toPort: 'a' },
  ]));
  check('c1 Bool->Scalar passes as implicit', implicit.ok
    && implicit.issues[0].status === 'implicit' && implicit.proposals.length === 0);
  // StateId -> Scalar likewise (sim-var has no StateId out; use state via
  // expression bool port instead — StateId source is state-is input side, so
  // exercise the pair table directly through a vec/state wire below).
  check('c2 implicit table holds exactly the two sanctioned pairs',
    P.isPipelineImplicitConversion('Bool', 'Scalar')
    && P.isPipelineImplicitConversion('StateId', 'Scalar')
    && !P.isPipelineImplicitConversion('Vec3', 'Scalar')
    && !P.isPipelineImplicitConversion('Scalar', 'Bool')
    && P.PIPELINE_IMPLICIT_CONVERSIONS.length === 2);
  // Vec3 -> Scalar must propose a Length node, never convert silently.
  const bad = P.checkPipelineGraphTypes(typed([
    { id: 'w2', from: 'v', to: 'add', kind: 'data', fromPort: 'vec', toPort: 'a' },
  ]));
  check('c3 Vec3->Scalar is not ok', !bad.ok);
  check('c4 Vec3->Scalar proposes Length insertion',
    bad.proposals.length === 1
    && bad.proposals[0].insertNodeKinds.length === 1
    && bad.proposals[0].insertNodeKinds[0] === 'vec-length'
    && bad.proposals[0].fromType === 'Vec3' && bad.proposals[0].toType === 'Scalar');
  // Same-type wire passes cleanly.
  const good = P.checkPipelineGraphTypes(typed([
    { id: 'w3', from: 'v', to: 'cmp', kind: 'data', fromPort: 'value', toPort: 'a' },
  ]));
  check('c5 Scalar->Scalar passes', good.ok && good.issues[0].status === 'ok');
  // Unknown port is reported, not silently accepted.
  const unknown = P.checkPipelineGraphTypes(typed([
    { id: 'w4', from: 'v', to: 'cmp', kind: 'data', fromPort: 'nope', toPort: 'a' },
  ]));
  check('c6 unknown port reported', !unknown.ok && unknown.issues[0].status === 'unknown-port');
  // Flow edges carry order only and are skipped by the checker.
  const flowOnly = P.checkPipelineGraphTypes(typed([
    { id: 'w5', from: 'v', to: 'cmp', kind: 'flow' },
  ]));
  check('c7 flow edges are skipped', flowOnly.ok && flowOnly.issues.length === 0);
}

// ---- (d) evaluation order ------------------------------------------------------------
{
  const order = P.topologicalOrderPipelineGraph(P.validatePipelineGraph(graph).graph);
  check('d1 order respects every edge', (() => {
    const pos = new Map(order.map((id, i) => [id, i]));
    return graph.edges.every((e) => pos.get(e.from) < pos.get(e.to));
  })());
  check('d2 document order breaks ties (pool before age-independent nodes)',
    order[0] === 'pool');
  const again = P.topologicalOrderPipelineGraph(P.validatePipelineGraph(graph).graph);
  check('d3 order is deterministic', sameJson(order, again));
  const cyclic = {
    format: 'pipeline-graph-v1',
    nodes: [
      { id: 'a', kind: 'constant', label: 'A', enabled: true },
      { id: 'b', kind: 'constant', label: 'B', enabled: true },
    ],
    edges: [
      { id: 'x', from: 'a', to: 'b', kind: 'flow' },
      { id: 'y', from: 'b', to: 'a', kind: 'flow' },
    ],
  };
  check('d4 cyclic order returns null', P.topologicalOrderPipelineGraph(cyclic) === null);
}

// ---- (e) logic lowering ------------------------------------------------------------------
{
  const leaf = (expr) => ({ logic: 'leaf', expr });
  check('e1 And lowers to a product',
    P.lowerLogicTreeToExpression({ logic: 'and', args: [leaf('a'), leaf('b')] }) === '(a) * (b)');
  check('e2 Or lowers to a clamped sum',
    P.lowerLogicTreeToExpression({ logic: 'or', args: [leaf('a'), leaf('b')] }) === 'clamp((a) + (b), 0.0, 1.0)');
  check('e3 Not lowers to (1.0 - x)',
    P.lowerLogicTreeToExpression({ logic: 'not', arg: leaf('a') }) === '(1.0 - (a))');
  // Truth tables through a tiny evaluator over the lowered arithmetic.
  const ev = (text, vars) => {
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const fn = Function('a', 'b', 'c', 'clamp', `return (${text});`);
    return fn(vars.a ?? 0, vars.b ?? 0, vars.c ?? 0, clamp);
  };
  const andT = P.lowerLogicTreeToExpression({ logic: 'and', args: [leaf('a'), leaf('b')] });
  const orT = P.lowerLogicTreeToExpression({ logic: 'or', args: [leaf('a'), leaf('b')] });
  const notT = P.lowerLogicTreeToExpression({ logic: 'not', arg: leaf('a') });
  const xorT = P.lowerLogicTreeToExpression({ logic: 'xor', args: [leaf('a'), leaf('b')] });
  let truth = true;
  for (const a of [0, 1]) for (const b of [0, 1]) {
    if (ev(andT, { a, b }) !== a * b) truth = false;
    if (ev(orT, { a, b }) !== Math.max(a, b)) truth = false;
    if (ev(xorT, { a, b }) !== (a ^ b)) truth = false;
    if (ev(notT, { a }) !== 1 - a) truth = false;
  }
  check('e4 lowered forms match boolean truth tables', truth);
  check('e5 node-level lowering matches tree lowering',
    P.lowerLogicNodeToExpression('logic-and', ['a', 'b']) === andT
    && P.lowerLogicNodeToExpression('logic-not', ['a']) === notT
    && P.lowerLogicNodeToExpression('math-add', ['a', 'b']) === null);
  // Nested: And(Or(a,b), Not(c)) — the P1x shape.
  const nested = P.lowerLogicTreeToExpression({
    logic: 'and',
    args: [{ logic: 'or', args: [leaf('a'), leaf('b')] }, { logic: 'not', arg: leaf('c') }],
  });
  check('e6 nested lowering composes',
    nested === 'clamp((a) + (b), 0.0, 1.0) * (1.0 - (c))');
}

// ---- (f) rule-box hierarchy ------------------------------------------------------------------
{
  const box = graph.nodes[4];
  const frag = P.expandRuleBoxNode(box);
  check('f1 box expands to expression + action nodes',
    frag !== null && frag.nodes.length === 2
    && frag.nodes[0].kind === 'expression' && frag.nodes[1].kind === 'kill');
  check('f2 expansion carries the condition text',
    frag.nodes[0].params.expr === 'age > 0.9');
  check('f3 expansion carries the remaining box params on the action node',
    frag.nodes[1].params.force === 'gravity');
  check('f4 non-box nodes do not expand',
    P.expandRuleBoxNode(graph.nodes[0]) === null);

  const expanded = P.expandPipelineGraph(P.validatePipelineGraph(graph).graph);
  const ev = P.validatePipelineGraph(expanded);
  check('f5 expanded graph validates', ev.ok);
  check('f6 expanded graph has no rule-box left',
    expanded.nodes.every((n) => n.kind !== 'rule-box'));
  const collapsed = P.collapseRuleBox(expanded, 'rule:kill-old');
  check('f7 collapse rebuilds a rule-box', collapsed !== null
    && collapsed.nodes.some((n) => n.id === 'rule:kill-old' && n.kind === 'rule-box'));
  const rebuilt = collapsed.nodes.find((n) => n.id === 'rule:kill-old');
  check('f8 collapsed box params round-trip',
    rebuilt.params.condition === 'age > 0.9'
    && rebuilt.params.actionKind === 'kill'
    && rebuilt.params.force === 'gravity'
    && rebuilt.label === 'Kill old' && rebuilt.enabled === false);
  check('f9 collapsed graph validates',
    P.validatePipelineGraph(collapsed).ok);
  check('f10 collapse of a missing box returns null',
    P.collapseRuleBox(expanded, 'rule:ghost') === null);
}

// ---- (g) designer-blocks-v1 compatibility -------------------------------------------------------
{
  const rules = [
    R.validateParticleRule({
      id: 'r1', name: '重み', enabled: true,
      target: { type: 'group', id: 'g1' }, condition: '',
      action: { type: 'force-gate', force: 'gravity' },
    }),
    R.validateParticleRule({
      id: 'r2', enabled: true,
      target: { type: 'group', id: 'ghost' }, condition: 'age > 0.5',
      action: { type: 'kill' },
    }),
  ];
  const groups = G.parseGpgpuGroups(JSON.stringify([
    { id: 'g1', name: 'G1', source: { type: 'all' } },
  ]));
  const model = D.buildDesignerBlockModel(rules, groups);
  const converted = P.pipelineGraphFromDesignerBlocks(model);
  check('g1 designer model converts to a pipeline graph', converted.ok);
  check('g2 node kinds map (source/group/rule)',
    converted.graph.nodes.some((n) => n.kind === 'pool-source')
    && converted.graph.nodes.some((n) => n.kind === 'group-def')
    && converted.graph.nodes.filter((n) => n.kind === 'rule-box').length === 2);
  check('g3 dangling group mark survives conversion',
    converted.graph.nodes.some((n) => n.id === 'group:ghost' && n.dangling === true));
  const backAgain = P.designerBlocksFromPipelineGraph(converted.graph);
  check('g4 conversion back is lossless', sameJson(backAgain, model));
  const viaText = P.pipelineGraphFromDesignerBlocks(
    JSON.parse(D.serializeDesignerBlockModel(model)));
  check('g5 conversion works from serialised designer text form', viaText.ok
    && sameJson(P.designerBlocksFromPipelineGraph(viaText.graph), model));
  check('g6 broken designer payload is refused with its reason',
    !P.pipelineGraphFromDesignerBlocks({ format: 'designer-blocks-v0', nodes: [], edges: [] }).ok);
  check('g7 graphs with non-designer nodes refuse the way back',
    P.designerBlocksFromPipelineGraph(P.validatePipelineGraph(graph).graph) === null);
}

console.log(`stage5-pipeline-graph-s1: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
