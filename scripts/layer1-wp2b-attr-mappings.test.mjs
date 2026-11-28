#!/usr/bin/env node
// layer1-wp2b-attr-mappings.test.mjs — Layer 1 WP2 phase B2:
// the attribute channel mapping table (lib/gpgpuAttrMappings.ts
// + the gpgpuAttrMappings config key).
//
// Until this phase the channel-to-channel relationship only
// existed buried inside per-slot expressions (bake / dyn /
// chain). The mapping table states it as data: entries
// { from, to, expr? } over channel NAMES, resolved through
// resolveAttrNameSlot, applied sequentially against the
// current values under the dyn stage's guard, with a CPU twin
// (applyAttrMappings) and a fragment builder
// (buildAttrMappingFragment) that must agree slot for slot.
//
// Pins:
// (a) parse / serialize round trip: well-formed entries come
//     back identical; malformed items (non-object, missing or
//     non-string from / to, non-string expr) are dropped
//     quietly; an empty-after-trim expr is the identity;
//     non-JSON and non-array payloads parse to []; the empty
//     table serialises to '' (the unset key).
// (b) resolution: all four rejection reasons surface with
//     their entry indices — unknown-source-channel,
//     unknown-target-channel, ext-slot-read-only (a target in
//     slots 4..7), duplicate-target — and a rejected entry
//     never claims its target, so a later valid entry to the
//     same target still resolves.
// (c) twin <-> fragment correspondence: for identity and
//     transform entries the fragment emits exactly one guard
//     block per resolved entry, writing v<toSlot> from the
//     source local v<fromSlot> (or w<fromSlot-4> for an ext
//     source, with the uSrc2 lines present), and the twin's
//     numeric results match the mapping semantics (identity
//     copy, x-bound transform, sequential chaining, clamp,
//     non-finite guard keeping the current value).
// (d) null discipline: no entries, all-rejected entries, and
//     a lone entry whose expression fails to compile all
//     build NO fragment (the stage never exists).
//
// Run: node scripts/layer1-wp2b-attr-mappings.test.mjs

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

const M = await load('lib/gpgpuAttrMappings.ts');

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const CHANNELS = ['r', 'g', 'b', 'a'];

// Extract the guard blocks of a built fragment as
// { valueExpr, toSlot } pairs, in emission order.
function fragmentBlocks(fragment) {
  const blocks = [];
  const re = /float r = ([^;]+);\n\s*v(\d) = \(\(r == r\) && abs\(r\) < 1\.0e30\) \? clamp\(r, 0\.0, 1\.0\) : src\.([rgba]);/g;
  let m;
  while ((m = re.exec(fragment)) !== null) {
    blocks.push({ valueExpr: m[1], toSlot: Number(m[2]), fallbackChan: m[3] });
  }
  return blocks;
}

// ---- (a) parse / serialize round trip -------------------------------------------
{
  const entries = [
    { from: 'a', to: 'c' },
    { from: 'b', to: 'd', expr: 'x * 0.5' },
    { from: 'j', to: 'a', expr: 'clamp(x, 0.0, 1.0)' },
  ];
  const text = M.serializeAttrMappings(entries);
  check('a1 serialize produces a string for a non-empty table', typeof text === 'string' && text.length > 0);
  check('a2 parse(serialize(entries)) round-trips exactly', sameJson(M.parseAttrMappings(text), entries));
  check('a3 the empty table serialises to the unset key', M.serializeAttrMappings([]) === '');
  check('a4 empty string parses to no entries', sameJson(M.parseAttrMappings(''), []));
  check('a5 non-JSON parses to no entries', sameJson(M.parseAttrMappings('{not json'), []));
  check('a6 non-array JSON parses to no entries', sameJson(M.parseAttrMappings('{"from":"a"}'), []));

  const messy = JSON.stringify([
    { from: 'a', to: 'b' },
    { from: 'a' },
    { to: 'b' },
    { from: 3, to: 'b' },
    { from: 'a', to: 'b', expr: 42 },
    'junk',
    null,
    { from: ' c ', to: ' d ', expr: '   ' },
  ]);
  check('a7 malformed items are dropped, names trimmed, blank expr is the identity',
    sameJson(M.parseAttrMappings(messy), [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]));
}

