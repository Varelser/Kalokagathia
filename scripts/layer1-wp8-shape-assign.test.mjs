#!/usr/bin/env node
// layer1-wp8-shape-assign.test.mjs — Layer 1 WP8 phase E:
// the species source grammar (lib/gpgpuSpeciesGrammar.ts)
// and the vertex-correspondence shape blend
// (lib/gpgpuShapeBlend.ts) with its connection point in the
// shape stack (lib/gpgpuShapeStack.ts, appended section).
//
// Until this phase the geom species split was configured by
// a fixed key set (zones 0..3, resolveSpeciesGeomMode /
// resolveSpeciesObjSource in components/useGpgpuMeshAssets
// .ts) with no authored list form, and shape-to-shape
// transition had only the point-cloud attraction morph —
// no vertex-correspondence blend (blendshape / shape-key)
// existed anywhere. This phase adds the grammar and the
// blend as lib only; no draw wiring changes.
//
// Pins:
// (a) species agreement: for every configuration the keys
//     can express, resolving speciesSetFromConfig(cfg)
//     agrees with the existing resolvers for mode AND obj
//     source, over zones 0..5 (zones >= 4 exercise the
//     existing resolvers' own base fallback).
// (b) generalisation: an authored list longer than the key
//     set resolves its zones per entry, 'follow' and empty
//     sources fall back to the base, and zones past the
//     list resolve to the base.
// (c) parse tolerance and the empty description: unusable
//     input resolves to null; an empty authored set is the
//     legacy behaviour (every zone the base source), and
//     the default config's set resolves every zone to the
//     defaults.
// (d) blend endpoints and linearity: t = 0 / t = 1 return
//     the sides bit for bit, t = 0.5 is the componentwise
//     midpoint, t clamps, inputs are never mutated.
// (e) the resample rule: index-space linear interpolation
//     at the midpoint parameters — exact hand-computed
//     values for a 2 -> 4 resample, identity (a copy, bit
//     for bit) at equal counts, an explicit target count.
// (f) stack connection: a blend of two stacks at t = 0 / 1
//     is the corresponding stack's own resolution bit for
//     bit, the midpoint blends the resolutions, bad sides
//     resolve to null, a missing t resolves to 0.
// (g) lane rules: normals blend (renormalised) only when
//     both sides supply them; a missing alpha lane counts
//     as 1; both missing keeps the lane absent.
//
// Run: node scripts/layer1-wp8-shape-assign.test.mjs

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
const sameArray = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const nearArray = (a, b, eps) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!near(a[i], b[i], eps)) return false;
  return true;
};

