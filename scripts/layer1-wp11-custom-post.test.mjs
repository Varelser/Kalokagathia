#!/usr/bin/env node
// layer1-wp11-custom-post.test.mjs — Layer 1 WP11, phase D1:
// the custom post stage opening (decision (b) on the Unity §4
// post hand-off). The stored document (postCustomGlslCode, no
// new key) may author several custom stages separated by
// `// @stage <name>` directives, executed in document order at
// the one fixed anchor before 'output-grade'; a stage carrying
// `// @sample-input` is validated under the sampling contract
// (texture2D(tDiffuse, ...) read-only), every other stage
// keeps the Phase BX contract.
//
// Pins:
// (a) parse: a directive-free document is exactly one stage
//     whose code is the document byte for byte (legacy form);
// (b) parse: stages split at `// @stage` lines and keep
//     document order — reordering the blocks reorders the
//     stages; text before the first directive is stage 1;
//     blank chunks author no stage;
// (c) parse errors: a malformed @stage / @sample-input line,
//     duplicate stage names, more than the stage cap;
// (d) sampling opt-in is per stage: only the carrying stage
//     flips, neighbours keep the legacy contract;
// (e) validation scope: texture2D / texture( are rejected in
//     a legacy stage and accepted in a sampling stage; the
//     other prohibitions (uniform, #, void main, gl_FragColor)
//     still bind sampling stages; the per-stage length cap
//     applies per stage;
// (f) document validation: one invalid stage fails the whole
//     document and names the stage; a single-stage document
//     reports the bare Phase BX error text; a document of
//     only directives authors no stage and fails; an empty
//     document validates (legacy parity — callers gate on
//     non-empty);
// (g) byte identity: for a directive-free document the stage
//     fragment equals buildCustomPostGlslFragment(document)
//     and the stage harness equals the legacy harness; the
//     sampling harness additionally declares tDiffuse and the
//     legacy one does not;
// (h) stack: with the stage unused (default / disabled /
//     invalid / directive-only document) the ordered active
//     list has no 'custom-glsl-post'; with a valid multi-stage
//     document there is exactly ONE 'custom-glsl-post' entry,
//     still immediately before 'output-grade'; every profile
//     order still ends with the fixed tail
//     custom-glsl-post → output-grade → edge-capture →
//     chroma-key (built-in order untouched).
//
// Run: node scripts/layer1-wp11-custom-post.test.mjs

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

const P = await load('lib/customPostGlsl.ts');
const S = await load('lib/postFxStack.ts');
const D = await load('lib/appStateConfigDefaults.ts');

// ---- fixtures ---------------------------------------------------------------

const LEGACY = 'color = vec3(1.0) - color;';
const MULTI = [
  '// @stage warm',
  'color *= vec3(1.1, 1.0, 0.9);',
  '// @stage blur',
  '// @sample-input',
  'vec3 a = texture2D(tDiffuse, vUv + vec2(0.002, 0.0));',
  'color = mix(color, a, 0.5);',
  '// @stage',
  'color = pow(color, vec3(0.9));',
].join('\n');

// ---- (a) legacy parse ---------------------------------------------------------

{
  const parsed = P.parseCustomPostStages(LEGACY);
  check('a directive-free document parses', parsed.ok);
  check('a directive-free document is one stage', parsed.stages.length === 1);
  check('a the stage code is the document byte for byte', parsed.stages[0].code === LEGACY);
  check('a the stage is unlabelled and non-sampling', parsed.stages[0].name === null && parsed.stages[0].sampling === false);
  const withBlanks = `\n\n  ${LEGACY}\n`;
  const parsed2 = P.parseCustomPostStages(withBlanks);
  check('a surrounding blank lines stay part of the legacy code', parsed2.stages.length === 1 && parsed2.stages[0].code === withBlanks);
  check('a an empty document authors no stage', P.parseCustomPostStages('').stages.length === 0);
  check('a a whitespace-only document authors no stage', P.parseCustomPostStages('  \n ').stages.length === 0);
}

// ---- (b) multi-stage parse and order ------------------------------------------

