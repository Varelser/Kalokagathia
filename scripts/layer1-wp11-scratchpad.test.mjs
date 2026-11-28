#!/usr/bin/env node
// layer1-wp11-scratchpad.test.mjs — Layer 1 WP11, phase A:
// the Scratch Pad foundation. Named shared GLSL snippet
// definitions (lib/glslSharedSnippets.ts) that several
// injection points can reference and expand, plugged into
// the points' resolution in lib/glslInjection.ts
// (resolveGlslSnippet). Grammar only: no config key, no
// panel wiring (that is phase C).
//
// Pins:
// (a) directives: a whole-line `// @use <name>` is a
//     directive (indentation tolerated); `@use` mentioned
//     inside a longer comment is prose; refs are found in
//     textual order;
// (b) names: GLSL-identifier shape, length cap;
// (c) structural validation: duplicate names, a def
//     referencing an undefined name, self and mutual
//     cycles are all rejected with reasons;
// (d) expansion determinism: same input expands to the
//     same output twice, the definition set's order does
//     not affect the result, a diamond (one def used
//     twice, one sub-def used by two defs) expands
//     textually at every use;
// (e) nested expansion: def -> def -> def resolves
//     depth-first;
// (f) expansion rejection: unknown reference, cycle
//     reached from the entry code, depth past the cap,
//     expanded length past the cap;
// (g) byte identity: a code text without directives is
//     returned as the identical string by expansion and
//     by resolveGlslSnippet (empty set, and also a valid
//     set the code never references);
// (h) validation discipline: the point's forbidden-token
//     list and length cap apply to every definition body
//     and to the expanded result through
//     validateGlslSharedSnippetDefsForInjection /
//     resolveGlslSnippet; the shared core
//     (validateGlslSnippet) is unchanged;
// (i) serialisation: serialize/parse round-trips
//     byte-identically, malformed text / shapes /
//     invalid sets are rejected without throwing, empty
//     text is the empty set.
//
// Run: node scripts/layer1-wp11-scratchpad.test.mjs

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

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const S = await load('lib/glslSharedSnippets.ts');
const I = await load('lib/glslInjection.ts');

// A forbidden-token list mirroring the custom force point's
// contract (the list itself is that point's own property;
// this test pins the layering, not the list's contents).
const TOKENS = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'uniform', reason: 'uniform は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
];

// ---- (a) directives ---------------------------------------------------------

check('a plain line is not a directive', S.glslSharedSnippetDirective('vel += vec3(1.0);') === null);
check('a a whole-line directive is recognised', S.glslSharedSnippetDirective('// @use swirl') === 'swirl');
check('a an indented directive is recognised', S.glslSharedSnippetDirective('    // @use swirl') === 'swirl');
check('a trailing whitespace is tolerated', S.glslSharedSnippetDirective('// @use swirl   ') === 'swirl');
check('a @use inside prose is not a directive', S.glslSharedSnippetDirective('// please @use swirl here') === null);
check('a a directive with trailing code is not a directive', S.glslSharedSnippetDirective('// @use swirl;') === null);
check('a refs are found in textual order', JSON.stringify(
  S.findGlslSharedSnippetRefs('// @use b\nvel += a;\n// @use a\n// @use b'),
) === JSON.stringify(['b', 'a', 'b']));
check('a code without directives has no refs', S.findGlslSharedSnippetRefs('vel += vec3(1.0);').length === 0);

// ---- (b) names --------------------------------------------------------------

check('b a plain identifier is a valid name', S.isValidGlslSharedSnippetName('swirl') === true);
check('b underscores and digits after the first char are valid', S.isValidGlslSharedSnippetName('_swirl2') === true);
check('b a leading digit is invalid', S.isValidGlslSharedSnippetName('2swirl') === false);
check('b a hyphen is invalid', S.isValidGlslSharedSnippetName('my-swirl') === false);
check('b an empty name is invalid', S.isValidGlslSharedSnippetName('') === false);
check('b a name past the length cap is invalid', S.isValidGlslSharedSnippetName('a'.repeat(65)) === false);

// ---- fixtures ---------------------------------------------------------------

