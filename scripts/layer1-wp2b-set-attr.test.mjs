#!/usr/bin/env node
// layer1-wp2b-set-attr.test.mjs — Layer 1 WP2 phase B1:
// the live-rule attribute-write action `set-attr`
// (lib/gpgpuParticleRulesLive.ts). A matched rule writes a
// value into a named attribute channel; the consumer is the
// dedicated attribute-write pass
// (buildRuleAttrWriteFragment), NOT the REP — the REP output
// texture is never read by the write pass.
//
// Pins:
// (a) parse: a well-formed set-attr action survives
//     validation verbatim; malformed ones (non-string /
//     empty / overlong slot name, missing or non-string
//     expr) drop the rule like every other bad action.
// (b) classification (set-attr is LIVE-ONLY — the baked
//     grammar has no attribute write to approximate with):
//       - channel name unresolvable -> never /
//         set-attr-unknown-channel
//       - channel name resolves to an ext slot (4..7) ->
//         never / set-attr-ext-read-only
//       - value expression uncompilable -> never /
//         set-attr-live-only-expr-uncompilable
//       - value expression or condition has no GLSL home in
//         the write pass (e.g. reads `state`) -> never /
//         set-attr-live-only-glsl-unrepresentable
//       - a resolvable rule classifies live and carries the
//         resolved writable slot + compiled expr AST.
//     Consumption is declared in the new group constant
//     LIVE_RULE_CONSUMED_ACTIONS_L1 and reaches the
//     aggregate list (REP standing included).
// (c) CPU twin (evaluateLiveRuleStep.attrWrites): one entry
//     per writable slot 0..3, null = no write lands. A
//     matched finite value (|v| < 1e30) lands clamped to
//     [0, 1]; rule order, last wins; a non-finite value
//     keeps the slot's current value (an earlier write this
//     step, or no write). SNAPSHOT semantics: conditions
//     and value expressions read the slot values carried
//     in, never a value written earlier in the same step.
// (d) fragment builder: null while no rule classifies live
//     with set-attr (the pass does not stand); otherwise
//     the dyn-pass shape over uSrc with one guarded write
//     line per writer —
//       out<slot> = (matched && v == v && abs(v) < 1.0e30)
//         ? clamp(v, 0.0, 1.0) : out<slot>;
//     — and no reference to the REP output.
//
// Run: node scripts/layer1-wp2b-set-attr.test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const P = await load('lib/gpgpuParticleRulesLive.ts');
const {
  parseLiveParticleRules, validateLiveParticleRule, classifyLiveRules,
  evaluateLiveRuleStep, buildRuleAttrWriteFragment, buildRuleEvalFragment,
  liveRulesHaveConsumedAction,
  LIVE_RULE_CONSUMED_ACTIONS, LIVE_RULE_CONSUMED_ACTIONS_L1,
} = P;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const rule = (id, action, condition = '', extra = {}) => ({
  id, enabled: true, target: { type: 'all' }, condition, action, ...extra,
});
const setAttr = (slot, expr) => ({ type: 'set-attr', slot, expr });
const VARS = { vel: 0, age: 1, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6 };
const step = (classified, slots, vars = VARS) => evaluateLiveRuleStep(classified, { slots, vars });

// ── (a) parse ────────────────────────────────────────────
{
  const parsed = parseLiveParticleRules(JSON.stringify([
    rule('good', setAttr('a', '0.5')),
    { id: 'bad-slot-type', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'set-attr', slot: 3, expr: '0.5' } },
    { id: 'bad-slot-empty', enabled: true, target: { type: 'all' }, condition: '', action: setAttr('', '0.5') },
    { id: 'bad-slot-long', enabled: true, target: { type: 'all' }, condition: '', action: setAttr('x'.repeat(65), '0.5') },
    { id: 'bad-expr-missing', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'set-attr', slot: 'a' } },
    { id: 'bad-expr-type', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'set-attr', slot: 'a', expr: 7 } },
  ]));
  check('a parses exactly the well-formed set-attr rule', sameJson(parsed.map((r) => r.id), ['good']));
  check('a action survives verbatim', sameJson(parsed[0].action, { type: 'set-attr', slot: 'a', expr: '0.5' }));
  check('a validate accepts an empty-string expr (compiles or not is classification)',
    validateLiveParticleRule(rule('e', setAttr('a', ''))) !== null);
}

