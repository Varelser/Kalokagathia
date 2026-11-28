#!/usr/bin/env node
// layer1-wp9-curve-remap.test.mjs — Layer 1 WP9 phase B: the
// general curve remap stage (lib/gpgpuCurveRemap.ts), the
// Graph Mapper receptacle.
//
// Until this phase the free curve asset had only fixed
// consumers (age curves' free mode, the emission curve, the
// spawn envelope) and the modulation engine shaped signals
// with a linear depth only. The remap stage is the general
// form: input value → free curve → output range → parameter,
// resolved by pure functions over pure-data specs.
//
// Pins:
// (a) parse tolerance: unusable input resolves to []; unknown
//     input kinds / compose modes and id-less / target-less
//     entries are dropped; duplicate ids keep the first;
//     numeric fields fall back per-field; the list caps at
//     CURVE_REMAP_MAX_SPECS; a JSON string parses like the
//     array it carries.
// (b) input phase: signal / age clamp to [0, 1]; time wraps
//     by its period (negative time wraps forward, a
//     non-positive period holds phase 0); value / param
//     normalise by the input range and clamp, a degenerate
//     range reads phase 0; non-finite input reads 0.
// (c) output mapping: the curve value, normalised by the
//     asset maximum, maps onto the output range — extremes
//     land exactly on outputMin / outputMax, a reversed
//     output range inverts, and the range [0, 4] returns the
//     curve value bit-exactly.
// (d) composition: replace / add / multiply arithmetic; an
//     identity curve under multiply at range [0, 4] and a
//     zero curve under add at outputMin 0 both return the
//     base bit-exactly for every input.
// (e) fixed-consumer coincidences: a 5-point age curve equals
//     the remap of the same knots as free points; the
//     emission curve equals the remap bit-exactly; the spawn
//     envelope inside its window equals the remap with input
//     range [start, stop] (window gating itself stays with
//     the envelope — the remap has no window concept).
// (f) the resolution point: an empty list or a fully skipped
//     list returns the config object itself; a missing input
//     or a non-number target skips its spec; specs apply in
//     list order onto the same target; the input config is
//     never mutated.
//
// Run: node scripts/layer1-wp9-curve-remap.test.mjs

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

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const R = await load('lib/gpgpuCurveRemap.ts');
const FC = await load('lib/freeCurve.ts');
const AC = await load('lib/ageCurve.ts');
const SA = await load('lib/gpgpuSpawnAllocator.ts');

const parse = R.parseCurveRemapSpecs;
const resolve = R.resolveCurveRemap;

// A plain valid spec factory (signal input, identity curve,
// output range [0, 4], replace onto 'gpgpuPointSize').
const spec = (overrides = {}) => ({
  id: 'r1',
  input: { kind: 'signal' },
  inputMin: 0,
  inputMax: 1,
  curve: [0, 1, 1, 1],
  outputMin: 0,
  outputMax: 4,
  target: 'gpgpuPointSize',
  mode: 'replace',
  ...overrides,
});

// ---- (a) parse tolerance ----------------------------------------------
check('parse: empty / null / garbage resolve to []',
  parse('').length === 0 && parse(null).length === 0 && parse(undefined).length === 0 &&
  parse('not json').length === 0 && parse('{}').length === 0 && parse('[1, "x", null]').length === 0 &&
  parse(42).length === 0);
check('parse: a valid spec survives, array and JSON string alike',
  parse([spec()]).length === 1 && parse(JSON.stringify([spec()])).length === 1);
check('parse: unknown input kind / compose mode dropped',
  parse([spec({ input: { kind: 'warp' } })]).length === 0 &&
  parse([spec({ mode: 'clamp' })]).length === 0);
check('parse: missing id / target dropped',
  parse([spec({ id: '' })]).length === 0 && parse([spec({ id: '  ' })]).length === 0 &&
  parse([spec({ target: '' })]).length === 0);
