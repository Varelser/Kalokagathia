#!/usr/bin/env node
// layer1-wp10-reuse-units.test.mjs — Layer 1 WP10 phase B:
// reuse-unit generalisation. Two halves:
//
// (1) Designer compositions (lib/designerBlocks.ts) now also
//     carry the pool-level entities — the emitter
//     configuration (gpgpuEmitters) and the emission deform
//     stack (gpgpuEmitDeform) — on the source node's params.
// (2) Named reuse units (lib/presetReuseUnits.ts): an
//     arbitrary config key subset captured under a name,
//     applied with the applyPartialConfig discipline.
//
// Pins:
// (a) backward compatibility: a composition built without
//     the new keys (or with them empty) is byte-identical to
//     the pre-WP10 form — the source node carries no params
//     and the config write-back has exactly the two legacy
//     fields; a stored pre-WP10 payload loads and applies
//     exactly as before;
// (b) attachments: extraction round-trips through the
//     entities' own parsers, the write-back adds the two key
//     fields only when the composition carries the entity,
//     an explicitly carried-but-empty emitter field writes
//     '' (clearing is the authored intent), broken /
//     identity-only attachments are omitted at build time,
//     and saved records keep the attachments;
// (c) reuse units: capture skips missing keys and collapses
//     duplicates, applying touches exactly the unit's keys,
//     later units win on shared keys, serialise/parse round
//     trips, broken payloads read empty and broken units
//     drop individually, and a unit frozen from a fixed
//     partial group applies identically to
//     applyPartialConfig for that group;
// (d) presetPartial itself is untouched: the fixed group ids
//     and the group application behaviour are unchanged.
//
// Run: node scripts/layer1-wp10-reuse-units.test.mjs

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
const E = await load('lib/gpgpuEmitterList.ts');
const F = await load('lib/gpgpuDeformStack.ts');
const U = await load('lib/presetReuseUnits.ts');
const P = await load('lib/presetPartial.ts');
const C = await load('lib/appStateConfig.ts');

// ---- fixtures -------------------------------------------------
const rules = [
  R.validateParticleRule({
    id: 'r1', name: '重み', enabled: true,
    target: { type: 'group', id: 'g1' }, condition: '',
    action: { type: 'force-gate', force: 'gravity' },
  }),
];
const groups = G.parseGpgpuGroups(JSON.stringify([
  { id: 'g1', name: '上半分', source: { kind: 'predicate', predicate: { slot: 1, mode: 'above', low: 0.5, high: 1, invert: false } } },
]));
check('fixtures are valid', rules.every(Boolean) && groups.length === 1);

const emittersKey = E.serializeEmitterList(E.parseEmitterList(JSON.stringify([
  {
    shape: 'sphere', respawnShape: 'auto', pos: [1, 2, 3], rot: [0, 0, 0], scale: 1.5,
    velMode: 'directed', velDir: [0, 1, 0], velSpeed: 3, velSpread: 0.25,
    weight: 2, lightUnit: 2, weightFromLight: false,
  },
  {
    shape: 'box', respawnShape: 'auto', pos: [-1, 0, 0], rot: [0, 45, 0], scale: 1,
    velMode: 'cube', velDir: [0, 1, 0], velSpeed: 2, velSpread: 0.5,
    weight: 1, lightUnit: 1, weightFromLight: true,
  },
])));
check('emitter fixture serialises', emittersKey.length > 0 && E.parseEmitterList(emittersKey).length === 2);

const deformKey = JSON.stringify([
  { op: 'bend', axis: 'x', dir: 'z', amount: 0.5, center: [0, 0, 0] },
  { op: 'twist', axis: 'y', amount: 1.2, center: [0, 0, 0] },
]);
check('deform fixture resolves to two ops', F.parseDeformOps(deformKey).length === 2);

const rulesKey = R.serializeParticleRules(rules);
const groupsKey = G.serializeGpgpuGroups(groups);