// ── (b) classification ───────────────────────────────────
{
  const cls = (rules) => classifyLiveRules(rules, OPTS);
  const unknown = cls([rule('r', setAttr('zzz', '0.5'))])[0];
  check('b unknown channel -> never / set-attr-unknown-channel',
    unknown.route === 'never' && unknown.reason === 'set-attr-unknown-channel');
  const ext = cls([rule('r', setAttr('i', '0.5'))])[0]; // 'i' = names2[0] -> slot 4
  check('b ext channel -> never / set-attr-ext-read-only',
    ext.route === 'never' && ext.reason === 'set-attr-ext-read-only');
  const badVar = cls([rule('r', setAttr('a', 'nosuchvar + 1'))])[0];
  check('b uncompilable expr (unknown var) -> never / set-attr-live-only-expr-uncompilable',
    badVar.route === 'never' && badVar.reason === 'set-attr-live-only-expr-uncompilable');
  const badSyntax = cls([rule('r', setAttr('a', '1 +'))])[0];
  check('b uncompilable expr (syntax) -> never / set-attr-live-only-expr-uncompilable',
    badSyntax.route === 'never' && badSyntax.reason === 'set-attr-live-only-expr-uncompilable');
  const stateExpr = cls([rule('r', setAttr('a', 'state / 255'))])[0];
  check('b expr reading `state` has no write-pass home -> never / set-attr-live-only-glsl-unrepresentable',
    stateExpr.route === 'never' && stateExpr.reason === 'set-attr-live-only-glsl-unrepresentable');
  const stateCond = cls([rule('r', setAttr('a', '0.5'), 'state == 1')])[0];
  check('b condition reading `state` -> never / set-attr-live-only-glsl-unrepresentable',
    stateCond.route === 'never' && stateCond.reason === 'set-attr-live-only-glsl-unrepresentable');
  const badCond = cls([rule('r', setAttr('a', '0.5'), 'nosuchvar > 1')])[0];
  check('b uncompilable condition keeps the plain discipline',
    badCond.route === 'never' && badCond.reason === 'condition-uncompilable');
  const ok = cls([rule('r', setAttr('b', 'slot0 * 0.5'))])[0];
  check('b resolvable rule classifies live with slot + expr AST',
    ok.route === 'live' && ok.reason === '' && ok.setAttrSlot === 1 && !!ok.setAttrExprAst);
  const extRead = cls([rule('r', setAttr('a', 'slot5 * 0.5'))])[0];
  check('b reading an ext slot in the expr is fine (only writes are read-only)',
    extRead.route === 'live' && extRead.setAttrSlot === 0);
  check('b disabled set-attr rules do not classify',
    cls([rule('r', setAttr('a', '0.5'), '', { enabled: false })]).length === 0);
  check('b consumption declared in the L1 group constant',
    sameJson(LIVE_RULE_CONSUMED_ACTIONS_L1, ['set-attr'])
    && LIVE_RULE_CONSUMED_ACTIONS.includes('set-attr'));
  check('b a set-attr-only config counts as consumed; a color-only one does not',
    liveRulesHaveConsumedAction(JSON.stringify([rule('x', setAttr('a', '0.5'))])) === true
    && liveRulesHaveConsumedAction(JSON.stringify([rule('x', { type: 'color', color: [1, 0, 0] })])) === false);
}

