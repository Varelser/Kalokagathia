// Grammar 2.0 stage 1, slice 1C — true-kill / display /
// fracture / force-gate full extension (+ the attractor as
// the first external-force connection) / k-demon
// verification. Design: kalokagathia-pro/
// STAGE1_GRAMMAR2_DESIGN.md sections 1, 4, 5 (slice 1C).
//
// Cases:
//  1 consumption: the 1C actions build the REP on their
//    own; color still does not
//  2 extension force-gate: parse, permit semantics on the
//    CPU twin, 'all' keeps its five-force meaning
//  3 true-kill: twin bit 6, the latch (prevMask), the REP
//    fragment's prev.r read-back, the position pass park
//    segment (spliced after the spawn gate, uniform-gated)
//  4 fracture: twin bit 7 as a pulse (NOT latched), the
//    fragment aggregate
//  5 display: twin .a value (0 / 1 + size, last wins), the
//    fragment output, the points draw variant (size drive)
//  6 velocity consumption: gate locals, gated chunk
//    variants (vortex / well / attractor + units), the
//    tail's gated drag block
//  7 k-demon verification: age + volume (sdf) + isolation
//    (1 - den) conditions with true-kill, written with live
//    rule expressions only
//  8 identity: default velocity / position strings stay
//    the shipped v2.22.0 strings; the stock draw vertex
//    carries no REP uniform
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1c-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, liveRulesHaveConsumedAction, classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment, LIVE_RULE_FORCE_BITS, LIVE_RULE_KILL_BIT, LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_FRACTURE_BIT, LIVE_RULE_EXT_FORCE_BITS, LIVE_RULE_EXT_PERMIT_MASK, LIVE_RULE_MASK_ALL_PERMIT, LIVE_RULE_MASK_FULL_PERMIT } from './lib/gpgpuParticleRulesLive.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildVelocityTail } from './components/gpgpuShaderSimulationVelocityMainTail.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildDrawVert, DRAW_VERT } from './components/gpgpuShaderPoints.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  parseLiveParticleRules, resolveLiveParticleRules, liveRulesHaveConsumedAction,
  classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment,
  LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_FRACTURE_BIT, LIVE_RULE_EXT_FORCE_BITS,
  LIVE_RULE_EXT_PERMIT_MASK, LIVE_RULE_MASK_ALL_PERMIT, LIVE_RULE_MASK_FULL_PERMIT,
} = lib;
const { buildVelocityFragment, SIM_VEL_FRAG, buildVelocityTail } = lib;
const { buildPositionFragment, SIM_POS_FRAG, buildDrawVert, DRAW_VERT } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const J = (v) => JSON.stringify(v);
const classify = (rules, opts = {}) => classifyLiveRules(resolveLiveParticleRules(J(rules)), { ...OPTS, ...opts });
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
const step = (classified, vars = {}, prevMask = undefined) => evaluateLiveRuleStep(classified, {
  slots: ZEROS,
  vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, ...vars },
  prevMask,
});
const hasBit = (mask, bit) => (mask & bit) !== 0;

// --- 1. consumption -----------------------------------------------------------
{
  const fragTk = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('t', { type: 'true-kill' })])), OPTS);
  const fragFr = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('f', { type: 'fracture' })])), OPTS);
  const fragDp = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('d', { type: 'display', size: 0.5, opacity: 1 })])), OPTS);
  check('1a true-kill / fracture / display alone now build the REP fragment',
    typeof fragTk === 'string' && typeof fragFr === 'string' && typeof fragDp === 'string');
  check('1b color alone still does not build the REP; consumed-action helper agrees',
    buildRuleEvalFragment(resolveLiveParticleRules(J([rule('c', { type: 'color', color: [1, 0, 0] })])), OPTS) === null
    && liveRulesHaveConsumedAction(J([rule('t', { type: 'true-kill' })]))
    && liveRulesHaveConsumedAction(J([rule('d', { type: 'display', size: 0.5, opacity: 1 })]))
    && !liveRulesHaveConsumedAction(J([rule('c', { type: 'color', color: [1, 0, 0] })])));
  check('1c full-permit constants: 31 + ext 3840 = 3871 (external-force form: + custom 4096 = 7967; stage 2 B7: + meander 16384 = 24351)',
    LIVE_RULE_MASK_ALL_PERMIT === 31 && LIVE_RULE_EXT_PERMIT_MASK === 3840
    && LIVE_RULE_MASK_FULL_PERMIT === 24351);
}

