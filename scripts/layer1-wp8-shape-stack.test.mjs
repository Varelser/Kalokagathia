#!/usr/bin/env node
// layer1-wp8-shape-stack.test.mjs — Layer 1 WP8 phase B: the
// shape stack (lib/gpgpuShapeStack.ts), the single resolution
// point for the stacking grammar "source -> deform column ->
// distribution column".
//
// Until this phase the shape sources lived behind separate
// keys and modules (the E1 emit law, the morph targets, the
// authored paths, the text contours) and the two general
// operator columns (WP8 phase A's deform stack, stage 2 B5's
// distribution layer) had to be wired into each consumer
// separately. The stack names one source and the two columns
// in a single authored description and resolves them in the
// fixed order, calling the existing generators directly and
// changing none of them. CSG is not a source: its pipeline
// runs through a WASM Web Worker (async, queued), which the
// layer's synchronous pure-function contract cannot call.
//
// Pins:
// (a) parse tolerance: unusable descriptions resolve to
//     null; unknown source parameters fall back per family;
//     the columns reuse the existing parsers (array and
//     string forms alike), so unknown / identity operators
//     drop exactly as they do in the bakes.
// (b) per-source agreement: with both columns empty, each
//     source family resolves to exactly the points its own
//     existing generator produces when called directly
//     (emit law loop, morph builder lanes, path resolver,
//     text layout contours walked by arc length).
// (c) column order: resolution applies source -> deform ->
//     distribution, in list order within each column; the
//     reverse order gives a measurably different point set.
// (d) identity: a stack with no effective columns is the
//     identity over its source, bit for bit.
// (e) bake-lane shape: shapeStackToCloudRgba packs the
//     morph-layout RGBA cloud (alpha lane or 1).
// (f) refusal: unusable counts, geometry-free SVG, and a
//     text source with no supplied font resolve to null.
//
// Run: node scripts/layer1-wp8-shape-stack.test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const S = await load('lib/gpgpuShapeStack.ts');
const E = await load('lib/gpgpuEmitShapes.ts');
const R = await load('lib/seededRng.ts');
const M = await load('lib/gpgpuMorphTargets.ts');
const P = await load('lib/pathGeometry.ts');
const T = await load('lib/textExtrude.ts');
const D = await load('lib/gpgpuDeformStack.ts');
const B = await load('lib/gpgpuDistribution.ts');

const parse = S.parseShapeStack;
const resolveStack = S.resolveShapeStack;

// ---- (a) parse tolerance ----------------------------------------------
check('parse: empty / null / garbage resolve to null',
  parse('') === null && parse(null) === null && parse(undefined) === null &&
  parse('not json') === null && parse('[]') === null && parse('{}') === null &&
  parse('{"source":null}') === null && parse('{"source":{"kind":"warp"}}') === null);
check('parse: shape source with unknown target resolves to null',
  parse('{"source":{"kind":"shape","target":"nope"}}') === null);
check('parse: path source without svg resolves to null',
  parse('{"source":{"kind":"path"}}') === null &&
  parse('{"source":{"kind":"path","svg":""}}') === null);
check('parse: text source without text resolves to null',
  parse('{"source":{"kind":"text"}}') === null &&
  parse('{"source":{"kind":"text","text":""}}') === null);
{
  const spec = parse('{"source":{"kind":"emit","shape":"nope","radius":-3}}');
  check('parse: emit unknown shape falls back to sphere, bad radius to auto',
    spec !== null && spec.source.shape === 'sphere' && spec.source.radius === 0);
}
{
  const arr = parse('{"source":{"kind":"emit"},"deform":[{"op":"twist","amount":0.5},{"op":"warp"}],'
    + '"distribution":[{"op":"power","a":2},{"op":"power","a":1}]}');
  const str = parse('{"source":{"kind":"emit"},"deform":"[{\\"op\\":\\"twist\\",\\"amount\\":0.5}]",'
    + '"distribution":"[{\\"op\\":\\"power\\",\\"a\\":2}]"}');
  check('parse: columns accept array and string forms, sanitised by the existing parsers',
    arr !== null && arr.deform.length === 1 && arr.deform[0].op === 'twist' &&
    arr.distribution.length === 1 && arr.distribution[0].op === 'power' &&
    str !== null && str.deform.length === 1 && str.distribution.length === 1);
  check('parse: identity-only columns resolve to empty (identity discipline)',
    parse('{"source":{"kind":"emit"},"deform":[{"op":"twist","amount":0}]}').deform.length === 0);
}

