// Grammar 2.0 stage 1, slice 1E — hierarchical rule sets
// and the Black Box (single-set export / import) in the
// live rule grammar (lib/gpgpuParticleRulesLive.ts). CPU /
// serialisation only; no shader changes. Design:
// kalokagathia-pro/STAGE1_GRAMMAR2_DESIGN.md section 5;
// implementation record: STAGE1_1E_IMPL_RECORD.md.
//
// Fixed serialisation rules under test:
//  - the config key reads BOTH the flat form (JSON array of
//    rules, the 1A/1B format) and the set form
//    ({ version: 1, sets: [{ id, name?, enabled, rules }] });
//    a flat string is one implicit set (id 'flat')
//  - expansion: enabled sets in document order, rules in
//    set order, rule ids first-wins across the document,
//    the global rule cap (16) applies to the expansion
//  - a document that is exactly the implicit flat set
//    serialises back in the flat form (byte-identical
//    round-trip of existing flat strings)
//  - Black Box payload: { kind, version: 1, set }; import
//    validates like the rule list and reassigns fresh ids
//    where an id collides with an existing one
//
// Cases:
//  1 flat compatibility (implicit set, round-trip, both
//    forms read by parseLiveParticleRules)
//  2 set-form parse / validate discipline
//  3 expansion order rules
//  4 document serialisation round-trips
//  5 Black Box export / import
//  6 set switching through the state condition (CPU twin):
//    one set's rules only act in the state another set's
//    set-state rule moves the particle into
//  7 identity: the v2.22.0 velocity / position shader pins
//    from slice 1A are unbroken
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1e-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, hasEffectiveLiveRules, liveRulesHaveConsumedAction, serializeLiveParticleRules, parseLiveRuleSetDocument, serializeLiveRuleSetDocument, expandLiveRuleSets, validateLiveRuleSet, exportLiveRuleSet, importLiveRuleSet, classifyLiveRules, evaluateLiveRuleStep, LIVE_RULE_FLAT_SET_ID, LIVE_RULE_SETS_MAX_SETS, LIVE_RULE_SET_EXPORT_KIND, LIVE_RULE_KILL_BIT } from './lib/gpgpuParticleRulesLive.ts';
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
  parseLiveParticleRules, resolveLiveParticleRules, hasEffectiveLiveRules,
  liveRulesHaveConsumedAction, serializeLiveParticleRules,
  parseLiveRuleSetDocument, serializeLiveRuleSetDocument, expandLiveRuleSets,
  validateLiveRuleSet, exportLiveRuleSet, importLiveRuleSet,
  classifyLiveRules, evaluateLiveRuleStep,
  LIVE_RULE_FLAT_SET_ID, LIVE_RULE_SETS_MAX_SETS, LIVE_RULE_SET_EXPORT_KIND,
  LIVE_RULE_KILL_BIT,
} = lib;
const { buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const set = (id, rules, extra = {}) => ({ id, enabled: true, rules, ...extra });
const J = (v) => JSON.stringify(v);
// Canonical (key-sorted) stringify for deep comparisons.
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};
const deepEq = (a, b) => canon(a) === canon(b);
const ids = (rules) => rules.map((r) => r.id);

// --- 1. flat compatibility ---------------------------------------------------
{
  const flat = serializeLiveParticleRules([
    rule('k1', { type: 'kill' }, '', { type: 'all' }, { name: ' Killer ' }),
    rule('g1', { type: 'force-gate', force: 'wind' }, 'vel > 1'),
  ]);
  const doc = parseLiveRuleSetDocument(flat);
  check('1a a flat string parses as one implicit enabled set',
    doc.sets.length === 1 && doc.sets[0].id === LIVE_RULE_FLAT_SET_ID
    && doc.sets[0].enabled === true && doc.sets[0].name === undefined
    && ids(doc.sets[0].rules).join(',') === 'k1,g1',
    J(doc.sets.map((s) => s.id)));
  check('1b flat strings round-trip byte-identically through the document layer',
    serializeLiveRuleSetDocument(doc) === flat,
    serializeLiveRuleSetDocument(doc));
  check('1c empty / broken strings are an empty document',
    parseLiveRuleSetDocument('').sets.length === 0
    && parseLiveRuleSetDocument(null).sets.length === 0
    && parseLiveRuleSetDocument('not json').sets.length === 0
    && parseLiveRuleSetDocument('{"a":1}').sets.length === 0
    && parseLiveRuleSetDocument('[]').sets.length === 0
    && serializeLiveRuleSetDocument({ sets: [] }) === ''
    && serializeLiveRuleSetDocument(null) === '');
}
{
  const setForm = J({
    version: 1,
    sets: [
      set('s1', [rule('a', { type: 'kill' })]),
      set('s2', [rule('b', { type: 'force-gate', force: 'curl' })], { enabled: false }),
    ],
  });
  check('1d parseLiveParticleRules reads the set form (expansion view)',
    ids(parseLiveParticleRules(setForm)).join(',') === 'a'
    && ids(resolveLiveParticleRules(setForm)).join(',') === 'a'
    && hasEffectiveLiveRules(setForm)
    && liveRulesHaveConsumedAction(setForm));
  const onlyDisabled = J({ version: 1, sets: [set('s2', [rule('b', { type: 'kill' })], { enabled: false })] });
  check('1e a document of only disabled sets has no effective rules',
    parseLiveParticleRules(onlyDisabled).length === 0 && !hasEffectiveLiveRules(onlyDisabled));
}

