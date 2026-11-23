// Phase 19 stage 5 — deposit–bleed reaction model （堆積・にじみ）.
// The deposit channel must stay in the field (no decay at the
// default retention 1, saturating clamp at 1), and the bleed
// channel must spread widely (radius-2 convex blur) while decaying
// via the reused Kill key. The TS twin in lib/reactionDepositBleed.ts
// is the math the GLSL branch (model 3) mirrors; the structural
// checks at the end pin the mirror constants and the identity
// guarantee (the model exists only when selected).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p19db-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { DEPOSIT_BLEED_MODEL_ID, BLEED_SPREAD, BLEED_SOURCE_RATE, BLEED_DECAY_RATE, DEPOSIT_DISPLAY_WEIGHT, BLEED_DISPLAY_WEIGHT, BLEED_BLUR_WEIGHTS, BLEED_BLUR_OFFSETS, depositBleedStep, depositBleedPattern, resolveDepositRetention, stepDepositBleedField } from './lib/reactionDepositBleed.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  DEPOSIT_BLEED_MODEL_ID, BLEED_BLUR_WEIGHTS, BLEED_BLUR_OFFSETS,
  depositBleedStep, depositBleedPattern, resolveDepositRetention, stepDepositBleedField,
} = lib;

const params = (over = {}) => ({
  feed: 0.035, kill: 0.062, dA: 1.0, dB: 0.5, dt: 1, pulse: 0, retention: 1, ...over,
});
const blankField = (size) => {
  const f = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) { f[i * 4] = 1; f[i * 4 + 3] = 0; }
  return f;
};
const sumChannel = (f, c) => { let s = 0; for (let i = 0; i < f.length / 4; i += 1) s += f[i * 4 + c]; return s; };
const maxChannel = (f, c) => { let m = 0; for (let i = 0; i < f.length / 4; i += 1) m = Math.max(m, f[i * 4 + c]); return m; };

// --- resolution / constants ---------------------------------------
{
  check('model id is 3', DEPOSIT_BLEED_MODEL_ID === 3);
  check('retention defaults to 1 (no decay)', resolveDepositRetention(undefined) === 1);
  check('retention clamped to 0..1', resolveDepositRetention(7) === 1 && resolveDepositRetention(-2) === 0);
  check('blur weights sum to exactly 1 (convex, stable)',
    near(BLEED_BLUR_WEIGHTS.reduce((s, w) => s + w, 0), 1, 1e-12));
  check('blur offsets match weights, reach radius 2',
    BLEED_BLUR_OFFSETS.length === BLEED_BLUR_WEIGHTS.length
    && BLEED_BLUR_OFFSETS.some(([x, y]) => Math.abs(x) === 2 || Math.abs(y) === 2));
}

// --- deposit: residual / retention / clamp -------------------------
{
  // No wet pigment anywhere: at retention 1 the deposit is untouched.
  const size = 16;
  let f = blankField(size);
  f[(3 * size + 5) * 4 + 2] = 0.7;
  for (let s = 0; s < 20; s += 1) f = stepDepositBleedField(f, size, params());
  check('deposit residual: unchanged after 20 steps with no source (retention 1)',
    near(f[(3 * size + 5) * 4 + 2], 0.7, 1e-6), `got ${f[(3 * size + 5) * 4 + 2]}`);
  // Retention < 1 is the only decay, and it is exactly geometric.
  const out = depositBleedStep({ a: 1, b: 0, d: 0.8, l: 0 }, 0, 0, 0, params({ retention: 0.99 }));
  check('deposit retention decay is exactly d * retention', near(out.d, 0.8 * 0.99, 1e-12), `got ${out.d}`);
  // Sustained source: deposit rises monotonically and clamps at 1.
  let d = 0.9;
  let monotonic = true;
  let bounded = true;
  for (let s = 0; s < 300; s += 1) {
    const o = depositBleedStep({ a: 1, b: 1, d, l: 0 }, 0, 0, 0, params({ feed: 0.09 }));
    if (o.d < d) monotonic = false;
    if (o.d > 1) bounded = false;
    d = o.d;
  }
  check('deposit accumulates monotonically under a sustained source', monotonic);
  check('deposit never exceeds the clamp at 1', bounded && d > 0.99, `final ${d}`);
}

// --- deposit: field-level accumulation ------------------------------
{
  const size = 32;
  let f = blankField(size);
  const c = (size / 2 * size + size / 2) * 4;
  // Wet pigment disc (radius 2), like the seed texture's soft spots.
  for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
    if (x * x + y * y <= 4) f[((size / 2 + y) * size + (size / 2 + x)) * 4 + 1] = 1;
  }
  for (let s = 0; s < 200; s += 1) f = stepDepositBleedField(f, size, params({ feed: 0.09, kill: 0.001 }));
  check('deposit forms at the wet pigment spot', f[c + 2] > 0.4, `centre deposit ${f[c + 2]}`);
  check('deposit stays local (far texel nearly clean)', f[2] < 0.05, `far deposit ${f[2]}`);
}

