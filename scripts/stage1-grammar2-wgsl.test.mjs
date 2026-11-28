// Grammar 2.0 stage 1, the WGSL slice — live particle rules
// on the WebGPU route: the WGSL REP (buildRuleEvalWgsl), the
// WGSL consumption in lib/webgpuCompute.ts, and the
// capability split (particle-rules-live supported /
// particle-rules-live-full unsupported).
// Design: kalokagathia-pro/STAGE1_GRAMMAR2_DESIGN.md
// sections 7 / 10; record: STAGE1_WGSL_IMPL_RECORD.md.
//
// Cases:
//  1 astToWgsl: ternaries become select(), atan2 spelling,
//    comparisons / logic stay value-shaped, unknown -> null
//  2 liveConditionWgsl: slot / sim / state / sdf mapping;
//    den / hit / hits / ext slots have no WGSL form
//  3 buildRuleEvalWgsl: null cases (incl. baked-fallback and
//    unrepresentable), non-null cases, the mask aggregate
//    line textually identical to the GLSL builder's, the
//    true-kill latch, snapshot state semantics
//  4 liveRulesWgslCoverable: the coverage matrix
//  5 capability: coverable configs supported on WebGPU,
//    the rest request particle-rules-live-full
//  6 WGSL consumption pins (source): bindings, bits, the
//    gated force lines, the true-kill park, the live kill
//    block, uniform byte totals unchanged, the step wiring
//  7 identity: VEL_WGSL / POS_WGSL sha256 pins (the live
//    segments are inert while the live flags are 0)
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1w-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { astToWgsl } from './lib/expressionGlsl.ts';
      export { compileExpression } from './lib/expression.ts';
      export { resolveLiveParticleRules, buildRuleEvalFragment, buildRuleEvalWgsl, liveConditionWgsl, liveRulesWgslCoverable, liveRuleConditionVariables } from './lib/gpgpuParticleRulesLive.ts';
      export { getWebgpuComputeCapabilityReport, WEBGPU_COMPUTE_SUPPORTED_FEATURES } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  astToWgsl, compileExpression, resolveLiveParticleRules,
  buildRuleEvalFragment, buildRuleEvalWgsl, liveConditionWgsl,
  liveRulesWgslCoverable, liveRuleConditionVariables,
  getWebgpuComputeCapabilityReport, WEBGPU_COMPUTE_SUPPORTED_FEATURES,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const NAMES = ['energy', 'heat', 'charge', 'mass'];
