#!/usr/bin/env node
// stage5-pipeline-canvas-s4.test.mjs — Limit plan stage 5,
// slice S4: the canvas editing surface. Decisions:
// STAGE5_DECISIONS.md 分岐B (a rule-box opens into its
// fine-grained fragment and collapses back), 分岐C (the
// column view and the canvas view are two views of ONE
// data — both edit the same core and save through
// lib/pipelinePersist.ts), 分岐D (a type-mismatched wire
// is refused with a visible conversion proposal; the
// conversion node is inserted only when the user accepts).
//
// The pure editing operations live in lib/pipelineCanvas.ts;
// the React section is a thin shell over them (its wiring
// is covered by the build, per the earlier slices' custom).
//
// Pins:
// (a) palette + insertion: every registry kind except
//     opaque is offered; inserting mints readable unique
//     ids and the graph stays valid; unknown kinds refuse;
// (b) removal drops incident edges and child claims, the
//     enable toggle flips only the named node;
// (c) wiring: same-type and the two implicit conversions
//     connect; Vec3 -> Scalar is REFUSED (graph unchanged)
//     with a Length proposal; accepting the proposal
//     inserts the visible conversion node and the chain
//     type-checks; a proposal with no known node inserts
//     nothing; disconnect removes exactly one edge;
//     cycles and self-loops refuse;
// (d) rule-box open / close: opening one box expands only
//     that box and the projection compiles to the same
//     rules as the closed core; closing restores the box
//     (params / label / enabled) and the core round-trips;
// (e) column view: rows are the rule rows + the force
//     chain of the same graph; moving a force row rebuilds
//     the chain so the compiled force-order key follows;
//     moving a rule row changes document (evaluation)
//     order; column edits and canvas edits land on the
//     same core and save through the S3 save function;
// (f) positions are a view preference: the layout helpers
//     round-trip through storage, the deterministic
//     fallback never overlaps in a column, and a saved
//     config patch contains no position data (the patch
//     is exactly the S3 three keys);
// (g) unused = legacy: an unset config loads as 'empty'
//     and the editor's empty core is the empty graph.
//
// Run: node scripts/stage5-pipeline-canvas-s4.test.mjs

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

const CV = await load('lib/pipelineCanvas.ts');
const P = await load('lib/pipelineGraph.ts');
const C = await load('lib/pipelineCompiler.ts');
const PS = await load('lib/pipelinePersist.ts');
const F = await load('lib/gpgpuForceOrder.ts');

const graphOf = (nodes, edges = []) => P.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;
const node = (id, kind, extra = {}) => ({ id, kind, label: id, enabled: true, ...extra });

// ---- (a) palette + insertion -------------------------------------------------
{
  const kinds = CV.pipelinePaletteKinds();
  check('a1 palette excludes opaque', !kinds.includes('opaque'));
  check('a2 palette covers the registry core kinds',
    ['rule-box', 'expression', 'logic-and', 'vec-length', 'force-gate', 'force-chunk', 'sim-var']
      .every((k) => kinds.includes(k)));
  const empty = PS.EMPTY_PIPELINE_GRAPH;
  const first = CV.addPipelineNode(empty, 'expression', { params: { expr: 'age > 1' } });
  check('a3 insert into the empty graph works', first !== null && first.graph.nodes.length === 1);
  check('a4 inserted node carries kind defaults + caller params',
    first.node.kind === 'expression' && first.node.params.expr === 'age > 1' && first.node.enabled === true);
  const second = CV.addPipelineNode(first.graph, 'expression');
  check('a5 repeated insert mints a unique readable id',
    second !== null && second.node.id !== first.node.id && second.graph.nodes.length === 2);
  check('a6 unknown kind is refused', CV.addPipelineNode(empty, 'no-such-kind') === null);
  check('a7 opaque cannot be inserted from the palette', CV.addPipelineNode(empty, 'opaque') === null);
}

