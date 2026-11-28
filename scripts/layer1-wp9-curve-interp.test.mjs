#!/usr/bin/env node
// layer1-wp9-curve-interp.test.mjs — Layer 1 WP9 phase A: the
// free curve asset (lib/freeCurve.ts) gains an interpolation
// mode. 'linear' is the legacy piecewise-linear evaluation and
// stays the default; 'smooth' is an added monotone cubic
// (Fritsch–Carlson Hermite) evaluation carried inside the
// asset's authoring form (FreeCurveAsset), never in a config
// key of its own.
//
// Pins:
// (a) linear agreement: the two-argument evaluation and the
//     explicit 'linear' mode both reproduce, bit-exactly over
//     a grid, an independent copy of the pre-change
//     piecewise-linear formula (below). The closed-form
//     integral consumers (S2 retimer line) rest on this.
// (b) smooth properties: knots returned bit-exactly, endpoint
//     values held outside the knot range, monotone knot data
//     evaluates monotonically with no overshoot beyond each
//     segment's endpoint values (also on non-monotone data),
//     C1 continuity at interior knots, an all-ones curve is
//     exactly 1, and a two-point curve reduces to the linear
//     blend. The smooth mode also actually differs from linear
//     somewhere on a non-trivial curve.
// (c) backward compatibility of the authoring form: a stored
//     flat array resolves to the linear default with the same
//     knots as normalizeFreeCurvePoints; garbage resolves to
//     the identity asset, linear; a linear asset flattens back
//     to the plain flat array; a smooth asset round-trips
//     through its object form with mode and knots intact.
//
// Run: node scripts/layer1-wp9-curve-interp.test.mjs

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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const F = await load('lib/freeCurve.ts');

// Independent copy of the pre-change piecewise-linear formula
// (the evaluateFreeCurve body as it stood before WP9 phase A).
function legacyLinear(points, t) {
  if (points.length === 0) return 1;
  const x = Math.min(1, Math.max(0, t));
  if (x <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.t) return last.v;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      if (x === b.t) return b.v;
      const span = b.t - a.t;
      const f = span > 0 ? (x - a.t) / span : 0;
      return a.v + (b.v - a.v) * f;
    }
  }
  return last.v;
}

// Deterministic curve set: identity, two-point, interior knots
// not spanning [0, 1], a peak, a valley, monotone, 8 points,
// values at the [0, 4] bounds.
const CURVES = [
  [0, 1, 1, 1],
  [0, 0, 1, 4],
  [0.25, 2, 0.75, 3],
  [0, 0, 0.5, 1, 1, 1],
  [0, 3, 0.4, 0.5, 1, 2.5],
  [0, 0, 0.2, 0.5, 0.5, 0.75, 0.8, 3, 1, 3.5],
  [0, 1, 0.3, 3, 0.6, 0.5, 1, 2],
  [0, 4, 0.125, 0, 0.25, 4, 0.375, 0, 0.5, 4, 0.625, 0, 0.75, 4, 1, 0],
  [0.1, 0.25, 0.9, 3.75],
].map((flat) => F.normalizeFreeCurvePoints(flat));

const gridT = [];
for (let i = 0; i <= 1000; i++) gridT.push(i / 1000);
gridT.push(-0.5, 1.5, Math.SQRT1_2, Math.PI / 4);

// ---- (a) linear agreement ---------------------------------------------
{
  let okDefault = true;
  let okExplicit = true;
  for (const points of CURVES) {
    const ts = [...gridT, ...points.map((p) => p.t)];
    for (const t of ts) {
      const expected = legacyLinear(points, t);
      if (F.evaluateFreeCurve(points, t) !== expected) okDefault = false;
      if (F.evaluateFreeCurve(points, t, 'linear') !== expected) okExplicit = false;
    }
  }
  check('linear: two-argument evaluation is bit-identical to the legacy formula on the grid', okDefault);
  check("linear: explicit 'linear' mode is bit-identical to the legacy formula on the grid", okExplicit);
  check('linear: empty point list evaluates to 1 in both modes',
    F.evaluateFreeCurve([], 0.3) === 1 && F.evaluateFreeCurve([], 0.3, 'smooth') === 1);
}