check('parse: param input without a key dropped, with a key kept',
  parse([spec({ input: { kind: 'param' } })]).length === 0 &&
  parse([spec({ input: { kind: 'param', key: 'gpgpuGravity' } })]).length === 1);
check('parse: duplicate ids keep the first occurrence',
  (() => {
    const list = parse([spec({ outputMax: 4 }), spec({ outputMax: 9 })]);
    return list.length === 1 && list[0].outputMax === 4;
  })());
check('parse: numeric fields fall back per-field',
  (() => {
    const s = parse([spec({ inputMin: 'x', inputMax: NaN, outputMin: undefined, outputMax: Infinity })])[0];
    return s.inputMin === 0 && s.inputMax === 1 && s.outputMin === 0 && s.outputMax === FC.FREE_CURVE_VALUE_MAX;
  })());
check('parse: a malformed curve degrades to the identity asset',
  (() => {
    const s = parse([spec({ curve: 'junk' })])[0];
    return JSON.stringify(s.curve) === JSON.stringify([0, 1, 1, 1]) && resolve(s).identity;
  })());
check('parse: the list caps at CURVE_REMAP_MAX_SPECS',
  parse(Array.from({ length: 20 }, (_, i) => spec({ id: `r${i}` }))).length === R.CURVE_REMAP_MAX_SPECS);
check('parse: time period is clamped to >= 0',
  parse([spec({ input: { kind: 'time', period: -3 } })])[0].input.period === 0);
check('specsActive: empty false, non-empty true',
  !R.curveRemapSpecsActive([]) && R.curveRemapSpecsActive(parse([spec()])));

// ---- (b) input phase ----------------------------------------------------
{
  const signal = resolve(spec());
  check('phase: signal clamps to [0, 1]',
    R.curveRemapPhase(signal, -0.5) === 0 && R.curveRemapPhase(signal, 0.25) === 0.25 &&
    R.curveRemapPhase(signal, 2) === 1);
  check('phase: non-finite input reads 0',
    R.curveRemapPhase(signal, NaN) === 0 && R.curveRemapPhase(signal, Infinity) === 0);

  const timed = resolve(spec({ input: { kind: 'time', period: 4 } }));
  check('phase: time wraps by its period',
    R.curveRemapPhase(timed, 0) === 0 && R.curveRemapPhase(timed, 1) === 0.25 &&
    R.curveRemapPhase(timed, 5) === 0.25 && R.curveRemapPhase(timed, 8) === 0 &&
    R.curveRemapPhase(timed, -1) === 0.75);
  const frozen = resolve(spec({ input: { kind: 'time', period: 0 } }));
  check('phase: a non-positive period holds phase 0',
    R.curveRemapPhase(frozen, 3) === 0 && R.curveRemapPhase(frozen, -3) === 0);

  const valued = resolve(spec({ input: { kind: 'value' }, inputMin: 10, inputMax: 20 }));
  check('phase: value normalises by the input range and clamps',
    R.curveRemapPhase(valued, 10) === 0 && R.curveRemapPhase(valued, 15) === 0.5 &&
    R.curveRemapPhase(valued, 20) === 1 && R.curveRemapPhase(valued, 5) === 0 &&
    R.curveRemapPhase(valued, 25) === 1);
  const degenerate = resolve(spec({ input: { kind: 'value' }, inputMin: 7, inputMax: 7 }));
  check('phase: a degenerate input range reads phase 0',
    R.curveRemapPhase(degenerate, 7) === 0 && R.curveRemapPhase(degenerate, 9) === 0);
  const param = resolve(spec({ input: { kind: 'param', key: 'gpgpuGravity' }, inputMin: -10, inputMax: 10 }));
  check('phase: param normalises like value',
    R.curveRemapPhase(param, 0) === 0.5 && R.curveRemapPhase(param, -10) === 0);
}