const defs = [
  { name: 'swirl', code: 'vec2 tang = vec2(-pos.z, pos.x);\nvel.xz += tang * strength;' },
  { name: 'lift', code: 'vel.y += 4.0 * uDelta;' },
  { name: 'combo', code: '// @use swirl\n// @use lift' },
];
const snippet = 'float strength = 2.0;\n// @use combo\nvel *= 0.99;';
const expandedCombo = 'vec2 tang = vec2(-pos.z, pos.x);\nvel.xz += tang * strength;\nvel.y += 4.0 * uDelta;';
const expectedExpansion = `float strength = 2.0;\n${expandedCombo}\nvel *= 0.99;`;

// ---- (c) structural validation ----------------------------------------------

check('c the fixture set is structurally valid', S.validateGlslSharedSnippetDefs(defs).ok === true);
check('c duplicate names are rejected', S.validateGlslSharedSnippetDefs([
  { name: 'a', code: 'x;' }, { name: 'a', code: 'y;' },
]).ok === false);
check('c a malformed name is rejected', S.validateGlslSharedSnippetDefs([
  { name: 'my-def', code: 'x;' },
]).ok === false);
check('c a def referencing an undefined name is rejected', S.validateGlslSharedSnippetDefs([
  { name: 'a', code: '// @use ghost' },
]).ok === false);
const selfCycle = S.validateGlslSharedSnippetDefs([{ name: 'a', code: '// @use a' }]);
check('c a self reference is rejected as a cycle', selfCycle.ok === false && selfCycle.error.includes('循環'));
const mutualDefs = [
  { name: 'a', code: '// @use b' },
  { name: 'b', code: '// @use a' },
];
const mutualCycle = S.validateGlslSharedSnippetDefs(mutualDefs);
check('c a mutual reference is rejected as a cycle', mutualCycle.ok === false && mutualCycle.error.includes('循環'));
check('c the cycle path names the loop', JSON.stringify(S.findGlslSharedSnippetCycle(mutualDefs)) === JSON.stringify(['a', 'b', 'a']));
check('c an acyclic set reports no cycle', S.findGlslSharedSnippetCycle(defs) === null);

// ---- (d) expansion determinism ----------------------------------------------

const exp1 = S.expandGlslSharedSnippets(snippet, defs);
const exp2 = S.expandGlslSharedSnippets(snippet, defs);
check('d expansion succeeds on the fixture', exp1.ok === true);
check('d expansion is deterministic', exp1.ok && exp2.ok && exp1.code === exp2.code);
check('d expansion matches the hand-expanded text', exp1.code === expectedExpansion);
const shuffled = [defs[2], defs[0], defs[1]];
const expShuffled = S.expandGlslSharedSnippets(snippet, shuffled);
check('d definition order does not affect expansion', expShuffled.ok && expShuffled.code === expectedExpansion);
const diamondDefs = [
  { name: 'base', code: 'float k = 1.0;' },
  { name: 'left', code: '// @use base\nvel.x += k;' },
  { name: 'right', code: '// @use base\nvel.y += k;' },
];
const diamond = S.expandGlslSharedSnippets('// @use left\n// @use right', diamondDefs);
check('d a diamond expands the shared def at every use',
  diamond.ok && diamond.code === 'float k = 1.0;\nvel.x += k;\nfloat k = 1.0;\nvel.y += k;');
const twice = S.expandGlslSharedSnippets('// @use lift\n// @use lift', defs);
check('d one def used twice expands twice', twice.ok && twice.code === 'vel.y += 4.0 * uDelta;\nvel.y += 4.0 * uDelta;');

// ---- (e) nested expansion ----------------------------------------------------

check('e nested defs expand depth-first (combo inside the fixture)', exp1.code === expectedExpansion);
const deepDefs = [
  { name: 'd1', code: 'one;' },
  { name: 'd2', code: '// @use d1\ntwo;' },
  { name: 'd3', code: '// @use d2\nthree;' },
];
const deep = S.expandGlslSharedSnippets('// @use d3', deepDefs);
check('e a three-deep chain expands in order', deep.ok && deep.code === 'one;\ntwo;\nthree;');

// ---- (f) expansion rejection --------------------------------------------------

check('f an unknown reference is rejected', S.expandGlslSharedSnippets('// @use ghost', defs).ok === false);
check('f a directive with an empty set is rejected', S.expandGlslSharedSnippets('// @use lift', []).ok === false);
check('f a cycle reached from the entry code is rejected',
  S.expandGlslSharedSnippets('// @use a', mutualDefs).ok === false);
