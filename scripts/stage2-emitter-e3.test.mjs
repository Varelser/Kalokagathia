// Grammar 2.0 stage 2, slice E3 — emission sources: the
// morph cloud reused as a source, the bitmap cloud (the CPU
// layer sampler's law ported to a bake asset), path emission
// on the steering polyline, the raster-mask emission gate,
// and the saved morph text font.
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E3.
//
// Cases:
//  1 bitmap sampler port: hash + sampling law equal an
//    independent copy of particleData's functions verbatim
//  2 bitmap cloud: determinism, framing (relief / alpha /
//    bounds), blank-map fallback, half-bright discipline
//  3 path asset: arc table, sampler positions + tangents,
//    degenerate inputs, resolution gating
//  4 bake integration: no-options bit-identity; cloud
//    placement is the identity map with ages / velocities
//    bit-identical to the shape bake; path placement on the
//    polyline with tangent velocity; directed wins over the
//    path speed; mask accept-all keeps positions, reject-all
//    degrades cloud points to shape samples
//  5 shader variants: default position / velocity strings
//    pinned to the pre-E3 hashes; cloud / path / mask
//    variants carry their segments, the default does not;
//    mask + transform folds the transform into candidates
//  6 resolution + capability: source predicates, the two
//    new features route to WebGL only when live
//  7 key registration: the 7 new keys sit at their defaults
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2e3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const arraysEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { bitmapHash, sampleBitmapPoint, buildBitmapEmissionCloud, buildPathArcTable, samplePathAt, resolveEmissionPath, resolveEmissionSourceKind, emissionSourceActive, emissionCloudActive, emissionPathActive, emissionMaskActive, emissionMaskVariantActive, buildEmissionMaskPredicate, resolveBitmapEmission, resolveMorphTextFont, EMIT_PATH_GLSL } from './lib/gpgpuEmissionSource.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildGpgpuInitialData,
  bitmapHash, sampleBitmapPoint, buildBitmapEmissionCloud,
  buildPathArcTable, samplePathAt, resolveEmissionPath,
  resolveEmissionSourceKind, emissionSourceActive, emissionCloudActive,
  emissionPathActive, emissionMaskActive, emissionMaskVariantActive,
  buildEmissionMaskPredicate, resolveBitmapEmission, resolveMorphTextFont,
  EMIT_PATH_GLSL,
  buildPositionFragment, SIM_POS_FRAG, SIM_VEL_FRAG,
  getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

// ---------------------------------------------------------------------------
// 1. Bitmap sampler port: independent copies of the CPU
//    sampler's hash and sampling law (components/
//    particleData.ts), compared draw for draw.
function cpuHash(n) {
  n = Math.imul(n ^ (n >>> 15), 0x5deb38b3);
  n = Math.imul(n ^ (n >>> 15), 0x4a4f9b17);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}
{
  let ok = true;
  for (let n = -5000; n < 5000; n += 7) if (bitmapHash(n) !== cpuHash(n)) ok = false;
  check('bitmap hash equals the CPU sampler hash verbatim', ok);
}
// A 4x2 map: only pixel (3, 0) is bright.
const sparseMap = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]);
{
  // Find a seed whose first kept sample is the bright pixel,
  // then compare against a hand-rolled copy of the CPU law.
  const cpuSample = (seed) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ru = cpuHash(seed + attempt * 11 + 101);
      const rv = cpuHash(seed + attempt * 11 + 102);
      const x = Math.min(3, Math.floor(ru * 4));
      const y = Math.min(1, Math.floor(rv * 2));
      const luma = sparseMap[y * 4 + x] ?? 0;
      if (luma >= 0.45) return { x: (x / 3) * 2 - 1, y: 1 - (y / 1) * 2, luma };
    }
    return null;
  };
  let ok = true;
  let hits = 0;
  for (let seed = 0; seed < 400; seed++) {
    const a = sampleBitmapPoint(sparseMap, 4, 2, 0.45, false, seed);
    const b = cpuSample(seed);
    if ((a === null) !== (b === null)) ok = false;
    else if (a && (a.x !== b.x || a.y !== b.y || a.luma !== b.luma)) ok = false;
    if (a) hits += 1;
  }
  check('bitmap sampling law equals the CPU law draw for draw', ok && hits > 50, `hits=${hits}`);
  const inv = sampleBitmapPoint(sparseMap, 4, 2, 0.45, true, 3);
  check('bitmap invert flips the luma test', inv !== null && inv.luma === 1);
  check('bitmap sampler rejects a missing map', sampleBitmapPoint(undefined, 4, 2, 0.45, false, 1) === null);
  check('bitmap sampler rejects a blank map', sampleBitmapPoint(new Float32Array(8), 4, 2, 0.45, false, 1) === null);
}