// ---- (b) removal + enable toggle ----------------------------------------------
{
  const g = graphOf([
    node('box', 'rule-box', { children: ['cond'] }),
    node('cond', 'expression'),
    node('act', 'kill'),
  ], [
    { id: 'e1', from: 'cond', to: 'act', kind: 'data', fromPort: 'bool', toPort: 'condition' },
  ]);
  const removed = CV.removePipelineNode(g, 'cond');
  check('b1 removal drops the node', removed !== null && !removed.nodes.some((n) => n.id === 'cond'));
  check('b2 removal drops incident edges', removed !== null && removed.edges.length === 0);
  check('b3 removal drops child claims on the node',
    removed !== null && (removed.nodes.find((n) => n.id === 'box').children ?? []).length === 0);
  check('b4 removing an absent node returns null', CV.removePipelineNode(g, 'ghost') === null);
  const toggled = CV.setPipelineNodeEnabled(g, 'act', false);
  check('b5 toggle flips only the named node',
    toggled !== null
    && toggled.nodes.find((n) => n.id === 'act').enabled === false
    && toggled.nodes.find((n) => n.id === 'cond').enabled === true);
  check('b6 toggling an absent node returns null', CV.setPipelineNodeEnabled(g, 'ghost', false) === null);
}

// ---- (c) wiring: connect / proposal / accept / disconnect ----------------------
{
  const base = graphOf([
    node('vel', 'sim-var'),
    node('len', 'vec-length'),
    node('gate', 'force-gate'),
    node('cmp', 'compare'),
  ]);
  const okWire = CV.connectPipelineNodes(base, { from: 'vel', to: 'len', fromPort: 'vec', toPort: 'vec' });
  check('c1 same-type wire connects', okWire.ok === true && okWire.graph.edges.length === 1);
  const implicit = CV.connectPipelineNodes(base, { from: 'cmp', to: 'gate', fromPort: 'result', toPort: 'condition' });
  // compare result is Bool, gate condition is Bool — same type; use Bool->Scalar instead:
  const boolScalar = CV.connectPipelineNodes(base, { from: 'cmp', to: 'len', fromPort: 'result', toPort: 'vec' });
  check('c2 Bool -> Vec3 is not an implicit conversion (refused)', boolScalar.ok === false);
  check('c3 same-type Bool wire connects', implicit.ok === true);

  // Vec3 -> Scalar (sim-var value is Scalar; use vec output into compare a: Scalar)
  const refused = CV.connectPipelineNodes(base, { from: 'vel', to: 'cmp', fromPort: 'vec', toPort: 'a' });
  check('c4 Vec3 -> Scalar wire is refused', refused.ok === false && refused.reason === 'type-mismatch');
  check('c5 refusal carries a Length insertion proposal',
    refused.proposal !== undefined
    && refused.proposal.fromType === 'Vec3' && refused.proposal.toType === 'Scalar'
    && sameJson(refused.proposal.insertNodeKinds, ['vec-length']));
  check('c6 refusal leaves the graph unchanged (no silent conversion)',
    base.edges.length === 0);

  // The proposal names an edge that must exist to be applied:
  // build the would-be edge by hand, then apply against a
  // graph that carries it as an unchecked edge is impossible
  // (validation allows it; only the type checker objects) —
  // so apply on a graph whose edge list contains the raw wire.
  const rawGraph = graphOf([
    node('vel', 'sim-var'),
    node('cmp', 'compare'),
  ], [
    { id: 'raw-wire', from: 'vel', to: 'cmp', kind: 'data', fromPort: 'vec', toPort: 'a' },
  ]);
  const proposal = { ...refused.proposal, edgeId: 'raw-wire' };
  const applied = CV.applyPipelineConversionProposal(rawGraph, proposal);
  check('c7 accepting the proposal inserts the conversion node',
    applied !== null && applied.nodes.some((n) => n.kind === 'vec-length'));
  check('c8 the inserted chain type-checks clean',
    applied !== null && P.checkPipelineGraphTypes(applied).ok === true);
  check('c9 the original direct wire is replaced by the chain',
    applied !== null && !applied.edges.some((e) => e.from === 'vel' && e.to === 'cmp'));
  check('c10 applying a proposal with no known node inserts nothing',
    CV.applyPipelineConversionProposal(rawGraph, { ...proposal, insertNodeKinds: [] }) === null);
  check('c11 applying a stale proposal returns null',
    CV.applyPipelineConversionProposal(base, proposal) === null);

  // The editor's accept path: the refused wire was never
  // added, so the proposal is applied from the wire itself.
  const accepted = CV.applyPipelineConversionForWire(base,
    { from: 'vel', to: 'cmp', fromPort: 'vec', toPort: 'a' }, refused.proposal);
  check('c6b accepting via the wire inserts Length and type-checks',
    accepted !== null && accepted.nodes.some((n) => n.kind === 'vec-length')
    && P.checkPipelineGraphTypes(accepted).ok === true);
  const renamed = CV.updatePipelineNode(base, 'gate', { label: 'Renamed gate' });
  check('c6c inspector rename updates only the label',
    renamed !== null && renamed.nodes.find((n) => n.id === 'gate').label === 'Renamed gate');

  const disconnected = CV.disconnectPipelineEdge(okWire.graph, okWire.edge.id);
  check('c12 disconnect removes exactly that edge',
    disconnected !== null && disconnected.edges.length === 0 && disconnected.nodes.length === 4);
  check('c13 disconnecting an absent edge returns null',
    CV.disconnectPipelineEdge(base, 'ghost') === null);
  check('c14 self-loop is refused',
    CV.connectPipelineNodes(base, { from: 'len', to: 'len', fromPort: 'value', toPort: 'vec' }).ok === false);
  const cyclic = CV.connectPipelineNodes(okWire.graph, { from: 'len', to: 'vel', fromPort: 'value', toPort: 'in' });
  check('c15 a wire that would cycle is refused', cyclic.ok === false);
  const dup = CV.connectPipelineNodes(okWire.graph, { from: 'vel', to: 'len', fromPort: 'vec', toPort: 'vec' });
  check('c16 a duplicate wire is refused', dup.ok === false && dup.reason === 'duplicate-edge');
}