const chainDefs = [];
for (let i = 0; i < 20; i += 1) {
  chainDefs.push({ name: `c${i}`, code: i < 19 ? `// @use c${i + 1}` : 'leaf;' });
}
check('f a chain past the depth cap is rejected',
  S.expandGlslSharedSnippets('// @use c0', chainDefs).ok === false);
const bigDefs = [{ name: 'big', code: 'x'.repeat(500) }];
check('f expansion past the length cap is rejected',
  S.expandGlslSharedSnippets('// @use big\n// @use big\n// @use big', bigDefs, 1000).ok === false);

// ---- (g) byte identity --------------------------------------------------------

const plain = 'vel += vec3(sin(pos.y), 0.0, cos(pos.x)) * uDelta;';
const plainExpanded = S.expandGlslSharedSnippets(plain, defs);
check('g expansion without directives returns the identical string',
  plainExpanded.ok && plainExpanded.code === plain);
const resolvedEmpty = I.resolveGlslSnippet(plain, [], TOKENS);
check('g resolve with an empty set returns the identical string',
  resolvedEmpty.ok && resolvedEmpty.code === plain);
const resolvedUnused = I.resolveGlslSnippet(plain, defs, TOKENS);
check('g resolve with an unreferenced set returns the identical string',
  resolvedUnused.ok && resolvedUnused.code === plain);

// ---- (h) validation discipline ------------------------------------------------

const badBodyDefs = [{ name: 'evil', code: '#define X 1\nvel += vec3(1.0);' }];
const badBody = I.validateGlslSharedSnippetDefsForInjection(badBodyDefs, TOKENS);
check('h a forbidden token in a def body is rejected', badBody.ok === false);
check('h the rejection names the definition', badBody.error !== undefined && badBody.error.includes('evil'));
check('h a clean set passes the injection validation',
  I.validateGlslSharedSnippetDefsForInjection(defs, TOKENS).ok === true);
check('h resolve rejects a snippet using a forbidden def',
  I.resolveGlslSnippet('// @use evil', badBodyDefs, TOKENS).ok === false);
check('h resolve rejects an expanded result past the length cap',
  I.resolveGlslSnippet('// @use lift', defs, TOKENS, 8).ok === false);
const resolved = I.resolveGlslSnippet(snippet, defs, TOKENS);
check('h resolve expands a valid snippet end to end', resolved.ok && resolved.code === expectedExpansion);
check('h the shared core still caps length', I.validateGlslSnippet('x'.repeat(11), TOKENS, 10).ok === false);
check('h the shared core still scans tokens', I.validateGlslSnippet('uniform float x;', TOKENS).ok === false);
check('h the shared core still accepts clean code', I.validateGlslSnippet('vel += vec3(1.0);', TOKENS).ok === true);

// ---- (i) serialisation --------------------------------------------------------

const roundTripped = S.parseGlslSharedSnippetDefs(S.serializeGlslSharedSnippetDefs(defs));
check('i serialize/parse round-trips the set',
  roundTripped.ok && JSON.stringify(roundTripped.defs) === JSON.stringify(defs));
check('i serialisation is byte-stable across a round trip',
  S.serializeGlslSharedSnippetDefs(roundTripped.defs) === S.serializeGlslSharedSnippetDefs(defs));
check('i empty text parses as the empty set', (() => { const r = S.parseGlslSharedSnippetDefs(''); return r.ok && r.defs.length === 0; })());
check('i malformed JSON is rejected without throwing', S.parseGlslSharedSnippetDefs('{oops').ok === false);
check('i a non-array document is rejected', S.parseGlslSharedSnippetDefs('{"name":"a"}').ok === false);
check('i an entry without code is rejected', S.parseGlslSharedSnippetDefs('[{"name":"a"}]').ok === false);
check('i a structurally invalid set is rejected at parse',
  S.parseGlslSharedSnippetDefs('[{"name":"a","code":"x"},{"name":"a","code":"y"}]').ok === false);

// ---- summary ------------------------------------------------------------------

if (failures > 0) {
  console.error(`layer1-wp11-scratchpad: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`layer1-wp11-scratchpad: ${checks}/${checks} checks passed`);
console.log('ALL PASS');
