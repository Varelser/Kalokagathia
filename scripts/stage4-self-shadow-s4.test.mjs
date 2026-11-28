// Limit plan stage 4, slice S4 — particle self-shadowing:
// the main pool casts into the true shadow map. Design:
// kalokagathia-pro/STAGE4_DESIGN_MATERIALS.md §3.1 (案A) and
// §0 (自己影は影源の差し替えで新規 sampler を作らない),
// STAGE4_PREP_INVENTORY.md §3.2 / §3.3.
//
// What is pinned here (node side):
//  (a) OFF identity: the two new keys default to
//      gpgpuShadowMapCastParticles=false /
//      gpgpuShadowMapParticleSize=1, the predicate is false
//      at the defaults, and every pre-existing string this
//      slice could have touched is byte-identical to its
//      pre-slice hash — the receiver chunk LIGHT_SHADOW_GLSL,
//      the stock points draw strings and the stock GEOM
//      strings. Source pins additionally hold the capture's
//      default discipline: the caster collection and the
//      caster pass both sit behind the predicate, and the
//      marked geometry meshes are hidden only inside that
//      same branch.
//  (b) ON wiring: the capture collects the userData-marked
//      points / geometry objects, runs a caster pass into the
//      same target with clearing off, the geometry stand-ins
//      share the marked meshes' geometries, the points
//      stand-in shares the draw geometry, and both caster
//      materials read the live uniforms off the marked
//      objects' materials. The marking sites themselves are
//      pinned (mesh assets + render outputs).
//  (c) ParticleSize resolution: clamp [0.1, 8], non-finite /
//      non-number resolves to 1; the diameter and pixel-size
//      twins follow their formulas (world unit =
//      bounceRadius * 0.02, ortho px = diameter * 2048 /
//      (2 * extent)).
//  (d) Sampler budget: the receiver chunk still declares
//      exactly one sampler, the stock points draw strings
//      keep their pre-slice sampler counts, the GEOM stock
//      strings gain none, and each caster program declares
//      exactly its one uPosTex (caster-side programs, not
//      receivers — the receiver budget is untouched).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4s4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const samplerCount = (s) => (s.match(/uniform\s+sampler2D/g) || []).length;

