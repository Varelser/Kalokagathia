// Phase 22 stage 1 — density expression reference (`den`).
//
// Hand-computed density cases (texSize 4, 16 particles):
// positions are all far away (world x = 100) except:
//   i=0  world (0,0,0)    uv (0.125,0.125)
//   i=3  world (1,0,0)    uv (0.875,0.125)
//   i=15 world (0.5,0,0)  uv (0.875,0.875)
//   i=6  world (100,0,0)  uv (0.625,0.375) — isolated
// With radius 2 the SPH kernel w = 1 - q^2 gives, per sample:
//   dist 1.0 -> w 0.75; dist 0.5 -> w 0.9375.
// The sample plan strides 256 samples over 16 texels, so every
// texel is sampled exactly 16 times. For i=0 the in-radius,
// non-skipped samples are j=3 (0.75) and j=15 (0.9375):
// density = 16 * (0.75 + 0.9375) = 27. With restDensity 30,
// den = 27 / 30 = 0.9. i=3 is symmetric (also 0.9); i=6 has no
// neighbour within radius -> den = 0.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p22s1-bundle-${process.pid}.mjs`);
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
        buildAttributeData, attrExprsReferenceDensity, resolveAttrNameSlot,
        DEFAULT_ATTR_NAMES,
      } from './lib/gpgpuAttributes.ts';
      export { densityNormalised, buildDensityFragment, DENSITY_SAMPLES } from './lib/gpgpuDensity.ts';
      export { buildAttrDynFragment } from './lib/expressionGlsl.ts';
      export { buildAttrFeedbackFragment } from './lib/expressionGlslFeedback.ts';
      export { buildAttrChainFragment } from './lib/expressionGlslChain.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildAttributeData, attrExprsReferenceDensity, resolveAttrNameSlot,
  DEFAULT_ATTR_NAMES, densityNormalised, buildDensityFragment, DENSITY_SAMPLES,
} = lib;
const { buildAttrDynFragment, buildAttrFeedbackFragment, buildAttrChainFragment } = lib;

const texSize = 4;
const posData = new Float32Array(16 * 4);
for (let i = 0; i < 16; i++) {
  posData[i * 4] = 100; posData[i * 4 + 1] = 0; posData[i * 4 + 2] = 0; posData[i * 4 + 3] = 0;
}
posData[0] = 0; posData[1] = 0; posData[2] = 0;
posData[3 * 4] = 1;
posData[15 * 4] = 0.5;

// --- CPU twin, hand-computed ---
check('samples constant is 256', DENSITY_SAMPLES === 256);
check('den(i=0) = 0.9', near(densityNormalised(posData, texSize, 0, 2, 30), 0.9),
  String(densityNormalised(posData, texSize, 0, 2, 30)));
check('den(i=3) = 0.9', near(densityNormalised(posData, texSize, 3, 2, 30), 0.9));
check('den(i=6) = 0 (isolated)', densityNormalised(posData, texSize, 6, 2, 30) === 0);
check('den saturates at 1 with rest 1', densityNormalised(posData, texSize, 0, 2, 1) === 1);
check('den = 0 when radius excludes all', densityNormalised(posData, texSize, 0, 0.1, 30) === 0);

// --- GLSL twin structure ---
const denFrag = buildDensityFragment();
check('density fragment has the 256 loop', denFrag.includes('k < 256'));
check('density fragment writes normalised den',
  denFrag.includes('clamp(density / max(uRestDensity, 0.0001), 0.0, 1.0)'));

// --- Bake integration: expression `den` reads the twin ---
const bakeArgs = {
  texSize, posData, velData: null, ageMax: 8, bounceRadius: 3, speciesCount: 4,
  sphRadius: 2, sphRestDensity: 30,
  names: [...DEFAULT_ATTR_NAMES], sources: ['hash', 'hash', 'hash', 'hash'],
};
const baked = buildAttributeData({ ...bakeArgs, exprs: ['den', '', '', ''] });
check('bake slot0 of i=0 is den 0.9', near(baked[0], 0.9), String(baked[0]));
check('bake slot0 of i=6 is den 0', baked[6 * 4] === 0);
const bakedNoExpr = buildAttributeData({ ...bakeArgs, exprs: ['', '', '', ''] });
check('bake without den differs (expr actually applied)', baked[0] !== bakedNoExpr[0]);

// --- Reserved name: a slot named `den` cannot shadow it ---
check('resolveAttrNameSlot(den) is -1', resolveAttrNameSlot('den', ['den', 'b', 'c', 'd'], []) === -1);
check('attrExprsReferenceDensity detects den',
  attrExprsReferenceDensity(['den * 2'], [...DEFAULT_ATTR_NAMES], []) === true);
check('attrExprsReferenceDensity rejects x-only',
  attrExprsReferenceDensity(['x * 2'], [...DEFAULT_ATTR_NAMES], []) === false);

// --- Conditional emission in the three GPU builders ---
const names = [...DEFAULT_ATTR_NAMES];
const dynDen = buildAttrDynFragment(['den', '', '', ''], names);
check('dyn fragment with den declares uDenTex', dynDen !== null && dynDen.includes('uniform sampler2D uDenTex;'));
check('dyn fragment with den samples simDen', dynDen !== null && dynDen.includes('float simDen = texture2D(uDenTex, vUv).r;'));
check('dyn fragment with den only has no sim lines', dynDen !== null && !dynDen.includes('uPosTex'));
const dynPlain = buildAttrDynFragment(['x', '', '', ''], names);
check('dyn fragment without den has no uDenTex', dynPlain !== null && !dynPlain.includes('uDenTex') && !dynPlain.includes('simDen'));
const dynVel = buildAttrDynFragment(['vel', '', '', ''], names);
check('dyn fragment with vel only has no uDenTex', dynVel !== null && dynVel.includes('uPosTex') && !dynVel.includes('uDenTex'));
const chainDen = buildAttrChainFragment(['den', '', '', ''], names);
check('chain fragment with den declares uDenTex', chainDen !== null && chainDen.includes('uniform sampler2D uDenTex;'));
const fbDen = buildAttrFeedbackFragment(['p * den', '', '', ''], names);
check('feedback fragment with p*den declares uDenTex', fbDen !== null && fbDen.includes('uniform sampler2D uDenTex;'));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
