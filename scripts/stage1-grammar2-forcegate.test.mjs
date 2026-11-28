// Grammar 2.0 stage 1 — force-gate gravity fix (real-GPU
// gate finding, C2/C5 re-measure 2026-11-27): the custom
// force's gate blocked correctly while gravity's gate never
// took effect. Cause: gravity is the one gated force applied
// in the fixed main-forces HEAD, which sits BEFORE the point
// where buildMainForcesFragment splices the baked (G10) and
// live (1A) permit segments — both segments multiplied
// grpGravity only after gravity had already been accumulated
// into vel. The fix relocates the gravity line in the rule
// variants only: lifted out of the head and re-applied
// verbatim right after the segments, still ahead of every
// force chunk. Record: kalokagathia-pro/
// STAGE1_FORCEGATE_FIX_RECORD.md.
//
// Cases:
//  1 identity: the no-option assembly and every non-rule
//    variant keep the gravity line inside the head (exactly
//    one occurrence, no permit segment, no relocation
//    comment) — the stock strings are untouched.
//  2 relocation: in the baked / live / both variants the
//    gravity line occurs exactly once, AFTER the permit
//    segment(s) that multiply grpGravity and BEFORE the
//    first force chunk; the grpGravity multiplications
//    precede it.
//  3 composition: the relocation composes with the other
//    head derivations (spawnAlloc, emitterVelocity, crowd)
//    and with a custom-force snippet (grpCustom gating and
//    the relocated gravity coexist, gravity after the live
//    segment).
//  4 derivation safety: the stock head carries the gravity
//    line exactly once (the .replace anchor is unambiguous).
//  5 WGSL twin: the WebGPU velocity kernel composes the
//    live permit into rulePermitGravity BEFORE its single
//    gravity application (source-order pin — the WGSL route
//    never had the ordering defect).
//  6 permit semantics (CPU twin): a force-gate on gravity
//    clears mask bit 0 for unmatched particles and sets it
//    for matched ones; a display rule's REP value is
//    1 + size (the C3 display chain's source value).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1fg-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildMainForcesFragment, VEL_FRAG_MAIN_FORCES, VEL_FRAG_MAIN_FORCES_HEAD } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { resolveLiveParticleRules, classifyLiveRules, evaluateLiveRuleStep, LIVE_RULE_FORCE_BITS } from './lib/gpgpuParticleRulesLive.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildMainForcesFragment, VEL_FRAG_MAIN_FORCES, VEL_FRAG_MAIN_FORCES_HEAD,
  buildVelocityFragment, SIM_VEL_FRAG,
  resolveLiveParticleRules, classifyLiveRules, evaluateLiveRuleStep, LIVE_RULE_FORCE_BITS,
} = lib;

const GRAVITY_LINE = 'vel.y -= uGravity * uDelta * 9.8 * grpGravity;';
const occurrences = (s, needle) => s.split(needle).length - 1;
const idx = (s, needle) => s.indexOf(needle);

// --- 1. identity -----------------------------------------------------------
check('1a no-option assembly is the stock main forces',
  buildMainForcesFragment() === VEL_FRAG_MAIN_FORCES);
check('1b stock velocity fragment keeps gravity in the head, no segments',
  occurrences(SIM_VEL_FRAG, GRAVITY_LINE) === 1
  && !SIM_VEL_FRAG.includes('uRuleLiveTex')
  && !SIM_VEL_FRAG.includes('Gravity (relocated'));
const NON_RULE_VARIANTS = [
  { steeringSeek: true },
  { steeringSeek: true, crowd: true },
  { spawnAlloc: true },
  { emitterVelocity: true },
  { spawnAlloc: true, emitterVelocity: true },
  { grainsFullScan: true, flip3dCouple: true, sphAkinci: true, attractor2: true },
];
let identityOk = true;
let identityDetail = '';
for (const opts of NON_RULE_VARIANTS) {
  const frag = buildVelocityFragment('', undefined, opts);
  if (occurrences(frag, GRAVITY_LINE) !== 1
    || frag.includes('Gravity (relocated')
    || idx(frag, GRAVITY_LINE) > idx(frag, 'uTurbulence > 0.001')) {
    identityOk = false;
    identityDetail = JSON.stringify(opts);
  }
}
check('1c non-rule variants keep gravity ahead of the force chunks, unrelocated',
  identityOk, identityDetail);

// --- 2. relocation ---------------------------------------------------------
const baked = buildMainForcesFragment(undefined, { particleRules: true });
check('2a baked variant: gravity once, after the baked segment, before the chunks',
  occurrences(baked, GRAVITY_LINE) === 1
  && idx(baked, 'grpGravity *=') > -1
  && idx(baked, 'grpGravity *=') < idx(baked, GRAVITY_LINE)
  && idx(baked, GRAVITY_LINE) < idx(baked, 'uTurbulence > 0.001'));
const live = buildMainForcesFragment(undefined, { particleRulesLive: true });
check('2b live variant: gravity once, after the live segment, before the chunks',
  occurrences(live, GRAVITY_LINE) === 1
  && idx(live, 'float liveMask = texture2D(uRuleLiveTex') > -1
  && idx(live, 'float liveMask = texture2D(uRuleLiveTex') < idx(live, GRAVITY_LINE)
  && idx(live, GRAVITY_LINE) < idx(live, 'uTurbulence > 0.001'));
