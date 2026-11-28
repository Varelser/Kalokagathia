// Grammar 2.0 stage 1, fracture follow-up — live fracture
// trigger consumption (the slice-1C cut-off). Design: the
// OR composition fixed in STAGE1_1C_IMPL_RECORD.md and the
// readback-driven route + frequency limits fixed in
// lib/gpgpuLiveFracture.ts.
//
// Cases:
//  1 trigger extraction: REP .r (RGBA-packed) → bit-7 set
//  2 gate: first activation, same-set suppression, subset
//    suppression, cooldown (deferred set not consumed),
//    delta-only re-activation, reset
//  3 set signature: order / duplicate independence
//  4 OR composition: static wins wholesale, live only adds,
//    live options mirror the static builder's clamps
//  5 composite: empty = identity, full = the bake's own
//    transform byte-identical, partial = per-particle
//    selection with w untouched, determinism, gap 0
//  6 upstream detection: a live fracture rule classifies
//    'live' (the scene's readback gate can fire); a broken
//    condition classifies 'never'
//  7 identity / wiring: default velocity / position strings
//    stay the shipped v2.22.0 strings; the readback → gate →
//    re-bake wiring is present in the scene / runtime / REP
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1f-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { extractLiveFractureTriggerSet, liveFractureSetSignature, createLiveFractureTriggerGate, liveFractureOptionsFromConfig, resolveLiveFractureBake, applyLiveFractureComposite, LIVE_FRACTURE_MIN_INTERVAL_FRAMES } from './lib/gpgpuLiveFracture.ts';
      export { applyVoronoiFracture, fractureOptionFromConfig } from './lib/voronoiFracture.ts';
      export { classifyLiveRules, resolveLiveParticleRules, LIVE_RULE_FRACTURE_BIT } from './lib/gpgpuParticleRulesLive.ts';
      export { SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  extractLiveFractureTriggerSet, liveFractureSetSignature,
  createLiveFractureTriggerGate, liveFractureOptionsFromConfig,
  resolveLiveFractureBake, applyLiveFractureComposite,
  LIVE_FRACTURE_MIN_INTERVAL_FRAMES,
  applyVoronoiFracture, fractureOptionFromConfig,
  classifyLiveRules, resolveLiveParticleRules, LIVE_RULE_FRACTURE_BIT,
  SIM_VEL_FRAG, SIM_POS_FRAG,
} = lib;

const FULL_PERMIT = 3871; // 1C: G10 five permits + extension four, no kill bits
const FRAC = LIVE_RULE_FRACTURE_BIT; // 128
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const eqF32 = (a, b) => a.length === b.length && [...a].every((v, i) => v === b[i]);

// --- 1. trigger extraction -------------------------------------------------------------
{
  // RGBA-packed REP readback: mask in .r, other channels noise.
  const rgba = new Float32Array([
    FULL_PERMIT + FRAC, 0.5, 7, 1 + 0.4, // fracture
    FULL_PERMIT, 0, 0, 0, // permits only — no fracture
    FRAC, 0, 0, 0, // fracture alone
    64, 0, 0, 0, // true-kill only — no fracture
    Number.NaN, 0, 0, 0, // non-finite never triggers
  ]);
  check('1a RGBA-packed readback extracts exactly the bit-7 particles',
    eqArr(extractLiveFractureTriggerSet(rgba, 5), [0, 2]),
    JSON.stringify(extractLiveFractureTriggerSet(rgba, 5)));
  check('1b plain mask array (stride 1) extracts the same way',
    eqArr(extractLiveFractureTriggerSet([0, FRAC, FRAC + 32, 31], 4, 1), [1, 2]));
  check('1c an all-quiet buffer extracts an empty set',
    eqArr(extractLiveFractureTriggerSet(new Float32Array(16), 4), []));
}