// --- 2. set-form parse / validate discipline ----------------------------------
{
  const doc = parseLiveRuleSetDocument(J({
    version: 1,
    sets: [
      set('alpha', [rule('r1', { type: 'kill' })], { name: ' Alpha ' }),
      set('bad id!', [rule('r2', { type: 'kill' })]),
      set('alpha', [rule('r3', { type: 'kill' })]), // duplicate set id: first wins
      { id: 'norules', enabled: true, rules: 'nope' },
      { id: 'badenabled', enabled: 'yes', rules: [] },
      set('beta', [
        rule('r4', { type: 'kill' }),
        rule('r4', { type: 'force-gate', force: 'wind' }), // duplicate rule id in set: first wins
        rule('bad id!', { type: 'kill' }),
        { id: 'noact', enabled: true, target: { type: 'all' }, condition: '' },
      ]),
    ],
  }));
  check('2a broken sets drop individually, duplicate set id first wins, names trim',
    ids(doc.sets).join(',') === 'alpha,beta'
    && doc.sets[0].name === 'Alpha'
    && ids(doc.sets[1].rules).join(',') === 'r4',
    J(doc.sets.map((s) => [s.id, ids(s.rules)])));
  check('2b an unknown format version falls back wholesale; a missing version is accepted',
    parseLiveRuleSetDocument(J({ version: 2, sets: [set('a', [rule('r', { type: 'kill' })])] })).sets.length === 0
    && parseLiveRuleSetDocument(J({ sets: [set('a', [rule('r', { type: 'kill' })])] })).sets.length === 1);
  const many = Array.from({ length: LIVE_RULE_SETS_MAX_SETS + 3 }, (_, i) => set(`s${i}`, [rule(`r${i}`, { type: 'kill' })]));
  check('2c the set cap applies',
    parseLiveRuleSetDocument(J({ version: 1, sets: many })).sets.length === LIVE_RULE_SETS_MAX_SETS);
  check('2d validateLiveRuleSet: enabled defaults true, empty rules are a valid set',
    validateLiveRuleSet({ id: 'x', rules: [] }).enabled === true
    && validateLiveRuleSet({ id: 'x', rules: [] }).rules.length === 0
    && validateLiveRuleSet(null) === null
    && validateLiveRuleSet({ id: 'x' }) === null);
}

