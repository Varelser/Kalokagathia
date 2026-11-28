// Layer 1 WP11 phase C — consumer wiring: shared-definition
// persistence, the script-bake panel, and the D1/D2 panel
// wiring. Pins:
//
// (a) registration: the new key glslSharedSnippets (plain
//     name, string, default '') and the six replacement keys
//     (three bool/string pairs) live in DEFAULT_CONFIG;
//     normalizeConfig passes authored strings through
//     verbatim; the fingerprint record carries all seven at
//     1,710 total. (Total re-pinned 2026-11-29 at the 第45期
//     統合 fixed value: 1,738.)
// (b) sentinel invariants on the config bridge (WP9 phase C
//     discipline, decided (c) by 杉): '' / non-string = no
//     authorship (fallback); '[]' = a valid authored empty
//     set; a valid authored set wins over the fallback;
//     broken or structurally invalid values degrade to the
//     empty set and never throw; serialize -> resolve round
//     trips are stable.
// (c) byte identity for unused configurations: every
//     injection point's resolve wrapper returns the input
//     string unchanged for directive-free code (with an
//     empty definition set AND with an unreferenced valid
//     set); custom-post stage resolution returns the parsed
//     stage codes byte-identical; stage serialisation round
//     trips legacy and multi-stage documents exactly; the
//     post stage gate does not raise the custom stage for a
//     default config.
// (d) resolution behaviour: a shared definition expands
//     through a point wrapper; an undefined reference fails;
//     a definition violating the point's own contract fails;
//     a sampling post stage may use a definition that samples
//     while a legacy stage may not.
// (e) consumer wiring (source pins): the five consumers call
//     the point resolve wrappers with the config definition
//     set; the post chain routes replacement and stages.
// (f) panel wiring (source pins): the shared-definitions
//     block writes the key and is mounted next to the
//     injection panels; the script-bake block edits the six
//     gpgpuScript* keys and shows the share contract + output
//     hash; the three injection panels write their
//     replacement keys; the post panel reorders stages
//     through serializeCustomPostStages.
//
// Run: node scripts/layer1-wp11-wiring.test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => {
  const out = await build({ entryPoints: [join(ROOT, rel)], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};

let checks = 0;
let failures = 0;
const check = (label, ok, detail = '') => {
  checks += 1;
  if (!ok) { failures += 1; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SHARED = await load('lib/glslSharedSnippets.ts');
const FORCE = await load('lib/gpgpuCustomForce.ts');
const GEOM = await load('lib/geomCustomGlsl.ts');
const PVERT = await load('lib/particlePointsVertexGlsl.ts');
const PFRAG = await load('lib/particlePointsFragmentGlsl.ts');
const FOG = await load('lib/volumeFogGlsl.ts');
const POST = await load('lib/customPostGlsl.ts');
const DEFAULTS = await load('lib/appStateConfigDefaults.ts');
const NORM = await load('lib/appStateConfigNormalization.ts');
const STACK = await load('lib/postFxStack.ts');

const DEFAULT_CONFIG = DEFAULTS.DEFAULT_CONFIG;

// ---- (a) registration ---------------------------------------------------

check('a DEFAULT_CONFIG.glslSharedSnippets defaults to the empty string',
  DEFAULT_CONFIG.glslSharedSnippets === '');
check('a replacement defaults are off/empty for all three points',
  DEFAULT_CONFIG.postCustomGlslReplacementEnabled === false && DEFAULT_CONFIG.postCustomGlslReplacementCode === ''
  && DEFAULT_CONFIG.particlePointsFragmentGlslReplacementEnabled === false && DEFAULT_CONFIG.particlePointsFragmentGlslReplacementCode === ''
  && DEFAULT_CONFIG.volumeFogGlslReplacementEnabled === false && DEFAULT_CONFIG.volumeFogGlslReplacementCode === '');
check('a normalizeConfig({}) keeps glslSharedSnippets empty',
  NORM.normalizeConfig({}).glslSharedSnippets === '');
check('a normalizeConfig passes authored strings through verbatim',
  NORM.normalizeConfig({ glslSharedSnippets: '[]' }).glslSharedSnippets === '[]'
  && NORM.normalizeConfig({ glslSharedSnippets: '[{"name":"a","code":"x"}]' }).glslSharedSnippets === '[{"name":"a","code":"x"}]'
  && NORM.normalizeConfig({ postCustomGlslReplacementCode: 'void main() {}' }).postCustomGlslReplacementCode === 'void main() {}');
{
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts/validate-keys.fingerprint.json'), 'utf8'));
  const seven = ['glslSharedSnippets', 'postCustomGlslReplacementEnabled', 'postCustomGlslReplacementCode',
    'particlePointsFragmentGlslReplacementEnabled', 'particlePointsFragmentGlslReplacementCode',
    'volumeFogGlslReplacementEnabled', 'volumeFogGlslReplacementCode'];
  // Re-pinned 2026-11-29: 第45期統合の固定値 (keyCount 1,738).
  check('a fingerprint record carries the seven phase-C keys at 1,738 total',
    seven.every((k) => record.keys.includes(k)) && record.keyCount === 1738
      && record.keyCount === record.keys.length,
    `keyCount=${record.keyCount}`);
}

// ---- (b) sentinel invariants ---------------------------------------------

const FALLBACK = [{ name: 'fb', code: 'color = vec3(0.0);' }];
check('b empty string = no authorship (fallback used)',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs('', FALLBACK), FALLBACK));
check('b non-string = no authorship (fallback used)',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs(undefined, FALLBACK), FALLBACK)
  && deepEqual(SHARED.resolveGlslSharedSnippetDefs(42, FALLBACK), FALLBACK)
  && deepEqual(SHARED.resolveGlslSharedSnippetDefs(null, FALLBACK), FALLBACK));
check('b authored empty set [] is valid authorship (fallback NOT used)',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs('[]', FALLBACK), []));
check('b a valid authored set wins over the fallback',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs('[{"name":"a","code":"x = 1.0;"}]', FALLBACK),
    [{ name: 'a', code: 'x = 1.0;' }]));
