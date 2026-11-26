// Phase 46 (G10 stage 2) — particle rules editor support:
// the lib-side helpers the row-list editor is built on
// (createParticleRule / createParticleRuleId /
// particleRuleConditionVariables) and the component wiring.
//
// The editor discipline under test:
//  - a fresh row is valid and neutral (target all + force-gate
//    'all' permits everything, so adding a row changes nothing
//    until it is edited — the createEventRule discipline);
//  - every edit the component can produce round-trips through
//    serialize -> parse unchanged (the stored form is the lib's,
//    never the component's invention);
//  - the condition compile check in the UI uses EXACTLY the
//    evaluator's variable allowlist, so the editor never promises
//    a variable the bake evaluator would reject (x/t are built
//    into the expression parser itself, so both sides agree on
//    those without any list entry).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p46-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { createParticleRule, createParticleRuleId, validateParticleRule, parseParticleRules, resolveParticleRules, serializeParticleRules, particleRuleConditionVariables, PARTICLE_RULE_ID_RE } from './lib/gpgpuParticleRules.ts';
      export { compileExpression } from './lib/expression.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  createParticleRule, createParticleRuleId, validateParticleRule,
  parseParticleRules, resolveParticleRules, serializeParticleRules,
  particleRuleConditionVariables, PARTICLE_RULE_ID_RE, compileExpression,
} = lib;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- E1: a fresh rule is valid and neutral ----------------------
{
  const rule = createParticleRule();
  check('E1a fresh rule validates', validateParticleRule(rule) !== null);
  check('E1b fresh rule defaults', rule.enabled === true && rule.target.type === 'all'
    && rule.condition === '' && rule.action.type === 'force-gate' && rule.action.force === 'all',
    JSON.stringify(rule));
}

// --- E2: ids are unique and inside the id grammar ---------------
{
  const ids = new Set();
  let allMatch = true;
  for (let i = 0; i < 100; i++) {
    const id = createParticleRuleId();
    if (!PARTICLE_RULE_ID_RE.test(id)) allMatch = false;
    ids.add(id);
  }
  check('E2a 100 ids unique', ids.size === 100, `got ${ids.size}`);
  check('E2b ids match the grammar', allMatch);
}

// --- E3: a fresh rule round-trips --------------------------------
{
  const rule = createParticleRule();
  const back = parseParticleRules(serializeParticleRules([rule]));
  check('E3 serialize->parse round-trip', back.length === 1 && eq(back[0], validateParticleRule(rule)),
    JSON.stringify(back));
}

// --- E4: the edits the component produces round-trip -------------
{
  const a = createParticleRule();
  const b = createParticleRule();
  const c = createParticleRule();
  // The component's patch shapes, one per target/action pairing.
  a.target = { type: 'predicate', slot: 2, mode: 'band', low: 0.25, high: 0.75, invert: true };
  a.condition = '(slot2 > 0.8) * (vel < 0.2)';
  a.action = { type: 'force-gate', force: 'turbulence' };
  a.name = '外側だけ乱流';
  b.target = { type: 'group', id: 'g-deadbeef' };
  b.action = { type: 'kill' };
  c.action = { type: 'color', color: [1, 0.3, 0.1] };
  c.enabled = false;
  const text = serializeParticleRules([a, b, c]);
  const back = parseParticleRules(text);
  check('E4a edited rules round-trip', back.length === 3
    && eq(back[0], validateParticleRule(a)) && eq(back[1], validateParticleRule(b))
    && eq(back[2], validateParticleRule(c)), text);
  // Reorder (the component's splice move): order is preserved.
  const moved = [back[1], back[0], back[2]];
  const backMoved = parseParticleRules(serializeParticleRules(moved));
  check('E4b reorder round-trips', eq(backMoved.map((r) => r.id), moved.map((r) => r.id)));
  // The disabled row persists in storage but drops out of the
  // effective set (stage 1 case 6, via the editor's shapes).
  check('E4c disabled persists but is inert', back.length === 3 && resolveParticleRules(text).length === 2);
}

// --- E5/E6: condition variables are the evaluator's set ----------
{
  const vars = particleRuleConditionVariables(['Alpha', 'b', 'c', 'd'], ['i', 'j', 'k', 'l']);
  check('E5a slot names lowercased + aliases', vars.includes('alpha') && vars.includes('slot0')
    && vars.includes('slot7') && vars.includes('i'), vars.join(','));
  check('E5b sim vars present', ['g', 'vel', 'age', 'rad'].every((v) => vars.includes(v)));
  check('E5c helper adds no x/t (they are parser built-ins)', !vars.includes('x') && !vars.includes('t'));
  check('E6a real condition compiles', compileExpression('(alpha > 0.8) * (vel < 0.2)', vars).ok === true);
  check('E6b unknown variable rejected', compileExpression('nosuchvar > 1', vars).ok === false);
  check('E6c x compiles as a built-in, as in the evaluator', compileExpression('x > 1', vars).ok === true);
}

// --- E7: validation clamps colour components ----------------------
{
  const rule = createParticleRule();
  rule.action = { type: 'color', color: [2, -1, 0.5] };
  const valid = validateParticleRule(rule);
  check('E7 colour clamped by validation', valid !== null && eq(valid.action.color, [1, 0, 0.5]),
    JSON.stringify(valid && valid.action));
}

// --- S: component wiring (source-level, like phase45 S1-S5) -------
{
  const component = readFileSync(join(ROOT, 'components/controlPanelGlobalDisplayGpgpuParticleRules.tsx'), 'utf8');
  const parent = readFileSync(join(ROOT, 'components/controlPanelGlobalDisplayGpgpu.tsx'), 'utf8');
  check('S1 editor saves through the lib serializer into the config key',
    component.includes("updateConfig('gpgpuParticleRules', text)") && component.includes('serializeParticleRules'));
  check('S2 editor reads through the lib parser', component.includes('parseParticleRules'));
  check('S3 parent renders the rules section after the forces section',
    parent.includes('GlobalDisplayGpgpuParticleRulesSection')
    && parent.indexOf('GlobalDisplayGpgpuParticleRulesSection config') > parent.indexOf('GlobalDisplayGpgpuForcesSection config'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
