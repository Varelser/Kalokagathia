#!/usr/bin/env node
// layer1-wp10-graph-cluster.test.mjs — Layer 1 WP10,
// phase D2: GH cluster grammar (option (a) of
// LAYER1_WP10_PHASED_MATERIAL.md branch 2 — grammar
// first, in the isolated tree only). A `cluster` node
// encapsulates a subgraph (params.graph, a full
// pipeline-graph-v1 document) behind typed ports
// declared by the subgraph's cluster-input /
// cluster-output boundary nodes; the compiler inlines
// clusters before evaluating. This is layer-1 grammar
// only and takes no position on TD §7. Model:
// lib/pipelineGraph.ts, lib/pipelineCompiler.ts.
//
// Pins:
// (a) registry + ports: the three kinds exist, a
//     cluster's effective ports are its subgraph's
//     boundary declarations (typed), and a boundary
//     node's `value` port takes its declared type;
// (b) save round trip: a cluster graph serialises and
//     parses back byte-identically;
// (c) validation refusals: duplicate boundary port,
//     expansion id collision, invalid embedded graph,
//     malformed boundary declaration, cluster without
//     an embedded graph, nesting past the depth cap;
// (d) expansion: the expanded form of the fixture is
//     exactly the hand-written equivalent graph, a
//     cluster-free graph is returned as the same
//     object, an unexpandable cluster is kept verbatim,
//     an unconnected input port drops its boundary wire
//     only, a pass-through wire composes end to end,
//     nested clusters expand recursively, and the
//     cluster's enabled flag ANDs into expanded nodes;
// (e) compile equivalence: the cluster graph and its
//     hand-written expansion compile to identical
//     results (rules, force order, slot assignments),
//     through both compilePipelineGraph and the direct
//     compilePipelineGraphToLiveRules entry;
// (f) type checker: wires into and out of cluster
//     ports resolve against the declared types — a
//     matching wire passes, a Vec3 -> Scalar wire
//     yields the Length insertion proposal;
// (g) no silent loss elsewhere: the designer-blocks
//     conversion refuses a cluster graph (returns
//     null) instead of dropping the cluster.
//
// Run: node scripts/layer1-wp10-graph-cluster.test.mjs

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
const C = await load('lib/pipelineCompiler.ts');

// ---- fixtures ---------------------------------------------------------------

const innerGraph = {
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'in-age', kind: 'cluster-input', label: 'age in', enabled: true, params: { name: 'ageIn', type: 'Scalar' } },
    { id: 'cond', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age > 0.9' } },
    { id: 'coef', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age * 2', outputSlot: 'coef' } },
    { id: 'chunk', kind: 'force-chunk', label: 'curl', enabled: true, params: { chunk: 'curl' } },
    { id: 'act', kind: 'kill', label: 'Kill old', enabled: true, params: {} },
    { id: 'out-mask', kind: 'cluster-output', label: 'mask out', enabled: true, params: { name: 'mask', type: 'Mask' } },
  ],
  edges: [
    { id: 'ie1', from: 'in-age', to: 'cond', kind: 'data', fromPort: 'value', toPort: 'in' },
    { id: 'ie2', from: 'cond', to: 'act', kind: 'data', fromPort: 'bool', toPort: 'condition' },
    { id: 'ie3', from: 'act', to: 'out-mask', kind: 'data', fromPort: 'mask', toPort: 'value' },
  ],
};

const clusterGraph = {
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'src', kind: 'sim-var', label: 'Age var', enabled: true, params: { name: 'age' } },
    { id: 'c1', kind: 'cluster', label: 'Kill cluster', enabled: true, params: { graph: innerGraph } },
    { id: 'gate', kind: 'force-gate', label: 'Gate wind', enabled: true, params: { force: 'wind' } },
  ],
  edges: [
    { id: 'oe1', from: 'src', to: 'c1', kind: 'data', fromPort: 'value', toPort: 'ageIn' },
  ],
};

