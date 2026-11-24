// Phase 24 — true shadow map, wiring stage 3, slice 1:
// the GEOM instanced draw becomes a receiver.
//
// What is pinned here (node side):
//   - OFF identity: the default GEOM strings are byte-identical
//     to the stock exports (and to their pinned hashes), and
//     carry NO shadow-map text at all — the LIGHT_SHADOW_GLSL
//     chunk exists only in the shadowMap builder variant.
//   - ON variant: the vertex splices the chunk, computes
//     kaloShadowFactor(vWorldPos) into vShadowMapMul, and the
//     fragment applies mix(1.0, vShadowMapMul,
//     uShadowMapStrength). The GEOM fragment carries no Phase
//     Z term of its own, so the union of stage 2 reduces to
//     this mix alone — its TS twin is
//     combineShadowBrightness(1.0, f, s).
//   - The string variant rides the mesh-assets swap path: the
//     empty-snippet builders return the variant base unchanged,
//     and the predicate follows the strength's sign only (the
//     same condition that mounts the capture). The three
//     existing keys keep their defaults (0 / 0.001 / 1) —
//     stage 3 adds no keys.
//   - The geom material carries the same six shadow-map
//     uniform entries with the same inert defaults as the
//     points draw, and the per-frame sync writes them under
//     the same guard (source-text pins on the two TS files,
//     the node-side stand-in for the hook's useMemo).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p24s3-bundle-${process.pid}.mjs`);
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
        GEOM_VERT, GEOM_VERT_PHASE19, GEOM_VERT_PHASE24,
        GEOM_FRAG, GEOM_FRAG_PHASE19, GEOM_FRAG_PHASE24,
        buildGeomVertShader, buildGeomFragShader,
        buildGeomVert, buildGeomFrag,
      } from './components/gpgpuShaderVolumes.ts';
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
  GEOM_VERT, GEOM_VERT_PHASE19, GEOM_VERT_PHASE24,
  GEOM_FRAG, GEOM_FRAG_PHASE19, GEOM_FRAG_PHASE24,
  buildGeomVertShader, buildGeomFragShader,
  buildGeomVert, buildGeomFrag,
  shadowMapVariantOn, combineShadowBrightness, LIGHT_SHADOW_GLSL,
  DEFAULT_CONFIG,
} = M;

// ── OFF identity ──
check('default builder returns the stock strings',
  buildGeomVertShader() === GEOM_VERT && buildGeomFragShader() === GEOM_FRAG);
check('empty / false options return the stock strings',
  buildGeomVertShader({}) === GEOM_VERT && buildGeomFragShader({}) === GEOM_FRAG
  && buildGeomVertShader({ shadowMap: false }) === GEOM_VERT
  && buildGeomFragShader({ shadowMap: false }) === GEOM_FRAG);
check('empty-snippet builders return the stock strings',
  buildGeomVert('') === GEOM_VERT && buildGeomFrag('') === GEOM_FRAG);
check('stock vertex hash pin (v2.00 identity)',
  sha256(GEOM_VERT) === '3123bc1869559b312371f2c821248d7fa836410ee6a2b11ce16c10b3ecc669fe', sha256(GEOM_VERT));
check('stock fragment hash pin',
  sha256(GEOM_FRAG) === 'd7a45aa4346ebb72c14a67de5fbf7c7304f76acdf3661c084b3e4bc09806acc3', sha256(GEOM_FRAG));
check('phase19 variant hash pins unchanged',
  sha256(GEOM_VERT_PHASE19) === '5c272b4bd47a96a7787d7ea0089f7b28a62564e3d36f21a11e44ed7cc78a1465'
  && sha256(GEOM_FRAG_PHASE19) === 'ca46925597bf7cc39135c1131437ee01d0572d8bcc9fb3959a575224632efe65');
check('stock strings carry no shadow-map text',
  !GEOM_VERT.includes('kaloShadowFactor') && !GEOM_VERT.includes('uShadowMapTex')
  && !GEOM_VERT.includes('vShadowMapMul')
  && !GEOM_FRAG.includes('vShadowMapMul') && !GEOM_FRAG.includes('uShadowMapStrength'));
check('phase19 variants carry no shadow-map text either',
  !GEOM_VERT_PHASE19.includes('kaloShadowFactor') && !GEOM_FRAG_PHASE19.includes('vShadowMapMul'));

// ── ON variant ──
check('phase24 exports equal the builder outputs',
  buildGeomVertShader({ shadowMap: true }) === GEOM_VERT_PHASE24
  && buildGeomFragShader({ shadowMap: true }) === GEOM_FRAG_PHASE24);
check('empty-snippet builders return the phase24 variant base',
  buildGeomVert('', { shadowMap: true }) === GEOM_VERT_PHASE24
  && buildGeomFrag('', { shadowMap: true }) === GEOM_FRAG_PHASE24);
check('phase24 vertex hash pin',
  sha256(GEOM_VERT_PHASE24) === 'd8ff894d34eefe3b487394496c2f690be7847f88df8708657e1837377ad4b6c5', sha256(GEOM_VERT_PHASE24));
check('phase24 fragment hash pin',
  sha256(GEOM_FRAG_PHASE24) === '875a9c0f6af757864d0f950eeefd2246eea2bd18c16ba34135972f180d684d43', sha256(GEOM_FRAG_PHASE24));
check('vertex splices the whole light-shadow chunk',
  GEOM_VERT_PHASE24.includes(LIGHT_SHADOW_GLSL)
  && GEOM_VERT_PHASE24.includes('uniform sampler2D uShadowMapTex;')
  && GEOM_VERT_PHASE24.includes('uniform mat4 uLightViewProj;')
  && GEOM_VERT_PHASE24.includes('float kaloShadowFactor(vec3 worldPos)'));
