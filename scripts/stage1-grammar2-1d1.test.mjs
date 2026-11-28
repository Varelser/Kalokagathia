// Grammar 2.0 stage 1, slice 1D-1 — spawn inheritance
// foundation: the per-level inheritance texture, the Aux
// shader bindings, the spawn-time write, the chain copy
// propagation, the colour mix, the new keys, and the string
// pins. Design: kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md
// §3 / §5; implementation record: STAGE1_1D1_IMPL_RECORD.md.
//
// Cases:
//  1 new keys: defaults are the identity values (vel scale 1,
//    colour mix 0, slots 1)
//  2 activation resolution: slots off disables everything;
//    the vel-scale / colour variants engage only off-identity
//  3 CPU twins: the level-1 write (slots verbatim + species),
//    the chain copy (verbatim, no decay over two hops), the
//    parent-velocity term (legacy coefficients x scale), the
//    colour mix (clamp + mix, 0 = level colour untouched)
//  4 identity pins: every stock Aux string stays at its
//    shipped pin and every builder with no / identity options
//    returns the stock string byte-for-byte
//  5 vel-scale variant: the uniform is declared once, both
//    legacy terms are scaled, no raw term remains; composes
//    with the SDF-splash variant
//  6 inheritance write fragments: src-uv capture on every
//    event return, the species derivation, the spawn gate,
//    the sparse discard, the chain copy line; no self-sampling
//  7 draw inherit variant: vertex sample + fragment mix,
//    composed with the shadow-map variant
//  8 wiring pins: runner drive, scene lifecycle, runtime
//    allocation gating
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1d1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;

