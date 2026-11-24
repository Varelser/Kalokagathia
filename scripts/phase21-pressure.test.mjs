// Phase 21 stage 5 — Houdini §5 pressure: SPECIFIC verification.
// Round 36 noted the §5 pressure ◎ rested on the same XPBD volume
// implementation as the soft-body row, with no pressure-specific
// check. This test is that check: it mirrors the GPU volume
// projection (components/gpgpuShaderSimulationVellum.ts:
// C = V − V0·ratio, Δλ = (−C − α̃λ)/(denom + α̃), Δx = Δλ·∇C with
// the baked rest gradient) on the CPU and verifies pressure
// behaviour itself — a compressed closed shell re-inflates toward
// its rest volume, an over-inflated shell deflates, a target ratio
// above 1 holds MORE volume, corrections point outward under
// compression, and compliance softens the correction. No distance
// (soft-body) constraint is involved anywhere in this file.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p21s5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildVellumBakeData, buildVellumVolumeGradientData, vellumShellSignedVolume, vellumVolumeActive, resolveVellum } from './lib/gpgpuVellum.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { buildVellumBakeData, buildVellumVolumeGradientData, vellumShellSignedVolume, vellumVolumeActive, resolveVellum, DEFAULT_CONFIG } = lib;

const texSize = 16;
const bake = buildVellumBakeData(texSize, 'shell', 100, 42);
const grad = buildVellumVolumeGradientData(bake.posData, texSize);
const V0 = grad.restVolume;
check('rest volume is positive for the shell winding', V0 > 0, `V0=${V0}`);

function scaledPositions(scale) {
  const pos = new Float32Array(bake.posData);
  for (let i = 0; i < pos.length; i += 4) { pos[i] *= scale; pos[i + 1] *= scale; pos[i + 2] *= scale; }
  return pos;
}

/** One GPU-identical volume projection step (no pins, w = 1). */
function projectVolume(pos, ratio, alphaTilde) {
  const v = vellumShellSignedVolume(pos, texSize, 4);
  const c = v - V0 * ratio;
  const dl = (-c - alphaTilde * 0) / (grad.denom + alphaTilde);
  const out = new Float32Array(pos);
  for (let i = 0; i < texSize * texSize; i++) {
    out[i * 4] += dl * grad.gradData[i * 4];
    out[i * 4 + 1] += dl * grad.gradData[i * 4 + 1];
    out[i * 4 + 2] += dl * grad.gradData[i * 4 + 2];
  }
  return out;
}

function projectVolumeTimes(pos, ratio, alphaTilde, times) {
  let p = pos;
  for (let k = 0; k < times; k++) p = projectVolume(p, ratio, alphaTilde);
  return p;
}

// --- compression: pressure re-inflates --------------------------------
{
  const start = scaledPositions(0.8);
  const vStart = vellumShellSignedVolume(start, texSize, 4);
  check('compressed shell holds ~0.512× rest volume', Math.abs(vStart / V0 - 0.512) < 0.02, `ratio=${vStart / V0}`);
  const once = projectVolume(start, 1, 0);
  const vOnce = vellumShellSignedVolume(once, texSize, 4);
  check('one pressure step moves volume toward rest', vOnce > vStart && Math.abs(vOnce - V0) < Math.abs(vStart - V0), `V ${vStart} -> ${vOnce} (V0 ${V0})`);
  const settled = projectVolumeTimes(start, 1, 0, 30);
  const vSettled = vellumShellSignedVolume(settled, texSize, 4);
  check('iterated pressure restores rest volume within 3%', Math.abs(vSettled / V0 - 1) < 0.03, `ratio=${vSettled / V0}`);
}

// --- over-inflation: pressure deflates ----------------------------------
{
  const start = scaledPositions(1.25);
  const vStart = vellumShellSignedVolume(start, texSize, 4);
  const settled = projectVolumeTimes(start, 1, 0, 30);
  const vSettled = vellumShellSignedVolume(settled, texSize, 4);
  check('over-inflated shell deflates toward rest volume within 3%', vSettled < vStart && Math.abs(vSettled / V0 - 1) < 0.03, `${vStart} -> ${vSettled} (V0 ${V0})`);
}

// --- target ratio: pressure holds a LARGER volume -----------------------
{
  const settled = projectVolumeTimes(scaledPositions(1), 1.5, 0, 40);
  const v = vellumShellSignedVolume(settled, texSize, 4);
  check('ratio 1.5 inflates the shell toward 1.5× rest volume (within 5%)', Math.abs(v / V0 - 1.5) < 0.05 * 1.5, `ratio=${v / V0}`);
  const settledHalf = projectVolumeTimes(scaledPositions(1), 0.5, 0, 40);
  const vHalf = vellumShellSignedVolume(settledHalf, texSize, 4);
  check('ratio 0.5 deflates toward 0.5× rest volume (within 5%)', Math.abs(vHalf / V0 - 0.5) < 0.05, `ratio=${vHalf / V0}`);
}

// --- correction direction: outward under compression --------------------
{
  const start = scaledPositions(0.8);
  const once = projectVolume(start, 1, 0);
  let outward = 0; let total = 0;
  for (let i = 0; i < texSize * texSize; i++) {
    const dx = once[i * 4] - start[i * 4];
    const dy = once[i * 4 + 1] - start[i * 4 + 1];
    const dz = once[i * 4 + 2] - start[i * 4 + 2];
    const dot = dx * start[i * 4] + dy * start[i * 4 + 1] + dz * start[i * 4 + 2];
    if (Math.hypot(dx, dy, dz) > 1e-9) { total++; if (dot > 0) outward++; }
  }
  check('compressed shell: corrections point outward (pressure, not springs)', total > 0 && outward / total > 0.95, `${outward}/${total}`);
}

// --- compliance softens pressure -----------------------------------------
{
  const start = scaledPositions(0.8);
  const rigidStep = vellumShellSignedVolume(projectVolume(start, 1, 0), texSize, 4);
  const softStep = vellumShellSignedVolume(projectVolume(start, 1, grad.denom), texSize, 4);
  const vStart = vellumShellSignedVolume(start, texSize, 4);
  check('compliance α̃ = denom halves-ish the single-step correction', softStep > vStart && softStep < rigidStep, `start=${vStart} soft=${softStep} rigid=${rigidStep}`);
}

// --- engagement is pressure-specific (closed shell only) ------------------
{
  const d = DEFAULT_CONFIG;
  const shellCfg = { ...d, gpgpuVellumEnabled: true, gpgpuVellumSolverMode: 'xpbd', gpgpuVellumMode: 'shell', gpgpuVellumVolumeEnabled: true };
  check('volume pressure engages for xpbd shell + volume key', vellumVolumeActive(shellCfg) === true, JSON.stringify(resolveVellum(shellCfg)));
  check('volume pressure never engages for an open sheet', vellumVolumeActive({ ...shellCfg, gpgpuVellumMode: 'sheet' }) === false);
  check('volume pressure off when the volume key is off', vellumVolumeActive({ ...shellCfg, gpgpuVellumVolumeEnabled: false }) === false);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