{
  const parsed = P.parseCustomPostStages(MULTI);
  check('b the multi-stage document parses', parsed.ok);
  check('b it yields three stages', parsed.stages.length === 3);
  check('b stage order is document order', parsed.stages.map((s) => s.name).join(',') === 'warm,blur,');
  check('b indexes follow document order', parsed.stages.map((s) => s.index).join(',') === '0,1,2');
  check('b the first stage code excludes the directive line', parsed.stages[0].code === 'color *= vec3(1.1, 1.0, 0.9);');
  check('b an unlabelled separator starts an unlabelled stage', parsed.stages[2].name === null);

  const reordered = [
    '// @stage blur',
    '// @sample-input',
    'vec3 a = texture2D(tDiffuse, vUv + vec2(0.002, 0.0));',
    'color = mix(color, a, 0.5);',
    '// @stage warm',
    'color *= vec3(1.1, 1.0, 0.9);',
  ].join('\n');
  const parsedRe = P.parseCustomPostStages(reordered);
  check('b moving blocks moves execution order', parsedRe.stages.map((s) => s.name).join(',') === 'blur,warm');

  const leading = ['color += vec3(0.1);', '// @stage second', 'color *= 0.5;'].join('\n');
  const parsedLead = P.parseCustomPostStages(leading);
  check('b text before the first directive is the first stage',
    parsedLead.stages.length === 2 && parsedLead.stages[0].name === null && parsedLead.stages[0].code === 'color += vec3(0.1);');

  const blanks = ['// @stage a', '', '   ', '// @stage b', 'color *= 0.5;'].join('\n');
  const parsedBlanks = P.parseCustomPostStages(blanks);
  check('b a blank chunk authors no stage', parsedBlanks.stages.length === 1 && parsedBlanks.stages[0].name === 'b');

  const indented = ['   // @stage deep', 'color *= 0.5;'].join('\n');
  check('b an indented directive still separates', P.parseCustomPostStages(indented).stages.length === 1
    && P.parseCustomPostStages(indented).stages[0].name === 'deep');

  const prose = ['// this @stage is prose, not a directive', 'color *= 0.5;'].join('\n');
  const parsedProse = P.parseCustomPostStages(prose);
  check('b @stage inside prose is not a directive', parsedProse.ok && parsedProse.stages.length === 1 && parsedProse.stages[0].code === prose);
}

// ---- (c) parse errors -----------------------------------------------------------

{
  check('c a malformed @stage line is a parse error', !P.parseCustomPostStages('// @stage two names\ncolor *= 0.5;').ok);
  check('c a malformed @sample-input line is a parse error', !P.parseCustomPostStages('// @sample-input please\ncolor *= 0.5;').ok);
  const dup = ['// @stage a', 'color *= 0.5;', '// @stage a', 'color *= 0.6;'].join('\n');
  check('c duplicate stage names are rejected', !P.parseCustomPostStages(dup).ok);
  const many = Array.from({ length: P.CUSTOM_POST_MAX_STAGES + 1 }, (_, i) => `// @stage s${i}\ncolor *= 0.5;`).join('\n');
  check('c more than the stage cap is rejected', !P.parseCustomPostStages(many).ok);
  const atCap = Array.from({ length: P.CUSTOM_POST_MAX_STAGES }, (_, i) => `// @stage s${i}\ncolor *= 0.5;`).join('\n');
  check('c exactly the stage cap is accepted', P.parseCustomPostStages(atCap).stages.length === P.CUSTOM_POST_MAX_STAGES);
}

// ---- (d) per-stage sampling opt-in ----------------------------------------------

{
  const parsed = P.parseCustomPostStages(MULTI);
  check('d only the carrying stage opts into sampling',
    parsed.stages.map((s) => s.sampling).join(',') === 'false,true,false');
  const single = P.parseCustomPostStages(['// @sample-input', 'color = texture2D(tDiffuse, vUv).rgb;'].join('\n'));
  check('d a directive-free document can opt in as one sampling stage',
    single.stages.length === 1 && single.stages[0].sampling === true);
}

// ---- (e) validation scope ---------------------------------------------------------

{
  const samplingCode = 'color = texture2D(tDiffuse, vUv + vec2(0.001, 0.0)).rgb;';
  check('e texture2D is rejected under the legacy contract',
    !P.validateCustomPostGlslCode(samplingCode).ok);
  check('e the legacy rejection keeps the Phase BX reason text',
    P.validateCustomPostGlslCode(samplingCode).error === 'テクスチャのサンプリングはできません（入力は color として渡ります）');
  check('e texture2D is accepted under the sampling contract',
    P.validateCustomPostGlslCode(['// @sample-input', samplingCode].join('\n')).ok);
  check('e texture( is accepted under the sampling contract',
    P.validateCustomPostGlslCode(['// @sample-input', 'color = texture(tDiffuse, vUv).rgb;'].join('\n')).ok);
  check('e uniform declarations still bind sampling stages',
    !P.validateCustomPostGlslCode(['// @sample-input', 'uniform float uX;', samplingCode].join('\n')).ok);
  check('e the preprocessor still binds sampling stages',
    !P.validateCustomPostGlslCode(['// @sample-input', '#define X 1', samplingCode].join('\n')).ok);
  check('e void main still binds sampling stages',
    !P.validateCustomPostGlslCode(['// @sample-input', 'void main() {}'].join('\n')).ok);
  check('e gl_FragColor still binds sampling stages',
    !P.validateCustomPostGlslCode(['// @sample-input', 'gl_FragColor = vec4(1.0);'].join('\n')).ok);
  check('e the per-stage length cap binds a sampling stage',
    !P.validateCustomPostGlslCode(['// @sample-input', `color *= ${'1.0;'.repeat(1500)}`].join('\n')).ok);
  const twoLong = ['// @stage a', 'color *= 0.5;', '// @stage b', `color *= ${'1.0;'.repeat(1500)}`].join('\n');
  check('e the length cap applies per stage in a multi-stage document', !P.validateCustomPostGlslCode(twoLong).ok);
}