// The hand-written equivalent of clusterGraph after
// inline expansion: boundary nodes spliced out, inner
// ids prefixed, the boundary wire composed end to end.
const expandedGraph = {
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'src', kind: 'sim-var', label: 'Age var', enabled: true, params: { name: 'age' } },
    { id: 'c1:cond', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age > 0.9' } },
    { id: 'c1:coef', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age * 2', outputSlot: 'coef' } },
    { id: 'c1:chunk', kind: 'force-chunk', label: 'curl', enabled: true, params: { chunk: 'curl' } },
    { id: 'c1:act', kind: 'kill', label: 'Kill old', enabled: true, params: {} },
    { id: 'gate', kind: 'force-gate', label: 'Gate wind', enabled: true, params: { force: 'wind' } },
  ],
  edges: [
    { id: 'oe1~c1:ie1', from: 'src', to: 'c1:cond', kind: 'data', fromPort: 'value', toPort: 'in' },
    { id: 'c1:ie2', from: 'c1:cond', to: 'c1:act', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ],
};

const validCluster = P.validatePipelineGraph(clusterGraph);
check('fixture cluster graph validates', validCluster.ok === true);
const validExpanded = P.validatePipelineGraph(expandedGraph);
check('fixture expanded graph validates', validExpanded.ok === true);

// ---- (a) registry + ports ---------------------------------------------------

check('a1 cluster kind is a container',
  P.pipelineNodeDefinition('cluster')?.category === 'container');
check('a2 boundary kinds exist',
  P.pipelineNodeDefinition('cluster-input') !== null
  && P.pipelineNodeDefinition('cluster-output') !== null);

const clusterNode = validCluster.graph.nodes.find((n) => n.id === 'c1');
check('a3 cluster input ports come from the boundary declarations',
  sameJson(P.pipelineNodePorts(clusterNode, 'input'), [{ name: 'ageIn', type: 'Scalar' }]));
check('a4 cluster output ports come from the boundary declarations',
  sameJson(P.pipelineNodePorts(clusterNode, 'output'), [{ name: 'mask', type: 'Mask' }]));
check('a5 cluster port type resolves by name',
  P.pipelineNodePortType(clusterNode, 'input', 'ageIn') === 'Scalar'
  && P.pipelineNodePortType(clusterNode, 'output', 'mask') === 'Mask'
  && P.pipelineNodePortType(clusterNode, 'input', 'nope') === null);

const boundaryIn = validCluster.ok
  ? P.pipelineClusterEmbeddedGraph(clusterNode).nodes.find((n) => n.id === 'in-age')
  : null;
check('a6 embedded graph is readable through the helper', boundaryIn !== null);
check('a7 a boundary node value port takes its declared type',
  P.pipelineNodePortType(boundaryIn, 'output', 'value') === 'Scalar');
check('a8 boundary declaration parses',
  sameJson(P.pipelineClusterBoundaryPort(boundaryIn), { name: 'ageIn', type: 'Scalar' }));

// ---- (b) save round trip ------------------------------------------------------

const text1 = P.serializePipelineGraph(clusterGraph);
const parsed = P.parsePipelineGraph(text1);
check('b1 cluster graph parses back', parsed !== null);
check('b2 parse(serialize(g)) equals the validated graph',
  parsed !== null && sameJson(parsed, validCluster.graph));
check('b3 serialize round trip is byte-identical',
  parsed !== null && P.serializePipelineGraph(parsed) === text1);

// ---- (c) validation refusals --------------------------------------------------

const graphWithInner = (inner) => ({
  format: 'pipeline-graph-v1',
  nodes: [{ id: 'c1', kind: 'cluster', label: 'C', enabled: true, params: { graph: inner } }],
  edges: [],
});
const refusal = (g) => P.validatePipelineGraph(g);

const dupPort = refusal(graphWithInner({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'i1', kind: 'cluster-input', label: 'a', enabled: true, params: { name: 'x', type: 'Scalar' } },
    { id: 'i2', kind: 'cluster-input', label: 'b', enabled: true, params: { name: 'x', type: 'Scalar' } },
  ],
  edges: [],
}));
check('c1 duplicate boundary port name is refused',
  dupPort.ok === false && dupPort.reason === 'cluster-port-duplicate');

const collision = refusal({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'c1:act', kind: 'kill', label: 'Stray', enabled: true, params: {} },
    { id: 'c1', kind: 'cluster', label: 'C', enabled: true, params: { graph: innerGraph } },
  ],
  edges: [],
});
check('c2 expansion id collision is refused',
  collision.ok === false && collision.reason === 'cluster-id-collision');

