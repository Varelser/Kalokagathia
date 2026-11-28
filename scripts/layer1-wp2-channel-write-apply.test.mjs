#!/usr/bin/env node
// layer1-wp2-channel-write-apply.test.mjs — Layer 1 WP2
// phase A: the graph's channel writes are APPLIED to the
// config. Slice S2 built the slot assignment as a pure
// function and slice S3 surfaced it on the graph save
// result without writing it anywhere ("outputs for a
// later slice to apply"); this is that later slice.
// lib/pipelinePersist.ts now folds a claiming graph's
// assignment into the save patch through the EXISTING
// keys gpgpuAttrNames / gpgpuAttrExprs (no new config
// keys), under the discipline in that module's header:
//   - only the graph save applies; no claims -> the
//     patch carries no attribute keys at all (the
//     pre-slice behaviour, bit for bit);
//   - a claimed slot's name and non-empty expression
//     win; unclaimed slots keep the current config's
//     names and expressions untouched;
//   - an empty assignment expression claims the name
//     but never erases a hand-written expression;
//   - rejections apply nothing and stay surfaced with
//     the compiler's reason codes.
//
// Pins:
// (a) application, new name: an expression node's
//     output lands in gpgpuAttrNames / gpgpuAttrExprs at
//     its assigned slot; the patch key set is exactly
//     the three owned keys + the attribute pair (no dyn
//     enable key is ever written by a save);
// (b) application, existing name via a channel-write
//     node: the claimed slot's expression is overwritten
//     by the graph, unclaimed slots' hand-written
//     expressions are preserved verbatim;
// (c) an empty-expr assignment claims the name and
//     leaves the slot's existing expression in place;
// (d) no claims -> invariant: patch is exactly the
//     three owned keys, and applying it leaves a
//     config's attribute arrays untouched; the empty
//     graph still saves as the unset patch; the attr
//     patch helper returns null for null / claim-free
//     slot results;
// (e) rejections: reserved-name / invalid-name /
//     ext-slot-read-only are all surfaced on the save
//     result with their reason codes and apply nothing;
//     a mixed graph applies its valid claim AND surfaces
//     its rejection;
// (f) round trip: save -> apply -> load -> save is
//     idempotent (the second save's assignment comes
//     back as source 'existing' and produces the same
//     patch), and the applied config's dyn expression
//     evaluates — through the attribute module's own
//     compile/evaluate path — to the value the graph
//     wrote, which a downstream condition then reads
//     by name;
// (g) the row-list save never carries attribute keys.
//
// Run: node scripts/layer1-wp2-channel-write-apply.test.mjs

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
const A = await load('lib/gpgpuAttributes.ts');
const X = await load('lib/expression.ts');