// ---- (b) per-source agreement with direct generator calls -------------
{
  // emit: the direct loop a caller of the shape law writes.
  const count = 64;
  const seed = 1234;
  const radius = 30;
  const next = R.createSeededRng(seed);
  const direct = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = E.sampleEmitShape('cone', next, radius, null);
    direct[i * 3] = p[0]; direct[i * 3 + 1] = p[1]; direct[i * 3 + 2] = p[2];
  }
  const got = resolveStack(
    '{"source":{"kind":"emit","shape":"cone","radius":30}}', { count, seed });
  check('emit: stack resolution equals the direct shape-law loop, bit for bit',
    got !== null && sameArray(got.positions, direct) && got.normals === null && got.alpha === null);
}
{
  // shape: the morph builder's own lanes (square count).
  const count = 256;
  const seed = 77;
  const built = M.buildGpgpuMorphTargetDataWithNormals({
    texSize: 16, target: 'trefoil', worldScale: 2, jitter: 0, seed,
  });
  const got = resolveStack(
    '{"source":{"kind":"shape","target":"trefoil","worldScale":2}}', { count, seed });
  let ok = got !== null;
  if (ok) {
    for (let i = 0; i < count; i++) {
      if (got.positions[i * 3] !== built.data[i * 4] ||
          got.positions[i * 3 + 1] !== built.data[i * 4 + 1] ||
          got.positions[i * 3 + 2] !== built.data[i * 4 + 2] ||
          got.alpha[i] !== built.data[i * 4 + 3] ||
          got.normals[i * 3] !== built.normalData[i * 4] ||
          got.normals[i * 3 + 1] !== built.normalData[i * 4 + 1] ||
          got.normals[i * 3 + 2] !== built.normalData[i * 4 + 2]) { ok = false; break; }
    }
  }
  check('shape: stack resolution equals the morph builder lanes, bit for bit', ok);
  // Non-square count: the smallest covering texSize, first count texels.
  const built10 = M.buildGpgpuMorphTargetDataWithNormals({
    texSize: 10, target: 'shell', worldScale: 1, jitter: 0, seed: 5,
  });
  const got100 = resolveStack(
    '{"source":{"kind":"shape","target":"shell"}}', { count: 100, seed: 5 });
  let ok100 = got100 !== null;
  if (ok100) {
    for (let i = 0; i < 100; i++) {
      if (got100.positions[i * 3] !== built10.data[i * 4] ||
          got100.positions[i * 3 + 2] !== built10.data[i * 4 + 2]) { ok100 = false; break; }
    }
  }
  check('shape: non-square count slices the covering build', ok100);
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<rect x="10" y="10" width="80" height="80"/></svg>';
{
  const count = 32;
  const geom = P.parseSvgPathGeometry(SVG);
  const direct = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = P.resolvePathPoint(geom, (i + 0.5) / count, 'proportional');
    direct[i * 3] = p.x; direct[i * 3 + 1] = p.y; direct[i * 3 + 2] = 0;
  }
  const got = resolveStack(
    JSON.stringify({ source: { kind: 'path', svg: SVG } }), { count, seed: 0 });
  check('path: stack resolution equals the direct path resolver walk, bit for bit',
    got !== null && sameArray(got.positions, direct));
}
{
  // contour walk: an independent hand computation on a square.
  const square = [[[0, 0], [2, 0], [2, 2], [0, 2]]];
  const pts = S.generateContourSourcePoints(square, 4);
  check('contour: equidistant arc walk on a square hits the edge midpoints',
    pts !== null && pts[0] === 1 && pts[1] === 0 && pts[3] === 2 && pts[4] === 1 &&
    pts[6] === 1 && pts[7] === 2 && pts[9] === 0 && pts[10] === 1);
  check('contour: degenerate contours resolve to null',
    S.generateContourSourcePoints([], 4) === null &&
    S.generateContourSourcePoints([[[1, 1]]], 4) === null);
}
{
  // text: layout called directly, its contours walked by the
  // stack's contour generator.
  const fontBytes = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  const fontBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
  const parsed = T.parseTextExtrudeFont(fontBuffer);
  check('text: test font parses', parsed.ok === true);
  if (parsed.ok) {
    const laid = T.layoutTextExtrudeContours(parsed.font, 'O', 0.001);
    check('text: direct layout succeeds', laid.ok === true);
    if (laid.ok) {
      const count = 48;
      const direct = S.generateContourSourcePoints(laid.layout.contours, count);
      const got = resolveStack(
        '{"source":{"kind":"text","text":"O","flatness":0.001}}',
        { count, seed: 0, font: parsed.font });
      check('text: stack resolution equals the direct layout contour walk, bit for bit',
        got !== null && direct !== null && sameArray(got.positions, direct));
      const noFont = resolveStack(
        '{"source":{"kind":"text","text":"O"}}', { count, seed: 0 });
      check('text: no supplied font resolves to null', noFont === null);
    }
  }
}

