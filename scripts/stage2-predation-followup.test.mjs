/**
 * Grammar 2.0 stage 2, slice B6 follow-up (predation
 * persistence + activation grace): standalone node test.
 *
 * Pins:
 *  1 resolution: the two new keys default to the identity
 *    (strikeFrames 1, graceSeconds 0), clamp at their
 *    bounds, fall back on non-finite input, and the
 *    predationHoldActive predicate follows them.
 *  2 the generated rules: with both keys at default the
 *    condition strings are byte-identical to the original
 *    B6 slice's; strikeFrames > 1 switches the core to the
 *    `predhold` variable; a positive grace multiplies in
 *    the `predage` gate; the birth rule never changes.
 *  3 the fragment: the default-rules fragment is
 *    byte-identical to the fragment of the hand-written
 *    legacy rules; a predhold rule emits the hold supply
 *    (uPredHoldTex + simPredHold) and a predage rule the
 *    activation supply (uPredActivationTime + simPredAge);
 *    neither appears at defaults; uPosTex is declared
 *    exactly once when prey and predhold combine.
 *  4 the CPU twin: the merged rules classify live and the
 *    prey outcome fires only when BOTH the hold count and
 *    the grace age clear their lines (kill and convert).
 *  5 the hold twin (predationHoldStep): increments while
 *    the condition holds, resets on a failed step, on a
 *    respawn (age going backwards) and during grace, and
 *    saturates at 255.
 *  6 the WGSL split: predhold / predage conditions have no
 *    WGSL form and the merged rules are not WGSL-coverable
 *    while either key is off default.
 *  7 key registration: the 2 new keys sit at their defaults.
 *  8 the hold pass component embeds the REP's own supply
 *    lines (imported, never copied) — a source pin for the
 *    no-divergence discipline.
 */
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b6f-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { resolvePredation, predationHoldActive, buildPredationRules, resolveLiveRulesWithPredation, predationHoldStep, PREDATION_PREY_RULE_ID, PREDATION_BIRTH_RULE_ID } from './lib/gpgpuPredation.ts';
      export { buildRuleEvalFragment, classifyLiveRules, evaluateLiveRuleStep, liveConditionWgsl, liveConditionUsesPredholdVar, liveConditionUsesPredageVar, liveRulesWgslCoverable, LIVE_RULE_TRUE_KILL_BIT } from './lib/gpgpuParticleRulesLive.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolvePredation, predationHoldActive, buildPredationRules,
  resolveLiveRulesWithPredation, predationHoldStep,
  PREDATION_PREY_RULE_ID, PREDATION_BIRTH_RULE_ID,
  buildRuleEvalFragment, classifyLiveRules, evaluateLiveRuleStep,
  liveConditionWgsl, liveConditionUsesPredholdVar, liveConditionUsesPredageVar,
  liveRulesWgslCoverable, LIVE_RULE_TRUE_KILL_BIT,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['e', 'f', 'g', 'h'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const BASE = { gpgpuParticleLifeSpecies: 4, gpgpuParticleLifeVisionRange: 120, gpgpuParticleLifeRadius: 60 };
const ON = { ...BASE, gpgpuPredationEnabled: true };

// ── 1. Resolution ────────────────────────────────────────
{
  const d = resolvePredation({});
  check('1 new keys default to the identity', d.strikeFrames === 1 && d.graceSeconds === 0);
  check('1 clamps: frames 1..600, grace 0..300',
    resolvePredation({ gpgpuPredationStrikeFrames: 0 }).strikeFrames === 1
    && resolvePredation({ gpgpuPredationStrikeFrames: 99999 }).strikeFrames === 600
    && resolvePredation({ gpgpuPredationGraceSeconds: -5 }).graceSeconds === 0
    && resolvePredation({ gpgpuPredationGraceSeconds: 99999 }).graceSeconds === 300);
  check('1 non-finite input falls back to the defaults',
    resolvePredation({ gpgpuPredationStrikeFrames: Number.NaN }).strikeFrames === 1
    && resolvePredation({ gpgpuPredationGraceSeconds: Number.POSITIVE_INFINITY }).graceSeconds === 0);
  check('1 fractional frames round, fractional grace is kept',
    resolvePredation({ gpgpuPredationStrikeFrames: 30.4 }).strikeFrames === 30
    && resolvePredation({ gpgpuPredationGraceSeconds: 2.5 }).graceSeconds === 2.5);
  check('1 predationHoldActive follows enabled + frames > 1',
    !predationHoldActive(ON)
    && predationHoldActive({ ...ON, gpgpuPredationStrikeFrames: 2 })
    && !predationHoldActive({ gpgpuPredationStrikeFrames: 2 }));
}

// ── 2. Generated rule strings ────────────────────────────
{
  const preyOf = (rules) => rules.find((r) => r.id === PREDATION_PREY_RULE_ID);
  const birthOf = (rules) => rules.find((r) => r.id === PREDATION_BIRTH_RULE_ID);
  check('2 defaults reproduce the legacy kill string',
    preyOf(buildPredationRules(ON)).condition === 'pred >= 1');
  check('2 defaults reproduce the legacy convert string',
    preyOf(buildPredationRules({ ...ON, gpgpuPredationOutcome: 'convert' })).condition === '(pred >= 1) * (state != 255)');
  check('2 strike is baked into the legacy core as before',
    preyOf(buildPredationRules({ ...ON, gpgpuPredationStrike: 3 })).condition === 'pred >= 3');
  check('2 frames > 1 switches the core to predhold',
    preyOf(buildPredationRules({ ...ON, gpgpuPredationStrikeFrames: 30 })).condition === 'predhold >= 30'
    && preyOf(buildPredationRules({ ...ON, gpgpuPredationOutcome: 'convert', gpgpuPredationStrikeFrames: 30 })).condition === '(predhold >= 30) * (state != 255)');
  check('2 grace multiplies in the predage gate',
    preyOf(buildPredationRules({ ...ON, gpgpuPredationGraceSeconds: 2.5 })).condition === '(pred >= 1) * (predage >= 2.5)'
    && preyOf(buildPredationRules({ ...ON, gpgpuPredationGraceSeconds: 3 })).condition === '(pred >= 1) * (predage >= 3)');
  check('2 frames + grace compose',
    preyOf(buildPredationRules({ ...ON, gpgpuPredationStrikeFrames: 30, gpgpuPredationGraceSeconds: 2.5 })).condition === '(predhold >= 30) * (predage >= 2.5)');
  check('2 the birth rule never changes shape',
    birthOf(buildPredationRules({ ...ON, gpgpuPredationStrikeFrames: 30, gpgpuPredationGraceSeconds: 2.5 })).condition === 'prey >= 1');
}

// ── 3. Fragment ──────────────────────────────────────────
{
  const legacyRules = [
    { id: PREDATION_PREY_RULE_ID, enabled: true, target: { type: 'all' }, condition: 'pred >= 1', action: { type: 'true-kill' } },
    { id: PREDATION_BIRTH_RULE_ID, enabled: true, target: { type: 'all' }, condition: 'prey >= 1', action: { type: 'spawn' } },
  ];
  const fragDefault = buildRuleEvalFragment(resolveLiveRulesWithPredation({ ...ON, gpgpuParticleRulesLive: '' }), OPTS);
  const fragLegacy = buildRuleEvalFragment(legacyRules, OPTS);
  check('3 default fragment is byte-identical to the legacy-rules fragment',
    fragDefault !== null && fragDefault === fragLegacy);
  check('3 default fragment carries neither new supply',
    !fragDefault.includes('uPredHoldTex') && !fragDefault.includes('simPredHold')
    && !fragDefault.includes('uPredActivationTime') && !fragDefault.includes('simPredAge'));
  const fragHold = buildRuleEvalFragment(resolveLiveRulesWithPredation({ ...ON, gpgpuParticleRulesLive: '', gpgpuPredationStrikeFrames: 30 }), OPTS);
  check('3 predhold fragment emits the hold supply',
    fragHold.includes('uniform sampler2D uPredHoldTex;')
    && fragHold.includes('float simPredHold = texture2D(uPredHoldTex, vUv).r;'));
  const fragGrace = buildRuleEvalFragment(resolveLiveRulesWithPredation({ ...ON, gpgpuParticleRulesLive: '', gpgpuPredationGraceSeconds: 2.5 }), OPTS);
  check('3 predage fragment emits the activation supply',
    fragGrace.includes('uniform float uPredActivationTime;')
    && fragGrace.includes('float simPredAge = uTime - uPredActivationTime;'));
  const fragBoth = buildRuleEvalFragment([
    ...resolveLiveRulesWithPredation({ ...ON, gpgpuParticleRulesLive: '', gpgpuPredationStrikeFrames: 30 }),
    { id: 'user-pred', enabled: true, target: { type: 'all' }, condition: 'pred >= 1', action: { type: 'kill' } },
  ], OPTS);
  check('3 prey + predhold declare uPosTex exactly once',
    (fragBoth.match(/uniform sampler2D uPosTex;/g) || []).length === 1
    && fragBoth.includes('simPred') && fragBoth.includes('simPredHold'));
  const classified = classifyLiveRules(resolveLiveRulesWithPredation({ ...ON, gpgpuPredationStrikeFrames: 30, gpgpuPredationGraceSeconds: 2.5 }), OPTS);
  const preyEntry = classified.find((c) => c.rule.id === PREDATION_PREY_RULE_ID);
  check('3 classifiers see the follow-up variables',
    liveConditionUsesPredholdVar(preyEntry.conditionAst) && liveConditionUsesPredageVar(preyEntry.conditionAst));
}

// ── 4. CPU twin evaluation ───────────────────────────────
{
  const cfg = { ...ON, gpgpuParticleRulesLive: '', gpgpuPredationStrikeFrames: 30, gpgpuPredationGraceSeconds: 2.5 };
  const classified = classifyLiveRules(resolveLiveRulesWithPredation(cfg), OPTS);
  const step = (vars) => evaluateLiveRuleStep(classified, { vars: { state: 0, prey: 0, ...vars }, slots: [] });
  check('4 hold below the line does not kill',
    (step({ predhold: 29, predage: 3 }).mask & LIVE_RULE_TRUE_KILL_BIT) === 0);
  check('4 hold at the line kills once grace has passed',
    (step({ predhold: 30, predage: 3 }).mask & LIVE_RULE_TRUE_KILL_BIT) !== 0);
  check('4 inside grace nothing kills, however long the hold',
    (step({ predhold: 255, predage: 2.4 }).mask & LIVE_RULE_TRUE_KILL_BIT) === 0);
  const classifiedConvert = classifyLiveRules(
    resolveLiveRulesWithPredation({ ...cfg, gpgpuPredationOutcome: 'convert' }), OPTS);
  const stepConvert = (vars) => evaluateLiveRuleStep(classifiedConvert, { vars: { state: 0, prey: 0, ...vars }, slots: [] });
  check('4 convert transitions only when both gates clear',
    stepConvert({ predhold: 30, predage: 3 }).state === 255
    && stepConvert({ predhold: 30, predage: 1 }).state === 0
    && stepConvert({ predhold: 3, predage: 3 }).state === 0);
}

// ── 5. Hold twin ─────────────────────────────────────────
{
  const step = (prev, input) => predationHoldStep(prev, { strike: 1, inGrace: false, ...input });
  let s = { count: 0, ageSeen: 0 };
  s = step(s, { age: 0.1, pred: 5 });
  check('5 first held step counts 1', s.count === 1 && s.ageSeen === 0.1);
  s = step(s, { age: 0.2, pred: 5 });
  s = step(s, { age: 0.3, pred: 0 });
  check('5 a failed step resets the count', s.count === 0);
  s = step(s, { age: 0.4, pred: 5 });
  s = predationHoldStep(s, { age: 0.5, pred: 5, strike: 1, inGrace: true });
  check('5 grace holds the count at zero', s.count === 0);
  s = step(s, { age: 0.6, pred: 5 });
  s = step(s, { age: 0.05, pred: 5 });
  check('5 a respawn (age backwards) restarts, then counts the new life', s.count === 1 && s.ageSeen === 0.05);
  let sat = { count: 0, ageSeen: 0 };
  for (let i = 1; i <= 300; i++) sat = step(sat, { age: i * 0.1, pred: 5 });
  check('5 the count saturates at 255', sat.count === 255);
  check('5 strike above the count keeps resetting',
    predationHoldStep({ count: 7, ageSeen: 1 }, { age: 1.1, pred: 2, strike: 3, inGrace: false }).count === 0);
}

// ── 6. WGSL split ────────────────────────────────────────
{
  const classified = classifyLiveRules(resolveLiveRulesWithPredation({ ...ON, gpgpuPredationStrikeFrames: 30, gpgpuPredationGraceSeconds: 2.5 }), OPTS);
  const preyEntry = classified.find((c) => c.rule.id === PREDATION_PREY_RULE_ID);
  check('6 a predhold/predage condition has no WGSL form',
    liveConditionWgsl(preyEntry.conditionAst, 'tgt0', NAMES, NAMES2) === null);
  check('6 merged rules are not WGSL-coverable off default',
    !liveRulesWgslCoverable(resolveLiveRulesWithPredation({ ...ON, gpgpuPredationStrikeFrames: 30 }), OPTS)
    && !liveRulesWgslCoverable(resolveLiveRulesWithPredation({ ...ON, gpgpuPredationGraceSeconds: 2.5 }), OPTS));
}

// ── 7. Key registration ──────────────────────────────────
{
  check('7 the new keys sit at their identity defaults',
    APP_STATE_DEFAULT_GPGPU.gpgpuPredationStrikeFrames === 1
    && APP_STATE_DEFAULT_GPGPU.gpgpuPredationGraceSeconds === 0);
}

// ── 8. Hold pass source discipline ───────────────────────
{
  const src = readFileSync(join(ROOT, 'components', 'gpgpuPredationHoldPass.ts'), 'utf8');
  check('8 the hold pass embeds the REP supply lines by import',
    src.includes('REP_PREY_MAIN_LINES') && src.includes('REP_PREY_FUNCTION_LINES')
    && src.includes('from \'../lib/gpgpuParticleRulesLive\''));
  check('8 the hold pass mirrors predationHoldStep\'s branches',
    src.includes('if (simAge < prevData.g) acc = 0.0;')
    && src.includes('if (uTime < uGraceUntil)')
    && src.includes('acc = min(acc + 1.0, 255.0);'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