// ---- (b) smooth properties --------------------------------------------
{
  // Knots bit-exact + endpoint hold, on every curve.
  let knotsOk = true;
  let holdOk = true;
  for (const points of CURVES) {
    for (const p of points) {
      if (F.evaluateFreeCurveSmooth(points, p.t) !== p.v) knotsOk = false;
      if (F.evaluateFreeCurve(points, p.t, 'smooth') !== p.v) knotsOk = false;
    }
    if (F.evaluateFreeCurveSmooth(points, -1) !== points[0].v) holdOk = false;
    if (F.evaluateFreeCurveSmooth(points, 2) !== points[points.length - 1].v) holdOk = false;
    if (F.evaluateFreeCurveSmooth(points, 0) !== legacyLinear(points, 0)) holdOk = false;
    if (F.evaluateFreeCurveSmooth(points, 1) !== legacyLinear(points, 1)) holdOk = false;
  }
  check('smooth: every knot returns its value bit-exactly', knotsOk);
  check('smooth: endpoint values hold outside the knot range (and agree with linear at t=0/1)', holdOk);

  // Monotone data → monotone samples, bounded by the end values.
  const mono = F.normalizeFreeCurvePoints([0, 0, 0.2, 0.5, 0.5, 0.75, 0.8, 3, 1, 3.5]);
  let monoOk = true;
  let prev = -Infinity;
  for (let i = 0; i <= 2000; i++) {
    const v = F.evaluateFreeCurveSmooth(mono, i / 2000);
    if (v < prev - 1e-12) monoOk = false;
    if (v < 0 - 1e-12 || v > 3.5 + 1e-12) monoOk = false;
    prev = v;
  }
  check('smooth: monotone knots evaluate monotonically, bounded by the end values', monoOk);

  // No overshoot beyond each segment's endpoint values, also
  // on non-monotone data (peak / valley curves included).
  let overshootOk = true;
  for (const points of CURVES) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const lo = Math.min(a.v, b.v) - 1e-12;
      const hi = Math.max(a.v, b.v) + 1e-12;
      for (let k = 0; k <= 200; k++) {
        const v = F.evaluateFreeCurveSmooth(points, a.t + (b.t - a.t) * (k / 200));
        if (v < lo || v > hi) overshootOk = false;
      }
    }
  }
  check("smooth: samples stay within each segment's endpoint value range (no overshoot)", overshootOk);

  // C1 continuity at interior knots: one-sided finite
  // differences agree.
  const c1Curve = F.normalizeFreeCurvePoints([0, 0.5, 0.3, 3, 0.6, 0.5, 1, 2]);
  let c1Ok = true;
  const h = 1e-6;
  for (const p of c1Curve.slice(1, -1)) {
    const dLeft = (F.evaluateFreeCurveSmooth(c1Curve, p.t) - F.evaluateFreeCurveSmooth(c1Curve, p.t - h)) / h;
    const dRight = (F.evaluateFreeCurveSmooth(c1Curve, p.t + h) - F.evaluateFreeCurveSmooth(c1Curve, p.t)) / h;
    if (!near(dLeft, dRight, 1e-2)) c1Ok = false;
    // Plain continuity across the knot.
    if (!near(F.evaluateFreeCurveSmooth(c1Curve, p.t - 1e-7), F.evaluateFreeCurveSmooth(c1Curve, p.t + 1e-7), 1e-4)) c1Ok = false;
  }
  check('smooth: derivative is continuous at interior knots (C1)', c1Ok);

  // Identity and two-point reduction.
  const identity = F.normalizeFreeCurvePoints(F.FREE_CURVE_IDENTITY);
  let identityOk = true;
  for (const t of gridT) if (F.evaluateFreeCurveSmooth(identity, t) !== 1) identityOk = false;
  check('smooth: an all-ones curve evaluates to exactly 1 everywhere', identityOk);

  const twoPoint = F.normalizeFreeCurvePoints([0.1, 0.25, 0.9, 3.75]);
  let twoOk = true;
  for (const t of gridT) {
    if (!near(F.evaluateFreeCurveSmooth(twoPoint, t), legacyLinear(twoPoint, t), 1e-12)) twoOk = false;
  }
  check('smooth: a two-point curve reduces to the linear blend', twoOk);

  // The mode actually does something on a non-trivial curve.
  const peak = F.normalizeFreeCurvePoints([0, 0, 0.5, 1, 1, 1]);
  check('smooth: differs from linear inside a non-trivial segment',
    F.evaluateFreeCurveSmooth(peak, 0.25) !== legacyLinear(peak, 0.25)
    && near(F.evaluateFreeCurveSmooth(peak, 0.25), 0.625, 1e-12));
}

