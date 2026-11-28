#!/usr/bin/env node
// layer1-wp8-deform-stack.test.mjs — Layer 1 WP8 phase A: the
// deform operator stack (lib/gpgpuDeformStack.ts) and its bake
// connections (lib/gpgpuInitialData.ts emitOptions.deform,
// lib/gpgpuMorphTargets.ts options.deform).
//
// Until this phase, deformation lived in three dedicated
// places (Form's Disperse / Twist / Fractal Field, the OBJ mesh
// deform injection, the CSG extrusion twist), each closed in
// its own consumer. The stack is the general grammar: five
// operators (bend / twist / taper / noise / ffd) authored as a
// JSON list in the distribution layer's style, resolved toward
// identity, applied in list order as pure functions.
//
// Pins:
// (a) parse tolerance: unusable input resolves to the empty
//     stack; unknown operators and identity operators are
//     dropped; parameters fall back / clamp per operator; the
//     stack caps at DEFORM_MAX_OPS.
// (b) identity: the empty stack returns a point exactly; both
//     bakes with the stack absent / null / empty are
//     bit-identical to the legacy bakes.
// (c) operator math: each operator's formula on known points,
//     including the ffd Bernstein weights and the taper pinch
//     clamp.
// (d) composition: the stack applies in list order (stack ==
//     sequential single-operator applications; order matters).
// (e) legacy coincidences: a lone stack twist equals the Form
//     twist, stack noise equals the Form fractal field, and
//     the stack bend / twist reproduce objMeshDeform's GLSL
//     bend and static twist under the documented parameter
//     mappings — same input, same output.
// (f) bake application: with a stack, the initial-data bake's
//     positions are the stack applied to the legacy positions
//     while ages and velocities stay bit-identical (the stack
//     consumes no draws), and the morph bake's points are the
//     stack applied to the legacy points (jitter 0, world
//     scale 1).
//
// Run: node scripts/layer1-wp8-deform-stack.test.mjs

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
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const near3 = (p, q, eps = 1e-12) => near(p[0], q[0], eps) && near(p[1], q[1], eps) && near(p[2], q[2], eps);

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const D = await load('lib/gpgpuDeformStack.ts');
const F = await load('lib/formDeformation.ts');
const I = await load('lib/gpgpuInitialData.ts');
const M = await load('lib/gpgpuMorphTargets.ts');

const parse = D.parseDeformOps;
const apply = D.applyDeformOps;

// ---- (a) parse tolerance ----------------------------------------------
check('parse: empty / null / garbage resolve to []',
  parse('').length === 0 && parse(null).length === 0 && parse(undefined).length === 0 &&
  parse('not json').length === 0 && parse('{}').length === 0 && parse('[1, "x", null]').length === 0);
check('parse: unknown operator dropped', parse('[{"op":"warp","amount":1}]').length === 0);
check('parse: identity operators dropped (missing / zero amount)',
  parse('[{"op":"twist"},{"op":"bend","amount":0},{"op":"taper","amount":0},{"op":"noise","amount":0}]').length === 0);
check('parse: bad axis falls back to the operator default',
  parse('[{"op":"twist","amount":0.5,"axis":"w"}]')[0].axis === 'y' &&
  parse('[{"op":"bend","amount":0.5,"axis":"w"}]')[0].axis === 'x');
check('parse: bend dir equal to axis is moved to the next axis',
  parse('[{"op":"bend","amount":0.5,"axis":"x","dir":"x"}]')[0].dir === 'y');
check('parse: twist amount clamps to the Form range [-4, 4]',
  parse('[{"op":"twist","amount":99}]')[0].amount === 4 &&
  parse('[{"op":"twist","amount":-99}]')[0].amount === -4);
check('parse: noise frequency falls back / caps like the Form fractal',
  parse('[{"op":"noise","amount":1,"frequency":0}]')[0].frequency === 1.5 &&
  parse('[{"op":"noise","amount":1,"frequency":100}]')[0].frequency === 8);
