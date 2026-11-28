// Grammar 2.0 stage 1, slice 1B follow-up — the collision
// variables `hit` / `hits`, supplied by the new contact
// pass (components/gpgpuContactPass.ts). Fixed plan:
// kalokagathia-pro/STAGE1_1B_IMPL_RECORD.md (contact pass +
// ping-pong target, .r = accumulated count / .g = last-step
// contact, the REP publishes hit / hits); implementation
// record: STAGE1_HIT_IMPL_RECORD.md.
//
// Cases:
//  1 publication + classification: hit / hits are live
//    condition variables, always GLSL-representable (no
//    baked fallback, no density requirement)
//  2 REP fragment: conditional emission of the contact
//    supply (uHitTex + simHit / simHits) only while a live
//    condition reads them; GLSL mapping of the variables
//  3 REP CPU twin: conditions over hit / hits act on the
//    caller-supplied values
//  4 contact accumulation twin: accumulation, saturation
//    at 255, the age-drop respawn reset, the parked carry,
//    the forced reset
//  5 replay resolution: the solver truth table
//  6 contact fragment pins: the integration line, the park
//    early-out, the five judgments in the position tail's
//    order (cross-checked against the position fragment),
//    the accumulation lines, the output layout
//  7 wiring pins: REP binding, runner drive (run /
//    suppress), scene lifecycle
//  8 identity: default velocity / position strings stay
//    the shipped v2.22.0 strings
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1hit-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment, liveRuleConditionVariables, liveConditionUsesContactVars, LIVE_RULE_FORCE_BITS, LIVE_RULE_KILL_BIT } from './lib/gpgpuParticleRulesLive.ts';
      export { CONTACT_FRAG, contactReplayEnabled, contactStepTwin } from './components/gpgpuContactPass.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveLiveParticleRules, classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment,
  liveRuleConditionVariables, liveConditionUsesContactVars,
  LIVE_RULE_FORCE_BITS, LIVE_RULE_KILL_BIT,
} = lib;
const { CONTACT_FRAG, contactReplayEnabled, contactStepTwin } = lib;
const { SIM_POS_FRAG } = lib;
const { SIM_VEL_FRAG } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const J = (v) => JSON.stringify(v);
const classify = (rules, opts = {}) => classifyLiveRules(resolveLiveParticleRules(J(rules)), { ...OPTS, ...opts });
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
const step = (classified, vars = {}) => evaluateLiveRuleStep(classified, {
  slots: ZEROS,
  vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, hit: 0, hits: 0, ...vars },
});
const hasBit = (mask, bit) => (mask & bit) !== 0;
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- 1
{
  const vars = liveRuleConditionVariables(NAMES, NAMES2);
  check('1a hit and hits are published condition variables',
    vars.includes('hit') && vars.includes('hits'));

  const hitRule = classify([rule('h1', { type: 'kill' }, 'hit > 0')]);
  check('1b a hit condition classifies live', hitRule[0].route === 'live', hitRule[0].route);
  const hitsRule = classify([rule('h2', { type: 'force-gate', force: 'gravity' }, 'hits >= 3')]);
  check('1c a hits condition classifies live', hitsRule[0].route === 'live', hitsRule[0].route);

  const noDensity = classify([rule('h3', { type: 'kill' }, 'hit > 0')], { densityAvailable: false });
  check('1d hit needs no density supply (still live without it)',
    noDensity[0].route === 'live', noDensity[0].route);

  check('1e contact-var detection on compiled conditions',
    liveConditionUsesContactVars(hitRule[0].conditionAst) === true
    && liveConditionUsesContactVars(hitsRule[0].conditionAst) === true
    && liveConditionUsesContactVars(classify([rule('h4', { type: 'kill' }, 'vel > 1')])[0].conditionAst) === false);
}