const both = buildMainForcesFragment(undefined, { particleRules: true, particleRulesLive: true });
check('2c both segments: both grpGravity multiplications precede the gravity line',
  occurrences(both, GRAVITY_LINE) === 1
  && occurrences(both, 'grpGravity *=') === 2
  && idx(both, 'grpGravity *=') < idx(both, GRAVITY_LINE)
  && both.lastIndexOf('grpGravity *=') < idx(both, GRAVITY_LINE));

// --- 3. composition --------------------------------------------------------
const composed = buildVelocityFragment('vel += vec3(1.0) * uDelta;', undefined, {
  particleRulesLive: true, spawnAlloc: true, emitterVelocity: true,
});
check('3a relocation composes with spawnAlloc + emitterVelocity + custom force',
  occurrences(composed, GRAVITY_LINE) === 1
  && idx(composed, 'float liveMask = texture2D(uRuleLiveTex') < idx(composed, GRAVITY_LINE)
  && composed.includes('grpCustom')
  && idx(composed, GRAVITY_LINE) < idx(composed, 'velPreCustomForce'));
const crowdLive = buildMainForcesFragment(undefined, {
  particleRulesLive: true, steeringSeek: true, crowd: true,
});
check('3b relocation composes with the crowd variant',
  occurrences(crowdLive, GRAVITY_LINE) === 1
  && idx(crowdLive, 'float liveMask = texture2D(uRuleLiveTex') < idx(crowdLive, GRAVITY_LINE));

// --- 4. derivation safety --------------------------------------------------
check('4 stock head carries the gravity line exactly once',
  occurrences(VEL_FRAG_MAIN_FORCES_HEAD, GRAVITY_LINE) === 1,
  String(occurrences(VEL_FRAG_MAIN_FORCES_HEAD, GRAVITY_LINE)));

// --- 5. WGSL twin ordering (source pin) ------------------------------------
const wgslSrc = readFileSync(join(ROOT, 'lib', 'webgpuCompute.ts'), 'utf8');
check('5 WGSL velocity kernel composes the live permit before applying gravity',
  idx(wgslSrc, 'rulePermitGravity = select(0.0, rulePermitGravity, (liveMask & 1u) != 0u)') > -1
  && idx(wgslSrc, 'rulePermitGravity = select(0.0, rulePermitGravity, (liveMask & 1u) != 0u)')
    < idx(wgslSrc, 'vel.y -= u.gravity * u.delta * 9.8 * rulePermitGravity;')
  && occurrences(wgslSrc, 'vel.y -= u.gravity * u.delta * 9.8 * rulePermitGravity;') === 1);

// --- 6. permit semantics (CPU twin) ----------------------------------------
const rule = (id, action, condition = '') => ({
  id, enabled: true, target: { type: 'all' }, condition, action,
});
const J = (v) => JSON.stringify(v);
const gateClassified = classifyLiveRules(
  resolveLiveParticleRules(J([rule('g', { type: 'force-gate', force: 'gravity' }, 'age > 0.5')])),
  { names: [], names2: [], groupDefs: [], densityAvailable: false },
);
const unmatched = evaluateLiveRuleStep(gateClassified, {
  slots: [], vars: { age: 0.2 },
});
const matched = evaluateLiveRuleStep(gateClassified, {
  slots: [], vars: { age: 0.8 },
});
check('6a force-gate gravity: unmatched particle loses the gravity permit bit',
  (unmatched.mask & LIVE_RULE_FORCE_BITS.gravity) === 0,
  `mask=${unmatched.mask}`);
check('6b force-gate gravity: matched particle keeps the gravity permit bit',
  (matched.mask & LIVE_RULE_FORCE_BITS.gravity) === LIVE_RULE_FORCE_BITS.gravity,
  `mask=${matched.mask}`);
const dispClassified = classifyLiveRules(
  resolveLiveParticleRules(J([rule('d', { type: 'display', size: 0.5, opacity: 1 }, '')])),
  { names: [], names2: [], groupDefs: [], densityAvailable: false },
);
const disp = evaluateLiveRuleStep(dispClassified, { slots: [], vars: {} });
check('6c display rule: REP display value is 1 + size (size 0.5 -> 1.5)',
  disp.display === 1.5, `display=${disp.display}`);
// The gate script's premise error, pinned: display size is
// a 0..1 scale factor (validation clamp01; the draw applies
// sizeMul *= size). The C3 script authored size 3 expecting
// growth; validation clamps it to 1, whose factor is exactly
// 1 — a guaranteed no-op, which is what the gate measured.
const dispClamped = evaluateLiveRuleStep(
  classifyLiveRules(
    resolveLiveParticleRules(J([rule('d', { type: 'display', size: 3, opacity: 1 }, '')])),
    { names: [], names2: [], groupDefs: [], densityAvailable: false },
  ),
  { slots: [], vars: {} },
);
check('6d display size 3 clamps to 1 (factor 1: the C3 no-op is the authored value, not a break)',
  dispClamped.display === 2, `display=${dispClamped.display}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