check('parse: malformed centre falls back to the origin',
  near3(parse('[{"op":"twist","amount":0.5,"center":[1,"x",3]}]')[0].center, [0, 0, 0]));
check('parse: stack caps at DEFORM_MAX_OPS',
  parse(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ op: 'twist', amount: 0.1 + i * 0.1 })))).length === D.DEFORM_MAX_OPS);
check('parse: ffd with a wrong-length points list is dropped',
  parse('[{"op":"ffd","divisions":1,"points":[1,0,0]}]').length === 0);
check('parse: ffd with all-zero offsets is identity and dropped',
  parse(JSON.stringify([{ op: 'ffd', divisions: 1, points: new Array(24).fill(0) }])).length === 0);
check('resolveDeformOps matches parseDeformOps',
  JSON.stringify(D.resolveDeformOps('[{"op":"taper","amount":0.5}]')) ===
  JSON.stringify(parse('[{"op":"taper","amount":0.5}]')));

// ---- (b) identity -------------------------------------------------------
check('apply: empty stack returns the point exactly', (() => {
  const r = apply([], 1.25, -2.5, 3.75);
  return r[0] === 1.25 && r[1] === -2.5 && r[2] === 3.75;
})());
check('deformStackActive: null / empty false, non-empty true',
  !D.deformStackActive(null) && !D.deformStackActive([]) &&
  D.deformStackActive(parse('[{"op":"twist","amount":0.5}]')));

// ---- (c) operator math --------------------------------------------------
{
  // bend: y += amount * x^2 (axis x, dir y), centre at origin.
  const ops = parse('[{"op":"bend","amount":0.25,"axis":"x","dir":"y"}]');
  check('bend: parabolic displacement', near3(apply(ops, 2, 1, 3), [2, 2, 3]));
  // bend with a centre: t measured from the centre.
  const centred = parse('[{"op":"bend","amount":0.5,"axis":"x","dir":"y","center":[1,0,0]}]');
  check('bend: centre-relative', near3(apply(centred, 3, 1, 0), [3, 3, 0]));
}
{
  // twist around y by angle = amount * y.
  const ops = parse('[{"op":"twist","amount":0.5,"axis":"y"}]');
  const r = apply(ops, 1, 2, 0); // angle = 1 rad
  check('twist: rotation around the axis', near3(r, [Math.cos(1), 2, Math.sin(1)]));
  check('twist: the axial coordinate is preserved', apply(ops, 0.3, -1.5, 0.8)[1] === -1.5);
}
{
  // taper: factor 1 + amount * (y / range) on the perpendicular axes.
  const ops = parse('[{"op":"taper","amount":1,"axis":"y","range":2}]');
  check('taper: linear scale along the axis', near3(apply(ops, 1, 2, 1), [2, 2, 2]));
  const pinch = parse('[{"op":"taper","amount":-1,"axis":"y","range":1}]');
  check('taper: strong negative amount pinches to the axis (factor clamped at 0)',
    near3(apply(pinch, 1, 2, 1), [0, 2, 0]));
}
{
  // noise: bounded by amount * 0.5 per axis, deterministic.
  const ops = parse('[{"op":"noise","amount":1.2,"frequency":2,"evolution":0.3}]');
  const p = [0.4, -0.7, 0.9];
  const r1 = apply(ops, ...p);
  const r2 = apply(ops, ...p);
  check('noise: deterministic', near3(r1, r2, 0));
  check('noise: displacement bounded by amount * 0.5',
    Math.abs(r1[0] - p[0]) <= 0.6 && Math.abs(r1[1] - p[1]) <= 0.6 && Math.abs(r1[2] - p[2]) <= 0.6);
  check('noise: actually displaces', !near3(r1, p, 1e-9));
}
{
  // ffd: one corner offset, trilinear (divisions 1) weights.
  const points = new Array(24).fill(0);
  points[0] = 0.6; // control point (0,0,0), x offset
  const ops = parse(JSON.stringify([{ op: 'ffd', divisions: 1, min: [-1, -1, -1], max: [1, 1, 1], points }]));
  check('ffd: the corner itself takes the full offset', near3(apply(ops, -1, -1, -1), [-0.4, -1, -1]));
  check('ffd: the box centre takes 1/8 of the corner offset', near3(apply(ops, 0, 0, 0), [0.075, 0, 0]));
  check('ffd: outside the box the coordinates clamp (far face unaffected by corner 0)',
    near3(apply(ops, 2, 0, 0), [2, 0, 0]));
}

