// Layer 1 WP5, phase A — field foundation: falloff shapes and
// group references for field instances / layers (lib only).
//
// The placed-field grammar (stage 2 B1) localised every field
// instance with ONE falloff curve — the wind volume's
// (1-(d/R)^2)^2 — and had no way to name the group of
// particles a field applies to. This phase adds the lib
// foundations for both:
//   1 falloff shapes: 'smooth' (the legacy curve, delegated to
//     windVolumeFalloff so its values are bit-identical),
//     'linear' and 'smoothstep', with unknown authored values
//     resolving to the default shape;
//   2 the instance `falloff` field: parsed tolerantly, kept
//     through a parse -> serialize -> parse round trip, absent
//     on pre-WP5 data (backward compatibility);
//   3 the instance / layer `group` field: a group ref (the
//     gpgpuGroupRef id convention) resolved through
//     resolveFieldGroupGate — the resolveGroupGate form
//     (predicate / baked) plus 'none' and an 'unresolved'
//     outcome that surfaces reason 'group-not-found' while
//     treating the field as ungated.
// No keys are added by this phase and no shader string changes
// (the GPU splice is WP5 phase D).
//
// Cases:
//  1 shape resolution + default-shape exactness against
//    windVolumeFalloff over a distance / radius grid
//  2 representative values + monotonicity of the new shapes
//  3 instance falloff field: parse, twin values, force law
//  4 serialise round trips (new fields kept, old data clean)
//  5 group gates: resolution outcomes + membership values
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp5a-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const near3 = (a, b, eps = 1e-9) => near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);