// --- 2. extension force-gate ---------------------------------------------------
{
  const parsed = parseLiveParticleRules(J([
    rule('d', { type: 'force-gate', force: 'drag' }),
    rule('v', { type: 'force-gate', force: 'vortex' }),
    rule('a', { type: 'force-gate', force: 'attractor' }),
    rule('w', { type: 'force-gate', force: 'well' }),
    rule('bad', { type: 'force-gate', force: 'gravity2' }),
  ]));
  check('2a extension forces parse as gate targets; unknown forces drop the rule',
    parsed.length === 4 && parsed.map((r) => r.action.force).join(',') === 'drag,vortex,attractor,well',
    JSON.stringify(parsed.map((r) => r.action.force)));
}
{
  const classified = classify([rule('v', { type: 'force-gate', force: 'vortex' }, 'vel > 1')]);
  const fast = step(classified, { vel: 2 });
  const slow = step(classified, { vel: 0 });
  check('2b vortex permit semantics: matched permits, unmatched denies, other ext forces stay permitted',
    hasBit(fast.mask, LIVE_RULE_EXT_FORCE_BITS.vortex)
    && !hasBit(slow.mask, LIVE_RULE_EXT_FORCE_BITS.vortex)
    && hasBit(slow.mask, LIVE_RULE_EXT_FORCE_BITS.drag)
    && hasBit(slow.mask, LIVE_RULE_EXT_FORCE_BITS.attractor)
    && hasBit(slow.mask, LIVE_RULE_EXT_FORCE_BITS.well)
    && (slow.mask & 31) === 31,
    `fast=${fast.mask} slow=${slow.mask}`);
}
{
  const classified = classify([rule('g', { type: 'force-gate', force: 'all' }, 'vel > 100')]);
  const s = step(classified, { vel: 0 });
  check("2c 'all' restricts the G10 five only — extension permits survive an unmatched 'all' rule",
    (s.mask & 31) === 0 && (s.mask & LIVE_RULE_EXT_PERMIT_MASK) === LIVE_RULE_EXT_PERMIT_MASK,
    String(s.mask));
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('d', { type: 'force-gate', force: 'drag' }, 'vel > 1')])), OPTS);
  check('2d fragment carries the extension gate locals and mask terms',
    typeof frag === 'string'
    && frag.includes('float fgDrag = 0.0;')
    && frag.includes('fgDrag * 256.0')
    && frag.includes('fgVortex * 512.0')
    && frag.includes('fgAttractor * 1024.0')
    && frag.includes('fgWell * 2048.0'));
}

// --- 3. true-kill ----------------------------------------------------------------
{
  const classified = classify([rule('tk', { type: 'true-kill' }, 'age > 0.5')]);
  const old = step(classified, { age: 0.9 });
  const young = step(classified, { age: 0.1 });
  check('3a twin: a matched true-kill sets bit 6, an unmatched one does not',
    hasBit(old.mask, LIVE_RULE_TRUE_KILL_BIT) && !hasBit(young.mask, LIVE_RULE_TRUE_KILL_BIT));
  const after = step(classified, { age: 0.1 }, old.mask);
  check('3b twin latch: bit 6 survives later evaluations whose conditions no longer match',
    hasBit(after.mask, LIVE_RULE_TRUE_KILL_BIT) && after.matched.length === 0);
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('tk', { type: 'true-kill' })])), OPTS);
  check('3c fragment latches bit 6 from the previous mask (prev.r read-back)',
    typeof frag === 'string'
    && frag.includes('liveTrueKill = max(liveTrueKill, mod(floor(prev.r / 64.0), 2.0));')
    && frag.includes('liveTrueKill * 64.0'));
}
{
  const posLive = buildPositionFragment({ particleRulesLive: true });
  const parkAt = posLive.indexOf('Live particle rule true-kill');
  check('3d position live variant: true-kill park segment + uniform, after the spawn gate',
    posLive.includes('uniform bool uParticleRuleLiveTrueKillEnabled;')
    && parkAt > posLive.indexOf('spawnActivating = sHash >= thrPrev;')
    && parkAt < posLive.indexOf('if (uVerletEnabled)')
    && posLive.includes('gl_FragColor = vec4(0.0, -99999.0, 0.0, age);')
    && posLive.includes('mod(floor(liveMaskTk / 64.0), 2.0)'));
  check('3e stock position string carries no live true-kill code',
    !SIM_POS_FRAG.includes('uParticleRuleLiveTrueKillEnabled')
    && !SIM_POS_FRAG.includes('liveMaskTk'));
}

