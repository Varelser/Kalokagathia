// Grammar 2.0 stage 1, slice 1D-2 — child emitter (emit
// mode): the emit variants of both event chunks, the rate
// conversion, the four emission shapes, the emit keys, the
// chain parameter plumbing, and the string pins. Design:
// kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md §2 / §5;
// implementation record: STAGE1_1D2_IMPL_RECORD.md.
//
// Cases:
//  1 new keys: defaults are the design values (rate 30,
//    shape 'sphere', spread 0.5, both parameter sets)
//  2 activation resolution: the emit variants engage only
//    while the level's mode is 'emit'
//  3 rate conversion: rate/60 clamped to [0, 1]
//  4 shape / mode ids: sphere 0, cone 1, disc 2, point 3;
//    emit mode id 5 (4 stays reserved for ruleSpawn)
//  5 CPU twin distributions: sphere magnitude + direction,
//    cone spread 0 = axis-parallel and spread widening,
//    disc planarity and axial thickness bound, point whisper
//  6 chain resolution: emit params ride AuxLevelParams
//    (level 1 from the Aux keys, levels 2/3 from Aux2)
//  7 identity pins: every stock Aux string stays at its
//    shipped pin; builders with no / identity options
//    return the stock strings; no emit text in stock
//  8 emit variant structure: uniforms declared once, the
//    mode-5 branch, the shaping function, composition with
//    the SDF-splash and inherit-scale variants, the
//    inheritance capture count (5 stock returns + emit)
//  9 wiring pins: mode id, per-frame uniform supply from
//    config / level params, factory + swap wiring
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1d2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        AUX_VEL_FRAG, AUX_POS_FRAG, AUX_VEL_FRAG_PHASE20, AUX_POS_FRAG_PHASE20,
        AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG, AUX_EVENT_GLSL, AUX_CHAIN_EVENT_GLSL,
        AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG,
        buildAuxEventGlsl, buildAuxChainEventGlsl,
        buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxChainPosFrag,
        buildAuxInheritFrag,
      } from './components/gpgpuShaderAux.ts';
      export {
        AUX_EMIT_SHAPE_IDS, AUX_EMIT_MODE_ID,
        auxEmitLevel1Active, auxEmitChainActive,
        auxEmitTickProbability, auxEmitVelocity,
      } from './lib/auxEmit.ts';
      export { resolveAuxChainLevels } from './lib/auxChain.ts';
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
  AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG, AUX_EVENT_GLSL, AUX_CHAIN_EVENT_GLSL,
  AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG,
  buildAuxEventGlsl, buildAuxChainEventGlsl,
  buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxChainPosFrag,
  buildAuxInheritFrag,
  AUX_EMIT_SHAPE_IDS, AUX_EMIT_MODE_ID,
  auxEmitLevel1Active, auxEmitChainActive,
  auxEmitTickProbability, auxEmitVelocity,
  resolveAuxChainLevels, APP_STATE_DEFAULT_GPGPU,
} = lib;

const D = APP_STATE_DEFAULT_GPGPU;

// ── 1. new keys: design defaults ────────────────────────────
check('1a level-1 emit defaults are rate 30 / sphere / spread 0.5',
  D.gpgpuAuxEmitRate === 30 && D.gpgpuAuxEmitShape === 'sphere' && D.gpgpuAuxEmitSpread === 0.5);
check('1b Aux2 emit defaults mirror the level-1 set',
  D.gpgpuAux2EmitRate === 30 && D.gpgpuAux2EmitShape === 'sphere' && D.gpgpuAux2EmitSpread === 0.5);
check('1c default modes stay off (identity)',
  D.gpgpuAuxMode === 'none' && D.gpgpuAux2Mode === 'none');

// ── 2. activation resolution ────────────────────────────────
check('2a level-1 variant engages only on emit',
  auxEmitLevel1Active({ gpgpuAuxMode: 'emit' }) === true
  && auxEmitLevel1Active({ gpgpuAuxMode: 'sparkTrail' }) === false
  && auxEmitLevel1Active({ gpgpuAuxMode: 'none' }) === false);