// ---------------------------------------------------------------------------
// 2. Bitmap cloud framing.
{
  const bright = new Float32Array(16 * 16).fill(1);
  const opts = { map: bright, width: 16, height: 16, threshold: 0.45, depth: 0.65, invert: false, count: 256, seed: 7, worldScale: 24 };
  const cloudA = buildBitmapEmissionCloud(opts);
  const cloudB = buildBitmapEmissionCloud(opts);
  check('bitmap cloud is deterministic', arraysEqual([...cloudA], [...cloudB]));
  let framing = true;
  for (let i = 0; i < 256; i++) {
    // Fully bright map: relief is (1 - 0.5) * 2 * depth * scale
    // (compared at Float32 storage precision).
    if (cloudA[i * 4 + 1] !== Math.fround((1 - 0.5) * 2 * 0.65 * 24)) framing = false;
    if (cloudA[i * 4 + 3] !== 1) framing = false;
    if (Math.abs(cloudA[i * 4]) > 24 || Math.abs(cloudA[i * 4 + 2]) > 24) framing = false;
  }
  check('bitmap cloud framing (relief / alpha / bounds)', framing);
  const dark = buildBitmapEmissionCloud({ ...opts, map: new Float32Array(16 * 16) });
  let flat = true;
  for (let i = 0; i < 256; i++) if (dark[i * 4 + 1] !== 0) flat = false;
  check('bitmap cloud blank map falls back to the flat plane', flat);
  // Left half bright: relief-bearing points sit at x <= 0.
  const half = new Float32Array(16 * 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) half[y * 16 + x] = 1;
  const halfCloud = buildBitmapEmissionCloud({ ...opts, map: half });
  let halfOk = true;
  for (let i = 0; i < 256; i++) {
    if (halfCloud[i * 4 + 1] !== 0 && halfCloud[i * 4] > 0) halfOk = false;
  }
  check('bitmap cloud keeps relief points in the bright half', halfOk);
}

// ---------------------------------------------------------------------------
// 3. Path asset.
{
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }];
  const { cum, total } = buildPathArcTable(pts);
  check('path arc table', total === 7 && arraysEqual(cum, [0, 3, 7]), `total=${total} cum=${cum}`);
  const s0 = samplePathAt(pts, cum, total, 0);
  const sMid = samplePathAt(pts, cum, total, 0.5);
  const sEnd = samplePathAt(pts, cum, total, 1);
  check('path sampler start', s0.pos.x === 0 && s0.pos.y === 0 && s0.tangent.x === 1 && s0.tangent.y === 0);
  check('path sampler mid-segment', sMid.pos.x === 3 && sMid.pos.y === 0.5 && sMid.tangent.x === 0 && sMid.tangent.y === 1, JSON.stringify(sMid));
  check('path sampler end', sEnd.pos.x === 3 && sEnd.pos.y === 4 && sEnd.tangent.y === 1);
  const deg = samplePathAt([{ x: 5, y: 6, z: 7 }], [0], 0, 0.3);
  check('path sampler degenerate point', deg.pos.x === 5 && deg.pos.y === 6 && deg.pos.z === 7);
  const cfg = (patch) => ({ ...APP_STATE_DEFAULT_GPGPU, ...patch });
  check('path resolution needs the path source', resolveEmissionPath(cfg({ gpgpuSteerSeekPath: '0,0,0;10,0,0' })) === null);
  const resolved = resolveEmissionPath(cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPath: '0,0,0;10,0,0' }));
  check('path resolution reads the steering asset', !!resolved && resolved.total === 10 && resolved.speed === 6);
  check('path resolution rejects a single point', resolveEmissionPath(cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPath: '1,2,3' })) === null);
  check('path resolution rejects a zero-length path', resolveEmissionPath(cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPath: '1,2,3;1,2,3' })) === null);
  check('path activity predicate', emissionPathActive(cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPath: '0,0;10,0' })));
}