// ---- (a) backward compatibility -------------------------------
const legacyModel = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey,
  gpgpuGroupsData: groupsKey,
});
check('legacy model source node carries no params',
  legacyModel.nodes[0].params === undefined);
check('direct build equals config build (legacy)',
  sameJson(D.buildDesignerBlockModel(rules, groups), legacyModel));
check('empty emitter/deform keys yield the legacy model',
  sameJson(D.buildDesignerBlockModelFromConfig({
    gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
    gpgpuEmitters: '', gpgpuEmitDeform: '',
  }), legacyModel));
check('null emitter/deform keys yield the legacy model',
  sameJson(D.buildDesignerBlockModelFromConfig({
    gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
    gpgpuEmitters: null, gpgpuEmitDeform: null,
  }), legacyModel));

const legacyUpdates = D.designerBlockModelToConfigUpdates(legacyModel);
check('legacy write-back has exactly the two legacy fields',
  sameJson(Object.keys(legacyUpdates).sort(), ['gpgpuGroupsData', 'gpgpuParticleRules']));
check('legacy write-back reproduces the rules key',
  legacyUpdates.gpgpuParticleRules === rulesKey);
check('legacy write-back reproduces the groups key',
  legacyUpdates.gpgpuGroupsData === groupsKey);
check('legacy model reports no attachments',
  !D.designerBlockModelHasEmitters(legacyModel)
  && !D.designerBlockModelHasDeformOps(legacyModel)
  && D.designerBlockModelEmitters(legacyModel).length === 0
  && D.designerBlockModelDeformOps(legacyModel).length === 0);

// A stored pre-WP10 payload (no source params) loads and
// applies exactly as the in-memory legacy model.
const storedLegacy = D.parseDesignerBlockModel(D.serializeDesignerBlockModel(legacyModel));
check('stored legacy payload parses', storedLegacy !== null);
check('stored legacy payload applies identically',
  sameJson(D.designerBlockModelToConfigUpdates(storedLegacy), legacyUpdates));

// ---- (b) attachments ------------------------------------------
const fullModel = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey,
  gpgpuGroupsData: groupsKey,
  gpgpuEmitters: emittersKey,
  gpgpuEmitDeform: deformKey,
});
check('full model source node carries both attachments',
  D.designerBlockModelHasEmitters(fullModel) && D.designerBlockModelHasDeformOps(fullModel));
check('extracted emitters equal the entity parse',
  sameJson(D.designerBlockModelEmitters(fullModel), E.parseEmitterList(emittersKey)));
check('extracted deform ops equal the entity parse',
  sameJson(D.designerBlockModelDeformOps(fullModel), F.parseDeformOps(deformKey)));
check('extracted deform entries are the authored entries',
  sameJson(D.designerBlockModelDeformEntries(fullModel), JSON.parse(deformKey)));
check('building from parsed elements equals building from the key',
  sameJson(
    D.buildDesignerBlockModel(rules, groups, { emitters: E.parseEmitterList(emittersKey), deformOps: deformKey }),
    fullModel));

const fullUpdates = D.designerBlockModelToConfigUpdates(fullModel);
check('full write-back adds both key fields',
  typeof fullUpdates.gpgpuEmitters === 'string' && typeof fullUpdates.gpgpuEmitDeform === 'string');
check('full write-back emitters reproduce the key form',
  fullUpdates.gpgpuEmitters === E.serializeEmitterList(E.parseEmitterList(emittersKey)));
check('full write-back deform resolves to the same ops',
  sameJson(F.parseDeformOps(fullUpdates.gpgpuEmitDeform), F.parseDeformOps(deformKey)));
check('full write-back keeps the legacy fields intact',
  fullUpdates.gpgpuParticleRules === rulesKey && fullUpdates.gpgpuGroupsData === groupsKey);

