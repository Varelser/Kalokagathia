// Grammar 2.0 stage 1, slice 1B — state transitions,
// group change (state-as-membership proxy) and the `sdf`
// condition variable in the live rule grammar
// (lib/gpgpuParticleRulesLive.ts). Design:
// kalokagathia-pro/STAGE1_GRAMMAR2_DESIGN.md sections 3/5;
// implementation record: STAGE1_1B_IMPL_RECORD.md.
//
// Cases:
//  1 consumption: set-state / set-group now build the REP;
//    still-deferred (1C) actions still do not
//  2 transition semantics (CPU twin): SNAPSHOT reading —
//    every condition in one evaluation reads the state
//    carried in; transitions apply in rule order (last
//    wins) to the output state only; a later rule observes
//    a transition from the next evaluation on
//  3 group change: set-group writes the group's proxy state
//    value (first-appearance order, 1-based); later rules
//    target the "group" through the state condition
//  4 sdf variable: classification, conditional emission,
//    GLSL formula pins, and the sign convention (negative =
//    inside) via the TS twin sdfDistance
//  5 identity: the v2.22.0 velocity / position shader pins
//    from slice 1A are unbroken
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1b-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, liveRulesHaveConsumedAction, classifyLiveRules, evaluateLiveRuleStep, evaluateLiveRuleMask, buildRuleEvalFragment, liveGroupStateValue, LIVE_RULE_KILL_BIT } from './lib/gpgpuParticleRulesLive.ts';
      export { sdfDistance } from './lib/particleLifeBehavior.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveLiveParticleRules, liveRulesHaveConsumedAction, classifyLiveRules,
  evaluateLiveRuleStep, evaluateLiveRuleMask, buildRuleEvalFragment,
  liveGroupStateValue, LIVE_RULE_KILL_BIT, sdfDistance,
} = lib;
const { buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const J = (v) => JSON.stringify(v);
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: false };
const classify = (rules) => classifyLiveRules(resolveLiveParticleRules(J(rules)), OPTS);
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
const step = (classified, state, extraVars = {}) => evaluateLiveRuleStep(classified, {
  slots: ZEROS,
  vars: { vel: 0, age: 0, rad: 0, t: 0, state, den: 0, sdf: 1e6, ...extraVars },
});

// --- 1. consumption ---------------------------------------------------------
{
  const fragState = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('s', { type: 'set-state', state: 2 })])), OPTS);
  const fragGroup = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('g', { type: 'set-group', id: 'alpha' })])), OPTS);
  check('1a set-state / set-group alone now build the REP fragment',
    typeof fragState === 'string' && typeof fragGroup === 'string'
    && liveRulesHaveConsumedAction(J([rule('s', { type: 'set-state', state: 2 })]))
    && liveRulesHaveConsumedAction(J([rule('g', { type: 'set-group', id: 'alpha' })])));
  // Slice 1C update: true-kill / fracture / display became
  // consumed in 1C and now build the REP on their own; the
  // still-deferred case is a color-only list.
  check('1b 1C actions alone now build the REP; color alone still does not',
    typeof buildRuleEvalFragment(resolveLiveParticleRules(J([rule('t', { type: 'true-kill' })])), OPTS) === 'string'
    && typeof buildRuleEvalFragment(resolveLiveParticleRules(J([rule('f', { type: 'fracture' })])), OPTS) === 'string'
    && liveRulesHaveConsumedAction(J([rule('t', { type: 'true-kill' })]))
    && buildRuleEvalFragment(resolveLiveParticleRules(J([rule('c', { type: 'color', color: [1, 0, 0] })])), OPTS) === null);
}