const NAMES2 = ['spin', 'phase', 'glow', 'core'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const J = (v) => JSON.stringify(v);
const rule = (id, action, condition = '') => ({ id, enabled: true, target: { type: 'all' }, condition, action });
const compile = (text) => {
  const r = compileExpression(text, liveRuleConditionVariables(NAMES, NAMES2));
  if (!r.ok) throw new Error(`compile failed: ${text}`);
  return r.ast;
};

// --- 1. astToWgsl -------------------------------------------------------------
{
  const resolve = (name) => (name === 'vel' ? 'simVelMag' : name === 'energy' ? 'v0' : null);
  check('1a comparison becomes the select() 0/1 form (the GLSL ternary twin)',
    astToWgsl(compile('vel > 0.5'), resolve) === 'select(0.0, 1.0, (simVelMag) > (0.5))');
  check('1b ternary becomes select() with the != 0.0 condition coercion',
    astToWgsl(compile('vel > 0.5 ? 1 : 0'), resolve) === 'select((0.0), (1.0), (select(0.0, 1.0, (simVelMag) > (0.5))) != 0.0)');
  check('1c atan2 uses the WGSL spelling',
    astToWgsl(compile('atan2(energy, vel)'), resolve) === 'atan2((v0), (simVelMag))');
  check('1d arithmetic keeps its shape with resolved locals',
    astToWgsl(compile('vel * 2 + energy'), resolve).includes('(simVelMag)')
    && astToWgsl(compile('vel * 2 + energy'), resolve).includes('(v0)'));
  check('1e mod expands to the select() zero-guard form (no GLSL ternary leaks)',
    astToWgsl(compile('mod(vel, 2)'), resolve) === 'select(((simVelMag) - (2.0) * floor(((simVelMag) / (2.0)))), 0.0, (2.0) == 0.0)');
  check('1f a variable the resolver does not know resolves to null',
    astToWgsl(compile('energy > 1'), () => null) === null);
  check('1g no GLSL ternary operator survives in any emission',
    !astToWgsl(compile('vel > 0.5 ? energy : 0.25'), resolve).includes('?'));
}

// --- 2. liveConditionWgsl -------------------------------------------------------
{
  check('2a slot name maps to the mirrored bake local',
    liveConditionWgsl(compile('energy > 0.5'), 'tgt0', NAMES, NAMES2) === 'select(0.0, 1.0, (v0) > (0.5))');
  check('2b sim variable maps to the REP local',
    liveConditionWgsl(compile('vel > 0.5'), 'tgt0', NAMES, NAMES2) === 'select(0.0, 1.0, (simVelMag) > (0.5))');
  check('2c state reads the carried-in state',
    liveConditionWgsl(compile('state == 2'), 'tgt0', NAMES, NAMES2) === 'select(0.0, 1.0, (prevState) == (2.0))');
  check('2d sdf reads the REP SDF local',
    liveConditionWgsl(compile('sdf < 0'), 'tgt0', NAMES, NAMES2) === 'select(0.0, 1.0, (simSdf) < (0.0))');
  check('2e den has no WGSL form',
    liveConditionWgsl(compile('den > 0.5'), 'tgt0', NAMES, NAMES2) === null);
  check('2f hit / hits have no WGSL form',
    liveConditionWgsl(compile('hit > 0'), 'tgt0', NAMES, NAMES2) === null
    && liveConditionWgsl(compile('hits > 1'), 'tgt0', NAMES, NAMES2) === null);
  check('2g ext slot names have no WGSL form',
    liveConditionWgsl(compile('spin > 0.5'), 'tgt0', NAMES, NAMES2) === null
    && liveConditionWgsl(compile('slot5 > 0.5'), 'tgt0', NAMES, NAMES2) === null);
  check('2h x target local is honored',
    liveConditionWgsl(compile('x > 0.5'), 'tgt3', NAMES, NAMES2) === 'select(0.0, 1.0, (tgt3) > (0.5))');
}

// --- 3. buildRuleEvalWgsl -------------------------------------------------------
{
  check('3a no rules -> null', buildRuleEvalWgsl([], OPTS) === null);
  check('3b color-only (unconsumed) -> null',
    buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('c', { type: 'color' })])), OPTS) === null);
  check('3c den condition -> null (unrepresentable)',
    buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('k', { type: 'kill' }, 'den > 0.5')])), OPTS) === null);
  check('3d hit condition -> null',
    buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('k', { type: 'kill' }, 'hit > 0')])), OPTS) === null);
  check('3e ext-slot condition -> null',
    buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('k', { type: 'kill' }, 'spin > 0.5')])), OPTS) === null);
  check('3f snapshot-group target -> null (baked-fallback has no WGSL twin)',
    buildRuleEvalWgsl(
      resolveLiveParticleRules(J([{ id: 'k', target: { type: 'group', id: 'snap' }, action: { type: 'kill' } }])),
      { ...OPTS, groupDefs: [{ id: 'snap', source: { kind: 'snapshot', slot: 0 } }] },
    ) === null);

  const wgsl = buildRuleEvalWgsl(resolveLiveParticleRules(J([
    rule('g', { type: 'force-gate', force: 'all' }, 'vel > 0.5'),
    rule('k', { type: 'kill' }),
    rule('t', { type: 'true-kill' }),
    rule('s', { type: 'set-state', state: 2 }, 'state == 1'),
  ])), OPTS);
  check('3g a mixed live set builds', typeof wgsl === 'string');
  check('3h bindings: sim buffers in, ping-pong REP, attr mirror',
    wgsl.includes('@binding(1) var<storage, read> posIn : array<vec4f>;')
    && wgsl.includes('@binding(3) var attrTex : texture_2d<f32>;')
    && wgsl.includes('@binding(4) var<storage, read> repPrev : array<vec4f>;')
    && wgsl.includes('@binding(5) var<storage, read_write> repOut : array<vec4f>;'));
  check('3i snapshot state semantics (prevState in, nextState out)',
    wgsl.includes('let prevState = floor(prev.g * 255.0 + 0.5);')
    && wgsl.includes('var nextState = prevState;')
    && wgsl.includes('repOut[idx] = vec4f(liveMask, nextState / 255.0, condBits, liveDisplay);'));
  check('3j true-kill latch is the u32 bit test of bit 64',
    wgsl.includes('liveTrueKill = max(liveTrueKill, select(0.0, 1.0, (u32(prev.r + 0.5) & 64u) != 0u));'));
  check('3k matched uses select(), never a ternary',
    wgsl.includes('let matched0 = select(0.0, 1.0, (tgt0 > 0.5)') && !wgsl.includes(' ? '));

  // The mask aggregate line must be textually identical to
  // the GLSL builder's (same bits, same composition).
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([
    rule('g', { type: 'force-gate', force: 'all' }, 'vel > 0.5'),
    rule('k', { type: 'kill' }),
    rule('t', { type: 'true-kill' }),
    rule('s', { type: 'set-state', state: 2 }, 'state == 1'),
  ])), OPTS);
  const maskLine = (src, prefix) => src.split('\n').map((l) => l.trim()).find((l) => l.startsWith(prefix));
  check('3l mask aggregate line identical to the GLSL builder',
    maskLine(wgsl, 'let liveMask =') !== undefined
    && maskLine(wgsl, 'let liveMask =').slice('let liveMask ='.length)
      === maskLine(frag, 'float liveMask =').slice('float liveMask ='.length),
    `${maskLine(wgsl, 'let liveMask =')} VS ${maskLine(frag, 'float liveMask =')}`);

  const wgslSdf = buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('k', { type: 'kill' }, 'sdf < 0')])), OPTS);
  check('3m sdf support emitted only when a condition reads sdf',
    typeof wgslSdf === 'string' && wgslSdf.includes('fn repSdfDistanceWgsl(p: vec3f) -> f32')
    && wgslSdf.includes('let simSdf = select(1.0e6, repSdfDistanceWgsl(simPos.xyz), ru.sdfEnabled > 0.5);')
    && !wgsl.includes('repSdfDistanceWgsl'));
  check('3n spawn builds a WGSL REP (its consumer blocks coverage, not the program)',
    typeof buildRuleEvalWgsl(resolveLiveParticleRules(J([rule('sp', { type: 'spawn' })])), OPTS) === 'string');
}

