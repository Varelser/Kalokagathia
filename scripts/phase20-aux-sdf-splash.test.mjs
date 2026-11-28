// Phase 20 stage 4 — bounceSplash SDF contact source (UE5 #22).
//
// The Aux bounceSplash event used to fire only on the sphere
// bound and the floor; the analytic SDF collider (§2-11) was not
// an event source. Stage 4 adds it in the Phase 19/20 string-
// variant manner: the SDF text exists only in the PHASE20 Aux
// strings, selected while (SDF collider on + bounceSplash mode)
// via auxSdfSplashActive. These tests pin:
//
// - OFF identity: the default Aux strings (and the untouched
//   chain pair) stay at their shipped v2.01.0 pins, and no SDF
//   text appears in them — so with the SDF collider disabled, or
//   with any other aux mode, the assembled shader carries no
//   firing code for this source.
// - Variant pins: the PHASE20 strings match their pins in
//   scripts/phase18-shader-hash.baseline.json, the builders
//   return stock / variant exactly, and the variant is the stock
//   string with only the event chunk swapped (reversible).
// - Semantics (structural): the SDF contact test mirrors the
//   velocity pass's reflection band (sd < 2.0) with the floor
//   test's speed gate on the surface normal (< -2.0), shares the
//   legacy 0.35 probability gate, leaves along the SDF normal
//   with the sphere splash's velocity formula, and the eval
//   chunk mirrors the velocity tail's shape formulas.
// - Gate: auxSdfSplashActive's truth table.
// - Wiring: the assets build the initial variant from the
//   config and swap on the gate flip; the passes fill the SDF
//   uniforms (guarded) for both Aux passes.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20auxsdf-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