// ---- (c) column order: source -> deform -> distribution ---------------
{
  const count = 48;
  const seed = 9;
  const raw = JSON.stringify({
    source: { kind: 'emit', shape: 'sphere', radius: 10 },
    deform: [{ op: 'twist', axis: 'y', amount: 0.8 }],
    distribution: [{ op: 'power', a: 2 }],
  });
  const spec = parse(raw);
  const got = S.resolveShapeStackPoints(spec, { count, seed });
  const deformOps = D.parseDeformOps(JSON.stringify(spec.deform.map((o) => ({ ...o, op: o.op }))));
  // Manual pipeline in the documented order, radius auto = emit radius.
  const basePts = S.generateEmitSourcePoints('sphere', count, seed, 10, null);
  const manual = new Float32Array(basePts);
  const distOps = B.parseDistributionOps('[{"op":"power","a":2}]');
  const twistOps = D.parseDeformOps('[{"op":"twist","axis":"y","amount":0.8}]');
  for (let i = 0; i < count; i++) {
    let p = D.applyDeformOps(twistOps, manual[i * 3], manual[i * 3 + 1], manual[i * 3 + 2]);
    p = B.applyDistributionOps(distOps, p[0], p[1], p[2], 10);
    manual[i * 3] = p[0]; manual[i * 3 + 1] = p[1]; manual[i * 3 + 2] = p[2];
  }
  check('order: resolution equals source -> deform -> distribution applied manually',
    got !== null && sameArray(got.positions, manual) && deformOps.length === 1);
  // The reverse order must differ somewhere (the test can tell order apart).
  const reversed = new Float32Array(basePts);
  for (let i = 0; i < count; i++) {
    let p = B.applyDistributionOps(distOps, reversed[i * 3], reversed[i * 3 + 1], reversed[i * 3 + 2], 10);
    p = D.applyDeformOps(twistOps, p[0], p[1], p[2]);
    reversed[i * 3] = p[0]; reversed[i * 3 + 1] = p[1]; reversed[i * 3 + 2] = p[2];
  }
  check('order: distribution -> deform differs (order is observable)',
    got !== null && !sameArray(got.positions, reversed));
  // Supply radius overrides the auto distribution radius.
  const gotR = S.resolveShapeStackPoints(spec, { count, seed, radius: 4 });
  const manualR = new Float32Array(basePts);
  for (let i = 0; i < count; i++) {
    let p = D.applyDeformOps(twistOps, manualR[i * 3], manualR[i * 3 + 1], manualR[i * 3 + 2]);
    p = B.applyDistributionOps(distOps, p[0], p[1], p[2], 4);
    manualR[i * 3] = p[0]; manualR[i * 3 + 1] = p[1]; manualR[i * 3 + 2] = p[2];
  }
  check('order: supply radius overrides the distribution radius',
    gotR !== null && sameArray(gotR.positions, manualR));
}

// ---- (d) identity ------------------------------------------------------
{
  const got = resolveStack(
    '{"source":{"kind":"emit","shape":"ring","radius":5},"deform":[{"op":"bend","amount":0}],"distribution":[]}',
    { count: 16, seed: 3 });
  const direct = S.generateEmitSourcePoints('ring', 16, 3, 5, null);
  check('identity: identity-only columns leave the source points bit-identical',
    got !== null && sameArray(got.positions, direct));
}

// ---- (e) bake-lane shape ------------------------------------------------
{
  const plain = resolveStack(
    '{"source":{"kind":"emit","shape":"disc","radius":2}}', { count: 8, seed: 1 });
  const cloud = S.shapeStackToCloudRgba(plain);
  let ok = cloud.length === 32;
  for (let i = 0; i < 8 && ok; i++) {
    if (cloud[i * 4] !== plain.positions[i * 3] || cloud[i * 4 + 3] !== 1) ok = false;
  }
  check('cloud: RGBA packing copies xyz and defaults alpha to 1', ok);
  const shaped = resolveStack(
    '{"source":{"kind":"shape","target":"shell"}}', { count: 16, seed: 2 });
  const cloud2 = S.shapeStackToCloudRgba(shaped);
  let ok2 = true;
  for (let i = 0; i < 16 && ok2; i++) {
    if (cloud2[i * 4 + 3] !== shaped.alpha[i]) ok2 = false;
  }
  check('cloud: RGBA packing carries the shape source alpha lane', ok2);
}

// ---- (f) refusal ---------------------------------------------------------
check('refusal: unusable counts resolve to null',
  resolveStack('{"source":{"kind":"emit"}}', { count: 0, seed: 0 }) === null &&
  resolveStack('{"source":{"kind":"emit"}}', { count: 2.5, seed: 0 }) === null);
check('refusal: geometry-free svg resolves to null',
  resolveStack(JSON.stringify({ source: { kind: 'path', svg: '<svg></svg>' } }),
    { count: 8, seed: 0 }) === null);

console.log(`layer1-wp8-shape-stack: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
