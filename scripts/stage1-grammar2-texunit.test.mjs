// Grammar 2.0 stage 1 — texture-unit fix for the live-rules
// variants (real-GPU gate finding: the velocity live variant
// declared 17 fragment samplers against the resident 16-unit
// budget and failed validation with "FRAGMENT shader texture
// image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)").
// Record: kalokagathia-pro/STAGE1_TEXUNIT_FIX_RECORD.md.
//
// The fix: in the live variants only, spawnGateValue derives
// the baked max-normalised initial distance from the
// initial-position texture divided by uSpawnOrderMaxDist
// instead of sampling uSpawnOrderTex, so the velocity live
// variant gives the unit back (17 -> 16) and the position
// live variant swaps sampler-for-sampler (stays 11). The
// non-live strings must stay bit-identical (sha pins below
// are the ones the slice-1A test pins against v2.22.0).
//
// Cases:
//  1 sampler census (sampler2D + sampler3D declarations):
//    every consumer fragment fits the 16-unit floor; the
//    live velocity variant is back at 16; the live delta is
//    +0 for velocity and +1 (the REP texture alone) for
//    position across option combinations
//  2 identity: stock velocity / position strings keep their
//    sha256 pins and contain no fix uniform; the no-option
//    builders still return the stock strings
//  3 derivation: the live variants drop the order sampler,
//    declare the normaliser, and share the identical derived
//    spawnGateValue body across both passes; the stock read
//    occurs exactly once per stock string (replace safety)
//  4 CPU twin: spawnDistanceMaxValue / spawnGateDistanceValue
//    reproduce buildSpawnDistanceValues (near mode) within
//    float tolerance, including the zero-pool and argmax
//    edges
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1tex-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildRuleEvalFragment } from './lib/gpgpuParticleRulesLive.ts';
      export { CONTACT_FRAG } from './components/gpgpuContactPass.ts';
      export { buildDrawVert, DRAW_VERT } from './components/gpgpuShaderPoints.ts';
      export { buildSpawnDistanceValues, spawnDistanceMaxValue, spawnGateDistanceValue } from './lib/gpgpuLifecycle.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG,
  buildRuleEvalFragment, CONTACT_FRAG, buildDrawVert, DRAW_VERT,
  buildSpawnDistanceValues, spawnDistanceMaxValue, spawnGateDistanceValue,
} = lib;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform\s+sampler[23]D\s+[A-Za-z0-9_]+/g) || []).length;
const occurrences = (s, needle) => s.split(needle).length - 1;

// --- 1. sampler census ---------------------------------------------------
check('1a stock velocity sits exactly at the 16-unit floor',
  samplerCount(SIM_VEL_FRAG) === 16, String(samplerCount(SIM_VEL_FRAG)));
const velLive = buildVelocityFragment('', undefined, { particleRulesLive: true });
check('1b velocity live variant is back inside the floor (16)',
  samplerCount(velLive) === 16, String(samplerCount(velLive)));
const OPTION_SETS = [
  {},
  { steeringSeek: true, crowd: true },
  { sphAkinci: true, attractor2: true, attractor3: true, attractor4: true },
  { flip3dCouple: true, spawnAlloc: true, emitterVelocity: true, particleRules: true },
  { grainsFullScan: true },
];
let netZero = true;
let netDetail = '';
for (const opts of OPTION_SETS) {
  const plain = buildVelocityFragment('', undefined, opts);
  const live = buildVelocityFragment('', undefined, { ...opts, particleRulesLive: true });
  if (samplerCount(live) !== samplerCount(plain)) {
    netZero = false;
    netDetail = `${JSON.stringify(opts)}: plain ${samplerCount(plain)} vs live ${samplerCount(live)}`;
  }
}
check('1c velocity live delta is +0 samplers for every option set', netZero, netDetail);
check('1d stock position is 10, live position is 11 (REP texture only)',
  samplerCount(SIM_POS_FRAG) === 10
  && samplerCount(buildPositionFragment({ particleRulesLive: true })) === 11,
  `${samplerCount(SIM_POS_FRAG)} / ${samplerCount(buildPositionFragment({ particleRulesLive: true }))}`);
const posAllLive = buildPositionFragment({
  grainsProjection: true, grainsCellSort: true, particleRules: true, particleRulesLive: true,
  emitterShape: true, emitterTransform: true, spawnAlloc: true, spawnRuleGate: true,
});
check('1e position live variant with every option stays inside the floor',
  samplerCount(posAllLive) <= 16, String(samplerCount(posAllLive)));
{
  const rule = (id, condition, action) => ({ id, enabled: true, target: { type: 'all' }, condition, action });
  const rep = buildRuleEvalFragment([
    rule('r1', 'vel > 1', { type: 'force-gate', force: 'gravity' }),
    rule('r2', 'sdf < 0', { type: 'kill' }),
    rule('r3', 'hit > 0', { type: 'true-kill' }),
    rule('r4', 'slot7 > 0.5', { type: 'set-state', state: 3 }),
    rule('r5', 'den > 0.1', { type: 'display', size: 0.5, opacity: 1 }),
  ], { names: ['a', 'b', 'c', 'd'], names2: ['i', 'j', 'k', 'l'], densityAvailable: true });
  check('1f REP maximal fragment (sim+den+sdf+hit+ext) fits the floor',
    rep !== null && samplerCount(rep) <= 16, rep === null ? 'null' : String(samplerCount(rep)));
}
check('1g contact pass fragment fits the floor', samplerCount(CONTACT_FRAG) <= 16,
  String(samplerCount(CONTACT_FRAG)));
