#!/usr/bin/env node
// stage4-designer-s7.test.mjs — Limit plan stage 4, slice S7:
// Designer first instalment (block-composition foundation +
// read-only flow diagram). Decision: STAGE4_DECISIONS.md
// (案3 ハイブリッド, saved form compatible with the stage-5
// graph model, templates are saved block compositions).
// Model + persistence: lib/designerBlocks.ts.
//
// Pins:
// (a) conversion: the rule list + group definitions project
//     into source/group/rule nodes with flow, sequence,
//     reference and composite edges in evaluation order;
//     dangling group references become dangling nodes;
// (b) round trips: model -> JSON -> model is identical, and
//     model -> config write-back reproduces the exact
//     serialised entity keys it was built from;
// (c) validation: broken stored payloads are refused with a
//     reason (format / endpoints / duplicates), broken
//     records drop individually on load, the verified write
//     reports failures instead of losing data;
// (d) layout: deterministic, non-overlapping, rules stacked
//     in list order;
// (e) inertness: at the defaults ('' rule / group keys) the
//     model is the lone source node, and the compositions
//     live under their own storage key, never the presets'.
//
// The React section is out of this suite's reach (same as
// prior slices); its wiring is pinned by the build. Existing
// behaviour (rule evaluation, preset persistence) is covered
// by the untouched existing suite.
//
// Run: node scripts/stage4-designer-s7.test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

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

const D = await load('lib/designerBlocks.ts');
const R = await load('lib/gpgpuParticleRules.ts');
const G = await load('lib/gpgpuGroups.ts');

// ---- fixtures (canonical forms via the entities' own parsers)
const rules = [
  R.validateParticleRule({
    id: 'r1', name: '重み', enabled: true,
    target: { type: 'group', id: 'g1' }, condition: '',
    action: { type: 'force-gate', force: 'gravity' },
  }),
  R.validateParticleRule({
    id: 'r2', enabled: true,
    target: { type: 'predicate', slot: 0, mode: 'band', low: 0.2, high: 0.8, invert: false },
    condition: 'age > 0.5',
    action: { type: 'color', color: [1, 0.5, 0] },
  }),
  R.validateParticleRule({
    id: 'r3', enabled: false,
    target: { type: 'group', id: 'ghost' }, condition: '',
    action: { type: 'kill' },
  }),
];
check('fixtures are valid rules', rules.every(Boolean));

const groups = G.parseGpgpuGroups(JSON.stringify([
  { id: 'g0', name: '下半分', source: { kind: 'predicate', predicate: { slot: 1, mode: 'below', low: 0.5, high: 1, invert: false } } },
  { id: 'g1', name: '上半分', source: { kind: 'predicate', predicate: { slot: 1, mode: 'above', low: 0.5, high: 1, invert: false } } },
  { id: 'g2', name: '合成', source: { kind: 'composite', a: 'g0', b: 'g1', op: 'union' } },
]));
check('fixtures are valid groups', groups.length === 3);

// ---- (a) conversion ----------------------------------------
const model = D.buildDesignerBlockModel(rules, groups);
check('model carries the format version', model.format === 'designer-blocks-v1');
check('node count = source + 3 groups + 1 dangling + 3 rules',
  model.nodes.length === 8);
check('first node is the source',
  model.nodes[0].id === D.DESIGNER_SOURCE_NODE_ID && model.nodes[0].kind === 'source');
check('group nodes precede rule nodes',
  model.nodes.slice(1, 5).every((n) => n.kind === 'group')
  && model.nodes.slice(5).every((n) => n.kind === 'rule'));
check('rule nodes keep list order',
  sameJson(model.nodes.slice(5).map((n) => n.id), ['rule:r1', 'rule:r2', 'rule:r3']));
check('rule node params are the rule itself',
  sameJson(model.nodes[5].params, JSON.parse(JSON.stringify(rules[0]))));
check('disabled rule stays disabled in the model',
  model.nodes[7].enabled === false);
check('dangling group node is marked and carries no params',
  model.nodes[4].id === 'group:ghost' && model.nodes[4].dangling === true && model.nodes[4].params === undefined);

const edgesOf = (kind) => model.edges.filter((e) => e.kind === kind);
check('flow edges: source -> 4 groups + first rule', edgesOf('flow').length === 5);
check('sequence edges chain the rules in order',
  sameJson(edgesOf('sequence').map((e) => `${e.from}->${e.to}`),
    ['rule:r1->rule:r2', 'rule:r2->rule:r3']));
check('reference edges: defined and dangling targets alike',
  sameJson(edgesOf('reference').map((e) => `${e.from}->${e.to}`),
    ['group:g1->rule:r1', 'group:ghost->rule:r3']));
check('composite edges come from both component groups',
  sameJson(edgesOf('composite').map((e) => `${e.from}->${e.to}`),
    ['group:g0->group:g2', 'group:g1->group:g2']));