check('2b chain variant engages only on Aux2 emit',
  auxEmitChainActive({ gpgpuAux2Mode: 'emit' }) === true
  && auxEmitChainActive({ gpgpuAux2Mode: 'deathBurst' }) === false);

// ── 3. rate conversion ──────────────────────────────────────
check('3a rate 30/s is a 0.5 tick probability', auxEmitTickProbability(30) === 0.5);
check('3b rate 15/s is 0.25', auxEmitTickProbability(15) === 0.25);
check('3c rate 60/s and above saturate at 1',
  auxEmitTickProbability(60) === 1 && auxEmitTickProbability(600) === 1);
check('3d rate 0 and negative never fire',
  auxEmitTickProbability(0) === 0 && auxEmitTickProbability(-5) === 0);
check('3e non-finite rates never fire',
  auxEmitTickProbability(NaN) === 0 && auxEmitTickProbability(Infinity) === 0);

// ── 4. shape / mode ids ─────────────────────────────────────
check('4a shape ids are sphere 0 / cone 1 / disc 2 / point 3',
  AUX_EMIT_SHAPE_IDS.sphere === 0 && AUX_EMIT_SHAPE_IDS.cone === 1
  && AUX_EMIT_SHAPE_IDS.disc === 2 && AUX_EMIT_SHAPE_IDS.point === 3);
check('4b emit mode id is 5 (4 reserved for ruleSpawn)', AUX_EMIT_MODE_ID === 5);

// ── 5. CPU twin distributions ───────────────────────────────
// Deterministic pseudo-random samples in the hash ranges:
// h3 components in [-0.5, 0.5], scalars in [0, 1).
let seed = 1234567;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rndH3 = () => [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SPEED = 26;
{
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const h3 = rndH3();
    const hA = rnd();
    if (len(h3) <= 0.01) continue;
    const v = auxEmitVelocity('sphere', [3, -2, 6], h3, hA, rnd(), SPEED, 0.5);
    const mag = SPEED * (0.35 + 0.65 * hA);
    // magnitude is the legacy speed factor; direction is h3's.
    if (!near(len(v), mag, 1e-9)) ok = false;
    const cross = [
      v[1] * h3[2] - v[2] * h3[1],
      v[2] * h3[0] - v[0] * h3[2],
      v[0] * h3[1] - v[1] * h3[0],
    ];
    if (len(cross) > 1e-7 * mag) ok = false;
  }
  check('5a sphere: magnitude is speed*(0.35+0.65h), direction is the hash direction', ok);
}
{
  const parent = [10, 0, 0];
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const h3 = rndH3();
    const hA = rnd();
    const v = auxEmitVelocity('cone', parent, h3, hA, rnd(), SPEED, 0);
    const mag = SPEED * (0.35 + 0.65 * hA);
    if (!near(len(v), mag, 1e-9)) ok = false;
    if (!near(v[1], 0, 1e-9) || !near(v[2], 0, 1e-9) || v[0] <= 0) ok = false;
  }
  check('5b cone at spread 0 fires exactly along the parent velocity', ok);
  let widening = true;
  for (let i = 0; i < 500; i++) {
    const h3 = rndH3();
    const v = auxEmitVelocity('cone', parent, h3, rnd(), rnd(), SPEED, 0.5);
    // spread 0.5: the hash term can remove at most 0.5 of the
    // axis component, so the direction stays in the forward
    // hemisphere.
    if (dot(v, [1, 0, 0]) <= 0) widening = false;
  }
  check('5c cone at spread 0.5 stays in the forward hemisphere', widening);
  const rest = auxEmitVelocity('cone', [0, 0, 0], [0.3, -0.2, 0.1], 0.5, 0, SPEED, 0);
  check('5d cone with a resting parent falls back to the hash direction',
    near(rest[0] / len(rest), 0.3 / Math.hypot(0.3, -0.2, 0.1), 1e-9)
    && near(rest[1] / len(rest), -0.2 / Math.hypot(0.3, -0.2, 0.1), 1e-9));
}
{
  const parent = [0, 0, -40];
  const axis = [0, 0, -1];
  let planar = true;
  let thick = true;
  for (let i = 0; i < 500; i++) {
    const h3 = rndH3();
    const hA = rnd();
    const v0 = auxEmitVelocity('disc', parent, h3, hA, rnd(), SPEED, 0);
    if (Math.abs(dot(v0, axis)) > 1e-9) planar = false;
    if (!near(len(v0), SPEED * (0.35 + 0.65 * hA), 1e-9)) planar = false;
    const v1 = auxEmitVelocity('disc', parent, h3, hA, rnd(), SPEED, 1.2);
    // axial component is h3.x * spread * speed * 0.5, bounded
    // by 0.5 * spread * speed * 0.5.
    if (Math.abs(dot(v1, axis)) > 0.5 * 1.2 * SPEED * 0.5 + 1e-9) thick = false;
  }
  check('5e disc at spread 0 is planar with the legacy magnitude', planar);
  check('5f disc axial thickness is bounded by spread*speed/4', thick);
}
{
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const h3 = rndH3();
    const v = auxEmitVelocity('point', [5, 5, 5], h3, rnd(), rnd(), SPEED, 0.5);
    if (!near(v[0], h3[0] * SPEED * 0.04, 1e-12)
      || !near(v[1], h3[1] * SPEED * 0.04, 1e-12)
      || !near(v[2], h3[2] * SPEED * 0.04, 1e-12)) ok = false;
    if (len(v) > SPEED * 0.04 * Math.sqrt(0.75) + 1e-12) ok = false;
  }
  check('5g point: velocity is the hash whisper h3*speed*0.04', ok);
}

