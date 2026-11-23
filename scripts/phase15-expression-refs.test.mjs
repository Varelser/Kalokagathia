// Phase 15 (Houdini §2) tests: parameter references in modulation
// expressions. Pins the fixed semantics: refs read the BASE
// config, normalised to [0,1] by the catalog range; a route may
// reference its own target without a cycle; unknown refs fall
// back to the wrapped source (Phase AJ discipline).
// Run: node scripts/phase15-expression-refs.test.mjs

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-expr-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

await build({
  stdin: {
    contents: `
      export { applyModulation } from './lib/modulation.ts';
      export { buildExpressionParamVars, EXPRESSION_PARAM_REF_NAMES } from './lib/expressionParamRefs.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const { applyModulation, buildExpressionParamVars, EXPRESSION_PARAM_REF_NAMES, DEFAULT_CONFIG } =
    await import(pathToFileURL(BUNDLE).href);

  // gpgpuBoidsAlignment / Cohesion: catalog range 0..5, step 0.05.
  const REF = 'p_gpgpuboidscohesion';
  check('ref names include the boids cohesion parameter', EXPRESSION_PARAM_REF_NAMES.has(REF));

  const varsMid = buildExpressionParamVars({ ...DEFAULT_CONFIG, gpgpuBoidsCohesion: 2.5 });
  check('normalisation: mid-range reads 0.5', Math.abs(varsMid[REF] - 0.5) < 1e-9, `got ${varsMid[REF]}`);
  const varsMax = buildExpressionParamVars({ ...DEFAULT_CONFIG, gpgpuBoidsCohesion: 99 });
  check('normalisation: above max clamps to 1', varsMax[REF] === 1, `got ${varsMax[REF]}`);

  const lfos = [0, 1, 2, 3].map(() => ({ waveform: 'sine', rate: 0.5 }));
  const mkSetup = (text, target) => ({
    enabled: true,
    lfos,
    routes: [{ id: 'r1', source: { kind: 'expr', text, input: { kind: 'lfo', index: 0 } }, target, depth: 1 }],
  });

  // Ref-driven route: cohesion at 3.75 -> normalised 0.75 ->
  // delta = (0.75 - 0.5) * 1 * 5 = 1.25 over base alignment 1.0.
  const cfg = { ...DEFAULT_CONFIG, gpgpuBoidsCohesion: 3.75, gpgpuBoidsAlignment: 1.0 };
  const out = applyModulation(cfg, mkSetup(REF, 'gpgpuBoidsAlignment'), 0, undefined);
  check('ref route moves the target by the referenced value', Math.abs(out.gpgpuBoidsAlignment - 2.25) < 1e-6,
    `got ${out.gpgpuBoidsAlignment}`);

  // No cycle: referencing the route's own target reads the BASE
  // value (2.5 -> 0.5 -> delta 0), so the config is unchanged.
  const cfgSelf = { ...DEFAULT_CONFIG, gpgpuBoidsAlignment: 2.5 };
  const outSelf = applyModulation(cfgSelf, mkSetup('p_gpgpuboidsalignment', 'gpgpuBoidsAlignment'), 0, undefined);
  check('self-reference reads the base value (no cycle, no change)', outSelf.gpgpuBoidsAlignment === 2.5,
    `got ${outSelf.gpgpuBoidsAlignment}`);

  // Slider-follow: same route, different base cohesion -> the
  // target follows.
  const cfgFollow = { ...DEFAULT_CONFIG, gpgpuBoidsCohesion: 1.25, gpgpuBoidsAlignment: 3.0 };
  const outFollow = applyModulation(cfgFollow, mkSetup(REF, 'gpgpuBoidsAlignment'), 0, undefined);
  check('target follows the referenced slider', Math.abs(outFollow.gpgpuBoidsAlignment - 1.75) < 1e-6,
    `got ${outFollow.gpgpuBoidsAlignment}`);

  // Unknown reference: compile fails -> wrapped source passes
  // through; the call must not throw and must return finite values.
  const outBad = applyModulation(cfg, mkSetup('p_nothere', 'gpgpuBoidsAlignment'), 0, undefined);
  check('unknown ref falls back without throwing', Number.isFinite(outBad.gpgpuBoidsAlignment));

  // Plain expression without refs still works through the new path.
  const outPlain = applyModulation(cfg, mkSetup('1', 'gpgpuBoidsAlignment'), 0, undefined);
  check('constant expression still applies', Math.abs(outPlain.gpgpuBoidsAlignment - 3.5) < 1e-6,
    `got ${outPlain.gpgpuBoidsAlignment}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
