// Phase 45 (G10 stage 1) — particle rules: the composable
// "condition -> application" grammar (lib/gpgpuParticleRules.ts).
//
// The 12 gate cases fixed for stage 1 (design
// kalokagathia-pro/G10_DESIGN.md; the design file's sections
// 5-7 were lost to a truncation in the authoring chat, so the
// case list was reconstructed from the fixed sections 1-4 and
// recorded in kalokagathia-pro/G10_STAGE1_RECORD.md):
//  1 identity: '' = no rules, apply returns null (bake untouched)
//  2 broken inputs fall back wholesale / per-rule
//  3 single predicate force-gate (permit semantics)
//  4 force-gate 'all'
//  5 multiple force rules union
//  6 disabled rules are inert but survive serialisation
//  7 kill bit
//  8 colour: last match wins, bake-local
//  9 group target (incl. dangling reference)
// 10 condition expressions (slot names, aliases, sim vars, g;
//    compile failure and NaN never match)
// 11 invalid rules drop individually; clamps; caps
// 12 equivalence with the legacy baked-group gate + pristine
//    immutability
// Plus the shader splicing discipline: the rule segments exist
// only in the variant strings; the default strings are the
// shipped ones.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p45-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseParticleRules, resolveParticleRules, hasEffectiveParticleRules, particleRulesHaveAction, serializeParticleRules, isDefaultParticleRules, validateParticleRule, applyParticleRulesToBake, particleRulesReferenceExtSlots, PARTICLE_RULE_KILL_BIT } from './lib/gpgpuParticleRules.ts';
      export { buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  parseParticleRules, resolveParticleRules, hasEffectiveParticleRules,
  particleRulesHaveAction, serializeParticleRules, isDefaultParticleRules,
  applyParticleRulesToBake,
} = lib;
const { buildVelocityFragment, buildPositionFragment, SIM_POS_FRAG } = lib;

// --- shared fixture -------------------------------------------------
// slot0 slot1 slot2 slot3 / pos (xyz, ageRaw) / vel (xyz)
const ATTR = new Float32Array([
  0.9, 0.1, 0.0, 0.7,
  0.2, 0.9, 0.0, 0.3,
  0.6, 0.6, 0.0, 0.5,
  0.1, 0.2, 0.0, 0.9,
]);
const POS = new Float32Array([
  0, 0, 0, 0,
  3, 0, 0, 5,
  0, 4, 0, 10,
  0, 0, 1, 2.5,
]);
const VEL = new Float32Array([
  3, 0, 0, 0,
  0, 0, 0, 0,
  1, 0, 0, 0,
  0, 2, 0, 0,
]);
const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const apply = (rules, extra = {}) => applyParticleRulesToBake({
  rules, groupDefs: [], attrData: ATTR, count: 4,
  names: NAMES, names2: NAMES2, posData: POS, velData: VEL,
  ageMax: 10, bounceRadius: 5, colorSlots: null, ...extra,
});
const masks = (out) => [0, 1, 2, 3].map((i) => out[i * 4 + 3]);
const rule = (over) => ({
  id: 'r1', enabled: true, target: { type: 'all' }, condition: '',
  action: { type: 'kill' }, ...over,
});

// --- case 1: identity ------------------------------------------------
{
  check('1a empty string parses to no rules', parseParticleRules('').length === 0);
  check('1b undefined parses to no rules', parseParticleRules(undefined).length === 0);
  check('1c isDefault on empty', isDefaultParticleRules('') && isDefaultParticleRules([]) && !isDefaultParticleRules(JSON.stringify([rule({})])));
  check('1d serialize of empty list is empty string', serializeParticleRules([]) === '');
  check('1e apply with no rules returns null', apply([]) === null);
  check('1f apply with only disabled rules returns null',
    apply([rule({ enabled: false })]) === null);
  check('1g hasEffectiveParticleRules', !hasEffectiveParticleRules('') && hasEffectiveParticleRules(JSON.stringify([rule({})])));
}

// --- case 2: broken inputs -------------------------------------------
{
  check('2a broken JSON -> []', parseParticleRules('{oops').length === 0);
  check('2b non-array JSON -> []', parseParticleRules('{"a":1}').length === 0);
  check('2c over char cap -> []', parseParticleRules(' '.repeat(100_001)).length === 0);
  check('2d non-string -> []', parseParticleRules(42).length === 0);
}

// --- case 3: single predicate force-gate ------------------------------
{
  const out = apply([rule({
    target: { type: 'predicate', slot: 0, mode: 'above', low: 0.5, high: 1, invert: false },
    action: { type: 'force-gate', force: 'gravity' },
  })]);
  check('3a gravity permit only on matched', JSON.stringify(masks(out)) === '[31,30,31,30]', JSON.stringify(masks(out)));
  check('3b other channels untouched', out[0] === ATTR[0] && out[5] === ATTR[5] && out[10] === ATTR[10]);
}