// --- 4. fracture -------------------------------------------------------------------
{
  const classified = classify([rule('fr', { type: 'fracture' }, 'vel > 1')]);
  const hit = step(classified, { vel: 2 });
  const next = step(classified, { vel: 0 }, hit.mask);
  check('4a twin: fracture sets bit 7 on match and does NOT latch into the next step',
    hasBit(hit.mask, LIVE_RULE_FRACTURE_BIT) && !hasBit(next.mask, LIVE_RULE_FRACTURE_BIT));
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('fr', { type: 'fracture' })])), OPTS);
  check('4b fragment aggregates the fracture pulse into the mask',
    typeof frag === 'string' && frag.includes('liveFracture * 128.0'));
}

// --- 5. display ----------------------------------------------------------------------
{
  const classified = classify([
    rule('d1', { type: 'display', size: 0.5, opacity: 1 }, 'vel > 1'),
    rule('d2', { type: 'display', size: 0.25, opacity: 1 }, 'vel > 2'),
  ]);
  const both = step(classified, { vel: 3 });
  const one = step(classified, { vel: 1.5 });
  const none = step(classified, { vel: 0 });
  check('5a twin display: .a is 1 + size of the LAST matching display rule, 0 when none match',
    both.display === 1.25 && one.display === 1.5 && none.display === 0,
    JSON.stringify({ both: both.display, one: one.display, none: none.display }));
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('d', { type: 'display', size: 0.5, opacity: 1 })])), OPTS);
  check('5b fragment writes liveDisplay into .a with the 1 + size encoding',
    typeof frag === 'string'
    && frag.includes('liveDisplay = (matched0 > 0.5) ? 1.5 : liveDisplay;')
    && frag.includes('gl_FragColor = vec4(liveMask, nextState / 255.0, condBits, liveDisplay);'));
}
{
  const vertLive = buildDrawVert({ ruleDisplay: true });
  check('5c draw variant: REP uniforms + size override spliced before gl_PointSize',
    vertLive.includes('uniform sampler2D uRuleLiveTex;')
    && vertLive.includes('uniform bool      uRuleLiveDisplayEnabled;')
    && vertLive.includes('sizeMul *= liveDisplay - 1.0;')
    && vertLive.indexOf('sizeMul *= liveDisplay - 1.0;') < vertLive.indexOf('gl_PointSize'));
  check('5d stock draw vertex is the default build and carries no REP uniform',
    buildDrawVert() === DRAW_VERT && !DRAW_VERT.includes('uRuleLiveTex'));
}