// --- bleed: spread + conservation, then decay -----------------------
{
  const size = 32;
  const mk = () => { const f = blankField(size); f[(16 * size + 16) * 4 + 3] = 1; return f; };
  // Spread with no decay and no source: convex blur conserves the
  // total, the peak falls, and the support widens.
  let f = mk();
  const total0 = sumChannel(f, 3);
  for (let s = 0; s < 10; s += 1) f = stepDepositBleedField(f, size, params({ feed: 0, kill: 0 }));
  check('bleed spread conserves the total when Kill = 0', near(sumChannel(f, 3), total0, 1e-4),
    `${sumChannel(f, 3)} vs ${total0}`);
  check('bleed peak falls as it spreads', maxChannel(f, 3) < 0.35, `peak ${maxChannel(f, 3)}`);
  let support = 0;
  for (let i = 0; i < size * size; i += 1) if (f[i * 4 + 3] > 0.001) support += 1;
  check('bleed support widens beyond the seed texel', support > 40, `support ${support}`);
  // Decay via the reused Kill key removes bleed mass.
  let g = mk();
  for (let s = 0; s < 50; s += 1) g = stepDepositBleedField(g, size, params({ feed: 0, kill: 0.09 }));
  check('bleed decays under Kill', sumChannel(g, 3) < total0 * 0.3, `total ${sumChannel(g, 3)}`);
  // Source: wet pigment feeds a bleed halo around itself.
  let h = blankField(size);
  for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
    if (x * x + y * y <= 4) h[((16 + y) * size + (16 + x)) * 4 + 1] = 1;
  }
  for (let s = 0; s < 30; s += 1) h = stepDepositBleedField(h, size, params());
  check('bleed halo forms at and around the wet pigment',
    h[(16 * size + 16) * 4 + 3] > 0.01 && h[(16 * size + 18) * 4 + 3] > 0.0005,
    `centre ${h[(16 * size + 16) * 4 + 3]}, r+2 ${h[(16 * size + 18) * 4 + 3]}`);
}

// --- display pattern --------------------------------------------------
{
  check('pattern weights: deposit 0.95, bleed 0.55, clamped',
    near(depositBleedPattern(1, 0), 0.95) && near(depositBleedPattern(0, 1), 0.55) && depositBleedPattern(1, 1) === 1);
}

// --- structural: GLSL mirror + identity -------------------------------
{
  const shaders = readFileSync(join(ROOT, 'components/sceneReactionDiffusionShaders.ts'), 'utf8');
  check('sim shader has the model-3 branch with the retention uniform',
    shaders.includes('model > 2.5') && shaders.includes('uniform float depositRetention;'));
  check('sim shader deposit line mirrors the twin',
    shaders.includes('depD * depositRetention + transfer * (1.0 - depD)'));
  check('sim shader bleed line mirrors the twin constants (spread 0.5, source 8, decay 0.5)',
    shaders.includes('(blurL - depL) * 0.5') && shaders.includes('B * feed * 8.0 * dt') && shaders.includes('kill * 0.5 * depL * dt'));
  check('display shaders map pattern from .zw for model 3',
    (shaders.match(/dl\.x \* 0\.95 \+ dl\.y \* 0\.55/g) ?? []).length === 2);
  check('legacy branches untouched (Lenia writes .z=0/.w=1, Gray-Scott reaction intact)',
    shaders.includes('gl_FragColor = vec4(nextA, 0.0, 0.0, 1.0);')
    && shaders.includes('float reaction = A * B * B * reactionBoost;'));
  const seed = readFileSync(join(ROOT, 'components/sceneReactionDiffusionSeedTexture.ts'), 'utf8');
  check('seed texture zeroes .w only for deposit-bleed',
    seed.includes("model === 'deposit-bleed' ? 0 : 1"));
  const runtime = readFileSync(join(ROOT, 'components/sceneReactionDiffusionSystemRuntime.ts'), 'utf8');
  check('runtime maps deposit-bleed to model 3 for sim and display',
    (runtime.match(/'deposit-bleed' \? 3/g) ?? []).length === 2
    && runtime.includes('depositRetention: { value: 1 }'));
  const defaults2 = readFileSync(join(ROOT, 'lib/appStateDefaultLayer2.ts'), 'utf8');
  const defaults3 = readFileSync(join(ROOT, 'lib/appStateDefaultLayer3.ts'), 'utf8');
  check('new keys default to retention 1 on both layers',
    defaults2.includes('layer2ReactionDepositRetention: 1') && defaults3.includes('layer3ReactionDepositRetention: 1'));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