check('every edge endpoint exists',
  model.edges.every((e) => model.nodes.some((n) => n.id === e.from) && model.nodes.some((n) => n.id === e.to)));

// ---- (b) round trips ---------------------------------------
const roundTripped = D.parseDesignerBlockModel(D.serializeDesignerBlockModel(model));
check('model -> JSON -> model is identical', sameJson(roundTripped, model));
check('extracted rules equal the input rules',
  sameJson(D.designerBlockModelRules(model), JSON.parse(JSON.stringify(rules))));
check('extracted groups equal the input groups',
  sameJson(D.designerBlockModelGroups(model), JSON.parse(JSON.stringify(groups))));

const fromConfig = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: R.serializeParticleRules(rules),
  gpgpuGroupsData: G.serializeGpgpuGroups(groups),
});
check('config-built model equals the directly built model', sameJson(fromConfig, model));
const updates = D.designerBlockModelToConfigUpdates(fromConfig);
check('write-back reproduces the rules key byte-for-byte',
  updates.gpgpuParticleRules === R.serializeParticleRules(rules));
check('write-back reproduces the groups key byte-for-byte',
  updates.gpgpuGroupsData === G.serializeGpgpuGroups(groups));

// ---- (c) validation / persistence --------------------------
check('wrong format is refused with its reason',
  D.validateDesignerBlockModel({ format: 'other', nodes: [], edges: [] }).reason === 'format-mismatch');
check('non-object is refused',
  D.validateDesignerBlockModel([1, 2]).reason === 'not-an-object');
check('edge to a missing node is refused',
  D.validateDesignerBlockModel({
    format: 'designer-blocks-v1',
    nodes: [{ id: 'rule:a', kind: 'rule', label: 'a', enabled: true }],
    edges: [{ id: 'e0', from: 'rule:a', to: 'rule:b', kind: 'sequence' }],
  }).reason === 'edge-endpoint-missing');
check('duplicate node ids are refused',
  D.validateDesignerBlockModel({
    format: 'designer-blocks-v1',
    nodes: [
      { id: 'rule:a', kind: 'rule', label: 'a' },
      { id: 'rule:a', kind: 'rule', label: 'b' },
    ],
    edges: [],
  }).reason === 'duplicate-node-id');
check('garbage text parses to null', D.parseDesignerBlockModel('{nope') === null);
check('serialising an invalid model throws',
  (() => { try { D.serializeDesignerBlockModel({ format: 'x', nodes: [], edges: [] }); return false; } catch { return true; } })());

const makeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map,
  };
};
const record = D.createDesignerBlockRecord({ name: 'テスト構成', model, createdAt: 123 });
const storage = makeStorage();
check('verified persist succeeds', D.persistDesignerBlockRecords(storage, [record]).ok === true);
check('persisted records load back identically',
  sameJson(D.loadDesignerBlockRecords(storage), [record]));
const mixed = makeStorage({
  [D.DESIGNER_BLOCKS_STORAGE_KEY]: JSON.stringify([record, { id: 'broken' }, null]),
});
check('broken records drop individually on load',
  D.loadDesignerBlockRecords(mixed).length === 1);
check('a throwing storage reports the write failure',
  D.persistDesignerBlockRecords({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, [record]).reason === 'write');
check('an unreadable payload loads as empty',
  D.loadDesignerBlockRecords(makeStorage({ [D.DESIGNER_BLOCKS_STORAGE_KEY]: '###' })).length === 0);

// ---- (d) layout ---------------------------------------------
const layout1 = D.layoutDesignerBlockModel(model);
const layout2 = D.layoutDesignerBlockModel(model);
check('layout is deterministic', sameJson(layout1, layout2));
check('layout covers every node and edge',
  layout1.nodes.length === model.nodes.length && layout1.edges.length === model.edges.length);
const overlaps = layout1.nodes.some((a, i) => layout1.nodes.some((b, j) => j > i
  && a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height));
check('no two node boxes overlap', !overlaps);
const ruleYs = layout1.nodes.filter((n) => n.kind === 'rule').map((n) => n.y);
check('rules stack in list order (y strictly increases)',
  ruleYs.every((y, i) => i === 0 || y > ruleYs[i - 1]));
check('layout has positive extent', layout1.width > 0 && layout1.height > 0);

// ---- (e) inertness at the defaults ---------------------------
const emptyModel = D.buildDesignerBlockModelFromConfig({ gpgpuParticleRules: '', gpgpuGroupsData: '' });
check('default config projects to the lone source node',
  emptyModel.nodes.length === 1 && emptyModel.edges.length === 0);
check('compositions use their own storage key, not the preset key',
  D.DESIGNER_BLOCKS_STORAGE_KEY === 'monosphere-designer-blocks-v1'
  && D.DESIGNER_BLOCKS_STORAGE_KEY !== 'monosphere-presets-v1');
check('the lib never writes the entity config keys itself',
  !read('lib/designerBlocks.ts').includes('updateConfig'));

console.log(`stage4-designer-s7: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