const badInner = refusal(graphWithInner({
  format: 'pipeline-graph-v1',
  nodes: [{ id: 'x', kind: 'no-such-kind', label: 'X', enabled: true }],
  edges: [],
}));
check('c3 invalid embedded graph is refused with the inner reason',
  badInner.ok === false && badInner.reason === 'invalid-cluster-graph:invalid-node');

const badBoundary = refusal({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'i1', kind: 'cluster-input', label: 'a', enabled: true, params: { name: 'x', type: 'Nope' } },
  ],
  edges: [],
});
check('c4 malformed boundary declaration is refused',
  badBoundary.ok === false && badBoundary.reason === 'invalid-node');

const noGraph = refusal({
  format: 'pipeline-graph-v1',
  nodes: [{ id: 'c1', kind: 'cluster', label: 'C', enabled: true, params: {} }],
  edges: [],
});
check('c5 cluster without an embedded graph is refused',
  noGraph.ok === false && noGraph.reason === 'invalid-node');

let nested = {
  format: 'pipeline-graph-v1',
  nodes: [{ id: 'leaf', kind: 'constant', label: 'Leaf', enabled: true, params: {} }],
  edges: [],
};
for (let i = 0; i < 9; i += 1) {
  nested = {
    format: 'pipeline-graph-v1',
    nodes: [{ id: 'c', kind: 'cluster', label: 'C', enabled: true, params: { graph: nested } }],
    edges: [],
  };
}
const tooDeep = refusal(nested);
check('c6 nesting past the depth cap is refused',
  tooDeep.ok === false && tooDeep.reason.includes('cluster-too-deep'));

// ---- (d) expansion --------------------------------------------------------------

check('d1 expansion produces exactly the hand-written equivalent',
  sameJson(P.expandPipelineGraphClusters(validCluster.graph), validExpanded.graph));

const clusterFree = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'pool', kind: 'pool-source', label: 'Pool', enabled: true },
    { id: 'gate', kind: 'force-gate', label: 'Gate', enabled: true, params: { force: 'wind' } },
  ],
  edges: [{ id: 'e1', from: 'pool', to: 'gate', kind: 'data', fromPort: 'group', toPort: 'target' }],
}).graph;
check('d2 a cluster-free graph expands to itself (same object)',
  P.expandPipelineGraphClusters(clusterFree) === clusterFree);

const unexpandable = {
  format: 'pipeline-graph-v1',
  nodes: [{
    id: 'c1', kind: 'cluster', label: 'C', enabled: true,
    params: { graph: { format: 'pipeline-graph-v1', nodes: [{ id: 'x', kind: 'nope', label: 'X', enabled: true }], edges: [] } },
  }],
  edges: [],
};
check('d3 an unexpandable cluster is kept verbatim (same object)',
  P.expandPipelineGraphClusters(unexpandable) === unexpandable);

const unconnected = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: [{
    id: 'u1', kind: 'cluster', label: 'U', enabled: true,
    params: {
      graph: {
        format: 'pipeline-graph-v1',
        nodes: [
          { id: 'in', kind: 'cluster-input', label: 'in', enabled: true, params: { name: 'v', type: 'Scalar' } },
          { id: 'cond', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age > 0.1' } },
          { id: 'act', kind: 'kill', label: 'Kill', enabled: true, params: {} },
        ],
        edges: [
          { id: 'e1', from: 'in', to: 'cond', kind: 'data', fromPort: 'value', toPort: 'in' },
          { id: 'e2', from: 'cond', to: 'act', kind: 'data', fromPort: 'bool', toPort: 'condition' },
        ],
      },
    },
  }],
  edges: [],
}).graph;
const unconnectedExpanded = P.expandPipelineGraphClusters(unconnected);
check('d4 unconnected input: boundary node and its wire are gone, the rest stays',
  unconnectedExpanded.nodes.every((n) => n.kind !== 'cluster-input' && n.kind !== 'cluster')
  && unconnectedExpanded.nodes.length === 2
  && unconnectedExpanded.edges.length === 1
  && unconnectedExpanded.edges[0].from === 'u1:cond'
  && unconnectedExpanded.edges[0].to === 'u1:act');
check('d5 unconnected input: the inner rule still compiles from its own condition',
  C.compilePipelineGraphToLiveRules(unconnected).rules.some(
    (r) => r.action.type === 'kill' && r.condition === 'age > 0.1',
  ));