// ── 6. chain resolution ─────────────────────────────────────
{
  const levels = resolveAuxChainLevels({
    ...D,
    gpgpuAuxMode: 'emit',
    gpgpuAuxEmitRate: 45,
    gpgpuAuxEmitShape: 'cone',
    gpgpuAuxEmitSpread: 0.25,
    gpgpuAuxDepth: 3,
    gpgpuAux2Mode: 'emit',
    gpgpuAux2EmitRate: 12,
    gpgpuAux2EmitShape: 'disc',
    gpgpuAux2EmitSpread: 1.5,
  });
  check('6a three levels resolve', levels.length === 3);
  check('6b level 1 carries the Aux emit set',
    levels[0].emitRate === 45 && levels[0].emitShape === 'cone' && levels[0].emitSpread === 0.25);
  check('6c levels 2 and 3 share the Aux2 emit set',
    levels[1].emitRate === 12 && levels[1].emitShape === 'disc' && levels[1].emitSpread === 1.5
    && levels[2].emitRate === 12 && levels[2].emitShape === 'disc' && levels[2].emitSpread === 1.5);
}

// ── 7. identity pins ────────────────────────────────────────
check('7a AUX_VEL_FRAG at shipped v2.01.0 pin',
  sha(AUX_VEL_FRAG) === '9bdf0c431b4330df19bfb24aa96016e6b5d312fd13c5105cc960b56c2df1653e', sha(AUX_VEL_FRAG));
check('7b AUX_POS_FRAG at shipped v2.01.0 pin',
  sha(AUX_POS_FRAG) === 'cfe2304d5b8aa3958fb975c8e35f4aa882cbe7a518e2ed096bc59c238aebab3b', sha(AUX_POS_FRAG));
check('7c chain pair at shipped pins',
  sha(AUX_CHAIN_VEL_FRAG) === '3098cf7589b331209973651e463a7638cf2e8c53f25748d86546d19123338c7b'
  && sha(AUX_CHAIN_POS_FRAG) === 'a0dae2cc056f0e1caf1c04a753ebcdda9f3206432b9f130ea49499ef13988bf4');