// ---- (c) authoring-form backward compatibility ------------------------
{
  check("interp: only the exact string 'smooth' selects smooth",
    F.normalizeFreeCurveInterp('smooth') === 'smooth'
    && F.normalizeFreeCurveInterp('linear') === 'linear'
    && F.normalizeFreeCurveInterp(undefined) === 'linear'
    && F.normalizeFreeCurveInterp(null) === 'linear'
    && F.normalizeFreeCurveInterp('SMOOTH') === 'linear'
    && F.normalizeFreeCurveInterp(0) === 'linear');

  const flat = [0, 0, 0.5, 1, 1, 1];
  const fromFlat = F.resolveFreeCurveAsset(flat);
  check('asset: a stored flat array resolves to the linear default with the normalised knots',
    fromFlat.interp === 'linear'
    && JSON.stringify(fromFlat.points) === JSON.stringify(F.normalizeFreeCurvePoints(flat)));

  let garbageOk = true;
  for (const bad of [undefined, null, 42, 'x', true, {}]) {
    const asset = F.resolveFreeCurveAsset(bad);
    if (asset.interp !== 'linear') garbageOk = false;
    if (JSON.stringify(asset.points) !== JSON.stringify(F.normalizeFreeCurvePoints(undefined))) garbageOk = false;
    if (!F.isFreeCurveAssetIdentity(asset)) garbageOk = false;
  }
  check('asset: garbage resolves to the identity asset, linear', garbageOk);

  let evalOk = true;
  for (const t of gridT) {
    if (F.evaluateFreeCurveAsset(fromFlat, t) !== legacyLinear(fromFlat.points, t)) evalOk = false;
  }
  check('asset: a flat-array asset evaluates exactly as the legacy formula', evalOk);

  const flatBack = F.flattenFreeCurveAsset(fromFlat);
  check('asset: a linear asset flattens back to the plain flat array',
    Array.isArray(flatBack)
    && JSON.stringify(flatBack) === JSON.stringify(F.flattenFreeCurvePoints(fromFlat.points)));

  const smoothAsset = F.resolveFreeCurveAsset({ points: flat, interp: 'smooth' });
  const stored = F.flattenFreeCurveAsset(smoothAsset);
  const roundTripped = F.resolveFreeCurveAsset(stored);
  let roundTripEvalOk = true;
  for (const t of gridT) {
    if (F.evaluateFreeCurveAsset(roundTripped, t) !== F.evaluateFreeCurve(smoothAsset.points, t, 'smooth')) roundTripEvalOk = false;
  }
  check('asset: a smooth asset round-trips through its object form (mode, knots, evaluation intact)',
    smoothAsset.interp === 'smooth'
    && !Array.isArray(stored) && stored.interp === 'smooth'
    && JSON.stringify(stored.points) === JSON.stringify(F.flattenFreeCurvePoints(smoothAsset.points))
    && roundTripped.interp === 'smooth'
    && JSON.stringify(roundTripped.points) === JSON.stringify(smoothAsset.points)
    && roundTripEvalOk);

  check("asset: an unrecognised mode string falls back to linear",
    F.resolveFreeCurveAsset({ points: flat, interp: 'bogus' }).interp === 'linear');
  check('asset: identity follows the knot values under both modes',
    F.isFreeCurveAssetIdentity({ points: F.normalizeFreeCurvePoints([0, 1, 1, 1]), interp: 'smooth' }) === true
    && F.isFreeCurveAssetIdentity(smoothAsset) === false);
}

console.log(`layer1-wp9-curve-interp: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