check('vertex computes the factor into the varying',
  GEOM_VERT_PHASE24.includes('varying float vShadowMapMul;')
  && GEOM_VERT_PHASE24.includes('vShadowMapMul = kaloShadowFactor(vWorldPos);'));
check('factor is computed after vWorldPos is assigned',
  GEOM_VERT_PHASE24.indexOf('vWorldPos = instancePos + local;')
    < GEOM_VERT_PHASE24.indexOf('vShadowMapMul = kaloShadowFactor(vWorldPos);'));
check('fragment declares the varying + strength and applies the mix',
  GEOM_FRAG_PHASE24.includes('varying float vShadowMapMul;')
  && GEOM_FRAG_PHASE24.includes('uniform float uShadowMapStrength;')
  && GEOM_FRAG_PHASE24.includes('col *= mix(1.0, vShadowMapMul, uShadowMapStrength);'));
check('shadow-map apply sits ahead of the final colour write',
  GEOM_FRAG_PHASE24.indexOf('col *= mix(1.0, vShadowMapMul, uShadowMapStrength);')
    < GEOM_FRAG_PHASE24.indexOf('gl_FragColor = vec4(col, uOpacity * vDensityMul);'));
check('phase24 variant differs from stock and from phase19',
  GEOM_VERT_PHASE24 !== GEOM_VERT && GEOM_FRAG_PHASE24 !== GEOM_FRAG
  && GEOM_VERT_PHASE24 !== GEOM_VERT_PHASE19 && GEOM_FRAG_PHASE24 !== GEOM_FRAG_PHASE19);
check('combined variant keeps both splices',
  buildGeomVertShader({ vellumCrack: true, shadowMap: true }).includes('kaloShadowFactor')
  && buildGeomVertShader({ vellumCrack: true, shadowMap: true }).includes('uVellumStateTex')
  && buildGeomFragShader({ vellumCrack: true, shadowMap: true }).includes('vShadowMapMul')
  && buildGeomFragShader({ vellumCrack: true, shadowMap: true }).includes('col *= 1.0 - 0.45 * vCrack;'));

// ── Predicate + key defaults (no new keys in stage 3) ──
check('variant predicate follows the strength sign',
  shadowMapVariantOn({ gpgpuShadowMapStrength: 0 }) === false
  && shadowMapVariantOn({ gpgpuShadowMapStrength: 0.01 }) === true
  && shadowMapVariantOn({ gpgpuShadowMapStrength: 1 }) === true
  && shadowMapVariantOn({}) === false);
check('shadow-map key defaults are unchanged',
  DEFAULT_CONFIG.gpgpuShadowMapStrength === 0
  && DEFAULT_CONFIG.gpgpuShadowMapBias === 0.001
  && DEFAULT_CONFIG.gpgpuShadowMapSoftness === 1);

// ── Union twin, GEOM form (no Phase Z term: zBrightness = 1) ──
{
  let gridOk = true;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    for (const s of [0, 0.5, 1]) {
      if (!near(combineShadowBrightness(1, f, s), 1 + (f - 1) * s)) gridOk = false;
    }
  }
  check('union with Z brightness 1 reduces to the strength mix', gridOk);
}
check('union: fully lit stays fully lit', near(combineShadowBrightness(1, 1, 1), 1));
check('union: a full shadow-map shadow blacks out at strength 1',
  near(combineShadowBrightness(1, 0, 1), 0));
check('union: half strength halves the shadow-map amount',
  near(combineShadowBrightness(1, 0, 0.5), 0.5));
check('union: two half shadows give quarter brightness',
  near(combineShadowBrightness(0.5, 0.5, 1), 0.25));

// ── Material uniforms + per-frame sync (source-text pins) ──
const meshAssetsSrc = readFileSync(join(ROOT, 'components', 'useGpgpuMeshAssets.ts'), 'utf8');
check('geom material carries the six shadow-map uniform entries',
  meshAssetsSrc.includes('uShadowMapTex:      { value: null }')
  && meshAssetsSrc.includes('uLightViewProj:     { value: new THREE.Matrix4() }')
  && meshAssetsSrc.includes('uShadowMapBias:     { value: 0.001 }')
  && meshAssetsSrc.includes('uShadowMapSoftness: { value: 1 }')
  && meshAssetsSrc.includes('uShadowMapReady:    { value: 0 }')
  && meshAssetsSrc.includes('uShadowMapStrength: { value: 0 }'));
check('mesh-assets swap path evaluates the shadow-map predicate',
  meshAssetsSrc.includes('shadowMapVariantOn(config)')
  && meshAssetsSrc.includes('shadowMap: smap')
  && meshAssetsSrc.includes('config.gpgpuShadowMapStrength, gl]'));
const visualUpdatesSrc = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
check('per-frame sync writes the geom shadow uniforms under the guard',
  visualUpdatesSrc.includes('if (geomMat.uniforms.uShadowMapTex) {')
  && visualUpdatesSrc.includes('geomMat.uniforms.uShadowMapTex.value = smapSource.texture;')
  && visualUpdatesSrc.includes('geomMat.uniforms.uShadowMapReady.value = 1;')
  && visualUpdatesSrc.includes('geomMat.uniforms.uShadowMapReady.value = 0;')
  && visualUpdatesSrc.includes('geomMat.uniforms.uShadowMapStrength.value = Math.min(1, Math.max(0, config.gpgpuShadowMapStrength));'));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
