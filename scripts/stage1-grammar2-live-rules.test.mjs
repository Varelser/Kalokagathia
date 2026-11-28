// Grammar 2.0 stage 1, slice 1A — live particle rules
// (lib/gpgpuParticleRulesLive.ts): the REP, the live
// force-gate / kill consumption, and the identity discipline.
// Design: kalokagathia-pro/STAGE1_GRAMMAR2_DESIGN.md.
//
// Cases:
//  1 parse/validate: broken inputs fall back wholesale /
//    per-rule (G10 discipline), caps, duplicate first-wins
//  2 the extended action union parses and is KEPT (deferred
//    actions are not dropped)
//  3 classification: live / baked-fallback / never routes
//    (uncompilable, den without density, snapshot group,
//    dangling group, predicate group)
//  4 CPU twin vs the baked G10 aggregate: an always-true and
//    a vel-conditioned force-gate produce the same permit
//    sets on both routes
//  5 bit layout (design section 4)
//  6 identity: with no live option the generated velocity /
//    position strings are the shipped ones (sha256 pins
//    measured on the product tree, v2.22.0)
//  7 splicing: the live segments exist only in the live
//    variants, in the right composition order
//  8 REP fragment builder: null cases, state carry, den /
//    sim conditional emission
//  9 capability: live rules request the unsupported
//    'particle-rules-live' feature (routes to WebGL)
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1a-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, hasEffectiveLiveRules, liveRulesHaveAction, liveRulesHaveConsumedAction, serializeLiveParticleRules, isDefaultLiveParticleRules, validateLiveParticleRule, classifyLiveRules, evaluateLiveRuleMask, buildRuleEvalFragment, liveRuleConditionVariables, LIVE_RULE_FORCE_BITS, LIVE_RULE_KILL_BIT, LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_FRACTURE_BIT, LIVE_RULE_EXT_FORCE_BITS, LIVE_RULE_CUSTOM_FORCE_BIT, LIVE_RULE_MEANDER_FORCE_BIT, LIVE_RULE_MASK_ALL_PERMIT } from './lib/gpgpuParticleRulesLive.ts';
      export { applyParticleRulesToBake } from './lib/gpgpuParticleRules.ts';
      export { attrSimValues } from './lib/gpgpuAttributes.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
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
  parseLiveParticleRules, resolveLiveParticleRules, hasEffectiveLiveRules,
  liveRulesHaveAction, liveRulesHaveConsumedAction, serializeLiveParticleRules,
  isDefaultLiveParticleRules, classifyLiveRules, evaluateLiveRuleMask,
  buildRuleEvalFragment, LIVE_RULE_FORCE_BITS, LIVE_RULE_KILL_BIT,
  LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_FRACTURE_BIT, LIVE_RULE_EXT_FORCE_BITS,
  LIVE_RULE_CUSTOM_FORCE_BIT, LIVE_RULE_MEANDER_FORCE_BIT, LIVE_RULE_MASK_ALL_PERMIT,
} = lib;
const { applyParticleRulesToBake, attrSimValues } = lib;
const { buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const J = (v) => JSON.stringify(v);

// --- 1. parse / validate ------------------------------------------------
check('1a empty / non-JSON / non-array parse to []',
  parseLiveParticleRules('').length === 0
  && parseLiveParticleRules('not json').length === 0
  && parseLiveParticleRules('{"a":1}').length === 0
  && parseLiveParticleRules(null).length === 0);
check('1b oversized payload falls back wholesale',
  parseLiveParticleRules(' '.repeat(100_001)).length === 0);
{
  const mixed = parseLiveParticleRules(J([
    rule('ok', { type: 'kill' }),
    rule('bad id!', { type: 'kill' }),
    rule('ok', { type: 'force-gate', force: 'wind' }), // duplicate: first wins
    { id: 'noact', enabled: true, target: { type: 'all' }, condition: '' },
    rule('badact', { type: 'explode' }),
    rule('badtarget', { type: 'kill' }, '', { type: 'predicate', slot: 9, mode: 'above', low: 0, high: 1, invert: false }),
    rule('off', { type: 'kill' }, '', { type: 'all' }, { enabled: false }),
  ]));
  check('1c broken rules drop individually, duplicate first wins',
    mixed.length === 2 && mixed[0].id === 'ok' && mixed[0].action.type === 'kill' && mixed[1].id === 'off',
    JSON.stringify(mixed.map((r) => r.id)));
  check('1d disabled rules parse but do not resolve',
    resolveLiveParticleRules(J(mixed)).length === 1 && !hasEffectiveLiveRules(J([mixed[1]])));
}
{
  const many = Array.from({ length: 20 }, (_, i) => rule(`r${i}`, { type: 'kill' }));
  check('1e rule cap is 16', parseLiveParticleRules(J(many)).length === 16);
}
check('1f serialize roundtrip + empty is ""',
  serializeLiveParticleRules([]) === ''
  && parseLiveParticleRules(serializeLiveParticleRules([rule('x', { type: 'kill' })])).length === 1
  && isDefaultLiveParticleRules('') && isDefaultLiveParticleRules(null) && !isDefaultLiveParticleRules(J([rule('x', { type: 'kill' })])));

// --- 2. extended action union is kept ------------------------------------
{
  const kept = parseLiveParticleRules(J([
    rule('tk', { type: 'true-kill' }),
    rule('fr', { type: 'fracture' }),
    rule('dp', { type: 'display', size: 0.5, opacity: 2 }),
    rule('ss', { type: 'set-state', state: 300 }),
    rule('sg', { type: 'set-group', id: 'g1' }),
    rule('cl', { type: 'color', color: [1, 0.5, 0] }),
  ]));
  check('2a deferred actions parse and are kept (clamped)',
    kept.length === 6
    && kept[2].action.size === 0.5 && kept[2].action.opacity === 1
    && kept[3].action.state === 255,
    JSON.stringify(kept.map((r) => r.action.type)));
  // Slice 1C update: true-kill / fracture / display became
  // consumed in 1C; 'color' is the one still-deferred action.
  check('2b color is still not consumed; set-state / set-group since 1B, true-kill / fracture / display since 1C',
    !liveRulesHaveConsumedAction(J(kept.filter((r) => ['color'].includes(r.action.type))))
    && liveRulesHaveAction(J(kept), 'true-kill')
    && liveRulesHaveConsumedAction(J([rule('k', { type: 'kill' })]))
    && liveRulesHaveConsumedAction(J([rule('ss', { type: 'set-state', state: 1 })]))
    && liveRulesHaveConsumedAction(J([rule('sg', { type: 'set-group', id: 'g1' })]))
    && liveRulesHaveConsumedAction(J([rule('tk', { type: 'true-kill' })]))
    && liveRulesHaveConsumedAction(J([rule('fr', { type: 'fracture' })]))
    && liveRulesHaveConsumedAction(J([rule('dp', { type: 'display', size: 0.5, opacity: 1 })])));
}

// --- 3. classification ----------------------------------------------------
const classify = (rules, opts = {}) => classifyLiveRules(resolveLiveParticleRules(J(rules)), {
  names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: false, ...opts,
});
check('3a always-true and live-var conditions classify live',
  classify([rule('a', { type: 'force-gate', force: 'gravity' })])[0].route === 'live'
  && classify([rule('b', { type: 'kill' }, '(vel > 1) * (age < 0.5)')])[0].route === 'live'
  && classify([rule('c', { type: 'kill' }, 'state == 2')])[0].route === 'live');
check('3b uncompilable condition is never (kept, never matches)',
  classify([rule('a', { type: 'kill' }, 'nosuchvar > 1')])[0].route === 'never'
  && classify([rule('a', { type: 'kill' }, 'vel >>')])[0].route === 'never');
check('3c den without the density pass falls back to baked; with it, live',
  classify([rule('a', { type: 'kill' }, 'den > 0.5')])[0].route === 'baked-fallback'
  && classify([rule('a', { type: 'kill' }, 'den > 0.5')], { densityAvailable: true })[0].route === 'live');
{
  const defs = [
    { id: 'pred', name: 'P', source: { kind: 'predicate', predicate: { slot: 0, mode: 'above', low: 0.5, high: 1, invert: false } } },
    { id: 'snap', name: 'S', source: { kind: 'snapshot', indicesB64: '' } },
  ];
  const via = (id) => classify([rule('a', { type: 'kill' }, '', { type: 'group', id })], { groupDefs: defs })[0].route;
  check('3d predicate group is live; snapshot / dangling groups fall back',
    via('pred') === 'live' && via('snap') === 'baked-fallback' && via('missing') === 'baked-fallback');
}

// --- 4. CPU twin vs baked aggregate ---------------------------------------
const ATTR = new Float32Array([
  0.9, 0.1, 0.0, 0.7,
  0.2, 0.9, 0.0, 0.3,
  0.6, 0.6, 0.0, 0.5,
  0.1, 0.2, 0.0, 0.9,
]);
const POS = new Float32Array([0, 0, 0, 0, 3, 0, 0, 5, 0, 4, 0, 10, 0, 0, 1, 2.5]);
const VEL = new Float32Array([3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0]);
function bakedMask(condition, action) {
  const out = applyParticleRulesToBake({
    rules: [{ id: 'b', enabled: true, target: { type: 'all' }, condition, action }],
    groupDefs: [], attrData: ATTR, count: 4, names: NAMES, names2: NAMES2,
    posData: POS, velData: VEL, ageMax: 10, bounceRadius: 5,
  });
  return [0, 1, 2, 3].map((i) => out[i * 4 + 3]);
}
function liveMask(condition, action) {
  const classified = classify([rule('l', action, condition)]);
  return [0, 1, 2, 3].map((i) => {
    const sim = attrSimValues(POS[i * 4], POS[i * 4 + 1], POS[i * 4 + 2], POS[i * 4 + 3],
      VEL[i * 4], VEL[i * 4 + 1], VEL[i * 4 + 2], 10, 5);
    const slots = [ATTR[i * 4], ATTR[i * 4 + 1], ATTR[i * 4 + 2], ATTR[i * 4 + 3], 0, 0, 0, 0];
    const vars = { vel: sim.vel, age: sim.age, rad: sim.rad, t: 0, state: 0, den: 0, a: slots[0], b: slots[1], c: slots[2], d: slots[3], i: 0, j: 0, k: 0, l: 0 };
    // Slice 1C: the live mask also carries the extension
    // forces' permit bits (8-11), which have no baked
    // counterpart — the comparison domain here is the G10
    // domain (bits 0-5). The extension bits are pinned by
    // the slice-1C suite.
    return evaluateLiveRuleMask(classified, { slots, vars }).mask & 63;
  });
}
check('4a always-true force-gate: live permit set == baked permit set',
  JSON.stringify(liveMask('', { type: 'force-gate', force: 'gravity' })) === JSON.stringify(bakedMask('', { type: 'force-gate', force: 'gravity' })),
  JSON.stringify(liveMask('', { type: 'force-gate', force: 'gravity' })));
check('4b vel-conditioned force-gate: live permit set == baked permit set',
  JSON.stringify(liveMask('vel > 1', { type: 'force-gate', force: 'all' })) === JSON.stringify(bakedMask('vel > 1', { type: 'force-gate', force: 'all' })),
  `${JSON.stringify(liveMask('vel > 1', { type: 'force-gate', force: 'all' }))} vs ${JSON.stringify(bakedMask('vel > 1', { type: 'force-gate', force: 'all' }))}`);
check('4c kill: live mask carries bit5 exactly where baked does',
  JSON.stringify(liveMask('vel > 1', { type: 'kill' })) === JSON.stringify(bakedMask('vel > 1', { type: 'kill' })));

// --- 5. bit layout ----------------------------------------------------------
check('5a bit layout matches design section 4',
  LIVE_RULE_FORCE_BITS.gravity === 1 && LIVE_RULE_FORCE_BITS.turbulence === 2
  && LIVE_RULE_FORCE_BITS.curl === 4 && LIVE_RULE_FORCE_BITS.wind === 8
  && LIVE_RULE_FORCE_BITS.morph === 16 && LIVE_RULE_KILL_BIT === 32
  && LIVE_RULE_TRUE_KILL_BIT === 64 && LIVE_RULE_FRACTURE_BIT === 128
  && LIVE_RULE_EXT_FORCE_BITS.drag === 256 && LIVE_RULE_EXT_FORCE_BITS.vortex === 512
  && LIVE_RULE_EXT_FORCE_BITS.attractor === 1024 && LIVE_RULE_EXT_FORCE_BITS.well === 2048
  && LIVE_RULE_MASK_ALL_PERMIT === 31);
{
  const classified = classify([rule('k', { type: 'kill' })]);
  const { mask, matched } = evaluateLiveRuleMask(classified, { slots: [0, 0, 0, 0, 0, 0, 0, 0], vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0 } });
  // Slice 1C: the full-permit value now includes the
  // extension forces' permit bits (31 + 3840 = 3871).
  // External-force general form: the custom-force permit
  // (bit 12, 4096) joins it too — full permit is now 7967.
  // Stage 2 B7: the Meander permit (bit 14, 16384) joins
  // as well — full permit is now 24351.
  const extPermit = LIVE_RULE_EXT_FORCE_BITS.drag + LIVE_RULE_EXT_FORCE_BITS.vortex
    + LIVE_RULE_EXT_FORCE_BITS.attractor + LIVE_RULE_EXT_FORCE_BITS.well;
  check('5b unrestricted forces stay permitted (incl. 1C extension permits); kill ORs in',
    mask === 31 + extPermit + LIVE_RULE_CUSTOM_FORCE_BIT + LIVE_RULE_MEANDER_FORCE_BIT + 32 && matched.length === 1,
    String(mask));
}

