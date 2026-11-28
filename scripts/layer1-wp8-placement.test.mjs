#!/usr/bin/env node
// layer1-wp8-placement.test.mjs — Layer 1 WP8 phase C: the
// placement grammar (lib/gpgpuPlacement.ts), the MASH /
// Grasshopper family of placement rules (grid / ring / path /
// surface) plus the deterministic finishing grammar —
// randomisation, point IDs and species assignment — and its
// connection point into the shape stack
// (lib/gpgpuShapeStack.ts, appended section).
//
// Until this phase the distribution layer only TRANSFORMED
// points a source had placed; where points go was authored
// inside each source separately, with no shared grammar for
// arrays, rings, path placement, surface scatter, or the
// finishing rules. The placement layer generates positions
// as pure functions of the description and the supply — no
// RNG stream anywhere; every stochastic value comes from the
// named-channel deterministic hash, so a seed reproduces.
//
// Pins:
// (a) parse tolerance: unusable descriptions resolve to
//     null; parameters fall back per family.
// (b) operator exactness: grid counts and ranges (derived
//     and authored dimensions), ring radius / angle order,
//     path agreement with the shape stack's path source over
//     the same geometry, surface points exactly on the
//     sphere, and resolve determinism.
// (c) randomisation: same seed reproduces bit for bit, a
//     different seed decorrelates, offsets stay within
//     ±amplitude per axis, amplitude 0 is the identity, and
//     the input array is never mutated.
// (d) IDs: sequential IDs step by exactly 1 from the start;
//     group IDs equal floor(i / groupSize) and never decrease.
// (e) species agreement: the band rule equals the terrain
//     scatter's terrainScatterSpeciesZone over a (u, count)
//     grid; the hash rule reproduces attrSpeciesValue's zone
//     over index grids; the weights counts equal
//     allocateSpeciesCounts over the scaled weights; the
//     cumulative band edges of placementSpeciesByWeights.
// (f) identity: an empty finishing grammar changes nothing
//     (amplitude 0, species count 1, empty weights), and a
//     placement stack with no columns is the placement
//     operator's own output bit for bit, while a deform
//     column composes in the stack's fixed order.
//
// Run: node scripts/layer1-wp8-placement.test.mjs

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

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const PL = await load('lib/gpgpuPlacement.ts');
const SS = await load('lib/gpgpuShapeStack.ts');
const PG = await load('lib/pathGeometry.ts');
const MT = await load('lib/gpgpuMorphTargets.ts');
const AT = await load('lib/gpgpuAttributes.ts');
const SA = await load('lib/speciesAllocation.ts');
const DF = await load('lib/gpgpuDeformStack.ts');

const parse = PL.parsePlacementSpec;
const resolve = PL.resolvePlacement;

// ---------------------------------------------------------------------------
// (a) parse tolerance
// ---------------------------------------------------------------------------

check('parse: empty resolves to null', parse('') === null && parse(null) === null);
check('parse: non-JSON resolves to null', parse('grid please') === null);
check('parse: non-object resolves to null', parse('[1,2]') === null && parse('42') === null);
check('parse: unknown kind resolves to null', parse('{"kind":"spiral"}') === null);
check('parse: missing kind resolves to null', parse('{"spacing":2}') === null);
check('parse: path without svg resolves to null',
  parse('{"kind":"path","svg":""}') === null && parse('{"kind":"path"}') === null);
{
  const g = parse('{"kind":"grid","spacing":-3,"nx":2.9}');
  check('parse: grid fallbacks (spacing 1, nx floored)',
    g !== null && g.spacing === 1 && g.nx === 2 && g.ny === 0);
  const r = parse('{"kind":"ring","radius":0,"arc":7}');
  check('parse: ring fallbacks (radius 1, arc clamped to 1)',
    r !== null && r.radius === 1 && r.arc === 1);
  const p = parse('{"kind":"path","svg":"<svg/>","subpathMode":"bogus"}');
  check('parse: unknown subpath mode falls back to proportional',
    p !== null && p.subpathMode === 'proportional');
}

// ---------------------------------------------------------------------------
// (b) operator exactness — grid
// ---------------------------------------------------------------------------