// --- 2. transition semantics (snapshot, last wins) ---------------------------
{
  const classified = classify([
    rule('toTwo', { type: 'set-state', state: 2 }, 'state == 0'),
    rule('toThree', { type: 'set-state', state: 3 }, 'state == 2'),
  ]);
  const s1 = step(classified, 0);
  check('2a snapshot: a later rule does NOT see an earlier transition in the same evaluation',
    s1.state === 2 && JSON.stringify(s1.matched) === JSON.stringify(['toTwo']),
    JSON.stringify(s1));
  const s2 = step(classified, s1.state);
  check('2b the transition is observed from the next evaluation on',
    s2.state === 3 && JSON.stringify(s2.matched) === JSON.stringify(['toThree']),
    JSON.stringify(s2));
  const s3 = step(classified, s2.state);
  check('2c steady state: no rule fires on state 3, state carries through',
    s3.state === 3 && s3.matched.length === 0, JSON.stringify(s3));
}
{
  const fwd = classify([rule('a', { type: 'set-state', state: 5 }), rule('b', { type: 'set-state', state: 7 })]);
  const rev = classify([rule('b', { type: 'set-state', state: 7 }), rule('a', { type: 'set-state', state: 5 })]);
  check('2d transitions apply in rule order, last match wins',
    step(fwd, 0).state === 7 && step(rev, 0).state === 5);
  const gated = classify([rule('g', { type: 'set-state', state: 9 }, 'vel > 100')]);
  check('2e an unmatched transition leaves the state untouched',
    step(gated, 4).state === 4 && step(gated, 4).matched.length === 0);
}
{
  const classified = classify([
    rule('enter', { type: 'set-state', state: 2 }),
    rule('gate', { type: 'force-gate', force: 'gravity' }, 'state == 2'),
  ]);
  const from0 = step(classified, 0);
  const from2 = step(classified, 2);
  check('2f a later rule reads the carried-in state through the state condition (force-gate)',
    !from0.matched.includes('gate') && (from0.mask & 1) === 0
    && from2.matched.includes('gate') && (from2.mask & 1) === 1,
    JSON.stringify({ from0, from2 }));
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([
    rule('enter', { type: 'set-state', state: 2 }),
    rule('gate', { type: 'kill' }, 'state == 2'),
  ])), OPTS);
  // Slice 1C update: the output's .a is the display channel
  // (liveDisplay) since 1C, no longer the constant 0.0.
  check('2g fragment pins: conditions read prevState, transitions write nextState',
    typeof frag === 'string'
    && frag.includes('prevState')
    && frag.includes('nextState = (matched0 > 0.5) ? 2.0 : nextState;')
    && frag.includes('gl_FragColor = vec4(liveMask, nextState / 255.0, condBits, liveDisplay);'),
    typeof frag === 'string' ? '' : 'null fragment');
}

// --- 3. group change (proxy state values) ------------------------------------
{
  const rules = resolveLiveParticleRules(J([
    rule('sg1', { type: 'set-group', id: 'alpha' }),
    rule('k', { type: 'kill' }),
    rule('sg2', { type: 'set-group', id: 'beta' }),
    rule('sg3', { type: 'set-group', id: 'alpha' }),
  ]));
  check('3a proxy values follow first appearance among set-group ids (1-based)',
    liveGroupStateValue(rules, 'alpha') === 1
    && liveGroupStateValue(rules, 'beta') === 2
    && liveGroupStateValue(rules, 'gamma') === 0);
  // In THIS list beta appears first, so beta = 1, alpha = 2.
  const classified = classify([
    rule('joinBeta', { type: 'set-group', id: 'beta' }),
    rule('joinAlpha', { type: 'set-group', id: 'alpha' }),
    rule('killBeta', { type: 'kill' }, 'state == 1'),
  ]);
  const s1 = step(classified, 0);
  check('3b set-group writes the proxy value (last matching transition wins)',
    s1.state === 2 && JSON.stringify(s1.matched) === JSON.stringify(['joinBeta', 'joinAlpha']),
    JSON.stringify(s1));
  const classified2 = classify([
    rule('joinBeta', { type: 'set-group', id: 'beta' }),
    rule('killBeta', { type: 'kill' }, 'state == 1'),
  ]);
  const t1 = step(classified2, 0);
  const t2 = step(classified2, t1.state);
  check('3c the "group" is targeted from the next evaluation via the state condition',
    t1.state === 1 && (t1.mask & LIVE_RULE_KILL_BIT) === 0
    && t2.state === 1 && (t2.mask & LIVE_RULE_KILL_BIT) === LIVE_RULE_KILL_BIT,
    JSON.stringify({ t1, t2 }));
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([
    rule('joinBeta', { type: 'set-group', id: 'beta' }),
    rule('joinAlpha', { type: 'set-group', id: 'alpha' }),
  ])), OPTS);
  check('3d fragment pins the same proxy values as the CPU twin',
    typeof frag === 'string'
    && frag.includes('nextState = (matched0 > 0.5) ? 1.0 : nextState;')
    && frag.includes('nextState = (matched1 > 0.5) ? 2.0 : nextState;'));
}