// ---- (d) composition ------------------------------------------------------
{
  const bend = parse('[{"op":"bend","amount":0.5,"axis":"x","dir":"y"}]');
  const twist = parse('[{"op":"twist","amount":0.9,"axis":"y"}]');
  const both = parse('[{"op":"bend","amount":0.5,"axis":"x","dir":"y"},{"op":"twist","amount":0.9,"axis":"y"}]');
  const reversed = parse('[{"op":"twist","amount":0.9,"axis":"y"},{"op":"bend","amount":0.5,"axis":"x","dir":"y"}]');
  const p = [1, 0.5, 0.25];
  const sequential = apply(twist, ...apply(bend, ...p));
  check('composition: stack == sequential single-operator applications', near3(apply(both, ...p), sequential));
  check('composition: list order matters', !near3(apply(both, ...p), apply(reversed, ...p), 1e-9));
}

// ---- (e) legacy coincidences ----------------------------------------------
{
  // Form twist (lone): stack twist == applyFormDeformation with
  // only the twist set, for both a y and a z axis.
  for (const axis of ['y', 'z']) {
    const opts = { ...F.DEFAULT_FORM_DEFORMATION, twistAmount: 0.7, twistAxis: axis };
    const ops = parse(JSON.stringify([{ op: 'twist', amount: 0.7, axis }]));
    let ok = true;
    for (const p of [[0.3, 1.2, -0.6], [1, 0, 0.5], [-0.8, -0.4, 2]]) {
      const f = F.applyFormDeformation({ x: p[0], y: p[1], z: p[2] }, 7, opts);
      if (!near3(apply(ops, ...p), [f.x, f.y, f.z])) ok = false;
    }
    check(`legacy: stack twist == Form twist (axis ${axis})`, ok);
  }
  // Form fractal field (lone): stack noise == applyFormDeformation
  // with only the fractal set.
  const opts = { ...F.DEFAULT_FORM_DEFORMATION, fractalAmount: 0.8, fractalFrequency: 2.0, fractalEvolution: 0.3 };
  const ops = parse('[{"op":"noise","amount":0.8,"frequency":2,"evolution":0.3}]');
  let ok = true;
  for (const p of [[0.3, 1.2, -0.6], [0, 0, 0], [-1.5, 0.25, 0.75]]) {
    const f = F.applyFormDeformation({ x: p[0], y: p[1], z: p[2] }, 3, opts);
    if (!near3(apply(ops, ...p), [f.x, f.y, f.z])) ok = false;
  }
  check('legacy: stack noise == Form fractal field', ok);
}
{
  // objMeshDeform bend (GLSL): transformed.y += 0.3 * amount *
  // freq * x * x. Stack mapping: amount' = 0.3 * amount * freq,
  // axis x, dir y.
  const amount = 0.8;
  const freq = 1.5;
  const ops = parse(JSON.stringify([{ op: 'bend', amount: 0.3 * amount * freq, axis: 'x', dir: 'y' }]));
  let ok = true;
  for (const p of [[0.5, 0.2, -0.3], [-1, 0.9, 0.4], [0, 0, 0]]) {
    const expected = [p[0], p[1] + 0.3 * amount * freq * p[0] * p[0], p[2]];
    if (!near3(apply(ops, ...p), expected)) ok = false;
  }
  check('legacy: stack bend == objMeshDeform bend under the documented mapping', ok);
}
{
  // objMeshDeform twist (GLSL), static case (time term 0):
  // angle = amount * PI * (y * freq); xz rotated by mat2(c, -s,
  // s, c). Stack mapping: amount' = amount * PI * freq, axis y.
  const amount = 0.4;
  const freq = 1.0;
  const ops = parse(JSON.stringify([{ op: 'twist', amount: amount * Math.PI * freq, axis: 'y' }]));
  let ok = true;
  for (const p of [[0.5, 0.2, -0.3], [-1, 0.9, 0.4], [0.25, -2, 0.75]]) {
    const a = amount * Math.PI * (p[1] * freq);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const expected = [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]];
    if (!near3(apply(ops, ...p), expected)) ok = false;
  }
  check('legacy: stack twist == objMeshDeform static twist under the documented mapping', ok);
}

