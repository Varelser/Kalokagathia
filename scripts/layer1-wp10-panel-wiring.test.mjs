#!/usr/bin/env node
// layer1-wp10-panel-wiring.test.mjs — Layer 1 WP10 phase C:
// the phase-A / phase-B grammars wired into the existing
// panels.
//
// (1) Modulation (components/controlPanelPlayTabStage.tsx):
//     the 'uparam' source kind is selectable in the route
//     source list and in an expression's wrapped-input list,
//     its select value round-trips through parseSource /
//     sourceValue (the branch order also removes the TS2339
//     the bare audio fallback raised), and SourceParamEditors
//     renders the declared-name picker. Behavioural pin: the
//     fresh-route default the panel builds (first declared
//     name) survives the setup serialise/parse round trip and
//     evaluates through the phase-A environment.
// (2) Designer (components/controlPanelDesignerSection.tsx):
//     the live model is built from all four keys, saved
//     records therefore carry the emitter configuration /
//     deform stack, and apply writes the two keys back ONLY
//     when the composition carries them. Behavioural pin:
//     the panel's exact save -> persist -> load -> updates
//     path over a fake storage, plus the identity pin that
//     the four-key build with '' defaults is the legacy
//     two-key build.
// (3) Presets (components/controlPanelGlobalPresets.tsx):
//     named reuse units can be created from the current
//     config (fixed groups frozen into a unit), persisted
//     under their own storage key, and applied through
//     onApplyConfig. Behavioural pin: create -> serialise ->
//     parse -> apply touches exactly the unit's keys, and
//     creating from an empty source yields no unit (the
//     panel's "no matching items" note path).
//
// Source pins follow the established discipline (the panels
// are React surfaces; their wiring is pinned by the exact
// call shapes, the behaviour by the lib functions they call).
//
// Run: node scripts/layer1-wp10-panel-wiring.test.mjs

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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const M = await load('lib/modulation.ts');
const UP = await load('lib/userParameters.ts');
const D = await load('lib/designerBlocks.ts');
const R = await load('lib/gpgpuParticleRules.ts');
const G = await load('lib/gpgpuGroups.ts');
const E = await load('lib/gpgpuEmitterList.ts');
const F = await load('lib/gpgpuDeformStack.ts');
const U = await load('lib/presetReuseUnits.ts');
const C = await load('lib/appStateConfig.ts');

// ---- (1) modulation panel wiring -------------------------------
const stage = read('components/controlPanelPlayTabStage.tsx');

check('modulation panel reads the declarations store',
  stage.includes("from '../lib/userParameters'")
  && stage.includes('useUserParameters()'));
check('parseSource builds an uparam source (first declared name as the default)',
  stage.includes("kind === 'uparam'")
  && stage.includes("return { kind: 'uparam', name: declarations[0]?.label ?? '' };"));
check('sourceValue maps uparam to its select value before the audio fallback',
  stage.includes("source.kind === 'uparam'")
  && stage.includes("'uparam:param'")
  && stage.indexOf("'uparam:param'") < stage.indexOf('`audio:${source.band}`'));
check('uparam is offered in both source selects (route + expression input)',
  (stage.match(/value="uparam:param"/g) ?? []).length >= 2);
check('SourceParamEditors renders the declared-name picker for uparam',
  stage.includes("aria-label=\"ユーザーパラメータ名\"")
  && stage.includes('findUserParameterByName(declarations, source.name)'));

