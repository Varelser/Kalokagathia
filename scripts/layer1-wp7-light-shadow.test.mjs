// Layer 1 WP7 Phase B — Lighting / shadow generalization
//
// Two halves:
//  (1) Shadow-map light follows the light unit list. The
//      single true shadow map (lib/lightShadowMap.ts) is
//      captured from ONE resolved unit: the unit named by
//      the new key gpgpuShadowMapLightUnit (1..4), or — while
//      the key is 0 (auto, the default) — the first ENABLED
//      unit in list order, falling back to unit 1 while no
//      unit is enabled (the legacy unconditional unit-1 read,
//      so the defaults resolve exactly as before). Resolution
//      lives in lib/gpgpuLightUnits.ts
//      (resolveShadowLightUnit / resolveShadowLightPos) and
//      the capture consumes it; every receiver keeps reading
//      the single published source. Multiple shadow maps are
//      deliberately NOT provided (RT budget — recorded in
//      lib/lightShadowMap.ts).
//  (2) Lux depth intersection for the LightVolume. Behind
//      the new key gpgpuLightVolumeDepthIntersect (> 0) the
//      volume material assembles a fragment variant
//      (components/lightVolumeShader.ts:
//      buildLightVolumeFragment) whose accumulated beam is
//      truncated by the visible fraction of the view chord
//      in front of the scene surface (twins in
//      lib/lightVolume.ts). At the default 0 the builder
//      returns the stock fragment string byte for byte.
//
// What is pinned here (node side):
//  (a) Key registration: both new keys default to 0 and are
//      present in the validate-keys fingerprint record.
//  (b) Shadow resolution semantics: auto follows the first
//      enabled unit and switches as the list changes; no
//      unit enabled resolves to unit 1 (legacy); an explicit
//      selection wins over auto and reads the position as a
//      pure reference (enabled or not).
//  (c) Capture wiring: LightShadowCapture resolves its
//      viewpoint through resolveShadowLightPos.
//  (d) Depth twins: clamp / predicate / chord length / fade
//      values incl. edge rules, and the GLSL twin's formula
//      shape.
//  (e) Fragment builder: off = the stock string byte for
//      byte (sha-pinned); on = exactly the three splices
//      (uniform, fade GLSL, extended depth block) with the
//      legacy fade preserved and the tail untouched.
//  (f) Supply wiring: LightVolume binds the depth supply for
//      the volume's own strength too, and AppScene mounts
//      the depth capture while either strength is positive.
// The real-GPU appearance check (shadow direction from a
// followed unit, beam truncation look) is a gate-side item,
// NOT judged here — this file pins the string/resolution
// level.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7b-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;

// Stock volume string pins, measured on the tree in WP7
// Phase B after the verbatim move of the strings from
// LightVolume.tsx into components/lightVolumeShader.ts (the
// move changed no character of either string).
const STOCK_VOLUME_VERT_SHA256 = 'd9bbb6a4191ea5f212a9b5d7d71db221dcb961f69a2aa44bfd6b0c323eeaa23b';
const STOCK_VOLUME_FRAG_SHA256 = 'dc30a3332d83756e3192236fd19449903209b2dd1dbe5ea12d026363b4112c28';