// --- 6. identity pins -------------------------------------------------------
const sha = (s) => createHash('sha256').update(s).digest('hex');
check('6a default velocity string is the shipped v2.25.0 string (統合時点)',
  sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
  sha(SIM_VEL_FRAG));
check('6b default position string is the shipped v2.25.0 string (統合時点)',
  sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
  sha(SIM_POS_FRAG));
check('6c builders without the live option return the defaults',
  buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG
  && buildVelocityFragment('', undefined, { particleRules: true }) !== SIM_VEL_FRAG
  && buildPositionFragment({}) === SIM_POS_FRAG
  && buildPositionFragment({ particleRules: true }) !== SIM_POS_FRAG);

// --- 7. splicing ------------------------------------------------------------
{
  const velLive = buildVelocityFragment('', undefined, { particleRulesLive: true });
  const velBoth = buildVelocityFragment('', undefined, { particleRules: true, particleRulesLive: true });
  check('7a velocity live segment + uniforms exist only in the live variant',
    velLive.includes('uRuleLiveTex') && velLive.includes('uRuleLiveEnabled')
    && velLive.includes('Live particle rules (Grammar 2.0 1A): REP permit mask')
    && !SIM_VEL_FRAG.includes('uRuleLiveTex'));
  check('7b live segment ANDs after the baked segment',
    velBoth.indexOf('Baked permit mask, slot 3') < velBoth.indexOf('REP permit mask')
    || (velBoth.indexOf('baked permit mask') >= 0 && velBoth.indexOf('REP permit mask') > velBoth.indexOf('baked permit mask')));
  const posLive = buildPositionFragment({ particleRulesLive: true });
  const posBoth = buildPositionFragment({ particleRules: true, particleRulesLive: true });
  check('7c position live kill segment exists only in the live variant, after baked kill',
    posLive.includes('uParticleRuleLiveKillEnabled') && posLive.includes('Live particle rule kill')
    && !SIM_POS_FRAG.includes('uRuleLiveTex')
    && posBoth.indexOf('Particle rule kill (G10 stage 1)') < posBoth.indexOf('Live particle rule kill'));
}