// --- 4. liveRulesWgslCoverable --------------------------------------------------
{
  const cov = (rules, extra = {}) => liveRulesWgslCoverable(resolveLiveParticleRules(J(rules)), { ...OPTS, ...extra });
  check('4a kill-only is coverable', cov([rule('k', { type: 'kill' })]) === true);
  check('4b force-gate + true-kill + set-state are coverable',
    cov([rule('g', { type: 'force-gate', force: 'vortex' }), rule('t', { type: 'true-kill' }), rule('s', { type: 'set-state', state: 1 })]) === true);
  check('4c den condition is not coverable', cov([rule('k', { type: 'kill' }, 'den > 0.5')]) === false);
  check('4d hit condition is not coverable', cov([rule('k', { type: 'kill' }, 'hits > 0')]) === false);
  check('4e ext-slot condition is not coverable', cov([rule('k', { type: 'kill' }, 'core > 0.5')]) === false);
  check('4f spawn is not coverable (Aux consumer is WebGL-only)', cov([rule('sp', { type: 'spawn' })]) === false);
  check('4g display is not coverable (points draw reads the WebGL REP)', cov([rule('d', { type: 'display', size: 2 })]) === false);
  check('4h an inert color rule never blocks', cov([rule('c', { type: 'color' }), rule('k', { type: 'kill' })]) === true);
  check('4i dynamic stage + slot-reading condition is not coverable',
    cov([rule('k', { type: 'kill' }, 'energy > 0.5')], { attrDynamicActive: true }) === false);
  check('4j dynamic stage + sim-only condition stays coverable',
    cov([rule('k', { type: 'kill' }, 'vel > 0.5')], { attrDynamicActive: true }) === true);
  check('4k slot-reading condition is coverable without a dynamic stage',
    cov([rule('k', { type: 'kill' }, 'energy > 0.5')]) === true);
}