// ---- (f) bake application ---------------------------------------------------
{
  const texSize = 8;
  const legacy = I.buildGpgpuInitialData(texSize, 2.5, 'sphere', 999, 8, null, null);
  const absent = I.buildGpgpuInitialData(texSize, 2.5, 'sphere', 999, 8, null, {});
  const empty = I.buildGpgpuInitialData(texSize, 2.5, 'sphere', 999, 8, null, { deform: [] });
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  check('bake (initial): deform absent / empty is bit-identical',
    same(legacy.posData, absent.posData) && same(legacy.posData, empty.posData) &&
    same(legacy.velData, absent.velData) && same(legacy.velData, empty.velData));

  const ops = parse('[{"op":"twist","amount":0.6,"axis":"y"},{"op":"taper","amount":0.5,"axis":"y","range":3}]');
  const deformed = I.buildGpgpuInitialData(texSize, 2.5, 'sphere', 999, 8, null, { deform: ops });
  let positionsOk = true;
  let streamsOk = true;
  let moved = false;
  for (let i = 0; i < texSize * texSize; i++) {
    const o = i * 4;
    const expected = apply(ops, legacy.posData[o], legacy.posData[o + 1], legacy.posData[o + 2]);
    if (!near3([deformed.posData[o], deformed.posData[o + 1], deformed.posData[o + 2]], expected, 1e-6)) positionsOk = false;
    if (deformed.posData[o] !== legacy.posData[o] || deformed.posData[o + 2] !== legacy.posData[o + 2]) moved = true;
    if (deformed.posData[o + 3] !== legacy.posData[o + 3]) streamsOk = false;
  }
  check('bake (initial): positions are the stack applied to the legacy positions', positionsOk);
  check('bake (initial): the stack actually moves placements', moved);
  check('bake (initial): ages and velocities stay bit-identical (no draws consumed)',
    streamsOk && same(legacy.velData, deformed.velData));
}
{
  const base = { texSize: 8, target: 'trefoil', worldScale: 1, jitter: 0, seed: 12345 };
  const legacy = M.buildGpgpuMorphTargetData(base);
  const empty = M.buildGpgpuMorphTargetData({ ...base, deform: [] });
  const nulled = M.buildGpgpuMorphTargetData({ ...base, deform: null });
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  check('bake (morph): deform empty / null is bit-identical',
    same(legacy, empty) && same(legacy, nulled));

  const ops = parse('[{"op":"bend","amount":0.4,"axis":"x","dir":"y"},{"op":"noise","amount":0.5,"frequency":1.5}]');
  const deformed = M.buildGpgpuMorphTargetData({ ...base, deform: ops });
  let positionsOk = true;
  let alphaOk = true;
  let moved = false;
  for (let i = 0; i < 8 * 8; i++) {
    const o = i * 4;
    const expected = apply(ops, legacy[o], legacy[o + 1], legacy[o + 2]);
    if (!near3([deformed[o], deformed[o + 1], deformed[o + 2]], expected, 1e-6)) positionsOk = false;
    if (deformed[o] !== legacy[o] || deformed[o + 1] !== legacy[o + 1]) moved = true;
    if (deformed[o + 3] !== legacy[o + 3]) alphaOk = false;
  }
  check('bake (morph): points are the stack applied to the legacy points', positionsOk);
  check('bake (morph): the stack actually moves points', moved);
  check('bake (morph): the alpha channel is untouched', alphaOk);
}

console.log(`layer1-wp8-deform-stack: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