// --- case 4: force-gate all -------------------------------------------
{
  const out = apply([rule({ action: { type: 'force-gate', force: 'all' } })]);
  check('4 all-force gate on all target permits everywhere', JSON.stringify(masks(out)) === '[31,31,31,31]');
  const out2 = apply([rule({
    target: { type: 'predicate', slot: 0, mode: 'below', low: 0, high: 0.3, invert: false },
    action: { type: 'force-gate', force: 'all' },
  })]);
  check('4b all-force gate restricted by predicate', JSON.stringify(masks(out2)) === '[0,31,0,31]', JSON.stringify(masks(out2)));
}

// --- case 5: union of force rules --------------------------------------
{
  const out = apply([
    rule({ id: 'r1', target: { type: 'predicate', slot: 0, mode: 'above', low: 0.5, high: 1, invert: false }, action: { type: 'force-gate', force: 'gravity' } }),
    rule({ id: 'r2', target: { type: 'predicate', slot: 1, mode: 'above', low: 0.5, high: 1, invert: false }, action: { type: 'force-gate', force: 'gravity' } }),
  ]);
  check('5 gravity union across rules', JSON.stringify(masks(out)) === '[31,31,31,30]', JSON.stringify(masks(out)));
}

// --- case 6: disabled rules --------------------------------------------
{
  const text = serializeParticleRules([rule({ enabled: false })]);
  const back = parseParticleRules(text);
  check('6a disabled rule survives serialisation', back.length === 1 && back[0].enabled === false);
  check('6b disabled rule is not effective', resolveParticleRules(text).length === 0 && !particleRulesHaveAction(text, 'kill'));
}

// --- case 7: kill -------------------------------------------------------
{
  const out = apply([rule({
    target: { type: 'predicate', slot: 0, mode: 'below', low: 0, high: 0.3, invert: false },
  })]);
  check('7 kill bit on matched only', JSON.stringify(masks(out)) === '[31,63,31,63]', JSON.stringify(masks(out)));
}

// --- case 8: colour ------------------------------------------------------
{
  const colorSlots = [0, 1, 2];
  const out = apply([
    rule({ id: 'r1', action: { type: 'color', color: [1, 0, 0] } }),
    rule({ id: 'r2', target: { type: 'predicate', slot: 0, mode: 'above', low: 0.5, high: 1, invert: false }, action: { type: 'color', color: [0, 0.5, 1] } }),
  ], { colorSlots });
  check('8a last matching colour wins', out[0] === 0 && out[1] === 0.5 && out[2] === 1, `${out[0]},${out[1]},${out[2]}`);
  check('8b earlier colour applies where later does not match', out[4] === 1 && out[5] === 0 && out[6] === 0);
  check('8c colour-only rules still burn the unrestricted mask', JSON.stringify(masks(out)) === '[31,31,31,31]');
  const outNull = apply([rule({ action: { type: 'color', color: [1, 0, 0] } })], { colorSlots: null });
  check('8d unresolved colour slots -> no colour write, mask still burned',
    outNull[0] === ATTR[0] && JSON.stringify(masks(outNull)) === '[31,31,31,31]');
}

// --- case 9: group target --------------------------------------------------
{
  const groupDefs = [{
    id: 'sparks', name: 'sparks',
    source: { kind: 'predicate', predicate: { slot: 1, mode: 'above', low: 0.5, high: 1, invert: false } },
  }];
  const out = apply([rule({ target: { type: 'group', id: 'sparks' } })], { groupDefs });
  check('9a group target matches via group evaluation', JSON.stringify(masks(out)) === '[31,63,63,31]', JSON.stringify(masks(out)));
  const dangling = parseParticleRules(JSON.stringify([rule({ target: { type: 'group', id: 'nope' } })]));
  check('9b dangling group rule is kept', dangling.length === 1);
  const outDangling = apply(dangling, { groupDefs });
  check('9c dangling group never matches', JSON.stringify(masks(outDangling)) === '[31,31,31,31]');
}