check('b broken JSON degrades to the empty set without throwing',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs('{broken', FALLBACK), []));
check('b a malformed entry degrades to the empty set without throwing',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs('[{"name":"a"}]', FALLBACK), []));
check('b duplicate names degrade to the empty set without throwing',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs(
    '[{"name":"a","code":"x"},{"name":"a","code":"y"}]', FALLBACK), []));
check('b a reference cycle degrades to the empty set without throwing',
  deepEqual(SHARED.resolveGlslSharedSnippetDefs(
    '[{"name":"a","code":"// @use b"},{"name":"b","code":"// @use a"}]', FALLBACK), []));
check('b config-value parse mirrors the sentinel on the raw string',
  SHARED.parseGlslSharedSnippetDefsConfigValue('') === null
  && SHARED.parseGlslSharedSnippetDefsConfigValue(undefined) === null
  && deepEqual(SHARED.parseGlslSharedSnippetDefsConfigValue('[]'), []));
{
  const defs = [
    { name: 'lift', code: 'vel.y += 3.0 * uDelta;' },
    { name: 'soft', code: 'vel *= 0.5;' },
  ];
  const serialized = SHARED.serializeGlslSharedSnippetDefsForConfig(defs);
  check('b serialize -> resolve round trip is stable',
    deepEqual(SHARED.resolveGlslSharedSnippetDefs(serialized, FALLBACK), defs)
    && SHARED.serializeGlslSharedSnippetDefsForConfig(SHARED.resolveGlslSharedSnippetDefs(serialized)) === serialized);
  check('b the empty set serialises to the authored-empty form []',
    SHARED.serializeGlslSharedSnippetDefsForConfig([]) === '[]');
}

// ---- (c) byte identity for unused configurations --------------------------

