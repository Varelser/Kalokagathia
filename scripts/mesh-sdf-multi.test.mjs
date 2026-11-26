// Multi-body mesh SDF colliders — atlas packing, cell-clamped
// queries, min synthesis, key registration and shader wiring.
//
// Design: MULTI_SDF_IMPL_DESIGN (atlas 2x2 in the single
// uMeshSdfTex slot, max 4 bodies, sampler +0, master key
// gpgpuMeshSdfMultiEnabled default false, 22 new keys).
//
// Pins:
//  (a) a 1-body atlas query matches the single-body queryMeshSdf
//      exactly at sampled points;
//  (b) with 2 bodies baked, each body's inside is negative and
//      its outside positive (per-body normalised coordinates);
//  (c) cell boundary: a query at a body's edge texels never
//      picks up the neighbouring cell's distances;
//  (d) min synthesis CPU model picks the deepest body and
//      reports -1 when every body is out of domain;
//  (e) the 22 new keys exist with the design's defaults;
//  (f) both shaders carry the multi path + array uniforms and
//      declare no additional sampler.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.mesh-sdf-multi-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export {
        bakeMeshSdfGrid, queryMeshSdf, buildMeshSdfAtlas, queryMeshSdfAtlas,
        meshSdfMinBodyIndex, meshSdfAtlasCellOffset,
        isMeshSdfMultiRequested, getMeshSdfMultiBakeStatus,
      } from './lib/meshSdfCollider.ts';
      export { parseObjGeometry } from './lib/objMorph.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
      export { VEL_FRAG_PREAMBLE } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { VEL_FRAG_HELPERS } from './components/gpgpuShaderSimulationVelocityHelpers.ts';
      export { VEL_FRAG_MAIN_TAIL } from './components/gpgpuShaderSimulationVelocityMainTail.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  bakeMeshSdfGrid, queryMeshSdf, buildMeshSdfAtlas, queryMeshSdfAtlas,
  meshSdfMinBodyIndex, meshSdfAtlasCellOffset,
  isMeshSdfMultiRequested, getMeshSdfMultiBakeStatus,
  parseObjGeometry, APP_STATE_DEFAULT_GPGPU,
  VEL_FRAG_PREAMBLE, VEL_FRAG_HELPERS, VEL_FRAG_MAIN_TAIL, SIM_POS_FRAG,
} = lib;

// Closed cube OBJ (8 corners, 12 triangles).
const CUBE_OBJ = `
v -1 -1 -1
v 1 -1 -1
v 1 1 -1
v -1 1 -1
v -1 -1 1
v 1 -1 1
v 1 1 1
v -1 1 1
f 1 2 3
f 1 3 4
f 5 7 6
f 5 8 7
f 1 5 6
f 1 6 2
f 2 6 7
f 2 7 3
f 3 7 8
f 3 8 4
f 4 8 5
f 4 5 1
`;

const RES = 32;
const cubeGeometry = parseObjGeometry(CUBE_OBJ);
check('cube OBJ parses', !!cubeGeometry);
const cubeGrid = bakeMeshSdfGrid(cubeGeometry, RES);
check('cube grid bakes at 32', !!cubeGrid && cubeGrid.resolution === RES);

// --- (a) 1-body atlas == single query --------------------------------
{
  const atlas = buildMeshSdfAtlas([cubeGrid]);
  check('atlas dims are (2R, 2R, R)',
    atlas.atlasWidth === 2 * RES && atlas.atlasHeight === 2 * RES && atlas.atlasDepth === RES,
    `${atlas.atlasWidth}x${atlas.atlasHeight}x${atlas.atlasDepth}`);
  const samples = [
    [0, 0, 0], [0.3, 0, 0], [0, -0.4, 0.2], [0.9, 0, 0], [0, 0, 1.1],
    [-0.57, 0.1, -0.1], [0.123, -0.456, 0.789], [2, 0, 0],
  ];
  let allEqual = true;
  let worst = 0;
  for (const [x, y, z] of samples) {
    const single = queryMeshSdf(cubeGrid, x, y, z);
    const multi = queryMeshSdfAtlas(atlas, 0, x, y, z);
    if (single === Infinity || multi === Infinity) {
      if (single !== multi) allEqual = false;
    } else {
      worst = Math.max(worst, Math.abs(single - multi));
      if (Math.abs(single - multi) > 1e-6) allEqual = false;
    }
  }
  check('1-body atlas query matches single query', allEqual, `worst diff ${worst}`);
}

