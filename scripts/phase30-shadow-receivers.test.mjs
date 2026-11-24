// Phase 30 — shadow-map wiring stage 3 remainder: the Aux,
// Volumetric and Layer receivers.
//
// Pins:
//   - the builder-ized Aux / Volumetric stock strings are the
//     builders with no options (byte-identical), and the
//     shadow variants add exactly the chunk + varying +
//     compute / write blocks.
//   - the layer point builders keep stock / IBL outputs at
//     shadowMap=false, and the shadow variant composes with
//     both bases (anchors present, factor multiplied before
//     both fragment seams).
//   - materials carry the shadow uniform entries, the variant
//     swap effects exist, and the per-frame syncs write from
//     the shared store with the guarded pattern.
import { readFileSync, unlinkSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p30-bundle-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export { AUX_DRAW_FRAG, AUX_DRAW_VERT, buildAuxDrawFrag, buildAuxDrawVert } from './components/gpgpuShaderAux.ts';
      export { VOLUMETRIC_FRAG, VOLUMETRIC_VERT, buildVolumetricFrag, buildVolumetricVert } from './components/gpgpuShaderVolumes.ts';
      export { buildParticleVertexShader, buildParticleVertexIblVariant } from './components/sceneShaderParticlePointVertex.ts';
      export { buildParticleFragmentShader, buildParticleFragmentIblVariant } from './components/sceneShaderParticlePointFragment.ts';
      export { LIGHT_SHADOW_GLSL } from './lib/lightShadowMap.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { '__LIBRARY_SCOPE__': '"private"' },
});
const {
  AUX_DRAW_FRAG, AUX_DRAW_VERT, buildAuxDrawFrag, buildAuxDrawVert,
  VOLUMETRIC_FRAG, VOLUMETRIC_VERT, buildVolumetricFrag, buildVolumetricVert,
  buildParticleVertexShader, buildParticleVertexIblVariant,
  buildParticleFragmentShader, buildParticleFragmentIblVariant,
  LIGHT_SHADOW_GLSL,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── Aux ──
check('aux vert stock = builder()', buildAuxDrawVert() === AUX_DRAW_VERT);
check('aux frag stock = builder()', buildAuxDrawFrag() === AUX_DRAW_FRAG);
const av = buildAuxDrawVert({ shadowMap: true });
check('aux vert variant has chunk + varying + compute',
  av.includes(LIGHT_SHADOW_GLSL) && av.includes('varying float vShadowMapMul;')
  && av.includes('vShadowMapMul = kaloShadowFactor(worldPos);'));
check('aux vert variant compute sits after worldPos is set',
  av.indexOf('vec3 worldPos = isActive') < av.indexOf('vShadowMapMul = kaloShadowFactor'));
const af = buildAuxDrawFrag({ shadowMap: true });
check('aux frag variant multiplies the colour by the factor',
  af.includes('uniform float uShadowMapStrength;')
  && af.includes('uColor * mix(1.0, vShadowMapMul, uShadowMapStrength)'));
check('aux stock has no shadow text', !AUX_DRAW_VERT.includes('ShadowMap') && !AUX_DRAW_FRAG.includes('ShadowMap'));

// ── Volumetric ──
check('vol vert stock = builder()', buildVolumetricVert() === VOLUMETRIC_VERT);
check('vol frag stock = builder()', buildVolumetricFrag() === VOLUMETRIC_FRAG);
const vv = buildVolumetricVert({ shadowMap: true });
check('vol vert variant samples at the centre',
  vv.includes(LIGHT_SHADOW_GLSL) && vv.includes('vShadowMapMul = kaloShadowFactor(center);'));
check('vol vert variant compute sits after the centre is final',
  vv.indexOf('vWorldCenter = center;') < vv.indexOf('vShadowMapMul = kaloShadowFactor'));
const vf = buildVolumetricFrag({ shadowMap: true });
check('vol frag variant scales the colour',
  vf.includes('uColor * mix(1.0, vShadowMapMul, uShadowMapStrength)'));
check('vol stock has no shadow factor', !VOLUMETRIC_FRAG.includes('vShadowMapMul'));

// ── Layer points ──
check('layer vert stock at shadow=false', buildParticleVertexShader('', false, false) === buildParticleVertexShader(''));
check('layer vert ibl at shadow=false', buildParticleVertexShader('', true, false) === buildParticleVertexIblVariant());
const lv = buildParticleVertexShader('', false, true);
check('layer vert shadow variant has chunk + compute at final pos',
  lv.includes(LIGHT_SHADOW_GLSL) && lv.includes('vShadowMapMul = kaloShadowFactor((modelMatrix * vec4(pos, 1.0)).xyz);'));
const lvIbl = buildParticleVertexShader('', true, true);
check('layer vert shadow composes with ibl',
  lvIbl.includes('vWorldPosIbl') && lvIbl.includes('vShadowMapMul = kaloShadowFactor'));
check('layer frag stock at shadow=false', buildParticleFragmentShader('', false, false) === buildParticleFragmentShader(''));
check('layer frag ibl at shadow=false', buildParticleFragmentShader('', true, false) === buildParticleFragmentIblVariant());
const lf = buildParticleFragmentShader('', false, true);
const mulCount = (lf.match(/finalColor \*= mix\(1\.0, vShadowMapMul, uShadowMapStrength\);/g) || []).length;
check('layer frag shadow multiplies before both seams', mulCount === 2);
check('layer frag shadow declares uniform + varying',
  lf.includes('uniform float uShadowMapStrength;') && lf.includes('varying float vShadowMapMul;'));
const lfIbl = buildParticleFragmentShader('', true, true);
check('layer frag shadow composes with ibl',
  lfIbl.includes('uIblMap') && (lfIbl.match(/finalColor \*= mix\(1\.0, vShadowMapMul/g) || []).length === 2);

// ── Wiring ──
const drawAssets = read('components/useGpgpuDrawAssets.ts');
check('aux materials carry the shadow uniforms + variant swap',
  (drawAssets.match(/uShadowMapTex: \{ value: null \}/g) || []).length >= 3
  && drawAssets.includes('auxVariantRef'));
const meshAssets = read('components/useGpgpuMeshAssets.ts');
check('volumetric material carries the shadow uniforms + variant swap',
  meshAssets.includes('uShadowMapTex: { value: null }') && meshAssets.includes('volumetricVariantRef'));
const visual = read('components/gpgpuVisualUpdates.ts');
check('volumetric sync block writes from the shared store',
  visual.includes('volumetricMat.uniforms.uShadowMapTex'));
const scene = read('components/sceneGpgpuSystem.tsx');
check('aux sync helper is called for all three levels',
  (scene.match(/syncAuxShadowMapUniforms\(aux/g) || []).length === 3);
const uniforms = read('components/sceneParticleSystemUniforms.ts');
check('layer uniforms dict carries the shadow entries',
  uniforms.includes('uShadowMapTex: { value: null as THREE.Texture | null }'));
const fx = read('components/sceneParticleSystemRuntimeFx.ts');
check('layer fx sync writes from the shared store',
  fx.includes('getLightShadowSource()') && fx.includes('mat.uniforms.uShadowMapStrength'));
const sys = read('components/sceneParticleSystem.tsx');
check('layer shader effects thread shadowActive',
  sys.includes('const shadowActive = (config.gpgpuShadowMapStrength ?? 0) > 0;')
  && sys.includes('buildParticleVertexShader(code, iblActive, shadowActive)')
  && sys.includes('buildParticleFragmentShader(code, iblActive, shadowActive)'));

console.log(`\nphase30-shadow-receivers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