const IDENTITY_CASES = [
  ['custom force', FORCE.resolveCustomForceSnippet, 'vel.x += sin(uTime) * 0.1;'],
  ['geom vertex', GEOM.resolveGeomCustomVertexSnippet, 'disp = vec3(0.0, sin(pos.y * 3.0 + uTime) * 0.05, 0.0);'],
  ['geom fragment', GEOM.resolveGeomCustomFragmentSnippet, 'color *= 0.8 + 0.2 * vLocalY;'],
  ['particle vertex', PVERT.resolveParticlePointsVertexSnippet, 'scale *= 1.0 + 0.25 * sin(uTime + life * 6.2831);'],
  ['particle fragment', PFRAG.resolveParticlePointsFragmentSnippet, 'color = vec4(vec3(1.0) - color.rgb, color.a);'],
  ['volume fog', FOG.resolveVolumeFogSnippet, 'alpha *= 0.5 + 0.5 * sin(vSlice * 0.05 + uTime);'],
];
for (const [label, resolve, code] of IDENTITY_CASES) {
  const empty = resolve(code, []);
  check(`c ${label}: directive-free code is byte-identical with an empty definition set`,
    empty.ok && empty.code === code, empty.ok ? '' : empty.error);
  const unreferenced = resolve(code, FALLBACK);
  check(`c ${label}: directive-free code is byte-identical with an unreferenced definition set`,
    unreferenced.ok && unreferenced.code === code, unreferenced.ok ? '' : unreferenced.error);
}
{
  const LEGACY_DOC = 'color = vec3(1.0) - color;';
  const parsed = POST.parseCustomPostStages(LEGACY_DOC);
  const resolved = POST.resolveCustomPostGlslStages(LEGACY_DOC, []);
  check('c custom post: stage resolution returns legacy stage codes byte-identical',
    parsed.ok && resolved.ok && deepEqual(resolved.stages, parsed.stages),
    resolved.ok ? '' : resolved.error);
  check('c custom post: serialise(parse(legacy document)) is the document itself',
    parsed.ok && POST.serializeCustomPostStages(parsed.stages) === LEGACY_DOC);
  const MULTI = '// @stage first\ncolor = vec3(1.0) - color;\n// @stage second\n// @sample-input\ncolor += texture2D(tDiffuse, vUv + vec2(0.01)).rgb;';
  const parsedMulti = POST.parseCustomPostStages(MULTI);
  check('c custom post: a multi-stage document round trips exactly',
    parsedMulti.ok && POST.serializeCustomPostStages(parsedMulti.stages) === MULTI,
    parsedMulti.ok ? POST.serializeCustomPostStages(parsedMulti.stages) : parsedMulti.error);
  const UNNAMED = 'color *= 0.9;\n// @stage\ncolor += vec3(0.1);';
  const parsedUnnamed = POST.parseCustomPostStages(UNNAMED);
  check('c custom post: an unnamed multi-stage document round trips exactly',
    parsedUnnamed.ok && POST.serializeCustomPostStages(parsedUnnamed.stages) === UNNAMED,
    parsedUnnamed.ok ? POST.serializeCustomPostStages(parsedUnnamed.stages) : parsedUnnamed.error);
}
check('c post stage gate: a default config raises no custom stage',
  !STACK.getOrderedActivePostFxStageIds(DEFAULT_CONFIG).includes('custom-glsl-post'));
check('c post stage gate: the snippet form raises the stage when valid',
  STACK.getOrderedActivePostFxStageIds({ ...DEFAULT_CONFIG, postCustomGlslEnabled: true, postCustomGlslCode: 'color = vec3(1.0) - color;' }).includes('custom-glsl-post'));
check('c post stage gate: the replacement form raises the stage when valid',
  STACK.getOrderedActivePostFxStageIds({
    ...DEFAULT_CONFIG,
    postCustomGlslEnabled: true,
    postCustomGlslReplacementEnabled: true,
    postCustomGlslReplacementCode: 'void main() { gl_FragColor = vec4(vec3(0.5), 1.0); }',
  }).includes('custom-glsl-post'));
check('c post stage gate: an invalid replacement alone raises no stage',
  !STACK.getOrderedActivePostFxStageIds({
    ...DEFAULT_CONFIG,
    postCustomGlslEnabled: true,
    postCustomGlslReplacementEnabled: true,
    postCustomGlslReplacementCode: 'color = vec3(1.0);',
  }).includes('custom-glsl-post'));

// ---- (d) resolution behaviour ----------------------------------------------

{
  const defs = [{ name: 'lift', code: 'vel.y += 3.0 * uDelta;' }];
  const resolved = FORCE.resolveCustomForceSnippet('// @use lift\nvel.x += 1.0;', defs);
  check('d a shared definition expands through the custom-force wrapper',
    resolved.ok && resolved.code === 'vel.y += 3.0 * uDelta;\nvel.x += 1.0;',
    resolved.ok ? resolved.code : resolved.error);
  const missing = FORCE.resolveCustomForceSnippet('// @use nope', defs);
  check('d an undefined reference fails resolution', !missing.ok);
  const violating = PFRAG.resolveParticlePointsFragmentSnippet('// @use bad',
    [{ name: 'bad', code: 'uniform float uBad;' }]);
  check('d a definition violating the point contract fails resolution', !violating.ok);
  const peekDefs = [{ name: 'peek', code: 'color += texture2D(tDiffuse, vUv).rgb;' }];
  const legacyStage = POST.resolveCustomPostGlslStages('// @use peek', peekDefs);
  check('d a sampling definition is refused inside a legacy post stage', !legacyStage.ok);
  const samplingStage = POST.resolveCustomPostGlslStages('// @stage s\n// @sample-input\n// @use peek', peekDefs);
  check('d the same definition resolves inside a sampling post stage',
    samplingStage.ok && samplingStage.stages[0].code.includes('texture2D(tDiffuse, vUv)'),
    samplingStage.ok ? samplingStage.stages[0].code : samplingStage.error);
}