// ---------------------------------------------------------------- 2
{
  const fragHit = buildRuleEvalFragment(
    resolveLiveParticleRules(J([rule('h1', { type: 'kill' }, 'hit > 0')])),
    OPTS,
  );
  check('2a hit fragment declares and samples the contact supply',
    !!fragHit
    && fragHit.includes('uniform sampler2D uHitTex;')
    && fragHit.includes('float simHits = hitData.r;')
    && fragHit.includes('float simHit = hitData.g;'),
    fragHit ? 'missing lines' : 'fragment null');
  check('2b the condition GLSL reads simHit', !!fragHit && fragHit.includes('simHit'));

  const fragHits = buildRuleEvalFragment(
    resolveLiveParticleRules(J([rule('h2', { type: 'kill' }, 'hits >= 3')])),
    OPTS,
  );
  check('2c a hits-only condition also stands the supply',
    !!fragHits && fragHits.includes('uniform sampler2D uHitTex;') && fragHits.includes('simHits'));

  const fragPlain = buildRuleEvalFragment(
    resolveLiveParticleRules(J([rule('p1', { type: 'kill' }, 'vel > 1')])),
    OPTS,
  );
  check('2d no contact lines while no live condition reads them',
    !!fragPlain && !fragPlain.includes('uHitTex') && !fragPlain.includes('simHit'));

  const fragColorOnly = buildRuleEvalFragment(
    resolveLiveParticleRules(J([rule('c1', { type: 'color', color: [1, 0, 0] }, 'hit > 0')])),
    OPTS,
  );
  check('2e a hit condition on an unconsumed action alone builds no REP (no contact demand)',
    fragColorOnly === null);
}

// ---------------------------------------------------------------- 3
{
  const killOnHit = classify([rule('h1', { type: 'kill' }, 'hit == 1')]);
  check('3a twin: hit = 1 sets the kill bit',
    hasBit(step(killOnHit, { hit: 1 }).mask, LIVE_RULE_KILL_BIT));
  check('3b twin: hit = 0 does not',
    !hasBit(step(killOnHit, { hit: 0 }).mask, LIVE_RULE_KILL_BIT));

  const gateOnHits = classify([rule('h2', { type: 'force-gate', force: 'gravity' }, 'hits >= 2')]);
  check('3c twin: hits >= 2 permits gravity',
    hasBit(step(gateOnHits, { hits: 2 }).mask, LIVE_RULE_FORCE_BITS.gravity));
  check('3d twin: hits = 1 leaves gravity restricted',
    !hasBit(step(gateOnHits, { hits: 1 }).mask, LIVE_RULE_FORCE_BITS.gravity));
}

// ---------------------------------------------------------------- 4
{
  let rec = { hits: 0, hit: 0, prevAge: 0 };
  rec = contactStepTwin(rec, { contact: true, age: 0.1 });
  check('4a first contact accumulates to 1', rec.hits === 1 && rec.hit === 1 && rec.prevAge === 0.1, J(rec));
  rec = contactStepTwin(rec, { contact: true, age: 0.2 });
  check('4b second contact accumulates to 2', rec.hits === 2 && rec.hit === 1, J(rec));
  rec = contactStepTwin(rec, { contact: false, age: 0.3 });
  check('4c a quiet step keeps the count, hit clears (no decay of hits, hit is the latest step only)',
    rec.hits === 2 && rec.hit === 0, J(rec));

  const sat = contactStepTwin({ hits: 254, hit: 1, prevAge: 1 }, { contact: true, age: 1.1 });
  const sat2 = contactStepTwin({ hits: 255, hit: 1, prevAge: 1 }, { contact: true, age: 1.1 });
  check('4d the count saturates at 255', sat.hits === 255 && sat2.hits === 255, `${sat.hits}/${sat2.hits}`);

  const reborn = contactStepTwin({ hits: 7, hit: 1, prevAge: 4.9 }, { contact: true, age: 0.05 });
  check('4e an age drop restarts the count from this step (respawn reset)',
    reborn.hits === 1 && reborn.hit === 1, J(reborn));
  const rebornQuiet = contactStepTwin({ hits: 7, hit: 1, prevAge: 4.9 }, { contact: false, age: 0.05 });
  check('4f an age drop with no contact restarts at 0',
    rebornQuiet.hits === 0 && rebornQuiet.hit === 0, J(rebornQuiet));

  const frozen = contactStepTwin({ hits: 3, hit: 0, prevAge: 2 }, { contact: true, age: 2 });
  check('4g an unchanged age (frozen step) is not a reset', frozen.hits === 4, J(frozen));

  const parked = contactStepTwin({ hits: 5, hit: 1, prevAge: 1 }, { contact: true, age: 1, parked: true });
  check('4h parked particles carry the count frozen, hit = 0',
    parked.hits === 5 && parked.hit === 0 && parked.prevAge === 1, J(parked));

  const forced = contactStepTwin({ hits: 9, hit: 1, prevAge: 1 }, { contact: false, age: 1.1, reset: true });
  check('4i a forced reset restarts from this step', forced.hits === 0 && forced.hit === 0, J(forced));
}