// The fresh-route default the panel builds for a new uparam
// route: first declared name, inert until picked otherwise.
const declarations = UP.sanitizeUserParameters([
  { id: 'up-a', label: '流れの強さ', group: '', key: 'layer2FlowSpeed', defaultValue: 1 },
]);
check('fixture declaration sanitises', declarations.length === 1);
const panelDefaultSource = { kind: 'uparam', name: declarations[0]?.label ?? '' };
const setup = {
  ...M.createDefaultModulationSetup(),
  enabled: true,
  routes: [{ id: 'r-up', source: panelDefaultSource, target: 'layer2FlowSpeed', depth: 0.3 }],
};
const roundTripped = M.parseModulationSetupConfigValue(M.serializeModulationSetup(setup));
check('panel-shaped uparam route survives the setup round trip',
  roundTripped !== null
  && roundTripped.routes.length === 1
  && roundTripped.routes[0].source.kind === 'uparam'
  && roundTripped.routes[0].source.name === '流れの強さ');
check('describeModulationSource names the declared parameter',
  M.describeModulationSource(panelDefaultSource).includes('流れの強さ'));

const baseConfig = C.DEFAULT_CONFIG ?? null;
check('appStateConfig exposes the default config for fixtures', baseConfig !== null);
const envConfig = { ...baseConfig, layer2FlowSpeed: 3 };
const env = UP.buildUserParameterValueEnv(declarations, envConfig);
const target = UP.resolveUserParameterTarget('layer2FlowSpeed');
const expected01 = Math.min(1, Math.max(0, (3 - target.min) / (target.max - target.min)));
check('the panel default source evaluates to the declared value through the phase-A env',
  near(M.evaluateSource(panelDefaultSource, setup, 0, undefined, 'r-up', undefined, env).value01, expected01));

// ---- (2) designer panel wiring ---------------------------------
const designer = read('components/controlPanelDesignerSection.tsx');

check('designer panel builds the live model from all four keys',
  designer.includes('gpgpuEmitters: config.gpgpuEmitters')
  && designer.includes('gpgpuEmitDeform: config.gpgpuEmitDeform'));
check('designer panel writes the emitter key back only when the composition carries it',
  designer.includes('if (updates.gpgpuEmitters !== undefined)')
  && designer.includes("write('gpgpuEmitters', updates.gpgpuEmitters);"));
check('designer panel writes the deform key back only when the composition carries it',
  designer.includes('if (updates.gpgpuEmitDeform !== undefined)')
  && designer.includes("write('gpgpuEmitDeform', updates.gpgpuEmitDeform);"));
check('designer panel surfaces the carried attachments (badges via the lib accessors)',
  designer.includes('designerBlockModelHasEmitters')
  && designer.includes('designerBlockModelHasDeformOps'));

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
const emittersKey = E.serializeEmitterList(E.parseEmitterList(JSON.stringify([
  {
    shape: 'sphere', respawnShape: 'auto', pos: [1, 2, 3], rot: [0, 0, 0], scale: 1.5,
    velMode: 'directed', velDir: [0, 1, 0], velSpeed: 3, velSpread: 0.25,
    weight: 2, lightUnit: 2, weightFromLight: false,
  },
])));
const deformKey = JSON.stringify([
  { op: 'bend', axis: 'x', dir: 'z', amount: 0.5, center: [0, 0, 0] },
]);
const rulesKey = R.serializeParticleRules(rules);
const groupsKey = G.serializeGpgpuGroups(groups);
check('designer fixtures are valid',
  rules.every(Boolean) && groups.length === 1 && emittersKey.length > 0 && F.parseDeformOps(deformKey).length === 1);

// Identity: the panel's four-key build over the '' defaults
// is byte-identical to the legacy two-key build.
const fourKeyDefault = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
  gpgpuEmitters: '', gpgpuEmitDeform: '',
});
const twoKeyLegacy = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
});
check('four-key build over defaults equals the legacy build',
  sameJson(fourKeyDefault, twoKeyLegacy)
  && !('gpgpuEmitters' in D.designerBlockModelToConfigUpdates(fourKeyDefault))
  && !('gpgpuEmitDeform' in D.designerBlockModelToConfigUpdates(fourKeyDefault)));

