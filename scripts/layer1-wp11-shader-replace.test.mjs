#!/usr/bin/env node
// layer1-wp11-shader-replace.test.mjs — Layer 1 WP11, phase D2:
// full-fragment replacement slots at the three terminal
// drawing points (WP11 phase-D material, branch 2, option
// (b)). The shared contract kind lives in lib/glslInjection.ts;
// the three slots live in lib/glslReplacementPoints.ts,
// derived from each point's existing snippet contract.
//
// Pins:
// (a) registry: exactly the three terminal points carry a
//     replacement contract (custom-glsl-post,
//     particle-points-fragment, volume-fog-fragment); the
//     GEOM points, the particle points vertex point and the
//     custom force carry none; all seven snippet contracts
//     stay registered alongside;
// (b) derivation: each replacement contract's stage, backends
//     and length cap equal its point's snippet contract's;
// (c) validation — the output form: a missing main or a
//     missing gl_FragColor write is rejected; the shared base
//     list rejects preprocessor marks and any redeclaration
//     tokens; the length cap (the point's own) applies;
// (d) validation — per-point rules: sampling is allowed only
//     at the post slot (its declared texture input); sampling
//     and discard stay rejected at the points / fog slots;
//     each slot's own example passes its validation;
// (e) assembly: harness and production fragment are the same
//     assembly (host declarations + the code, whole), so the
//     compile check sees what will actually run;
// (f) byte identity of the untouched snippet paths: the three
//     points' snippet-side builders and fragment builder
//     produce exactly the strings they produced before this
//     phase, and the snippet validators still reject
//     replacement-style code (the two forms stay separate);
// (g) status stores: one per slot, starting inactive, carrying
//     the shared notify shape.
//
// Run: node scripts/layer1-wp11-shader-replace.test.mjs

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

