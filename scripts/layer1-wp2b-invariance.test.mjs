#!/usr/bin/env node
// layer1-wp2b-invariance.test.mjs — Layer 1 WP2 phase B3:
// the no-designation invariance discipline for the two new
// attribute stages (mapping + rule-write).
//
// While neither stage is designated — no live set-attr rule
// and an empty mapping table — the structural identity
// guarantee must hold: the passes never exist and every
// consumer reads exactly the textures it read before B3.
// The generator half of that guarantee is pinned here:
//
// (a) for a representative live rule set WITHOUT set-attr,
//     buildRuleEvalFragment's output is byte-identical to
//     the pre-B3 generator (sha256 + length pin, the
//     phase18-attr-baseline discipline) and
//     buildRuleAttrWriteFragment returns null, so the
//     rule-write pass never stands.
// (b) for the unset mapping key (''), the table parses to
//     no entries, resolution is empty with no rejections,
//     buildAttrMappingFragment returns null, and the empty
//     table serialises back to '' — so the mapping pass
//     never stands and the key round-trips as unset.
//
// Run: node scripts/layer1-wp2b-invariance.test.mjs

import { createHash } from 'node:crypto';
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
const strSha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const P = await load('lib/gpgpuParticleRulesLive.ts');
const M = await load('lib/gpgpuAttrMappings.ts');

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});

// ── (a) REP fragment byte-identity + write fragment null ──
// Representative live set: a conditional kill, a conditional
// set-state, a set-group and a conditional true-kill — the
// consumed-action spread a real config carries, with no
// set-attr anywhere.
const rules = P.resolveLiveParticleRules(JSON.stringify([
  rule('cond-kill', { type: 'kill' }, 'vel > 0.5'),
  rule('st', { type: 'set-state', state: 2 }, 'a > 0.3'),
  rule('grp', { type: 'set-group', id: 'alpha' }),
  rule('tk', { type: 'true-kill' }, 'age > 0.9'),
]));
{
  const frag = P.buildRuleEvalFragment(rules, OPTS);
  check('a the representative set still builds a REP fragment', typeof frag === 'string');
  check('a REP fragment length is the pre-B3 length',
    frag !== null && frag.length === 2897,
    frag === null ? 'null' : `length=${frag.length}`);
  check('a REP fragment sha256 is the pre-B3 pin',
    frag !== null && strSha(frag) === 'e690c5a022de0800500975dcde8945e08f8ef1c087891616df3da95d5a4135fa',
    frag === null ? 'null' : `sha256=${strSha(frag)}`);
  check('a no set-attr in the set -> the write fragment is null (the pass never stands)',
    P.buildRuleAttrWriteFragment(rules, OPTS) === null);
  check('a an empty rule list -> the write fragment is null',
    P.buildRuleAttrWriteFragment([], OPTS) === null);
}

// ── (b) unset mapping table ──────────────────────────────
{
  const entries = M.parseAttrMappings('');
  check('b the unset key parses to no entries', sameJson(entries, []));
  const resolution = M.resolveAttrMappings(entries, NAMES, NAMES2);
  check('b resolution of the empty table is empty with no rejections',
    sameJson(resolution.resolved, []) && sameJson(resolution.rejections, []));
  check('b no entries -> the mapping fragment is null (the pass never stands)',
    M.buildAttrMappingFragment(entries, NAMES, NAMES2) === null);
  check('b the empty table serialises back to the unset key',
    M.serializeAttrMappings(entries) === '');
}

console.log(`layer1-wp2b-invariance: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