// ---------------------------------------------------------------------------
// 4. Bake integration.
{
  const TEX = 16;
  const legacy = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8);
  const explicitNull = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { cloud: null, path: null, maskAccept: null });
  check('bake: explicit null E3 options are bit-identical',
    arraysEqual([...legacy.posData], [...explicitNull.posData]) && arraysEqual([...legacy.velData], [...explicitNull.velData]));

  // Cloud: a hand-made cloud with distinct points.
  const cloud = new Float32Array(TEX * TEX * 4);
  for (let i = 0; i < TEX * TEX; i++) {
    cloud[i * 4] = (i % TEX) - 8;
    cloud[i * 4 + 1] = Math.floor(i / TEX) - 8;
    cloud[i * 4 + 2] = (i % 5) - 2;
    cloud[i * 4 + 3] = 1;
  }
  const cloudBake = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { cloud });
  let identity = true;
  let stream = true;
  for (let i = 0; i < TEX * TEX; i++) {
    if (cloudBake.posData[i * 4] !== cloud[i * 4] || cloudBake.posData[i * 4 + 1] !== cloud[i * 4 + 1] || cloudBake.posData[i * 4 + 2] !== cloud[i * 4 + 2]) identity = false;
    if (cloudBake.posData[i * 4 + 3] !== legacy.posData[i * 4 + 3]) stream = false;
    if (cloudBake.velData[i * 4] !== legacy.velData[i * 4] || cloudBake.velData[i * 4 + 1] !== legacy.velData[i * 4 + 1] || cloudBake.velData[i * 4 + 2] !== legacy.velData[i * 4 + 2]) stream = false;
  }
  check('bake: cloud placement is the identity map', identity);
  check('bake: cloud mode keeps ages + velocities bit-identical to the shape bake', stream);

  // Path: a straight +X segment; speed along the tangent.
  const pathAsset = { points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], cum: [0, 10], total: 10, speed: 6 };
  const pathBake = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { path: pathAsset });
  let onPath = true;
  let tangentVel = true;
  for (let i = 0; i < TEX * TEX; i++) {
    const x = pathBake.posData[i * 4];
    if (pathBake.posData[i * 4 + 1] !== 0 || pathBake.posData[i * 4 + 2] !== 0 || x < 0 || x > 10) onPath = false;
    if (pathBake.velData[i * 4] !== 6 || pathBake.velData[i * 4 + 1] !== 0 || pathBake.velData[i * 4 + 2] !== 0) tangentVel = false;
  }
  check('bake: path placement lies on the polyline', onPath);
  check('bake: path velocity is the tangent times the speed', tangentVel);
  const pathStill = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { path: { ...pathAsset, speed: 0 } });
  let cubeRange = true;
  for (let i = 0; i < TEX * TEX; i++) {
    for (let k = 0; k < 3; k++) if (Math.abs(pathStill.velData[i * 4 + k]) > 2) cubeRange = false;
  }
  check('bake: path speed 0 keeps the legacy velocity draws', cubeRange);
  const directed = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, {
    path: pathAsset,
    initialVelocity: { dir: { x: 0, y: 1, z: 0 }, speed: 2, spread: 0 },
  });
  let directedWins = true;
  for (let i = 0; i < TEX * TEX; i++) {
    if (directed.velData[i * 4] !== 0 || directed.velData[i * 4 + 1] !== 2 || directed.velData[i * 4 + 2] !== 0) directedWins = false;
  }
  check('bake: directed velocity wins over the path speed', directedWins);

  // Mask: accept-all consults the predicate exactly once per
  // particle (every first candidate stands), and the first
  // particle's placement is the legacy one. (Each consultation
  // consumes its roll draw, so later particles' streams are
  // the mask mode's own — the discipline under test is the
  // single consultation + first-candidate rule.)
  let maskCalls = 0;
  const acceptAll = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { maskAccept: () => { maskCalls += 1; return true; } });
  check('bake: mask accept-all consults once per particle', maskCalls === TEX * TEX, `calls=${maskCalls}`);
  check('bake: mask accept-all first placement is the legacy one',
    acceptAll.posData[0] === legacy.posData[0] && acceptAll.posData[1] === legacy.posData[1] && acceptAll.posData[2] === legacy.posData[2]);
  // Mask: reject-all over a cloud degrades to shape samples
  // (inside the bounce radius, off the cloud points).
  const rejectCloud = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { cloud, maskAccept: () => false });
  let degraded = 0;
  let inBounds = true;
  for (let i = 0; i < TEX * TEX; i++) {
    const dx = rejectCloud.posData[i * 4] - cloud[i * 4];
    const dy = rejectCloud.posData[i * 4 + 1] - cloud[i * 4 + 1];
    const dz = rejectCloud.posData[i * 4 + 2] - cloud[i * 4 + 2];
    if (dx * dx + dy * dy + dz * dz > 1e-9) degraded += 1;
    const px = rejectCloud.posData[i * 4];
    const py = rejectCloud.posData[i * 4 + 1];
    const pz = rejectCloud.posData[i * 4 + 2];
    if (Math.hypot(px, py, pz) > 10.0001) inBounds = false;
  }
  check('bake: mask reject-all degrades cloud points to shape samples', degraded > TEX * TEX * 0.9, `degraded=${degraded}`);
  check('bake: degraded placements stay in the shape bounds', inBounds);
  const rejectA = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { maskAccept: () => false });
  const rejectB = buildGpgpuInitialData(TEX, 10, 'sphere', 42, 8, null, { maskAccept: () => false });
  check('bake: mask rejection is deterministic', arraysEqual([...rejectA.posData], [...rejectB.posData]));
}