// Each module is bundled separately: the grammar's
// resolveSpeciesObjSource and the mesh assets' resolver of
// the same name must stay distinct bindings in this test.
async function loadFile(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, platform: 'node',
    format: 'esm', write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
async function loadStdin(contents) {
  const out = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const MA = await loadStdin(`
  export { resolveSpeciesGeomMode, resolveSpeciesObjSource } from './components/useGpgpuMeshAssets.ts';
  export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
`);
const SG = await loadFile('lib/gpgpuSpeciesGrammar.ts');
const SB = await loadFile('lib/gpgpuShapeBlend.ts');
const SS = await loadFile('lib/gpgpuShapeStack.ts');

{
  const { resolveSpeciesGeomMode, resolveSpeciesObjSource } = MA;
  const { APP_STATE_DEFAULT_GPGPU } = MA;
  const {
    speciesSetFromConfig, parseSpeciesSet,
    resolveSpeciesMode, resolveSpeciesObjSource: resolveSetObjSource,
    resolveSpeciesZones, speciesSourcesForZones,
  } = SG;
  const { blendShapePointSets, resampleShapePointSet, clampBlendT } = SB;
  const { parseShapeBlend, resolveShapeBlend, resolveShapeStack } = SS;

  const DOC_A = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3';
  const DOC_B = 'v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3';

  // -------------------------------------------------------------------------
  // (a) species agreement with the existing resolvers
  // -------------------------------------------------------------------------

  const ALL_MODES = ['point', 'cube', 'tetra', 'octa', 'icosa', 'torus', 'cone', 'obj', 'follow'];
  const modeTriples = [
    ...ALL_MODES.map((v) => [v, v, v]),
    ['cube', 'follow', 'obj'],
    ['obj', 'point', 'cone'],
    ['follow', 'follow', 'follow'],
    ['tetra', 'obj', 'follow'],
  ];
  const sourceTriples = [
    ['', '', ''],
    [DOC_B, '', ''],
    ['', '   ', DOC_B],
    [DOC_B, DOC_B, DOC_B],
  ];
  let agreementConfigs = 0;
  for (const baseMode of ['point', 'cube', 'obj', 'torus']) {
    for (const modes of modeTriples) {
      for (const baseObj of ['', DOC_A]) {
        for (const sources of sourceTriples) {
          const cfg = {
            ...APP_STATE_DEFAULT_GPGPU,
            gpgpuGeomMode: baseMode,
            gpgpuMorphObjSource: baseObj,
            gpgpuGeomSpecies2Mode: modes[0],
            gpgpuGeomSpecies3Mode: modes[1],
            gpgpuGeomSpecies4Mode: modes[2],
            gpgpuGeomSpecies2ObjSource: sources[0],
            gpgpuGeomSpecies3ObjSource: sources[1],
            gpgpuGeomSpecies4ObjSource: sources[2],
          };
          const set = speciesSetFromConfig(cfg);
          agreementConfigs += 1;
          for (let z = 0; z <= 5; z++) {
            check(`agreement mode cfg#${agreementConfigs} zone ${z}`,
              resolveSpeciesMode(set, z) === resolveSpeciesGeomMode(cfg, z));
            check(`agreement obj cfg#${agreementConfigs} zone ${z}`,
              resolveSetObjSource(set, z) === resolveSpeciesObjSource(cfg, z));
          }
        }
      }
    }
  }
  check('agreement grid is substantive', agreementConfigs >= 400);

  // -------------------------------------------------------------------------
  // (b) generalisation past the fixed key set
  // -------------------------------------------------------------------------

  {
    const set = parseSpeciesSet(JSON.stringify({
      baseMode: 'cube',
      baseObjSource: DOC_A,
      species: [
        { mode: 'tetra', objSource: '' },
        { mode: 'follow', objSource: DOC_B },
        { mode: 'obj', objSource: DOC_B },
        { mode: 'cone', objSource: '' },
        { mode: 'obj', objSource: '  ' },
        { mode: 'icosa', objSource: '' },
      ],
    }));
    check('generalisation: parses', set !== null && set.entries.length === 6);
    check('generalisation: zone 0 is the base', resolveSpeciesMode(set, 0) === 'cube' && resolveSetObjSource(set, 0) === DOC_A);
    check('generalisation: zone 1 own mode', resolveSpeciesMode(set, 1) === 'tetra');
    check('generalisation: zone 2 follow -> base mode', resolveSpeciesMode(set, 2) === 'cube');
    check('generalisation: zone 2 own obj source', resolveSetObjSource(set, 2) === DOC_B);
    check('generalisation: zone 3 obj with own source', resolveSpeciesMode(set, 3) === 'obj' && resolveSetObjSource(set, 3) === DOC_B);
    check('generalisation: zone 5 whitespace source -> base', resolveSetObjSource(set, 5) === DOC_A);
    check('generalisation: zone 6 past the key set resolves', resolveSpeciesMode(set, 6) === 'icosa');
    check('generalisation: zone 7 past the list -> base', resolveSpeciesMode(set, 7) === 'cube' && resolveSetObjSource(set, 7) === DOC_A);
    const zones = resolveSpeciesZones(set, 4);
    check('generalisation: resolveSpeciesZones shape', zones.length === 4 && zones[1].mode === 'tetra' && zones[3].mode === 'obj');
    const perPoint = speciesSourcesForZones(set, new Uint8Array([0, 3, 3, 6]));
    check('generalisation: per-point sources follow zones',
      perPoint.length === 4 && perPoint[0].mode === 'cube' && perPoint[1].mode === 'obj' && perPoint[3].mode === 'icosa');
  }

  // -------------------------------------------------------------------------
  // (c) parse tolerance and the empty description
  // -------------------------------------------------------------------------

  check('parse: empty resolves to null', parseSpeciesSet('') === null && parseSpeciesSet(null) === null && parseSpeciesSet(undefined) === null);
  check('parse: non-JSON resolves to null', parseSpeciesSet('species please') === null);
  check('parse: non-object resolves to null', parseSpeciesSet('[1,2]') === null && parseSpeciesSet('42') === null);
  {
    const empty = parseSpeciesSet('{}');
    check('parse: {} is the empty set', empty !== null && empty.entries.length === 0 && empty.baseMode === 'point' && empty.baseObjSource === '');
    let allBase = true;
    for (let z = 0; z <= 7; z++) {
      if (resolveSpeciesMode(empty, z) !== 'point' || resolveSetObjSource(empty, z) !== '') allBase = false;
    }
    check('empty set: every zone resolves to the base (legacy behaviour)', allBase);
    const odd = parseSpeciesSet('{"baseMode":"bogus","baseObjSource":7,"species":[{"mode":"bogus","objSource":null},42]}');
    check('parse: field fallbacks (base point, entry follow, non-object entry kept as follow)',
      odd !== null && odd.baseMode === 'point' && odd.baseObjSource === '' &&
      odd.entries.length === 2 && odd.entries[0].mode === 'follow' && odd.entries[0].objSource === '' && odd.entries[1].mode === 'follow');
    const alias = parseSpeciesSet('{"entries":[{"mode":"cone"}]}');
    check('parse: entries alias accepted', alias !== null && alias.entries.length === 1 && alias.entries[0].mode === 'cone');
  }
  {
    const set = speciesSetFromConfig({ ...APP_STATE_DEFAULT_GPGPU });
    let ok = true;
    for (let z = 0; z <= 3; z++) {
      if (resolveSpeciesMode(set, z) !== APP_STATE_DEFAULT_GPGPU.gpgpuGeomMode) ok = false;
      if (resolveSetObjSource(set, z) !== APP_STATE_DEFAULT_GPGPU.gpgpuMorphObjSource) ok = false;
    }
    check('default config: every zone resolves to the defaults', ok);
  }

  // -------------------------------------------------------------------------
  // (d) blend endpoints and linearity
  // -------------------------------------------------------------------------

  const mkSet = (positions, normals = null, alpha = null) => ({
    count: positions.length / 3,
    positions: new Float32Array(positions),
    normals: normals ? new Float32Array(normals) : null,
    alpha: alpha ? new Float32Array(alpha) : null,
  });
  const A4 = mkSet([0, 0, 0, 1, 2, 3, -4, 5, -6, 7, -8, 9]);
  const B4 = mkSet([10, 10, 10, -1, -2, -3, 4, -5, 6, -7, 8, -9]);
  const a4Snapshot = new Float32Array(A4.positions);
  const b4Snapshot = new Float32Array(B4.positions);

  {
    const at0 = blendShapePointSets(A4, B4, 0);
    const at1 = blendShapePointSets(A4, B4, 1);
    check('blend: t=0 is A bit for bit', at0.count === 4 && sameArray(at0.positions, A4.positions));
    check('blend: t=1 is B bit for bit', at1.count === 4 && sameArray(at1.positions, B4.positions));
    const mid = blendShapePointSets(A4, B4, 0.5);
    const expected = new Float32Array(12);
    for (let i = 0; i < 12; i++) expected[i] = (A4.positions[i] + B4.positions[i]) / 2;
    check('blend: t=0.5 is the componentwise midpoint', nearArray(mid.positions, expected, 1e-6));
    check('blend: t clamps above 1', sameArray(blendShapePointSets(A4, B4, 2).positions, B4.positions));
    check('blend: t clamps below 0', sameArray(blendShapePointSets(A4, B4, -1).positions, A4.positions));
    check('blend: clampBlendT', clampBlendT(NaN) === 0 && clampBlendT(0.25) === 0.25 && clampBlendT(9) === 1);
    check('blend: inputs are never mutated', sameArray(A4.positions, a4Snapshot) && sameArray(B4.positions, b4Snapshot));
  }

  // -------------------------------------------------------------------------
  // (e) the resample rule
  // -------------------------------------------------------------------------

  {
    const A2 = mkSet([0, 0, 0, 10, 0, 0]);
    const B4b = mkSet([100, 0, 0, 100, 0, 0, 100, 0, 0, 100, 0, 0]);
    const out = blendShapePointSets(A2, B4b, 0);
    // s_i = (i + 0.5) * 2 / 4 - 0.5 = i / 2 - 0.25, clamped to [0, 1]:
    // i=0 -> 0, i=1 -> 0.25, i=2 -> 0.75, i=3 -> 1 (clamped).
    check('resample: output count is the larger count', out.count === 4);
    check('resample: 2 -> 4 hand-computed values',
      nearArray(out.positions, new Float32Array([0, 0, 0, 2.5, 0, 0, 7.5, 0, 0, 10, 0, 0]), 1e-6));
    const identity = resampleShapePointSet(B4b, 4);
    check('resample: equal counts are a bit-for-bit copy',
      sameArray(identity.positions, B4b.positions) && identity.positions !== B4b.positions);
    const targeted = blendShapePointSets(A4, B4, 0.5, 2);
    check('resample: explicit target count wins', targeted.count === 2 && targeted.positions.length === 6);
    const down = resampleShapePointSet(A4, 2);
    // s_i = (i + 0.5) * 4 / 2 - 0.5 = 2i + 0.5: i=0 -> midpoint of points 0,1; i=1 -> midpoint of points 2,3.
    check('resample: 4 -> 2 hand-computed values',
      nearArray(down.positions, new Float32Array([0.5, 1, 1.5, 1.5, -1.5, 1.5]), 1e-6));
  }

  // -------------------------------------------------------------------------
  // (f) stack connection
  // -------------------------------------------------------------------------

  {
    const stackA = JSON.stringify({ source: { kind: 'emit', shape: 'sphere', radius: 1 } });
    const stackB = JSON.stringify({ source: { kind: 'emit', shape: 'box', radius: 2 } });
    const supply = { count: 16, seed: 7 };
    const resA = resolveShapeStack(stackA, supply);
    const resB = resolveShapeStack(stackB, supply);
    check('stack blend: sides resolve', resA !== null && resB !== null);
    const blendRaw = JSON.stringify({ a: JSON.parse(stackA), b: JSON.parse(stackB), t: 0.5 });
    const at0 = resolveShapeBlend(JSON.stringify({ a: JSON.parse(stackA), b: JSON.parse(stackB), t: 0 }), supply);
    const at1 = resolveShapeBlend(JSON.stringify({ a: JSON.parse(stackA), b: JSON.parse(stackB), t: 1 }), supply);
    check('stack blend: t=0 is stack A bit for bit', at0 !== null && sameArray(at0.positions, resA.positions));
    check('stack blend: t=1 is stack B bit for bit', at1 !== null && sameArray(at1.positions, resB.positions));
    const mid = resolveShapeBlend(blendRaw, supply);
    const expected = new Float32Array(resA.positions.length);
    for (let i = 0; i < expected.length; i++) expected[i] = (resA.positions[i] + resB.positions[i]) / 2;
    check('stack blend: t=0.5 blends the resolutions', mid !== null && nearArray(mid.positions, expected, 1e-4));
    const stringSides = resolveShapeBlend(JSON.stringify({ a: stackA, b: stackB, t: 0 }), supply);
    check('stack blend: JSON-string sides accepted', stringSides !== null && sameArray(stringSides.positions, resA.positions));
    const noT = resolveShapeBlend(JSON.stringify({ a: JSON.parse(stackA), b: JSON.parse(stackB) }), supply);
    check('stack blend: missing t resolves to the A side', noT !== null && sameArray(noT.positions, resA.positions));
    check('stack blend: unusable side resolves to null',
      parseShapeBlend('{"a":{"source":{"kind":"nope"}},"b":{"source":{"kind":"emit"}}}') === null &&
      resolveShapeBlend('{"a":42,"b":{}}', supply) === null &&
      parseShapeBlend('') === null);
  }

  // -------------------------------------------------------------------------
  // (g) lane rules
  // -------------------------------------------------------------------------

  {
    const withNormals = (nx, ny, nz) => mkSet(
      [0, 0, 0, 1, 0, 0],
      [nx, ny, nz, nx, ny, nz],
    );
    const nA = withNormals(1, 0, 0);
    const nB = withNormals(0, 1, 0);
    const nMid = blendShapePointSets(nA, nB, 0.5);
    const s = Math.SQRT1_2;
    check('lanes: normals blend and renormalise',
      nMid.normals !== null && nearArray(nMid.normals, new Float32Array([s, s, 0, s, s, 0]), 1e-6));
    const oneSided = blendShapePointSets(nA, mkSet([0, 0, 0, 1, 0, 0]), 0.5);
    check('lanes: one-sided normals carry none', oneSided.normals === null);
    const aOnly = blendShapePointSets(mkSet([0, 0, 0, 1, 0, 0], null, [0, 0]), nB, 0.5);
    check('lanes: missing alpha counts as 1', aOnly.alpha !== null && nearArray(aOnly.alpha, new Float32Array([0.5, 0.5]), 1e-6));
    const noAlpha = blendShapePointSets(A4, B4, 0.5);
    check('lanes: both alpha missing keeps the lane absent', noAlpha.alpha === null);
    const bothAlpha = blendShapePointSets(
      mkSet([0, 0, 0, 1, 0, 0], null, [0.2, 0.4]),
      mkSet([0, 0, 0, 1, 0, 0], null, [0.6, 0.8]),
      0.5,
    );
    check('lanes: alpha lerps', bothAlpha.alpha !== null && nearArray(bothAlpha.alpha, new Float32Array([0.4, 0.6]), 1e-6));
  }
}

console.log(`layer1-wp8-shape-assign: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