// ---- (c) output mapping ---------------------------------------------------
{
  // Curve pinned at the asset maximum / minimum everywhere.
  const atMax = resolve(spec({ curve: [0, 4, 1, 4], outputMin: 2, outputMax: 6 }));
  const atMin = resolve(spec({ curve: [0, 0, 1, 0], outputMin: 2, outputMax: 6 }));
  check('output: curve extremes land exactly on the output range ends',
    R.evaluateCurveRemap(atMax, 0.3) === 6 && R.evaluateCurveRemap(atMin, 0.3) === 2);
  const inverted = resolve(spec({ curve: [0, 4, 1, 4], outputMin: 6, outputMax: 2 }));
  check('output: a reversed output range inverts',
    R.evaluateCurveRemap(inverted, 0.3) === 2);
  const half = resolve(spec({ curve: [0, 2, 1, 2], outputMin: 10, outputMax: 20 }));
  check('output: a mid curve value maps to the range middle',
    R.evaluateCurveRemap(half, 0.7) === 15);
}

// ---- (d) composition ------------------------------------------------------
{
  const curve = [0, 0, 0.5, 4, 1, 0]; // peaks at phase 0.5 with value 4
  const rep = resolve(spec({ curve, mode: 'replace' }));
  const add = resolve(spec({ curve, mode: 'add' }));
  const mul = resolve(spec({ curve, mode: 'multiply' }));
  check('compose: replace writes the output',
    R.applyCurveRemapValue(rep, 0.5, 99) === 4 && R.applyCurveRemapValue(rep, 0, 99) === 0);
  check('compose: add adds the output to the base',
    R.applyCurveRemapValue(add, 0.5, 3) === 7 && R.applyCurveRemapValue(add, 0, 3) === 3);
  check('compose: multiply multiplies the base by the output',
    R.applyCurveRemapValue(mul, 0.5, 3) === 12 && R.applyCurveRemapValue(mul, 0, 3) === 0);

  const identityMul = resolve(spec({ mode: 'multiply' })); // identity curve, range [0, 4]
  check('compose: identity curve under multiply is inert bit-exactly',
    [0, 0.2, 0.5, 0.9, 1].every((x) => R.applyCurveRemapValue(identityMul, x, 3.25) === 3.25));
  const zeroAdd = resolve(spec({ curve: [0, 0, 1, 0], mode: 'add' })); // outputMin 0
  check('compose: zero curve under add at outputMin 0 is inert',
    [0, 0.4, 1].every((x) => R.applyCurveRemapValue(zeroAdd, x, -2.5) === -2.5));
}