// The panel's save -> persist -> load -> apply path.
const carriedModel = D.buildDesignerBlockModelFromConfig({
  gpgpuParticleRules: rulesKey, gpgpuGroupsData: groupsKey,
  gpgpuEmitters: emittersKey, gpgpuEmitDeform: deformKey,
});
const record = D.createDesignerBlockRecord({ name: '配線確認', model: carriedModel });
const fakeStore = new Map();
const fakeStorage = {
  getItem: (key) => (fakeStore.has(key) ? fakeStore.get(key) : null),
  setItem: (key, value) => { fakeStore.set(key, value); },
};
check('panel-shaped record persists with verification',
  D.persistDesignerBlockRecords(fakeStorage, [record]).ok === true);
const loadedRecords = D.loadDesignerBlockRecords(fakeStorage);
check('panel-shaped record loads back', loadedRecords.length === 1 && loadedRecords[0].id === record.id);
const carriedUpdates = D.designerBlockModelToConfigUpdates(loadedRecords[0].model);
check('apply updates carry the emitter configuration (normalised by its own serializer)',
  carriedUpdates.gpgpuEmitters === E.serializeEmitterList(E.parseEmitterList(emittersKey)));
check('apply updates carry the deform stack (resolved form preserved)',
  typeof carriedUpdates.gpgpuEmitDeform === 'string'
  && sameJson(F.parseDeformOps(carriedUpdates.gpgpuEmitDeform), F.parseDeformOps(deformKey)));

// ---- (3) preset panel reuse-unit wiring -------------------------
const presetsPanel = read('components/controlPanelGlobalPresets.tsx');

check('preset panel wires the reuse-unit grammar',
  presetsPanel.includes("from '../lib/presetReuseUnits'")
  && presetsPanel.includes('createPresetReuseUnitFromGroups')
  && presetsPanel.includes('applyPresetReuseUnit'));
check('reuse units persist under their own storage key (no config key)',
  presetsPanel.includes("'kalokagathia.presetReuseUnits.v1'")
  && presetsPanel.includes('serializePresetReuseUnits(units)')
  && presetsPanel.includes('parsePresetReuseUnits('));
check('applying a unit goes through onApplyConfig with the pure apply result',
  presetsPanel.includes('onApplyConfig(applyPresetReuseUnit(config, unit))'));
check('the reuse-unit block follows the public-library / apply-path gate',
  presetsPanel.includes('{!isPublicLibrary && onApplyConfig && ('));

const unitSource = {
  ...baseConfig,
  layer2FlowSpeed: 2.5,
  layer2FlowAmp: 0.75,
  baseSize: 3.25,
};
const unit = U.createPresetReuseUnitFromGroups({
  name: '流れだけ',
  source: unitSource,
  groupIds: new Set(['motion']),
});
check('panel create path freezes the selected groups into a named unit',
  unit !== null && unit.name === '流れだけ' && unit.keys.includes('layer2FlowSpeed'));
const storedUnits = U.parsePresetReuseUnits(U.serializePresetReuseUnits([unit]));
check('unit library serialise/parse round trips (the panel storage path)',
  storedUnits.length === 1 && sameJson(storedUnits[0], unit));
const unitTarget = { ...baseConfig, layer2FlowSpeed: 0.5, baseSize: 9 };
const appliedUnit = U.applyPresetReuseUnit(unitTarget, storedUnits[0]);
check('applying the unit touches exactly its keys',
  appliedUnit.layer2FlowSpeed === 2.5 && appliedUnit.baseSize === 9);
check('creating a unit from an empty source yields none (panel note path)',
  U.createPresetReuseUnitFromGroups({ name: '空', source: {}, groupIds: new Set(['motion']) }) === null);

// ---- summary ----------------------------------------------------
if (failures > 0) {
  console.error(`layer1-wp10-panel-wiring: ${checks - failures}/${checks} checks passed, ${failures} FAILED`);
  process.exit(1);
}
console.log(`layer1-wp10-panel-wiring: ${checks}/${checks} checks passed`);
console.log('ALL PASS');