// --- 3. expansion order rules ---------------------------------------------------
{
  const doc = {
    sets: [
      set('A', [rule('a1', { type: 'kill' }), rule('a2', { type: 'kill' })]),
      set('B', [rule('b1', { type: 'kill' })], { enabled: false }),
      set('C', [
        rule('a1', { type: 'force-gate', force: 'wind' }), // cross-set duplicate: A wins
        rule('c1', { type: 'kill' }, '', { type: 'all' }, { enabled: false }),
        rule('c2', { type: 'kill' }),
      ]),
    ],
  };
  const expanded = expandLiveRuleSets(doc.sets);
  check('3a expansion: set order, rule order, disabled set contributes nothing, first-wins across sets',
    ids(expanded).join(',') === 'a1,a2,c1,c2'
    && expanded[0].action.type === 'kill',
    ids(expanded).join(','));
  check('3b disabled rules stay in the expansion and are filtered at resolve',
    expanded.some((r) => r.id === 'c1' && r.enabled === false)
    && ids(resolveLiveParticleRules(serializeLiveRuleSetDocument(doc))).join(',') === 'a1,a2,c2');
  const big = {
    sets: [
      set('A', Array.from({ length: 10 }, (_, i) => rule(`a${i}`, { type: 'kill' }))),
      set('B', Array.from({ length: 10 }, (_, i) => rule(`b${i}`, { type: 'kill' }))),
    ],
  };
  const bigExpanded = expandLiveRuleSets(big.sets);
  check('3c the global rule cap (16) applies across the expansion',
    bigExpanded.length === 16 && bigExpanded[15].id === 'b5',
    `${bigExpanded.length} ${bigExpanded[15]?.id}`);
  check('3d expansion of a parsed document equals parseLiveParticleRules of its string',
    deepEq(
      expandLiveRuleSets(parseLiveRuleSetDocument(serializeLiveRuleSetDocument(doc)).sets),
      parseLiveParticleRules(serializeLiveRuleSetDocument(doc)),
    ));
}

// --- 4. document serialisation round-trips ---------------------------------------
{
  const doc = {
    sets: [
      set('alpha', [rule('r1', { type: 'kill' }, 'sdf < 0')], { name: 'Inside' }),
      set('beta', [rule('r2', { type: 'set-state', state: 3 })], { enabled: false }),
    ],
  };
  const text = serializeLiveRuleSetDocument(doc);
  const back = parseLiveRuleSetDocument(text);
  check('4a a multi-set document round-trips through the set form',
    text.startsWith('{"version":1,"sets":')
    && deepEq(back.sets, parseLiveRuleSetDocument(text).sets)
    && back.sets.length === 2 && back.sets[0].name === 'Inside'
    && back.sets[1].enabled === false
    && serializeLiveRuleSetDocument(back) === text,
    text.slice(0, 80));
  const single = serializeLiveRuleSetDocument({ sets: [set('solo', [rule('r', { type: 'kill' })])] });
  check('4b a single non-flat set does not collapse to the flat form',
    single.startsWith('{"version":1,"sets":')
    && parseLiveRuleSetDocument(single).sets[0].id === 'solo');
  const disabledFlat = serializeLiveRuleSetDocument({
    sets: [{ id: LIVE_RULE_FLAT_SET_ID, enabled: false, rules: [rule('r', { type: 'kill' })] }],
  });
  check('4c a disabled implicit set keeps the set form (its state survives)',
    disabledFlat.startsWith('{"version":1,"sets":')
    && parseLiveRuleSetDocument(disabledFlat).sets[0].enabled === false
    && parseLiveParticleRules(disabledFlat).length === 0);
  check('4d broken sets are dropped at serialise time',
    serializeLiveRuleSetDocument({ sets: [{ id: 'bad id!', enabled: true, rules: [] }] }) === '');
}