// ---- (e) fixed-consumer coincidences --------------------------------------
{
  // Age curves: the same knots as free points must reproduce
  // the fixed 5-point evaluation (the same piecewise-linear
  // function over the same knots; exact at the knots).
  const ageSets = [
    [1, 1, 1, 1, 1],
    [1, 0.5, 2, 0.25, 1.5],
    [0, 4, 0, 4, 0],
    [2.5, 2.5, 0.75, 3.25, 1],
  ];
  let ageOk = true;
  let ageKnotsExact = true;
  for (const values of ageSets) {
    const flat = [];
    values.forEach((v, i) => flat.push(i / 4, v));
    const remap = resolve(spec({ input: { kind: 'age' }, curve: flat }));
    const agePoints = AC.normalizeAgeCurvePoints(values);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      if (!near(R.evaluateCurveRemap(remap, t), AC.evaluateAgeCurve(agePoints, t))) ageOk = false;
    }
    values.forEach((v, i) => {
      if (R.evaluateCurveRemap(remap, i / 4) !== v) ageKnotsExact = false;
    });
    // The age input clamps outside [0, 1] like evaluateAgeCurve.
    if (!near(R.evaluateCurveRemap(remap, -1), AC.evaluateAgeCurve(agePoints, -1))) ageOk = false;
    if (!near(R.evaluateCurveRemap(remap, 2), AC.evaluateAgeCurve(agePoints, 2))) ageOk = false;
  }
  check('coincidence: age curve == remap of the same knots as free points', ageOk);
  check('coincidence: age knots reproduce bit-exactly', ageKnotsExact);

  // Emission curve: the remap at output range [0, 4] IS
  // evaluateFreeCurve over the shared asset, bit-exactly.
  const asset = [0, 0, 0.35, 1, 0.45, 0, 0.75, 0, 0.85, 1, 1, 1];
  const emission = resolve(spec({ curve: asset }));
  const assetPoints = FC.normalizeFreeCurvePoints(asset);
  let emissionOk = true;
  for (let i = 0; i <= 40; i++) {
    const p = i / 40;
    if (R.evaluateCurveRemap(emission, p) !== FC.evaluateFreeCurve(assetPoints, p)) emissionOk = false;
  }
  check('coincidence: emission curve == remap at range [0, 4], bit-exact', emissionOk);

  // Spawn envelope: inside the window the envelope's value is
  // the curve at the window phase — the remap with input
  // range [start, stop]. (At/after stop the envelope gates to
  // 0; gating stays the envelope's own concern.)
  const envConfig = {
    gpgpuSpawnEnvelopeEnabled: true,
    gpgpuSpawnEnvelopeStart: 2,
    gpgpuSpawnEnvelopeStop: 10,
    gpgpuSpawnEnvelopeCurve: [0, 0, 0.5, 1, 1, 1],
  };
  const env = SA.resolveSpawnEnvelope(envConfig);
  const envRemap = resolve(spec({
    input: { kind: 'value' }, inputMin: 2, inputMax: 10,
    curve: envConfig.gpgpuSpawnEnvelopeCurve,
  }));
  let envOk = true;
  for (let i = 0; i < 32; i++) {
    const time = 2 + (i / 32) * 8; // [start, stop)
    if (SA.spawnEnvelopeValueAt(time, env) !== R.evaluateCurveRemap(envRemap, time)) envOk = false;
  }
  check('coincidence: spawn envelope inside its window == remap over [start, stop]', envOk);
}

// ---- (f) the resolution point ----------------------------------------------
{
  const config = { gpgpuPointSize: 2, gpgpuGravity: -5, label: 'x' };
  check('apply: an empty spec list returns the config itself',
    R.applyCurveRemaps(config, [], { r1: 0.5 }) === config);
  check('apply: a missing input skips the spec (same object back)',
    R.applyCurveRemaps(config, parse([spec()]), {}) === config);
  check('apply: a non-number target is skipped (same object back)',
    R.applyCurveRemaps(config, parse([spec({ target: 'label' })]), { r1: 0.5 }) === config &&
    R.applyCurveRemaps(config, parse([spec({ target: 'absent' })]), { r1: 0.5 }) === config);

  const doubled = parse([spec({ curve: [0, 2, 1, 2], mode: 'multiply' })]); // output 2 everywhere
  const applied = R.applyCurveRemaps(config, doubled, { r1: 0.3 });
  check('apply: a supplied spec composes onto its target only',
    applied !== config && applied.gpgpuPointSize === 4 && applied.gpgpuGravity === -5);
  check('apply: the input config is never mutated',
    config.gpgpuPointSize === 2);

  const ordered = parse([
    spec({ id: 'a', curve: [0, 2, 1, 2], mode: 'multiply' }), // ×2
    spec({ id: 'b', curve: [0, 1, 1, 1], mode: 'add', outputMin: 3, outputMax: 3 }), // +3
  ]);
  const sequenced = R.applyCurveRemaps(config, ordered, { a: 0.1, b: 0.9 });
  check('apply: specs compose in list order onto the same target',
    sequenced.gpgpuPointSize === 2 * 2 + 3);
}

console.log(`layer1-wp9-curve-remap: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
