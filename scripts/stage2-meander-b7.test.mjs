/**
 * Grammar 2.0 stage 2, slice B7 (Meander promotion):
 * standalone node test.
 *
 * Pins:
 *  1 resolution (lib/gpgpuMeander.ts): defaults are the
 *    identity (standalone off, amount 0, scale 1), the AA1
 *    clamps ride along (non-finite / negative amount reads
 *    0; non-finite / <= 0 scale reads 1), and the activity
 *    predicates (standalone = enable on AND amount > 0;
 *    term = amount > 0 AND (Life on OR standalone on)).
 *  2 the law twin: a JS transcription of the GLSL term
 *    (plHash phase, 0.02 * scale, time * 0.7, the three
 *    phase-shifted sines) agrees with meanderVector +
 *    meanderPhaseForIndex — the same law both homes apply.
 *  3 the derivations: the no-meander Particle Life form
 *    differs from stock and carries no meander reference at
 *    all; the live Particle Life form differs only by the
 *    grpMeander factor on the application line; the
 *    standalone chunk's law lines (trimmed) are the in-block
 *    law lines; its live form gates the application once.
 *  4 default identity: SIM_VEL_FRAG / SIM_POS_FRAG keep
 *    their sha256 pins; the default assembly is the stock
 *    main-forces string; an explicit meanderStandalone:false
 *    build is the stock velocity fragment.
 *  5 standalone assembly: exactly one meander application
 *    (the chunk's), the Particle Life copy suppressed; a
 *    custom force order placing 'meander' first is honoured.
 *  6 live gating at the string level: live-only assembly
 *    gates the INTERNAL term (Particle Life live form, one
 *    gated application, grpMeander declared + bit-14 line);
 *    standalone+live gates the CHUNK's application and has
 *    no plain meander application left.
 *  7 the REP gate: bit 14 (16384), full permit 24351; the
 *    'meander' target parses, classifies live and is WGSL
 *    coverable; CPU-twin permit semantics (no rules = full;
 *    matched keeps the bit; unmatched loses only bit 14;
 *    an 'all' gate never restricts meander); the REP
 *    fragment and its WGSL twin carry fgMeander + the mask
 *    term with the right initial value.
 *  8 texture units: the standalone variant adds NO sampler
 *    declaration in any combination (stock / live / fields).
 *  9 capability: 'meander-standalone' was requested (and
 *    unsupported — WebGL fallback) only while the standalone
 *    stood, at B7 time; the WGSL follow-up implemented the
 *    term and retired the declaration, so nothing requests
 *    it now (pinned by stage2-meander-wgsl.test.mjs).
 * 10 key registration: gpgpuMeanderEnabled defaults false.
 */
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b7-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;
const samplerCount = (s) => (s.match(/uniform sampler2D /g) || []).length;

