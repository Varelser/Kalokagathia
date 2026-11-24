// Phase 22 stage 3 — IBL stage 2: the GEOM IBL triplet ported
// to the layer particles' sphere branch (§5 design).
//
// Identity discipline under test:
//   - Both builders with ibl=false and no custom code return
//     the stock shader strings VERBATIM (same content).
//   - The IBL variants add exactly the documented pieces:
//     fragment uniforms + shared helper chunk + sphere-branch
//     term; vertex varying + centre world position.
//   - Custom GLSL still splices into the IBL variants (the two
//     features compose), and the helper functions exist exactly
//     once in each assembled shader (no duplicate definitions
//     from the shared chunk).
//   - The GEOM fragment still assembles from the shared chunk
//     (the phase18 hash pins its bytes separately).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p22s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const count = (hay, needle) => hay.split(needle).length - 1;

await build({
  stdin: {
    contents: `
      export { FRAGMENT_SHADER, buildParticleFragmentShader, buildParticleFragmentIblVariant } from './components/sceneShaderParticlePointFragment.ts';
      export { PARTICLE_VERTEX_SHADER, buildParticleVertexShader, buildParticleVertexIblVariant } from './components/sceneShaderParticlePointVertex.ts';
      export { IBL_GLSL_HELPERS } from './lib/iblGlsl.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  // The vertex shader's physics-logic import chain reaches app
  // modules that read this vite define; supply the private
  // default the app build uses.
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  FRAGMENT_SHADER, buildParticleFragmentShader, buildParticleFragmentIblVariant,
  PARTICLE_VERTEX_SHADER, buildParticleVertexShader, buildParticleVertexIblVariant,
  IBL_GLSL_HELPERS,
} = lib;

// --- Identity at OFF ---
check('fragment builder (no code, no ibl) === stock', buildParticleFragmentShader('') === FRAGMENT_SHADER);
check('fragment builder (no code, ibl=false) === stock', buildParticleFragmentShader('', false) === FRAGMENT_SHADER);
check('vertex builder (no code, no ibl) === stock', buildParticleVertexShader('') === PARTICLE_VERTEX_SHADER);
check('vertex builder (no code, ibl=false) === stock', buildParticleVertexShader('', false) === PARTICLE_VERTEX_SHADER);
check('stock fragment has no IBL code', !FRAGMENT_SHADER.includes('uIblMap') && !FRAGMENT_SHADER.includes('vWorldPosIbl'));
check('stock vertex has no IBL varying', !PARTICLE_VERTEX_SHADER.includes('vWorldPosIbl'));

// --- Fragment variant structure ---
const fv = buildParticleFragmentIblVariant();
check('variant declares IBL uniforms',
  fv.includes('uniform sampler2D uIblMap;') && fv.includes('uniform float uIblIntensity;')
  && fv.includes('uniform float uIblYaw;') && fv.includes('varying vec3 vWorldPosIbl;'));
check('variant includes the shared helper chunk', fv.includes(IBL_GLSL_HELPERS));
check('helper defined exactly once in variant', count(fv, 'vec3 kaloIblRotYaw') === 1 && count(fv, 'vec2 kaloEquirectUv') === 1);
check('variant world normal uses inverse view rotation',
  fv.includes('vec3 WN = normalize((vec4(N, 0.0) * viewMatrix).xyz);'));
check('variant view vector uses particle-centre world pos',
  fv.includes('vec3 WV = normalize(cameraPosition - vWorldPosIbl);'));
check('variant IBL term matches the GEOM form',
  fv.includes('iblAdd = uIblIntensity * (iblDiff * finalColor * 0.6 + iblRefl * (0.15 + 0.85 * fresI));'));
check('variant adds the term after SDF lighting',
  fv.includes('finalColor = finalColor * lighting;\n      finalColor += iblAdd;'));
check('variant keeps both custom seams', count(fv, '// __CUSTOM_PARTICLE_FRAGMENT__') === 2);
check('variant keeps the Kinetix branch intact', fv.includes('if (uSdfShape >= 4)'));

// The IBL term must sit inside the sphere branch: the term's
// position is after the sphere lighting line and before the
// SDF block closes (the alpha clamp that follows it).
const termAt = fv.indexOf('iblAdd = uIblIntensity');
const lightAt = fv.indexOf('lighting = clamp(uSdfAmbient');
const alphaAt = fv.indexOf('alpha = clamp(vAlpha * shapeEdge');
check('IBL term is inside the sphere branch', lightAt >= 0 && termAt > lightAt && alphaAt > termAt);

// --- Vertex variant structure ---
const vv = buildParticleVertexIblVariant();
check('vertex variant declares the varying', vv.includes('varying vec3 vWorldPosIbl;'));
check('vertex variant writes centre world position',
  vv.includes('vWorldPosIbl = (modelMatrix * vec4(pos, 1.0)).xyz;'));
check('vertex variant keeps the custom seam', vv.includes('// __CUSTOM_PARTICLE_VERTEX__'));

// --- Composition with custom GLSL ---
const code = 'color.rgb += vec3(0.01);';
const composed = buildParticleFragmentShader(code, true);
check('custom code composes with the IBL variant',
  composed.includes('particle points fragment (user GLSL)') && composed.includes('uIblMap'));
const vComposed = buildParticleVertexShader('disp = vec3(0.0);', true);
check('vertex custom code composes with the IBL variant',
  vComposed.includes('particle points vertex (user GLSL)') && vComposed.includes('vWorldPosIbl = (modelMatrix'));

// --- GEOM identity after the chunk refactor is pinned by
// scripts/phase18-shader-hash.mjs (GEOM_FRAG is in its list);
// it is not re-imported here because its module graph carries
// app-level defines a node bundle cannot supply. ---

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