{
  const pts = resolve('{"kind":"grid","spacing":0.5}', { count: 27 });
  check('grid: derived dims give exactly the count', pts !== null && pts.count === 27);
  let inRange = true;
  for (let i = 0; i < pts.count; i++) {
    for (let a = 0; a < 3; a++) if (Math.abs(pts.positions[i * 3 + a]) > 0.5 + 1e-12) inRange = false;
  }
  check('grid: derived 3x3x3 stays within ±spacing', inRange);
  check('grid: x-fastest neighbour spacing is exact',
    pts.positions[3] - pts.positions[0] === 0.5 && pts.positions[4] === pts.positions[1]);
  const dims = PL.placementGridDims(parse('{"kind":"grid"}'), 10);
  check('grid: derived dims for 10 are 3x2x2 covering the count',
    dims.nx === 3 && dims.ny === 2 && dims.nz === 2 && dims.total === 10);
  const ten = resolve('{"kind":"grid"}', { count: 10 });
  check('grid: non-cube count resolves exactly', ten !== null && ten.count === 10);
}
{
  const pts = resolve('{"kind":"grid","spacing":2,"nx":2,"ny":3,"nz":1}', { count: 999 });
  check('grid: authored dims ARE the point set', pts !== null && pts.count === 6);
  check('grid: authored first / last points are the centred corners',
    pts.positions[0] === -1 && pts.positions[1] === -2 && pts.positions[2] === 0
    && pts.positions[15] === 1 && pts.positions[16] === 2 && pts.positions[17] === 0);
}

// ---------------------------------------------------------------------------
// (b) operator exactness — ring
// ---------------------------------------------------------------------------

{
  const pts = resolve('{"kind":"ring","radius":2,"y":0.5}', { count: 8 });
  check('ring: exact count', pts !== null && pts.count === 8);
  let onCircle = true;
  let prev = -Infinity;
  let increasing = true;
  for (let i = 0; i < pts.count; i++) {
    const x = pts.positions[i * 3];
    const y = pts.positions[i * 3 + 1];
    const z = pts.positions[i * 3 + 2];
    if (!near(Math.sqrt(x * x + z * z), 2, 1e-6) || y !== 0.5) onCircle = false;
    let ang = Math.atan2(z, x);
    if (ang < 0) ang += Math.PI * 2;
    if (!(ang > prev)) increasing = false;
    prev = ang;
  }
  check('ring: every point on the circle at the authored height', onCircle);
  check('ring: angles strictly increase', increasing);
  const half = resolve('{"kind":"ring","radius":1,"arc":0.5}', { count: 16 });
  let inArc = true;
  for (let i = 0; i < half.count; i++) {
    let ang = Math.atan2(half.positions[i * 3 + 2], half.positions[i * 3]);
    if (ang < 0) ang += Math.PI * 2;
    if (ang > Math.PI + 1e-12) inArc = false;
  }
  check('ring: half arc stays within the half circle', inArc);
}

// ---------------------------------------------------------------------------
// (b) operator exactness — path (agrees with the shape stack source)
// ---------------------------------------------------------------------------

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<rect x="10" y="10" width="80" height="80"/></svg>';
{
  const count = 40;
  const placed = resolve(JSON.stringify({ kind: 'path', svg: SVG }), { count });
  const geom = PG.parseSvgPathGeometry(SVG);
  const viaStack = SS.generatePathSourcePoints(geom, count, 'proportional');
  check('path: exact count', placed !== null && placed.count === count);
  check('path: agrees with the shape stack path source point for point',
    placed !== null && sameArray(placed.positions, viaStack));
  check('path: geometry-free svg resolves to null',
    resolve('{"kind":"path","svg":"<svg></svg>"}', { count: 4 }) === null);
}

// ---------------------------------------------------------------------------
// (b) operator exactness — surface
// ---------------------------------------------------------------------------

{
  const spec = parse('{"kind":"surface","radius":3,"y":1}');
  const a = PL.resolvePlacementPoints(spec, { count: 64 });
  const b = PL.resolvePlacementPoints(spec, { count: 64 });
  check('surface: exact count', a !== null && a.count === 64);
  let onSphere = true;
  for (let i = 0; i < a.count; i++) {
    const dx = a.positions[i * 3];
    const dy = a.positions[i * 3 + 1] - 1;
    const dz = a.positions[i * 3 + 2];
    if (!near(Math.sqrt(dx * dx + dy * dy + dz * dz), 3, 1e-5)) onSphere = false;
  }
  check('surface: every point exactly on the sphere', onSphere);
  check('surface: resolve is deterministic', sameArray(a.positions, b.positions));
  check('resolve: unusable counts resolve to null',
    PL.resolvePlacementPoints(spec, { count: 0 }) === null
    && PL.resolvePlacementPoints(spec, { count: 2.5 }) === null);
}

