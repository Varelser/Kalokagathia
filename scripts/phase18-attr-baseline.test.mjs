// Phase 18 stage 0 — attribute-path baseline pins.
//
// Before this file, NO unit test covered the attribute path
// (bake -> dynamic re-evaluation -> feedback -> consumption).
// Stage 1 of Phase 18 changes that path (second attribute stage,
// slots 4..8, sim-quantity references in expressions), and its
// gate is "at the defaults, the output stays identical to
// v1.99.0". These pins are the ruler for that gate:
//
// (a) the bake is a pure function: a fixed synthetic input
//     reproduces the pinned Float32Array bytes, twice in a row
//     (determinism), on the legacy path (all expressions empty)
//     and on the expression path (sequential slot semantics);
// (b) the dynamic and feedback fragment builders return null
//     when every expression is empty — the structural identity
//     guarantee that the passes do not exist at the defaults;
// (c) for a representative non-empty expression set, the built
//     fragment strings are pinned by sha256 + length, so any
//     change to variable resolution (e.g. new reserved names
//     for sim quantities) shows up here first and must be a
//     deliberate re-pin, not a silent drift.
//
// Pins measured on v1.99.0 (2026-11-23, Phase 18 stage 0).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18ab-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildAttributeData, DEFAULT_ATTR_NAMES, DEFAULT_ATTR_SOURCES } from './lib/gpgpuAttributes.ts';
      export { buildAttrDynFragment } from './lib/expressionGlsl.ts';
      export { buildAttrFeedbackFragment } from './lib/expressionGlslFeedback.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { buildAttributeData, DEFAULT_ATTR_NAMES, DEFAULT_ATTR_SOURCES } = lib;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const f32Sha = (arr) => sha256(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
const strSha = (s) => sha256(Buffer.from(s, 'utf8'));

// Deterministic synthetic positions (no RNG): texSize 16 -> 256 texels.
const texSize = 16;
const posData = new Float32Array(texSize * texSize * 4);
for (let i = 0; i < texSize * texSize; i++) {
  const a = (i % 16) / 16 * Math.PI * 2;
  const r = ((i / 16) | 0) / 16;
  posData[i * 4] = Math.cos(a) * r * 3;
  posData[i * 4 + 1] = Math.sin(a) * r * 3;
  posData[i * 4 + 2] = ((i * 7) % 13) / 13 - 0.5;
  posData[i * 4 + 3] = ((i * 3) % 11) / 11;
}
const baseArgs = {
  texSize, posData, ageMax: 8, bounceRadius: 3, speciesCount: 4,
  names: [...DEFAULT_ATTR_NAMES], sources: [...DEFAULT_ATTR_SOURCES],
};

// (a) bake — legacy path (all expressions empty = the default config)
const bakeDefault = buildAttributeData({ ...baseArgs, exprs: ['', '', '', ''] });
check('bake default: output size is texels x 4 slots', bakeDefault.length === 1024, `length=${bakeDefault.length}`);
check('bake default: bytes match the v1.99.0 pin',
  f32Sha(bakeDefault) === 'b7d85f2aaeb2605aa23849cc754923fbc474e00cc0188821701b598b2a94f1db',
  `sha256=${f32Sha(bakeDefault)}`);
const bakeDefault2 = buildAttributeData({ ...baseArgs, exprs: ['', '', '', ''] });
check('bake default: deterministic across runs',
  Buffer.from(bakeDefault.buffer).equals(Buffer.from(bakeDefault2.buffer)));

// (a) bake — expression path (later slots read earlier slots' results)
const exprs = ['a * 0.5 + b * 0.25', '', 'c * c', 'x - a'];
const bakeExpr = buildAttributeData({ ...baseArgs, exprs });
check('bake exprs: bytes match the v1.99.0 pin',
  f32Sha(bakeExpr) === 'cb8158294200e72b032916d081f15a983bcdb5415b07d174784cd5972e7720e6',
  `sha256=${f32Sha(bakeExpr)}`);
check('bake exprs: differs from the legacy bake (expressions actually applied)',
  f32Sha(bakeExpr) !== f32Sha(bakeDefault));

// (b) fragment builders — empty expressions mean the passes do not exist
check('dyn fragment: null when every expression is empty',
  lib.buildAttrDynFragment(['', '', '', ''], DEFAULT_ATTR_NAMES) === null);
check('feedback fragment: null when every expression is empty',
  lib.buildAttrFeedbackFragment(['', '', '', ''], DEFAULT_ATTR_NAMES) === null);

// (c) fragment builders — representative expression sets pinned
const dyn = lib.buildAttrDynFragment(exprs, DEFAULT_ATTR_NAMES);
check('dyn fragment: built for the representative set', dyn !== null);
check('dyn fragment: matches the v1.99.0 pin',
  dyn !== null && dyn.length === 602 && strSha(dyn) === 'd26a6df63c420e7e06f9bd4ac80c3a91a1a7545d49a79c708017919ab32a73e7',
  dyn === null ? 'null' : `length=${dyn.length} sha256=${strSha(dyn)}`);

const fb = lib.buildAttrFeedbackFragment(['p * 0.9 + x * 0.1', '', 'a + p * 0.5', ''], DEFAULT_ATTR_NAMES);
check('feedback fragment: built for the representative set', fb !== null);
check('feedback fragment: matches the v1.99.0 pin',
  fb !== null && fb.length === 579 && strSha(fb) === '33bb67b660a5cf447508e3c59804eb7171e3456f69c7ab556356050073228f94',
  fb === null ? 'null' : `length=${fb.length} sha256=${strSha(fb)}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