// --- 8. REP fragment ----------------------------------------------------------
{
  const opts = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: false };
  // Slice 1C update: a true-kill-only list now builds the
  // fragment (consumed since 1C); the still-deferred case is
  // a color-only list.
  check('8a fragment is null with no rules / only deferred (color) / only fallback rules',
    buildRuleEvalFragment([], opts) === null
    && buildRuleEvalFragment(resolveLiveParticleRules(J([rule('t', { type: 'color', color: [1, 0, 0] })])), opts) === null
    && buildRuleEvalFragment(resolveLiveParticleRules(J([rule('d', { type: 'kill' }, 'den > 0.5')])), opts) === null);
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('g', { type: 'force-gate', force: 'gravity' }, 'vel > 1')])), opts);
  check('8b fragment carries prev-state, sim sampling and the mask output',
    typeof frag === 'string'
    && frag.includes('uniform sampler2D uPrevTex;')
    && frag.includes('float prevState = floor(prev.g * 255.0 + 0.5);')
    && frag.includes('nextState / 255.0')
    && frag.includes('simVelMag')
    && frag.includes('float liveMask'));
  const fragDen = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('d', { type: 'kill' }, 'den > 0.5')])), { ...opts, densityAvailable: true });
  check('8c den fragment declares the density supply only when used',
    typeof fragDen === 'string' && fragDen.includes('uDenTex') && !frag.includes('uDenTex'));
  const fragPlain = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('g', { type: 'force-gate', force: 'all' })])), opts);
  check('8d no sim / den / ext lines when no condition reads them',
    typeof fragPlain === 'string' && !fragPlain.includes('uPosTex') && !fragPlain.includes('uExtTex'));
}

