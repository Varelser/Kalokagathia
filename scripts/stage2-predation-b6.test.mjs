/**
 * Grammar 2.0 stage 2, slice B6 (Predator-Prey semantics):
 * standalone node test.
 *
 * Pins:
 *  1 resolution (lib/gpgpuPredation.ts): defaults are the
 *    identity (disabled; outcome kill; birth on; strike 1;
 *    species / range resolved from the Particle Life keys
 *    with the velocity block's fallback — vision range when
 *    positive, else the interaction radius), clamps at every
 *    boundary (strike 1..64, species 2..6, unknown outcome
 *    falls back to kill), and the three activity predicates.
 *  2 the species twin: predationSpeciesOfIndex agrees with
 *    the attrSpeciesValue derivation for every species count.
 *  3 the neighbourhood twin against an independent brute
 *    force over the same sample set (texSize 8 = every texel
 *    sampled, texSize 16 = the stride subset), including the
 *    3x3 self-block skip, the range gate and parked
 *    particles never counting.
 *  4 the generated rules: shape per outcome (true-kill /
 *    set-state 255 with the not-yet-assimilated guard), the
 *    strike baked into the condition, birth on / off, and
 *    the merge discipline (user rules first, a user-owned id
 *    suppresses the generated rule, disabled = user list).
 *  5 the REP integration through the CPU twin: the merged
 *    rules classify live; a prey with a predator in range
 *    gains the true-kill bit (kill mode) or transitions to
 *    state 255 exactly once (convert mode); a predator with
 *    prey in range gains the spawn bit; nothing matches at
 *    zero counts.
 *  6 the fragment: the pre-B6 sample fragment keeps its
 *    sha256 pin (conditional emission — no prey block while
 *    no condition reads prey / pred); a prey fragment carries
 *    the supply block and declares uPosTex exactly once in
 *    every combination (alone / with sim / with sdf); the
 *    sampler count grows by at most the one position texture.
 *  7 the WGSL split: a prey condition has no WGSL form and
 *    the merged predation rules are not WGSL-coverable; the
 *    capability report requests 'predation' (unsupported,
 *    WebGL fallback) only while predation stands.
 *  8 key registration: the 4 new keys sit at their defaults.
 */
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b6-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform sampler2D /g) || []).length;