await build({
  stdin: {
    contents: `
      export {
        LIGHT_SHADOW_GLSL, SHADOW_MAP_SIZE,
        SHADOW_CASTER_POINTS_USERDATA, SHADOW_CASTER_GEOM_USERDATA,
        SHADOW_CASTER_POINTS_VERT, SHADOW_CASTER_POINTS_FRAG,
        SHADOW_CASTER_GEOM_VERT, SHADOW_CASTER_GEOM_FRAG,
        shadowCastParticlesOn, resolveShadowMapParticleSize,
        shadowCasterPointDiameterWorld, shadowCasterPointSizePx,
      } from './lib/lightShadowMap.ts';
      export { DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { GEOM_VERT, GEOM_FRAG } from './components/gpgpuShaderVolumes.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  LIGHT_SHADOW_GLSL, SHADOW_MAP_SIZE,
  SHADOW_CASTER_POINTS_USERDATA, SHADOW_CASTER_GEOM_USERDATA,
  SHADOW_CASTER_POINTS_VERT, SHADOW_CASTER_POINTS_FRAG,
  SHADOW_CASTER_GEOM_VERT, SHADOW_CASTER_GEOM_FRAG,
  shadowCastParticlesOn, resolveShadowMapParticleSize,
  shadowCasterPointDiameterWorld, shadowCasterPointSizePx,
  DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag,
  GEOM_VERT, GEOM_FRAG, DEFAULT_CONFIG,
} = M;

const captureSrc = readFileSync(join(ROOT, 'components/LightShadowCapture.tsx'), 'utf8');
const meshAssetsSrc = readFileSync(join(ROOT, 'components/useGpgpuMeshAssets.ts'), 'utf8');
const renderOutputsSrc = readFileSync(join(ROOT, 'components/gpgpuRenderOutputs.tsx'), 'utf8');

// ── (a) OFF identity ──
check('(a) new keys default to false / 1',
  DEFAULT_CONFIG.gpgpuShadowMapCastParticles === false
  && DEFAULT_CONFIG.gpgpuShadowMapParticleSize === 1);
check('(a) predicate is false at the defaults and for non-true values',
  shadowCastParticlesOn(DEFAULT_CONFIG) === false
  && shadowCastParticlesOn({}) === false
  && shadowCastParticlesOn({ gpgpuShadowMapCastParticles: 1 }) === false
  && shadowCastParticlesOn({ gpgpuShadowMapCastParticles: 'true' }) === false);
check('(a) predicate is true only for literal true',
  shadowCastParticlesOn({ gpgpuShadowMapCastParticles: true }) === true);
check('(a) receiver chunk byte-identical to the pre-slice pin',
  sha256(LIGHT_SHADOW_GLSL) === '9c360940c43835bf96ca8883d887d199270df54796d49ae2539b15d210323695',
  sha256(LIGHT_SHADOW_GLSL));
check('(a) stock points draw strings byte-identical to the pre-slice pins',
  sha256(buildDrawVert()) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529'
  && sha256(buildDrawFrag()) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c'
  && buildDrawVert() === DRAW_VERT && buildDrawFrag() === DRAW_FRAG);
check('(a) stock GEOM strings byte-identical to the pre-slice pins',
  sha256(GEOM_VERT) === '3123bc1869559b312371f2c821248d7fa836410ee6a2b11ce16c10b3ecc669fe'
  && sha256(GEOM_FRAG) === 'd7a45aa4346ebb72c14a67de5fbf7c7304f76acdf3661c084b3e4bc09806acc3');
check('(a) capture reads the predicate from the config (single source)',
  captureSrc.includes('const castOn = shadowCastParticlesOn(config);'));
check('(a) caster collection sits inside the castOn branch only',
  captureSrc.includes('if (castOn) {')
  && captureSrc.indexOf('SHADOW_CASTER_POINTS_USERDATA])') > captureSrc.indexOf('if (castOn) {')
  && captureSrc.indexOf('runCasterPass(casterPointsObj') > captureSrc.indexOf('if (castOn) {'));
check('(a) caster pass invocation is gated by castOn',
  /if \(castOn\) \{\s*runCasterPass\(/.test(captureSrc));
check('(a) the stage-1 hiding pass is unchanged above the caster branch',
  captureSrc.includes('if ((anyObj.isPoints || anyObj.isLine || anyObj.isSprite) && obj.visible) {'));

// ── (b) ON wiring ──
check('(b) capture collects marked points and geometry objects',
  captureSrc.includes('obj.userData[SHADOW_CASTER_POINTS_USERDATA]')
  && captureSrc.includes('obj.userData[SHADOW_CASTER_GEOM_USERDATA]')
  && captureSrc.includes('casterGeomObjs.push(obj)'));
check('(b) marked geometry meshes are hidden during the scene pass while casting',
  captureSrc.includes('casterGeomObjs.push(obj);')
  && captureSrc.indexOf('hidden.push(obj);', captureSrc.indexOf('casterGeomObjs.push(obj);')) > captureSrc.indexOf('casterGeomObjs.push(obj);'));
check('(b) caster pass renders into the same target with clearing off',
  captureSrc.includes('gl.autoClear = false;')
  && captureSrc.includes('gl.render(casterScene, cam);')
  && captureSrc.includes('gl.setRenderTarget(rt);'));
check('(b) caster pass skips when nothing is ready',
  captureSrc.includes('if (casterScene.children.length === 0) return;'));
check('(b) points stand-in shares the marked points geometry',
  captureSrc.includes('const geo = (pointsObj as THREE.Points).geometry;')
  && captureSrc.includes('new THREE.Points(geo, casterPointsMatRef.current)'));
check('(b) geometry stand-ins share the marked meshes geometries',
  captureSrc.includes('const geo = (src as THREE.Mesh).geometry;')
  && captureSrc.includes('new THREE.Mesh(geo, casterGeomMatRef.current)'));
check('(b) caster materials read live uniforms off the marked materials',
  captureSrc.includes('uniforms?.uPosTex?.value')
  && captureSrc.includes('uniforms?.uGeomScale?.value'));
check('(b) points pixel size comes from the CPU twins',
  captureSrc.includes('shadowCasterPointDiameterWorld(')
  && captureSrc.includes('shadowCasterPointSizePx(diameter, extent)'));
check('(b) mesh assets mark the single and species geometry meshes',
  (meshAssetsSrc.match(/userData\[SHADOW_CASTER_GEOM_USERDATA\] = true/g) || []).length === 2);
check('(b) render outputs mark the main points object',
  renderOutputsSrc.includes('obj.userData[SHADOW_CASTER_POINTS_USERDATA] = true'));
check('(b) marker constants are the shared keys',
  SHADOW_CASTER_POINTS_USERDATA === 'kaloShadowCasterPoints'
  && SHADOW_CASTER_GEOM_USERDATA === 'kaloShadowCasterGeom');
check('(b) caster shaders are wired into the capture materials',
  captureSrc.includes('vertexShader: SHADOW_CASTER_POINTS_VERT')
  && captureSrc.includes('fragmentShader: SHADOW_CASTER_POINTS_FRAG')
  && captureSrc.includes('vertexShader: SHADOW_CASTER_GEOM_VERT')
  && captureSrc.includes('fragmentShader: SHADOW_CASTER_GEOM_FRAG'));

// ── (c) ParticleSize resolution + formulas ──
check('(c) resolve clamps to [0.1, 8]',
  resolveShadowMapParticleSize(0.1) === 0.1
  && resolveShadowMapParticleSize(8) === 8
  && resolveShadowMapParticleSize(0.01) === 0.1
  && resolveShadowMapParticleSize(100) === 8
  && resolveShadowMapParticleSize(2.5) === 2.5
  && resolveShadowMapParticleSize(-3) === 0.1);
check('(c) resolve falls back to 1 for non-finite / non-number',
  resolveShadowMapParticleSize(undefined) === 1
  && resolveShadowMapParticleSize(null) === 1
  && resolveShadowMapParticleSize(NaN) === 1
  && resolveShadowMapParticleSize(Infinity) === 1
  && resolveShadowMapParticleSize('2') === 1);
check('(c) diameter = size * bounceRadius * 0.02 * resolved multiplier',
  near(shadowCasterPointDiameterWorld(1.5, 100, 1), 3)
  && near(shadowCasterPointDiameterWorld(1.5, 100, 2), 6)
  && near(shadowCasterPointDiameterWorld(2, 50, 0.5), 1)
  && near(shadowCasterPointDiameterWorld(1.5, 100, 100), 24));
check('(c) diameter is 0 for non-positive size / radius',
  shadowCasterPointDiameterWorld(0, 100, 1) === 0
  && shadowCasterPointDiameterWorld(1.5, 0, 1) === 0
  && shadowCasterPointDiameterWorld(-1, 100, 1) === 0);
check('(c) pixel size = diameter * SHADOW_MAP_SIZE / (2 * extent)',
  SHADOW_MAP_SIZE === 2048
  && near(shadowCasterPointSizePx(3, 125), 3 * 2048 / 250)
  && near(shadowCasterPointSizePx(10, 50), 204.8));
check('(c) pixel size is 0 for non-positive diameter / extent',
  shadowCasterPointSizePx(0, 125) === 0
  && shadowCasterPointSizePx(3, 0) === 0);

// ── (d) Sampler budget ──
check('(d) receiver chunk still declares exactly one sampler',
  samplerCount(LIGHT_SHADOW_GLSL) === 1);
check('(d) stock points draw sampler counts unchanged (vert 8 / frag 5)',
  samplerCount(DRAW_VERT) === 8 && samplerCount(DRAW_FRAG) === 5,
  `${samplerCount(DRAW_VERT)}/${samplerCount(DRAW_FRAG)}`);
check('(d) stock GEOM strings carry no receiver chunk (variant-only)',
  !GEOM_VERT.includes('kaloShadowFactor') && !GEOM_FRAG.includes('kaloShadowFactor'));
check('(d) each caster program declares exactly its one uPosTex',
  samplerCount(SHADOW_CASTER_POINTS_VERT) === 1
  && samplerCount(SHADOW_CASTER_GEOM_VERT) === 1
  && samplerCount(SHADOW_CASTER_POINTS_FRAG) === 0
  && samplerCount(SHADOW_CASTER_GEOM_FRAG) === 0
  && SHADOW_CASTER_POINTS_VERT.includes('uniform sampler2D uPosTex;')
  && SHADOW_CASTER_GEOM_VERT.includes('uniform sampler2D uPosTex;'));
check('(d) points caster discards outside the disc (no square stamps)',
  SHADOW_CASTER_POINTS_FRAG.includes('gl_PointCoord')
  && SHADOW_CASTER_POINTS_FRAG.includes('discard'));
check('(d) geometry caster expands instances from uPosTex at uGeomScale',
  SHADOW_CASTER_GEOM_VERT.includes('texture2D(uPosTex, aTexCoord)')
  && SHADOW_CASTER_GEOM_VERT.includes('position * uGeomScale'));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