const graphOf = (nodes, edges = []) => P.validatePipelineGraph({ format: 'pipeline-graph-v1', nodes, edges }).graph;
const exprNode = (id, outputSlot, expr = 'age * 2.0', kind = 'expression') => ({
  id, kind, label: id, enabled: true, params: { expr, outputSlot },
});
const THREE_KEYS = ['gpgpuForceOrder', 'gpgpuParticleRulesLive', 'gpgpuPipelineGraph'];
const FIVE_KEYS = ['gpgpuAttrExprs', 'gpgpuAttrNames', ...THREE_KEYS];
const COEF_EXPR = 'clamp(smoothstep(0.0, 1.0, age) * 1.5, 0.0, 1.0)';
const CURRENT = { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'], attrExprs: ['', '', '', ''] };

// ---- (a) application: new name ---------------------------------------------------
{
  const saved = PS.savePipelineGraphToConfig(graphOf([exprNode('n1', 'coef', COEF_EXPR)]), CURRENT);
  check('a1 graph save ok', saved.ok === true && saved.patch !== null);
  check('a2 patch key set is the three owned keys + the attribute pair (no enable keys)',
    sameJson(Object.keys(saved.patch).sort(), FIVE_KEYS));
  check('a3 the new name lands at the lowest writable slot',
    sameJson(saved.patch.gpgpuAttrNames, ['coef', 'b', 'c', 'd']));
  check('a4 the dyn expression lands at the same slot',
    sameJson(saved.patch.gpgpuAttrExprs, [COEF_EXPR, '', '', '']));
  check('a5 the assignment is still surfaced on the result',
    saved.slots.assignments.length === 1 && saved.slots.assignments[0].source === 'assigned'
    && saved.slots.assignments[0].slot === 0);
}

// ---- (b) application: existing name, unclaimed slots preserved -------------------
{
  const current = {
    attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'],
    attrExprs: ['hand * 1.0', 'old * 2.0', 'keep * 3.0', ''],
  };
  const saved = PS.savePipelineGraphToConfig(
    graphOf([exprNode('w1', 'b', 'age * 3.0', 'channel-write')]), current);
  check('b1 channel-write node applies through the same path', saved.ok === true);
  check('b2 names are unchanged when the name already exists',
    sameJson(saved.patch.gpgpuAttrNames, ['a', 'b', 'c', 'd']));
  check('b3 the claimed slot takes the graph expression, unclaimed slots keep theirs',
    sameJson(saved.patch.gpgpuAttrExprs, ['hand * 1.0', 'age * 3.0', 'keep * 3.0', '']));
  check('b4 the assignment reports source existing',
    saved.slots.assignments.length === 1 && saved.slots.assignments[0].source === 'existing'
    && saved.slots.assignments[0].slot === 1);
}

// ---- (c) empty expression claims the name, never erases ---------------------------
{
  const current = {
    attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['i', 'j', 'k', 'l'],
    attrExprs: ['hand * 1.0', '', '', ''],
  };
  const saved = PS.savePipelineGraphToConfig(graphOf([exprNode('n1', 'a', '')]), current);
  check('c1 an empty-expr assignment still produces the attribute patch',
    saved.ok === true && saved.patch.gpgpuAttrExprs !== undefined);
  check('c2 the hand-written expression on the claimed slot survives',
    sameJson(saved.patch.gpgpuAttrExprs, ['hand * 1.0', '', '', '']));
}

// ---- (d) no claims: the pre-slice behaviour, bit for bit ---------------------------
{
  const noWrite = graphOf([
    { id: 'box1', kind: 'rule-box', label: 'Box', enabled: true, params: { rule: { id: 'r1', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'kill' } } } },
    { id: 'cond', kind: 'expression', label: 'Cond', enabled: true, params: { expr: 'vel > 2.0' } },
  ]);
  const saved = PS.savePipelineGraphToConfig(noWrite, CURRENT);
  check('d1 a graph without output requests keeps exactly the three owned keys',
    saved.ok === true && sameJson(Object.keys(saved.patch).sort(), THREE_KEYS));
  const config = {
    gpgpuPipelineGraph: 'x', gpgpuParticleRulesLive: 'y', gpgpuForceOrder: 'z',
    gpgpuAttrNames: ['a', 'b', 'c', 'd'], gpgpuAttrExprs: ['e0', '', '', ''], other: 1,
  };
  const applied = PS.applyPipelineConfigPatch(config, saved.patch);
  check('d2 applying that patch leaves the attribute arrays untouched',
    applied.gpgpuAttrNames === config.gpgpuAttrNames && applied.gpgpuAttrExprs === config.gpgpuAttrExprs
    && applied.other === 1);
  const emptySave = PS.savePipelineGraphToConfig(PS.EMPTY_PIPELINE_GRAPH, CURRENT);
  check('d3 the empty graph still saves as the unset patch (no attribute keys)',
    sameJson(emptySave.patch, { gpgpuPipelineGraph: '', gpgpuParticleRulesLive: '', gpgpuForceOrder: '' }));
  check('d4 the attr patch helper is null for null / claim-free slot results',
    PS.pipelineSlotAssignmentAttrPatch(null) === null
    && PS.pipelineSlotAssignmentAttrPatch(saved.slots) === null);
}