// ---- (e) consumer wiring (source pins) --------------------------------------

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
{
  const simAssets = read('components/useGpgpuSimulationAssets.ts');
  check('e custom force consumer resolves through the shared definitions',
    simAssets.includes('resolveCustomForceSnippet(') && simAssets.includes('config.glslSharedSnippets'));
  const scene = read('components/sceneParticleSystem.tsx');
  check('e particle points consumer resolves both snippets and routes the replacement',
    scene.includes('resolveParticlePointsVertexSnippet(') && scene.includes('resolveParticlePointsFragmentSnippet(')
    && scene.includes('validateParticlePointsFragmentReplacementCode(')
    && scene.includes('setParticlePointsFragmentReplacementStatus'));
  const fogRuntime = read('components/sceneVolumeFogSystemRuntime.ts');
  check('e volume fog consumer resolves the snippet and routes the replacement',
    fogRuntime.includes('resolveVolumeFogSnippet(') && fogRuntime.includes('validateVolumeFogReplacementCode('));
  const meshAssets = read('components/useGpgpuMeshAssets.ts');
  check('e GEOM consumer resolves both snippets',
    meshAssets.includes('resolveGeomCustomVertexSnippet(') && meshAssets.includes('resolveGeomCustomFragmentSnippet('));
  const postFx = read('components/AppScenePostFx.tsx');
  check('e post consumer resolves stages and routes the replacement',
    postFx.includes('resolveCustomPostGlslStages(') && postFx.includes('validatePostGlslReplacementCode(')
    && postFx.includes('setUserStages(') && postFx.includes('setUserFragment('));
  const postPass = read('components/customGlslPostPass.ts');
  check('e the custom post pass exposes stage and fragment setters',
    postPass.includes('setUserStages') && postPass.includes('setUserFragment'));
  const stackSrc = read('lib/postFxStack.ts');
  check('e the stack gate accepts the replacement form',
    stackSrc.includes('validatePostGlslReplacementCode(') && stackSrc.includes('postCustomGlslReplacementEnabled'));
}

// ---- (f) panel wiring (source pins) ------------------------------------------

{
  const sharedPanel = read('components/controlPanelGlobalDisplayGlslSharedSnippets.tsx');
  check('f the shared-definitions panel writes the key through the serialiser',
    sharedPanel.includes('serializeGlslSharedSnippetDefsForConfig(draft)')
    && sharedPanel.includes("updateConfig('glslSharedSnippets', serialized)"));
  const forcesMaps = read('components/controlPanelGlobalDisplayGpgpuForcesMaps.tsx');
  check('f the forces/maps assembly mounts the shared-definitions and script blocks',
    forcesMaps.includes('<GlslSharedSnippetsBlock') && forcesMaps.includes('<ScriptBakeBlock'));
  const postAssembly = read('components/controlPanelGlobalDisplayPostFx.tsx');
  check('f the post assembly mounts the shared-definitions block',
    postAssembly.includes('<GlslSharedSnippetsBlock'));
  const scriptPanel = read('components/controlPanelGlobalDisplayGpgpuScriptBake.tsx');
  check('f the script panel edits the six script keys and shows contract + hash',
    scriptPanel.includes("updateConfig('gpgpuScriptEnabled'")
    && scriptPanel.includes("updateConfig('gpgpuScriptTarget'")
    && scriptPanel.includes("updateConfig('gpgpuScriptSeed'")
    && scriptPanel.includes("updateConfig('gpgpuScriptSource'")
    && scriptPanel.includes('requiresRunConfirmation')
    && scriptPanel.includes('gpgpuScriptOutputHash'));
  const postPanel = read('components/controlPanelGlobalDisplayPostFxCustom.tsx');
  check('f the post panel writes the replacement keys and reorders stages',
    postPanel.includes("updateConfig('postCustomGlslReplacementEnabled'")
    && postPanel.includes("updateConfig('postCustomGlslReplacementCode'")
    && postPanel.includes('serializeCustomPostStages'));
  const fragPanel = read('components/controlPanelGlobalDisplayParticleFragmentCustom.tsx');
  check('f the particle fragment panel writes its replacement keys',
    fragPanel.includes("updateConfig('particlePointsFragmentGlslReplacementEnabled'")
    && fragPanel.includes("updateConfig('particlePointsFragmentGlslReplacementCode'"));
  const fogPanel = read('components/controlPanelGlobalDisplayVolumeFogCustom.tsx');
  check('f the volume fog panel writes its replacement keys',
    fogPanel.includes("updateConfig('volumeFogGlslReplacementEnabled'")
    && fogPanel.includes("updateConfig('volumeFogGlslReplacementCode'"));
}

console.log(`layer1-wp11-wiring: ${checks - failures}/${checks} checks passed`);
if (failures > 0) { console.error(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