const passThrough = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'src', kind: 'sim-var', label: 'Var', enabled: true, params: { name: 'age' } },
    {
      id: 'pt', kind: 'cluster', label: 'PT', enabled: true,
      params: {
        graph: {
          format: 'pipeline-graph-v1',
          nodes: [
            { id: 'in', kind: 'cluster-input', label: 'in', enabled: true, params: { name: 'v', type: 'Scalar' } },
            { id: 'out', kind: 'cluster-output', label: 'out', enabled: true, params: { name: 'w', type: 'Scalar' } },
          ],
          edges: [{ id: 'e1', from: 'in', to: 'out', kind: 'data', fromPort: 'value', toPort: 'value' }],
        },
      },
    },
    { id: 'sum', kind: 'math-add', label: 'Add', enabled: true, params: {} },
  ],
  edges: [
    { id: 'oe1', from: 'src', to: 'pt', kind: 'data', fromPort: 'value', toPort: 'v' },
    { id: 'oe2', from: 'pt', to: 'sum', kind: 'data', fromPort: 'w', toPort: 'a' },
  ],
}).graph;
const passThroughExpanded = P.expandPipelineGraphClusters(passThrough);
check('d6 pass-through wire composes end to end',
  passThroughExpanded.nodes.length === 2
  && passThroughExpanded.edges.length === 1
  && passThroughExpanded.edges[0].from === 'src'
  && passThroughExpanded.edges[0].to === 'sum'
  && passThroughExpanded.edges[0].fromPort === 'value'
  && passThroughExpanded.edges[0].toPort === 'a');

const nestedCluster = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'src', kind: 'sim-var', label: 'Var', enabled: true, params: { name: 'age' } },
    {
      id: 'o1', kind: 'cluster', label: 'Outer', enabled: true,
      params: {
        graph: {
          format: 'pipeline-graph-v1',
          nodes: [
            { id: 'in1', kind: 'cluster-input', label: 'in', enabled: true, params: { name: 'v', type: 'Scalar' } },
            {
              id: 'i1', kind: 'cluster', label: 'Inner', enabled: true,
              params: {
                graph: {
                  format: 'pipeline-graph-v1',
                  nodes: [
                    { id: 'in2', kind: 'cluster-input', label: 'in', enabled: true, params: { name: 'v', type: 'Scalar' } },
                    { id: 'cond2', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age > 0.5' } },
                    { id: 'act2', kind: 'kill', label: 'Kill', enabled: true, params: {} },
                    { id: 'out2', kind: 'cluster-output', label: 'out', enabled: true, params: { name: 'm', type: 'Mask' } },
                  ],
                  edges: [
                    { id: 'f1', from: 'in2', to: 'cond2', kind: 'data', fromPort: 'value', toPort: 'in' },
                    { id: 'f2', from: 'cond2', to: 'act2', kind: 'data', fromPort: 'bool', toPort: 'condition' },
                    { id: 'f3', from: 'act2', to: 'out2', kind: 'data', fromPort: 'mask', toPort: 'value' },
                  ],
                },
              },
            },
            { id: 'out1', kind: 'cluster-output', label: 'out', enabled: true, params: { name: 'm', type: 'Mask' } },
          ],
          edges: [
            { id: 'e1', from: 'in1', to: 'i1', kind: 'data', fromPort: 'value', toPort: 'v' },
            { id: 'e2', from: 'i1', to: 'out1', kind: 'data', fromPort: 'm', toPort: 'value' },
          ],
        },
      },
    },
  ],
  edges: [{ id: 'oe1', from: 'src', to: 'o1', kind: 'data', fromPort: 'value', toPort: 'v' }],
}).graph;
const nestedExpanded = P.expandPipelineGraphClusters(nestedCluster);
check('d7 nested clusters expand recursively (no cluster or boundary nodes remain)',
  nestedExpanded.nodes.every(
    (n) => n.kind !== 'cluster' && n.kind !== 'cluster-input' && n.kind !== 'cluster-output',
  )
  && nestedExpanded.nodes.some((n) => n.id === 'o1:i1:act2'));
check('d8 nested cluster compiles to the inner rule',
  C.compilePipelineGraphToLiveRules(nestedCluster).rules.some(
    (r) => r.id === 'o1-i1-act2' && r.action.type === 'kill' && r.condition === 'age > 0.5',
  ));

