// Layer 1 WP7 Phase D — Shine density supply generalization
//
// Two halves, both behind keys whose defaults reproduce the
// Phase 22 behaviour verbatim:
//  (1) Consumption: the LightVolume (components/LightVolume.tsx)
//      joins the LightFx Shine march as a consumer of the
//      shared particle density field (lib/particleDensity.ts).
//      Behind gpgpuLightVolumeDensity (> 0) its material
//      assembles the density variant of the volume fragment
//      (components/lightVolumeShader.ts:
//      buildLightVolumeFragment's second argument), which
//      scales the accumulated beam by the field's per-fragment
//      attenuation (particleDensityAttenuation / its GLSL twin
//      in lib/particleDensity.ts). At the default 0 the builder
//      returns the non-density string and no density supply is
//      bound for the volume's sake.
//  (2) Supply: the density splat in
//      components/sceneGpgpuSystem.tsx no longer folds only
//      the main layer into the field. The key
//      postShineDensityLayers authors the source layers
//      (main / aux / aux2 / aux3, resolved by
//      resolveParticleDensityLayers in lib/particleDensity.ts);
//      each selected layer is splatted from the position
//      texture its own draw material is bound to. The default
//      'main' is the Phase 22 splat exactly. The store shape
//      is unchanged (one texture), so the Phase 22 Shine
//      consumer keeps working unmodified — pinned below via
//      its fragment builder.
//
// NOT in Phase D (recorded remainder): fractal modulation of
// the density field. The field remains the smooth splat of
// the selected layers; no noise / fbm term is added anywhere.
//
// What is pinned here (node side):
//  (a) Key registration: both new keys at their defaults and
//      present in the validate-keys fingerprint record.
//  (b) Layer resolution semantics: canonical order, dedupe,
//      unknown tokens dropped, junk resolves to ['main'].
//  (c) Attenuation twins: edge rules, hand values, monotonicity,
//      and equality with the Shine segment transmittance at
//      ds = 1; the GLSL twin's formula shape.
//  (d) Fragment builder: off = the stock string byte for byte
//      (sha-pinned); density on = exactly the three splices
//      (uniforms, log + attenuation GLSL, attenuation block),
//      composing with the depth-intersection variant, with
//      the discard tail untouched and the density form minus
//      its insertions equal to its base.
//  (e) Supply wiring: the splat gate covers either consumer,
//      the layer resolution drives the splat, one explicit
//      clear accumulates all layers, and LightVolume binds
//      the shared store while its strength is positive.
//  (f) Existing Shine consumption unchanged: the LightFx
//      fragment builder's legacy form still carries no
//      density code and its density form still declares the
//      density uniforms.
// The real-GPU appearance check (beam dimming through a
// crowd, aux layers visibly folding into the field) is a
// gate-side item, NOT judged here — this file pins the
// string/resolution level.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7d-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Stock volume fragment pin, shared with the Phase B test
// (measured after the verbatim move into lightVolumeShader.ts;
// Phase D must not move a single character of it).
const STOCK_VOLUME_FRAG_SHA256 = 'dc30a3332d83756e3192236fd19449903209b2dd1dbe5ea12d026363b4112c28';