await build({
  stdin: {
    contents: `
      export {
        AUX_VEL_FRAG, AUX_POS_FRAG, AUX_VEL_FRAG_PHASE20, AUX_POS_FRAG_PHASE20,
        AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
        AUX_DRAW_VERT, AUX_DRAW_FRAG, AUX_DRAW_VERT_PHASE30, AUX_DRAW_FRAG_PHASE30,
        AUX_INHERIT_FRAG, AUX_INHERIT_FRAG_PHASE20, AUX_CHAIN_INHERIT_FRAG,
        buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxInheritFrag,
        buildAuxDrawVert, buildAuxDrawFrag,
      } from './components/gpgpuShaderAux.ts';
      export {
        auxInheritSlotsEnabled, auxInheritVelScaleActive, auxInheritColorActive,
        auxInheritFromMain, auxInheritFromParent, auxInheritParentVelTerm,
        auxInheritColorMix, AUX_INHERIT_VEL_COEFFS,
      } from './lib/auxInherit.ts';
      export { attrSpeciesValue } from './lib/gpgpuAttributes.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  AUX_VEL_FRAG, AUX_POS_FRAG, AUX_VEL_FRAG_PHASE20,
  AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
  AUX_DRAW_VERT, AUX_DRAW_FRAG, AUX_DRAW_VERT_PHASE30, AUX_DRAW_FRAG_PHASE30,
  AUX_INHERIT_FRAG, AUX_INHERIT_FRAG_PHASE20, AUX_CHAIN_INHERIT_FRAG,
  buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxInheritFrag,
  buildAuxDrawVert, buildAuxDrawFrag,
  auxInheritSlotsEnabled, auxInheritVelScaleActive, auxInheritColorActive,
  auxInheritFromMain, auxInheritFromParent, auxInheritParentVelTerm,
  auxInheritColorMix, AUX_INHERIT_VEL_COEFFS,
  attrSpeciesValue, APP_STATE_DEFAULT_GPGPU,
} = lib;

const cfg = (over = {}) => ({
  gpgpuAuxInheritSlots: APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritSlots,
  gpgpuAuxInheritVelScale: APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritVelScale,
  gpgpuAuxInheritColor: APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritColor,
  ...over,
});

// ── 1. new keys: identity defaults ──────────────────────────
check('1a default gpgpuAuxInheritVelScale is 1', APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritVelScale === 1);
check('1b default gpgpuAuxInheritColor is 0', APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritColor === 0);
check('1c default gpgpuAuxInheritSlots is 1', APP_STATE_DEFAULT_GPGPU.gpgpuAuxInheritSlots === 1);

// ── 2. activation resolution ────────────────────────────────
check('2a default config: slots on, both variants off',
  auxInheritSlotsEnabled(cfg()) === true
  && auxInheritVelScaleActive(cfg()) === false
  && auxInheritColorActive(cfg()) === false);
check('2b slots off disables everything',
  auxInheritSlotsEnabled(cfg({ gpgpuAuxInheritSlots: 0 })) === false
  && auxInheritVelScaleActive(cfg({ gpgpuAuxInheritSlots: 0, gpgpuAuxInheritVelScale: 2 })) === false
  && auxInheritColorActive(cfg({ gpgpuAuxInheritSlots: 0, gpgpuAuxInheritColor: 0.5 })) === false);
check('2c vel-scale variant engages only off 1',
  auxInheritVelScaleActive(cfg({ gpgpuAuxInheritVelScale: 0 })) === true
  && auxInheritVelScaleActive(cfg({ gpgpuAuxInheritVelScale: 1.5 })) === true);
check('2d colour variant engages only above 0',
  auxInheritColorActive(cfg({ gpgpuAuxInheritColor: 0.25 })) === true);

// ── 3. CPU twins ────────────────────────────────────────────
{
  const t = auxInheritFromMain([0.25, -1.5, 3.75], 1234, 4);
  check('3a level-1 write keeps slots 0/1/2 raw and verbatim',
    t[0] === 0.25 && t[1] === -1.5 && t[2] === 3.75);
  check('3b level-1 write species is the plSpecies twin',
    t[3] === attrSpeciesValue(1234, 4));
  let speciesOk = true;
  for (let i = 0; i < 4096; i++) {
    const v = attrSpeciesValue(i, 4);
    if (!(v >= 0 && v <= 1) || ![0, 1 / 3, 2 / 3, 1].some((q) => Math.abs(v - q) < 1e-12)) speciesOk = false;
  }
  check('3c species values are the count-4 grid inside [0, 1]', speciesOk);
  const parent = auxInheritFromMain([0.1, 0.2, 0.3], 77, 5);
  const hop1 = auxInheritFromParent(parent);
  const hop2 = auxInheritFromParent(hop1);
  check('3d chain copy is verbatim over two hops (no decay)',
    hop2[0] === parent[0] && hop2[1] === parent[1] && hop2[2] === parent[2] && hop2[3] === parent[3]);
  check('3e legacy coefficients are trail 0.15 / birth 0.25 / death 0 / bounce 0',
    AUX_INHERIT_VEL_COEFFS.sparkTrail === 0.15 && AUX_INHERIT_VEL_COEFFS.birthBurst === 0.25
    && AUX_INHERIT_VEL_COEFFS.deathBurst === 0 && AUX_INHERIT_VEL_COEFFS.bounceSplash === 0);
  const term = auxInheritParentVelTerm('sparkTrail', [40, -20, 10], 1);
  check('3f parent-vel term at scale 1 is the legacy trail term',
    term[0] === 6 && term[1] === -3 && term[2] === 1.5);
  const term0 = auxInheritParentVelTerm('birthBurst', [40, -20, 10], 0);
  check('3g scale 0 removes the inherited velocity', term0[0] === 0 && term0[1] === 0 && term0[2] === 0);
  const termDeath = auxInheritParentVelTerm('deathBurst', [40, -20, 10], 2);
  check('3h death/bounce inherit no velocity at any scale',
    termDeath[0] === 0 && termDeath[1] === 0 && termDeath[2] === 0);
  const mix0 = auxInheritColorMix([0.2, 0.4, 0.6], [0.9, 0.1, 0.5, 0], 0);
  check('3i colour mix 0 returns the level colour untouched',
    mix0[0] === 0.2 && mix0[1] === 0.4 && mix0[2] === 0.6);
  const mix1 = auxInheritColorMix([0.2, 0.4, 0.6], [2.5, -1, 0.5, 0], 1);
  check('3j colour mix 1 is the clamped inherited rgb',
    mix1[0] === 1 && mix1[1] === 0 && mix1[2] === 0.5);
  const mixH = auxInheritColorMix([0, 0, 0], [1, 0.5, 0, 0], 0.5);
  check('3k colour mix 0.5 is the midpoint',
    mixH[0] === 0.5 && mixH[1] === 0.25 && mixH[2] === 0);
}

// ── 4. identity pins ────────────────────────────────────────
check('4a AUX_VEL_FRAG at shipped v2.01.0 pin',
  sha(AUX_VEL_FRAG) === '9bdf0c431b4330df19bfb24aa96016e6b5d312fd13c5105cc960b56c2df1653e', sha(AUX_VEL_FRAG));
check('4b AUX_POS_FRAG at shipped v2.01.0 pin',
  sha(AUX_POS_FRAG) === 'cfe2304d5b8aa3958fb975c8e35f4aa882cbe7a518e2ed096bc59c238aebab3b', sha(AUX_POS_FRAG));
check('4c chain pair at shipped pins',
  sha(AUX_CHAIN_VEL_FRAG) === '3098cf7589b331209973651e463a7638cf2e8c53f25748d86546d19123338c7b'
  && sha(AUX_CHAIN_POS_FRAG) === 'a0dae2cc056f0e1caf1c04a753ebcdda9f3206432b9f130ea49499ef13988bf4');
check('4d builders with no options return the stock strings',
  buildAuxVelFrag() === AUX_VEL_FRAG && buildAuxPosFrag() === AUX_POS_FRAG
  && buildAuxChainVelFrag() === AUX_CHAIN_VEL_FRAG
  && buildAuxDrawVert() === AUX_DRAW_VERT && buildAuxDrawFrag() === AUX_DRAW_FRAG);
check('4e identity options return the stock strings',
  buildAuxVelFrag({ inheritVelScale: false }) === AUX_VEL_FRAG
  && buildAuxChainVelFrag({ inheritVelScale: false }) === AUX_CHAIN_VEL_FRAG
  && buildAuxDrawVert({ inherit: false }) === AUX_DRAW_VERT
  && buildAuxDrawFrag({ inherit: false }) === AUX_DRAW_FRAG);
check('4f phase20 / phase30 variants still assemble',
  buildAuxVelFrag({ sdfSplash: true }) === AUX_VEL_FRAG_PHASE20
  && buildAuxDrawVert({ shadowMap: true }) === AUX_DRAW_VERT_PHASE30
  && buildAuxDrawFrag({ shadowMap: true }) === AUX_DRAW_FRAG_PHASE30);
check('4g stock strings carry no inheritance text',
  !AUX_VEL_FRAG.includes('Inherit') && !AUX_CHAIN_VEL_FRAG.includes('Inherit')
  && !AUX_DRAW_VERT.includes('Inherit') && !AUX_DRAW_FRAG.includes('Inherit'));

// ── 5. vel-scale variant ────────────────────────────────────
{
  const v = buildAuxVelFrag({ inheritVelScale: true });
  check('5a level-1 variant declares the scale uniform once',
    count(v, 'uniform float uAuxInheritVelScale;') === 1);
  check('5b level-1 variant scales both legacy terms',
    v.includes('mVel.xyz * (0.15 * uAuxInheritVelScale)')
    && v.includes('mVel.xyz * (0.25 * uAuxInheritVelScale)'));
  check('5c level-1 variant leaves no raw legacy term',
    !v.includes('mVel.xyz * 0.15') && !v.includes('mVel.xyz * 0.25'));
  const c = buildAuxChainVelFrag({ inheritVelScale: true });
  check('5d chain variant declares once and scales both terms',
    count(c, 'uniform float uAuxInheritVelScale;') === 1
    && c.includes('mVel.xyz * (0.15 * uAuxInheritVelScale)')
    && c.includes('mVel.xyz * (0.25 * uAuxInheritVelScale)')
    && !c.includes('mVel.xyz * 0.15') && !c.includes('mVel.xyz * 0.25'));
  const both = buildAuxVelFrag({ sdfSplash: true, inheritVelScale: true });
  check('5e variant composes with the SDF-splash variant',
    both.includes('auxSdfEval') && both.includes('mVel.xyz * (0.15 * uAuxInheritVelScale)'));
}

// ── 6. inheritance write fragments ──────────────────────────
check('6a level-1 fragment captures the source uv on all 5 event returns',
  count(AUX_INHERIT_FRAG, 'gAuxSpawnSrcUv = srcUv') === 5,
  String(count(AUX_INHERIT_FRAG, 'gAuxSpawnSrcUv = srcUv')));
check('6b level-1 SDF variant captures all 5 too',
  count(AUX_INHERIT_FRAG_PHASE20, 'gAuxSpawnSrcUv = srcUv') === 5
  && AUX_INHERIT_FRAG_PHASE20.includes('auxSdfEval'));
check('6c chain fragment captures all 5 event returns',
  count(AUX_CHAIN_INHERIT_FRAG, 'gAuxSpawnSrcUv = srcUv') === 5);
check('6d level-1 write is slots rgb + species value',
  AUX_INHERIT_FRAG.includes('gl_FragColor = vec4(slots, auxInheritSpeciesValue(gAuxSpawnSrcUv));')
  && AUX_INHERIT_FRAG.includes('texture2D(uMainAttrTex, gAuxSpawnSrcUv).rgb'));
check('6e species derivation matches the CPU twin composition',
  AUX_INHERIT_FRAG.includes('(idx + 17.17) * 3.71 + 17.17')
  && AUX_INHERIT_FRAG.includes('clamp(floor(uSpeciesCount + 0.5), 2.0, 6.0)'));
check('6f chain write copies the parent texel verbatim',
  AUX_CHAIN_INHERIT_FRAG.includes('gl_FragColor = texture2D(uSrcInheritTex, gAuxSpawnSrcUv);'));
check('6g both fragments gate on the velocity pass spawn state and discard otherwise',
  AUX_INHERIT_FRAG.includes('if (auxPos.w >= auxVel.w)') && AUX_INHERIT_FRAG.includes('discard;')
  && AUX_CHAIN_INHERIT_FRAG.includes('if (auxPos.w >= auxVel.w)') && AUX_CHAIN_INHERIT_FRAG.includes('discard;'));
check('6h neither fragment samples its own target (no prev binding)',
  !AUX_INHERIT_FRAG.includes('PrevTex') && !AUX_CHAIN_INHERIT_FRAG.includes('PrevTex'));
check('6i builder forms assemble the exported constants',
  buildAuxInheritFrag() === AUX_INHERIT_FRAG
  && buildAuxInheritFrag({ sdfSplash: true }) === AUX_INHERIT_FRAG_PHASE20
  && buildAuxInheritFrag({ chain: true }) === AUX_CHAIN_INHERIT_FRAG);

// ── 7. draw inherit variant ─────────────────────────────────
{
  const vert = buildAuxDrawVert({ inherit: true });
  const frag = buildAuxDrawFrag({ inherit: true });
  check('7a draw vertex samples the inheritance texture',
    vert.includes('uniform sampler2D uAuxInheritTex;')
    && vert.includes('vInheritRgb = clamp(texture2D(uAuxInheritTex, aTexCoord).rgb, 0.0, 1.0);'));
  check('7b draw fragment mixes by uAuxInheritColor',
    frag.includes('mix(uColor, vInheritRgb, uAuxInheritColor)'));
  const both = buildAuxDrawFrag({ inherit: true, shadowMap: true });
  check('7c inherit composes with the shadow-map write',
    both.includes('mix(uColor, vInheritRgb, uAuxInheritColor) * mix(1.0, vShadowMapMul, uShadowMapStrength)'));
  check('7d inherit variants differ from stock',
    vert !== AUX_DRAW_VERT && frag !== AUX_DRAW_FRAG);
}

// ── 8. wiring pins ──────────────────────────────────────────
{
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  const scene = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  const runtime = readFileSync(join(ROOT, 'components', 'useGpgpuRuntime.ts'), 'utf8');
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  check('8a runner drives the level-1 inherit write after the velocity pass',
    passes.includes('inherit.mainAttrTex') && passes.includes('inhU.uSpeciesCount.value = config.gpgpuParticleLifeSpecies'));
  check('8b runner drives the chain inherit copy',
    passes.includes('inhU.uSrcInheritTex.value = inherit.srcInheritTex'));
  check('8c runner feeds the vel-scale uniform from config (guarded)',
    passes.includes('if (velU.uAuxInheritVelScale) velU.uAuxInheritVelScale.value = config.gpgpuAuxInheritVelScale'));
  check('8d scene passes the level-1 target + attribute texture',
    scene.includes('inherit: auxInheritRtRef.current') && scene.includes('mainAttrTex: simAttrTex'));
  check('8e scene passes the chain copies level to level',
    scene.includes('srcInheritTex: auxInheritRtRef.current.texture')
    && scene.includes('srcInheritTex: aux2InheritRtRef.current.texture'));
  check('8f scene syncs the draw inheritance uniforms per level',
    count(scene, 'uAuxInheritColor.value = config.gpgpuAuxInheritColor') === 3);
  check('8g runtime allocates inheritance targets only while the key is on',
    runtime.includes('auxInheritRtRef.current = auxInheritOn ? createAuxInheritTarget(gl) : null')
    && runtime.includes('auxInheritOn && auxDepth >= 2'));
  // Slice 1D-2: both calls gained the emit variant dimension
  // (the chain inherit material and the chain velocity swap
  // now follow the Aux2 emit condition too). Assertion
  // updated minimally — see STAGE1_1D2_IMPL_RECORD.md.
  check('8h assets build the inherit materials and swap variants',
    assets.includes('buildAuxInheritFrag({ chain: true, emit: auxEmitChainActive(config) })')
    && assets.includes('buildAuxChainVelFrag({ inheritVelScale, emit: chainEmit })'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