// --- 5. Black Box export / import --------------------------------------------------
{
  const original = validateLiveRuleSet(set('box', [
    rule('keep', { type: 'kill' }, 'vel > 1'),
    rule('gate', { type: 'force-gate', force: 'all' }),
  ], { name: 'Boxed' }));
  const text = exportLiveRuleSet(original);
  check('5a export produces a tagged payload; import without collisions is lossless',
    text.includes(`"kind":"${LIVE_RULE_SET_EXPORT_KIND}"`)
    && deepEq(importLiveRuleSet(text), original),
    text.slice(0, 80));
  check('5b an invalid set exports as ""',
    exportLiveRuleSet(null) === ''
    && exportLiveRuleSet({ id: 'bad id!', enabled: true, rules: [] }) === '');
  check('5c broken payloads import as null',
    importLiveRuleSet('') === null
    && importLiveRuleSet(null) === null
    && importLiveRuleSet('not json') === null
    && importLiveRuleSet(J({ kind: 'other', version: 1, set: original })) === null
    && importLiveRuleSet(J({ kind: LIVE_RULE_SET_EXPORT_KIND, version: 2, set: original })) === null
    && importLiveRuleSet(J({ kind: LIVE_RULE_SET_EXPORT_KIND, version: 1 })) === null
    && importLiveRuleSet(J({ kind: LIVE_RULE_SET_EXPORT_KIND, version: 1, set: { id: 'bad id!', rules: [] } })) === null
    && importLiveRuleSet(' '.repeat(100_001)) === null);
  const withBroken = exportLiveRuleSet(validateLiveRuleSet({
    id: 'mix', enabled: true,
    rules: [rule('ok', { type: 'kill' })],
  }));
  const tampered = J({
    kind: LIVE_RULE_SET_EXPORT_KIND, version: 1,
    set: { id: 'mix', enabled: true, rules: [rule('ok', { type: 'kill' }), { id: 'broken' }, rule('ok', { type: 'force-gate', force: 'wind' })] },
  });
  check('5d broken rules inside a payload drop individually, first duplicate wins',
    withBroken.length > 0
    && ids(importLiveRuleSet(tampered).rules).join(',') === 'ok'
    && importLiveRuleSet(tampered).rules[0].action.type === 'kill');
  const imported = importLiveRuleSet(text, { rules: ['keep'], sets: ['box'] });
  check('5e colliding rule / set ids are reassigned fresh ids; others are kept',
    imported !== null
    && imported.id !== 'box' && imported.id.length > 0
    && imported.rules[0].id !== 'keep' && imported.rules[1].id === 'gate'
    && imported.rules.every((r) => r.id !== 'keep'),
    J(imported && [imported.id, ids(imported.rules)]));
  const clean = importLiveRuleSet(text, { rules: ['unrelated'], sets: ['other'] });
  check('5f non-colliding imports keep every id',
    clean !== null && clean.id === 'box' && ids(clean.rules).join(',') === 'keep,gate');
  const twice = importLiveRuleSet(text, { rules: ['keep', 'gate'] });
  check('5g reassigned ids are unique and do not collide with each other or the existing ids',
    twice !== null
    && new Set(ids(twice.rules)).size === 2
    && !ids(twice.rules).includes('keep') && !ids(twice.rules).includes('gate'));
}

// --- 6. set switching through the state condition (CPU twin) -----------------------
{
  const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: false };
  const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
  const step = (classified, state) => evaluateLiveRuleStep(classified, {
    slots: ZEROS,
    vars: { vel: 0, age: 0, rad: 0, t: 0, state, den: 0, sdf: 1e6 },
  });
  // The "switch" is written entirely in the expression
  // language: the trigger set's rule moves the particle to
  // state 2; the burn set's rules are all conditioned on
  // state == 2, so they act only once the switch has fired.
  const docText = J({
    version: 1,
    sets: [
      set('trigger', [rule('arm', { type: 'set-state', state: 2 }, 'state == 0')]),
      set('burn', [rule('fire', { type: 'kill' }, 'state == 2')]),
    ],
  });
  const classified = classifyLiveRules(resolveLiveParticleRules(docText), OPTS);
  const s1 = step(classified, 0);
  const s2 = step(classified, s1.state);
  check('6a the trigger set arms state 2; the burn set acts from the next evaluation',
    s1.state === 2 && s1.matched.join(',') === 'arm' && (s1.mask & LIVE_RULE_KILL_BIT) === 0
    && s2.matched.join(',') === 'fire' && (s2.mask & LIVE_RULE_KILL_BIT) === LIVE_RULE_KILL_BIT,
    J({ s1, s2 }));
  const offText = J({
    version: 1,
    sets: [
      set('trigger', [rule('arm', { type: 'set-state', state: 2 }, 'state == 0')]),
      set('burn', [rule('fire', { type: 'kill' }, 'state == 2')], { enabled: false }),
    ],
  });
  const classifiedOff = classifyLiveRules(resolveLiveParticleRules(offText), OPTS);
  const o1 = step(classifiedOff, 0);
  const o2 = step(classifiedOff, o1.state);
  check('6b with the burn set disabled its rules never act, whatever the state',
    o1.state === 2 && o2.matched.length === 0 && (o2.mask & LIVE_RULE_KILL_BIT) === 0,
    J({ o1, o2 }));
}

// --- 7. identity pins from 1A ---------------------------------------------------------
const sha = (s) => createHash('sha256').update(s).digest('hex');
check('7a default velocity string is still the shipped v2.25.0 string (統合時点)',
  sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
  sha(SIM_VEL_FRAG));
check('7b default position string is still the shipped v2.25.0 string (統合時点)',
  sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
  sha(SIM_POS_FRAG));
check('7c builders without the live option still return the defaults',
  buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG
  && buildPositionFragment({}) === SIM_POS_FRAG);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