await build({
  stdin: {
    contents: `
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export {
        PARTICLE_DENSITY_LAYERS,
        parseParticleDensityLayers, resolveParticleDensityLayers,
        particleDensityLayerSelected, particleDensityAttenuation,
        PARTICLE_DENSITY_ATTENUATION_GLSL, SHINE_DENSITY_GLSL,
        shineDensityTransmittance,
      } from './lib/particleDensity.ts';
      export {
        clampVolumeDensity, volumeDensityOn,
      } from './lib/lightVolume.ts';
      export { VOLUME_FRAGMENT, buildLightVolumeFragment } from './components/lightVolumeShader.ts';
      export { buildLightFxFragment } from './components/lightFxPass.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    DEFAULT_CONFIG,
    PARTICLE_DENSITY_LAYERS,
    parseParticleDensityLayers, resolveParticleDensityLayers,
    particleDensityLayerSelected, particleDensityAttenuation,
    PARTICLE_DENSITY_ATTENUATION_GLSL, SHINE_DENSITY_GLSL,
    shineDensityTransmittance,
    clampVolumeDensity, volumeDensityOn,
    VOLUME_FRAGMENT, buildLightVolumeFragment,
    buildLightFxFragment,
  } = m;

  // ── (a) Key registration ──
  check('(a) new keys at their defaults (0 / main)',
    DEFAULT_CONFIG.gpgpuLightVolumeDensity === 0
    && DEFAULT_CONFIG.postShineDensityLayers === 'main');
  const fp = JSON.parse(read('scripts/validate-keys.fingerprint.json'));
  const fpKeys = fp.keys ?? fp.fingerprintedKeys ?? [];
  check('(a) both new keys are in the fingerprint record',
    Array.isArray(fpKeys)
    && fpKeys.includes('gpgpuLightVolumeDensity')
    && fpKeys.includes('postShineDensityLayers'),
    `record has ${Array.isArray(fpKeys) ? fpKeys.length : '?'} keys`);

  // ── (b) Layer resolution semantics ──
  check('(b) canonical layer order is main, aux, aux2, aux3',
    JSON.stringify(PARTICLE_DENSITY_LAYERS) === JSON.stringify(['main', 'aux', 'aux2', 'aux3']));
  check('(b) default config resolves to the main layer only',
    JSON.stringify(resolveParticleDensityLayers(DEFAULT_CONFIG)) === JSON.stringify(['main']));
  check('(b) authored order is canonicalised, duplicates deduped',
    JSON.stringify(parseParticleDensityLayers('aux2, aux, aux2')) === JSON.stringify(['aux', 'aux2'])
    && JSON.stringify(parseParticleDensityLayers('aux3 main')) === JSON.stringify(['main', 'aux3']));
  check('(b) unknown tokens drop, known ones survive; case is ignored',
    JSON.stringify(parseParticleDensityLayers('foo, AUX3')) === JSON.stringify(['aux3'])
    && JSON.stringify(parseParticleDensityLayers('MAIN')) === JSON.stringify(['main']));
  check('(b) junk resolves to the main layer (Phase 22 behaviour)',
    JSON.stringify(parseParticleDensityLayers('')) === JSON.stringify(['main'])
    && JSON.stringify(parseParticleDensityLayers('   ')) === JSON.stringify(['main'])
    && JSON.stringify(parseParticleDensityLayers('foo,bar')) === JSON.stringify(['main'])
    && JSON.stringify(parseParticleDensityLayers(undefined)) === JSON.stringify(['main'])
    && JSON.stringify(parseParticleDensityLayers(null)) === JSON.stringify(['main'])
    && JSON.stringify(parseParticleDensityLayers(42)) === JSON.stringify(['main'])
    && JSON.stringify(resolveParticleDensityLayers({})) === JSON.stringify(['main']));
  check('(b) selection helper reads the resolved list',
    particleDensityLayerSelected(['main', 'aux2'], 'aux2') === true
    && particleDensityLayerSelected(['main', 'aux2'], 'aux') === false);

  // ── (c) Attenuation twins ──
  check('(c) clampVolumeDensity edge rules',
    clampVolumeDensity(undefined) === 0
    && clampVolumeDensity(Number.NaN) === 0
    && clampVolumeDensity(-1) === 0
    && clampVolumeDensity(0.5) === 0.5
    && clampVolumeDensity(2) === 1);
  check('(c) variant predicate stands only while the strength is positive',
    volumeDensityOn({}) === false
    && volumeDensityOn({ gpgpuLightVolumeDensity: 0 }) === false
    && volumeDensityOn({ gpgpuLightVolumeDensity: 0.2 }) === true
    && volumeDensityOn(DEFAULT_CONFIG) === false);
  const att = particleDensityAttenuation;
  check('(c) attenuation edge rules: strength or field empty is exactly 1',
    att(0, 5) === 1 && att(-1, 5) === 1 && att(1, 0) === 1 && att(1, -2) === 1);
  check('(c) attenuation hand values (log(1) = 1, gain 3)',
    near(att(1, 1), Math.exp(-3))
    && near(att(0.5, 1), Math.exp(-1.5))
    && near(att(1, 0.125), Math.exp(-3 * (Math.log(2) / Math.log(9)))));
  check('(c) attenuation equals the Shine segment transmittance at ds = 1',
    near(att(0.7, 0.4), shineDensityTransmittance(0.7, 0.4, 1))
    && near(att(1, 2.5), shineDensityTransmittance(1, 2.5, 1))
    && near(att(0.25, 0.01), shineDensityTransmittance(0.25, 0.01, 1)));
  check('(c) attenuation is monotonic in strength and in density',
    att(0.8, 0.5) < att(0.4, 0.5) && att(0.4, 0.5) < att(0.1, 0.5)
    && att(0.6, 0.9) < att(0.6, 0.3) && att(0.6, 0.3) < 1);
  check('(c) GLSL twin carries the same formula shape and edge rules',
    PARTICLE_DENSITY_ATTENUATION_GLSL.includes('float kaloParticleDensityAttenuation(float strength, float rawDensity)')
    && PARTICLE_DENSITY_ATTENUATION_GLSL.includes('if (strength <= 0.0 || rawDensity <= 0.0) return 1.0;')
    && PARTICLE_DENSITY_ATTENUATION_GLSL.includes('exp(-strength * 3.0 * kaloShineDensityLog(rawDensity))'));

  // ── (d) Fragment builder ──
  check('(d) stock fragment keeps its pin',
    sha256(VOLUME_FRAGMENT) === STOCK_VOLUME_FRAG_SHA256,
    `frag ${sha256(VOLUME_FRAGMENT)}`);
  check('(d) builder with both variants off returns the stock string byte for byte',
    buildLightVolumeFragment(false) === VOLUME_FRAGMENT
    && buildLightVolumeFragment(false, false) === VOLUME_FRAGMENT);
  check('(d) Phase B depth-only form is preserved (density default off)',
    buildLightVolumeFragment(true) === buildLightVolumeFragment(true, false)
    && buildLightVolumeFragment(true) !== VOLUME_FRAGMENT);
  const densityOnly = buildLightVolumeFragment(false, true);
  check('(d) density variant declares each density uniform exactly once, no depth code leaks in',
    densityOnly !== VOLUME_FRAGMENT
    && count(densityOnly, 'uniform sampler2D uParticleDensity;') === 1
    && count(densityOnly, 'uniform float uVolumeDensity;') === 1
    && count(densityOnly, 'uniform float uVolumeDensityReady;') === 1
    && count(densityOnly, 'uDepthIntersect') === 0);
  check('(d) density variant splices the log chunk ahead of the attenuation twin and applies it to a',
    densityOnly.includes('float kaloShineDensityLog(float raw)')
    && densityOnly.indexOf('float kaloShineDensityLog(float raw)')
      < densityOnly.indexOf('float kaloParticleDensityAttenuation(float strength, float rawDensity)')
    && densityOnly.includes('a *= kaloParticleDensityAttenuation(uVolumeDensity, pdRaw);')
    && densityOnly.includes('if (uVolumeDensityReady > 0.5 && uVolumeDensity > 0.0) {'));
  const DISCARD = '    if (a <= 0.001) discard;';
  check('(d) density variant tail (discard + output) is the stock tail',
    densityOnly.slice(densityOnly.indexOf(DISCARD))
    === VOLUME_FRAGMENT.slice(VOLUME_FRAGMENT.indexOf(DISCARD)));
  const stripDensity = (variant, base) => {
    let s = variant.replace(
      '  uniform sampler2D uParticleDensity;\n  uniform float uVolumeDensity;\n  uniform float uVolumeDensityReady;\n',
      '',
    );
    s = s.replace(SHINE_DENSITY_GLSL + PARTICLE_DENSITY_ATTENUATION_GLSL, '');
    const start = s.indexOf('    if (uVolumeDensityReady > 0.5');
    const end = s.indexOf(DISCARD);
    if (start < 0 || end < 0 || end <= start) return null;
    return s.slice(0, start) + s.slice(end);
  };
  check('(d) density variant minus its insertions is its base verbatim',
    stripDensity(densityOnly) === VOLUME_FRAGMENT);
  const combined = buildLightVolumeFragment(true, true);
  check('(d) combined variant carries both variant code sets exactly once each',
    combined !== VOLUME_FRAGMENT
    && count(combined, 'uniform float uDepthIntersect;') === 1
    && count(combined, 'uniform sampler2D uParticleDensity;') === 1
    && combined.includes('kaloVolumeDepthIntersectFade(sceneDepth, fragDepth, chordLen, gl_FrontFacing)')
    && combined.includes('a *= kaloParticleDensityAttenuation(uVolumeDensity, pdRaw);')
    && combined.slice(combined.indexOf(DISCARD)) === VOLUME_FRAGMENT.slice(VOLUME_FRAGMENT.indexOf(DISCARD)));
  check('(d) combined variant minus density insertions is the Phase B depth variant',
    stripDensity(combined) === buildLightVolumeFragment(true, false));

  // ── (e) Supply wiring ──
  const systemSrc = read('components/sceneGpgpuSystem.tsx');
  check('(e) splat gate covers either density consumer',
    systemSrc.includes('if (config.postShineDensity > 0 || volumeDensityOn(config)) {'));
  check('(e) splat resolves the authored layers and accumulates with one explicit clear',
    systemSrc.includes('const layers = resolveParticleDensityLayers(config);')
    && systemSrc.includes('glCtx.autoClear = false;')
    && systemSrc.includes('glCtx.clear(true, true, true);')
    && systemSrc.includes('mat.uniforms.uPosTex.value = source.texture;')
    && systemSrc.includes('texture: auxTex,'));
  check('(e) store publication keeps the Phase 22 shape (single texture)',
    systemSrc.includes('setParticleDensitySource({ texture: rt.texture });')
    && read('lib/particleDensity.ts').includes('export interface ParticleDensitySource {\n  texture: THREE.Texture;\n}'));
  const volumeSrc = read('components/LightVolume.tsx');
  check('(e) LightVolume assembles the density variant and binds the shared store per frame',
    volumeSrc.includes('fragmentShader: buildLightVolumeFragment(depthIntersectOn, densityOn),')
    && volumeSrc.includes('const densitySource = densityOn ? getParticleDensitySource() : null;')
    && volumeSrc.includes('u.uVolumeDensityReady.value = 1;')
    && volumeSrc.includes('u.uVolumeDensity.value = densityStrength;'));

  // ── (f) Existing Shine consumption unchanged ──
  check('(f) LightFx legacy fragment still carries no density code',
    !buildLightFxFragment(false).includes('kaloShineDensityLog')
    && !buildLightFxFragment(false).includes('uParticleDensity'));
  check('(f) LightFx density fragment still declares the density uniforms',
    buildLightFxFragment(true).includes('uniform sampler2D uParticleDensity;')
    && buildLightFxFragment(true).includes('kaloShineDensityLog(pd)'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