// ---------------------------------------------------------------------------
// 5. Shader variants.
{
  check('default position fragment pinned to the pre-E3 hash',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha256(SIM_POS_FRAG));
  check('default velocity fragment pinned to the pre-E3 hash',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha256(SIM_VEL_FRAG));
  check('default fragment carries no E3 uniforms',
    !SIM_POS_FRAG.includes('uEmitCloudTex') && !SIM_POS_FRAG.includes('uEmitPath') && !SIM_POS_FRAG.includes('uEmitMaskEnabled') && !SIM_POS_FRAG.includes('kaloEmitPathPos'));
  const cloudFrag = buildPositionFragment({ emitterCloud: true });
  check('cloud variant samples the cloud texel',
    cloudFrag.includes('uniform sampler2D uEmitCloudTex;') && cloudFrag.includes('pos = texture2D(uEmitCloudTex, vUv).xyz;'));
  check('cloud variant replaces the legacy placement', !cloudFrag.includes('float r   = uBounceRadius'));
  const pathFrag = buildPositionFragment({ emitterPath: true });
  check('path variant carries the arc twin + uniforms',
    pathFrag.includes('kaloEmitPathPos') && pathFrag.includes('uniform float uEmitPathCum[8];') && pathFrag.includes(EMIT_PATH_GLSL));
  const maskFrag = buildPositionFragment({ emitterMask: true });
  check('mask variant gates with the kill-mask rule',
    maskFrag.includes('uniform bool uEmitMaskEnabled;')
    && maskFrag.includes('emitCand.xy / (2.0 * uBounceRadius) + 0.5')
    && maskFrag.includes('if (eLuma >= uKillMaskThreshold) break;'));
  const maskShapeFrag = buildPositionFragment({ emitterMask: true, emitterShape: true });
  check('mask + shape variant gates shape-law candidates', maskShapeFrag.includes('emitCand = kaloEmitShapePos(uRespawnShape'));
  const maskCloudFrag = buildPositionFragment({ emitterMask: true, emitterCloud: true });
  check('mask + cloud variant degrades to fallback draws',
    maskCloudFrag.includes('vec3 emitCand = texture2D(uEmitCloudTex, vUv).xyz;') && maskCloudFrag.includes('eLuma0 < uKillMaskThreshold'));
  const maskTransformFrag = buildPositionFragment({ emitterMask: true, emitterTransform: true });
  check('mask + transform folds the transform into candidates',
    maskTransformFrag.includes('emitCand = uEmitterPos + uEmitterRotScale * emitCand;')
    && !maskTransformFrag.includes('pos = uEmitterPos + uEmitterRotScale * pos;'));
  const transformFrag = buildPositionFragment({ emitterTransform: true });
  check('transform-only variant keeps the standalone segment',
    transformFrag.includes('pos = uEmitterPos + uEmitterRotScale * pos;'));
}

