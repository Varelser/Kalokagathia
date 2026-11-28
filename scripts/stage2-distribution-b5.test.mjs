// Grammar 2.0 stage 2, slice B5 — distribution operator
// layer (lib/gpgpuDistribution.ts) and shared random channel
// (lib/gpgpuRandom.ts). Design:
// kalokagathia-pro/STAGE2_DESIGN.md §1 judgment 3 / §3 B5.
//
// Cases:
//  1 random commonisation: the shared dmHash11 / mulberry32
//    reproduce the pre-B5 per-file copies BIT FOR BIT (the
//    legacy bodies are embedded below as references — both
//    mulberry textual variants, plus every delegating module)
//  2 distribution resolution: tolerant parse, sanitising
//    clamps, identity operators dropped, 8-op cap
//  3 JS twin semantics: hand-computed points per operator,
//    list order matters, guards (origin / radius 0)
//  4 bake: no layer = the pre-E1 legacy pins for all 7
//    shapes; an effective layer moves positions only —
//    velocities and ages stay bit-identical, and the radial
//    law holds per particle
//  5 shader: the default position string is the shipped one
//    (sha256 pin); the distribution segment splices after
//    the placement and before the transform; the seed
//    variant shifts the placement draws; the mask variant
//    distributes its candidates; NO variant adds a sampler
//  6 capability: an effective layer or a non-zero shader
//    seed requests its unsupported feature (routes to
//    WebGL); defaults request neither
//  7 key registration: the 2 new keys sit at their defaults;
//    the seed phase contract
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { parseDistributionOps, resolveDistributionOps, distributionActive, applyDistributionOps, packDistributionOps, DIST_OP_IDS, DIST_GLSL } from './lib/gpgpuDistribution.ts';
      export { dmHash11, mulberry32, channelHash, DM_HASH11_GLSL, shaderSeedActive, resolveShaderSeedPhase } from './lib/gpgpuRandom.ts';
      export { createSeededRng } from './lib/seededRng.ts';
      export { mulberry32 as lifeMulberry32 } from './lib/gpgpuParticleLife.ts';
      export { mulberry32 as lsysMulberry32 } from './lib/lSystem.ts';
      export { createSeededRng as breedingRng } from './lib/presetBreeding.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
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
  parseDistributionOps, resolveDistributionOps, distributionActive,
  applyDistributionOps, packDistributionOps, DIST_OP_IDS, DIST_GLSL,
  dmHash11, mulberry32, channelHash, DM_HASH11_GLSL,
  shaderSeedActive, resolveShaderSeedPhase,
  createSeededRng, lifeMulberry32, lsysMulberry32, breedingRng,
  buildPositionFragment, SIM_POS_FRAG, getWebgpuComputeCapabilityReport,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 1. Random commonisation (values unchanged) ───────────