await build({
  stdin: {
    contents: `
      export { resolvePredation, predationActive, predationTrueKillActive, predationBirthActive, predationSpeciesOfIndex, predationNeighborhood, buildPredationRules, mergePredationRules, resolveLiveRulesWithPredation, predationRepStands, PREDATION_PREY_RULE_ID, PREDATION_BIRTH_RULE_ID, PREDATION_ASSIMILATED_STATE } from './lib/gpgpuPredation.ts';
      export { attrSpeciesValue } from './lib/gpgpuAttributes.ts';
      export { preySpeciesOf, predatorSpeciesOf } from './lib/particleLifeBehavior.ts';
      export { buildRuleEvalFragment, classifyLiveRules, evaluateLiveRuleStep, liveConditionWgsl, liveConditionUsesPredationVars, liveRulesWgslCoverable, compileExpression, LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_SPAWN_BIT } from './lib/gpgpuParticleRulesLive.ts';
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
  resolvePredation, predationActive, predationTrueKillActive, predationBirthActive,
  predationSpeciesOfIndex, predationNeighborhood, buildPredationRules,
  mergePredationRules, resolveLiveRulesWithPredation, predationRepStands,
  PREDATION_PREY_RULE_ID, PREDATION_BIRTH_RULE_ID, PREDATION_ASSIMILATED_STATE,
  attrSpeciesValue, preySpeciesOf, predatorSpeciesOf,
  buildRuleEvalFragment, classifyLiveRules, evaluateLiveRuleStep,
  liveConditionWgsl, liveConditionUsesPredationVars, liveRulesWgslCoverable,
  LIVE_RULE_TRUE_KILL_BIT, LIVE_RULE_SPAWN_BIT,
  getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['e', 'f', 'g', 'h'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const BASE = { gpgpuParticleLifeSpecies: 4, gpgpuParticleLifeVisionRange: 120, gpgpuParticleLifeRadius: 60 };

// ── 1. Resolution ────────────────────────────────────────
{
  const d = resolvePredation({});
  check('1 defaults resolve to the identity (disabled)',
    d.enabled === false && d.outcome === 'kill' && d.birth === true && d.strike === 1);
  check('1 range falls back vision -> radius like the velocity block',
    resolvePredation({ gpgpuParticleLifeVisionRange: 120, gpgpuParticleLifeRadius: 60 }).range === 120
    && resolvePredation({ gpgpuParticleLifeVisionRange: 0, gpgpuParticleLifeRadius: 60 }).range === 60
    && resolvePredation({ gpgpuParticleLifeVisionRange: 0, gpgpuParticleLifeRadius: 0 }).range === 1);
  check('1 clamps: strike 1..64, species 2..6, outcome falls back to kill',
    resolvePredation({ gpgpuPredationStrike: 0 }).strike === 1
    && resolvePredation({ gpgpuPredationStrike: 500 }).strike === 64
    && resolvePredation({ gpgpuParticleLifeSpecies: 1 }).speciesCount === 2
    && resolvePredation({ gpgpuParticleLifeSpecies: 9 }).speciesCount === 6
    && resolvePredation({ gpgpuPredationOutcome: 'bogus' }).outcome === 'kill'
    && resolvePredation({ gpgpuPredationOutcome: 'convert' }).outcome === 'convert');
  check('1 activity predicates follow enabled / outcome / birth',
    !predationActive({}) && predationActive({ gpgpuPredationEnabled: true })
    && predationTrueKillActive({ gpgpuPredationEnabled: true })
    && !predationTrueKillActive({ gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'convert' })
    && predationBirthActive({ gpgpuPredationEnabled: true })
    && !predationBirthActive({ gpgpuPredationEnabled: true, gpgpuPredationBirth: false }));
}

// ── 2. Species twin ──────────────────────────────────────
{
  let ok = true;
  for (const n of [2, 3, 4, 5, 6]) {
    for (let i = 0; i < 512; i++) {
      const viaAttr = Math.round(attrSpeciesValue(i, n) * (n - 1));
      if (predationSpeciesOfIndex(i, n) !== viaAttr) ok = false;
    }
  }
  check('2 species twin agrees with attrSpeciesValue for all counts', ok);
  check('2 cyclic relation is the behaviour layer chain',
    preySpeciesOf(0, 4) === 1 && preySpeciesOf(3, 4) === 0
    && predatorSpeciesOf(0, 4) === 3 && predatorSpeciesOf(3, 4) === 2);
}

// ── 3. Neighbourhood twin vs brute force ─────────────────
function bruteForce(positions, selfIndex, texSize, n, range, sampled) {
  const self = predationSpeciesOfIndex(selfIndex, n);
  const preySp = preySpeciesOf(self, n);
  const predSp = predatorSpeciesOf(self, n);
  const sx = positions[selfIndex * 4], sy = positions[selfIndex * 4 + 1], sz = positions[selfIndex * 4 + 2];
  const stx = selfIndex % texSize, sty = Math.floor(selfIndex / texSize);
  let prey = 0, pred = 0;
  for (const si of sampled) {
    const dx = (si % texSize) - stx, dy = Math.floor(si / texSize) - sty;
    if (Math.sqrt(dx * dx + dy * dy) < 1.5) continue;
    const d = Math.hypot(positions[si * 4] - sx, positions[si * 4 + 1] - sy, positions[si * 4 + 2] - sz);
    if (d < range && d > 0.001) {
      const os = predationSpeciesOfIndex(si, n);
      if (os === preySp) prey += 1;
      if (os === predSp) pred += 1;
    }
  }
  return { prey, pred };
}
{
  // texSize 8: 64 texels, stride 1 -> every texel is sampled.
  const texSize = 8, total = texSize * texSize;
  const positions = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    positions[i * 4] = ((i * 37) % 41) - 20;
    positions[i * 4 + 1] = ((i * 53) % 31) - 15;
    positions[i * 4 + 2] = ((i * 91) % 47) - 23;
  }
  const all = Array.from({ length: total }, (_, i) => i);
  let ok = true;
  for (const self of [0, 9, 27, 40, 63]) {
    for (const range of [8, 25, 60]) {
      const twin = predationNeighborhood(positions, self, texSize, 4, range);
      const brute = bruteForce(positions, self, texSize, 4, range, all);
      if (twin.prey !== brute.prey || twin.pred !== brute.pred) ok = false;
    }
  }
  check('3 twin matches brute force at texSize 8 (full sample set)', ok);

  // texSize 16: stride 4 -> sampled indices floor(i*4).
  const texSize16 = 16, total16 = texSize16 * texSize16;
  const positions16 = new Float32Array(total16 * 4);
  for (let i = 0; i < total16; i++) {
    positions16[i * 4] = ((i * 29) % 61) - 30;
    positions16[i * 4 + 1] = ((i * 43) % 51) - 25;
    positions16[i * 4 + 2] = ((i * 71) % 67) - 33;
  }
  const sampled16 = Array.from({ length: 64 }, (_, i) => Math.floor(i * (total16 / 64)));
  let ok16 = true;
  for (const self of [3, 100, 255]) {
    const twin = predationNeighborhood(positions16, self, texSize16, 3, 30);
    const brute = bruteForce(positions16, self, texSize16, 3, 30, sampled16);
    if (twin.prey !== brute.prey || twin.pred !== brute.pred) ok16 = false;
  }
  check('3 twin matches brute force at texSize 16 (stride subset)', ok16);

  // Parked particles (y = -99999) and out-of-range never count.
  const parked = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) { parked[i * 4 + 1] = -99999; }
  parked[0] = 0; parked[1] = 0; parked[2] = 0; // self at origin, everyone else parked
  const none = predationNeighborhood(parked, 0, texSize, 4, 120);
  check('3 parked neighbours never count', none.prey === 0 && none.pred === 0);
}

// ── 4. Generated rules + merge ───────────────────────────
{
  check('4 disabled generates no rules', buildPredationRules({ ...BASE }).length === 0);
  const kill = buildPredationRules({ ...BASE, gpgpuPredationEnabled: true });
  check('4 kill mode: prey true-kill + birth spawn, fixed ids',
    kill.length === 2
    && kill[0].id === PREDATION_PREY_RULE_ID && kill[0].action.type === 'true-kill'
    && kill[0].condition === 'pred >= 1' && kill[0].target.type === 'all'
    && kill[1].id === PREDATION_BIRTH_RULE_ID && kill[1].action.type === 'spawn'
    && kill[1].condition === 'prey >= 1');
  const strike3 = buildPredationRules({ ...BASE, gpgpuPredationEnabled: true, gpgpuPredationStrike: 3 });
  check('4 strike is baked into the prey condition', strike3[0].condition === 'pred >= 3');
  const convert = buildPredationRules({ ...BASE, gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'convert', gpgpuPredationBirth: false });
  check('4 convert mode: set-state 255 with the assimilated guard, birth off = one rule',
    convert.length === 1
    && convert[0].action.type === 'set-state' && convert[0].action.state === PREDATION_ASSIMILATED_STATE
    && convert[0].condition === `(pred >= 1) * (state != ${PREDATION_ASSIMILATED_STATE})`);
  const user = [{ id: 'mine', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'kill' } }];
  const merged = mergePredationRules(user, { ...BASE, gpgpuPredationEnabled: true });
  check('4 merge appends generated rules after the user rules',
    merged.length === 3 && merged[0].id === 'mine' && merged[1].id === PREDATION_PREY_RULE_ID);
  const clash = mergePredationRules(
    [{ id: PREDATION_PREY_RULE_ID, enabled: true, target: { type: 'all' }, condition: '', action: { type: 'kill' } }],
    { ...BASE, gpgpuPredationEnabled: true });
  check('4 a user-owned id suppresses the generated rule',
    clash.length === 2 && clash[0].action.type === 'kill' && clash[1].id === PREDATION_BIRTH_RULE_ID);
  check('4 merge with predation off returns the user list',
    mergePredationRules(user, { ...BASE }).length === 1);
  const viaText = resolveLiveRulesWithPredation({ ...BASE, gpgpuPredationEnabled: true, gpgpuParticleRulesLive: '' });
  check('4 resolveLiveRulesWithPredation parses + merges', viaText.length === 2);
}

// ── 5. REP integration through the CPU twin ──────────────
{
  const cfgKill = { ...BASE, gpgpuPredationEnabled: true, gpgpuParticleRulesLive: '' };
  const mergedKill = resolveLiveRulesWithPredation(cfgKill);
  const classifiedKill = classifyLiveRules(mergedKill, OPTS);
  check('5 generated rules classify live',
    classifiedKill.length === 2 && classifiedKill.every((c) => c.route === 'live'),
    JSON.stringify(classifiedKill.map((c) => c.route)));
  const step = (classified, vars) => evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, hit: 0, hits: 0, ...vars } });
  const eaten = step(classifiedKill, { prey: 0, pred: 1 });
  check('5 prey with a predator in range gains the true-kill bit',
    (eaten.mask & LIVE_RULE_TRUE_KILL_BIT) !== 0 && eaten.matched.includes(PREDATION_PREY_RULE_ID));
  const safe = step(classifiedKill, { prey: 0, pred: 0 });
  check('5 no encounter, no outcome',
    (safe.mask & LIVE_RULE_TRUE_KILL_BIT) === 0 && (safe.mask & LIVE_RULE_SPAWN_BIT) === 0 && safe.matched.length === 0);
  const fed = step(classifiedKill, { prey: 2, pred: 0 });
  check('5 predator with prey in range gains the spawn bit',
    (fed.mask & LIVE_RULE_SPAWN_BIT) !== 0 && fed.matched.includes(PREDATION_BIRTH_RULE_ID));

  const cfgConvert = { ...BASE, gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'convert', gpgpuParticleRulesLive: '' };
  const classifiedConvert = classifyLiveRules(resolveLiveRulesWithPredation(cfgConvert), OPTS);
  const converted = step(classifiedConvert, { prey: 0, pred: 1, state: 0 });
  check('5 convert mode transitions the prey to the assimilated state',
    converted.state === PREDATION_ASSIMILATED_STATE && converted.matched.includes(PREDATION_PREY_RULE_ID));
  const already = step(classifiedConvert, { prey: 0, pred: 1, state: PREDATION_ASSIMILATED_STATE });
  check('5 an assimilated prey is not converted twice',
    already.state === PREDATION_ASSIMILATED_STATE && !already.matched.includes(PREDATION_PREY_RULE_ID));
  check('5 predationRepStands follows the merged list',
    predationRepStands(cfgKill, OPTS) === true && predationRepStands({ ...BASE, gpgpuParticleRulesLive: '' }, OPTS) === false);
}

// ── 6. Fragment identity + supply block ──────────────────
{
  const sample = [
    { id: 'r1', enabled: true, target: { type: 'all' }, condition: 'age > 0.8', action: { type: 'true-kill' } },
    { id: 'r2', enabled: true, target: { type: 'all' }, condition: 'hit > 0', action: { type: 'kill' } },
    { id: 'r3', enabled: true, target: { type: 'all' }, condition: 'sdf < 0', action: { type: 'set-state', state: 3 } },
    { id: 'r4', enabled: true, target: { type: 'all' }, condition: 'den > 0.5', action: { type: 'spawn' } },
  ];
  const fragBefore = buildRuleEvalFragment(sample, OPTS);
  check('6 pre-B6 sample fragment keeps its sha256 pin (re-pinned at B7: every REP fragment gained the fgMeander gate local + mask term)',
    sha256(fragBefore) === 'a6484691c35d7a2407c47310c4593aabc668251307b2fde44c7c0c6875735891',
    sha256(fragBefore));
  check('6 no prey block while no condition reads prey / pred',
    !fragBefore.includes('simPrey') && !fragBefore.includes('repSpecies'));

  const preyOnly = buildRuleEvalFragment(
    [{ id: 'p', enabled: true, target: { type: 'all' }, condition: 'pred >= 1', action: { type: 'true-kill' } }], OPTS);
  check('6 prey fragment carries the supply block',
    preyOnly.includes('float simPrey') && preyOnly.includes('float simPred')
    && preyOnly.includes('int repSpecies(vec2 uv)') && preyOnly.includes('uniform float uPreyRange;')
    && preyOnly.includes('dmHash11'));
  check('6 uPosTex declared exactly once (prey alone)',
    (preyOnly.match(/uniform sampler2D uPosTex;/g) || []).length === 1);
  const preySim = buildRuleEvalFragment(
    [{ id: 'p', enabled: true, target: { type: 'all' }, condition: '(pred >= 1) * (vel > 0.5)', action: { type: 'true-kill' } }], OPTS);
  check('6 uPosTex declared exactly once (prey + sim)',
    (preySim.match(/uniform sampler2D uPosTex;/g) || []).length === 1);
  const preySdf = buildRuleEvalFragment(
    [{ id: 'p', enabled: true, target: { type: 'all' }, condition: '(pred >= 1) * (sdf < 0)', action: { type: 'true-kill' } }], OPTS);
  check('6 uPosTex declared exactly once (prey + sdf)',
    (preySdf.match(/uniform sampler2D uPosTex;/g) || []).length === 1);
  const slotOnly = buildRuleEvalFragment(
    [{ id: 'p', enabled: true, target: { type: 'all' }, condition: 'a > 0.5', action: { type: 'true-kill' } }], OPTS);
  check('6 sampler growth is the position texture only (and zero when sim already pulls it)',
    samplerCount(preyOnly) === samplerCount(slotOnly) + 1
    && samplerCount(preySim) === samplerCount(buildRuleEvalFragment(
      [{ id: 'p', enabled: true, target: { type: 'all' }, condition: 'vel > 0.5', action: { type: 'true-kill' } }], OPTS)),
    `prey=${samplerCount(preyOnly)} slot=${samplerCount(slotOnly)} preySim=${samplerCount(preySim)}`);
  check('6 liveConditionUsesPredationVars detects both variables',
    liveConditionUsesPredationVars(classifyLiveRules(
      [{ id: 'p', enabled: true, target: { type: 'all' }, condition: 'prey >= 1', action: { type: 'spawn' } }], OPTS)[0].conditionAst) === true);
  check('6 fragment is null with predation off and no user rules',
    buildRuleEvalFragment(resolveLiveRulesWithPredation({ ...BASE, gpgpuParticleRulesLive: '' }), OPTS) === null);
}

// ── 7. WGSL split + capability ───────────────────────────
{
  const classified = classifyLiveRules(resolveLiveRulesWithPredation(
    { ...BASE, gpgpuPredationEnabled: true, gpgpuParticleRulesLive: '' }), OPTS);
  check('7 prey conditions have no WGSL form',
    classified.every((c) => liveConditionWgsl(c.conditionAst, 'tgt', NAMES, NAMES2) === null));
  check('7 merged predation rules are not WGSL-coverable',
    liveRulesWgslCoverable(resolveLiveRulesWithPredation(
      { ...BASE, gpgpuPredationEnabled: true, gpgpuParticleRulesLive: '' }), OPTS) === false);
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  const reportDefault = getWebgpuComputeCapabilityReport(base);
  check('7 defaults do not request predation',
    !reportDefault.requestedFeatures.includes('predation'));
  const reportOn = getWebgpuComputeCapabilityReport({ ...base, gpgpuPredationEnabled: true });
  check('7 predation requests its gap feature (unsupported, WebGL fallback)',
    reportOn.requestedFeatures.includes('predation') && reportOn.unsupportedFeatures.includes('predation'));
}

// ── 8. Key registration ──────────────────────────────────
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check('8 new keys sit at their defaults',
    d.gpgpuPredationEnabled === false && d.gpgpuPredationOutcome === 'kill'
    && d.gpgpuPredationBirth === true && d.gpgpuPredationStrike === 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