// ── (c) CPU twin ─────────────────────────────────────────
{
  const cls = (rules) => classifyLiveRules(rules, OPTS);
  // Basic write + clamping on both ends.
  const basic = step(cls([
    rule('hi', setAttr('a', '2.5')),
    rule('lo', setAttr('b', '0 - 1')),
    rule('mid', setAttr('c', '0.25')),
  ]), [0, 0, 0, 0, 0, 0, 0, 0]);
  check('c matched writes land clamped, untouched slot stays null',
    sameJson(basic.attrWrites, [1, 0, 0.25, null]));
  check('c attrWrites always has one entry per writable slot',
    Array.isArray(basic.attrWrites) && basic.attrWrites.length === 4);
  // No set-attr rules at all -> all null.
  const none = step(cls([rule('k', { type: 'kill' })]), [0, 0, 0, 0, 0, 0, 0, 0]);
  check('c no set-attr rules -> all null', sameJson(none.attrWrites, [null, null, null, null]));
  // Last wins in rule order.
  const lastWins = step(cls([
    rule('w1', setAttr('a', '0.3')),
    rule('w2', setAttr('a', '0.7')),
  ]), [0, 0, 0, 0, 0, 0, 0, 0]);
  check('c last write wins', sameJson(lastWins.attrWrites, [0.7, null, null, null]));
  // Non-finite keeps the current value: an earlier write
  // survives a later infinite one; NaN alone writes nothing.
  const guard = step(cls([
    rule('w1', setAttr('a', '0.3')),
    rule('w2', setAttr('a', '1 / 0')),
    rule('w3', setAttr('b', '0 / 0')),
  ]), [0, 0, 0, 0, 0, 0, 0, 0]);
  check('c non-finite write keeps the slot current value',
    sameJson(guard.attrWrites, [0.3, null, null, null]));
  // Snapshot: rule B's condition and rule C's value expr
  // read the slot values carried in (slot0 = 0.2), never
  // rule A's write of 0.9 earlier in the same step.
  const snap = step(cls([
    rule('A', setAttr('a', '0.9')),
    rule('B', setAttr('b', '1'), 'slot0 > 0.5'),
    rule('C', setAttr('c', 'slot0 + 0.1')),
  ]), [0.2, 0, 0, 0, 0, 0, 0, 0]);
  check('c conditions read the pre-write snapshot (B does not match)',
    snap.attrWrites[1] === null && !snap.matched.includes('B'));
  check('c value expressions read the pre-write snapshot (C = 0.2 + 0.1)',
    Math.abs(snap.attrWrites[2] - 0.3) < 1e-9 && snap.attrWrites[0] === 0.9);
  // A false condition writes nothing.
  const gated = step(cls([
    rule('g', setAttr('d', '1'), 'age > 2'),
  ]), [0, 0, 0, 0, 0, 0, 0, 0]);
  check('c unmatched rule writes nothing', sameJson(gated.attrWrites, [null, null, null, null]));
  // Predicate target gates on the snapshot slot value.
  const pred = { type: 'predicate', slot: 0, mode: 'above', low: 0.5, high: 1, invert: false };
  const predCls = cls([{ id: 'p', enabled: true, target: pred, condition: '', action: setAttr('b', '0.6') }]);
  check('c predicate target: below threshold -> no write',
    sameJson(step(predCls, [0.2, 0, 0, 0, 0, 0, 0, 0]).attrWrites, [null, null, null, null]));
  check('c predicate target: above threshold -> write lands',
    sameJson(step(predCls, [0.8, 0, 0, 0, 0, 0, 0, 0]).attrWrites, [null, 0.6, null, null]));
  // Named channels in the value expr follow the same
  // caller-supplied-vars contract as conditions.
  const named = cls([rule('n', setAttr('d', 'b * 0.5'))]);
  check('c named channel reads the caller-supplied var',
    sameJson(step(named, [0, 0.4, 0, 0, 0, 0, 0, 0], { ...VARS, b: 0.4 }).attrWrites, [null, null, null, 0.2]));
  check('c named channel missing from vars -> NaN -> no write',
    sameJson(step(named, [0, 0.4, 0, 0, 0, 0, 0, 0]).attrWrites, [null, null, null, null]));
}

// ── (d) fragment builder ─────────────────────────────────
{
  check('d null for an empty rule list', buildRuleAttrWriteFragment([], OPTS) === null);
  check('d null when no rule carries set-attr',
    buildRuleAttrWriteFragment([rule('k', { type: 'kill' })], OPTS) === null);
  check('d null when every set-attr rule classifies never',
    buildRuleAttrWriteFragment([rule('r', setAttr('zzz', '0.5'))], OPTS) === null);
  const frag = buildRuleAttrWriteFragment([
    rule('w', setAttr('b', 'slot0 * 0.5'), 'age > 0.5'),
  ], OPTS);
  check('d fragment stands for a live writer', typeof frag === 'string');
  check('d fragment samples the attribute texture (uSrc)',
    frag.includes('uniform sampler2D uSrc;') && frag.includes('vec4 attrData = texture2D(uSrc, vUv);'));
  check('d guarded write line for slot 1 (dyn guard, output local kept)',
    frag.includes('out1 = (matched0 > 0.5 && wval0 == wval0 && abs(wval0) < 1.0e30) ? clamp(wval0, 0.0, 1.0) : out1;'));
  check('d fragment never references the REP output',
    !frag.includes('liveMask') && !frag.includes('nextState'));
  check('d REP fragment carries no write-pass locals',
    !buildRuleEvalFragment([rule('w', setAttr('b', '0.5'))], OPTS).includes('wval'));
  // Two writers to the same slot: two write lines, in rule
  // order (the later line overwrites — last wins).
  const two = buildRuleAttrWriteFragment([
    rule('w1', setAttr('a', '0.3')),
    rule('w2', setAttr('a', '0.7')),
  ], OPTS);
  const first = two.indexOf('out0 = (matched0');
  const second = two.indexOf('out0 = (matched1');
  check('d same-slot writers emit in rule order', first >= 0 && second > first);
  // Reading an ext slot pulls the ext texture binding.
  const ext = buildRuleAttrWriteFragment([rule('r', setAttr('a', 'slot5 * 0.5'))], OPTS);
  check('d ext-reading writer binds uSrc2', ext !== null && ext.includes('uniform sampler2D uSrc2;'));
}

if (failures > 0) {
  console.error(`layer1-wp2b-set-attr: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`layer1-wp2b-set-attr: ${checks}/${checks} checks passed`);
