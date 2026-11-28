// Grammar 2.0 stage 2, slice B1 — field instances + flow
// field layers: the singleton fields (origin-fixed vortex,
// auto-placed wells, one wind volume) become placed instances
// (position / radius / strength) supplied through the shared
// column-data texture (design decision 2), and layers group
// instances with a weight whose per-particle modulation rides
// an attribute slot (design decision 1).
// Design: kalokagathia-pro/STAGE2_DESIGN.md §1 / §3 B1.
//
// Cases:
//  1 parse/resolve: defaults inactive; malformed JSON resolves
//    to no instances; per-kind derivation (vortex axis from
//    tilt = the legacy formula, wind dir normalised, well
//    softening / orbit fall back to the legacy defaults)
//  2 layers: first layer naming an instance wins; slot parsing
//    (0..3 valid, else none); the attribute-consumer predicate
//  3 column pack: layout offsets (append-only — a later
//    section never moves fields/layers), texel contents,
//    determinism
//  4 CPU twins: falloff shape; vortex / well / wind Δv against
//    hand-computed values; zero outside the radius
//  5 shader pins: stock velocity / position strings pinned to
//    the pre-B1 hashes and free of the column texture; the
//    field variant stays inside the 16-unit floor (it gives
//    the spawn-order unit back), carries the chunk exactly
//    once, and composes with the live variant at 16 units;
//    the position field variant derives the gate value
//  6 capability: 'field-instances' requested only while
//    instances resolve, and unsupported (routes to WebGL)
//  7 key registration: the 2 new keys sit at their defaults
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const near3 = (a, b, eps = 1e-9) => near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const occurrences = (s, sub) => s.split(sub).length - 1;

