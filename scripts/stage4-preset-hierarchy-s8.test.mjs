#!/usr/bin/env node
// stage4-preset-hierarchy-s8.test.mjs — Limit plan stage 4,
// slice S8: template / preset hierarchy (QuickTools style).
// Design: STAGE4_DESIGN_MATERIALS.md §6 案A (hierarchy metadata
// in its own file, existing presets placed unchanged, kind
// preset/template on the metadata), STAGE4_DECISIONS.md 決定3
// (templates are saved Designer block compositions).
// Model: lib/presetHierarchy.ts. UI: the preset panel narrows
// its existing card list by lineage > family.
//
// Pins:
// (a) existence: every preset id the hierarchy references
//     exists in STARTER_PRESETS;
// (b) uniqueness: no preset id is placed more than once, and
//     lineage / family ids are unique (validator agrees);
// (c) coverage: every STARTER_PRESETS record is placed;
// (d) kind: every starter placement is 'preset', the Designer
//     Templates receptacle family is 'template' and holds no
//     preset ids, and the validator refuses an entry whose
//     kind is outside 'preset' | 'template' with a reason;
// (e) filtering: filterPresetsByHierarchy is deterministic
//     (same input -> same output), an empty selection returns
//     the input untouched and in order, lineage / family /
//     kind selections only return placed presets of that node,
//     and an unplaced (user) preset survives an empty selection
//     but not an active one;
// (f) derivation spot-checks: placements follow the real chunk
//     composition (first foundational preset, one product-pack
//     starter id built by the starterLibrary formula).
//
// The React panel is out of this suite's reach (same as prior
// slices); its wiring is pinned by the build.
//
// Run: node scripts/stage4-preset-hierarchy-s8.test.mjs

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

const H = await load('lib/presetHierarchy.ts');
const S = await load('lib/starterLibrary.ts');
const F = await load('lib/starterLibraryPresetBaseChunk01Foundational.ts');
const P = await load('lib/productPackLibrary.ts');

const starterIds = S.STARTER_PRESETS.map((preset) => preset.id);
const starterIdSet = new Set(starterIds);
check('starter library itself has unique ids', starterIdSet.size === starterIds.length);
check('starter library is non-trivial', starterIds.length > 100);

const placements = H.flattenPresetHierarchy();
const placedIds = placements.map((placement) => placement.presetId);

// ---- (a) existence ------------------------------------------
check('every hierarchy-referenced id exists in STARTER_PRESETS',
  placedIds.every((id) => starterIdSet.has(id)));

// ---- (b) uniqueness ------------------------------------------
check('no preset id is placed more than once',
  new Set(placedIds).size === placedIds.length);
check('the shipped hierarchy passes its own validator',
  H.validatePresetHierarchy(H.PRESET_HIERARCHY).ok === true);
check('hierarchy carries the current version',
  H.PRESET_HIERARCHY.version === H.PRESET_HIERARCHY_VERSION);

// ---- (c) coverage --------------------------------------------
check('every starter preset is placed',
  starterIds.every((id) => new Set(placedIds).has(id)));
check('placement count equals starter preset count',
  placedIds.length === starterIds.length);

// ---- (d) kind -------------------------------------------------
check('every starter placement has kind preset',
  placements.every((placement) => placement.kind === 'preset'));
const templateLineage = H.PRESET_HIERARCHY.lineages.find((lineage) => lineage.id === 'designer-templates');
check('designer-templates lineage exists', Boolean(templateLineage));
check('template receptacle family exists and is kind template',
  templateLineage?.families.length === 1 && templateLineage.families[0].kind === 'template');
check('template receptacle holds no preset ids',
  templateLineage?.families[0].presetIds.length === 0);
check('entry kinds are exactly preset/template',
  sameJson([...H.PRESET_HIERARCHY_ENTRY_KINDS], ['preset', 'template']));

const bogusKind = JSON.parse(JSON.stringify(H.PRESET_HIERARCHY));
bogusKind.lineages[0].families[0].kind = 'skeleton';
const bogusKindResult = H.validatePresetHierarchy(bogusKind);
check('validator refuses an invalid kind with a reason',
  bogusKindResult.ok === false && bogusKindResult.reason.startsWith('invalid-kind:'));

