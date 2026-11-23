// Phase 19 stage 3 — XPBD completion (Δλ accumulation /
// physical compliance / volume preservation / tear gap +
// component separation).
// Identity: gpgpuVellumSolverMode defaults to 'legacy' and the
// new keys default to 0/false, so the legacy passes are the
// only ones that can run. The numerics are pinned through the
// CPU mirrors in lib/xpbdConstraints.ts (the GLSL twin lives
// in components/gpgpuShaderXpbd.ts) and lib/gpgpuVellum.ts.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p19x-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { xpbdDeltaLambda, xpbdAlphaTilde, xpbdAlphaFromStiffness, xpbdBreakExceeded, createXpbdClothMirror, stepXpbdClothMirror, XPBD_ALPHA_SCALE } from './lib/xpbdConstraints.ts';
      export { buildVellumBakeData, buildVellumVolumeGradientData, vellumShellSignedVolume, labelVellumComponents, resolveVellum, vellumXpbdPoolActive, vellumVolumeActive } from './lib/gpgpuVellum.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  xpbdDeltaLambda, xpbdAlphaTilde, xpbdAlphaFromStiffness, xpbdBreakExceeded,
  createXpbdClothMirror, stepXpbdClothMirror,
  buildVellumBakeData, buildVellumVolumeGradientData, vellumShellSignedVolume,
  labelVellumComponents, resolveVellum, vellumXpbdPoolActive, vellumVolumeActive,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