const roundTripped = D.parseDesignerBlockModel(D.serializeDesignerBlockModel(fullModel));
check('full model -> JSON -> model is identical', sameJson(roundTripped, fullModel));

// One-sided attachments: the other key stays untouched.
const emittersOnly = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey, gpgpuEmitters: emittersKey,
});
const emittersOnlyUpdates = D.designerBlockModelToConfigUpdates(emittersOnly);
check('emitters-only write-back omits the deform field',
  typeof emittersOnlyUpdates.gpgpuEmitters === 'string' && !('gpgpuEmitDeform' in emittersOnlyUpdates));
const deformOnly = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey, gpgpuEmitDeform: deformKey,
});
const deformOnlyUpdates = D.designerBlockModelToConfigUpdates(deformOnly);
check('deform-only write-back omits the emitters field',
  typeof deformOnlyUpdates.gpgpuEmitDeform === 'string' && !('gpgpuEmitters' in deformOnlyUpdates));

// Broken / identity-only attachments are omitted at build
// time, so the composition keeps the legacy shape.
check('broken emitter payload is omitted',
  sameJson(D.buildDesignerBlockModelFromConfig({
    gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey, gpgpuEmitters: 'not json',
  }), legacyModel));
check('identity-only deform stack is omitted',
  sameJson(D.buildDesignerBlockModelFromConfig({
    gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
    gpgpuEmitDeform: JSON.stringify([{ op: 'bend', axis: 'x', amount: 0 }]),
  }), legacyModel));

// An explicitly carried-but-empty emitter field still speaks
// for the key: applying writes '' (clearing is authored).
const clearedModel = D.parseDesignerBlockModel(JSON.stringify({
  format: 'designer-blocks-v1',
  nodes: [
    { id: 'source:pool', kind: 'source', label: 'Particle Pool', enabled: true, params: { emitters: [] } },
  ],
  edges: [],
}));
check('carried-but-empty emitters still count as carried',
  clearedModel !== null && D.designerBlockModelHasEmitters(clearedModel));
check('carried-but-empty emitters write back as the empty key',
  D.designerBlockModelToConfigUpdates(clearedModel).gpgpuEmitters === '');

// Saved records keep the attachments through verified
// persistence.
const fakeStorage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
};
{
  const storage = fakeStorage();
  const record = D.createDesignerBlockRecord({ name: 'WP10', model: fullModel, createdAt: 1 });
  const persisted = D.persistDesignerBlockRecords(storage, [record]);
  const loaded = D.loadDesignerBlockRecords(storage);
  check('record with attachments persists and reloads',
    persisted.ok && loaded.length === 1
    && sameJson(D.designerBlockModelEmitters(loaded[0].model), E.parseEmitterList(emittersKey))
    && sameJson(D.designerBlockModelDeformOps(loaded[0].model), F.parseDeformOps(deformKey)));
}

// ---- (c) reuse units ------------------------------------------
const defaults = C.DEFAULT_CONFIG;
const source = C.normalizeConfig({
  ...defaults, baseSize: 3.25, sphereRadius: 7.5, gpgpuEmitters: emittersKey, jitter: 0.9,
});
const current = C.normalizeConfig({ ...defaults, baseSize: 1, sphereRadius: 2, jitter: 0.1 });

const unit = U.createPresetReuseUnit({
  name: 'サイズだけ', source, keys: ['baseSize', 'sphereRadius', 'baseSize', 'noSuchKey'], createdAt: 5, id: 'u1',
});
check('unit captures the existing keys once, in order',
  unit !== null && sameJson(unit.keys, ['baseSize', 'sphereRadius']));
check('unit values come from the source',
  unit.values.baseSize === 3.25 && unit.values.sphereRadius === 7.5);
check('capture with no existing key returns null',
  U.createPresetReuseUnit({ name: 'x', source, keys: ['noSuchKey'] }) === null);

const applied = U.applyPresetReuseUnit(current, unit);
check('apply writes the unit keys from the unit',
  applied.baseSize === 3.25 && applied.sphereRadius === 7.5);