// --- (b) 2 bodies: inside negative / outside positive ----------------
{
  const atlas = buildMeshSdfAtlas([cubeGrid, cubeGrid]);
  for (const body of [0, 1]) {
    const inside = queryMeshSdfAtlas(atlas, body, 0, 0, 0);
    const outside = queryMeshSdfAtlas(atlas, body, 0.95, 0, 0);
    check(`body ${body + 1} centre is inside (negative)`, inside < 0, `got ${inside}`);
    check(`body ${body + 1} near domain edge is outside (positive)`, outside > 0, `got ${outside}`);
    check(`body ${body + 1} out of domain is +Infinity`,
      queryMeshSdfAtlas(atlas, body, 2.5, 0, 0) === Infinity);
  }
  check('absent body 3 query is +Infinity', queryMeshSdfAtlas(atlas, 2, 0, 0, 0) === Infinity);
  check('cell offsets follow the 2x2 layout',
    meshSdfAtlasCellOffset(RES, 0).join(',') === `0,0,0`
    && meshSdfAtlasCellOffset(RES, 1).join(',') === `${RES},0,0`
    && meshSdfAtlasCellOffset(RES, 2).join(',') === `0,${RES},0`
    && meshSdfAtlasCellOffset(RES, 3).join(',') === `${RES},${RES},0`);
}

// --- (c) cell boundary: no bleed from the neighbouring cell ---------
{
  const h = 2 / (RES - 6);
  const fakeGrid = (value) => ({
    grid: new Float32Array(RES * RES * RES).fill(value),
    resolution: RES,
    sideNorm: RES * h,
    voxelNorm: h,
    triangleCount: 0,
    minFeatureVoxels: 0,
  });
  const atlas = buildMeshSdfAtlas([fakeGrid(-1), fakeGrid(5), null, fakeGrid(-3)]);
  // Body 1 (cell x=0) at its +x edge texels must stay -1 even
  // though cell x=1 in the raw atlas holds +5.
  const edgeX = (RES - 1.5) * h - (RES * h) / 2 + h / 2; // near +x edge, in-cell
  const qEdge = queryMeshSdfAtlas(atlas, 0, 1.2, 0, 0);
  check('body 1 far-edge query stays in its own cell', Math.abs(qEdge - (-1)) < 1e-9, `got ${qEdge} (edgeX ${edgeX})`);
  const qB2 = queryMeshSdfAtlas(atlas, 1, -1.2, 0, 0);
  check('body 2 far-edge query stays in its own cell', Math.abs(qB2 - 5) < 1e-9, `got ${qB2}`);
  const qB4 = queryMeshSdfAtlas(atlas, 3, 0, 0, 0);
  check('body 4 (second row) reads its own cell', Math.abs(qB4 - (-3)) < 1e-9, `got ${qB4}`);
}

// --- (d) min synthesis CPU model --------------------------------------
{
  check('min synthesis picks the deepest body',
    meshSdfMinBodyIndex([0.5, -0.2, 0.1]) === 1);
  check('min synthesis picks body 1 when it is deepest',
    meshSdfMinBodyIndex([-3, 5]) === 0);
  check('min synthesis with every body out of domain is -1',
    meshSdfMinBodyIndex([Infinity, Infinity]) === -1);
  const atlas = buildMeshSdfAtlas([cubeGrid, cubeGrid]);
  const distances = [0, 1].map((b) => queryMeshSdfAtlas(atlas, b, 0, 0, 0));
  check('min synthesis over baked bodies finds an inside body',
    meshSdfMinBodyIndex(distances) >= 0 && distances[meshSdfMinBodyIndex(distances)] < 0);
}

// --- (e) 22 new keys with the design defaults -------------------------
{
  const d = APP_STATE_DEFAULT_GPGPU;
  const expected = {
    gpgpuMeshSdfMultiEnabled: false,
  };
  for (const n of [2, 3, 4]) {
    expected[`gpgpuMeshSdfBody${n}ObjSource`] = '';
    expected[`gpgpuMeshSdfBody${n}OffsetX`] = 0;
    expected[`gpgpuMeshSdfBody${n}OffsetY`] = 0;
    expected[`gpgpuMeshSdfBody${n}OffsetZ`] = 0;
    expected[`gpgpuMeshSdfBody${n}Scale`] = 1;
    expected[`gpgpuMeshSdfBody${n}Bounce`] = 0.5;
    expected[`gpgpuMeshSdfBody${n}Friction`] = 0.25;
  }
  const keys = Object.keys(expected);
  check('exactly 22 new keys are pinned by this test', keys.length === 22, `${keys.length}`);
  const bad = keys.filter((k) => d[k] !== expected[k]);
  check('all 22 new keys exist with the design defaults', bad.length === 0,
    bad.map((k) => `${k}=${JSON.stringify(d[k])}`).join(', '));
  // Types + descriptions are source-level registrations.
  const types = readFileSync(join(ROOT, 'types/configGpgpu.ts'), 'utf8');
  const descs = readFileSync(join(ROOT, 'lib/parameterDescriptions.ts'), 'utf8');
  const missingTypes = keys.filter((k) => !types.includes(`${k}:`));
  const missingDescs = keys.filter((k) => !descs.includes(`${k}:`));
  check('all 22 keys are declared in the config type', missingTypes.length === 0, missingTypes.join(','));
  check('all 22 keys have parameter descriptions', missingDescs.length === 0, missingDescs.join(','));
  const catalog = readFileSync(join(ROOT, 'lib/aiControlCatalog.ts'), 'utf8');
  check('AI catalog carries the multi toggle', catalog.includes("'gpgpuMeshSdfMultiEnabled'"));
}

