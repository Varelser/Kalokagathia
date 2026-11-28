#!/usr/bin/env node
// stage4-diag-align-fix2.test.mjs — Limit plan stage 4, gate
// fix round 2 (diag statistics ports): the pure per-texel
// math behind the diag hook's captureVelocityAlignStats
// (computeVelocityAlignStats in components/gpgpuOrientPass.ts),
// plus source pins for the hook-side wiring in
// components/sceneGpgpuSystem.tsx.
//
// What is pinned here (node side):
//  (a) Known-vector composition: with vel = +X, spin = 90°
//      and the identity quaternion, the drawn long axis is
//      lookRot(X̂) · rotY(π/2) · ẑ = (0,0,−1), so the folded
//      angle against the velocity is exactly 90°.
//  (b) Self-calibration: with no spin and no orient, the
//      axis is the velocity direction itself — mean angle 0,
//      within5Rate 1, and meanAngleAlignOnlyDeg 0 in every
//      configuration (lookRot only ever returns the axis).
//  (c) A known quaternion (60° about Y) with vel = +Z gives
//      the folded angle 60°.
//  (d) Texels at or below the speed floor (0.01) are
//      excluded from validCount.
//  (e) Wiring pins: the diag hook exposes
//      captureVelocityAlignStats, captureAuxStats counts
//      active slots by the draw's own life/age definition,
//      captureOrientStats reports both ping-pong sides, and
//      captureSpinStats reports the raw accumulated-angle
//      mean. (The GPU-side behaviour is the re-gate's job.)
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4fix2-bundle-${process.pid}.mjs`);
let failures = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { computeVelocityAlignStats, lookRotJs, rotYJs } from './components/gpgpuOrientPass.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const { computeVelocityAlignStats, lookRotJs, rotYJs } = await import(pathToFileURL(BUNDLE).href);

  const SIZE = 2;
  const COUNT = SIZE * SIZE;
  const buf = (fill) => {
    const b = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) fill(b, i);
    return b;
  };

  // (a) vel = +X, spin = 90°, identity quaternion → 90°.
  {
    const vel = buf((b, i) => { b[i * 4] = 3; });
    const spin = buf((b, i) => { b[i * 4] = Math.PI / 2; });
    const orient = buf((b, i) => { b[i * 4 + 3] = 1; });
    const s = computeVelocityAlignStats(vel, spin, orient, SIZE);
    check('(a) validCount counts every moving texel', s.validCount === COUNT, `valid=${s.validCount}`);
    check('(a) mean angle is 90° for spin 90° about the look frame', approx(s.meanAngleDeg, 90, 1e-4), `mean=${s.meanAngleDeg}`);
    check('(a) max angle is 90°', approx(s.maxAngleDeg, 90, 1e-4), `max=${s.maxAngleDeg}`);
    check('(a) within5Rate is 0', s.within5Rate === 0, `rate=${s.within5Rate}`);
    check('(a) alignOnly self-calibration is 0', approx(s.meanAngleAlignOnlyDeg, 0, 1e-9), `alignOnly=${s.meanAngleAlignOnlyDeg}`);
    check('(a) spinSource is channel / orientApplied true', s.spinSource === 'channel' && s.orientApplied === true);
  }

  // (b) No spin, no orient → axis == velocity direction.
  {
    const vel = buf((b, i) => { b[i * 4] = 1; b[i * 4 + 1] = 2; b[i * 4 + 2] = 3; });
    const s = computeVelocityAlignStats(vel, null, null, SIZE);
    check('(b) mean angle is 0 without spin/orient', approx(s.meanAngleDeg, 0, 1e-9), `mean=${s.meanAngleDeg}`);
    check('(b) within5Rate is 1', s.within5Rate === 1, `rate=${s.within5Rate}`);
    check('(b) alignOnly is 0', approx(s.meanAngleAlignOnlyDeg, 0, 1e-9));
    check('(b) spinSource none / orientApplied false', s.spinSource === 'none' && s.orientApplied === false);
  }

  // (c) Quaternion 60° about Y, vel = +Z → folded angle 60°.
  {
    const vel = buf((b, i) => { b[i * 4 + 2] = 5; });
    const orient = buf((b, i) => { b[i * 4 + 1] = Math.sin(Math.PI / 6); b[i * 4 + 3] = Math.cos(Math.PI / 6); });
    const s = computeVelocityAlignStats(vel, null, orient, SIZE);
    check('(c) mean angle is 60° for a 60° Y quaternion', approx(s.meanAngleDeg, 60, 1e-4), `mean=${s.meanAngleDeg}`);
    check('(c) alignOnly stays 0 with orient applied', approx(s.meanAngleAlignOnlyDeg, 0, 1e-9));
  }

  // (d) Speed floor exclusion.
  {
    const vel = buf((b, i) => { if (i === 0) b[i * 4] = 1; else b[i * 4] = 0.005; });
    const s = computeVelocityAlignStats(vel, null, null, SIZE);
    check('(d) texels at/below 0.01 speed are excluded', s.validCount === 1, `valid=${s.validCount}`);
    check('(d) count still reports all texels', s.count === COUNT && s.texSize === SIZE);
  }

  // Translation spot checks against the GLSL originals.
  {
    const r = rotYJs(Math.PI / 2, [0, 0, 1]);
    check('rotYJs(π/2) maps ẑ to −x̂', approx(r[0], -1, 1e-12) && approx(r[1], 0, 1e-12) && approx(r[2], 0, 1e-12), `r=${r}`);
    const l = lookRotJs([0, 0, 1], [0, 0, 1]);
    check('lookRotJs(ẑ)·ẑ is ẑ', approx(l[0], 0, 1e-12) && approx(l[1], 0, 1e-12) && approx(l[2], 1, 1e-12), `l=${l}`);
    const ly = lookRotJs([0, 1, 0], [1, 0, 0]);
    check('lookRotJs(ŷ) uses the x-up fallback without NaN', ly.every((v) => Number.isFinite(v)), `l=${ly}`);
  }

  // (e) Wiring pins in the diag hook source.
  {
    const src = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
    check('(e) hook exposes captureVelocityAlignStats', src.includes('captureVelocityAlignStats: () => {'));
    check('(e) aux active uses the draw life/age definition', src.includes('life > 0.001 && age < life'));
    check('(e) aux stats report activeRate', src.includes('activeRate: count ? active / count : 0'));
    check('(e) orient stats report both ping-pong sides', src.includes('sides = { readIndex: pass.readIndex, perSide }'));
    check('(e) spin stats report the raw angle mean', src.includes('meanAngleRaw: count ? sumAngleRaw / count : 0'));
    const passSrc = readFileSync(join(ROOT, 'components', 'gpgpuOrientPass.ts'), 'utf8');
    check('(e) orient pass exposes diag introspection getters',
      passSrc.includes('get targets()') && passSrc.includes('get readIndex()')
      && passSrc.includes('get stateStarted()') && passSrc.includes('get elapsedSeconds()'));
  }
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(`stage4-diag-align-fix2: ${total - failures}/${total} checks passed`);
if (failures) process.exit(1);