// --- case 10: conditions -----------------------------------------------------
{
  const byVel = apply([rule({ condition: 'vel > 2.5' })]);
  check('10a sim var vel reads frame-0 velocity', JSON.stringify(masks(byVel)) === '[63,31,31,31]', JSON.stringify(masks(byVel)));
  // NOTE: the shipped expression grammar has no && / || —
  // comparisons yield 1/0 and combine arithmetically (the
  // design doc's section 1.3 example originally spelled this
  // with &&, which does not compile; corrected in the doc).
  const byName = apply([rule({
    target: { type: 'predicate', slot: 1, mode: 'above', low: 0.5, high: 1, invert: false },
    condition: '(a > 0.5) * (g == 1)',
  })]);
  check('10b slot name + g (target membership)', JSON.stringify(masks(byName)) === '[31,31,63,31]', JSON.stringify(masks(byName)));
  const byAlias = apply([rule({ condition: 'slot3 > 0.8' })]);
  check('10c slotN alias reads pristine slot', JSON.stringify(masks(byAlias)) === '[31,31,31,63]', JSON.stringify(masks(byAlias)));
  const byAgeRad = apply([rule({ condition: '(age >= 1) * (rad > 0.7)' })]);
  check('10d age/rad sim vars', JSON.stringify(masks(byAgeRad)) === '[31,31,63,31]', JSON.stringify(masks(byAgeRad)));
  const broken = parseParticleRules(JSON.stringify([rule({ condition: 'vel >>' })]));
  check('10e uncompilable condition keeps the rule', broken.length === 1);
  const outBroken = apply(broken);
  check('10f uncompilable condition never matches', JSON.stringify(masks(outBroken)) === '[31,31,31,31]');
  const nan = apply([rule({ condition: '0/0' })]);
  check('10g NaN condition is false', JSON.stringify(masks(nan)) === '[31,31,31,31]');
}

// --- case 11: per-rule validation ----------------------------------------------
{
  const many = [];
  for (let i = 0; i < 20; i++) many.push(rule({ id: `r${i}` }));
  check('11a rule cap is 16', parseParticleRules(JSON.stringify(many)).length === 16);
  const mixed = parseParticleRules(JSON.stringify([
    rule({ id: 'bad id!' }),
    rule({ id: 'ok1', target: { type: 'predicate', slot: 7, mode: 'above', low: 0, high: 1, invert: false } }),
    rule({ id: 'ok2', action: { type: 'force-gate', force: 'laser' } }),
    rule({ id: 'ok3', enabled: 'yes' }),
    rule({ id: 'dup', action: { type: 'kill' } }),
    rule({ id: 'dup', action: { type: 'color', color: [0, 0, 0] } }),
    rule({ id: 'clamp', target: { type: 'predicate', slot: 0, mode: 'above', low: 1.7, high: -0.2, invert: false }, action: { type: 'color', color: [2, -1, 0.5] } }),
  ]));
  check('11b invalid rules drop individually, dup first-wins', mixed.length === 2 && mixed[0].id === 'dup' && mixed[0].action.type === 'kill' && mixed[1].id === 'clamp', JSON.stringify(mixed.map((r) => r.id)));
  check('11c clamps applied', mixed[1].target.low === 1 && mixed[1].target.high === 0
    && JSON.stringify(mixed[1].action.color) === '[1,0,0.5]');
}

// --- case 12: legacy equivalence + pristine immutability -------------------------
{
  const pristineCopy = new Float32Array(ATTR);
  const groupDefs = [{
    id: 'sparks', name: 'sparks',
    source: { kind: 'predicate', predicate: { slot: 1, mode: 'above', low: 0.5, high: 1, invert: false } },
  }];
  const out = apply([rule({
    target: { type: 'group', id: 'sparks' },
    action: { type: 'force-gate', force: 'all' },
  })], { groupDefs });
  // Legacy baked gate: membership [0,1,1,0] written into slot 3
  // and read as "above 0.5" per force. The rule form must gate
  // every force by exactly that membership.
  check('12a force bits equal legacy membership per force',
    JSON.stringify(masks(out).map((m) => m & 31)) === '[0,31,31,0]', JSON.stringify(masks(out)));
  check('12b pristine bake is not mutated', ATTR.every((v, i) => v === pristineCopy[i]));
  check('12c result is a copy', out !== ATTR);
}

// --- shader splicing discipline ---------------------------------------------------
{
  const velDefault = buildVelocityFragment('', undefined, undefined);
  const velDefault2 = buildVelocityFragment('', undefined, {});
  check('S1 default velocity string has no rule segment', !velDefault.includes('ruleMask') && velDefault === velDefault2);
  const velRules = buildVelocityFragment('', undefined, { particleRules: true });
  check('S2 rule variant splices the mask segment', velRules.includes('ruleMask') && velRules.includes('grpGravity *='));
  const posDefault = buildPositionFragment();
  check('S3 default position string is the shipped string', posDefault === SIM_POS_FRAG && !posDefault.includes('uParticleRuleKillEnabled'));
  const posRules = buildPositionFragment({ particleRules: true });
  check('S4 rule variant declares + uses the kill uniform',
    (posRules.match(/uParticleRuleKillEnabled/g) ?? []).length === 2);
  check('S5 rule kill segment follows the group kill block',
    posRules.indexOf('Particle rule kill (G10 stage 1)') > posRules.indexOf('uGroupKillEnabled'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