check('apply leaves non-unit keys at the current values',
  applied.jitter === current.jitter && applied.gpgpuEmitters === current.gpgpuEmitters);

const unitA = U.createPresetReuseUnit({ name: 'A', source, keys: ['baseSize'], createdAt: 1, id: 'ua' });
const unitB = U.createPresetReuseUnit({
  name: 'B', source: { ...source, baseSize: 9 }, keys: ['baseSize'], createdAt: 2, id: 'ub',
});
check('later units win on shared keys',
  U.applyPresetReuseUnits(current, [unitA, unitB]).baseSize === 9);
check('unit coverage helper agrees with the key list',
  U.presetReuseUnitCovers(unit, 'baseSize') && !U.presetReuseUnitCovers(unit, 'jitter'));

const libraryText = U.serializePresetReuseUnits([unit, unitA]);
const library = U.parsePresetReuseUnits(libraryText);
check('unit library round trips',
  library.length === 2 && sameJson(library[0], U.validatePresetReuseUnit(unit)));
check('broken library payloads read empty',
  U.parsePresetReuseUnits('').length === 0
  && U.parsePresetReuseUnits('garbage').length === 0
  && U.parsePresetReuseUnits('{"format":"other","units":[]}').length === 0);
check('broken units drop individually',
  U.parsePresetReuseUnits(JSON.stringify({
    format: U.PRESET_REUSE_UNITS_FORMAT,
    units: [unit, { id: 'bad' }, unitA],
  })).length === 2);
check('validation refuses a unit whose values miss a key',
  U.validatePresetReuseUnit({ id: 'x', name: 'x', createdAt: 0, keys: ['baseSize'], values: {} }) === null);
check('validation drops values outside the key list',
  sameJson(
    U.validatePresetReuseUnit({ id: 'x', name: 'x', createdAt: 0, keys: ['baseSize'], values: { baseSize: 1, extra: 2 } }).values,
    { baseSize: 1 }));

// A unit frozen from a fixed group applies identically to
// the fixed-group application it generalises.
const colorUnit = U.createPresetReuseUnitFromGroups({
  name: '色だけ（固定グループ由来）', source, groupIds: new Set(['color']), createdAt: 3, id: 'uc',
});
check('group-frozen unit captures keys', colorUnit !== null && colorUnit.keys.length > 0);
check('group-frozen unit applies identically to applyPartialConfig',
  sameJson(
    JSON.parse(JSON.stringify(U.applyPresetReuseUnit(current, colorUnit))),
    JSON.parse(JSON.stringify(P.applyPartialConfig(current, source, new Set(['color']))))));
check('unknown group selection returns null',
  U.createPresetReuseUnitFromGroups({ name: 'x', source, groupIds: new Set(['nope']) }) === null);

// ---- (d) presetPartial untouched -------------------------------
check('fixed group ids are unchanged',
  sameJson(P.PARTIAL_GROUPS.map((g) => g.id),
    ['color', 'motion', 'shape', 'post', 'layer1', 'layer2', 'layer3', 'gpgpu', 'audio']));
{
  const gpgpuOnly = P.applyPartialConfig(current, source, new Set(['gpgpu']));
  check('gpgpu group still copies the authored emitters key only within its group',
    gpgpuOnly.gpgpuEmitters === emittersKey && gpgpuOnly.baseSize === current.baseSize);
}
check('presetPartial source file is part of this suite only as a dependency',
  read('lib/presetPartial.ts').includes('PARTIAL_GROUPS'));

// ---- summary ----------------------------------------------------
if (failures > 0) {
  console.error(`layer1-wp10-reuse-units: ${checks - failures}/${checks} checks passed, ${failures} FAILED`);
  process.exit(1);
}
console.log(`layer1-wp10-reuse-units: ${checks}/${checks} checks passed`);
console.log('ALL PASS');
