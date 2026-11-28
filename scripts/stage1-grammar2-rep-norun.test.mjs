// Grammar 2.0 stage 1 — REP never runs on a live-rules-only
// config (real-GPU gate finding, C group: unconditional kill /
// true-kill / force-gate configs were statistically identical
// to the no-rule control; shader-source interception showed
// the consumer live variants compiled but the REP fragment
// itself — marker `liveTrueKill` — never did).
//
// Root cause: the REP reads the final attribute texture (the
// scene's simAttrTex) and the scene suppresses its run while
// that texture is null. The attribute bake in useGpgpuRuntime
// stood only for the legacy consumers or an effective BAKED
// rule list; the LIVE rule list was never registered as a
// consumer, so a live-rules-only config left attrTexRef null
// and the REP — though built — never rendered.
//
// The fix: useGpgpuRuntime resolves the shared predicate
// liveRuleEvalStands (lib/gpgpuParticleRulesLive.ts) with the
// scene's own build options and stands the bake whenever the
// REP stands. With no live rules the predicate is false and
// the standing condition reduces exactly to the pre-fix one.
//
// Cases:
//  1 the gate regression chain, end to end on the lib layer:
//    for each probe config the preconditions of the bug hold
//    (no legacy consumer, no baked rules), the fragment is
//    non-null, the PRE-fix standing condition is false (the
//    bug), and the POST-fix condition is true — so simAttrTex
//    is non-null and the scene's run gate passes
//  2 predicate precision: '' / disabled / unconsumed-action
//    ('color') live lists do not stand the REP; consumed
//    actions (kill / true-kill / force-gate / set-state /
//    spawn) do; the predicate agrees with the fragment test
//    on every case
//  3 identity: with live rules unset, the standing condition
//    equals the pre-fix condition across consumer
//    combinations (legacy consumer on / baked rules on /
//    both / neither)
//  4 wiring pin: the runtime source resolves liveRepStands
//    through liveRuleEvalStands with the scene's options and
//    the attrSignature condition includes it
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1repnorun-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
      export { resolveAttrConsumers } from './lib/gpgpuAttributes.ts';
      export { resolveParticleRules } from './lib/gpgpuParticleRules.ts';
      export { resolveLiveParticleRules, buildRuleEvalFragment, liveRuleEvalStands } from './lib/gpgpuParticleRulesLive.ts';
      export { parseGpgpuGroups } from './lib/gpgpuGroups.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  APP_STATE_DEFAULT_GPGPU, resolveAttrConsumers, resolveParticleRules,
  resolveLiveParticleRules, buildRuleEvalFragment, liveRuleEvalStands,
  parseGpgpuGroups,
} = lib;

// The scene's own build options for the REP fragment
// (sceneGpgpuSystem render): the predicate and the runtime
// must use exactly these.
const sceneOptions = (cfg) => ({
  names: cfg.gpgpuAttrNames,
  names2: cfg.gpgpuAttrNames2,
  groupDefs: parseGpgpuGroups(cfg.gpgpuGroupsData ?? ''),
  densityAvailable: true,
});

// The standing conditions, transcribed from useGpgpuRuntime:
// pre-fix (legacy consumers or baked rules) and post-fix
// (plus the REP predicate).
const standsPreFix = (cfg) => resolveAttrConsumers(cfg).anyActive
  || resolveParticleRules(cfg.gpgpuParticleRules ?? '').length > 0;
const standsPostFix = (cfg) => standsPreFix(cfg)
  || liveRuleEvalStands(cfg.gpgpuParticleRulesLive ?? '', sceneOptions(cfg));

// The gate FALL base: app defaults for every key the harness
// does not name (no attribute consumer key, no baked rules,
// no groups — batch_common BASE/FLOOR).
const BASE_CFG = { ...APP_STATE_DEFAULT_GPGPU };
const liveRule = (id, action, condition = '', extra = {}) => ({
  id, enabled: true, target: { type: 'all' }, condition, action, ...extra,
});
const liveText = (rules) => JSON.stringify(rules);

// --- 1. the gate regression chain -------------------------------------
{
  const probeCases = {
    'kill unconditional': liveText([liveRule('ka', { type: 'kill' }, '')]),
    'kill cond 1': liveText([liveRule('k1', { type: 'kill' }, '1')]),
    'true-kill unconditional': liveText([liveRule('ta', { type: 'true-kill' }, '')]),
    'true-kill cond 1': liveText([liveRule('t1', { type: 'true-kill' }, '1')]),
    'force-gate gravity age>100': liveText([liveRule('fn', { type: 'force-gate', force: 'gravity' }, 'age > 100')]),
    'force-gate gravity always': liveText([liveRule('fa', { type: 'force-gate', force: 'gravity' }, '')]),
  };
  for (const [name, live] of Object.entries(probeCases)) {
    const cfg = { ...BASE_CFG, gpgpuParticleRulesLive: live };
    const fragment = buildRuleEvalFragment(
      resolveLiveParticleRules(live), sceneOptions(cfg),
    );
    check(`1 [${name}] bug preconditions: no legacy consumer, no baked rules`,
      !resolveAttrConsumers(cfg).anyActive
      && resolveParticleRules(cfg.gpgpuParticleRules ?? '').length === 0);
    check(`1 [${name}] REP fragment is non-null (contains liveTrueKill)`,
      fragment !== null && fragment.includes('liveTrueKill'));
    check(`1 [${name}] PRE-fix condition leaves the bake down (the bug)`,
      standsPreFix(cfg) === false);
    check(`1 [${name}] POST-fix condition stands the bake -> simAttrTex non-null -> REP run gate passes`,
      standsPostFix(cfg) === true);
  }
}