// ---------------------------------------------------------------------------
// (c) randomisation
// ---------------------------------------------------------------------------

{
  const base = resolve('{"kind":"grid","spacing":1}', { count: 50 }).positions;
  const snapshot = new Float32Array(base);
  const r1 = PL.randomizePlacementPoints(base, 0.25, 7);
  const r2 = PL.randomizePlacementPoints(base, 0.25, 7);
  const r3 = PL.randomizePlacementPoints(base, 0.25, 8);
  check('randomize: same seed reproduces bit for bit', sameArray(r1, r2));
  check('randomize: different seed decorrelates', !sameArray(r1, r3));
  let bounded = true;
  for (let i = 0; i < base.length; i++) if (Math.abs(r1[i] - base[i]) > 0.25) bounded = false;
  check('randomize: offsets bounded by ±amplitude per axis', bounded);
  check('randomize: input is never mutated', sameArray(base, snapshot));
  check('randomize: amplitude 0 is the identity',
    sameArray(PL.randomizePlacementPoints(base, 0, 7), base));
  check('hash: reproducible and in [0, 1)',
    PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_X)
      === PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_X)
    && PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_X) >= 0
    && PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_X) < 1);
  check('hash: channels decorrelate',
    PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_X)
      !== PL.placementHash(3, 17, PL.PLACEMENT_CHANNEL_JITTER_Y));
}

// ---------------------------------------------------------------------------
// (d) IDs
// ---------------------------------------------------------------------------

{
  const seq = PL.placementSequentialIds(6, 5);
  check('ids: sequential from the start, stepping by 1',
    seq.length === 6 && seq[0] === 5 && seq[5] === 10
    && seq.every((v, i) => i === 0 || v - seq[i - 1] === 1));
  const grp = PL.placementGroupIds(10, 3);
  check('ids: group ids equal floor(i / groupSize)',
    grp.length === 10 && grp.every((v, i) => v === Math.floor(i / 3)));
  check('ids: group ids never decrease',
    grp.every((v, i) => i === 0 || v >= grp[i - 1]));
  check('ids: unusable group size clamps to 1',
    PL.placementGroupIds(3, 0).every((v, i) => v === i));
}

// ---------------------------------------------------------------------------
// (e) species agreement with the existing resolutions
// ---------------------------------------------------------------------------