// ---- (b) resolution: the four rejection reasons ----------------------------------
{
  const entries = [
    { from: 'nope', to: 'b' },        // 0: unknown source
    { from: 'a', to: 'nope' },        // 1: unknown target
    { from: 'a', to: 'i' },           // 2: ext target (slot 4)
    { from: 'a', to: 'b' },           // 3: resolves (slot 0 -> 1)
    { from: 'c', to: 'b' },           // 4: duplicate target
    { from: 'nope', to: 'c' },        // 5: unknown source, must not claim slot 2
    { from: 'd', to: 'c' },           // 6: resolves (slot 3 -> 2)
  ];
  const { resolved, rejections } = M.resolveAttrMappings(entries, NAMES, NAMES2);
  check('b1 the valid entries resolve in order with their slots',
    sameJson(resolved, [{ fromSlot: 0, toSlot: 1 }, { fromSlot: 3, toSlot: 2 }]));
  check('b2 all four rejection reasons surface with entry indices',
    sameJson(rejections, [
      { index: 0, reason: 'unknown-source-channel' },
      { index: 1, reason: 'unknown-target-channel' },
      { index: 2, reason: 'ext-slot-read-only' },
      { index: 4, reason: 'duplicate-target' },
      { index: 5, reason: 'unknown-source-channel' },
    ]));
  const ext = M.resolveAttrMappings([{ from: 'k', to: 'a' }], NAMES, NAMES2);
  check('b3 an ext channel is a readable source (slot 6 -> 0)',
    sameJson(ext.resolved, [{ fromSlot: 6, toSlot: 0 }]) && ext.rejections.length === 0);
  const reserved = M.resolveAttrMappings([{ from: 'x', to: 'a' }], NAMES, NAMES2);
  check('b4 a reserved name never resolves as a source',
    sameJson(reserved.rejections, [{ index: 0, reason: 'unknown-source-channel' }]));
}