const disabledCluster = JSON.parse(JSON.stringify(clusterGraph));
disabledCluster.nodes.find((n) => n.id === 'c1').enabled = false;
const disabledExpanded = P.expandPipelineGraphClusters(
  P.validatePipelineGraph(disabledCluster).graph,
);
check('d9 a disabled cluster disables its expanded nodes',
  disabledExpanded.nodes.find((n) => n.id === 'c1:act').enabled === false
  && C.compilePipelineGraphToLiveRules(disabledCluster).rules.find(
    (r) => r.id === 'c1-act',
  ).enabled === false);

// ---- (e) compile equivalence ----------------------------------------------------

check('e1 whole-graph compile of cluster graph equals its hand expansion',
  sameJson(C.compilePipelineGraph(clusterGraph), C.compilePipelineGraph(expandedGraph)));
check('e2 direct rules compile equals its hand expansion',
  sameJson(
    C.compilePipelineGraphToLiveRules(clusterGraph),
    C.compilePipelineGraphToLiveRules(expandedGraph),
  ));
const compiled = C.compilePipelineGraph(clusterGraph);
check('e3 the inner kill rule compiles with its wired condition',
  compiled.rules.some(
    (r) => r.id === 'c1-act' && r.action.type === 'kill' && r.condition === 'age > 0.9',
  ));
check('e4 the inner slot request is assigned through the expansion',
  compiled.slots.assignments.some(
    (a) => a.nodeId === 'c1:coef' && a.name === 'coef' && a.slot === 0,
  )
  && compiled.slots.dynExprs[0] === 'age * 2');
check('e5 the inner force chunk reaches the force order',
  C.pipelineGraphToForceOrderKey(clusterGraph) !== ''
  && C.pipelineGraphToForceOrderKey(clusterGraph)
    === C.pipelineGraphToForceOrderKey(expandedGraph));

// ---- (f) type checker --------------------------------------------------------------

const typeOk = P.checkPipelineGraphTypes(passThrough);
check('f1 matching wires through cluster ports pass the type checker',
  typeOk.ok === true && typeOk.issues.every((i) => i.status === 'ok'));

const vecIntoScalar = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: passThrough.nodes,
  edges: [
    { id: 'oe1', from: 'src', to: 'pt', kind: 'data', fromPort: 'vec', toPort: 'v' },
    { id: 'oe2', from: 'pt', to: 'sum', kind: 'data', fromPort: 'w', toPort: 'a' },
  ],
}).graph;
const typeBad = P.checkPipelineGraphTypes(vecIntoScalar);
check('f2 a Vec3 wire into a Scalar cluster port proposes a Length node',
  typeBad.ok === false
  && typeBad.proposals.length === 1
  && typeBad.proposals[0].fromType === 'Vec3'
  && typeBad.proposals[0].toType === 'Scalar'
  && sameJson(typeBad.proposals[0].insertNodeKinds, ['vec-length']));

const typeMask = P.checkPipelineGraphTypes(validCluster.graph);
check('f3 the fixture cluster graph type-checks clean',
  typeMask.ok === true && typeMask.issues.length === 1 && typeMask.issues[0].status === 'ok');

const implicitGraph = P.validatePipelineGraph({
  format: 'pipeline-graph-v1',
  nodes: [
    { id: 'cond', kind: 'expression', label: 'Expression', enabled: true, params: { expr: 'age > 0.5' } },
    { id: 'sum', kind: 'math-add', label: 'Add', enabled: true, params: {} },
  ],
  edges: [{ id: 'e1', from: 'cond', to: 'sum', kind: 'data', fromPort: 'bool', toPort: 'a' }],
}).graph;
const implicitCheck = P.checkPipelineGraphTypes(implicitGraph);
check('f4 pre-existing implicit conversion still resolves (Bool -> Scalar)',
  implicitCheck.ok === true && implicitCheck.issues[0].status === 'implicit');

// ---- (g) no silent loss elsewhere ---------------------------------------------------

check('g1 designer conversion refuses a cluster graph instead of dropping it',
  P.designerBlocksFromPipelineGraph(validCluster.graph) === null);

// ---- summary --------------------------------------------------------------------------

console.log(`layer1-wp10-graph-cluster: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