const duplicated = JSON.parse(JSON.stringify(H.PRESET_HIERARCHY));
duplicated.lineages[0].families[1].presetIds.push(duplicated.lineages[0].families[0].presetIds[0]);
const duplicatedResult = H.validatePresetHierarchy(duplicated);
check('validator refuses a duplicate placement with a reason',
  duplicatedResult.ok === false && duplicatedResult.reason.startsWith('duplicate-preset:'));

const badVersion = JSON.parse(JSON.stringify(H.PRESET_HIERARCHY));
badVersion.version = 999;
check('validator refuses a wrong version',
  H.validatePresetHierarchy(badVersion).ok === false);

// ---- (e) filtering ---------------------------------------------
const all = S.STARTER_PRESETS;
check('empty selection returns the input untouched and in order',
  sameJson(H.filterPresetsByHierarchy(all, {}).map((p) => p.id), starterIds));
check('omitted selection behaves like an empty selection',
  sameJson(H.filterPresetsByHierarchy(all).map((p) => p.id), starterIds));

const baseOnly1 = H.filterPresetsByHierarchy(all, { lineageId: 'starter-base' });
const baseOnly2 = H.filterPresetsByHierarchy(all, { lineageId: 'starter-base' });
check('filtering is deterministic (same input, same output)',
  sameJson(baseOnly1.map((p) => p.id), baseOnly2.map((p) => p.id)));
check('lineage filter only returns presets placed in that lineage',
  baseOnly1.length > 0 && baseOnly1.every((p) => H.getPresetHierarchyPlacement(p.id)?.lineageId === 'starter-base'));
check('lineage filter is a strict subset of the library',
  baseOnly1.length < all.length);

const foundational = H.filterPresetsByHierarchy(all, { familyId: 'base-foundational' });
check('family filter matches the source chunk exactly',
  sameJson(foundational.map((p) => p.id), F.STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL.map((p) => p.id)));

const templateOnly = H.filterPresetsByHierarchy(all, { kind: 'template' });
check('kind=template over preset records returns nothing (templates are not presets)',
  templateOnly.length === 0);
const presetKind = H.filterPresetsByHierarchy(all, { kind: 'preset' });
check('kind=preset returns the whole starter library',
  presetKind.length === all.length);

const userPreset = { id: 'user-my-own-preset' };
check('an unplaced preset has no placement',
  H.getPresetHierarchyPlacement(userPreset.id) === null);
check('an unplaced preset survives an empty selection',
  H.filterPresetsByHierarchy([userPreset], {}).length === 1);
check('an unplaced preset is narrowed out by an active selection',
  H.filterPresetsByHierarchy([userPreset], { lineageId: 'starter-base' }).length === 0);

// ---- (f) derivation spot-checks ---------------------------------
const firstFoundational = F.STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL[0];
check('first foundational preset is placed in starter-base/base-foundational',
  H.getPresetHierarchyPlacement(firstFoundational.id)?.lineageId === 'starter-base'
  && H.getPresetHierarchyPlacement(firstFoundational.id)?.familyId === 'base-foundational');

const firstBundle = P.PRODUCT_PACK_BUNDLES[0];
const packStarterId = `starter-${firstBundle.id.replace(/^product-pack-/, 'pack-')}`;
check('product-pack starter id follows the starterLibrary formula and exists',
  starterIdSet.has(packStarterId));
check('product-pack starter is placed under product-packs',
  H.getPresetHierarchyPlacement(packStarterId)?.lineageId === 'product-packs');

// ---- source-level pins -------------------------------------------
check('hierarchy metadata lives in its own module',
  read('lib/presetHierarchy.ts').includes('PRESET_HIERARCHY_VERSION'));
check('preset panel wires the hierarchy filter in',
  read('components/controlPanelGlobalPresets.tsx').includes('filterPresetsByHierarchy'));

if (failures > 0) {
  console.error(`stage4-preset-hierarchy-s8: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`stage4-preset-hierarchy-s8: ${checks}/${checks} checks passed`);