// --- 5. capability ---------------------------------------------------------------
{
  const base = APP_STATE_DEFAULT_GPGPU;
  const reportFor = (live, extra = {}) => getWebgpuComputeCapabilityReport({ ...base, gpgpuParticleRulesLive: J(live), ...extra });
  check('5a particle-rules-live is in the supported list',
    WEBGPU_COMPUTE_SUPPORTED_FEATURES.includes('particle-rules-live'));
  check('5b particle-rules-live-full is deliberately not supported',
    !WEBGPU_COMPUTE_SUPPORTED_FEATURES.includes('particle-rules-live-full'));
  const ok = reportFor([rule('k', { type: 'kill' })]);
  check('5c a coverable config runs on WebGPU',
    ok.requestedFeatures.includes('particle-rules-live')
    && ok.supportedFeatures.includes('particle-rules-live')
    && !ok.requestedFeatures.includes('particle-rules-live-full')
    && ok.canRunRequestedConfig === true, JSON.stringify(ok));
  for (const [label, rules] of [
    ['den', [rule('k', { type: 'kill' }, 'den > 0.5')]],
    ['spawn', [rule('sp', { type: 'spawn' })]],
    ['display', [rule('d', { type: 'display', size: 1 })]],
    ['hit', [rule('k', { type: 'kill' }, 'hit > 0')]],
  ]) {
    const rep = reportFor(rules);
    check(`5d a ${label} config requests particle-rules-live-full and routes to WebGL`,
      rep.requestedFeatures.includes('particle-rules-live-full')
      && rep.unsupportedFeatures.includes('particle-rules-live-full')
      && rep.canRunRequestedConfig === false, JSON.stringify(rep));
  }
  const dyn = reportFor([rule('k', { type: 'kill' }, 'a > 0.5')], {
    gpgpuAttrDynEnabled: true, gpgpuAttrExprs: ['vel', '', '', ''],
  });
  check('5e dyn stage + slot condition routes to WebGL',
    dyn.unsupportedFeatures.includes('particle-rules-live-full') && dyn.canRunRequestedConfig === false,
    JSON.stringify(dyn));
  const dynSim = reportFor([rule('k', { type: 'kill' }, 'vel > 0.5')], {
    gpgpuAttrDynEnabled: true, gpgpuAttrExprs: ['vel', '', '', ''],
  });
  check('5f dyn stage + sim-only condition stays on WebGPU',
    !dynSim.requestedFeatures.includes('particle-rules-live-full') && dynSim.canRunRequestedConfig === true,
    JSON.stringify(dynSim));
}