await build({
  stdin: {
    contents: `
      export { windVolumeFalloff, resolveFalloffShape, falloffShapeValue, shapedFalloff, FALLOFF_SHAPES, DEFAULT_FALLOFF_SHAPE } from './lib/gpgpuWindVolume.ts';
      export { parseFieldInstances, parseFieldLayers, serializeFieldInstances, serializeFieldLayers, resolveFieldInstances, fieldInstanceFalloff, fieldInstanceForce } from './lib/gpgpuFieldInstances.ts';
      export { resolveFieldGroupGate, resolveFieldInstanceGroupGate, resolveFieldLayerGroupGate, evaluateFieldGroupMembership } from './lib/gpgpuFieldInstances.ts';
      export { parseGpgpuGroups, encodeSnapshotIndices, GPGPU_GROUP_BAKED_SLOT } from './lib/gpgpuGroups.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  windVolumeFalloff, resolveFalloffShape, falloffShapeValue, shapedFalloff,
  FALLOFF_SHAPES, DEFAULT_FALLOFF_SHAPE,
  parseFieldInstances, parseFieldLayers, serializeFieldInstances, serializeFieldLayers,
  resolveFieldInstances, fieldInstanceFalloff, fieldInstanceForce,
  resolveFieldGroupGate, resolveFieldInstanceGroupGate, resolveFieldLayerGroupGate,
  evaluateFieldGroupMembership,
  parseGpgpuGroups, encodeSnapshotIndices, GPGPU_GROUP_BAKED_SLOT,
} = lib;

// ── 1. Shape resolution + default exactness ────────────────
{
  check('shapes: the three ids are registered, default is smooth',
    FALLOFF_SHAPES.join(',') === 'smooth,linear,smoothstep' && DEFAULT_FALLOFF_SHAPE === 'smooth');
  check('resolve: known ids pass through',
    resolveFalloffShape('smooth') === 'smooth' && resolveFalloffShape('linear') === 'linear'
    && resolveFalloffShape('smoothstep') === 'smoothstep');
  check('resolve: unknown / non-string values fall back to the default shape',
    resolveFalloffShape('bogus') === 'smooth' && resolveFalloffShape('') === 'smooth'
    && resolveFalloffShape(undefined) === 'smooth' && resolveFalloffShape(null) === 'smooth'
    && resolveFalloffShape(42) === 'smooth');
  const grid = [];
  for (const r of [50, 1, 0, -3]) for (const d of [0, 1, 12.5, 25, 49.9, 50, 80]) grid.push([d, r]);
  check('default shape: falloffShapeValue(smooth) is bit-identical to windVolumeFalloff',
    grid.every(([d, r]) => falloffShapeValue('smooth', d, r) === windVolumeFalloff(d, r)));
  check('default shape: shapedFalloff with absent / unknown shape is bit-identical too',
    grid.every(([d, r]) => shapedFalloff(undefined, d, r) === windVolumeFalloff(d, r)
      && shapedFalloff('bogus', d, r) === windVolumeFalloff(d, r)));
}

// ── 2. New shapes: values + monotonicity ───────────────────
{
  check('linear: representative values',
    falloffShapeValue('linear', 0, 50) === 1 && falloffShapeValue('linear', 25, 50) === 0.5
    && falloffShapeValue('linear', 12.5, 50) === 0.75 && falloffShapeValue('linear', 50, 50) === 0
    && falloffShapeValue('linear', 80, 50) === 0 && falloffShapeValue('linear', 10, 0) === 0);
  check('smoothstep: representative values',
    falloffShapeValue('smoothstep', 0, 50) === 1 && falloffShapeValue('smoothstep', 25, 50) === 0.5
    && near(falloffShapeValue('smoothstep', 12.5, 50), 0.84375)
    && near(falloffShapeValue('smoothstep', 37.5, 50), 0.15625)
    && falloffShapeValue('smoothstep', 50, 50) === 0 && falloffShapeValue('smoothstep', 10, 0) === 0);
  check('smooth: the legacy midpoint value is unchanged',
    near(falloffShapeValue('smooth', 25, 50), 0.5625));
  for (const shape of FALLOFF_SHAPES) {
    let prev = Infinity;
    let monotone = true;
    let inRange = true;
    for (let d = 0; d <= 60; d += 2) {
      const v = falloffShapeValue(shape, d, 60);
      if (v > prev) monotone = false;
      if (v < 0 || v > 1) inRange = false;
      prev = v;
    }
    check(`shape ${shape}: monotonic non-increasing and within [0, 1]`, monotone && inRange);
  }
}

// ── 3. Instance falloff field ──────────────────────────────
{
  const lin = parseFieldInstances('[{"kind":"wind","radius":50,"falloff":"linear"}]')[0];
  check('parse: a recognised falloff id is kept on the def', lin.falloff === 'linear');
  check('twin: the instance falloff uses its shape',
    fieldInstanceFalloff(25, 50, lin.falloff) === 0.5
    && near(fieldInstanceFalloff(12.5, 50, parseFieldInstances('[{"kind":"wind","falloff":"smoothstep"}]')[0].falloff), 0.84375));
  const bogus = parseFieldInstances('[{"kind":"wind","falloff":"bogus"}]')[0];
  check('parse: an unrecognised falloff value is dropped (default shape applies)',
    !('falloff' in bogus) && near(fieldInstanceFalloff(25, 50, bogus.falloff), 0.5625));
  const plain = parseFieldInstances('[{"kind":"wind"}]')[0];
  check('parse: no falloff field, no property (pre-WP5 shape)',
    !('falloff' in plain) && near(fieldInstanceFalloff(25, 50, plain.falloff), 0.5625));
  const res = resolveFieldInstances({
    gpgpuFieldInstances: '[{"kind":"wind","pos":[0,0,0],"radius":50,"strength":2,"dir":[1,0,0],"falloff":"linear"}]',
    gpgpuFieldLayers: '',
  });
  const delta = 0.016;
  check('force: a linear-falloff wind instance applies the linear weight',
    near3(fieldInstanceForce(res.instances[0], 1, [25, 0, 0], delta), [2 * 0.5 * 30 * delta, 0, 0]),
    fieldInstanceForce(res.instances[0], 1, [25, 0, 0], delta).join(','));
}

// ── 4. Serialise round trips ───────────────────────────────
{
  const authored = JSON.stringify([
    { kind: 'vortex', pos: [1, 2, 3], radius: 40, strength: 2, tilt: 0.3, falloff: 'smoothstep', group: 'gate-hi' },
    { kind: 'well', pos: [0, 0, 0], radius: 60, strength: 1 },
  ]);
  const defs1 = parseFieldInstances(authored);
  const defs2 = parseFieldInstances(serializeFieldInstances(defs1));
  check('round trip: parse -> serialize -> parse is stable',
    JSON.stringify(defs2) === JSON.stringify(defs1));
  check('round trip: the falloff and group fields survive',
    defs2[0].falloff === 'smoothstep' && defs2[0].group === 'gate-hi' && !('group' in defs2[1]));
  const legacy = '[{"kind":"wind","pos":[5,0,0],"radius":50,"strength":3,"dir":[0,1,0]}]';
  const legacyDefs = parseFieldInstances(legacy);
  const legacyText = serializeFieldInstances(legacyDefs);
  check('round trip: pre-WP5 data serialises without the new fields',
    !legacyText.includes('falloff') && !legacyText.includes('group')
    && JSON.stringify(parseFieldInstances(legacyText)) === JSON.stringify(legacyDefs));
  const layers1 = parseFieldLayers('[{"name":"L","weight":2,"slot":1,"members":[1,2],"group":"frozen"}]');
  const layers2 = parseFieldLayers(serializeFieldLayers(layers1));
  check('round trip: a layer group ref survives',
    layers2[0].group === 'frozen' && JSON.stringify(layers2) === JSON.stringify(layers1));
  check('serialise: empty lists give the empty key',
    serializeFieldInstances([]) === '' && serializeFieldLayers([]) === '');
}

// ── 5. Group gates ─────────────────────────────────────────
{
  const groupsJson = JSON.stringify([
    {
      id: 'gate-hi', name: 'High slot 0',
      source: { kind: 'predicate', predicate: { slot: 0, mode: 'above', low: 0.5, high: 1, invert: false } },
    },
    {
      id: 'frozen', name: 'Frozen pair',
      source: { kind: 'snapshot', indicesB64: encodeSnapshotIndices(Uint32Array.from([1, 3])) },
    },
  ]);
  const defs = parseGpgpuGroups(groupsJson);
  check('groups fixture: both definitions parse', defs.length === 2);
  check('gate: no ref resolves to none',
    resolveFieldGroupGate(defs, undefined).kind === 'none'
    && resolveFieldGroupGate(defs, '').kind === 'none');
  const pred = resolveFieldGroupGate(defs, 'gate-hi');
  check('gate: a predicate group resolves to the predicate form',
    pred.kind === 'predicate' && pred.groupId === 'gate-hi'
    && pred.predicate.slot === 0 && pred.predicate.mode === 'above' && pred.predicate.low === 0.5);
  const baked = resolveFieldGroupGate(defs, 'frozen');
  check('gate: a snapshot group resolves to the baked form on the shared slot',
    baked.kind === 'baked' && baked.groupId === 'frozen' && baked.slot === GPGPU_GROUP_BAKED_SLOT);
  const missing = resolveFieldGroupGate(defs, 'no-such-group');
  check('gate: a dangling ref is unresolved with the reason surfaced',
    missing.kind === 'unresolved' && missing.ref === 'no-such-group' && missing.reason === 'group-not-found');
  const inst = parseFieldInstances('[{"kind":"vortex","group":"gate-hi"}]')[0];
  check('gate: instance wrapper reads the instance ref',
    resolveFieldInstanceGroupGate(defs, inst).kind === 'predicate'
    && resolveFieldInstanceGroupGate(defs, parseFieldInstances('[{"kind":"vortex"}]')[0]).kind === 'none');
  const layer = parseFieldLayers('[{"members":[1],"group":"no-such-group"}]')[0];
  check('gate: layer wrapper surfaces a dangling layer ref',
    resolveFieldLayerGroupGate(defs, layer).kind === 'unresolved');
  // Membership over a synthetic bake: 4 particles, slot 0 in
  // the .x channel of the interleaved RGBA data.
  const attrData = new Float32Array([
    0.2, 0, 0, 0,
    0.7, 0, 0, 0,
    0.5, 0, 0, 0,
    0.9, 0, 0, 0,
  ]);
  const memPred = evaluateFieldGroupMembership(defs, 'gate-hi', attrData, 4);
  check('membership: predicate group values (above >= 0.5)',
    memPred !== null && Array.from(memPred).join(',') === '0,1,1,1',
    memPred ? Array.from(memPred).join(',') : 'null');
  const memSnap = evaluateFieldGroupMembership(defs, 'frozen', attrData, 4);
  check('membership: snapshot group values (indices 1 and 3)',
    memSnap !== null && Array.from(memSnap).join(',') === '0,1,0,1',
    memSnap ? Array.from(memSnap).join(',') : 'null');
  check('membership: no ref / dangling ref evaluate to null (no gate)',
    evaluateFieldGroupMembership(defs, undefined, attrData, 4) === null
    && evaluateFieldGroupMembership(defs, 'no-such-group', attrData, 4) === null);
  const res = resolveFieldInstances({
    gpgpuFieldInstances: '[{"kind":"vortex","group":"gate-hi","falloff":"linear"}]',
    gpgpuFieldLayers: '',
  });
  check('resolve: group / falloff fields ride through resolution untouched',
    res.active && res.instances[0].group === 'gate-hi' && res.instances[0].falloff === 'linear');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