// --- identity pins ---------------------------------------------------
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check("solver mode defaults to 'legacy' (identity)", d.gpgpuVellumSolverMode === 'legacy');
  check('compliance keys default to 0', d.gpgpuVellumCompliance === 0 && d.gpgpuVellumBendCompliance === 0 && d.gpgpuVellumVolumeCompliance === 0);
  check('volume defaults off / ratio 1', d.gpgpuVellumVolumeEnabled === false && d.gpgpuVellumVolumeRatio === 1);
  check('tear gap defaults to 0', d.gpgpuVellumTearGap === 0);
  const legacy = resolveVellum({ ...d });
  check('default resolution is legacy, xpbd off', legacy.solverMode === 'legacy' && legacy.xpbd === false);
  check('xpbd pool inactive by default', vellumXpbdPoolActive({ ...d }) === false);
  check('volume inactive by default', vellumVolumeActive({ ...d }) === false);
  const xp = resolveVellum({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd' });
  check('xpbd resolution engages with mode + enabled', xp.xpbd === true && vellumXpbdPoolActive({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd' }) === true);
  check('volume engages only for xpbd + shell + key',
    vellumVolumeActive({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd', gpgpuVellumMode: 'shell', gpgpuVellumVolumeEnabled: true }) === true
    && vellumVolumeActive({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd', gpgpuVellumMode: 'sheet', gpgpuVellumVolumeEnabled: true }) === false
    && vellumVolumeActive({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'legacy', gpgpuVellumMode: 'shell', gpgpuVellumVolumeEnabled: true }) === false);
  check('compliance seeding: key 0 seeds from stiffness mapping',
    near(xp.compliance, xpbdAlphaFromStiffness(0.8), 1e-12), `${xp.compliance} vs ${xpbdAlphaFromStiffness(0.8)}`);
  const xpExplicit = resolveVellum({ ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd', gpgpuVellumCompliance: 0.02 });
  check('explicit compliance key wins over the mapping', near(xpExplicit.compliance, 0.02, 1e-12));
  check('volume ratio clamped to [0.5, 2]',
    resolveVellum({ ...d, gpgpuVellumVolumeRatio: 9 }).volumeRatio === 2
    && resolveVellum({ ...d, gpgpuVellumVolumeRatio: 0.1 }).volumeRatio === 0.5);

  const passes = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  check('passes: xpbd branch gated on solverMode', passes.includes("vellum.solverMode === 'xpbd'"));
  check('passes: volume engagement zeroes legacy pressure', passes.includes('volumeEngaged'));
  const vellumShader = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationVellum.ts'), 'utf8');
  check('legacy projection: tear gap block is guarded by gap > 0', vellumShader.includes('uVellumTearGap > 0.0 && uVellumTearEnabled'));
  check('xpbd passes exist (lambda / proj / volume / vel)',
    vellumShader.includes('SIM_VELLUM_XPBD_LAMBDA_FRAG') && vellumShader.includes('SIM_VELLUM_XPBD_PROJ_FRAG')
    && vellumShader.includes('SIM_VELLUM_VOLUME_REDUCE_FRAG') && vellumShader.includes('SIM_VELLUM_XPBD_VEL_FRAG'));
}

// --- Δλ analytic -----------------------------------------------------
{
  // Two particles, one link, d = 2, rest = 1, w = 1 + 1, α = 0:
  // Δλ = −(2−1)/2 = −0.5, and the endpoint corrections
  // Δx_a = −Δλ·w·dir = +0.5·dir, Δx_b = −0.5·dir close the
  // link exactly to rest in one solve.
  const dl = xpbdDeltaLambda(2 - 1, 0, 0, 2);
  check('Δλ analytic (rigid link)', near(dl, -0.5, 1e-12), `${dl}`);
  check('α̃ = α/dt²', near(xpbdAlphaTilde(0.5, 0.25), 8, 1e-12));
  check('compliant Δλ shrinks with α̃', Math.abs(xpbdDeltaLambda(1, 0, 10, 2)) < Math.abs(dl));
  // λ accumulation: with C = 1, α̃ = 10, denom 2, the first
  // solve gives Δλ₁ = −1/12; feeding λ = Δλ₁ back in, the
  // second Δλ must shrink toward 0 (the −α̃λ term brakes the
  // accumulation), and at the fixed point λ* = −C/denom
  // (α̃-independent) Δλ is exactly 0 when α̃ = 0.
  const dl1 = xpbdDeltaLambda(1, 0, 10, 2);
  const dl2 = xpbdDeltaLambda(1, dl1, 10, 2);
  check('λ accumulation term brakes successive Δλ', Math.abs(dl2) < Math.abs(dl1) && dl2 < 0,
    `dl1=${dl1} dl2=${dl2}`);
  // At α̃ = 0 the update is λ-independent (Δλ = −C/denom):
  // convergence in XPBD comes from C → 0 as the positions
  // correct, not from Δλ → 0 at fixed C.
  check('Δλ at α̃=0 is λ-independent and equals −C/denom',
    near(xpbdDeltaLambda(1, -0.5, 0, 2), -0.5, 1e-12)
    && near(xpbdDeltaLambda(1, 3.25, 0, 2), -0.5, 1e-12));
  check('stiffness mapping is monotone decreasing in k',
    xpbdAlphaFromStiffness(0.2) > xpbdAlphaFromStiffness(0.5)
    && xpbdAlphaFromStiffness(0.5) > xpbdAlphaFromStiffness(0.9)
    && near(xpbdAlphaFromStiffness(1), 0, 1e-12));
  check('break rule: 0 threshold never breaks, over-threshold breaks',
    xpbdBreakExceeded(100, 0) === false && xpbdBreakExceeded(2, 1.5) === true && xpbdBreakExceeded(1, 1.5) === false);
}

// --- cloth mirror: hanging sheet -------------------------------------
function hangingSheet(n, spacing) {
  const rest = new Float32Array(n * n * 3);
  const invMass = new Float32Array(n * n).fill(1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      rest[i * 3] = (x - (n - 1) / 2) * spacing;
      rest[i * 3 + 1] = -y * spacing;
      rest[i * 3 + 2] = 0;
      if (y === 0) invMass[i] = 0; // top row pinned
    }
  }
  return createXpbdClothMirror(rest, n, invMass);
}
function hangSteady({ dt, substeps, compliance, bendCompliance = 0.01, frames }) {
  const m = hangingSheet(8, 0.15);
  let strain = 0;
  for (let f = 0; f < frames; f++) {
    strain = stepXpbdClothMirror(m, { dt, substeps, gravity: -9.8, compliance, bendCompliance, damping: 0.05 });
  }
  return strain;
}
{
  // dt independence (design 3-7-2): same scenario at 60 fps
  // and 120 fps-equivalent stepping must land at near-equal
  // steady stretch — the XPBD selling point vs the legacy
  // rate-based projection.
  const s60 = hangSteady({ dt: 1 / 60, substeps: 2, compliance: 0.002, frames: 300 });
  const s120 = hangSteady({ dt: 1 / 120, substeps: 2, compliance: 0.002, frames: 600 });
  check('hanging sheet converges to finite stretch', Number.isFinite(s60) && s60 > 0 && s60 < 2, `s60=${s60}`);
  const dtDiff = Math.abs(s60 - s120) / Math.max(s60, 1e-9);
  check('dt independence: steady stretch differs < 25% between dt 1/60 and 1/120', dtDiff < 0.25, `s60=${s60} s120=${s120} rel=${dtDiff}`);

  // Compliance monotonicity (design 3-7-3).
  const a0 = hangSteady({ dt: 1 / 60, substeps: 2, compliance: 0, frames: 300 });
  const a1 = hangSteady({ dt: 1 / 60, substeps: 2, compliance: 0.002, frames: 300 });
  const a2 = hangSteady({ dt: 1 / 60, substeps: 2, compliance: 0.02, frames: 300 });
  check('compliance monotonicity: stretch grows with α, α=0 is stiffest',
    a0 <= a1 && a1 <= a2 && a2 > a0, `a0=${a0} a1=${a1} a2=${a2}`);

  // Checkerboard probe (design 3-2): a checkerboard
  // perturbation must not amplify under the Jacobi XPBD solve.
  const m = hangingSheet(8, 0.15);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 3;
    m.pos[i + 2] += ((x + y) % 2 === 0 ? 1 : -1) * 0.02;
  }
  const before = stepXpbdClothMirror(m, { dt: 1 / 60, substeps: 1, gravity: 0, compliance: 0, bendCompliance: 0 });
  let after = before;
  for (let f = 0; f < 7; f++) after = stepXpbdClothMirror(m, { dt: 1 / 60, substeps: 1, gravity: 0, compliance: 0, bendCompliance: 0 });
  check('checkerboard mode does not amplify (8 steps)', after <= before * 1.05 + 1e-6, `before=${before} after=${after}`);
}

// --- volume gradient bake ---------------------------------------------
{
  const texSize = 16;
  const bake = buildVellumBakeData(texSize, 'shell', 100, 42);
  const grad = buildVellumVolumeGradientData(bake.posData, texSize);
  const r = 75; // bounceRadius 100 × VELLUM_SHELL_RADIUS 0.75
  const analytic = (4 / 3) * Math.PI * r ** 3;
  const relErr = Math.abs(Math.abs(grad.restVolume) - analytic) / analytic;
  check('shell rest volume ≈ analytic sphere volume (grid error < 6%)', relErr < 0.06,
    `V=${grad.restVolume} analytic=${analytic} rel=${relErr}`);
  let gx = 0, gy = 0, gz = 0;
  for (let i = 0; i < texSize * texSize; i++) {
    gx += grad.gradData[i * 4]; gy += grad.gradData[i * 4 + 1]; gz += grad.gradData[i * 4 + 2];
  }
  const gSum = Math.hypot(gx, gy, gz);
  check('Σ∇C ≈ 0 for the closed shell', gSum < analytic * 0.001, `|Σ∇|=${gSum}`);
  check('denominator Σ|∇C|² > 0', grad.denom > 0, `${grad.denom}`);
  // Finite-difference: moving vertex k along its own gradient
  // by ε must change the signed volume by ≈ ε·|∇C_k|².
  const k = 5 * texSize + 3;
  const eps = 0.05;
  const moved = new Float32Array(bake.posData);
  const gk = [grad.gradData[k * 4], grad.gradData[k * 4 + 1], grad.gradData[k * 4 + 2]];
  moved[k * 4] += gk[0] * eps; moved[k * 4 + 1] += gk[1] * eps; moved[k * 4 + 2] += gk[2] * eps;
  const dv = vellumShellSignedVolume(moved, texSize, 4) - grad.restVolume;
  const expected = eps * (gk[0] ** 2 + gk[1] ** 2 + gk[2] ** 2) * Math.sign(grad.restVolume);
  const fdRel = Math.abs(dv - expected) / Math.max(Math.abs(expected), 1e-9);
  check('gradient matches finite-difference volume change (< 10%)', fdRel < 0.1,
    `dv=${dv} expected=${expected} rel=${fdRel}`);
  // Uniform scaling sanity: scaling positions by s scales
  // the signed volume by s³.
  const scaled = new Float32Array(bake.posData);
  for (let i = 0; i < scaled.length; i += 4) { scaled[i] *= 1.1; scaled[i + 1] *= 1.1; scaled[i + 2] *= 1.1; }
  const vScaled = vellumShellSignedVolume(scaled, texSize, 4);
  check('volume scales as s³', near(vScaled / grad.restVolume, 1.331, 1e-6), `${vScaled / grad.restVolume}`);
}

// --- component labelling ------------------------------------------------
{
  const n = 4;
  const allAlive = new Float32Array(n * n * 4).fill(1);
  const one = labelVellumComponents(allAlive, n, 0);
  check('all-alive sheet is one component', one.count === 1 && one.components[0].texelCount === n * n);

  const cut = new Float32Array(allAlive);
  for (let y = 0; y < n; y++) cut[(y * n + 1) * 4] = 0; // right links of column x=1 die
  const two = labelVellumComponents(cut, n, 0);
  check('a severed column splits the sheet into 2 components', two.count === 2, `count=${two.count}`);
  const counts = two.components.map((c) => c.texelCount).sort((a, b) => a - b);
  check('component sizes are 8 + 8', counts[0] === 8 && counts[1] === 8, counts.join(','));

  const island = new Float32Array(allAlive);
  // Isolate texel (2,2): kill its right/up links and the
  // left/down neighbours' links toward it.
  island[(2 * n + 2) * 4] = 0; island[(2 * n + 2) * 4 + 1] = 0;
  island[(2 * n + 1) * 4] = 0; island[(1 * n + 2) * 4 + 1] = 0;
  const pos = new Float32Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { pos[i * 4] = i % n; pos[i * 4 + 1] = Math.floor(i / n); }
  const three = labelVellumComponents(island, n, 0, pos, 4);
  check('an isolated texel becomes a singleton component', three.count === 2 && three.components.some((c) => c.texelCount === 1), `count=${three.count}`);
  const single = three.components.find((c) => c.texelCount === 1);
  check('singleton centroid is the texel position', !!single && !!single.centroid
    && near(single.centroid[0], 2, 1e-9) && near(single.centroid[1], 2, 1e-9));
  check('mass equals texel count', three.components.every((c) => c.mass === c.texelCount));
  check('labels cover every texel exactly once',
    three.labels.length === n * n && Array.from(three.labels).every((l) => l >= 0 && l < three.count));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