// --- 6. WGSL consumption pins (source) -------------------------------------------
const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
const posWgsl = src.slice(src.indexOf('const POS_WGSL'), src.indexOf('export type WebGPUComputeState'));
{
  check('6a vel binds the live aggregate at binding 14',
    velWgsl.includes('@group(0) @binding(14) var liveTex : texture_2d<f32>;'));
  check('6b vel live segment ANDs the five permits with bits 1/2/4/8/16',
    ['rulePermitGravity = select(0.0, rulePermitGravity, (liveMask & 1u) != 0u);',
      'rulePermitTurbulence = select(0.0, rulePermitTurbulence, (liveMask & 2u) != 0u);',
      'rulePermitCurl = select(0.0, rulePermitCurl, (liveMask & 4u) != 0u);',
      'rulePermitWind = select(0.0, rulePermitWind, (liveMask & 8u) != 0u);',
      'rulePermitMorph = select(0.0, rulePermitMorph, (liveMask & 16u) != 0u);',
    ].every((s) => velWgsl.includes(s)));
  check('6c extension gates read bits 256/512/1024/2048',
    ['livePermitDrag = select(0.0, 1.0, (liveMask & 256u) != 0u);',
      'livePermitVortex = select(0.0, 1.0, (liveMask & 512u) != 0u);',
      'livePermitAttractor = select(0.0, 1.0, (liveMask & 1024u) != 0u);',
      'livePermitWell = select(0.0, 1.0, (liveMask & 2048u) != 0u);',
    ].every((s) => velWgsl.includes(s)));
  check('6d the gated applications multiply the live permits',
    velWgsl.includes('u.vortexStrength * u.delta * 80.0 * livePermitVortex;')
    && (velWgsl.match(/u\.delta \* 40\.0 \* livePermitAttractor;/g) ?? []).length === 4
    && (velWgsl.match(/u\.delta \* 2000\.0 \* livePermitWell;/g) ?? []).length === 2
    && (velWgsl.match(/u\.delta \* 50\.0 \* livePermitWell;/g) ?? []).length === 2
    && velWgsl.includes('vel *= (1.0 - 1.1 * livePermitDrag * u.delta);'));
  check('6e the live segment runs behind u.liveRulesEnabled and after the baked decode',
    velWgsl.includes('if (u.liveRulesEnabled > 0.5) {')
    && velWgsl.indexOf('u.liveRulesEnabled > 0.5') > velWgsl.indexOf('if (u.particleRulesEnabled > 0.5)'));
  check('6f pos binds the live aggregate at binding 6',
    posWgsl.includes('@group(0) @binding(6) var liveTex : texture_2d<f32>;'));
  check('6g true-kill parks with the WebGL parking form, before integration',
    posWgsl.includes('posOut[idx] = vec4f(0.0, -99999.0, 0.0, age);')
    && posWgsl.includes('(liveMaskTk & 64u) != 0u')
    && posWgsl.indexOf('vec4f(0.0, -99999.0, 0.0, age)') < posWgsl.indexOf('// Verlet integration'));
  check('6h live kill (bit 32) runs after the baked kill block',
    posWgsl.includes('(liveMask & 32u) != 0u')
    && posWgsl.indexOf('(liveMask & 32u) != 0u') > posWgsl.indexOf('(ruleMask & 32u) != 0u'));
  check('6i the flag word gates both position consumptions',
    posWgsl.includes('(u32(u.particleRuleLiveFlags + 0.5) & 2u) != 0u')
    && posWgsl.includes('(u32(u.particleRuleLiveFlags + 0.5) & 1u) != 0u'));
  check('6j uniform totals unchanged (pads repurposed, not appended)',
    src.includes('const VEL_UNIFORM_BYTES = 768;') && src.includes('const POS_UNIFORM_BYTES = 128;')
    && velWgsl.includes('liveRulesEnabled : f32,') && posWgsl.includes('particleRuleLiveFlags : f32,'));
  check('6k step writes the live uniform slots',
    src.includes('velU[185] = f && f.liveRulesEnabled ? 1 : 0;')
    && src.includes('posU[31] = ((f && f.liveRuleKillEnabled ? 1 : 0) | (f && f.liveRuleTrueKillEnabled ? 2 : 0));'));
  check('6l BGL + bind groups carry the new texture bindings',
    src.includes("{ binding: 14, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } }")
    && src.includes("{ binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } }")
    && src.includes('{ binding: 14, resource: (state.liveRep?.tex ?? state.liveDummyTex).createView() }')
    && src.includes('{ binding: 6, resource: (state.liveRep?.tex ?? state.liveDummyTex).createView() }'));
  check('6m the step evaluates + publishes the REP on the interval cadence',
    src.includes('const rep = ensureLiveRepState(state, liveEval);')
    && src.includes('if (rep.steps % interval === 0) {')
    && src.includes('enc.copyBufferToTexture(')
    && src.includes('initial[i * 4] = LIVE_RULE_MASK_FULL_PERMIT;'));
  check('6n destroy releases the live resources',
    src.includes('state.liveDummyTex.destroy();')
    && src.includes('if (state.liveRep) destroyLiveRepState(state.liveRep);'));
}

// --- 7. identity pins --------------------------------------------------------------
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  check('7a VEL_WGSL sha256 pin (live segments inert while liveRulesEnabled is 0; re-pinned for the B7 follow-up meander tail — the meander segments are inert while meanderAmount is 0)',
    sha(velWgsl) === '171b4619b7dc673112072ec9b5936ebc0cc6c70859e550ec5bb99f3412a7b084', sha(velWgsl));
  check('7b POS_WGSL sha256 pin (live segments inert while the flag word is 0)',
    sha(posWgsl) === '3f96681e29281d8c76d01ca73d5ace96f23950aa3ce375dacf92caa5c66d42bd', sha(posWgsl));
}

// --- 8. pass-layer wiring (source) ---------------------------------------------------
{
  const passesSrc = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  check('8a the WebGPU branch builds the WGSL REP from the same inputs',
    passesSrc.includes('const liveWgsl = buildRuleEvalWgsl(liveRulesResolved, {')
    && passesSrc.includes("const liveRulesResolved = resolveLiveParticleRules(config.gpgpuParticleRulesLive ?? '');"));
  check('8b the forces carry the live flags + program',
    passesSrc.includes('liveRulesEnabled: liveWgsl !== null,')
    && passesSrc.includes("liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'kill') && !args.suppressGroupKill,")
    && passesSrc.includes("liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'true-kill'),")
    && passesSrc.includes('interval: resolveAttrDynInterval(config.gpgpuRuleEvalInterval),'));
  check('8c the REP signature is namespaced and carries the texture size',
    passesSrc.includes('`repw|${config.gpgpuParticleRulesLive ?? ')
    && passesSrc.includes('|${webgpuState.texSize}`'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