// ---- (d) rule-box open / close ---------------------------------------------------
{
  const rule = { id: 'r1', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'force-gate', force: 'wind' } };
  const core = graphOf([
    node('box1', 'rule-box', { label: 'Wind gate', params: { force: 'wind', ruleId: 'wind-gate', condition: 'age > 0.5', actionKind: 'force-gate' } }),
    node('box2', 'rule-box', { label: 'Second', params: { condition: 'vel > 2', actionKind: 'kill' } }),
    node('src', 'pool-source'),
  ], [
    { id: 'f1', from: 'src', to: 'box1', kind: 'flow' },
  ]);
  const view = CV.projectPipelineCanvas(core, ['box1']);
  check('d1 opening expands the named box into cond + action',
    view.nodes.some((n) => n.id === 'box1:cond' && n.kind === 'expression')
    && view.nodes.some((n) => n.id === 'box1:action' && n.kind === 'force-gate'));
  check('d2 the other box stays closed', view.nodes.some((n) => n.id === 'box2' && n.kind === 'rule-box'));
  check('d3 edges that touched the box rewire to its action node',
    view.edges.some((e) => e.from === 'src' && e.to === 'box1:action'));
  check('d4 the opened projection compiles to the same rules as the closed core',
    sameJson(C.compilePipelineGraphToLiveRules(view).rules, C.compilePipelineGraphToLiveRules(core).rules));
  const closed = CV.collapsePipelineRuleBox(view, 'box1');
  check('d5 closing restores the box with its params / label / enabled',
    closed !== null
    && closed.nodes.find((n) => n.id === 'box1')?.params?.condition === 'age > 0.5'
    && closed.nodes.find((n) => n.id === 'box1')?.params?.actionKind === 'force-gate'
    && closed.nodes.find((n) => n.id === 'box1')?.label === 'Wind gate');
  check('d6 open + close round-trips the whole core',
    closed !== null && sameJson(JSON.parse(P.serializePipelineGraph(closed)), JSON.parse(P.serializePipelineGraph(core))));
  check('d7 expanding a non-box returns null', CV.expandPipelineRuleBox(core, 'src') === null);
  check('d8 the stored core is untouched by the view projection', core.nodes.some((n) => n.id === 'box1'));
  void rule;
}