// --- 2. gate: activation + frequency limits ---------------------------------------------
{
  const gate = createLiveFractureTriggerGate();
  const first = gate.consider([5, 3, 3, 9], 0);
  check('2a the first presentation activates immediately (no initial cooldown)',
    !!first && eqArr(first.added, [3, 5, 9]) && first.totalFractured === 3,
    JSON.stringify(first));
  check('2b the same set again is suppressed, even long after the cooldown',
    gate.consider([9, 5, 3], LIVE_FRACTURE_MIN_INTERVAL_FRAMES + 100) === null);
  check('2c a subset of the fractured union is suppressed',
    gate.consider([3], LIVE_FRACTURE_MIN_INTERVAL_FRAMES + 200) === null);
  const during = gate.consider([3, 12], 10); // inside the 30-frame cooldown
  check('2d a new particle inside the cooldown does NOT activate and is not consumed',
    during === null && !gate.fractured.has(12) && gate.activationCount === 1);
  const after = gate.consider([3, 12], LIVE_FRACTURE_MIN_INTERVAL_FRAMES);
  check('2e the deferred set activates at the cooldown boundary with only the delta',
    !!after && eqArr(after.added, [12]) && after.totalFractured === 4,
    JSON.stringify(after));
  check('2f activation bookkeeping: count and last frame',
    gate.activationCount === 2 && gate.lastActivationFrame === LIVE_FRACTURE_MIN_INTERVAL_FRAMES);
  gate.reset();
  const again = gate.consider([3], 31);
  check('2g reset clears the union and the cooldown (a new history can re-fire)',
    gate.activationCount === 1 && !!again && eqArr(again.added, [3]));
  check('2h an empty presentation never activates',
    createLiveFractureTriggerGate().consider([], 0) === null);
}

// --- 3. set signature ---------------------------------------------------------------------
{
  check('3a signature is order- and duplicate-independent',
    liveFractureSetSignature([9, 3, 5, 3]) === liveFractureSetSignature([5, 9, 3]));
  check('3b different sets have different signatures',
    liveFractureSetSignature([3, 5]) !== liveFractureSetSignature([3, 6])
    && liveFractureSetSignature([3, 5]) !== liveFractureSetSignature([3, 5, 7]));
}

// --- 4. OR composition ----------------------------------------------------------------------
{
  const base = {
    gpgpuMorphFractureCells: 20, gpgpuMorphFractureSeed: 7, gpgpuMorphFractureGap: 0.4,
  };
  const union = new Set([1, 2]);
  const staticOn = resolveLiveFractureBake({ ...base, gpgpuMorphFractureEnabled: true }, union);
  check('4a static enabled resolves static (live adds nothing, even with a union)',
    staticOn.source === 'static'
    && JSON.stringify(staticOn.options) === JSON.stringify(fractureOptionFromConfig({ ...base, gpgpuMorphFractureEnabled: true })));
  const none = resolveLiveFractureBake({ ...base, gpgpuMorphFractureEnabled: false }, new Set());
  check('4b static off + empty union resolves none with null options',
    none.source === 'none' && none.options === null);
  const live = resolveLiveFractureBake({ ...base, gpgpuMorphFractureEnabled: false }, union);
  check('4c static off + union resolves live with the keys’ cells / seed / gap',
    live.source === 'live' && live.options.cells === 20 && live.options.seed === 7 && live.options.gap === 0.4,
    JSON.stringify(live));
  check('4d live options are the static builder’s options for the same fields',
    JSON.stringify(liveFractureOptionsFromConfig(base))
    === JSON.stringify(fractureOptionFromConfig({ ...base, gpgpuMorphFractureEnabled: true })));
  const clamped = liveFractureOptionsFromConfig({
    gpgpuMorphFractureCells: 1000, gpgpuMorphFractureSeed: Number.NaN, gpgpuMorphFractureGap: 5,
  });
  check('4e live options carry the static clamps (cells 2..256, seed fallback 1, gap 0..1)',
    clamped.cells === 256 && clamped.seed === 1 && clamped.gap === 1, JSON.stringify(clamped));
  check('4f the live path can never weaken a static fracture: source stays static for any union',
    resolveLiveFractureBake({ ...base, gpgpuMorphFractureEnabled: true }, new Set([0, 1, 2, 3])).source === 'static');
}