// --- (f) shader wiring: multi path present, sampler +0 ----------------
{
  const vel = `${VEL_FRAG_PREAMBLE}\n${VEL_FRAG_HELPERS}\n${VEL_FRAG_MAIN_TAIL}`;
  const pos = SIM_POS_FRAG;
  for (const [name, src] of [['velocity', vel], ['position', pos]]) {
    check(`${name} shader declares the multi guard`, src.includes('uniform bool  uMeshSdfMultiEnabled;') || src.includes('uMeshSdfMultiEnabled'));
    check(`${name} shader declares the body arrays`,
      src.includes('uMeshSdfBodyOrigin[4]') && src.includes('uMeshSdfBodyCell[4]'));
    check(`${name} shader has the per-body query`, src.includes('meshSdfBodyDistance') && src.includes('meshSdfBodyNormal'));
    check(`${name} shader has the min-synthesis branch`, src.includes('bestBody') && src.includes('uMeshSdfBodyCount'));
    const meshSamplers = src.match(/uniform\s+sampler3D\s+uMeshSdf\w*/g) ?? [];
    check(`${name} shader declares exactly one mesh SDF sampler (atlas reuses the slot)`,
      meshSamplers.length === 1 && meshSamplers[0].includes('uMeshSdfTex'), meshSamplers.join(' | '));
  }
  check('velocity shader has per-body bounce/friction arrays',
    vel.includes('uMeshSdfBodyBounce[4]') && vel.includes('uMeshSdfBodyFriction[4]'));
  check('velocity tail keeps the legacy single-body block',
    VEL_FRAG_MAIN_TAIL.includes('if (uMeshSdfEnabled)'));
  check('position shader keeps the legacy single-body block',
    pos.includes('if (uMeshSdfEnabled)'));
}

// --- (g) defect fixes 2026-11-27 (Carbon review items 1-4) -----------
{
  const base = {
    ...APP_STATE_DEFAULT_GPGPU,
    gpgpuMeshSdfEnabled: true,
    gpgpuMeshSdfMultiEnabled: true,
    gpgpuMorphObjSource: CUBE_OBJ,
    gpgpuMeshSdfResolution: 16,
  };
  // Fix 1: the parent key gates multi.
  check('fix1: parent OFF makes multi unrequested even with multi ON',
    isMeshSdfMultiRequested({ ...base, gpgpuMeshSdfEnabled: false }) === false);
  check('fix1: parent ON + multi ON + a source is requested',
    isMeshSdfMultiRequested(base) === true);
  const passes = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  check('fix1: both passes gate multi on parent && multi',
    passes.includes('meshSdfMultiActiveVel') && passes.includes('meshSdfMultiActivePos'));
  const foundation = readFileSync(join(ROOT, 'lib/webgpuComputeFoundation.ts'), 'utf8');
  check('fix1: WebGPU routing treats multi as a WebGL-only feature',
    foundation.includes('gpgpuMeshSdfEnabled || config.gpgpuMeshSdfMultiEnabled'));
  // Fix 2: status follows the whole set, not body 1 alone.
  const body2Only = {
    ...base,
    gpgpuMorphObjSource: '',
    gpgpuMeshSdfBody2ObjSource: CUBE_OBJ,
  };
  const st = getMeshSdfMultiBakeStatus(body2Only);
  check('fix2: body2-only status is not stuck at no-source',
    st.state === 'baking' || st.state === 'ready', st.state);
  check('fix2: no sources at all is no-source',
    getMeshSdfMultiBakeStatus({ ...body2Only, gpgpuMeshSdfBody2ObjSource: '' }).state === 'no-source');
  check('fix2: parent OFF status is off',
    getMeshSdfMultiBakeStatus({ ...base, gpgpuMeshSdfEnabled: false }).state === 'off');
  // Fix 3: normal taps are clamped into the domain in both shaders.
  check('fix3: velocity normal clamps its taps into the domain',
    VEL_FRAG_HELPERS.includes('clamp(p + vec3(e, 0.0, 0.0), nLo, nHi)'));
  check('fix3: position normal clamps its taps into the domain',
    SIM_POS_FRAG.includes('clamp(p + vec3(e, 0.0, 0.0), nLo, nHi)'));
  // Fix 4: no domain substitution in the uniform fill.
  check('fix4: domains are passed through without the 1.0 substitution',
    passes.includes('domains[i] = body.domainWorld;') && !passes.includes('body.domainWorld > 0 ? body.domainWorld : 1.0'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