// The pre-B5 bodies, embedded verbatim as references.
function legacyDmHash11(n) {
  const fract = (v) => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function legacyMulberryA(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function legacyMulberryB(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  let ok = true;
  for (let i = -500; i <= 500; i++) {
    for (const n of [i, i * 0.37, i * 127.1 + 311.7, i * 1013.77]) {
      if (dmHash11(n) !== legacyDmHash11(n)) ok = false;
    }
  }
  check('1 shared dmHash11 == legacy body over the grid', ok);
}
{
  let ok = true;
  for (const seed of [0, 1, 42, 1234, 2147483647, 987654321, -7]) {
    const shared = mulberry32(seed);
    const la = legacyMulberryA(seed);
    const lb = legacyMulberryB(seed);
    for (let i = 0; i < 10000; i++) {
      const v = shared();
      if (v !== la() || v !== lb()) { ok = false; break; }
    }
    if (!ok) break;
  }
  check('1 shared mulberry32 == both legacy variants (10k draws x 7 seeds)', ok);
}
{
  const streams = [
    ['seededRng.createSeededRng', createSeededRng],
    ['gpgpuParticleLife.mulberry32', lifeMulberry32],
    ['lSystem.mulberry32', lsysMulberry32],
    ['presetBreeding.createSeededRng', breedingRng],
  ];
  for (const [name, fn] of streams) {
    const a = fn(777);
    const b = mulberry32(777);
    let ok = true;
    for (let i = 0; i < 1000; i++) if (a() !== b()) { ok = false; break; }
    check(`1 ${name} delegates to the shared stream`, ok);
  }
}
check('1 channelHash is deterministic, channel-separated, in [0,1)',
  channelHash(3, 42) === channelHash(3, 42)
  && channelHash(3, 42) !== channelHash(4, 42)
  && channelHash(3, 42) >= 0 && channelHash(3, 42) < 1);
{
  // The canonical GLSL text is the position shader's local
  // copy modulo whitespace (the shader keeps its copy; the
  // assembled strings are pinned by their own phase tests).
  const strip = (s) => s.replace(/\s+/g, '');
  const m = SIM_POS_FRAG.match(/float dmHash11\(float n\) \{[\s\S]*?\n\s*\}/);
  check('1 DM_HASH11_GLSL matches the shader copy (whitespace-free)',
    !!m && strip(m[0]) === strip(DM_HASH11_GLSL), m ? '' : 'no dmHash11 in SIM_POS_FRAG');
}

// ── 2. Distribution resolution ───────────────────────────
check('2 empty / invalid / non-array resolve to no layer',
  parseDistributionOps('').length === 0
  && parseDistributionOps(null).length === 0
  && parseDistributionOps('{oops').length === 0
  && parseDistributionOps('{"op":"power"}').length === 0
  && parseDistributionOps('[1,2]').length === 0);
check('2 identity operators are dropped',
  parseDistributionOps('[{"op":"power","a":1}]').length === 0
  && parseDistributionOps('[{"op":"stratify","a":1}]').length === 0
  && parseDistributionOps('[{"op":"cluster","a":4,"b":0}]').length === 0);
check('2 parameters are sanitised and clamped',
  (() => {
    const ops = parseDistributionOps('[{"op":"power","a":100},{"op":"stratify","a":1000},{"op":"cluster","a":3.9,"b":2},{"op":"bogus"},{"op":"invert"}]');
    return ops.length === 4
      && ops[0].a === 20 && ops[1].a === 64
      && ops[2].a === 3 && ops[2].b === 1
      && ops[3].op === 'invert';
  })());
check('2 the layer caps at 8 operators',
  parseDistributionOps(JSON.stringify(Array.from({ length: 12 }, () => ({ op: 'invert' })))).length === 8);
check('2 distributionActive follows the resolved layer',
  !distributionActive({ gpgpuEmitDistribution: '' })
  && !distributionActive({ gpgpuEmitDistribution: '[{"op":"power","a":1}]' })
  && distributionActive({ gpgpuEmitDistribution: '[{"op":"power","a":0.5}]' }));

// ── 3. JS twin semantics ─────────────────────────────────
{
  const R = 100;
  const p = (ops, x, y, z) => applyDistributionOps(ops, x, y, z, R);
  check('3 power 2 pulls |p|=50 to 25', (() => {
    const [x, y, z] = p([{ op: 'power', a: 2, b: 0 }], 30, 40, 0);
    return approx(x, 15) && approx(y, 20) && approx(z, 0);
  })());
  check('3 power 0.5 pushes |p|=25 to 50', (() => {
    const [x, y] = p([{ op: 'power', a: 0.5, b: 0 }], 15, 20, 0);
    return approx(x, 30) && approx(y, 40);
  })());
  check('3 invert maps |p|=30 to 70', (() => {
    const [x, y] = p([{ op: 'invert', a: 0, b: 0 }], 18, 24, 0);
    return approx(Math.hypot(x, y), 70);
  })());
  check('3 stratify 4 snaps |p|=30 to the band centre 37.5', (() => {
    const [x, y] = p([{ op: 'stratify', a: 4, b: 0 }], 18, 24, 0);
    return approx(Math.hypot(x, y), 37.5);
  })());
  check('3 cluster strength 1 snaps azimuth to the sector centre', (() => {
    const th = (10 * Math.PI) / 180;
    const [x, , z] = p([{ op: 'cluster', a: 4, b: 1 }], 50 * Math.cos(th), 0, 50 * Math.sin(th));
    return approx(x, 50) && approx(z, 0);
  })());
  check('3 cluster strength 0.5 halves the azimuth offset', (() => {
    const th = (10 * Math.PI) / 180;
    const [x, , z] = p([{ op: 'cluster', a: 4, b: 0.5 }], 50 * Math.cos(th), 0, 50 * Math.sin(th));
    return approx(Math.atan2(z, x), (5 * Math.PI) / 180, 1e-12);
  })());
  check('3 list order matters', (() => {
    const fwd = p([{ op: 'power', a: 2, b: 0 }, { op: 'invert', a: 0, b: 0 }], 30, 40, 0);
    const rev = p([{ op: 'invert', a: 0, b: 0 }, { op: 'power', a: 2, b: 0 }], 30, 40, 0);
    return !approx(Math.hypot(...fwd), Math.hypot(...rev), 1e-6);
  })());
  check('3 origin and zero radius are untouched',
    p([{ op: 'power', a: 2, b: 0 }], 0, 0, 0).every((v) => v === 0)
    && applyDistributionOps([{ op: 'power', a: 2, b: 0 }], 3, 4, 0, 0).join() === '3,4,0');
  check('3 pack layout follows DIST_OP_IDS', (() => {
    const packed = packDistributionOps([{ op: 'power', a: 2, b: 0 }, { op: 'cluster', a: 6, b: 0.5 }]);
    return packed.length === 32
      && packed[0] === DIST_OP_IDS.power && packed[1] === 2
      && packed[4] === DIST_OP_IDS.cluster && packed[5] === 6 && packed[6] === 0.5
      && packed.slice(8).every((v) => v === 0);
  })());
}

// ── 4. Bake ──────────────────────────────────────────────
// Pins measured on this tree BEFORE the E1 refactor (the
// same pins scripts/stage2-emitter-e01.test.mjs carries):
// texSize 16, radius 100, seed 1234, ageMax 8; light at
// (10, 20, 30).
const BAKE_PINS = {
  sphere: ['485ca667bb0c060d738b092fda8a97c3ebc430355d4f70dc05b83ee237c06c29', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
  disc: ['7e219c7efd5f1e09164bb1e6809850679fc7e890c5bb174982077a65bca124d1', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  ring: ['3881b0d5da59346db89d8ef04fe0d6cfd7228124b20a9f05935e4889b6945664', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
  box: ['76f0a6969084bc052f4f15cae6d995d3e9914e5a6439dc40db568edc04d152d2', 'c960655fe5d8bd5819854df08103114b691296f879b7e275e5cc25671554c1dd'],
  shell: ['a28acd5bdb8053ba92e87610c95727e6d0026ce20b41839af36e48a43dd0d554', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  cone: ['c56257a1f8563abd515edc61e02c55de72624c83fcc178adf38dcbf0629aca8c', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  light: ['928713b64f5fd64d5d8acd08d1590724dfcad537b6b3c5c39304bb9b06ce1fef', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
};
for (const shape of Object.keys(BAKE_PINS)) {
  const opts = shape === 'light' ? { lightPos: { x: 10, y: 20, z: 30 } } : null;
  const d = buildGpgpuInitialData(16, 100, shape, 1234, 8, null, opts);
  check(`4 bake bit-identical with no layer (${shape})`,
    sha256(Buffer.from(d.posData.buffer)) === BAKE_PINS[shape][0]
    && sha256(Buffer.from(d.velData.buffer)) === BAKE_PINS[shape][1]);
}
{
  const plain = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, null);
  const emptyOps = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, { distribution: [] });
  check('4 an explicit empty layer is a bake no-op',
    Buffer.from(emptyOps.posData.buffer).equals(Buffer.from(plain.posData.buffer)));
  const ops = parseDistributionOps('[{"op":"power","a":0.5}]');
  const dist = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, { distribution: ops });
  check('4 an effective layer moves positions but never velocities',
    sha256(Buffer.from(dist.posData.buffer)) !== BAKE_PINS.sphere[0]
    && sha256(Buffer.from(dist.velData.buffer)) === BAKE_PINS.sphere[1]);
  let agesOk = true;
  let lawOk = true;
  for (let i = 0; i < 256; i++) {
    if (dist.posData[i * 4 + 3] !== plain.posData[i * 4 + 3]) agesOk = false;
    const l0 = Math.hypot(plain.posData[i * 4], plain.posData[i * 4 + 1], plain.posData[i * 4 + 2]);
    const l1 = Math.hypot(dist.posData[i * 4], dist.posData[i * 4 + 1], dist.posData[i * 4 + 2]);
    if (l0 > 1e-6 && Math.abs(l1 - 100 * Math.pow(l0 / 100, 0.5)) > 1e-3) lawOk = false;
  }
  check('4 ages are bit-identical under the layer', agesOk);
  check('4 the radial power law holds per particle', lawOk);
}

// ── 5. Shader ────────────────────────────────────────────
check('5 default position string is the shipped one (sha256 pin)',
  sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49');
check('5 default string carries neither B5 variant',
  !SIM_POS_FRAG.includes('kaloDistApply') && !SIM_POS_FRAG.includes('uShaderSeedPhase'));
{
  const dist = buildPositionFragment({ emitDistribution: true });
  check('5 distribution variant splices the layer after the placement',
    dist.includes('pos = kaloDistApply(pos, uBounceRadius);')
    && dist.indexOf('pos = kaloDistApply') > dist.indexOf('float r   = uBounceRadius')
    && dist.includes('uniform vec4 uDistOps[8];'));
  const distFrame = buildPositionFragment({ emitDistribution: true, emitterTransform: true });
  check('5 distribution runs before the emitter transform',
    distFrame.indexOf('pos = kaloDistApply') < distFrame.indexOf('pos = uEmitterPos + uEmitterRotScale * pos;'));
  const shapeDist = buildPositionFragment({ emitDistribution: true, emitterShape: true });
  check('5 distribution composes with the shape law',
    shapeDist.includes('kaloEmitShapePos') && shapeDist.includes('pos = kaloDistApply(pos, uBounceRadius);'));
  const cloudDist = buildPositionFragment({ emitDistribution: true, emitterCloud: true });
  check('5 cloud placements are not distributed',
    cloudDist.includes('uEmitCloudTex') && !cloudDist.includes('pos = kaloDistApply'));
}
{
  const seedLegacy = buildPositionFragment({ shaderSeed: true });
  check('5 seed variant shifts the legacy draws',
    seedLegacy.includes('vec2(1.3 + uShaderSeedPhase)')
    && seedLegacy.includes('vec2(age + uShaderSeedPhase)')
    && seedLegacy.includes('uniform float uShaderSeedPhase;'));
  const seedShape = buildPositionFragment({ shaderSeed: true, emitterShape: true });
  check('5 seed variant shifts the shape-law draws',
    seedShape.includes('vec2(11.1 + uShaderSeedPhase)'));
  const seedPath = buildPositionFragment({ shaderSeed: true, emitterPath: true });
  check('5 seed variant shifts the path draw',
    seedPath.includes('vec2(61.7 + uShaderSeedPhase)'));
}
{
  const maskDist = buildPositionFragment({ emitterMask: true, emitDistribution: true });
  check('5 mask variant distributes its candidates',
    maskDist.includes('emitCand = kaloDistApply(emitCand, uBounceRadius);'));
  const maskSeed = buildPositionFragment({ emitterMask: true, shaderSeed: true });
  check('5 mask candidates carry the seed phase',
    maskSeed.includes('eOff + uShaderSeedPhase'));
  const maskPlain = buildPositionFragment({ emitterMask: true });
  check('5 mask variant without B5 keys is untouched',
    !maskPlain.includes('kaloDistApply') && !maskPlain.includes('uShaderSeedPhase'));
}
{
  const count = (s) => (s.match(/uniform sampler2D/g) || []).length;
  const base = count(SIM_POS_FRAG);
  check('5 no B5 variant adds a sampler (texture units unchanged)',
    count(buildPositionFragment({ emitDistribution: true })) === base
    && count(buildPositionFragment({ shaderSeed: true })) === base
    && count(buildPositionFragment({ emitDistribution: true, shaderSeed: true, emitterMask: true, emitterShape: true })) === base,
    `base=${base}`);
}
check('5 DIST_GLSL carries the four operator branches',
  DIST_GLSL.includes('kaloDistApply')
  && DIST_GLSL.includes('pow(len / radius, opv.y)')
  && DIST_GLSL.includes('radius - len')
  && DIST_GLSL.includes('floor(u * opv.y)')
  && DIST_GLSL.includes('atan(p.z, p.x)'));

// ── 6. Capability ────────────────────────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  const reportDefault = getWebgpuComputeCapabilityReport(base);
  check('6 defaults request neither B5 feature',
    !reportDefault.unsupportedFeatures.includes('emission-distribution')
    && !reportDefault.unsupportedFeatures.includes('shader-seed'));
  const reportDist = getWebgpuComputeCapabilityReport({ ...base, gpgpuEmitDistribution: '[{"op":"power","a":0.5}]' });
  check('6 an effective layer routes to WebGL',
    reportDist.unsupportedFeatures.includes('emission-distribution')
    && reportDist.canRunRequestedConfig === false);
  const reportIdentity = getWebgpuComputeCapabilityReport({ ...base, gpgpuEmitDistribution: '[{"op":"power","a":1}]' });
  check('6 an identity-only layer requests nothing',
    !reportIdentity.unsupportedFeatures.includes('emission-distribution'));
  const reportSeed = getWebgpuComputeCapabilityReport({ ...base, gpgpuShaderSeed: 7 });
  check('6 a non-zero shader seed routes to WebGL',
    reportSeed.unsupportedFeatures.includes('shader-seed'));
}

// ── 7. Keys + seed phase ─────────────────────────────────
check('7 the 2 new keys sit at their defaults',
  APP_STATE_DEFAULT_GPGPU.gpgpuEmitDistribution === ''
  && APP_STATE_DEFAULT_GPGPU.gpgpuShaderSeed === 0);
check('7 seed phase contract',
  !shaderSeedActive({ gpgpuShaderSeed: 0 })
  && shaderSeedActive({ gpgpuShaderSeed: 2 })
  && resolveShaderSeedPhase({ gpgpuShaderSeed: 0 }) === 0
  && approx(resolveShaderSeedPhase({ gpgpuShaderSeed: 2 }), 34.3434, 1e-9));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