// ---- (e) column view: one data, two views ----------------------------------------
{
  // A NON-default order (the first three chunk names reversed),
  // or pipelineGraphFromRowList adds no chain at all.
  const chainNames = [...F.GPGPU_FORCE_CHUNK_NAMES.slice(0, 3)].reverse();
  const core = PS.pipelineGraphFromRowList(
    JSON.stringify([
      { id: 'ra', enabled: true, target: { type: 'all' }, condition: 'age > 1', action: { type: 'kill' } },
      { id: 'rb', enabled: true, target: { type: 'all' }, condition: 'age > 2', action: { type: 'kill' } },
    ]),
    F.serializeGpgpuForceOrder(chainNames),
  );
  // The force graph always carries the FULL normalised order
  // (normalizeGpgpuForceOrder fills the missing chunks in).
  const fullOrder = [...chainNames, ...F.GPGPU_FORCE_CHUNK_NAMES.slice(3)];
  const movedOrder = [fullOrder[0], fullOrder[2], fullOrder[1], ...fullOrder.slice(3)];
  const rows = CV.pipelineColumnRows(core);
  check('e1 column rows list the rule rows in order',
    rows.rules.length === 2 && rows.rules[0].params.rule.id === 'ra' && rows.rules[1].params.rule.id === 'rb');
  check('e2 column rows list the force chain in chain order',
    rows.forces.length === fullOrder.length
    && rows.forces.every((n, i) => n.params.chunk === fullOrder[i]));

  const movedForce = CV.movePipelineColumnRow(core, rows.forces[2].id, -1);
  check('e3 moving a force row up changes the compiled force-order key',
    movedForce !== null
    && C.pipelineGraphToForceOrderKey(movedForce) !== C.pipelineGraphToForceOrderKey(core)
    && C.pipelineGraphToForceOrderKey(movedForce)
      === F.serializeGpgpuForceOrder(movedOrder));
  check('e4 the moved chain is what the column shows afterwards',
    movedForce !== null
    && CV.pipelineColumnRows(movedForce).forces[1].params.chunk === fullOrder[2]);

  const movedRule = CV.movePipelineColumnRow(core, rows.rules[1].id, -1);
  check('e5 moving a rule row up swaps the evaluation (document) order',
    movedRule !== null
    && C.compilePipelineGraphToLiveRules(movedRule).rules.map((r) => r.id).join(',') === 'rb,ra');
  check('e6 moving past the end returns null',
    CV.movePipelineColumnRow(core, rows.rules[0].id, -1) === null);

  // Both views save through the same S3 function onto the same core.
  const canvasEdited = CV.setPipelineNodeEnabled(core, rows.rules[0].id, false);
  const savedCanvas = PS.savePipelineGraphToConfig(canvasEdited);
  const savedColumn = PS.savePipelineGraphToConfig(movedForce);
  check('e7 canvas edit and column edit both save through the graph save',
    savedCanvas.ok === true && savedColumn.ok === true
    && savedCanvas.patch.gpgpuForceOrder === C.pipelineGraphToForceOrderKey(core)
    && savedCanvas.patch.gpgpuPipelineGraph !== savedColumn.patch.gpgpuPipelineGraph);
  check('e8 the column force edit is in the saved row-list representation',
    savedColumn.patch.gpgpuForceOrder
      === F.serializeGpgpuForceOrder(movedOrder));
}

// ---- (f) positions: view preference only ------------------------------------------
{
  const storage = {
    data: new Map(),
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
    setItem(k, v) { this.data.set(k, v); },
    removeItem(k) { this.data.delete(k); },
  };
  const layout = { n1: { x: 10, y: 20 }, n2: { x: 300, y: 20 } };
  check('f1 layout persists', CV.persistPipelineCanvasLayout(storage, layout) === true);
  check('f2 layout round-trips through storage',
    sameJson(CV.loadPipelineCanvasLayout(storage), layout));
  check('f3 layout lives under its own storage key (never the config)',
    storage.data.has(CV.PIPELINE_CANVAS_LAYOUT_STORAGE_KEY));
  const g = graphOf([node('a', 'expression'), node('b', 'expression'), node('c', 'kill')]);
  const auto = CV.layoutPipelineCanvasNodes(g, {});
  check('f4 fallback layout is deterministic and non-overlapping',
    sameJson(auto, CV.layoutPipelineCanvasNodes(g, {}))
    && new Set(Object.values(auto).map((p) => `${p.x},${p.y}`)).size === 3);
  check('f5 a saved position wins over the fallback',
    CV.layoutPipelineCanvasNodes(g, { a: { x: 999, y: 888 } }).a.x === 999);
  const saved = PS.savePipelineGraphToConfig(g);
  check('f6 the config patch is exactly the S3 three keys (no positions)',
    saved.ok === true
    && sameJson(Object.keys(saved.patch).sort(),
      ['gpgpuForceOrder', 'gpgpuParticleRulesLive', 'gpgpuPipelineGraph']));
}

// ---- (g) unused = legacy -----------------------------------------------------------
{
  const loaded = PS.loadPipelineCore({});
  check('g1 an unset config loads as empty', loaded.source === 'empty');
  check('g2 the empty core has no rows in either view',
    CV.pipelineColumnRows(loaded.graph).rules.length === 0
    && CV.pipelineColumnRows(loaded.graph).forces.length === 0);
  check('g3 projecting the empty core opens nothing',
    CV.projectPipelineCanvas(loaded.graph, ['anything']).nodes.length === 0);
}

console.log(`stage5-pipeline-canvas-s4: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