await build({
  stdin: {
    contents: `
      export {
        AUX_VEL_FRAG, AUX_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
        AUX_EVENT_GLSL, AUX_EVENT_GLSL_PHASE20,
        AUX_VEL_FRAG_PHASE20, AUX_POS_FRAG_PHASE20,
        buildAuxEventGlsl, buildAuxVelFrag, buildAuxPosFrag,
      } from './components/gpgpuShaderAux.ts';
      export { auxSdfSplashActive } from './lib/auxChain.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  AUX_VEL_FRAG, AUX_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
  AUX_EVENT_GLSL, AUX_EVENT_GLSL_PHASE20,
  AUX_VEL_FRAG_PHASE20, AUX_POS_FRAG_PHASE20,
  buildAuxEventGlsl, buildAuxVelFrag, buildAuxPosFrag,
  auxSdfSplashActive, DEFAULT_CONFIG,
} = lib;

const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));

// --- OFF identity: shipped pins, no SDF text in the defaults ---
{
  check('AUX_VEL_FRAG at shipped v2.01.0 pin',
    sha(AUX_VEL_FRAG) === '9bdf0c431b4330df19bfb24aa96016e6b5d312fd13c5105cc960b56c2df1653e',
    sha(AUX_VEL_FRAG));
  check('AUX_POS_FRAG at shipped v2.01.0 pin',
    sha(AUX_POS_FRAG) === 'cfe2304d5b8aa3958fb975c8e35f4aa882cbe7a518e2ed096bc59c238aebab3b',
    sha(AUX_POS_FRAG));
  check('AUX_VEL_FRAG pin matches phase18 baseline record',
    baseline.parts.AUX_VEL_FRAG?.sha256 === sha(AUX_VEL_FRAG));
  check('AUX_POS_FRAG pin matches phase18 baseline record',
    baseline.parts.AUX_POS_FRAG?.sha256 === sha(AUX_POS_FRAG));
  check('chain pair untouched (level >= 2 has no SDF source)',
    sha(AUX_CHAIN_VEL_FRAG) === '3098cf7589b331209973651e463a7638cf2e8c53f25748d86546d19123338c7b'
    && sha(AUX_CHAIN_POS_FRAG) === 'a0dae2cc056f0e1caf1c04a753ebcdda9f3206432b9f130ea49499ef13988bf4');
  for (const [name, s] of [['AUX_VEL_FRAG', AUX_VEL_FRAG], ['AUX_POS_FRAG', AUX_POS_FRAG], ['AUX_EVENT_GLSL', AUX_EVENT_GLSL]]) {
    check(`${name} carries no SDF text`,
      !s.includes('uSdf') && !s.includes('sdfHit') && !s.includes('auxSdfEval') && !s.includes('splashN'));
  }
  check('builders with no option return the stock strings',
    buildAuxVelFrag() === AUX_VEL_FRAG && buildAuxPosFrag() === AUX_POS_FRAG
    && buildAuxVelFrag({}) === AUX_VEL_FRAG && buildAuxVelFrag({ sdfSplash: false }) === AUX_VEL_FRAG
    && buildAuxEventGlsl() === AUX_EVENT_GLSL);
}

// --- Variant: pins, builder contract, reversibility ---
{
  check('AUX_VEL_FRAG_PHASE20 pin matches phase18 baseline record',
    baseline.parts.AUX_VEL_FRAG_PHASE20?.sha256 === sha(AUX_VEL_FRAG_PHASE20),
    sha(AUX_VEL_FRAG_PHASE20));
  check('AUX_POS_FRAG_PHASE20 pin matches phase18 baseline record',
    baseline.parts.AUX_POS_FRAG_PHASE20?.sha256 === sha(AUX_POS_FRAG_PHASE20),
    sha(AUX_POS_FRAG_PHASE20));
  check('builders with sdfSplash return the variant strings',
    buildAuxVelFrag({ sdfSplash: true }) === AUX_VEL_FRAG_PHASE20
    && buildAuxPosFrag({ sdfSplash: true }) === AUX_POS_FRAG_PHASE20
    && buildAuxEventGlsl({ sdfSplash: true }) === AUX_EVENT_GLSL_PHASE20);
  check('variant is stock with only the event chunk swapped (vel)',
    AUX_VEL_FRAG_PHASE20.replace(AUX_EVENT_GLSL_PHASE20, () => AUX_EVENT_GLSL) === AUX_VEL_FRAG);
  check('variant is stock with only the event chunk swapped (pos)',
    AUX_POS_FRAG_PHASE20.replace(AUX_EVENT_GLSL_PHASE20, () => AUX_EVENT_GLSL) === AUX_POS_FRAG);
  check('variant event chunk keeps the legacy contact tests verbatim',
    AUX_EVENT_GLSL_PHASE20.includes('bool sphereHit = d > uBounceRadius * 0.985 && dot(mVel.xyz, n) > 2.0;')
    && AUX_EVENT_GLSL_PHASE20.includes('bool floorHit = uFloorEnabled && mPos.y < uFloorY + 1.5 && mVel.xyz.y < -2.0;')
    && AUX_EVENT_GLSL_PHASE20.includes('gAuxSpawnVel = vec3(jitter.x * 1.2, 0.55 + 0.65 * auxHash(auxIdx * 7.9 + tick), jitter.z * 1.2) * uAuxSpeed * 0.8;'));
}

// --- Semantics: SDF contact test, gate, splash velocity, eval ---
{
  const ev = AUX_EVENT_GLSL_PHASE20;
  check('variant declares the SDF uniform set',
    ev.includes('uniform bool  uSdfEnabled;') && ev.includes('uniform int   uSdfShape;')
    && ev.includes('uniform float uSdfX;') && ev.includes('uniform float uSdfY;')
    && ev.includes('uniform float uSdfZ;') && ev.includes('uniform float uSdfSize;'));
  check('contact test mirrors the velocity reflection band + floor speed gate',
    ev.includes('sdfHit = sd < 2.0 && dot(mVel.xyz, sdfN) < -2.0;'));
  check('contact test is guarded by the uSdfEnabled uniform',
    ev.includes('if (uSdfEnabled) {\n          float sd = auxSdfEval(mPos.xyz, sdfN);'));
  check('fire condition adds sdfHit under the shared 0.35 gate',
    ev.includes('if ((sphereHit || floorHit || sdfHit) && gate < 0.35 * uAuxIntensity) {'));
  check('splash normal prefers the sphere normal, falls back to the SDF normal',
    ev.includes('vec3 splashN = sdfHit && !sphereHit ? sdfN : n;'));
  check('splash velocity reuses the sphere formula along splashN',
    ev.includes('gAuxSpawnVel = (splashN * (0.5 + auxHash(auxIdx * 9.1 + tick)) + jitter * 0.9) * uAuxSpeed * 0.7;'));
  check('eval chunk mirrors the velocity tail shape formulas',
    ev.includes('sd = length(p - sc) - uSdfSize;')
    && ev.includes('sd = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);')
    && ev.includes('sd = length(vec2(ringD, lp.y)) - r2;')
    && ev.includes('sd = auxGyroidField(p, sc, uSdfSize) * uSdfSize * 0.227;')
    && ev.includes('sd = length(dp) - uSdfSize * 0.4;'));
  check('both passes carry the variant event chunk',
    AUX_VEL_FRAG_PHASE20.includes('auxSdfEval') && AUX_POS_FRAG_PHASE20.includes('auxSdfEval'));
}

// --- Gate: auxSdfSplashActive truth table ---
{
  const cfg = (over) => ({ ...DEFAULT_CONFIG, ...over });
  check('gate: SDF on + bounceSplash → active',
    auxSdfSplashActive(cfg({ gpgpuSdfEnabled: true, gpgpuAuxMode: 'bounceSplash' })) === true);
  check('gate: SDF on + other mode → inactive',
    auxSdfSplashActive(cfg({ gpgpuSdfEnabled: true, gpgpuAuxMode: 'deathBurst' })) === false
    && auxSdfSplashActive(cfg({ gpgpuSdfEnabled: true, gpgpuAuxMode: 'sparkTrail' })) === false
    && auxSdfSplashActive(cfg({ gpgpuSdfEnabled: true, gpgpuAuxMode: 'birthBurst' })) === false
    && auxSdfSplashActive(cfg({ gpgpuSdfEnabled: true, gpgpuAuxMode: 'none' })) === false);
  check('gate: SDF off + bounceSplash → inactive',
    auxSdfSplashActive(cfg({ gpgpuSdfEnabled: false, gpgpuAuxMode: 'bounceSplash' })) === false);
  check('gate: shipped defaults are inactive',
    auxSdfSplashActive(DEFAULT_CONFIG) === false);
}

// --- Wiring: assets variant selection + passes uniform fill ---
{
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  // Slice 1D-1: the velocity builder call gained the
  // inheritVelScale variant dimension (the gate still drives
  // the build and the swap; the swap effect now tracks both
  // variant conditions). Assertions updated minimally to the
  // extended call forms — see STAGE1_1D1_IMPL_RECORD.md.
  // Slice 1D-2: the calls gained the emit variant dimension
  // and the swap effect tracks the two emit conditions (and
  // the Aux2 mode dependency) as well. Assertions updated
  // minimally again — see STAGE1_1D2_IMPL_RECORD.md.
  // Slice 1D-3: the level-1 calls gained the ruleSpawn
  // variant dimension (the swap effect tracks it as a
  // level-1-only condition). Assertions updated minimally
  // again — see STAGE1_1D3_IMPL_RECORD.md.
  // Stage 4 slice S6: the level-1 calls gained the trail
  // variant dimension (level-1-only, like ruleSpawn; the
  // swap effect tracks the trail keys too). Assertions
  // updated minimally again — see
  // STAGE4_S6_TRAIL_AUX_IMPL_RECORD.md.
  check('assets build the initial Aux pair from the gate',
    assets.includes('fragmentShader: buildAuxVelFrag({ sdfSplash: auxSdfSplashActive(config), inheritVelScale: auxInheritVelScaleActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) })')
    && assets.includes('fragmentShader: buildAuxPosFrag({ sdfSplash: auxSdfSplashActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) })'));
  // Stage-4 gate fix round 2 (B2): the swap now REPLACES the
  // materials (rebuildAuxMaterial around the shared uniforms)
  // instead of rewriting fragmentShader in place — the builder
  // calls and option sets are unchanged. Assertions updated
  // minimally — see STAGE4_FIX6_AUX_VARIANT_RECORD.md.
  // Pin updated at stage-4 gate fix round 6 (STAGE4_FIX11_AUX_AB_RECORD):
  // the swap now also carries the diag-only trail A/B stage
  // (trailAb, 'A' = stock) and its state in the deps.
  check('assets swap the Aux pair when the gate flips',
    assets.includes('setAuxVelMat(rebuildAuxMaterial(auxVelMat, buildAuxVelFrag({ sdfSplash, inheritVelScale, emit, ruleSpawn, trail, trailAb })));')
    && assets.includes('setAuxPosMat(rebuildAuxMaterial(auxPosMat, buildAuxPosFrag({ sdfSplash, emit, ruleSpawn, trail, trailAb })));')
    && assets.includes('[config.gpgpuSdfEnabled, config.gpgpuAuxMode, config.gpgpuAux2Mode, config.gpgpuAuxInheritSlots, config.gpgpuAuxInheritVelScale, config.gpgpuTrailEnabled, config.gpgpuTrailMode, auxTrailAbStage, auxVelMat, auxPosMat, auxChainVelMat, auxChainPosMat, auxInheritMat, auxChainInheritMat]'));
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('passes fill the SDF uniforms (guarded) for both Aux passes',
    passes.includes('if (velU.uSdfEnabled) {')
    && passes.includes('velU.uSdfEnabled.value = config.gpgpuSdfEnabled;')
    && passes.includes('if (posU.uSdfEnabled) {')
    && passes.includes('posU.uSdfEnabled.value = config.gpgpuSdfEnabled;'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
