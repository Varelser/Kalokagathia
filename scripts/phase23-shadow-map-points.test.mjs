// Phase 23 — true shadow map, wiring stage 2 (§3 design):
// the GPGPU points become a receiver.
//
// What is pinned here (node side):
//   - OFF identity: the default draw strings are byte-identical
//     to the stock exports (and to their pinned hashes), and
//     carry NO shadow-map text at all — the LIGHT_SHADOW_GLSL
//     chunk exists only in the shadowMap builder variant.
//   - ON variant: the vertex splices the chunk, computes
//     kaloShadowFactor(worldPos) into vShadowMapMul, and the
//     fragment unions it with the Phase Z factor via
//     mix(1.0, vShadowMapMul, uShadowMapStrength) ahead of the
//     tail's vShadowMul multiply.
//   - The variant predicate follows the strength's sign only
//     (the same condition that mounts the capture), and the
//     three existing keys keep their defaults (0 / 0.001 / 1)
//     — stage 2 adds no keys.
//   - The TS twin of the union (combineShadowBrightness):
//     strength 0 or a fully lit factor leaves the Phase Z
//     brightness untouched; two half shadows union to 0.25
//     brightness, never darker than either half alone squared
//     away twice.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p23s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

await build({
  stdin: {
    contents: `
      export {
        DRAW_VERT, DRAW_VERT_PHASE19, DRAW_VERT_PHASE20, DRAW_VERT_PHASE23,
        DRAW_FRAG, DRAW_FRAG_PHASE19, DRAW_FRAG_PHASE20, DRAW_FRAG_PHASE23,
        buildDrawVert, buildDrawFrag,
      } from './components/gpgpuShaderPoints.ts';
      export { shadowMapVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { combineShadowBrightness, LIGHT_SHADOW_GLSL } from './lib/lightShadowMap.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  DRAW_VERT, DRAW_VERT_PHASE19, DRAW_VERT_PHASE20, DRAW_VERT_PHASE23,
  DRAW_FRAG, DRAW_FRAG_PHASE19, DRAW_FRAG_PHASE20, DRAW_FRAG_PHASE23,
  buildDrawVert, buildDrawFrag,
  shadowMapVariantOn, combineShadowBrightness, LIGHT_SHADOW_GLSL,
  DEFAULT_CONFIG,
} = M;

// ── OFF identity ──
check('default builder returns the stock strings',
  buildDrawVert() === DRAW_VERT && buildDrawFrag() === DRAW_FRAG);
check('empty / false options return the stock strings',
  buildDrawVert({}) === DRAW_VERT && buildDrawFrag({}) === DRAW_FRAG
  && buildDrawVert({ shadowMap: false }) === DRAW_VERT
  && buildDrawFrag({ shadowMap: false }) === DRAW_FRAG);
check('stock vertex hash pin (v2.00 identity)',
  sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529', sha256(DRAW_VERT));
check('stock fragment hash pin',
  sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c', sha256(DRAW_FRAG));
check('stock strings carry no shadow-map text',
  !DRAW_VERT.includes('kaloShadowFactor') && !DRAW_VERT.includes('uShadowMapTex')
  && !DRAW_VERT.includes('vShadowMapMul')
  && !DRAW_FRAG.includes('vShadowMapMul') && !DRAW_FRAG.includes('uShadowMapStrength'));
check('earlier variants carry no shadow-map text either',
  !DRAW_VERT_PHASE19.includes('kaloShadowFactor') && !DRAW_VERT_PHASE20.includes('kaloShadowFactor')
  && !DRAW_FRAG_PHASE19.includes('vShadowMapMul') && !DRAW_FRAG_PHASE20.includes('vShadowMapMul'));

// ── ON variant ──
check('phase23 exports equal the builder outputs',
  buildDrawVert({ shadowMap: true }) === DRAW_VERT_PHASE23
  && buildDrawFrag({ shadowMap: true }) === DRAW_FRAG_PHASE23);
check('phase23 vertex hash pin',
  sha256(DRAW_VERT_PHASE23) === '3a4e56842e2f0e9f1c9b8afdd26a0b7317f63540109ccad72e8ae8d22fc44980', sha256(DRAW_VERT_PHASE23));
check('phase23 fragment hash pin',
  sha256(DRAW_FRAG_PHASE23) === '3f4c070f6523678ca063b896d98f53f853f8e79287d38aff59f698b880b97729', sha256(DRAW_FRAG_PHASE23));
check('vertex splices the whole light-shadow chunk',
  DRAW_VERT_PHASE23.includes(LIGHT_SHADOW_GLSL)
  && DRAW_VERT_PHASE23.includes('uniform sampler2D uShadowMapTex;')
  && DRAW_VERT_PHASE23.includes('uniform mat4 uLightViewProj;')
  && DRAW_VERT_PHASE23.includes('float kaloShadowFactor(vec3 worldPos)'));
check('vertex computes the factor into the varying',
  DRAW_VERT_PHASE23.includes('varying float vShadowMapMul;')
  && DRAW_VERT_PHASE23.includes('vShadowMapMul = kaloShadowFactor(worldPos);'));
check('fragment declares the varying + strength and applies the union half',
  DRAW_FRAG_PHASE23.includes('varying float vShadowMapMul;')
  && DRAW_FRAG_PHASE23.includes('uniform float uShadowMapStrength;')
  && DRAW_FRAG_PHASE23.includes('col *= mix(1.0, vShadowMapMul, uShadowMapStrength);'));
check('shadow-map apply sits ahead of the tail vShadowMul multiply',
  DRAW_FRAG_PHASE23.indexOf('col *= mix(1.0, vShadowMapMul, uShadowMapStrength);')
    < DRAW_FRAG_PHASE23.indexOf('col *= vShadowMul;'));
check('phase23 variant differs from stock and from phase20',
  DRAW_VERT_PHASE23 !== DRAW_VERT && DRAW_FRAG_PHASE23 !== DRAW_FRAG
  && DRAW_VERT_PHASE23 !== DRAW_VERT_PHASE20 && DRAW_FRAG_PHASE23 !== DRAW_FRAG_PHASE20);
check('combined variant keeps all three splices',
  buildDrawVert({ vellumCrack: true, clusterColor: true, shadowMap: true }).includes('kaloShadowFactor')
  && buildDrawVert({ vellumCrack: true, clusterColor: true, shadowMap: true }).includes('uClusterColorLutTex')
  && buildDrawFrag({ vellumCrack: true, clusterColor: true, shadowMap: true }).includes('vShadowMapMul'));

// ── Predicate + key defaults (no new keys in stage 2) ──
check('variant predicate follows the strength sign',
  shadowMapVariantOn({ gpgpuShadowMapStrength: 0 }) === false
  && shadowMapVariantOn({ gpgpuShadowMapStrength: 0.01 }) === true
  && shadowMapVariantOn({ gpgpuShadowMapStrength: 1 }) === true
  && shadowMapVariantOn({}) === false);
check('shadow-map key defaults are unchanged',
  DEFAULT_CONFIG.gpgpuShadowMapStrength === 0
  && DEFAULT_CONFIG.gpgpuShadowMapBias === 0.001
  && DEFAULT_CONFIG.gpgpuShadowMapSoftness === 1);

// ── Union twin ──
check('union: fully lit stays fully lit', near(combineShadowBrightness(1, 1, 1), 1));
check('union: strength 0 leaves the Phase Z brightness untouched',
  near(combineShadowBrightness(0.5, 0, 0), 0.5) && near(combineShadowBrightness(0.25, 0.3, 0), 0.25));
check('union: a lit shadow-map factor leaves the Phase Z brightness untouched',
  near(combineShadowBrightness(0.5, 1, 1), 0.5));
check('union: two half shadows give quarter brightness',
  near(combineShadowBrightness(0.5, 0.5, 1), 0.25));
check('union: a full shadow-map shadow blacks out at strength 1',
  near(combineShadowBrightness(0.8, 0, 1), 0));
check('union: half strength halves the shadow-map amount',
  near(combineShadowBrightness(1, 0, 0.5), 0.5));
check('union: strength is clamped to [0, 1]',
  near(combineShadowBrightness(1, 0, 2), 0) && near(combineShadowBrightness(0.5, 0, -1), 0.5));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