// One bundle for everything: the registries live in module
// state, so the point modules and the base must share a single
// bundle instance (the stdin re-export pattern the other
// multi-module tests use).
const out = await build({
  stdin: {
    contents: `
      export * from './lib/glslInjection.ts';
      export * from './lib/glslReplacementPoints.ts';
      export * from './lib/customPostGlsl.ts';
      export * from './lib/particlePointsFragmentGlsl.ts';
      export * from './lib/volumeFogGlsl.ts';
      export * from './lib/geomCustomGlsl.ts';
      export * from './lib/particlePointsVertexGlsl.ts';
      export * from './lib/gpgpuCustomForce.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, logLevel: 'silent',
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const I = M;
const R = M;
const POST = M;
const PF = M;
const FOG = M;

const TARGETS = ['custom-glsl-post', 'particle-points-fragment', 'volume-fog-fragment'];
const NON_TARGETS = ['geom-custom-vertex', 'geom-custom-fragment', 'particle-points-vertex', 'gpgpu-custom-force'];

// ---- (a) registry -----------------------------------------------------------

const replacementIds = I.listGlslReplacements().map((c) => c.pointId);
check('a exactly the three terminal points carry a replacement',
  JSON.stringify(replacementIds) === JSON.stringify(TARGETS));
for (const id of TARGETS) {
  check(`a getGlslReplacement('${id}') is registered`, I.getGlslReplacement(id) !== undefined);
}
for (const id of NON_TARGETS) {
  check(`a getGlslReplacement('${id}') is undefined (not opened)`, I.getGlslReplacement(id) === undefined);
}
const snippetIds = I.listGlslInjections().map((c) => c.id);
for (const id of [...TARGETS, ...NON_TARGETS]) {
  check(`a snippet contract '${id}' stays registered`, snippetIds.includes(id));
}

// ---- (b) derivation ---------------------------------------------------------

const pairs = [
  ['custom-glsl-post', POST.CUSTOM_POST_GLSL_CONTRACT, R.POST_GLSL_REPLACEMENT_CONTRACT],
  ['particle-points-fragment', PF.PARTICLE_POINTS_FRAGMENT_GLSL_CONTRACT, R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_CONTRACT],
  ['volume-fog-fragment', FOG.VOLUME_FOG_GLSL_CONTRACT, R.VOLUME_FOG_REPLACEMENT_CONTRACT],
];
for (const [id, snippet, replacement] of pairs) {
  check(`b ${id}: stage derived from the snippet contract`, replacement.stage === snippet.stage);
  check(`b ${id}: backends derived from the snippet contract`,
    JSON.stringify(replacement.backends) === JSON.stringify(snippet.backends));
  check(`b ${id}: length cap derived from the snippet contract`, replacement.maxLength === snippet.maxLength);
  check(`b ${id}: pointId is the point's id`, replacement.pointId === snippet.id);
}

// ---- (c) validation — the output form and the shared base list --------------

const minimal = 'void main() { gl_FragColor = vec4(1.0); }';
for (const [, , replacement] of pairs) {
  check(`c ${replacement.pointId}: a minimal whole fragment passes`,
    I.validateGlslReplacementCode(minimal, replacement).ok === true);
  check(`c ${replacement.pointId}: a missing main is rejected`,
    I.validateGlslReplacementCode('gl_FragColor = vec4(1.0);', replacement).ok === false);
  check(`c ${replacement.pointId}: a missing gl_FragColor write is rejected`,
    I.validateGlslReplacementCode('void main() { }', replacement).ok === false);
  check(`c ${replacement.pointId}: a preprocessor mark is rejected`,
    I.validateGlslReplacementCode('#version 300 es\n' + minimal, replacement).ok === false);
  check(`c ${replacement.pointId}: redeclaring a supplied uniform is rejected`,
    I.validateGlslReplacementCode('uniform float uTime;\n' + minimal, replacement).ok === false);
  check(`c ${replacement.pointId}: redeclaring a supplied varying is rejected`,
    I.validateGlslReplacementCode('varying vec2 vUv;\n' + minimal, replacement).ok === false);
  check(`c ${replacement.pointId}: a precision statement is rejected`,
    I.validateGlslReplacementCode('precision highp float;\n' + minimal, replacement).ok === false);
  const tooLong = minimal + '\n// ' + 'x'.repeat(replacement.maxLength);
  check(`c ${replacement.pointId}: code past the length cap is rejected`,
    I.validateGlslReplacementCode(tooLong, replacement).ok === false);
}

// ---- (d) validation — per-point rules and the examples ----------------------

check('d the post example passes its own validation',
  R.validatePostGlslReplacementCode(R.POST_GLSL_REPLACEMENT_EXAMPLE).ok === true);
check('d the points example passes its own validation',
  R.validateParticlePointsFragmentReplacementCode(R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_EXAMPLE).ok === true);
check('d the fog example passes its own validation',
  R.validateVolumeFogReplacementCode(R.VOLUME_FOG_REPLACEMENT_EXAMPLE).ok === true);

const sampling = 'void main() { gl_FragColor = texture2D(tDiffuse, vUv); }';
check('d sampling is allowed at the post slot (declared texture input)',
  R.validatePostGlslReplacementCode(sampling).ok === true);
check('d sampling is rejected at the points slot',
  R.validateParticlePointsFragmentReplacementCode(sampling).ok === false);
check('d sampling is rejected at the fog slot',
  R.validateVolumeFogReplacementCode(sampling).ok === false);
const discarding = 'void main() { if (vUv.x < 0.1) discard; gl_FragColor = vec4(1.0); }';
check('d discard is rejected at the points slot',
  R.validateParticlePointsFragmentReplacementCode(discarding).ok === false);
check('d discard is rejected at the fog slot',
  R.validateVolumeFogReplacementCode(discarding).ok === false);

// ---- (e) assembly -----------------------------------------------------------

for (const [, , replacement] of pairs) {
  const code = 'void main() { gl_FragColor = vec4(0.5); }';
  check(`e ${replacement.pointId}: harness and fragment are the same assembly`,
    replacement.buildHarness(code) === replacement.buildFragment(code));
  check(`e ${replacement.pointId}: the assembly is declarations + the code, whole`,
    replacement.buildFragment(code) === `${replacement.declarations}\n\n${code}\n`);
  check(`e ${replacement.pointId}: the code appears verbatim in the assembly`,
    replacement.buildFragment(code).includes(code));
}
check('e the post declarations carry the frame texture and the lock toggle',
  R.POST_GLSL_REPLACEMENT_DECLARATIONS.includes('uniform sampler2D tDiffuse;')
  && R.POST_GLSL_REPLACEMENT_DECLARATIONS.includes('uniform float uLumaLock;')
  && R.POST_GLSL_REPLACEMENT_DECLARATIONS.includes('varying vec2 vUv;'));
check('e the points declarations carry only the contract interface',
  R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_DECLARATIONS.includes('varying float vLife;')
  && !R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_DECLARATIONS.includes('uSdf')
  && !R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_DECLARATIONS.includes('sampler'));
check('e the fog declarations carry the slice varying',
  R.VOLUME_FOG_REPLACEMENT_DECLARATIONS.includes('varying float vSlice;')
  && !R.VOLUME_FOG_REPLACEMENT_DECLARATIONS.includes('uSliceIndex'));

// ---- (f) byte identity of the untouched snippet paths -----------------------

const snippetProbe = 'color = vec3(1.0);';
check('f the post fragment builder is byte-identical', POST.buildCustomPostGlslFragment(snippetProbe) === `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uLumaLock;
varying vec2 vUv;

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  {
${snippetProbe}
  }
  if (uLumaLock > 0.5) {
    color = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
  }
  gl_FragColor = vec4(color, 1.0);
}
`);
check('f the post harness builder is byte-identical', POST.buildCustomPostGlslHarness(snippetProbe) === `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  void main() {
    vec2 vUv = vec2(0.5);
    vec3 color = vec3(0.0);
    {
${snippetProbe}
    }
    gl_FragColor = vec4(color, 1.0);
  }
`);
const pointsProbe = 'color = vec4(1.0);';
check('f the points harness builder is byte-identical', PF.buildParticlePointsFragmentHarness(pointsProbe) === `
  precision highp float;
  uniform float uTime;
  void main() {
    vec2 vUv = vec2(0.5);
    float vLife = 0.0;
    float vVelocity = 0.0;
    float vAlpha = 1.0;
    vec3 finalColor = vec3(0.0);
    float alpha = 1.0;
    { // particle points fragment (user GLSL)
    vec4 color = vec4(finalColor, alpha);
${pointsProbe}
    finalColor = color.rgb;
    alpha = color.a;
    }
    gl_FragColor = vec4(finalColor, alpha);
  }
`);
const fogProbe = 'alpha = 0.5;';
check('f the fog harness builder is byte-identical', FOG.buildVolumeFogHarness(fogProbe) === `
  precision highp float;
  uniform float uTime;
  void main() {
    vec2 vUv = vec2(0.5);
    float vSlice = 0.0;
    float alpha = 0.5;
    { // volume fog fragment (user GLSL)
${fogProbe}
    }
    gl_FragColor = vec4(vec3(0.0), alpha);
  }
`);
check('f the snippet validators still accept the snippet examples',
  POST.validateCustomPostGlslCode(POST.CUSTOM_POST_GLSL_EXAMPLE).ok === true
  && PF.validateParticlePointsFragmentGlslCode(PF.PARTICLE_POINTS_FRAGMENT_GLSL_EXAMPLE).ok === true
  && FOG.validateVolumeFogGlslCode(FOG.VOLUME_FOG_GLSL_EXAMPLE).ok === true);
check('f the snippet validators still reject replacement-style code (forms stay separate)',
  POST.validateCustomPostGlslCode(R.POST_GLSL_REPLACEMENT_EXAMPLE).ok === false
  && PF.validateParticlePointsFragmentGlslCode(R.PARTICLE_POINTS_FRAGMENT_REPLACEMENT_EXAMPLE).ok === false
  && FOG.validateVolumeFogGlslCode(R.VOLUME_FOG_REPLACEMENT_EXAMPLE).ok === false);

// ---- (g) status stores ------------------------------------------------------

check('g the post replacement status starts inactive',
  R.getPostGlslReplacementStatus().state === 'inactive');
R.setPostGlslReplacementStatus({ state: 'error', message: 'probe' });
check('g the post replacement status carries an error outcome',
  R.getPostGlslReplacementStatus().state === 'error'
  && R.getPostGlslReplacementStatus().message === 'probe');
R.setPostGlslReplacementStatus({ state: 'inactive' });
check('g the points and fog replacement statuses start inactive',
  R.getParticlePointsFragmentReplacementStatus().state === 'inactive'
  && R.getVolumeFogReplacementStatus().state === 'inactive');

// ---------------------------------------------------------------------------

console.log(`layer1-wp11-shader-replace: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('ALL PASS');