// ---- (e) rejections surface with reason codes and apply nothing --------------------
{
  const rejected = PS.savePipelineGraphToConfig(graphOf([
    exprNode('r1', 'vel'), exprNode('r2', '1abc'), exprNode('r3', 'coef'),
  ]), { attrNames: ['a', 'b', 'c', 'd'], attrNames2: ['coef', 'j', 'k', 'l'], attrExprs: ['', '', '', ''] });
  check('e1 a fully rejected graph still saves ok', rejected.ok === true && rejected.patch !== null);
  check('e2 no attribute keys are applied for rejected requests',
    sameJson(Object.keys(rejected.patch).sort(), THREE_KEYS));
  const reasons = Object.fromEntries(rejected.slots.rejections.map((r) => [r.nodeId, r.reason]));
  check('e3 every rejection is surfaced with its reason code',
    rejected.slots.assignments.length === 0 && rejected.slots.rejections.length === 3
    && reasons.r1 === 'reserved-name' && reasons.r2 === 'invalid-name'
    && reasons.r3 === 'ext-slot-read-only');

  const mixed = PS.savePipelineGraphToConfig(graphOf([
    exprNode('ok1', 'coef', COEF_EXPR), exprNode('bad1', 'den'),
  ]), CURRENT);
  check('e4 a mixed graph applies its valid claim',
    mixed.patch.gpgpuAttrNames !== undefined && mixed.patch.gpgpuAttrNames[0] === 'coef'
    && mixed.patch.gpgpuAttrExprs[0] === COEF_EXPR);
  check('e5 and still surfaces its rejection',
    mixed.slots.rejections.length === 1 && mixed.slots.rejections[0].reason === 'reserved-name'
    && mixed.slots.rejections[0].nodeId === 'bad1');
}

// ---- (f) round trip + the dyn evaluation reads the written value -------------------
{
  const graph = graphOf([exprNode('n1', 'coef', COEF_EXPR)]);
  const saved1 = PS.savePipelineGraphToConfig(graph, CURRENT);
  const config1 = PS.applyPipelineConfigPatch({
    gpgpuPipelineGraph: '', gpgpuParticleRulesLive: '', gpgpuForceOrder: '',
    gpgpuAttrNames: ['a', 'b', 'c', 'd'], gpgpuAttrExprs: ['', '', '', ''], other: 7,
  }, saved1.patch);
  check('f1 the applied config carries the written name and expression',
    config1.gpgpuAttrNames[0] === 'coef' && config1.gpgpuAttrExprs[0] === COEF_EXPR && config1.other === 7);
  const loaded = PS.loadPipelineCore(config1);
  check('f2 the applied config loads back as source graph', loaded.source === 'graph');
  const saved2 = PS.savePipelineGraphToConfig(loaded.graph, {
    attrNames: config1.gpgpuAttrNames, attrNames2: CURRENT.attrNames2, attrExprs: config1.gpgpuAttrExprs,
  });
  check('f3 save -> apply -> load -> save is idempotent',
    saved2.ok === true && sameJson(saved2.patch, saved1.patch));
  check('f4 the second assignment resolves as existing at the same slot',
    saved2.slots.assignments.length === 1 && saved2.slots.assignments[0].source === 'existing'
    && saved2.slots.assignments[0].slot === 0);

  // The dyn evaluation, through the attribute module's own
  // compile path (the variable set mirrors
  // compileAttrExprForScan in lib/gpgpuAttributes.ts):
  // resolve the name the graph wrote, evaluate the applied
  // config's expression for it, and read the value back
  // from a downstream condition by name.
  const slot = A.resolveAttrNameSlot('coef', config1.gpgpuAttrNames, CURRENT.attrNames2);
  check('f5 the written name resolves to the claimed slot', slot === 0);
  const names8 = [...config1.gpgpuAttrNames, ...CURRENT.attrNames2].map((n) => n.toLowerCase());
  const varNames = [...names8, ...A.ATTR_SIM_VAR_NAMES, 'den', 'p'];
  const baseVars = Object.fromEntries(varNames.map((n) => [n, 0]));
  const compiled = X.compileExpression(config1.gpgpuAttrExprs[slot], varNames);
  check('f6 the applied expression compiles under the dyn variable set', compiled.ok === true);
  const value = X.evaluateCompiledExpressionWithVars(compiled.ast, { ...baseVars, age: 0.5 });
  check('f7 the dyn evaluation yields the value the graph wrote (age 0.5 -> 0.75)',
    Math.abs(value - 0.75) < 1e-9);
  const cond = X.compileExpression('coef > 0.25', varNames);
  const read = X.evaluateCompiledExpressionWithVars(cond.ast, { ...baseVars, coef: value });
  check('f8 a downstream condition reads the written channel by name', cond.ok === true && read === 1);
}

// ---- (g) the row-list save never carries attribute keys ------------------------------
{
  const rowSave = PS.savePipelineRowListToConfig(
    JSON.stringify([{ id: 'r1', enabled: true, target: { type: 'all' }, condition: 'age > 0.5', action: { type: 'kill' } }]), '');
  check('g1 row-list patch is exactly the three owned keys',
    sameJson(Object.keys(rowSave.patch).sort(), THREE_KEYS));
}

console.log(`layer1-wp2-channel-write-apply: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