// --- 9. capability ------------------------------------------------------------
{
  const base = lib.APP_STATE_DEFAULT_GPGPU;
  check('9a new keys default to the identity state',
    base.gpgpuParticleRulesLive === '' && base.gpgpuRuleEvalInterval === 1);
  // Updated by the WGSL slice (was: "live rules request
  // particle-rules-live and it is unsupported"): the WGSL REP
  // + consumption now stand, so a WGSL-coverable live config
  // is supported on the WebGPU route, while a config reaching
  // past the subset (here a den condition, which has no WGSL
  // supply) requests particle-rules-live-full and stays
  // unsupported. Full coverage matrix: the WGSL slice's own
  // test (stage1-grammar2-wgsl).
  const report = lib.getWebgpuComputeCapabilityReport({ ...base, gpgpuParticleRulesLive: J([rule('k', { type: 'kill' })]) });
  const requested = report.requestedFeatures ?? report.requested ?? [];
  const unsupported = report.unsupportedFeatures ?? report.unsupported ?? [];
  check('9b live rules request particle-rules-live and a kill-only config is WGSL-supported',
    lib.WEBGPU_COMPUTE_SUPPORTED_FEATURES.includes('particle-rules-live')
    && requested.includes('particle-rules-live')
    && !unsupported.includes('particle-rules-live')
    && !requested.includes('particle-rules-live-full'),
    JSON.stringify({ requested, unsupported }));
  const reportDen = lib.getWebgpuComputeCapabilityReport({ ...base, gpgpuParticleRulesLive: J([rule('k', { type: 'kill' }, 'den > 0.5')]) });
  check('9b2 a den-reading live config requests particle-rules-live-full and stays on WebGL',
    reportDen.requestedFeatures.includes('particle-rules-live-full')
    && reportDen.unsupportedFeatures.includes('particle-rules-live-full')
    && reportDen.canRunRequestedConfig === false,
    JSON.stringify(reportDen));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
