#!/usr/bin/env node
// layer1-wp10-user-params.test.mjs — Layer 1 WP10 phase A:
// declared user parameters become NAMED VALUES for the drive
// system. A new modulation source kind { kind: 'uparam', name }
// reads a declared public parameter (lib/userParameters.ts) by
// its declared name; the value is the aliased key's CURRENT value
// in the base config, normalised by the declaration target's
// range through lib/userParameters.ts' resolution functions.
//
// Pins:
// (1) resolution by declared name: numeric values map over the
//     target's catalog range (min -> 0, mid -> 0.5, max -> 1,
//     out-of-range clamps); boolean false/true -> 0/1; enum
//     first/last -> 0/1. Lookup by label and by id both work
//     (findUserParameterByName discipline).
// (2) neutral degradation: undeclared names, missing environment
//     and wrong-shaped config values all sample neutral
//     (value01 0.5 at center 0.5) and never throw — the route is
//     inert, the data column's discipline.
// (3) environment discipline: labels claim names before ids,
//     the first declaration wins a duplicate label, and a name
//     whose winning declaration does not resolve is absent.
// (4) end to end: applyModulation moves a route target by the
//     declared parameter's value (base-config values only), an
//     expression wrapping a user-parameter source receives the
//     same value as x, and a centred / undeclared source leaves
//     the target untouched.
// (5) sanitize: the new kind round-trips through the setup
//     serialize/parse bridge (including nested inside an
//     expression's input); a malformed name degrades to the
//     inert empty name and the route survives.
// (6) existing source kinds are unchanged: LFO evaluation, the
//     internal-noise determinism and the data column's neutral
//     sample without a table all behave as before.
//
// Run: node scripts/layer1-wp10-user-params.test.mjs

