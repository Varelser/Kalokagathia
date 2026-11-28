#!/usr/bin/env node
// layer1-wp11-script-bake.test.mjs — Layer 1 WP11, phase B:
// the C1 (Pyodide) script-bake contracts ported into the
// tree's lib layer (lib/gpgpuScriptBake.ts). The contracts
// follow the bake channel's prototype (kalokagathia-pro/
// pyodide-integration-proto/, record PYODIDE_PROTO_IMPL_
// RECORD.md §1; prototype fixed at its 2026-11-28 state for
// this intake). Contracts + connection points only: no
// Worker execution, no Pyodide assets, no panel wiring.
//
// Pins:
// (a) hashing: the pure-TS SHA-256 matches the published
//     vectors, and hashScriptOutputs' composition (name
//     order + name bytes + raw bytes) matches node:crypto;
// (b) static check: whitelisted imports pass, the forbidden
//     patterns and non-whitelist imports are refused, the
//     32,000-char cap boundary;
// (c) config validation: the defaults validate, the seven
//     refusal classes of the prototype store are refused,
//     the static check runs only while enabled;
// (d) store: a failed applyConfig leaves current and the
//     recorded good bake untouched; recordGoodBake moves
//     lastGoodBake and the output-hash key; share payloads
//     exclude the source unless explicitly flagged, and a
//     flagged payload demands run confirmation;
// (e) output validation: type / expected length / NaN /
//     Inf / total-element cap;
// (f) OFF identity: the registered defaults are OFF, an OFF
//     slice resolves to a null plan (the legacy path), no
//     file outside the registration set + the new lib reads
//     the script keys, and the legacy attribute bake is a
//     pure function of its inputs (two calls, byte-equal);
// (g) connection point 1 (attribute bake): execution inputs
//     derive from the same initial data buildAttributeData
//     consumes, and declared channels come back as one
//     Float32Array(count) column per name;
// (h) connection point 2 (initial state): pos / vel / age
//     outputs convert through the canonical
//     buildGpgpuInitialDataFromStateFrame, byte-equal to a
//     direct call;
// (i) registration: the fingerprint record carries the six
//     script keys (total re-pinned 2026-11-28 by WP11 phase C:
//     glslSharedSnippets + the six replacement keys; 1,703 ->
//     1,710; re-pinned again 2026-11-29 at the 第45期統合
//     fixed value: 1,738).
//
// Run: node scripts/layer1-wp11-script-bake.test.mjs

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const S = await load('lib/gpgpuScriptBake.ts');
const DEF = await load('lib/appStateConfigDefaults.ts');
const ATTR = await load('lib/gpgpuAttributes.ts');
const INIT = await load('lib/gpgpuInitialData.ts');

const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const f32 = (xs) => new Float32Array(xs);

// ---- (a) hashing ------------------------------------------------------------