await build({
  stdin: {
    contents: `
      export { resolveMeander, meanderStandaloneActive, meanderTermActive } from './lib/gpgpuMeander.ts';
      export { meanderVector, meanderPhaseForIndex } from './lib/particleLifeBehavior.ts';
      export { dmHash11 } from './lib/gpgpuRandom.ts';
      export { SIM_VEL_FRAG, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { VEL_FRAG_MAIN_FORCES, buildMainForcesFragment, VEL_FRAG_FORCE_PARTICLE_LIFE, VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER, VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE, VEL_FRAG_FORCE_MEANDER, VEL_FRAG_FORCE_MEANDER_LIVE } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { parseLiveParticleRules, resolveLiveParticleRules, classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment, buildRuleEvalWgsl, liveRulesWgslCoverable, LIVE_RULE_MEANDER_FORCE_BIT, LIVE_RULE_MASK_FULL_PERMIT } from './lib/gpgpuParticleRulesLive.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveMeander, meanderStandaloneActive, meanderTermActive,
  meanderVector, meanderPhaseForIndex, dmHash11,
  SIM_VEL_FRAG, buildVelocityFragment, SIM_POS_FRAG,
  VEL_FRAG_MAIN_FORCES, buildMainForcesFragment,
  VEL_FRAG_FORCE_PARTICLE_LIFE, VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER,
  VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE, VEL_FRAG_FORCE_MEANDER, VEL_FRAG_FORCE_MEANDER_LIVE,
  parseLiveParticleRules, resolveLiveParticleRules, classifyLiveRules,
  evaluateLiveRuleStep, buildRuleEvalFragment, buildRuleEvalWgsl,
  liveRulesWgslCoverable, LIVE_RULE_MEANDER_FORCE_BIT, LIVE_RULE_MASK_FULL_PERMIT,
  getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['e', 'f', 'g', 'h'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const J = (v) => JSON.stringify(v);
const rule = (id, action, condition = '', target = { type: 'all' }) => ({ id, enabled: true, target, condition, action });
const classify = (rules) => classifyLiveRules(resolveLiveParticleRules(J(rules)), OPTS);
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
const step = (classified, vars = {}) => evaluateLiveRuleStep(classified, {
  slots: ZEROS,
  vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, ...vars },
});
const hasBit = (mask, bit) => (mask & bit) !== 0;
const APP_LINE = 'vel += mVec * uParticleLifeMeanderAmount * uDelta * 30.0;';
const APP_LINE_GATED = 'vel += mVec * uParticleLifeMeanderAmount * uDelta * 30.0 * grpMeander;';

// ── 1. Resolution ────────────────────────────────────────
{
  const d = resolveMeander({});
  check('1 defaults resolve to the identity (off / 0 / 1)',
    d.enabled === false && d.amount === 0 && d.scale === 1);
  check('1 AA1 clamps ride along (amount floor 0, scale fallback 1)',
    resolveMeander({ gpgpuParticleLifeMeanderAmount: -2 }).amount === 0
    && resolveMeander({ gpgpuParticleLifeMeanderAmount: NaN }).amount === 0
    && resolveMeander({ gpgpuParticleLifeMeanderAmount: 2.5 }).amount === 2.5
    && resolveMeander({ gpgpuParticleLifeMeanderScale: 0 }).scale === 1
    && resolveMeander({ gpgpuParticleLifeMeanderScale: -1 }).scale === 1
    && resolveMeander({ gpgpuParticleLifeMeanderScale: 3 }).scale === 3);
  check('1 standalone stands only on enable AND amount > 0',
    meanderStandaloneActive({ gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 1 }) === true
    && meanderStandaloneActive({ gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 0 }) === false
    && meanderStandaloneActive({ gpgpuMeanderEnabled: false, gpgpuParticleLifeMeanderAmount: 1 }) === false
    && meanderStandaloneActive({}) === false);
  check('1 term activity covers both homes',
    meanderTermActive({ gpgpuParticleLifeEnabled: true, gpgpuParticleLifeMeanderAmount: 1 }) === true
    && meanderTermActive({ gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 1 }) === true
    && meanderTermActive({ gpgpuParticleLifeMeanderAmount: 1 }) === false
    && meanderTermActive({ gpgpuParticleLifeEnabled: true, gpgpuParticleLifeMeanderAmount: 0 }) === false);
}

// ── 2. Law twin ──────────────────────────────────────────
{
  // GLSL transcription: plHash(n) = dmHash11(n * 3.71 + 17.17),
  // called as plHash(selfIdx + 17.17); phase * 6.2831853.
  const glslTerm = (idx, pos, scaleKey, time) => {
    const phase = dmHash11((idx + 17.17) * 3.71 + 17.17) * 6.2831853;
    const s = 0.02 * Math.max(scaleKey, 0.001);
    const t = time * 0.7;
    return {
      x: Math.sin(pos.y * s + phase + t),
      y: Math.sin(pos.z * s + phase * 1.7 + t),
      z: Math.sin(pos.x * s + phase * 2.3 + t),
    };
  };
  let maxErr = 0;
  for (const [idx, pos, scale, time] of [
    [0, { x: 1, y: 2, z: 3 }, 1, 0.5],
    [17, { x: -4, y: 0.25, z: 9 }, 2, 2.0],
    [123, { x: 40, y: -17, z: 3.5 }, 0.5, 11.3],
    [4095, { x: 0, y: 0, z: 0 }, 5, 0],
  ]) {
    const g = glslTerm(idx, pos, scale, time);
    const c = meanderVector(pos, meanderPhaseForIndex(idx), scale, time);
    maxErr = Math.max(maxErr, Math.abs(g.x - c.x), Math.abs(g.y - c.y), Math.abs(g.z - c.z));
  }
  check('2 GLSL term transcription agrees with the CPU twin (meanderVector)',
    maxErr < 1e-5, String(maxErr));
}

// ── 3. Derivations ───────────────────────────────────────
{
  check('3 no-meander Particle Life form: differs, no meander reference left',
    VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER !== VEL_FRAG_FORCE_PARTICLE_LIFE
    && count(VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER, 'uParticleLifeMeanderAmount') === 0
    && count(VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER, 'uParticleLifeMeanderScale') === 0
    && count(VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER, 'mVec') === 0);
  check('3 live Particle Life form: exactly one gated application, guard intact',
    VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE !== VEL_FRAG_FORCE_PARTICLE_LIFE
    && count(VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE, APP_LINE_GATED) === 1
    && count(VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE, APP_LINE) === 0
    && VEL_FRAG_FORCE_PARTICLE_LIFE_LIVE.includes('if (uParticleLifeMeanderAmount > 0.0) {'));
  const lawLines = (s) => s.split('\n').map((l) => l.trim()).filter((l) =>
    l.startsWith('float selfIdx') || l.startsWith('float mPhase') || l.startsWith('float mScale')
    || l.startsWith('float mTime') || l.startsWith('sin(') || l.startsWith('vel += mVec'));
  check('3 standalone chunk carries the same law lines as the in-block term',
    J(lawLines(VEL_FRAG_FORCE_MEANDER)) === J(lawLines(VEL_FRAG_FORCE_PARTICLE_LIFE)),
    J(lawLines(VEL_FRAG_FORCE_MEANDER)));
  check('3 standalone live form gates its application exactly once',
    VEL_FRAG_FORCE_MEANDER_LIVE !== VEL_FRAG_FORCE_MEANDER
    && count(VEL_FRAG_FORCE_MEANDER_LIVE, APP_LINE_GATED) === 1
    && count(VEL_FRAG_FORCE_MEANDER_LIVE, APP_LINE) === 0);
}

// ── 4. Default identity ──────────────────────────────────
{
  check('4 SIM_VEL_FRAG keeps its sha256 pin',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha256(SIM_VEL_FRAG));
  check('4 SIM_POS_FRAG keeps its sha256 pin',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha256(SIM_POS_FRAG));
  check('4 default assembly is the stock main-forces string',
    buildMainForcesFragment() === VEL_FRAG_MAIN_FORCES
    && buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG
    && buildVelocityFragment('', undefined, { meanderStandalone: false }) === SIM_VEL_FRAG);
}

// ── 5. Standalone assembly ───────────────────────────────
{
  const standalone = buildMainForcesFragment(undefined, { meanderStandalone: true });
  check('5 standalone assembly applies the term exactly once (from the chunk)',
    count(standalone, APP_LINE) === 1 && count(standalone, APP_LINE_GATED) === 0,
    `${count(standalone, APP_LINE)}/${count(standalone, APP_LINE_GATED)}`);
  check('5 the in-block copy is suppressed while the standalone stands',
    count(standalone, 'uParticleLifeMeanderAmount') === 2
    && standalone.includes(VEL_FRAG_FORCE_PARTICLE_LIFE_NO_MEANDER));
  const order = ['meander', 'particle-life', 'turbulence', 'curl'];
  const custom = buildMainForcesFragment(order, { meanderStandalone: true, steeringSeek: false });
  check('5 a custom order placing meander first is honoured',
    custom.indexOf('// Meander (Grammar 2.0 stage 2, B7)') >= 0
    && custom.indexOf('// Meander (Grammar 2.0 stage 2, B7)') < custom.indexOf('Particle Life')
    && count(custom, APP_LINE) === 1);
  const off = buildMainForcesFragment(order, {});
  check('5 the same order without the variant splices no meander chunk',
    !off.includes('// Meander (Grammar 2.0 stage 2, B7)') && count(off, APP_LINE) === 1);
}

// ── 6. Live gating (string level) ────────────────────────
{
  const liveOnly = buildMainForcesFragment(undefined, { particleRulesLive: true });
  check('6 live-only assembly gates the internal term',
    count(liveOnly, APP_LINE_GATED) === 1 && count(liveOnly, APP_LINE) === 0
    && liveOnly.includes('float grpMeander = 1.0;')
    && liveOnly.includes('grpMeander *= mod(floor(liveMask / 16384.0), 2.0);'));
  const both = buildMainForcesFragment(undefined, { particleRulesLive: true, meanderStandalone: true });
  check('6 standalone+live gates the chunk application, no plain application left',
    count(both, APP_LINE_GATED) === 1 && count(both, APP_LINE) === 0);
  const vel = buildVelocityFragment('', undefined, { particleRulesLive: true, meanderStandalone: true });
  check('6 the built velocity fragment carries grpMeander end to end',
    vel.includes('float grpMeander = 1.0;') && vel.includes(APP_LINE_GATED));
}

// ── 7. REP gate ──────────────────────────────────────────
{
  check('7 meander bit is 14 (16384); full permit is 24351',
    LIVE_RULE_MEANDER_FORCE_BIT === 16384 && LIVE_RULE_MASK_FULL_PERMIT === 24351);
  const parsed = parseLiveParticleRules(J([rule('x', { type: 'force-gate', force: 'meander' })]));
  check("7 force-gate target 'meander' parses and is kept",
    parsed.length === 1 && parsed[0].action.force === 'meander', J(parsed));
  const gated = classify([rule('x', { type: 'force-gate', force: 'meander' }, 'vel > 0.5')]);
  check('7 a meander gate rule classifies live',
    gated.length === 1 && gated[0].route === 'live', J(gated.map((g) => g.route)));
  check('7 no rules: every permit stands, meander included (mask 24351)',
    step(classify([])).mask === 24351, String(step(classify([])).mask));
  const hit = step(gated, { vel: 1 });
  const miss = step(gated, { vel: 0 });
  check('7 matched meander gate keeps bit 14; unmatched loses only bit 14',
    hasBit(hit.mask, 16384) && !hasBit(miss.mask, 16384) && miss.mask === 24351 - 16384,
    `${hit.mask}/${miss.mask}`);
  const allMiss = step(classify([rule('x', { type: 'force-gate', force: 'all' }, 'vel > 100')]), { vel: 0 });
  check("7 an 'all' gate never restricts meander (unmatched loses the G10 five only)",
    hasBit(allMiss.mask, 16384) && allMiss.mask === 24351 - 31, String(allMiss.mask));
  const frag = buildRuleEvalFragment([rule('x', { type: 'force-gate', force: 'meander' })], OPTS);
  check('7 REP fragment: fgMeander starts denied for a restricted meander, mask term present',
    typeof frag === 'string' && frag.includes('float fgMeander = 0.0;') && frag.includes('fgMeander * 16384.0'));
  const fragOpen = buildRuleEvalFragment([rule('x', { type: 'force-gate', force: 'gravity' })], OPTS);
  check('7 REP fragment: fgMeander starts permitted when no rule names meander',
    typeof fragOpen === 'string' && fragOpen.includes('float fgMeander = 1.0;'));
  const wgsl = buildRuleEvalWgsl([rule('x', { type: 'force-gate', force: 'meander' })], OPTS);
  check('7 WGSL twin: var fgMeander init + identical mask term',
    typeof wgsl === 'string' && wgsl.includes('var fgMeander = 0.0;') && wgsl.includes('fgMeander * 16384.0'));
  check('7 a meander gate rule is WGSL-coverable',
    liveRulesWgslCoverable([rule('x', { type: 'force-gate', force: 'meander' })], OPTS) === true);
}

// ── 8. Texture units ─────────────────────────────────────
{
  const stock = samplerCount(SIM_VEL_FRAG);
  check('8 standalone adds no sampler declaration (stock / live / fields)',
    samplerCount(buildVelocityFragment('', undefined, { meanderStandalone: true })) === stock
    && samplerCount(buildVelocityFragment('', undefined, { meanderStandalone: true, particleRulesLive: true }))
      === samplerCount(buildVelocityFragment('', undefined, { particleRulesLive: true }))
    && samplerCount(buildVelocityFragment('', undefined, { meanderStandalone: true, fieldInstances: true }))
      === samplerCount(buildVelocityFragment('', undefined, { fieldInstances: true })),
    `stock=${stock}`);
}

// ── 9. Capability ────────────────────────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  check('9 defaults do not request meander-standalone',
    !getWebgpuComputeCapabilityReport(base).requestedFeatures.includes('meander-standalone'));
  const legacy = getWebgpuComputeCapabilityReport({ ...base, gpgpuParticleLifeEnabled: true, gpgpuParticleLifeMeanderAmount: 1 });
  check('9 the legacy in-block config does not request it either',
    !legacy.requestedFeatures.includes('meander-standalone'));
  const on = getWebgpuComputeCapabilityReport({ ...base, gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 1 });
  check('9 standalone no longer requests the retired gap feature (WGSL term landed in the follow-up)',
    !on.requestedFeatures.includes('meander-standalone') && !on.unsupportedFeatures.includes('meander-standalone'));
  const zero = getWebgpuComputeCapabilityReport({ ...base, gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 0 });
  check('9 enable on with amount 0 does not request it (the variant never stands)',
    !zero.requestedFeatures.includes('meander-standalone'));
}

// ── 10. Key registration ─────────────────────────────────
{
  check('10 new key sits at its default',
    APP_STATE_DEFAULT_GPGPU.gpgpuMeanderEnabled === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