check('1h draw vertex (vertex-unit budget) with every option fits the floor',
  samplerCount(buildDrawVert({ vellumCrack: true, clusterColor: true, shadowMap: true, shadowTunnel: true, ruleDisplay: true })) <= 16
  && samplerCount(DRAW_VERT) === 8);

// --- 2. identity -----------------------------------------------------------
check('2a stock velocity string keeps its sha256 pin',
  sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha(SIM_VEL_FRAG));
check('2b stock position string keeps its sha256 pin',
  sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha(SIM_POS_FRAG));
check('2c stock strings carry no fix uniform and keep the order sampler',
  !SIM_VEL_FRAG.includes('uSpawnOrderMaxDist')
  && !SIM_POS_FRAG.includes('uSpawnOrderMaxDist')
  && SIM_VEL_FRAG.includes('uniform sampler2D uSpawnOrderTex;')
  && SIM_POS_FRAG.includes('uniform sampler2D uSpawnOrderTex;'));
check('2d no-option builders still return the stock strings',
  buildVelocityFragment('') === SIM_VEL_FRAG && buildPositionFragment({}) === SIM_POS_FRAG
  && buildVelocityFragment('', undefined, {}) === SIM_VEL_FRAG);

// --- 3. derivation ---------------------------------------------------------
const DERIVED_READ = 'float v = clamp(length(texture2D(uInitPosTex, uv).xyz) / max(uSpawnOrderMaxDist, 1.0e-6), 0.0, 1.0);';
const posLive = buildPositionFragment({ particleRulesLive: true });
check('3a velocity live drops the order sampler, declares the normaliser',
  !velLive.includes('uniform sampler2D uSpawnOrderTex;')
  && velLive.includes('uniform float uSpawnOrderMaxDist;')
  && velLive.includes('uniform sampler2D uRuleLiveTex;'));
check('3b position live swaps order sampler for the initial-position sampler',
  !posLive.includes('uniform sampler2D uSpawnOrderTex;')
  && posLive.includes('uniform sampler2D uInitPosTex;')
  && posLive.includes('uniform float uSpawnOrderMaxDist;'));
check('3c both live variants share the identical derived gate read',
  velLive.includes(DERIVED_READ) && posLive.includes(DERIVED_READ)
  && occurrences(velLive, DERIVED_READ) === 1 && occurrences(posLive, DERIVED_READ) === 1);
check('3d stock gate read occurs exactly once per stock string (replace safety)',
  occurrences(SIM_VEL_FRAG, 'float v = texture2D(uSpawnOrderTex, uv).r;') === 1
  && occurrences(SIM_POS_FRAG, 'float v = texture2D(uSpawnOrderTex, uv).r;') === 1
  && occurrences(SIM_VEL_FRAG, 'uniform sampler2D uSpawnOrderTex;') === 1
  && occurrences(SIM_POS_FRAG, 'uniform sampler2D uSpawnOrderTex;') === 1);
check('3e non-live variants keep the stock gate read (no derivation leakage)',
  buildVelocityFragment('', undefined, { particleRules: true }).includes('float v = texture2D(uSpawnOrderTex, uv).r;')
  && buildPositionFragment({ particleRules: true }).includes('float v = texture2D(uSpawnOrderTex, uv).r;')
  && !buildPositionFragment({ particleRules: true }).includes('uSpawnOrderMaxDist'));

// --- 4. CPU twin ------------------------------------------------------------
{
  // Deterministic pseudo-random pool (LCG), stride-4 xyzw.
  let seed = 123456789;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const n = 1024;
  const pos = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) pos[i] = (rnd() - 0.5) * 300;
  const baked = buildSpawnDistanceValues(pos, false);
  const maxDist = spawnDistanceMaxValue(pos);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const twin = spawnGateDistanceValue(pos[i * 4], pos[i * 4 + 1], pos[i * 4 + 2], maxDist);
    worst = Math.max(worst, Math.abs(twin - baked[i]));
  }
  check('4a twin reproduces the bake within 1e-6 over a random pool', worst <= 1e-6, `worst ${worst}`);
  check('4b max value matches the bake normaliser',
    Math.abs(maxDist - Math.max(...Array.from({ length: n }, (_, i) => Math.hypot(pos[i * 4], pos[i * 4 + 1], pos[i * 4 + 2])))) < 1e-9);
  const zero = new Float32Array(16 * 4);
  check('4c zero pool: max 0 and every twin value 0',
    spawnDistanceMaxValue(zero) === 0
    && buildSpawnDistanceValues(zero, false).every((v) => v === 0)
    && spawnGateDistanceValue(0, 0, 0, 0) === 0);
  const single = new Float32Array([3, 4, 0, 1]);
  check('4d single off-origin particle: bake and twin are exactly 1',
    buildSpawnDistanceValues(single, false)[0] === 1
    && spawnGateDistanceValue(3, 4, 0, spawnDistanceMaxValue(single)) === 1);
  check('4e twin clamps an over-max input to 1 (float-rounding guard)',
    spawnGateDistanceValue(10, 0, 0, 5) === 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