await build({
  stdin: {
    contents: `
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export {
        resolveLightUnits, resolveShadowMapLightUnit, resolveShadowLightUnit,
        resolveShadowLightPos, shadowLightUnitSelectionActive,
      } from './lib/gpgpuLightUnits.ts';
      export {
        clampVolumeDepthIntersect, volumeDepthIntersectOn,
        lightVolumeChordLength, lightVolumeDepthIntersectFade,
        LIGHT_VOLUME_DEPTH_INTERSECT_GLSL,
      } from './lib/lightVolume.ts';
      export { VOLUME_VERTEX, VOLUME_FRAGMENT, buildLightVolumeFragment } from './components/lightVolumeShader.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    DEFAULT_CONFIG,
    resolveShadowMapLightUnit, resolveShadowLightUnit, resolveShadowLightPos,
    shadowLightUnitSelectionActive,
    clampVolumeDepthIntersect, volumeDepthIntersectOn,
    lightVolumeChordLength, lightVolumeDepthIntersectFade,
    LIGHT_VOLUME_DEPTH_INTERSECT_GLSL,
    VOLUME_VERTEX, VOLUME_FRAGMENT, buildLightVolumeFragment,
  } = m;

  // ── (a) Key registration ──
  check('(a) new keys default to 0',
    DEFAULT_CONFIG.gpgpuShadowMapLightUnit === 0
    && DEFAULT_CONFIG.gpgpuLightVolumeDepthIntersect === 0);
  const fp = JSON.parse(read('scripts/validate-keys.fingerprint.json'));
  const fpKeys = fp.keys ?? fp.fingerprintedKeys ?? [];
  check('(a) both new keys are in the fingerprint record',
    Array.isArray(fpKeys)
    && fpKeys.includes('gpgpuShadowMapLightUnit')
    && fpKeys.includes('gpgpuLightVolumeDepthIntersect'),
    `record has ${Array.isArray(fpKeys) ? fpKeys.length : '?'} keys`);

  // ── (b) Shadow resolution semantics ──
  const U = (i, over = {}) => ({
    [`gpgpuLight${i === 1 ? '' : i}Enabled`]: true,
    [`gpgpuLight${i === 1 ? '' : i}PosX`]: i * 10,
    [`gpgpuLight${i === 1 ? '' : i}PosY`]: i,
    [`gpgpuLight${i === 1 ? '' : i}PosZ`]: -i,
    ...over,
  });
  const posEq = (p, x, y, z) => p.x === x && p.y === y && p.z === z;

  check('(b) defaults (auto, nothing enabled) resolve to unit 1 legacy position',
    resolveShadowLightUnit(DEFAULT_CONFIG).index === 1
    && posEq(resolveShadowLightPos(DEFAULT_CONFIG), DEFAULT_CONFIG.gpgpuLightPosX, DEFAULT_CONFIG.gpgpuLightPosY, DEFAULT_CONFIG.gpgpuLightPosZ)
    && shadowLightUnitSelectionActive(DEFAULT_CONFIG) === false);
  check('(b) no unit enabled: unit 2 position is NOT followed (legacy unit-1 read)',
    posEq(resolveShadowLightPos({ ...U(2), gpgpuLight2Enabled: false, gpgpuLightPosX: 1, gpgpuLightPosY: 2, gpgpuLightPosZ: 3 }), 1, 2, 3));
  check('(b) auto follows unit 1 when it is enabled (first enabled wins over unit 2)',
    resolveShadowLightUnit({ ...U(1), ...U(2) }).index === 1);
  check('(b) auto switches to unit 2 when unit 1 is disabled and unit 2 enabled',
    resolveShadowLightUnit({ ...U(2) }).index === 2
    && posEq(resolveShadowLightPos({ ...U(2) }), 20, 2, -2)
    && shadowLightUnitSelectionActive({ ...U(2) }) === true);
  check('(b) auto follows list changes: disabling unit 2 and enabling unit 3 switches the shadow light',
    resolveShadowLightUnit({ ...U(3) }).index === 3
    && posEq(resolveShadowLightPos({ ...U(3), gpgpuLight3PosX: 99 }), 99, 3, -3));
  check('(b) explicit selection wins over auto and reads position as a pure reference (unit disabled)',
    resolveShadowLightUnit({ ...U(1), gpgpuShadowMapLightUnit: 3, gpgpuLight3PosX: 7, gpgpuLight3PosY: 8, gpgpuLight3PosZ: 9 }).index === 3
    && posEq(resolveShadowLightPos({ ...U(1), gpgpuShadowMapLightUnit: 3, gpgpuLight3PosX: 7, gpgpuLight3PosY: 8, gpgpuLight3PosZ: 9 }), 7, 8, 9)
    && shadowLightUnitSelectionActive({ gpgpuShadowMapLightUnit: 1 }) === true);
  check('(b) explicit selection resolution clamps junk to auto / range',
    resolveShadowMapLightUnit({}) === 0
    && resolveShadowMapLightUnit({ gpgpuShadowMapLightUnit: -2 }) === 0
    && resolveShadowMapLightUnit({ gpgpuShadowMapLightUnit: Number.NaN }) === 0
    && resolveShadowMapLightUnit({ gpgpuShadowMapLightUnit: 99 }) === 4
    && resolveShadowMapLightUnit({ gpgpuShadowMapLightUnit: 2.6 }) === 3);

  // ── (c) Capture wiring ──
  const captureSrc = read('components/LightShadowCapture.tsx');
  check('(c) capture resolves its viewpoint through resolveShadowLightPos',
    captureSrc.includes('const lightPos = resolveShadowLightPos(config);')
    && captureSrc.includes('buildLightViewProj(lightPos, config.gpgpuBounceRadius)')
    && !captureSrc.includes('x: config.gpgpuLightPosX'));

  // ── (d) Depth twins ──
  check('(d) clampVolumeDepthIntersect edge rules',
    clampVolumeDepthIntersect(undefined) === 0
    && clampVolumeDepthIntersect(Number.NaN) === 0
    && clampVolumeDepthIntersect(-1) === 0
    && clampVolumeDepthIntersect(0.5) === 0.5
    && clampVolumeDepthIntersect(2) === 1);
  check('(d) variant predicate stands only while the strength is positive',
    volumeDepthIntersectOn({}) === false
    && volumeDepthIntersectOn({ gpgpuLightVolumeDepthIntersect: 0 }) === false
    && volumeDepthIntersectOn({ gpgpuLightVolumeDepthIntersect: 0.2 }) === true
    && volumeDepthIntersectOn(DEFAULT_CONFIG) === false);
  check('(d) chord length: sphere is 2R*chord, cone uses length*chord, rim is 0',
    lightVolumeChordLength('sphere', 10, 1) === 20
    && lightVolumeChordLength('sphere', 10, 0.5) === 10
    && lightVolumeChordLength('cone', 10, 1) === 10
    && lightVolumeChordLength('cone', 10, 0) === 0
    && lightVolumeChordLength('sphere', -5, 1) === 0);
  const fade = lightVolumeDepthIntersectFade;
  check('(d) fade front-facing: surface at entry 0, midway 1/2, at/beyond exit 1',
    fade(20, 20, 10, true) === 0
    && fade(25, 20, 10, true) === 0.5
    && fade(30, 20, 10, true) === 1
    && fade(45, 20, 10, true) === 1
    && fade(10, 20, 10, true) === 0);
  check('(d) fade back-facing: segment runs from fragDepth - chordLength',
    fade(20, 30, 10, false) === 0
    && fade(25, 30, 10, false) === 0.5
    && fade(30, 30, 10, false) === 1);
  check('(d) fade degenerate inputs never hide the fragment',
    fade(25, 20, 0, true) === 1
    && fade(Number.NaN, 20, 10, true) === 1
    && fade(25, Number.NaN, 10, true) === 1);
  check('(d) GLSL twin carries the same formula shape',
    LIGHT_VOLUME_DEPTH_INTERSECT_GLSL.includes('float kaloVolumeDepthIntersectFade(float sceneDepth, float fragDepth, float chordLength, bool frontFacing)')
    && LIGHT_VOLUME_DEPTH_INTERSECT_GLSL.includes('frontFacing ? fragDepth : fragDepth - chordLength')
    && LIGHT_VOLUME_DEPTH_INTERSECT_GLSL.includes('clamp((sceneDepth - entry) / chordLength, 0.0, 1.0)'));

  // ── (e) Fragment builder ──
  check('(e) stock strings keep their pins',
    sha256(VOLUME_VERTEX) === STOCK_VOLUME_VERT_SHA256
    && sha256(VOLUME_FRAGMENT) === STOCK_VOLUME_FRAG_SHA256,
    `vert ${sha256(VOLUME_VERTEX)} frag ${sha256(VOLUME_FRAGMENT)}`);
  check('(e) builder off returns the stock string byte for byte',
    buildLightVolumeFragment(false) === VOLUME_FRAGMENT);
  const variant = buildLightVolumeFragment(true);
  check('(e) variant differs from stock and declares uDepthIntersect exactly once',
    variant !== VOLUME_FRAGMENT
    && count(variant, 'uniform float uDepthIntersect;') === 1
    && count(VOLUME_FRAGMENT, 'uDepthIntersect') === 0);
  check('(e) variant splices the fade GLSL and the extended depth block, legacy fade preserved',
    variant.includes('kaloVolumeDepthIntersectFade(sceneDepth, fragDepth, chordLen, gl_FrontFacing)')
    && variant.includes('if (uDepthReady > 0.5 && (uDepthOcclusion > 0.0 || uDepthIntersect > 0.0)) {')
    && !variant.includes('if (uDepthReady > 0.5 && uDepthOcclusion > 0.0) {')
    && variant.includes('float fade = kaloDepthFadeFactor(sceneDepth, fragDepth, max(fragDepth * 0.05, 1.0));')
    && variant.includes('float chordLen = chord * (uShape < 0.5 ? uLength : 2.0 * uLength);'));
  check('(e) variant tail (discard + output) is the stock tail',
    variant.slice(variant.indexOf('    if (a <= 0.001) discard;'))
    === VOLUME_FRAGMENT.slice(VOLUME_FRAGMENT.indexOf('    if (a <= 0.001) discard;')));

  // ── (f) Supply wiring ──
  const volumeSrc = read('components/LightVolume.tsx');
  // Builder call re-pinned 2026-11-28 (WP7 Phase D added the
  // density variant as the builder's second argument; the
  // depth-intersection assembly itself is unchanged).
  check('(f) LightVolume assembles the variant and binds depth for its own strength',
    volumeSrc.includes('fragmentShader: buildLightVolumeFragment(depthIntersectOn, densityOn)')
    && volumeSrc.includes('depthOcclusion > 0 || depthIntersectOn')
    && volumeSrc.includes('u.uDepthIntersect.value = depthIntersectStrength'));
  const appSceneSrc = read('components/AppScene.tsx');
  check('(f) AppScene mounts the depth capture while either strength is positive',
    appSceneSrc.includes('effectiveConfig.gpgpuDepthOcclusion > 0 || effectiveConfig.gpgpuLightVolumeDepthIntersect > 0')
    && appSceneSrc.includes('<SceneDepthCapture />'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
