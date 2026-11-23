// Phase 18 stage 1 — attribute dataflow: chain stage, ext
// slots 4..7, sim-quantity expression variables.
//
// Numeric checks are hand-computed against a fixed synthetic
// particle set (texSize 2, no RNG):
//
//   i=0: pos (3,0,0) age 4, vel (0.3,0.4,0) -> vel .5, age .5, rad 1
//   i=1: pos (0,0,0) age 0, vel (3,4,0)     -> vel 5,  age 0,  rad 0
//   i=2: pos (1.5,0,0) age 8, vel (3,4,0)   -> vel 5,  age 1,  rad .5
//   i=3: pos (0,3,0) age 2, vel (0,0,0)     -> vel 0,  age .25, rad 1
// (ageMax 8, bounceRadius 3; age = age/8 clamped, rad =
// length(pos)/3 clamped, vel = raw length, unclamped.)
//
// The chain stage is a GPU pass, so its numeric check runs
// the CPU twin: the same compiled ASTs evaluated through
// evaluateCompiledExpressionWithVars under the environment
// the fragment builder documents (x = stage-1 value, slot
// names sequential, ext names from the ext bake, sim vars
// from attrSimValues). The fragment itself is checked
// structurally (conditional emission, sequential locals).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18s1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b) => Math.abs(a - b) <= 1e-6;