// --- 6. velocity consumption ---------------------------------------------------------
{
  const velLive = buildVelocityFragment('', undefined, { particleRulesLive: true });
  check('6a velocity live variant declares the extension gate locals and ANDs bits 8-11',
    velLive.includes('float grpDrag = 1.0;')
    && velLive.includes('float grpVortex = 1.0;')
    && velLive.includes('float grpAttractor = 1.0;')
    && velLive.includes('float grpWell = 1.0;')
    && velLive.includes('grpDrag *= mod(floor(liveMask / 256.0), 2.0);')
    && velLive.includes('grpVortex *= mod(floor(liveMask / 512.0), 2.0);')
    && velLive.includes('grpAttractor *= mod(floor(liveMask / 1024.0), 2.0);')
    && velLive.includes('grpWell *= mod(floor(liveMask / 2048.0), 2.0);'));
  check('6b gated chunk variants: vortex / well applications carry their gate',
    velLive.includes('* uVortexStrength * uDelta * 80.0 * grpVortex;')
    && velLive.includes('* uDelta * 2000.0 * grpWell;')
    && velLive.includes('* uDelta * 50.0 * grpWell;')
    && !velLive.includes('* uVortexStrength * uDelta * 80.0;'));
  check('6c gated attractor: pull term multiplied, velocity-match term mixed by the gate',
    velLive.includes('* uAttractorStrength * uDelta * 40.0 * grpAttractor;')
    && velLive.includes('vel = mix(vel, fv * uAttractorScale * 0.015 * uAttractorStrength, grpAttractor);'));
  const velLiveA2 = buildVelocityFragment('', undefined, { particleRulesLive: true, steeringSeek: true, attractor2: true });
  check('6d attractor unit 2 derives from the gated chunk (renamed uniforms, same gate)',
    velLiveA2.includes('* uAttractor2Strength * uDelta * 40.0 * grpAttractor;')
    && velLiveA2.includes('fv * uAttractor2Scale * 0.015 * uAttractor2Strength, grpAttractor'));
  check('6e tail drag block is gated only in the live tail variant',
    buildVelocityTail({ particleRulesLive: true }).includes('vel *= (1.0 - 1.1 * grpDrag * uDelta);')
    && buildVelocityTail({ particleRulesLive: true }).includes('vel *= (1.0 - uDragRate * grpDrag * uDelta);')
    && !buildVelocityTail().includes('grpDrag')
    && velLive.includes('1.1 * grpDrag * uDelta'));
  check('6f stock velocity string carries no extension gate code',
    !SIM_VEL_FRAG.includes('grpVortex') && !SIM_VEL_FRAG.includes('grpDrag'));
}

// --- 7. k-demon verification (expressions only, no dedicated code) --------------------
// The k-demon row of the design: kill by age AND volume
// (inside the SDF) AND isolation (low density). Written
// purely as a live rule: the condition multiplies the three
// tests (the expression language's AND form), the action is
// true-kill.
{
  const demon = classify(
    [rule('demon', { type: 'true-kill' }, '(age > 0.8) * (sdf < 0) * ((1 - den) > 0.5)')],
    { densityAvailable: true },
  );
  check('7a the demon rule classifies live (den supplied)',
    demon.length === 1 && demon[0].route === 'live', JSON.stringify(demon.map((d) => d.route)));
  const inside = step(demon, { age: 0.9, sdf: -3, den: 0.2 });
  check('7b old + inside + isolated dies (bit 6)',
    hasBit(inside.mask, LIVE_RULE_TRUE_KILL_BIT) && inside.matched.includes('demon'));
  check('7c each condition individually gates the demon',
    !hasBit(step(demon, { age: 0.5, sdf: -3, den: 0.2 }).mask, LIVE_RULE_TRUE_KILL_BIT)
    && !hasBit(step(demon, { age: 0.9, sdf: 5, den: 0.2 }).mask, LIVE_RULE_TRUE_KILL_BIT)
    && !hasBit(step(demon, { age: 0.9, sdf: -3, den: 0.9 }).mask, LIVE_RULE_TRUE_KILL_BIT));
  const later = step(demon, { age: 0.1, sdf: 5, den: 0.9 }, inside.mask);
  check('7d the demon kill is final: the latch keeps bit 6 after conditions clear',
    hasBit(later.mask, LIVE_RULE_TRUE_KILL_BIT));
}

// --- 8. identity -----------------------------------------------------------------------
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  check('8a default velocity string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha(SIM_VEL_FRAG));
  check('8b default position string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha(SIM_POS_FRAG));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