import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp10upa-bundle-${process.pid}.mjs`);
let failures = 0;
let checks = 0;
const check = (name, cond, detail = '') => {
  checks += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        applyModulation, createDefaultModulationSetup, describeModulationSource,
        evaluateSource, parseModulationSetupConfigValue, serializeModulationSetup,
      } from './lib/modulation.ts';
      export {
        buildUserParameterValueEnv, resolveNamedUserParameterValue01,
        resolveUserParameterTarget, resolveUserParameterValue01,
        sanitizeUserParameters, setUserParameters, USER_PARAMETER_TARGETS,
      } from './lib/userParameters.ts';
      export { PARAMETER_CATALOG } from './lib/parameterCatalog.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  applyModulation, createDefaultModulationSetup, describeModulationSource,
  evaluateSource, parseModulationSetupConfigValue, serializeModulationSetup,
  buildUserParameterValueEnv, resolveNamedUserParameterValue01,
  resolveUserParameterTarget, resolveUserParameterValue01,
  sanitizeUserParameters, setUserParameters, USER_PARAMETER_TARGETS,
  PARAMETER_CATALOG, DEFAULT_CONFIG,
} = lib;

const setup = createDefaultModulationSetup();

// ---- fixtures -----------------------------------------------------------
const numericKey = 'layer2FlowSpeed';
const numericTarget = resolveUserParameterTarget(numericKey);
check('fixture: numeric key is declarable with a real range',
  numericTarget !== null && numericTarget.kind === 'number' && numericTarget.max > numericTarget.min);
const { min: nMin, max: nMax } = numericTarget;
const nMid = (nMin + nMax) / 2;
const numericDecl = sanitizeUserParameters([
  { id: 'up-num', label: 'Flow 公開', group: '', key: numericKey, defaultValue: nMid },
])[0];
check('fixture: numeric declaration sanitizes', numericDecl && numericDecl.label === 'Flow 公開');

const boolTarget = USER_PARAMETER_TARGETS.find((t) => t.kind === 'boolean');
const enumTarget = USER_PARAMETER_TARGETS.find((t) => t.kind === 'enum' && (t.values?.length ?? 0) >= 2);
check('fixture: boolean and enum declarable targets exist', !!boolTarget && !!enumTarget);

// ---- (1) resolution by declared name ------------------------------------
{
  const at = (v) => resolveUserParameterValue01(numericDecl, { ...DEFAULT_CONFIG, [numericKey]: v });
  check('1: numeric min resolves to 0', at(nMin) === 0);
  check('1: numeric mid resolves to 0.5', near(at(nMid), 0.5));
  check('1: numeric max resolves to 1', at(nMax) === 1);
  check('1: numeric above max clamps to 1', at(nMax + 1000) === 1);
  check('1: numeric below min clamps to 0', at(nMin - 1000) === 0);

  const byLabel = resolveNamedUserParameterValue01([numericDecl], { ...DEFAULT_CONFIG, [numericKey]: nMax }, 'Flow 公開');
  const byId = resolveNamedUserParameterValue01([numericDecl], { ...DEFAULT_CONFIG, [numericKey]: nMax }, 'up-num');
  check('1: name lookup works by label and by id', byLabel === 1 && byId === 1);

  const boolDecl = sanitizeUserParameters([
    { id: 'up-bool', label: 'Bool', group: '', key: boolTarget.key, defaultValue: false },
  ])[0];
  check('1: boolean false -> 0, true -> 1',
    resolveUserParameterValue01(boolDecl, { ...DEFAULT_CONFIG, [boolTarget.key]: false }) === 0
    && resolveUserParameterValue01(boolDecl, { ...DEFAULT_CONFIG, [boolTarget.key]: true }) === 1);

  const enumDecl = sanitizeUserParameters([
    { id: 'up-enum', label: 'Enum', group: '', key: enumTarget.key, defaultValue: enumTarget.values[0] },
  ])[0];
  const lastValue = enumTarget.values[enumTarget.values.length - 1];
  check('1: enum first -> 0, last -> 1',
    resolveUserParameterValue01(enumDecl, { ...DEFAULT_CONFIG, [enumTarget.key]: enumTarget.values[0] }) === 0
    && resolveUserParameterValue01(enumDecl, { ...DEFAULT_CONFIG, [enumTarget.key]: lastValue }) === 1);
}

// ---- (2) neutral degradation ---------------------------------------------
{
  check('2: undeclared name resolves to null',
    resolveNamedUserParameterValue01([numericDecl], DEFAULT_CONFIG, '存在しない名前') === null);
  check('2: wrong-shaped config value resolves to null (no throw)',
    resolveUserParameterValue01(numericDecl, { ...DEFAULT_CONFIG, [numericKey]: 'fast' }) === null);

  const src = { kind: 'uparam', name: 'Flow 公開' };
  const noEnv = evaluateSource(src, setup, 0, undefined, 'r-x');
  check('2: evaluateSource without environment samples neutral',
    noEnv.value01 === 0.5 && noEnv.center === 0.5);
  const unknown = evaluateSource({ kind: 'uparam', name: '未宣言' }, setup, 0, undefined, 'r-x', undefined, { 'Flow 公開': 1 });
  check('2: unknown name in a present environment samples neutral',
    unknown.value01 === 0.5 && unknown.center === 0.5);
  const known = evaluateSource(src, setup, 0, undefined, 'r-x', undefined, { 'Flow 公開': 0.25 });
  check('2: known name reads the environment value',
    known.value01 === 0.25 && known.center === 0.5);
}

// ---- (3) environment discipline -------------------------------------------
{
  const dupA = sanitizeUserParameters([
    { id: 'up-a', label: 'Dup', group: '', key: numericKey, defaultValue: nMin },
  ])[0];
  const dupB = sanitizeUserParameters([
    { id: 'up-b', label: 'Dup', group: '', key: numericKey, defaultValue: nMax },
  ])[0];
  const env = buildUserParameterValueEnv([dupA, dupB], { ...DEFAULT_CONFIG, [numericKey]: nMid });
  check('3: duplicate label — the first declaration wins', near(env.Dup, 0.5) && env['up-a'] === env.Dup);
  check('3: the losing declaration is still reachable by its id', near(env['up-b'], 0.5));

  const brokenEnv = buildUserParameterValueEnv([numericDecl], { ...DEFAULT_CONFIG, [numericKey]: 'fast' });
  check('3: unresolvable winning declaration leaves the name absent',
    !('Flow 公開' in brokenEnv) && !('up-num' in brokenEnv));
}

// ---- (4) end to end through applyModulation --------------------------------
{
  setUserParameters([numericDecl]);
  const targetKey = 'layer2BaseSize';
  const entry = PARAMETER_CATALOG.find((c) => c.key === targetKey);
  const route = { id: 'r-up', source: { kind: 'uparam', name: 'Flow 公開' }, target: targetKey, depth: 0.4 };
  const driven = { ...createDefaultModulationSetup(), enabled: true, routes: [route] };

  const atMax = applyModulation({ ...DEFAULT_CONFIG, [numericKey]: nMax }, driven, 0, undefined);
  const expected = Math.min(entry.max, Math.max(entry.min,
    DEFAULT_CONFIG[targetKey] + 0.5 * 0.4 * (entry.max - entry.min)));
  check('4: declared value at max drives the target up by (1-center)*depth*range',
    near(atMax[targetKey], expected, entry.step), `${atMax[targetKey]} vs ${expected}`);

  const atMid = applyModulation({ ...DEFAULT_CONFIG, [numericKey]: nMid }, driven, 0, undefined);
  check('4: declared value at centre leaves the target untouched',
    near(atMid[targetKey], DEFAULT_CONFIG[targetKey], entry.step));

  const exprRoute = {
    id: 'r-up-expr',
    source: { kind: 'expr', text: 'x', input: { kind: 'uparam', name: 'Flow 公開' } },
    target: targetKey, depth: 0.4,
  };
  const viaExpr = applyModulation(
    { ...DEFAULT_CONFIG, [numericKey]: nMax },
    { ...createDefaultModulationSetup(), enabled: true, routes: [exprRoute] }, 0, undefined);
  check('4: an expression wrapping the source receives the same value as x',
    near(viaExpr[targetKey], atMax[targetKey], entry.step));

  const ghostRoute = { id: 'r-ghost', source: { kind: 'uparam', name: '未宣言パラメータ' }, target: targetKey, depth: 0.4 };
  const ghost = applyModulation(
    { ...DEFAULT_CONFIG, [numericKey]: nMax },
    { ...createDefaultModulationSetup(), enabled: true, routes: [ghostRoute] }, 0, undefined);
  check('4: an undeclared name leaves the target untouched (inert route)',
    near(ghost[targetKey], DEFAULT_CONFIG[targetKey], entry.step));
  setUserParameters([]);
}

// ---- (5) sanitize round-trip ------------------------------------------------
{
  const original = {
    ...createDefaultModulationSetup(),
    enabled: true,
    routes: [
      { id: 's1', source: { kind: 'uparam', name: 'Flow 公開' }, target: 'layer2BaseSize', depth: 0.3 },
      { id: 's2', source: { kind: 'expr', text: 'x*x', input: { kind: 'uparam', name: 'Flow 公開' } }, target: 'layer2BaseSize', depth: 0.3 },
      { id: 's3', source: { kind: 'uparam', name: 42 }, target: 'layer2BaseSize', depth: 0.3 },
    ],
  };
  const parsed = parseModulationSetupConfigValue(serializeModulationSetup(original));
  check('5: uparam route round-trips through the config bridge',
    parsed.routes.length === 3
    && parsed.routes[0].source.kind === 'uparam' && parsed.routes[0].source.name === 'Flow 公開');
  check('5: uparam nested inside an expression input round-trips',
    parsed.routes[1].source.kind === 'expr' && parsed.routes[1].source.input.kind === 'uparam');
  check('5: malformed name degrades to the inert empty name, route survives',
    parsed.routes[2].source.kind === 'uparam' && parsed.routes[2].source.name === '');
  const inert = evaluateSource(parsed.routes[2].source, parsed, 0, undefined, 's3', undefined, {});
  check('5: the degraded source samples neutral', inert.value01 === 0.5 && inert.center === 0.5);
}

// ---- (6) existing source kinds unchanged -------------------------------------
{
  const lfo = evaluateSource({ kind: 'lfo', index: 0 }, setup, 0, undefined, 'r-lfo');
  check('6: LFO sine at t=0 still rests at 0.5', lfo.value01 === 0.5 && lfo.center === 0.5);
  const vn1 = evaluateSource({ kind: 'vnoise', seed: 7, rate: 0.3, octaves: 3 }, setup, 1.25, undefined, 'r-vn');
  const vn2 = evaluateSource({ kind: 'vnoise', seed: 7, rate: 0.3, octaves: 3 }, setup, 1.25, undefined, 'r-vn');
  check('6: internal noise stays deterministic', vn1.value01 === vn2.value01);
  const data = evaluateSource({ kind: 'data', column: 'col1', rate: 2 }, setup, 3, undefined, 'r-data');
  check('6: data column without a table still samples neutral 0.5', data.value01 === 0.5);
  check('6: descriptions keep their existing forms',
    describeModulationSource({ kind: 'lfo', index: 0 }) === 'LFO 1'
    && describeModulationSource({ kind: 'uparam', name: 'Flow 公開' }) === 'ユーザーパラメータ Flow 公開');
}

console.log(`\nlayer1-wp10-user-params: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