// --- 2. predicate precision -------------------------------------------
{
  const stands = (live) => liveRuleEvalStands(live, sceneOptions(BASE_CFG));
  const fragmentStands = (live) => buildRuleEvalFragment(
    resolveLiveParticleRules(live), sceneOptions(BASE_CFG),
  ) !== null;
  const cases = {
    'empty list': '',
    'disabled kill rule': liveText([liveRule('d1', { type: 'kill' }, '', { enabled: false })]),
    'unconsumed color action': liveText([liveRule('c1', { type: 'color', color: [1, 0, 0] }, '')]),
    'kill': liveText([liveRule('k1', { type: 'kill' }, '')]),
    'true-kill': liveText([liveRule('t1', { type: 'true-kill' }, '')]),
    'force-gate': liveText([liveRule('f1', { type: 'force-gate', force: 'gravity' }, '')]),
    'set-state': liveText([liveRule('s1', { type: 'set-state', state: 2 }, 'age > 0.5')]),
    'spawn': liveText([liveRule('p1', { type: 'spawn' }, 'age > 0.9')]),
    'broken json': '{not json',
  };
  const expected = {
    'empty list': false,
    'disabled kill rule': false,
    'unconsumed color action': false,
    'kill': true,
    'true-kill': true,
    'force-gate': true,
    'set-state': true,
    'spawn': true,
    'broken json': false,
  };
  for (const [name, live] of Object.entries(cases)) {
    check(`2 [${name}] stands === ${expected[name]}`, stands(live) === expected[name]);
    check(`2 [${name}] predicate agrees with the fragment test`,
      stands(live) === fragmentStands(live));
  }
}

// --- 3. identity with live rules unset ---------------------------------
{
  const combos = {
    'neither consumer nor baked rules': { ...BASE_CFG },
    'legacy size consumer on': { ...BASE_CFG, gpgpuAttrSizeSlot: 0, gpgpuAttrSizeAmount: 0.5 },
    'legacy group consumer on': { ...BASE_CFG, gpgpuGroupEnabled: true },
    'baked rules on': {
      ...BASE_CFG,
      gpgpuParticleRules: liveText([liveRule('b1', { type: 'kill' }, '')]),
    },
    'both on': {
      ...BASE_CFG,
      gpgpuAttrSizeSlot: 1, gpgpuAttrSizeAmount: 0.25,
      gpgpuParticleRules: liveText([liveRule('b1', { type: 'kill' }, '')]),
    },
  };
  for (const [name, cfg] of Object.entries(combos)) {
    check(`3 [${name}] live unset: post-fix condition === pre-fix condition`,
      standsPostFix(cfg) === standsPreFix(cfg),
      `pre=${standsPreFix(cfg)} post=${standsPostFix(cfg)}`);
  }
  // An unconsumed-only live list must not change the condition
  // either (the REP does not stand for it).
  const colorOnly = {
    ...BASE_CFG,
    gpgpuParticleRulesLive: liveText([liveRule('c1', { type: 'color', color: [0, 1, 0] }, '')]),
  };
  check('3 [unconsumed live list] condition unchanged vs pre-fix',
    standsPostFix(colorOnly) === standsPreFix(colorOnly));
}

// --- 4. wiring pin ------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'components', 'useGpgpuRuntime.ts'), 'utf8');
  check('4a runtime imports liveRuleEvalStands from the live rules lib',
    src.includes("import { liveRuleEvalStands } from '../lib/gpgpuParticleRulesLive';"));
  check('4b runtime resolves liveRepStands with the scene options (densityAvailable: true)',
    src.includes("const liveRepStands = liveRuleEvalStands(config.gpgpuParticleRulesLive ?? '', {")
    && src.includes('densityAvailable: true,'));
  check('4c attrSignature standing condition includes liveRepStands',
    src.includes('attrConsumers.anyActive || particleRules.length > 0 || liveRepStands'));
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  check('4d scene run gate still requires simAttrTex (the texture this fix stands)',
    sceneSrc.includes('if (ruleEvalPass && simAttrTex)'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