// ---------------------------------------------------------------------------
// 6. Resolution + capability.
{
  const cfg = (patch) => ({ ...APP_STATE_DEFAULT_GPGPU, ...patch });
  check('source kind defaults to shape', resolveEmissionSourceKind(cfg({})) === 'shape');
  check('source activity predicates',
    !emissionSourceActive(cfg({}))
    && emissionSourceActive(cfg({ gpgpuEmitSource: 'morph' }))
    && emissionCloudActive(cfg({ gpgpuEmitSource: 'bitmap' }))
    && !emissionCloudActive(cfg({ gpgpuEmitSource: 'path' })));
  check('mask predicates follow their supplies',
    !emissionMaskActive(cfg({}))
    && emissionMaskActive(cfg({ gpgpuEmitMaskEnabled: true, gpgpuMaskMode: 'clip', gpgpuMaskMap: [1, 1, 1, 1], gpgpuMaskMapWidth: 2, gpgpuMaskMapHeight: 2 }))
    && !emissionMaskVariantActive(cfg({ gpgpuEmitMaskEnabled: true }))
    && emissionMaskVariantActive(cfg({ gpgpuEmitMaskEnabled: true, gpgpuMaskSource: 'layer2' })));
  const predicate = buildEmissionMaskPredicate(cfg({
    gpgpuEmitMaskEnabled: true, gpgpuMaskMode: 'clip', gpgpuMaskThreshold: 0.5, gpgpuMaskInvert: false,
    gpgpuMaskMap: [1, 1, 1, 1], gpgpuMaskMapWidth: 2, gpgpuMaskMapHeight: 2,
  }));
  check('mask predicate (clip, bright map) accepts', !!predicate && predicate(0, 0, 0.99) === true);
  check('bitmap resolution clamps', resolveBitmapEmission(cfg({ gpgpuEmitBitmapThreshold: 7 })).threshold === 1);
  check('morph text font resolution',
    resolveMorphTextFont(cfg({})) === cfg({}).layer2TextMapFontFamily
    && resolveMorphTextFont(cfg({ gpgpuMorphTextFont: 'Custom Font' })) === 'Custom Font');
  const dflt = getWebgpuComputeCapabilityReport(cfg({}));
  check('capability: defaults stay WebGPU-capable', dflt.canRunRequestedConfig === true, JSON.stringify(dflt.unsupportedFeatures));
  check('capability: emission source routes to WebGL',
    getWebgpuComputeCapabilityReport(cfg({ gpgpuEmitSource: 'bitmap' })).unsupportedFeatures.includes('emission-source'));
  check('capability: emission mask routes to WebGL',
    getWebgpuComputeCapabilityReport(cfg({ gpgpuEmitMaskEnabled: true, gpgpuMaskSource: 'layer2' })).unsupportedFeatures.includes('emission-mask'));
}

// ---------------------------------------------------------------------------
// 7. Key registration defaults.
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check('key defaults: emission source family',
    d.gpgpuEmitSource === 'shape'
    && d.gpgpuEmitBitmapThreshold === 0.45
    && d.gpgpuEmitBitmapDepth === 0.65
    && d.gpgpuEmitBitmapInvert === false
    && d.gpgpuEmitPathSpeed === 6
    && d.gpgpuEmitMaskEnabled === false
    && d.gpgpuMorphTextFont === '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
