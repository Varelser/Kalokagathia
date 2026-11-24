// Phase 22 stage 4 — true shadow map, wiring stage 1 (§3 design).
//
// What is pinned here (node side):
//   - The pure math: frustum framing, the depth comparison
//     twin, and the light-space projection — a point directly
//     between the light and the scene centre projects to the
//     centre of the shadow map; a point behind the light or
//     outside the frustum reports null (fully lit in GLSL).
//   - The GLSL chunk carries the bias comparison and the 3x3
//     PCF, and returns 1 (lit) when not ready / out of frustum.
//   - The terrain injections anchor on the real three.js
//     chunk include lines and add exactly the documented
//     pieces; without injection the stock strings are what
//     three compiles (identity at key 0 is by construction:
//     TerrainMesh only sets onBeforeCompile while the key is
//     positive, and AppScene only mounts the capture then).
import { build } from 'esbuild';
import { unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p22s4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        SHADOW_MAP_SIZE, shadowMapExtent, lightShadowFrustum, buildLightViewProj,
        shadowSampleLit, projectToLightNdc, LIGHT_SHADOW_GLSL,
        injectTerrainShadowVertex, injectTerrainShadowFragment,
      } from './lib/lightShadowMap.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  SHADOW_MAP_SIZE, shadowMapExtent, lightShadowFrustum, buildLightViewProj,
  shadowSampleLit, projectToLightNdc, LIGHT_SHADOW_GLSL,
  injectTerrainShadowVertex, injectTerrainShadowFragment,
} = lib;

check('shadow map size is 2048', SHADOW_MAP_SIZE === 2048);
check('extent follows bounce radius', shadowMapExtent(300) === 375 && shadowMapExtent(10) === 50);

const light = { x: 0, y: 0, z: 500 };
const frustum = lightShadowFrustum(light, 300);
check('frustum near/far bracket the scene',
  frustum.near > 0 && frustum.near < 500 && frustum.far > 500);

// Depth comparison twin.
check('lit when fragment is in front of stored depth', shadowSampleLit(0.5, 0.4, 0.001) === 1);
check('shadowed when fragment is behind stored depth', shadowSampleLit(0.5, 0.6, 0.001) === 0);
check('bias rescues the acne band', shadowSampleLit(0.5, 0.5005, 0.001) === 1);
check('bias does not rescue a real occluder', shadowSampleLit(0.5, 0.52, 0.001) === 0);

// Projection twin: origin (scene centre) seen from +z light
// lands at the centre of the map, with depth in (0, 1).
const vp = buildLightViewProj(light, 300);
const centre = projectToLightNdc(vp, { x: 0, y: 0, z: 0 });
check('scene centre projects to map centre',
  centre !== null && near(centre.u, 0.5, 1e-6) && near(centre.v, 0.5, 1e-6));
check('centre depth is inside (0, 1)', centre !== null && centre.depth > 0 && centre.depth < 1);
// A point closer to the light has a SMALLER light-space depth.
const nearer = projectToLightNdc(vp, { x: 0, y: 0, z: 100 });
check('closer point has smaller depth', nearer !== null && centre !== null && nearer.depth < centre.depth);
// Outside the frustum sideways -> null (fully lit).
check('outside frustum is null', projectToLightNdc(vp, { x: 10000, y: 0, z: 0 }) === null);

// GLSL chunk structure.
check('chunk declares the uniforms',
  LIGHT_SHADOW_GLSL.includes('uniform sampler2D uShadowMapTex;')
  && LIGHT_SHADOW_GLSL.includes('uniform mat4 uLightViewProj;')
  && LIGHT_SHADOW_GLSL.includes('uniform float uShadowMapStrength;'));
check('chunk comparison uses the bias',
  LIGHT_SHADOW_GLSL.includes('return (fragZ - uShadowMapBias <= d) ? 1.0 : 0.0;'));
check('chunk returns lit when not ready',
  LIGHT_SHADOW_GLSL.includes('if (uShadowMapReady < 0.5) return 1.0;'));
check('chunk returns lit outside the frustum',
  LIGHT_SHADOW_GLSL.includes('|| fragZ > 1.0) return 1.0;'));
check('chunk has the 3x3 PCF', LIGHT_SHADOW_GLSL.includes('return sum / 9.0;'));

// Terrain injections against synthetic stock-shaped strings.
const stockVert = '#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}';
const stockFrag = '#include <common>\nvoid main() {\n#include <opaque_fragment>\n}';
const iv = injectTerrainShadowVertex(stockVert);
check('vertex injection adds the varying + world pos write',
  iv.includes('varying vec3 vWorldPosSmap;')
  && iv.includes('vWorldPosSmap = (modelMatrix * vec4(transformed, 1.0)).xyz;'));
const ifrag = injectTerrainShadowFragment(stockFrag);
check('fragment injection adds chunk + outgoing multiply',
  ifrag.includes('float kaloShadowFactor(vec3 worldPos)')
  && ifrag.includes('outgoingLight *= mix(1.0, kaloShadowFactor(vWorldPosSmap), uShadowMapStrength);'));
check('injections keep the stock anchors',
  iv.includes('#include <worldpos_vertex>') && ifrag.includes('#include <opaque_fragment>'));

// The anchors must exist in the real three.js shader chunks
// the terrain material compiles from.
const meshphysical = readFileSync(join(ROOT, 'node_modules/three/src/renderers/shaders/ShaderLib/meshphysical.glsl.js'), 'utf8');
check('real meshphysical vertex has both anchors',
  meshphysical.includes('#include <common>') && meshphysical.includes('#include <worldpos_vertex>'));
check('real meshphysical fragment has the opaque anchor',
  meshphysical.includes('#include <opaque_fragment>'));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