await build({
  stdin: {
    contents: `
      export {
        buildAttributeData, buildAttributeDataExt, attrSimValues,
        resolveAttrExtConsumers, attrExprsReferenceExtSlot, attrExprsReferenceSimVar,
        DEFAULT_ATTR_NAMES, DEFAULT_ATTR_SOURCES,
      } from './lib/gpgpuAttributes.ts';
      export { buildAttrDynFragment } from './lib/expressionGlsl.ts';
      export { buildAttrFeedbackFragment } from './lib/expressionGlslFeedback.ts';
      export { buildAttrChainFragment } from './lib/expressionGlslChain.ts';
      export { compileExpression, evaluateCompiledExpressionWithVars } from './lib/expression.ts';
      export { POINT_CACHE_MAX_ATTRIBUTE_COLUMNS, parsePointCacheManifest } from './lib/pointCache.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildAttributeData, buildAttributeDataExt, attrSimValues,
  resolveAttrExtConsumers, attrExprsReferenceExtSlot, attrExprsReferenceSimVar,
  DEFAULT_ATTR_NAMES,
} = lib;

const texSize = 2;
const posData = new Float32Array([
  3, 0, 0, 4,
  0, 0, 0, 0,
  1.5, 0, 0, 8,
  0, 3, 0, 2,
]);
const velData = new Float32Array([
  0.3, 0.4, 0, 0,
  3, 4, 0, 0,
  3, 4, 0, 0,
  0, 0, 0, 0,
]);
const baseArgs = {
  texSize, posData, velData, ageMax: 8, bounceRadius: 3, speciesCount: 4,
  names: [...DEFAULT_ATTR_NAMES], sources: ['hash', 'species', 'radius', 'height'],
};

// --- attrSimValues: the CPU twin, hand-computed ---
{
  const s0 = attrSimValues(3, 0, 0, 4, 0.3, 0.4, 0, 8, 3);
  check('sim values texel0: vel .5 / age .5 / rad 1',
    near(s0.vel, 0.5) && near(s0.age, 0.5) && near(s0.rad, 1), JSON.stringify(s0));
  const s1 = attrSimValues(0, 0, 0, 0, 3, 4, 0, 8, 3);
  check('sim values texel1: vel is RAW (5, unclamped), age 0, rad 0',
    near(s1.vel, 5) && near(s1.age, 0) && near(s1.rad, 0), JSON.stringify(s1));
}

// --- (3) sim variables at bake time ---
{
  const exprs = ['vel', 'age', 'rad', 'vel * 0.1 + age * 0.2 + rad * 0.3'];
  const out = buildAttributeData({ ...baseArgs, exprs });
  const expected = [
    [0.5, 0.5, 1, 0.45],
    [1, 0, 0, 0.5],
    [1, 1, 0.5, 0.85],
    [0, 0.25, 1, 0.35],
  ];
  let ok = true;
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 4; s++) {
      if (!near(out[i * 4 + s], expected[i][s])) ok = false;
    }
  }
  check('bake sim vars: vel/age/rad read the initial state (hand-computed)',
    ok, `got ${JSON.stringify(Array.from(out))}`);
  // Cross-check against the equivalent bake-time sources:
  // 'age' expr == 'age' source, 'rad' expr == 'radius' source.
  const bySource = buildAttributeData({ ...baseArgs, sources: ['age', 'radius', 'hash', 'hash'], exprs: ['', '', '', ''] });
  const byExpr = buildAttributeData({ ...baseArgs, exprs: ['age', 'rad', '', ''] });
  let cross = true;
  for (let i = 0; i < 4; i++) {
    if (!near(byExpr[i * 4], bySource[i * 4])) cross = false;
    if (!near(byExpr[i * 4 + 1], bySource[i * 4 + 1])) cross = false;
  }
  check('bake sim vars: age/rad expressions match the age/radius sources', cross);
  // velData absent -> vel reads 0.
  const noVel = buildAttributeData({ ...baseArgs, velData: null, exprs: ['vel', '', '', ''] });
  check('bake sim vars: vel falls back to 0 without velocity data',
    [0, 1, 2, 3].every((i) => near(noVel[i * 4], 0)));
}

// --- (2) ext bake: slots 4..7, cross-stage + sequential reads ---
{
  // Stage 1: slot a = index (0, 1/3, 2/3, 1), no expressions.
  const firstBake = buildAttributeData({
    ...baseArgs, sources: ['index', 'hash', 'hash', 'hash'], exprs: ['', '', '', ''],
  });
  const ext = buildAttributeDataExt({
    texSize, posData, velData, ageMax: 8, bounceRadius: 3, speciesCount: 4,
    firstBake,
    names: [...DEFAULT_ATTR_NAMES],
    names2: ['i', 'j', 'k', 'l'],
    sources2: ['radius', 'index', 'age', 'height'],
    exprs2: ['a * 0.5', 'i + x', 'vel * 0.1', ''],
  });
  check('ext bake: output size is texels x 4', ext.length === 16, `length=${ext.length}`);
  // i = a * .5 (reads the STAGE-1 output); j = i + x (i is the
  // processed ext value, x is j's own source = index);
  // k = vel * .1 (sim var); l = height source verbatim.
  const expected = [
    [0, 0, 0.05, 0.5],
    [1 / 6, 0.5, 0.5, 0.5],
    [1 / 3, 1, 0.5, 0.5],
    [0.5, 1, 0, 1],
  ];
  let ok = true;
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 4; s++) {
      if (!near(ext[i * 4 + s], expected[i][s])) ok = false;
    }
  }
  check('ext bake: cross-stage (a), sequential (i), sim (vel) reads all hand-match',
    ok, `got ${JSON.stringify(Array.from(ext))}`);
  // All ext expressions empty -> sources verbatim.
  const extPlain = buildAttributeDataExt({
    texSize, posData, velData, ageMax: 8, bounceRadius: 3, speciesCount: 4,
    firstBake, names: [...DEFAULT_ATTR_NAMES], names2: ['i', 'j', 'k', 'l'],
    sources2: ['radius', 'index', 'age', 'height'], exprs2: ['', '', '', ''],
  });
  check('ext bake: empty expressions keep the sources (radius/index/age/height)',
    near(extPlain[0], 1) && near(extPlain[1], 0) && near(extPlain[2], 0.5) && near(extPlain[3], 0.5)
    && near(extPlain[12], 1) && near(extPlain[15], 1),
    `got ${JSON.stringify(Array.from(extPlain))}`);
}

// --- (1) chain stage: null discipline + structure ---
{
  const names = [...DEFAULT_ATTR_NAMES];
  const names2 = ['i', 'j', 'k', 'l'];
  check('chain fragment: null when every expression is empty',
    lib.buildAttrChainFragment(['', '', '', ''], names, names2) === null);
  check('chain fragment: null when nothing compiles',
    lib.buildAttrChainFragment(['nosuchvar + 1', '', '', ''], names, names2) === null);
  const plain = lib.buildAttrChainFragment(['x * 0.5', '', '', ''], names, names2);
  check('chain fragment: plain set emits no sim / ext sampling',
    plain !== null && !plain.includes('uPosTex') && !plain.includes('uSrc2'),
    plain === null ? 'null' : 'extra uniforms present');
  const full = lib.buildAttrChainFragment(['x * 0.5', 'a + i * 0.25', 'vel * 0.1', ''], names, names2);
  check('chain fragment: ext read emits uSrc2 + w-local',
    full !== null && full.includes('uniform sampler2D uSrc2;') && full.includes('w0'),
    full === null ? 'null' : 'missing uSrc2/w0');
  check('chain fragment: sim read emits uVelTex + simVelMag',
    full !== null && full.includes('uniform sampler2D uVelTex;') && full.includes('simVelMag'),
    full === null ? 'null' : 'missing sim lines');
  check('chain fragment: slot 2 block reads slot 1 result (v0) sequentially',
    full !== null && /float r = \(\(v0\) \+ \(\(\(w0\) \* \(0\.25\)\)\)\)/.test(full),
    full === null ? 'null' : 'sequential local not found');
}

// --- (1) chain stage: CPU-twin numeric evaluation ---
{
  // Stage-1 texel [0.8, 0.2, 0.4, 1.0], ext texel i = 0.6,
  // particle i=0 of the synthetic set (vel .5, age .5, rad 1).
  const chainExprs = ['x * 0.5', 'a + i * 0.25', 'vel * 0.1', ''];
  const names = [...DEFAULT_ATTR_NAMES];
  const names2 = ['i', 'j', 'k', 'l'];
  const stage1 = [0.8, 0.2, 0.4, 1.0];
  const ext = [0.6, 0, 0, 0];
  const sim = attrSimValues(3, 0, 0, 4, 0.3, 0.4, 0, 8, 3);
  const values = [...stage1];
  const lowerAll = [...names, ...names2].map((n) => n.toLowerCase());
  for (let slot = 0; slot < 4; slot++) {
    const expr = chainExprs[slot];
    if (!expr) continue;
    const compiled = lib.compileExpression(expr, [...lowerAll, 'vel', 'age', 'rad']);
    if (!compiled.ok) continue;
    const vars = { x: stage1[slot], t: 0, vel: sim.vel, age: sim.age, rad: sim.rad };
    for (let k = 0; k < 8; k++) {
      const key = lowerAll[k];
      if (!(key in vars)) vars[key] = k < 4 ? values[k] : ext[k - 4];
    }
    const result = lib.evaluateCompiledExpressionWithVars(compiled.ast, vars);
    values[slot] = Math.min(1, Math.max(0, result));
  }
  check('chain twin: [x*.5, a+i*.25, vel*.1, -] over stage-1 [0.8,0.2,0.4,1] = [0.4, 0.55, 0.05, 1]',
    near(values[0], 0.4) && near(values[1], 0.55) && near(values[2], 0.05) && near(values[3], 1),
    `got ${JSON.stringify(values)}`);
}

// --- (3) dyn / feedback fragments: conditional sim + ext emission ---
{
  const names = [...DEFAULT_ATTR_NAMES];
  const names2 = ['i', 'j', 'k', 'l'];
  const dynSim = lib.buildAttrDynFragment(['vel * 0.1', '', '', ''], names, names2);
  check('dyn fragment: sim expression emits the sim sampling lines',
    dynSim !== null && dynSim.includes('uniform sampler2D uVelTex;') && dynSim.includes('simVelMag'),
    dynSim === null ? 'null' : 'missing');
  const dynPlain = lib.buildAttrDynFragment(['a * 2', '', '', ''], names, names2);
  check('dyn fragment: no sim / ext lines when unreferenced (names2 supplied)',
    dynPlain !== null && !dynPlain.includes('uPosTex') && !dynPlain.includes('uSrc2'),
    dynPlain === null ? 'null' : 'extra uniforms present');
  const dynExt = lib.buildAttrDynFragment(['i + x', '', '', ''], names, names2);
  check('dyn fragment: ext expression emits uSrc2 + w0',
    dynExt !== null && dynExt.includes('uniform sampler2D uSrc2;') && dynExt.includes('(w0)'),
    dynExt === null ? 'null' : 'missing');
  const dynNoExtNames = lib.buildAttrDynFragment(['i + x', '', '', ''], names);
  check('dyn fragment: ext name unresolved without ext names (slot keeps bake)',
    dynNoExtNames === null, 'expected null (expression cannot compile)');
  const fb = lib.buildAttrFeedbackFragment(['p * 0.9 + vel * 0.05', '', '', ''], names, names2);
  check('feedback fragment: p + sim expression builds with prev + sim lines',
    fb !== null && fb.includes('prev.r') && fb.includes('simVelMag'),
    fb === null ? 'null' : 'missing');
}

// --- reference scans + ext consumer resolution ---
{
  const names = [...DEFAULT_ATTR_NAMES];
  const names2 = ['i', 'j', 'k', 'l'];
  check('scan: ext reference detected', attrExprsReferenceExtSlot(['i * 2', '', '', ''], names, names2) === true);
  check('scan: first-set-only reference is not ext', attrExprsReferenceExtSlot(['a * 2', '', '', ''], names, names2) === false);
  check('scan: first-set slot named i shadows the ext slot',
    attrExprsReferenceExtSlot(['i * 2', '', '', ''], ['i', 'b', 'c', 'd'], names2) === false);
  check('scan: sim reference detected', attrExprsReferenceSimVar(['vel + a', '', '', ''], names, names2) === true);
  check('scan: no sim reference in plain set', attrExprsReferenceSimVar(['a + b', '', '', ''], names, names2) === false);
  check('scan: slot named vel still resolves to the sim variable',
    attrExprsReferenceSimVar(['vel', '', '', ''], ['vel', 'b', 'c', 'd'], names2) === true);

  const base = {
    gpgpuAttrDynEnabled: false, gpgpuAttrFeedbackEnabled: false, gpgpuAttrChainEnabled: false,
    gpgpuAttrExprs: ['', '', '', ''], gpgpuAttrChainExprs: ['', '', '', ''],
    gpgpuAttrNames: names, gpgpuAttrNames2: names2,
  };
  check('ext consumers: none at the defaults', resolveAttrExtConsumers(base) === false);
  check('ext consumers: dyn reading i builds the texture',
    resolveAttrExtConsumers({ ...base, gpgpuAttrDynEnabled: true, gpgpuAttrExprs: ['i * 2', '', '', ''] }) === true);
  check('ext consumers: dyn without ext reference does not',
    resolveAttrExtConsumers({ ...base, gpgpuAttrDynEnabled: true, gpgpuAttrExprs: ['a * 2', '', '', ''] }) === false);
  check('ext consumers: disabled dyn does not',
    resolveAttrExtConsumers({ ...base, gpgpuAttrExprs: ['i * 2', '', '', ''] }) === false);
  check('ext consumers: chain reading l builds the texture',
    resolveAttrExtConsumers({ ...base, gpgpuAttrChainEnabled: true, gpgpuAttrChainExprs: ['', '', '', 'l'] }) === true);
}

// --- (2) point cache: the column cap follows the consumer side ---
{
  check('point cache: attribute column cap is 8', lib.POINT_CACHE_MAX_ATTRIBUTE_COLUMNS === 8,
    `cap=${lib.POINT_CACHE_MAX_ATTRIBUTE_COLUMNS}`);
  const manifest = {
    format: 'pointcache-manifest-v2', version: 2, count: 4, frameCount: 1, fps: 24,
    attributes: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `attr${n}`, type: 'float', perFrame: false })),
    files: ['frame_0000.ply'],
  };
  const parsed = lib.parsePointCacheManifest(JSON.stringify(manifest));
  check('point cache: a 6-column manifest is accepted', 'manifest' in parsed,
    'error' in parsed ? parsed.error : '');
  const tooMany = {
    ...manifest,
    attributes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ name: `attr${n}`, type: 'float', perFrame: false })),
  };
  const refused = lib.parsePointCacheManifest(JSON.stringify(tooMany));
  check('point cache: a 9-column manifest is refused with the cap named',
    'error' in refused && refused.error.includes('8'),
    'error' in refused ? refused.error : 'accepted');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