check('7d builders with no options return the stock strings',
  buildAuxVelFrag() === AUX_VEL_FRAG && buildAuxPosFrag() === AUX_POS_FRAG
  && buildAuxChainVelFrag() === AUX_CHAIN_VEL_FRAG
  && buildAuxChainPosFrag() === AUX_CHAIN_POS_FRAG
  && buildAuxEventGlsl() === AUX_EVENT_GLSL
  && buildAuxChainEventGlsl() === AUX_CHAIN_EVENT_GLSL
  && buildAuxInheritFrag() === AUX_INHERIT_FRAG
  && buildAuxInheritFrag({ chain: true }) === AUX_CHAIN_INHERIT_FRAG);
check('7e identity options return the stock strings',
  buildAuxVelFrag({ emit: false }) === AUX_VEL_FRAG
  && buildAuxPosFrag({ emit: false }) === AUX_POS_FRAG
  && buildAuxChainVelFrag({ emit: false }) === AUX_CHAIN_VEL_FRAG
  && buildAuxChainPosFrag({ emit: false }) === AUX_CHAIN_POS_FRAG
  && buildAuxEventGlsl({ emit: false }) === AUX_EVENT_GLSL
  && buildAuxVelFrag({ sdfSplash: true }) === AUX_VEL_FRAG_PHASE20);
check('7f stock strings carry no emit text',
  !AUX_VEL_FRAG.includes('uAuxEmit') && !AUX_POS_FRAG.includes('uAuxEmit')
  && !AUX_CHAIN_VEL_FRAG.includes('uAuxEmit') && !AUX_CHAIN_POS_FRAG.includes('uAuxEmit')
  && !AUX_INHERIT_FRAG.includes('uAuxEmit') && !AUX_CHAIN_INHERIT_FRAG.includes('uAuxEmit'));

// ── 8. emit variant structure ───────────────────────────────
{
  const chunk = buildAuxEventGlsl({ emit: true });
  check('8a level-1 emit chunk declares the emit uniforms once',
    count(chunk, 'uniform float uAuxEmitRate;') === 1
    && count(chunk, 'uniform int   uAuxEmitShape;') === 1
    && count(chunk, 'uniform float uAuxEmitSpread;') === 1);
  check('8b level-1 emit chunk carries the mode-5 branch and shaping',
    chunk.includes('if (uAuxMode == 5)')
    && chunk.includes('clamp(uAuxEmitRate / 60.0, 0.0, 1.0)')
    && chunk.includes('bool emitAlive = !uAgeEnabled || mPos.w < uAgeMax;')
    && chunk.includes('vec3 auxEmitVelocity(vec3 parentVel, vec3 h3, float hA, float hB)'));
  check('8c shaping constants mirror the CPU twin',
    chunk.includes('uAuxSpeed * (0.35 + 0.65 * hA)')
    && chunk.includes('return h3 * uAuxSpeed * 0.04;')
    && chunk.includes('h3 * (uAuxEmitSpread * 2.0)')
    && chunk.includes('h3.x * uAuxEmitSpread * uAuxSpeed * 0.5')
    && chunk.includes('hB * 6.2831853'));
  const vel = buildAuxVelFrag({ emit: true });
  const pos = buildAuxPosFrag({ emit: true });
  check('8d emit vel/pos pair both carry the branch (two passes cannot disagree)',
    vel.includes('if (uAuxMode == 5)') && pos.includes('if (uAuxMode == 5)')
    && vel !== AUX_VEL_FRAG && pos !== AUX_POS_FRAG);
  const both = buildAuxVelFrag({ emit: true, sdfSplash: true, inheritVelScale: true });
  check('8e emit composes with SDF-splash and inherit-scale',
    both.includes('auxSdfEval') && both.includes('if (uAuxMode == 5)')
    && both.includes('mVel.xyz * (0.15 * uAuxInheritVelScale)'));
  const cChunk = buildAuxChainEventGlsl({ emit: true });
  check('8f chain emit chunk carries the salted branch and chain shaping',
    cChunk.includes('if (uAuxMode == 5)')
    && cChunk.includes('auxChainHash(auxIdx * 5.97 + uChainSalt + tick)')
    && cChunk.includes('vec3 auxChainEmitVelocity(vec3 parentVel, vec3 h3, float hA, float hB)')
    && count(cChunk, 'uniform float uAuxEmitRate;') === 1);
  const cVel = buildAuxChainVelFrag({ emit: true });
  const cPos = buildAuxChainPosFrag({ emit: true });
  check('8g chain emit vel/pos pair both carry the branch',
    cVel.includes('if (uAuxMode == 5)') && cPos.includes('if (uAuxMode == 5)')
    && cVel !== AUX_CHAIN_VEL_FRAG && cPos !== AUX_CHAIN_POS_FRAG);
  const inh = buildAuxInheritFrag({ emit: true });
  const cInh = buildAuxInheritFrag({ chain: true, emit: true });
  check('8h inherit variants capture the emit return too (6 captures)',
    count(inh, 'gAuxSpawnSrcUv = srcUv') === 6
    && count(cInh, 'gAuxSpawnSrcUv = srcUv') === 6,
    `${count(inh, 'gAuxSpawnSrcUv = srcUv')}/${count(cInh, 'gAuxSpawnSrcUv = srcUv')}`);
}