// ---- (f) document validation -------------------------------------------------------

{
  check('f the multi-stage fixture validates', P.validateCustomPostGlslCode(MULTI).ok);
  const badSecond = ['// @stage good', 'color *= 0.5;', '// @stage bad', 'uniform float uX;'].join('\n');
  const v = P.validateCustomPostGlslCode(badSecond);
  check('f one invalid stage fails the whole document', !v.ok);
  check('f the error names the failing stage', typeof v.error === 'string' && v.error.includes("'bad'"));
  check('f a directive-only document authors no stage and fails',
    !P.validateCustomPostGlslCode('// @stage a\n// @stage b').ok);
  check('f an empty document validates (legacy parity)', P.validateCustomPostGlslCode('').ok);
  check('f a whitespace-only document validates (legacy parity)', P.validateCustomPostGlslCode('  \n').ok);
  const single = P.validateCustomPostGlslCode('uniform float uX;');
  check('f a single-stage error carries no stage label',
    !single.ok && single.error === 'uniform は宣言できません（color / vUv / uTime / uResolution が使えます）');
  check('f the example snippet still validates', P.validateCustomPostGlslCode(P.CUSTOM_POST_GLSL_EXAMPLE).ok);
}

// ---- (g) byte identity and harnesses -------------------------------------------------

{
  const parsed = P.parseCustomPostStages(P.CUSTOM_POST_GLSL_EXAMPLE);
  check('g the example parses to one legacy stage', parsed.stages.length === 1 && parsed.stages[0].sampling === false);
  check('g the stage fragment is byte-identical to the legacy builder',
    P.buildCustomPostStageFragment(parsed.stages[0]) === P.buildCustomPostGlslFragment(P.CUSTOM_POST_GLSL_EXAMPLE));
  check('g the stage harness is byte-identical to the legacy harness',
    P.buildCustomPostStageHarness(parsed.stages[0]) === P.buildCustomPostGlslHarness(P.CUSTOM_POST_GLSL_EXAMPLE));
  const samplingStage = P.parseCustomPostStages(['// @sample-input', 'color = texture2D(tDiffuse, vUv).rgb;'].join('\n')).stages[0];
  check('g the sampling harness declares tDiffuse',
    P.buildCustomPostStageHarness(samplingStage).includes('uniform sampler2D tDiffuse;'));
  check('g the legacy harness does not declare tDiffuse',
    !P.buildCustomPostGlslHarness(LEGACY).includes('sampler2D'));
  check('g the sampling fragment still binds tDiffuse for the snippet',
    P.buildCustomPostStageFragment(samplingStage).includes('uniform sampler2D tDiffuse;'));
  check('g parse is deterministic', JSON.stringify(P.parseCustomPostStages(MULTI)) === JSON.stringify(P.parseCustomPostStages(MULTI)));
}

// ---- (h) stack behaviour ----------------------------------------------------------------

{
  const base = D.DEFAULT_CONFIG;
  const withCode = (over) => ({ ...base, postCustomGlslEnabled: true, postExposure: 2, ...over });
  check('h the default config has no custom post stage',
    !S.getOrderedActivePostFxStageIds(base).includes('custom-glsl-post'));
  check('h a disabled document inserts no stage',
    !S.getOrderedActivePostFxStageIds({ ...withCode({ postCustomGlslCode: MULTI }), postCustomGlslEnabled: false }).includes('custom-glsl-post'));
  check('h an invalid document inserts no stage',
    !S.getOrderedActivePostFxStageIds(withCode({ postCustomGlslCode: '// @stage a\nuniform float uX;' })).includes('custom-glsl-post'));
  check('h a directive-only document inserts no stage',
    !S.getOrderedActivePostFxStageIds(withCode({ postCustomGlslCode: '// @stage a' })).includes('custom-glsl-post'));
  const ordered = S.getOrderedActivePostFxStageIds(withCode({ postCustomGlslCode: MULTI }));
  check('h a multi-stage document inserts exactly one stack stage',
    ordered.filter((id) => id === 'custom-glsl-post').length === 1);
  check('h the custom stage still sits immediately before output-grade',
    ordered.indexOf('custom-glsl-post') === ordered.indexOf('output-grade') - 1);
  const legacyOrdered = S.getOrderedActivePostFxStageIds(withCode({ postCustomGlslCode: LEGACY }));
  check('h a legacy document inserts the stage as before',
    legacyOrdered.filter((id) => id === 'custom-glsl-post').length === 1);
  for (const profile of ['manual', 'touch-feedback', 'particular-glow', 'retro-feedback', 'dream-smear']) {
    const order = S.getPostFxProfileOrder(profile);
    const tail = order.slice(order.indexOf('custom-glsl-post'));
    check(`h the ${profile} profile tail is untouched`,
      tail.join(',') === 'custom-glsl-post,output-grade,edge-capture,chroma-key');
  }
}

console.log(`layer1-wp11-custom-post: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