// --- 4. sdf variable ------------------------------------------------------------
{
  const classified = classify([rule('in', { type: 'kill' }, 'sdf < 0')]);
  check('4a sdf conditions classify live', classified[0].route === 'live', classified[0].route);
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('in', { type: 'kill' }, 'sdf < 0')])), OPTS);
  check('4b sdf fragment emits the ported distance, its uniforms and the disabled fallback',
    typeof frag === 'string'
    && frag.includes('float repSdfDistance(vec3 p)')
    && frag.includes('uniform bool uSdfEnabled;')
    && frag.includes('uniform sampler2D uPosTex;')
    && frag.includes('vec4 simPos = texture2D(uPosTex, vUv);')
    && frag.includes('float simSdf = uSdfEnabled ? repSdfDistance(simPos.xyz) : 1.0e6;')
    && !frag.includes('simVelMag'));
  const fragPlain = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('g', { type: 'force-gate', force: 'all' })])), OPTS);
  check('4c no sdf lines when no condition reads sdf',
    typeof fragPlain === 'string' && !fragPlain.includes('repSdfDistance') && !fragPlain.includes('uSdfEnabled'));
  const fragBoth = buildRuleEvalFragment(resolveLiveParticleRules(J([rule('b', { type: 'kill' }, '(sdf < 0) * (vel > 1)')])), OPTS);
  check('4d sdf + sim vars share one position sampling (no duplicate uPosTex)',
    typeof fragBoth === 'string'
    && fragBoth.includes('simVelMag')
    && fragBoth.split('uniform sampler2D uPosTex;').length - 1 === 1
    && fragBoth.includes('float simSdf'));
  check('4e GLSL formula pins match abSdfDistance (sphere / gyroid scale)',
    typeof frag === 'string'
    && frag.includes('return length(d) - uSdfSize;')
    && frag.includes('return repGyroidField(p, sc, uSdfSize) * uSdfSize * 0.227;'));
  // Sign convention through the TS twin + the CPU step:
  // sphere r=10 at the origin, box half 10, capsule r=4, torus
  // centre is the hole (positive).
  const C = { x: 0, y: 0, z: 0 };
  const signs = [
    sdfDistance(0, { x: 0, y: 0, z: 0 }, C, 10),
    sdfDistance(0, { x: 3, y: 4, z: 0 }, C, 10),
    sdfDistance(0, { x: 30, y: 0, z: 0 }, C, 10),
    sdfDistance(1, { x: 0, y: 0, z: 0 }, C, 10),
    sdfDistance(3, { x: 0, y: 0, z: 0 }, C, 10),
    sdfDistance(2, { x: 0, y: 0, z: 0 }, C, 10),
  ];
  check('4f sdfDistance sign: inside negative, outside positive, torus centre positive',
    signs[0] === -10 && signs[1] === -5 && signs[2] === 20
    && signs[3] === -10 && signs[4] === -4 && signs[5] > 0,
    JSON.stringify(signs));
  const inside = evaluateLiveRuleMask(classified, { slots: ZEROS, vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: signs[0] } });
  const outside = evaluateLiveRuleMask(classified, { slots: ZEROS, vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: signs[2] } });
  check('4g the sdf < 0 condition matches inside only',
    (inside.mask & LIVE_RULE_KILL_BIT) === LIVE_RULE_KILL_BIT
    && (outside.mask & LIVE_RULE_KILL_BIT) === 0);
}

// --- 5. identity pins from 1A ---------------------------------------------------
const sha = (s) => createHash('sha256').update(s).digest('hex');
check('5a default velocity string is still the shipped v2.25.0 string (統合時点)',
  sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
  sha(SIM_VEL_FRAG));
check('5b default position string is still the shipped v2.25.0 string (統合時点)',
  sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
  sha(SIM_POS_FRAG));
check('5c builders without the live option still return the defaults',
  buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG
  && buildPositionFragment({}) === SIM_POS_FRAG);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