// ── 9. wiring pins ──────────────────────────────────────────
{
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  check('9a runner maps emit to mode id 5',
    passes.includes('emit: 5,'));
  check('9b runner feeds the level-1 emit uniforms from config',
    passes.includes('velU.uAuxEmitRate.value = config.gpgpuAuxEmitRate')
    && passes.includes('posU.uAuxEmitRate.value = config.gpgpuAuxEmitRate')
    && passes.includes('inhU.uAuxEmitRate.value = config.gpgpuAuxEmitRate')
    && passes.includes('AUX_EMIT_SHAPE_IDS[config.gpgpuAuxEmitShape]'));
  check('9c runner feeds the chain emit uniforms from the level params',
    passes.includes('velU.uAuxEmitRate.value = level.emitRate')
    && passes.includes('posU.uAuxEmitRate.value = level.emitRate')
    && passes.includes('AUX_EMIT_SHAPE_IDS[level.emitShape]'));
  // Slice 1D-3: the level-1 velocity builder calls gained
  // the ruleSpawn variant dimension (the emit conditions
  // still drive the builds and the swap). Assertions updated
  // minimally — see STAGE1_1D3_IMPL_RECORD.md.
  // Stage 4 slice S6: the level-1 vel call gained the trail
  // variant dimension (level-1-only). Assertions updated
  // minimally — see STAGE4_S6_TRAIL_AUX_IMPL_RECORD.md.
  check('9d assets build the initial emit variants from config',
    assets.includes('buildAuxVelFrag({ sdfSplash: auxSdfSplashActive(config), inheritVelScale: auxInheritVelScaleActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) })')
    && assets.includes('buildAuxChainPosFrag({ emit: auxEmitChainActive(config) })')
    && assets.includes('buildAuxInheritFrag({ chain: true, emit: auxEmitChainActive(config) })'));
  // Stage-4 gate fix round 2 (B2): the swap now REPLACES the
  // materials (rebuildAuxMaterial around the shared uniforms)
  // instead of rewriting fragmentShader in place — the builder
  // calls and option sets are unchanged. Assertions updated
  // minimally — see STAGE4_FIX6_AUX_VARIANT_RECORD.md.
  // Pin updated at stage-4 gate fix round 6 (STAGE4_FIX11_AUX_AB_RECORD):
  // the swap now also carries the diag-only trail A/B stage (trailAb).
  check('9e assets swap the emit variants when the modes flip',
    assets.includes('setAuxVelMat(rebuildAuxMaterial(auxVelMat, buildAuxVelFrag({ sdfSplash, inheritVelScale, emit, ruleSpawn, trail, trailAb })));')
    && assets.includes('setAuxChainPosMat(rebuildAuxMaterial(auxChainPosMat, buildAuxChainPosFrag({ emit: chainEmit })));')
    && assets.includes('setAuxChainInheritMat(rebuildAuxMaterial(auxChainInheritMat, buildAuxInheritFrag({ chain: true, emit: chainEmit })));'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