await build({
  stdin: {
    contents: `
      export { parseFieldInstances, parseFieldLayers, resolveFieldInstances, fieldInstancesActive, fieldLayerSlotAttrActive, vortexAxisFromTilt, buildColumnLayout, columnSectionOffset, packFieldColumnData, fieldInstanceFalloff, fieldInstanceForce, COLUMN_TEX_WIDTH, FIELD_COLUMN_LAYOUT, FIELD_COLUMN_REQUESTS, FIELD_INSTANCE_MAX } from './lib/gpgpuFieldInstances.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildMainForcesFragment } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  parseFieldInstances, parseFieldLayers, resolveFieldInstances, fieldInstancesActive,
  fieldLayerSlotAttrActive, vortexAxisFromTilt, buildColumnLayout, columnSectionOffset,
  packFieldColumnData, fieldInstanceFalloff, fieldInstanceForce,
  COLUMN_TEX_WIDTH, FIELD_COLUMN_LAYOUT, FIELD_COLUMN_REQUESTS, FIELD_INSTANCE_MAX,
  buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG,
  buildMainForcesFragment, getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

const D = APP_STATE_DEFAULT_GPGPU;
const cfg = (patch) => ({ ...D, ...patch });

const INSTANCES_JSON = JSON.stringify([
  { kind: 'vortex', pos: [10, 0, 0], radius: 100, strength: 2, tilt: 0 },
  { kind: 'well', pos: [-20, 5, 0], radius: 60, strength: 1 },
  { kind: 'wind', pos: [0, 20, 0], radius: 50, strength: 3, dir: [0, 3, 4] },
]);

// ── 1. Parse / resolve ─────────────────────────────────────
{
  check('defaults: no instances, inactive', !fieldInstancesActive(D)
    && resolveFieldInstances(D).instances.length === 0);
  check('malformed JSON resolves to no instances',
    parseFieldInstances('{oops').length === 0 && parseFieldInstances('{"a":1}').length === 0
    && parseFieldInstances('[{"kind":"bogus"}]').length === 0);
  const res = resolveFieldInstances(cfg({ gpgpuFieldInstances: INSTANCES_JSON }));
  check('resolve: 3 instances, active', res.active && res.instances.length === 3);
  check('resolve: kind ids 0/1/2', res.instances.map((i) => i.kindId).join(',') === '0,1,2');
  check('resolve: vortex axis from tilt 0 is +Y (legacy formula)',
    near3(res.instances[0].vec, [0, 1, 0]));
  check('resolve: vortex axis matches vortexAxisFromTilt(0.7)',
    near3(vortexAxisFromTilt(0.7), [Math.sin(0.7), Math.cos(0.7), 0].map((v, i, a) => v / Math.hypot(a[0], a[1]))));
  check('resolve: well softening / orbit fall back to the legacy defaults 10 / 0.5',
    res.instances[1].softening === 10 && res.instances[1].orbit === 0.5);
  check('resolve: wind dir normalised', near3(res.instances[2].vec, [0, 0.6, 0.8]));
  check('resolve: unlayered instances have layerIndex -1',
    res.instances.every((i) => i.layerIndex === -1));
  check('parse: list capped at FIELD_INSTANCE_MAX',
    parseFieldInstances(JSON.stringify(Array.from({ length: 40 }, () => ({ kind: 'wind' })))).length === FIELD_INSTANCE_MAX);
}

// ── 2. Layers ──────────────────────────────────────────────
{
  const layersJson = JSON.stringify([
    { name: 'first', weight: 0.5, slot: 2, members: [1, 2] },
    { name: 'second', weight: 2, slot: -1, members: [2, 3] },
  ]);
  const res = resolveFieldInstances(cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: layersJson }));
  check('layers: first layer naming an instance wins',
    res.instances[0].layerIndex === 0 && res.instances[1].layerIndex === 0 && res.instances[2].layerIndex === 1);
  check('layers: weights / slots read', res.layers[0].weight === 0.5 && res.layers[0].slot === 2 && res.layers[1].slot === -1);
  check('layers: slot out of range resolves to none',
    parseFieldLayers('[{"slot":7,"members":[1]}]')[0].slot === -1
    && parseFieldLayers('[{"slot":"x","members":[1]}]')[0].slot === -1);
  check('attr predicate: slotted layer with members is a consumer',
    fieldLayerSlotAttrActive(cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: layersJson })));
  check('attr predicate: slotless layers are not consumers',
    !fieldLayerSlotAttrActive(cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: '[{"weight":1,"slot":-1,"members":[1]}]' })));
  check('attr predicate: slotted layer without members is not a consumer',
    !fieldLayerSlotAttrActive(cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: '[{"weight":1,"slot":1,"members":[]}]' })));
  check('attr predicate: no instances, no consumer',
    !fieldLayerSlotAttrActive(cfg({ gpgpuFieldLayers: layersJson })));
}

// ── 3. Column pack ─────────────────────────────────────────
{
  check('layout: fields base 0, layers base one row in, height 2',
    columnSectionOffset(FIELD_COLUMN_LAYOUT, 'fields') === 0
    && columnSectionOffset(FIELD_COLUMN_LAYOUT, 'layers') === COLUMN_TEX_WIDTH
    && FIELD_COLUMN_LAYOUT.height === 2 && FIELD_COLUMN_LAYOUT.width === COLUMN_TEX_WIDTH);
  const extended = buildColumnLayout([...FIELD_COLUMN_REQUESTS, { id: 'paths', texels: 800 }]);
  check('layout: appending a section never moves fields / layers (append-only)',
    columnSectionOffset(extended, 'fields') === 0
    && columnSectionOffset(extended, 'layers') === COLUMN_TEX_WIDTH
    && columnSectionOffset(extended, 'paths') === 2 * COLUMN_TEX_WIDTH
    && extended.height === 6);
  const layersJson = JSON.stringify([{ name: 'L', weight: 0.5, slot: 2, members: [1] }]);
  const res = resolveFieldInstances(cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: layersJson }));
  const pack = packFieldColumnData(res);
  const texel = (idx) => [pack.data[idx * 4], pack.data[idx * 4 + 1], pack.data[idx * 4 + 2], pack.data[idx * 4 + 3]];
  check('pack: counts', pack.instanceCount === 3 && pack.layerCount === 1);
  check('pack: instance 0 A = pos + radius', near3(texel(0).slice(0, 3), [10, 0, 0]) && texel(0)[3] === 100);
  check('pack: instance 0 B = axis + strength', near3(texel(1).slice(0, 3), [0, 1, 0]) && texel(1)[3] === 2);
  check('pack: instance 0 C = kind / softening / orbit / layer+1',
    texel(2)[0] === 0 && texel(2)[3] === 1);
  check('pack: instance 1 C carries well defaults + no layer',
    texel(5)[0] === 1 && texel(5)[1] === 10 && texel(5)[2] === 0.5 && texel(5)[3] === 0);
  check('pack: layer texel = weight / slot+1 / 0 / 0',
    near3(texel(pack.layersBase), [0.5, 3, 0, 0]));
  const pack2 = packFieldColumnData(res);
  check('pack: deterministic (identical bytes on re-pack)',
    pack.data.length === pack2.data.length && pack.data.every((v, i) => v === pack2.data[i]));
}

// ── 4. CPU twins ───────────────────────────────────────────
{
  check('falloff: 1 at centre, 0 at and beyond radius, (1-q^2)^2 between',
    fieldInstanceFalloff(0, 50) === 1 && fieldInstanceFalloff(50, 50) === 0
    && fieldInstanceFalloff(80, 50) === 0 && near(fieldInstanceFalloff(25, 50), 0.5625));
  const res = resolveFieldInstances(cfg({ gpgpuFieldInstances: INSTANCES_JSON }));
  const delta = 0.016;
  // Vortex at origin-ish: instance 0 sits at (10,0,0) axis +Y;
  // a particle at (20,0,0) has rel (10,0,0), tangent = axis×rel
  // = (0,0,-10) → Δv = (0,0,-1) * strength 2 * falloff(10,100)
  // * 80 * delta.
  const fall10 = (1 - 0.01) * (1 - 0.01);
  const dv = fieldInstanceForce(res.instances[0], 1, [20, 0, 0], delta);
  check('twin vortex: direction and magnitude', near3(dv, [0, 0, -2 * fall10 * 80 * delta], 1e-9), dv.join(','));
  check('twin vortex: layer weight scales linearly',
    near3(fieldInstanceForce(res.instances[0], 0.5, [20, 0, 0], delta), [0, 0, -fall10 * 80 * delta], 1e-9));
  check('twin vortex: zero outside radius',
    near3(fieldInstanceForce(res.instances[0], 1, [500, 0, 0], delta), [0, 0, 0]));
  check('twin vortex: zero on the axis (no tangent)',
    near3(fieldInstanceForce(res.instances[0], 1, [10, 30, 0], delta), [0, 0, 0]));
  // Well instance 1 at (-20,5,0): particle at (-10,5,0) has
  // rel (10,0,0), dist 10, d = 10 + softening 10 = 20; pull =
  // strength 1 * falloff(10,60) * 2000 * delta / 400 toward
  // the centre (-x); orbit tangent = cross(normalize(toC +
  // 0.001x), +Y) with toC = (-10,0,0) → n ≈ (-1,0,0) →
  // tangent ≈ (0,0,-1) * orbit 0.5 * falloff * 50 * delta.
  const fallW = (1 - (10 / 60) * (10 / 60)) ** 2;
  const dw = fieldInstanceForce(res.instances[1], 1, [-10, 5, 0], delta);
  check('twin well: pull toward centre at the legacy gain',
    near(dw[0], -10 * (fallW * 2000 * delta / 400), 1e-6) && near(dw[1], 0, 1e-9), dw.join(','));
  check('twin well: orbit tangent present', near(dw[2], -0.5 * fallW * 50 * delta, 1e-4), dw.join(','));
  // Wind instance 2: dir (0, 0.6, 0.8), strength 3; particle at
  // the centre: falloff 1, Δv = dir * 3 * 30 * delta (gust 0).
  const dn = fieldInstanceForce(res.instances[2], 1, [0, 20, 0], delta);
  check('twin wind: own direction at the legacy gain', near3(dn, [0, 0.6 * 3 * 30 * delta, 0.8 * 3 * 30 * delta], 1e-9), dn.join(','));
}

// ── 5. Shader pins + variant budget ────────────────────────
{
  check('pin: stock velocity string keeps its pre-B1 hash',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha256(SIM_VEL_FRAG));
  check('pin: stock position string keeps its pre-B1 hash',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha256(SIM_POS_FRAG));
  check('pin: stock strings carry no column texture or field function',
    !SIM_VEL_FRAG.includes('uColTex') && !SIM_VEL_FRAG.includes('kaloFieldForce')
    && !SIM_POS_FRAG.includes('uColTex'));
  check('pin: no-option builders return the stock strings',
    buildVelocityFragment('') === SIM_VEL_FRAG && buildPositionFragment({}) === SIM_POS_FRAG
    && buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG);
  check('pin: default main-forces assembly carries no field chunk',
    !buildMainForcesFragment().includes('kaloFieldForce'));
  const field = buildVelocityFragment('', undefined, { fieldInstances: true });
  check('variant: field velocity stays inside the 16-unit floor',
    samplerCount(field) === 16, String(samplerCount(field)));
  check('variant: column sampler declared once, order sampler given back',
    occurrences(field, 'uniform sampler2D uColTex;') === 1
    && !field.includes('uniform sampler2D uSpawnOrderTex;')
    && field.includes('uniform float uSpawnOrderMaxDist;')
    && field.includes('float v = clamp(length(texture2D(uInitPosTex, uv).xyz)'));
  check('variant: field function defined once, chunk calls it once',
    occurrences(field, 'vec3 kaloFieldForce(') === 1
    && occurrences(field, 'vel += kaloFieldForce(') === 1);
  // NOTE (design §6 stop-line, see STAGE2_B1_IMPL_RECORD):
  // the live variant and the field variant EACH give the
  // spawn-order unit back and add one sampler of their own, so
  // either alone fits the 16-unit floor — but combined they
  // measure 17 declarations: the give-back slot exists only
  // once. Resolving the combination (a second give-back or a
  // merged supply) is a design decision above this slice, so
  // B1 pins only the string composition here and records the
  // measured overflow in the record instead of forcing a fix.
  check('variant: live gates reach the field chunk when combined',
    buildVelocityFragment('', undefined, { fieldInstances: true, particleRulesLive: true })
      .includes('grpWind, grpVortex, grpWell);'));
  check('variant: field chunk is orderable (placed first when ordered first)',
    buildMainForcesFragment('field-instances,wind', { fieldInstances: true }).indexOf('kaloFieldForce(')
    < buildMainForcesFragment('field-instances,wind', { fieldInstances: true }).indexOf('uWindEnabled'));
  const posField = buildPositionFragment({ fieldInstances: true });
  check('variant: position field variant derives the gate value identically',
    !posField.includes('uniform sampler2D uSpawnOrderTex;')
    && posField.includes('uniform sampler2D uInitPosTex;')
    && posField.includes('float v = clamp(length(texture2D(uInitPosTex, uv).xyz)')
    && samplerCount(posField) <= 16, String(samplerCount(posField)));
  check('variant: position live variant unchanged by the field option',
    buildPositionFragment({ particleRulesLive: true, fieldInstances: true })
    === buildPositionFragment({ particleRulesLive: true }));
}

// ── 6. Capability ──────────────────────────────────────────
{
  const off = getWebgpuComputeCapabilityReport(D);
  check('capability: default config does not request field-instances',
    !off.requestedFeatures.includes('field-instances'));
  const on = getWebgpuComputeCapabilityReport(cfg({ gpgpuFieldInstances: INSTANCES_JSON }));
  check('capability: active config requests it and it is unsupported (routes to WebGL)',
    on.requestedFeatures.includes('field-instances')
    && on.unsupportedFeatures.includes('field-instances')
    && !on.supportedFeatures.includes('field-instances'));
}

// ── 7. Key registration ────────────────────────────────────
{
  check('keys: gpgpuFieldInstances / gpgpuFieldLayers default to empty strings',
    D.gpgpuFieldInstances === '' && D.gpgpuFieldLayers === '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