{
  let bandAgree = true;
  for (const species of [1, 2, 3, 4]) {
    const scatter = {
      density: 1, heightMin: 0, heightMax: 1, slopeMax: 1,
      alignNormal: 0, species,
    };
    for (let k = 0; k <= 200; k++) {
      const u = k / 200;
      if (PL.placementSpeciesBand(u, species) !== MT.terrainScatterSpeciesZone(scatter, u)) {
        bandAgree = false;
      }
    }
    for (const u of [0, 0.25, 0.5, 0.75, 1, -0.1, 1.1]) {
      if (PL.placementSpeciesBand(u, species) !== MT.terrainScatterSpeciesZone(scatter, u)) {
        bandAgree = false;
      }
    }
  }
  check('species band: equals terrainScatterSpeciesZone over the grid', bandAgree);

  let hashAgree = true;
  for (const count of [2, 3, 4, 5, 6]) {
    for (let i = 0; i < 500; i++) {
      const zone = Math.round(AT.attrSpeciesValue(i, count) * (count - 1));
      if (PL.placementSpeciesHash(i, count) !== zone) hashAgree = false;
    }
  }
  check('species hash: reproduces the attrSpeciesValue zone over index grids', hashAgree);

  check('species weights: cumulative band edges',
    PL.placementSpeciesByWeights(0, [1, 1, 2]) === 0
    && PL.placementSpeciesByWeights(0.24, [1, 1, 2]) === 0
    && PL.placementSpeciesByWeights(0.25, [1, 1, 2]) === 1
    && PL.placementSpeciesByWeights(0.5, [1, 1, 2]) === 2
    && PL.placementSpeciesByWeights(0.999, [1, 1, 2]) === 2
    && PL.placementSpeciesByWeights(0.5, []) === 0
    && PL.placementSpeciesByWeights(0.5, [0, -1]) === 0);
  check('species counts: equal allocateSpeciesCounts over the scaled weights',
    sameArray(PL.placementSpeciesCounts(100, [1, 1, 2]),
      SA.allocateSpeciesCounts([1000000, 1000000, 2000000], 100))
    && sameArray(PL.placementSpeciesCounts(100, [1, 1, 2]), [25, 25, 50]));

  const banded = PL.assignPlacementSpecies(100, 'band', { speciesCount: 4 });
  check('assign band: four even bands of 25',
    banded.length === 100
    && [0, 1, 2, 3].every((s) => banded.filter((v) => v === s).length === 25)
    && banded.every((v, i) => i === 0 || v >= banded[i - 1]));
  const hashed1 = PL.assignPlacementSpecies(200, 'hash', { speciesCount: 4 });
  const hashed2 = PL.assignPlacementSpecies(200, 'hash', { speciesCount: 4 });
  check('assign hash: reproducible and within range',
    sameArray(hashed1, hashed2) && hashed1.every((v) => v < 4));
  const w1 = PL.assignPlacementSpecies(200, 'weights', { weights: [1, 3], seed: 5 });
  const w2 = PL.assignPlacementSpecies(200, 'weights', { weights: [1, 3], seed: 5 });
  const w3 = PL.assignPlacementSpecies(200, 'weights', { weights: [1, 3], seed: 6 });
  check('assign weights: reproducible per seed, decorrelated across seeds',
    sameArray(w1, w2) && !sameArray(w1, w3) && w1.every((v) => v < 2));
}

// ---------------------------------------------------------------------------
// (f) identity + the shape-stack connection point
// ---------------------------------------------------------------------------

{
  check('identity: species count 1 assigns only zone 0',
    PL.assignPlacementSpecies(10, 'band', { speciesCount: 1 }).every((v) => v === 0));
  check('identity: empty weights assign only species 0',
    PL.assignPlacementSpecies(10, 'weights', { weights: [] }).every((v) => v === 0));

  const raw = JSON.stringify({ placement: { kind: 'ring', radius: 2 } });
  const viaStack = SS.resolvePlacementStack(raw, { count: 12 });
  const direct = resolve('{"kind":"ring","radius":2}', { count: 12 });
  check('stack: placement stack with no columns is the operator output bit for bit',
    viaStack !== null && direct !== null && viaStack.count === 12
    && sameArray(viaStack.positions, direct.positions)
    && viaStack.normals === null && viaStack.alpha === null);
  check('stack: placement stack packs into the bake cloud',
    viaStack !== null && SS.shapeStackToCloudRgba(viaStack).length === 48);

  const deformed = SS.resolvePlacementStack(
    JSON.stringify({
      placement: { kind: 'ring', radius: 2 },
      deform: [{ op: 'twist', axis: 'y', amount: 0.3 }],
    }),
    { count: 12 },
  );
  const ops = DF.parseDeformOps('[{"op":"twist","axis":"y","amount":0.3}]');
  let manualAgree = deformed !== null && ops.length === 1;
  if (manualAgree) {
    for (let i = 0; i < 12; i++) {
      const [x, y, z] = DF.applyDeformOps(ops,
        direct.positions[i * 3], direct.positions[i * 3 + 1], direct.positions[i * 3 + 2]);
      if (deformed.positions[i * 3] !== x || deformed.positions[i * 3 + 1] !== y
        || deformed.positions[i * 3 + 2] !== z) manualAgree = false;
    }
  }
  check('stack: deform column composes over the placement in list order', manualAgree);
  check('stack: unusable placement resolves to null',
    SS.resolvePlacementStack('{"placement":{"kind":"spiral"}}', { count: 4 }) === null
    && SS.parsePlacementStack('{"deform":[]}') === null);
}

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`layer1-wp8-placement: ${checks - failures}/${checks} checks passed, ${failures} FAILED`);
  process.exit(1);
}
console.log(`layer1-wp8-placement: ${checks}/${checks} checks passed`);
console.log('ALL PASS');