// ---------------------------------------------------------------- 5
{
  const base = { verletEnabled: false, grainsProjection: false, vellum: false, rigid: false };
  check('5a the plain Euler resolution replays', contactReplayEnabled(base) === true);
  check('5b Verlet suppresses', contactReplayEnabled({ ...base, verletEnabled: true }) === false);
  check('5c Grains projection suppresses', contactReplayEnabled({ ...base, grainsProjection: true }) === false);
  check('5d Vellum suppresses', contactReplayEnabled({ ...base, vellum: true }) === false);
  check('5e Rigid suppresses', contactReplayEnabled({ ...base, rigid: true }) === false);
}

// ---------------------------------------------------------------- 6
{
  check('6a the replay integrates with the position pass formula',
    CONTACT_FRAG.includes('posData.xyz + vel * uDelta * uSpeed * 60.0'));
  check('6b parked particles early-out on the park form',
    CONTACT_FRAG.includes('posData.y < -90000.0'));
  const order = [
    'dist > uBounceRadius * 1.05',
    'if (uSdfEnabled)',
    'meshSdfDistance(pos)',
    'uFloorEnabled && pos.y < uFloorY',
    'terrainColliderSample(tcUv)',
  ].map((s) => CONTACT_FRAG.indexOf(s));
  check('6c the five judgments replay in the position tail order',
    order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]),
    J(order));
  check('6d the position fragment carries the same five judgments (cross-check)',
    SIM_POS_FRAG.includes('dist > uBounceRadius * 1.05')
    && SIM_POS_FRAG.includes('meshSdfDistance(pos)')
    && SIM_POS_FRAG.includes('pos.y < uFloorY')
    && SIM_POS_FRAG.includes('terrainColliderSample(tcUv).x')
    && SIM_POS_FRAG.includes('if (sd < 0.0)'));
  check('6e the SDF judgment keeps the position form',
    CONTACT_FRAG.includes('if (sd < 0.0)') && CONTACT_FRAG.includes('pos -= sn * sd;'));
  check('6f accumulation lines (age-drop reset + 255 saturation)',
    CONTACT_FRAG.includes('age < prevAge - 0.001')
    && CONTACT_FRAG.includes('min(base + (contact ? 1.0 : 0.0), 255.0)'));
  check('6g output layout (.r hits / .g hit / .b age seen)',
    CONTACT_FRAG.includes('gl_FragColor = vec4(hits, contact ? 1.0 : 0.0, age, 0.0);'));
  check('6h the forced-reset uniform is honoured',
    CONTACT_FRAG.includes('uContactReset > 0.5'));
}

// ---------------------------------------------------------------- 7
{
  const repPassSrc = readFileSync(join(ROOT, 'components', 'gpgpuRuleEvalPass.ts'), 'utf8');
  check('7a the REP binds the contact supply',
    repPassSrc.includes('uHitTex') && repPassSrc.includes('bindings.hitTex'));
  const passesSrc = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('7b the runner takes the contact pass and drives it',
    passesSrc.includes('contactPass?: GpgpuContactPass | null')
    && passesSrc.includes('contactReplayEnabled({')
    && passesSrc.includes('args.contactPass.run(gl,')
    && passesSrc.includes('args.contactPass.suppress()'));
  check('7c the runner feeds the fresh velocity and frame-start position',
    passesSrc.includes('posTex: posIn.texture') && passesSrc.includes('velTex: velOut.texture'));
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  check('7d the scene stands the pass only on contact demand and binds its texture',
    sceneSrc.includes('ruleLiveUsesContact')
    && sceneSrc.includes('new GpgpuContactPass(texSize)')
    && sceneSrc.includes('hitTex: contactPassRef.current?.texture ?? null')
    && sceneSrc.includes('contactPass: contactPassRef.current'));
  const contactSrc = readFileSync(join(ROOT, 'components', 'gpgpuContactPass.ts'), 'utf8');
  check('7e suppression serves the zero texture (hit / hits read 0)',
    contactSrc.includes('this.suppressed ? this.zeroTex : this.current.texture'));
}

// ---------------------------------------------------------------- 8
{
  check('8a default velocity string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha(SIM_VEL_FRAG));
  check('8b default position string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha(SIM_POS_FRAG));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