// ---- (c) twin <-> fragment correspondence ----------------------------------------
{
  // Identity copy.
  const identity = [{ from: 'a', to: 'c' }];
  const idRes = M.resolveAttrMappings(identity, NAMES, NAMES2).resolved;
  check('c1 identity copy moves the source value into the target slot',
    sameJson(M.applyAttrMappings([0.2, 0.4, 0.6, 0.8], idRes), [0.2, 0.4, 0.2, 0.8]));
  const idFrag = M.buildAttrMappingFragment(identity, NAMES, NAMES2);
  const idBlocks = fragmentBlocks(idFrag);
  check('c2 identity fragment emits one block writing v2 from v0 with the src.b fallback',
    idBlocks.length === 1 && idBlocks[0].valueExpr === 'v0'
    && idBlocks[0].toSlot === 2 && idBlocks[0].fallbackChan === 'b');
  check('c3 identity fragment needs no ext texture', !idFrag.includes('uSrc2'));

  // Transform expression with x bound to the source value.
  const transform = [{ from: 'b', to: 'd', expr: 'x * 0.5' }];
  const trRes = M.resolveAttrMappings(transform, NAMES, NAMES2).resolved;
  check('c4 the transform evaluates with x = the source channel value',
    sameJson(M.applyAttrMappings([0.1, 0.8, 0.3, 0.9], trRes), [0.1, 0.8, 0.3, 0.4]));
  const trBlocks = fragmentBlocks(M.buildAttrMappingFragment(transform, NAMES, NAMES2));
  check('c5 transform fragment writes v3 and reads v1 scaled by 0.5',
    trBlocks.length === 1 && trBlocks[0].toSlot === 3
    && trBlocks[0].valueExpr.includes('v1') && trBlocks[0].valueExpr.includes('0.5'));

  // Sequential chaining: the second entry reads the remapped value.
  const chain = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const chRes = M.resolveAttrMappings(chain, NAMES, NAMES2).resolved;
  check('c6 chained mappings apply sequentially against the current values',
    sameJson(M.applyAttrMappings([0.7, 0.1, 0.2, 0.3], chRes), [0.7, 0.7, 0.7, 0.3]));
  const chBlocks = fragmentBlocks(M.buildAttrMappingFragment(chain, NAMES, NAMES2));
  check('c7 chain fragment emits the blocks in entry order (v1 from v0, then v2 from v1)',
    chBlocks.length === 2
    && chBlocks[0].toSlot === 1 && chBlocks[0].valueExpr === 'v0'
    && chBlocks[1].toSlot === 2 && chBlocks[1].valueExpr === 'v1');

  // Clamp and guard.
  const over = M.resolveAttrMappings([{ from: 'a', to: 'b', expr: 'x * 4.0' }], NAMES, NAMES2).resolved;
  check('c8 a finite over-range result is clamped to [0, 1]',
    sameJson(M.applyAttrMappings([0.5, 0.25, 0, 0], over), [0.5, 1, 0, 0]));
  const div0 = M.resolveAttrMappings([{ from: 'a', to: 'b', expr: '1.0 / x' }], NAMES, NAMES2).resolved;
  check('c9 a non-finite result keeps the target current value',
    sameJson(M.applyAttrMappings([0, 0.25, 0, 0], div0), [0, 0.25, 0, 0]));

  // Ext source over an 8-slot value array.
  const extMap = [{ from: 'j', to: 'a' }];
  const extRes = M.resolveAttrMappings(extMap, NAMES, NAMES2).resolved;
  check('c10 an ext source reads slot 5 of the 8-slot values',
    sameJson(
      M.applyAttrMappings([0.1, 0.2, 0.3, 0.4, 0.5, 0.66, 0.7, 0.8], extRes),
      [0.66, 0.2, 0.3, 0.4, 0.5, 0.66, 0.7, 0.8],
    ));
  const extFrag = M.buildAttrMappingFragment(extMap, NAMES, NAMES2);
  const extBlocks = fragmentBlocks(extFrag);
  check('c11 ext-source fragment binds uSrc2 and writes v0 from w1',
    extFrag.includes('uniform sampler2D uSrc2;')
    && extBlocks.length === 1 && extBlocks[0].valueExpr === 'w1' && extBlocks[0].toSlot === 0);

  // Every resolved entry of a mixed table appears exactly once,
  // targeting the same slot the twin writes.
  const mixed = [
    { from: 'a', to: 'd', expr: 'x * x' },
    { from: 'j', to: 'b' },
    { from: 'c', to: 'a' },
  ];
  const mixRes = M.resolveAttrMappings(mixed, NAMES, NAMES2).resolved;
  const mixBlocks = fragmentBlocks(M.buildAttrMappingFragment(mixed, NAMES, NAMES2));
  check('c12 mixed table: fragment blocks target exactly the resolved slots, in order',
    sameJson(mixBlocks.map((b) => b.toSlot), mixRes.map((m) => m.toSlot))
    && mixBlocks.every((b, i) => b.fallbackChan === CHANNELS[mixRes[i].toSlot]));
}

// ---- (d) null discipline -----------------------------------------------------------
{
  check('d1 no entries build no fragment', M.buildAttrMappingFragment([], NAMES, NAMES2) === null);
  check('d2 all-rejected entries build no fragment',
    M.buildAttrMappingFragment([{ from: 'nope', to: 'b' }, { from: 'a', to: 'i' }], NAMES, NAMES2) === null);
  check('d3 a lone entry whose expression fails to compile builds no fragment',
    M.buildAttrMappingFragment([{ from: 'a', to: 'b', expr: 'x *' }], NAMES, NAMES2) === null);
  check('d4 the twin keeps the current value for an uncompilable expression',
    sameJson(
      M.applyAttrMappings([0.3, 0.6, 0, 0],
        M.resolveAttrMappings([{ from: 'a', to: 'b', expr: 'x *' }], NAMES, NAMES2).resolved),
      [0.3, 0.6, 0, 0],
    ));
}

console.log(`layer1-wp2b-attr-mappings: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