check('a sha256 of the empty source matches the published vector',
  S.hashScriptSource('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
check('a sha256 of "abc" matches the published vector',
  S.hashScriptSource('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
{
  const outputs = { vel: f32([0.5, -1.25, 3]), pos: f32([1, 2, 3, 4, 5, 6]) };
  const h = createHash('sha256');
  for (const name of Object.keys(outputs).sort()) {
    h.update(Buffer.from(name, 'utf8'));
    h.update(bytes(outputs[name]));
  }
  check('a output hash composition matches node:crypto (sorted names, name bytes + raw bytes)',
    S.hashScriptOutputs(outputs) === h.digest('hex'));
  check('a output hash is independent of record key order',
    S.hashScriptOutputs({ pos: outputs.pos, vel: outputs.vel }) === S.hashScriptOutputs(outputs));
  check('a output hash changes with the data',
    S.hashScriptOutputs({ pos: f32([1, 2, 3, 4, 5, 7]), vel: outputs.vel }) !== S.hashScriptOutputs(outputs));
  check('a output hash handles a view with a byte offset',
    S.hashScriptOutputs({ x: new Float32Array(new Float32Array([9, 8, 7]).buffer, 4, 1) })
      === S.hashScriptOutputs({ x: f32([8]) }));
}

// ---- (b) static check ---------------------------------------------------------

check('b a numpy + math script passes',
  S.staticCheckScript('import numpy as np\nimport math\ndef bake(state):\n    pass').ok === true);
check('b a from-import of a whitelisted module passes',
  S.staticCheckScript('from fractions import Fraction').ok === true);
for (const [label, src] of [
  ['import os', 'import os'],
  ['import sys', 'import sys'],
  ['import subprocess', 'import subprocess'],
  ['from os import path', 'from os import path'],
  ['import json (not whitelisted)', 'import json'],
  ['import pathlib (not whitelisted)', 'import pathlib'],
  ['eval()', 'x = eval("1")'],
  ['exec()', 'exec("x = 1")'],
  ['open()', 'f = open("a.txt")'],
  ['__import__()', 'm = __import__("os")'],
  ['a dunder access', 'x = state.__class__'],
  ['input()', 'x = input()'],
  ['getattr()', 'x = getattr(state, "pos")'],
]) {
  check(`b forbidden source is refused: ${label}`, S.staticCheckScript(src).ok === false);
}
check('b a 32,000-char source passes the length cap',
  S.staticCheckScript('# ' + 'a'.repeat(32000 - 2)).ok === true);
check('b a 32,001-char source is refused by the length cap',
  S.staticCheckScript('# ' + 'a'.repeat(32001 - 2)).ok === false);
check('b a non-string source is refused without throwing',
  S.staticCheckScript(42).ok === false);

// ---- (c) config validation ----------------------------------------------------

{
  const v = S.validateScriptConfig({});
  check('c the empty candidate validates to the defaults',
    v.ok === true && v.config.gpgpuScriptEnabled === false
      && v.config.gpgpuScriptTarget === 'attrBake'
      && v.config.gpgpuScriptSource === ''
      && v.config.gpgpuScriptSeed === 0
      && v.config.gpgpuScriptFormatVersion === 1
      && v.config.gpgpuScriptOutputHash === '');
}
for (const [label, patch] of [
  ['an unknown target', { gpgpuScriptTarget: 'shader' }],
  ['a negative seed', { gpgpuScriptSeed: -1 }],
  ['a fractional seed', { gpgpuScriptSeed: 1.5 }],
  ['a seed past uint32', { gpgpuScriptSeed: 0x100000000 }],
  ['a format version mismatch', { gpgpuScriptFormatVersion: 2 }],
  ['an over-long source', { gpgpuScriptSource: 'a'.repeat(32001) }],
  ['a malformed output hash', { gpgpuScriptOutputHash: 'xyz' }],
  ['a non-boolean enabled flag', { gpgpuScriptEnabled: 'yes' }],
  ['enabling with an empty source', { gpgpuScriptEnabled: true, gpgpuScriptSource: '  ' }],
  ['enabling with a forbidden import', { gpgpuScriptEnabled: true, gpgpuScriptSource: 'import os' }],
]) {
  check(`c invalid candidate is refused: ${label}`,
    S.validateScriptConfig({ ...S.SCRIPT_CONFIG_DEFAULTS, ...patch }).ok === false);
}
check('c enabling with a valid source validates',
  S.validateScriptConfig({ gpgpuScriptEnabled: true, gpgpuScriptSource: 'import math\ndef bake(state):\n    pass' }).ok === true);
check('c OFF keeps a source unexamined (the static check runs only while enabled)',
  S.validateScriptConfig({ gpgpuScriptEnabled: false, gpgpuScriptSource: 'import os' }).ok === true);
check('c a recorded output hash in sha256 hex validates',
  S.validateScriptConfig({ gpgpuScriptOutputHash: 'a'.repeat(64) }).ok === true);
check('c a non-object candidate is refused without throwing',
  S.validateScriptConfig(null).ok === false && S.validateScriptConfig(7).ok === false);

// ---- (d) store -----------------------------------------------------------------

{
  const store = new S.GpgpuScriptBakeStore();
  check('d a fresh store holds the defaults and no good bake',
    store.current.gpgpuScriptEnabled === false && store.lastGoodBake === null);
  const before = store.current;
  const bad = store.applyConfig({ gpgpuScriptTarget: 'nope' });
  check('d a failed applyConfig reports the error and retains current',
    bad.ok === false && store.current === before && bad.retained === before);
  const good = store.applyConfig({
    gpgpuScriptEnabled: true,
    gpgpuScriptTarget: 'attrBake',
    gpgpuScriptSource: 'import numpy as np\ndef bake(state):\n    pass',
    gpgpuScriptSeed: 42,
  });
  check('d a valid applyConfig replaces current', good.ok === true && store.current.gpgpuScriptSeed === 42);
  const outputs = { 'channel:rand': f32([0.25, 0.5]) };
  const hash = S.hashScriptOutputs(outputs);
  const bake = store.recordGoodBake(outputs, hash);
  check('d recordGoodBake records the bake and moves the output-hash key',
    bake.hash === hash && bake.target === 'attrBake'
      && bake.sourceHash === S.hashScriptSource(store.current.gpgpuScriptSource)
      && store.current.gpgpuScriptOutputHash === hash
      && store.lastGoodBake === bake);
  const bad2 = store.applyConfig({ gpgpuScriptSeed: -3 });
  check('d a later failed applyConfig leaves the good bake standing',
    bad2.ok === false && store.lastGoodBake === bake && store.current.gpgpuScriptSeed === 42);
  const share = store.toSharePayload();
  check('d the default share payload excludes the source and needs no confirmation',
    share.gpgpuScriptIncluded === false && !('gpgpuScriptSource' in share)
      && share.requiresRunConfirmation === undefined);
  const shareInc = store.toSharePayload(true);
  check('d an inclusive share payload carries the source and demands run confirmation',
    shareInc.gpgpuScriptIncluded === true && shareInc.requiresRunConfirmation === true
      && shareInc.gpgpuScriptSource === store.current.gpgpuScriptSource);
}

// ---- (e) output validation -------------------------------------------------------

check('e well-formed outputs pass',
  S.validateScriptOutputs({ pos: f32([1, 2, 3]) }, { count: 1, expected: { pos: 3 } }).ok === true);
check('e a non-Float32Array entry is refused',
  S.validateScriptOutputs({ pos: [1, 2, 3] }, { count: 1 }).ok === false);
check('e an expected-length mismatch is refused',
  S.validateScriptOutputs({ pos: f32([1, 2]) }, { count: 1, expected: { pos: 3 } }).ok === false);
check('e a NaN element is refused',
  S.validateScriptOutputs({ pos: f32([1, NaN, 3]) }, { count: 1 }).ok === false);
check('e an Inf element is refused',
  S.validateScriptOutputs({ pos: f32([1, Infinity, 3]) }, { count: 1 }).ok === false);
check('e the total-element cap is per particle (count x 64)',
  S.validateScriptOutputs({ big: new Float32Array(129) }, { count: 2 }).ok === false
    && S.validateScriptOutputs({ big: new Float32Array(128) }, { count: 2 }).ok === true);
check('e a non-object output set is refused without throwing',
  S.validateScriptOutputs(null).ok === false && S.validateScriptOutputs('x').ok === false);

// ---- (f) OFF identity -------------------------------------------------------------

{
  const d = DEF.DEFAULT_CONFIG;
  check('f the registered defaults are the OFF slice',
    d.gpgpuScriptEnabled === false && d.gpgpuScriptTarget === 'attrBake'
      && d.gpgpuScriptSource === '' && d.gpgpuScriptSeed === 0
      && d.gpgpuScriptFormatVersion === 1 && d.gpgpuScriptOutputHash === '');
  const off = S.resolveScriptBake({
    gpgpuScriptEnabled: d.gpgpuScriptEnabled, gpgpuScriptTarget: d.gpgpuScriptTarget,
    gpgpuScriptSource: d.gpgpuScriptSource, gpgpuScriptSeed: d.gpgpuScriptSeed,
    gpgpuScriptFormatVersion: d.gpgpuScriptFormatVersion, gpgpuScriptOutputHash: d.gpgpuScriptOutputHash,
  });
  check('f an OFF slice resolves to a null plan (the legacy path stands)',
    off.ok === true && off.plan === null);
  const on = S.resolveScriptBake({ gpgpuScriptEnabled: true, gpgpuScriptSource: 'import math', gpgpuScriptSeed: 7 });
  check('f an enabled valid slice resolves to a plan',
    on.ok === true && on.plan !== null && on.plan.seed === 7 && on.plan.target === 'attrBake');
  check('f an enabled invalid slice is an error, never a silent disable',
    S.resolveScriptBake({ gpgpuScriptEnabled: true, gpgpuScriptSource: 'import sys' }).ok === false);
}
{
  // Structural pin: in this phase nothing outside the
  // registration files and the new lib may read the keys —
  // that is what makes OFF bit-identical rather than merely
  // defaulted.
  // Phase D registration (WP11 phase D, the execution
  // wiring): the runner and its Worker factory are registered
  // consumers of the phase-B store — they read the keys only
  // through GpgpuScriptBakeStore / resolveScriptBake, and OFF
  // still resolves to a null plan before any Worker exists.
  // Phase C registration (WP11 phase C, 2026-11-28): the
  // script-bake panel is the authoring consumer — it edits
  // the keys through updateConfig and reads the share
  // contract / output hash; it runs no Worker.
  // WP12 phase B (2026-11-28): lib/verificationFormat.ts
  // mentions the keys only to type the provenance field of
  // the shared verification format (a Pyodide-originated
  // reference value carries its output hash); it reads no
  // config and runs nothing.
  // 第45期統合 (2026-11-29): WP12 は統合対象外のため
  // lib/verificationFormat.ts はこのツリーに存在しない。
  // よって言及集合は残りの8ファイルが正本になる (WP12 が
  // 入る統合で verificationFormat.ts が戻れば、この集合へ
  // 再び加えること).
  const allowed = new Set([
    'lib/gpgpuScriptBake.ts',
    'lib/gpgpuScriptBakeRunner.ts',
    'lib/gpgpuScriptBakeWorkerFactory.ts',
    'lib/appStateDefaultGpgpu.ts',
    'lib/aiControlCatalog.ts',
    'lib/parameterDescriptions.ts',
    'types/configGpgpu.ts',
    'components/controlPanelGlobalDisplayGpgpuScriptBake.tsx',
  ]);
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (entry.endsWith('.bak')) continue;
      const rel = `${dir}/${entry}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      if (readFileSync(join(ROOT, rel), 'utf8').includes('gpgpuScript')) found.push(rel);
    }
  };
  walk('lib'); walk('components'); walk('types');
  check('f only the registration set + the new lib mention the script keys',
    JSON.stringify(found.sort()) === JSON.stringify([...allowed].sort()));
}
{
  // The legacy attribute bake is a pure function of its
  // inputs; the script keys are not among them.
  const texSize = 2;
  const count = texSize * texSize;
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    posData.set([i * 0.5 - 0.75, 0.25 * i, -0.1 * i, i * 0.3], i * 4);
    velData.set([0.1 * i, 0, -0.05 * i, 0], i * 4);
  }
  const args = {
    texSize, posData, velData, ageMax: 4, bounceRadius: 10, speciesCount: 1,
    names: ['seed'], sources: ['hash', 'species', 'radius', 'height'],
  };
  const first = ATTR.buildAttributeData(args);
  const second = ATTR.buildAttributeData(args);
  check('f the legacy attribute bake is byte-identical across calls',
    Buffer.compare(bytes(first), bytes(second)) === 0 && first.length === count * 4);
}

// ---- (g) connection point 1: the attribute bake -----------------------------------

{
  const count = 3;
  const posData = f32([1, 2, 3, 0.1, 4, 5, 6, 0.2, 7, 8, 9, 0.3]);
  const velData = f32([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0]);
  const inputs = S.scriptBakeInputsFromInitialData(posData, velData);
  check('g execution inputs derive from the bake initial data (triplets + age lane)',
    inputs !== null && inputs.count === count
      && [...inputs.pos].join(',') === '1,2,3,4,5,6,7,8,9'
      && [...inputs.age].join(',') === '0.10000000149011612,0.20000000298023224,0.30000001192092896'
      && [...inputs.vel].join(',') === '0.5,0,0,0,0.5,0,0,0,0.5');
  check('g absent velocities derive as zeros',
    S.scriptBakeInputsFromInitialData(posData, null).vel.every((v) => v === 0));
  check('g mis-sized lanes are refused as null (nothing padded)',
    S.scriptBakeInputsFromInitialData(f32([1, 2, 3, 4, 5, 6]), null) === null
      && S.scriptBakeInputsFromInitialData(posData, f32([1, 2, 3, 4])) === null);

  const rand = f32([0.25, 0.5, 0.75]);
  const outputs = {
    pos: f32([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    vel: f32([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    age: f32([0.1, 0.2, 0.3]),
    'channel:rand': rand,
    'channel:undeclared': f32([9, 9, 9]),
  };
  const cols = S.scriptAttrBakeColumns(outputs, count, ['rand', 'missing']);
  check('g declared channels come back as one column per written name',
    cols.ok === true && cols.channels.rand === rand
      && !('missing' in cols.channels) && !('undeclared' in cols.channels));
  check('g a wrong-length declared channel refuses the whole set',
    S.scriptAttrBakeColumns({ 'channel:rand': f32([1, 2]) }, count, ['rand']).ok === false);
  check('g a NaN anywhere in the outputs refuses the whole set',
    S.scriptAttrBakeColumns({ 'channel:rand': f32([1, NaN, 3]) }, count, ['rand']).ok === false);
}

// ---- (h) connection point 2: initial-state generation ------------------------------

{
  const count = 3;
  const outputs = {
    pos: f32([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    vel: f32([0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]),
    age: f32([0.1, 0.2, 0.3]),
  };
  const via = S.scriptInitialStateFromOutputs(outputs, count);
  const direct = INIT.buildGpgpuInitialDataFromStateFrame({
    count, positions: outputs.pos, velocities: outputs.vel, ages: outputs.age,
  });
  check('h outputs convert to initial data through the canonical conversion',
    via.ok === true && direct !== null
      && Buffer.compare(bytes(via.data.posData), bytes(direct.posData)) === 0
      && Buffer.compare(bytes(via.data.velData), bytes(direct.velData)) === 0);
  check('h the converted lanes carry age as posData w and 0 as velData w',
    via.ok === true && via.data.posData[3] === outputs.age[0] && via.data.velData[3] === 0
      && via.data.posData.length === count * 4);
  check('h a missing lane is refused with the reason',
    S.scriptInitialStateFromOutputs({ pos: outputs.pos, vel: outputs.vel }, count).ok === false);
  check('h a mis-sized lane is refused',
    S.scriptInitialStateFromOutputs({ ...outputs, age: f32([0.1, 0.2]) }, count).ok === false);
  check('h a NaN lane is refused',
    S.scriptInitialStateFromOutputs({ ...outputs, pos: f32([1, 2, NaN, 4, 5, 6, 7, 8, 9]) }, count).ok === false);
}

// ---- (i) registration ---------------------------------------------------------------

{
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts/validate-keys.fingerprint.json'), 'utf8'));
  const six = ['gpgpuScriptEnabled', 'gpgpuScriptTarget', 'gpgpuScriptSource',
    'gpgpuScriptSeed', 'gpgpuScriptFormatVersion', 'gpgpuScriptOutputHash'];
  check('i the fingerprint record carries the six script keys at 1,738 total',
    six.every((k) => record.keys.includes(k)) && record.keyCount === 1738
      && record.keyCount === record.keys.length,
    `keyCount=${record.keyCount}`);
}

console.log(`layer1-wp11-script-bake: ${checks - failures}/${checks} checks passed`);
if (failures > 0) { console.error(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