// --- 5. composite ----------------------------------------------------------------------------
{
  const N = 64;
  const makeCloud = () => {
    const data = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      data[i * 4] = ((i % 8) - 3.5) * 3;
      data[i * 4 + 1] = ((Math.floor(i / 8) % 8) - 3.5) * 3;
      data[i * 4 + 2] = ((i * 7) % 5 - 2) * 2;
      data[i * 4 + 3] = i; // w sentinel: must survive untouched
    }
    return data;
  };
  const options = { cells: 4, seed: 3, gap: 0.5 };
  const reference = makeCloud();
  applyVoronoiFracture(reference, N, options);

  const emptyData = makeCloud();
  const emptyRes = applyLiveFractureComposite(emptyData, N, new Set(), options);
  check('5a empty set: moved 0 and the array is bit-identical',
    emptyRes.moved === 0 && eqF32(emptyData, makeCloud()));

  const fullData = makeCloud();
  const fullSet = new Set([...Array(N).keys()]);
  const fullRes = applyLiveFractureComposite(fullData, N, fullSet, options);
  check('5b full set: byte-identical to the bake’s own fracture transform',
    fullRes.moved === N && eqF32(fullData, reference));

  const partData = makeCloud();
  const original = makeCloud();
  const partSet = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const partRes = applyLiveFractureComposite(partData, N, partSet, options);
  let partOk = partRes.moved === 10;
  for (let i = 0; i < N && partOk; i++) {
    const src = partSet.has(i) ? reference : original;
    for (let c = 0; c < 4; c++) if (partData[i * 4 + c] !== src[i * 4 + c]) partOk = false;
  }
  check('5c partial set: triggered take the fractured positions, others + every w stay original', partOk);

  const againData = makeCloud();
  applyLiveFractureComposite(againData, N, partSet, options);
  check('5d determinism: the same inputs composite byte-identically twice',
    eqF32(againData, partData));

  const gap0Data = makeCloud();
  applyLiveFractureComposite(gap0Data, N, fullSet, { ...options, gap: 0 });
  check('5e gap 0 is an exact identity even for the full set', eqF32(gap0Data, makeCloud()));

  const oobData = makeCloud();
  const oobRes = applyLiveFractureComposite(oobData, N, new Set([0, N + 5, -1]), options);
  check('5f out-of-range indices are ignored, in-range ones still move',
    oobRes.moved === 1 && oobData[0] === reference[0] && oobData[4] === original[4]);
}

// --- 6. upstream detection ---------------------------------------------------------------------
{
  const NAMES = ['a', 'b', 'c', 'd'];
  const NAMES2 = ['i', 'j', 'k', 'l'];
  const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
  const rule = (id, action, condition = '') => ({ id, enabled: true, target: { type: 'all' }, condition, action });
  const live = classifyLiveRules(
    resolveLiveParticleRules(JSON.stringify([rule('f1', { type: 'fracture' }, 'age > 0.5')])), OPTS);
  check('6a a fracture rule with a live condition classifies live (readback gate can fire)',
    live.length === 1 && live[0].route === 'live' && live[0].rule.action.type === 'fracture',
    JSON.stringify(live.map((c) => c.route)));
  const broken = classifyLiveRules(
    resolveLiveParticleRules(JSON.stringify([rule('f2', { type: 'fracture' }, 'age >>')])), OPTS);
  check('6b a fracture rule with an uncompilable condition never fires',
    broken.length === 1 && broken[0].route === 'never', JSON.stringify(broken.map((c) => c.route)));
}

// --- 7. identity / wiring -----------------------------------------------------------------------
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  check('7a default velocity string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha(SIM_VEL_FRAG));
  check('7b default position string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha(SIM_POS_FRAG));
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  check('7c the scene reads the REP back only under the fracture gate and feeds the runtime',
    sceneSrc.includes('ruleLiveHasFracture')
    && sceneSrc.includes('readRenderTargetPixels')
    && sceneSrc.includes('runtime.noteLiveFractureMask')
    && sceneSrc.includes('runtime.resetLiveFracture()'));
  const runtimeSrc = readFileSync(join(ROOT, 'components', 'useGpgpuRuntime.ts'), 'utf8');
  check('7d the runtime composites in the bake and re-bakes on the gate version',
    runtimeSrc.includes('applyLiveFractureComposite')
    && runtimeSrc.includes('resolveLiveFractureBake')
    && runtimeSrc.includes('liveFractureVersion'));
  const repSrc = readFileSync(join(ROOT, 'components', 'gpgpuRuleEvalPass.ts'), 'utf8');
  check('7e the REP exposes the target it last wrote', repSrc.includes('get currentTarget()'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
