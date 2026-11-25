// Phase 19 stage 4 — Pyro volume raymarch render path.
// Identity: gpgpuPyroVolumeRender defaults to 'fog', the new
// system mounts only in 'raymarch' mode with the grid enabled,
// and the solver files are hash-pinned to their pre-stage
// values, so the legacy path is untouched by construction.
// The numerics are pinned through the CPU mirrors in
// lib/pyroVolumeMath.ts and lib/shadowOcclusion.ts.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p19pv-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { rayBoxInterval, pyroVolumeBeerLambert, pyroVolumeCubeTransmittance, pyroVolumeJitter, pyroVolumeRenderMode, pyroVolumeActive, resolvePyroVolumeSteps, clampPyroVolumeShadowSteps, clampPyroVolumeDensity, PYRO_VOLUME_TIER_STEPS } from './lib/pyroVolumeMath.ts';
      export { pyroGridCellUv, pyroGridCellOfWorld } from './lib/pyroGrid.ts';
      export { cubeSampleTransmittance } from './lib/shadowOcclusion.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  rayBoxInterval, pyroVolumeBeerLambert, pyroVolumeCubeTransmittance, pyroVolumeJitter,
  pyroVolumeRenderMode, pyroVolumeActive, resolvePyroVolumeSteps,
  clampPyroVolumeShadowSteps, clampPyroVolumeDensity, PYRO_VOLUME_TIER_STEPS,
  pyroGridCellUv, pyroGridCellOfWorld, cubeSampleTransmittance, APP_STATE_DEFAULT_GPGPU,
} = lib;

// --- identity pins ---------------------------------------------------
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check("volume render defaults to 'fog' (legacy identity)", d.gpgpuPyroVolumeRender === 'fog');
  check('volume steps defaults to 0 (tier auto)', d.gpgpuPyroVolumeSteps === 0);
  check('volume density defaults to 1', d.gpgpuPyroVolumeDensity === 1.0);
  check('volume shadow steps defaults to 0 (no self-shadow)', d.gpgpuPyroVolumeShadowSteps === 0);
  check("mode resolution: missing/garbage resolves to 'fog'",
    pyroVolumeRenderMode({}) === 'fog' && pyroVolumeRenderMode({ gpgpuPyroVolumeRender: 'bogus' }) === 'fog'
    && pyroVolumeRenderMode({ gpgpuPyroVolumeRender: 'raymarch' }) === 'raymarch');
  check('active only in raymarch mode AND grid enabled',
    pyroVolumeActive({ gpgpuPyroVolumeRender: 'raymarch', gpgpuPyroGridEnabled: true }) === true
    && pyroVolumeActive({ gpgpuPyroVolumeRender: 'raymarch', gpgpuPyroGridEnabled: false }) === false
    && pyroVolumeActive({ gpgpuPyroVolumeRender: 'fog', gpgpuPyroGridEnabled: true }) === false
    && pyroVolumeActive({}) === false);
}

// --- solver files untouched (hash pins) -------------------------------
{
  const pin = (rel, expected) => {
    const h = createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
    check(`solver file untouched: ${rel}`, h === expected, h);
  };
  // lib/pyroGrid.ts pin updated 2026-11-25 (FLIP atlas S1): the
  // only change is the additive pyroGridMergedLayout helper
  // (merged Vel/Base atlas layout); solver math untouched.
  // Record: ~/workspace/kalokagathia-pro/PIN_RERECORD_20261125_FLIP3D.md
  pin('lib/pyroGrid.ts', '2ac816c55090a2bf339daf18051aa871d21eac2e59c9667fe5992ab7cb1b1801');
  pin('components/gpgpuShaderPyroGrid.ts', 'ba4603f66a3454a983120add1a0e94101351eb3cb76f2a9073bec5028911968f');
  pin('components/gpgpuPyroGridPasses.ts', '12e3e32b5e44cebf6c7fb3cfe8c0c34d85c0a636c2eb7033cc26fb6abcced3b6');
}

// --- ray x box interval ----------------------------------------------
{
  const c = { x: 0, y: 0, z: 0 };
  const through = rayBoxInterval({ x: -10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, c, 5);
  check('ray through box: interval [5, 15]', through !== null && near(through[0], 5) && near(through[1], 15), JSON.stringify(through));
  const inside = rayBoxInterval({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, c, 5);
  check('ray from inside: t0 = 0, t1 = 5', inside !== null && near(inside[0], 0) && near(inside[1], 5), JSON.stringify(inside));
  const miss = rayBoxInterval({ x: -10, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, c, 5);
  check('parallel ray outside slab: miss', miss === null);
  const behind = rayBoxInterval({ x: 10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, c, 5);
  check('box behind origin: miss', behind === null);
  const diag = rayBoxInterval({ x: -10, y: -10, z: 0 }, { x: 1, y: 1, z: 0 }, c, 5);
  check('diagonal ray: enters at 5, exits at 15', diag !== null && near(diag[0], 5) && near(diag[1], 15), JSON.stringify(diag));
  const offCenter = rayBoxInterval({ x: -20, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 100, z: 0 }, 10);
  check('off-centre box: interval [10, 30]', offCenter !== null && near(offCenter[0], 10) && near(offCenter[1], 30), JSON.stringify(offCenter));
}

// --- world -> cell -> uv roundtrip (existing solver mapping) ----------
{
  const n = 32;
  const half = 150;
  let ok = true;
  for (const p of [{ x: 0, y: 0, z: 0 }, { x: -149, y: 20, z: 75 }, { x: 149, y: -140, z: -149 }]) {
    const cell = pyroGridCellOfWorld(p, half, n);
    const uv = pyroGridCellUv(n, { x: Math.round(cell.x), y: Math.round(cell.y), z: Math.round(cell.z) });
    if (!uv || !(uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1)) ok = false;
  }
  check('world->cell->uv stays inside the atlas for in-domain points', ok);
  const centre = pyroGridCellOfWorld({ x: 0, y: 0, z: 0 }, half, n);
  check('domain centre maps to the middle cell', near(centre.x, (n - 1) / 2, 1e-6) && near(centre.y, (n - 1) / 2, 1e-6), JSON.stringify(centre));
}

// --- Beer-Lambert mirror ----------------------------------------------
{
  const n = 16;
  const totalLen = 300;
  const segLen = totalLen / n;
  const densities = new Array(n).fill(0.8);
  const temps = new Array(n).fill(0);
  const r = pyroVolumeBeerLambert(densities, temps, segLen, 1 / totalLen);
  check('uniform field: alpha = 1 - exp(-sigma * L)',
    near(r.alpha, 1 - Math.exp(-0.8), 1e-12) && near(r.transmittance, Math.exp(-0.8), 1e-12),
    `alpha=${r.alpha}`);
  const empty = pyroVolumeBeerLambert(new Array(n).fill(0), temps, segLen, 1);
  check('empty field: alpha 0, transmittance 1', empty.alpha === 0 && empty.transmittance === 1);
  const hot = pyroVolumeBeerLambert([1, 1], [0, 2], 10, 0.1);
  const a1 = 1 - Math.exp(-1);
  const expectedTemp = (a1 * 0 + (1 - a1) * a1 * 2) / (a1 + (1 - a1) * a1);
  check('temperature is the absorption-weighted mean', near(hot.temperature, expectedTemp, 1e-12), `${hot.temperature} vs ${expectedTemp}`);
  const denser = pyroVolumeBeerLambert(densities, temps, segLen, 2 / totalLen);
  check('doubling the extinction scale raises alpha', denser.alpha > r.alpha && denser.alpha < 1);
}

// --- cube transmittance twins ------------------------------------------
{
  const field = () => 0.5;
  const t1 = pyroVolumeCubeTransmittance(field, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 100, 8, 0.01);
  check('cube transmittance: uniform field = exp(-d * scale * L)', near(t1, Math.exp(-0.5), 1e-12), `${t1}`);
  const t2 = cubeSampleTransmittance(field, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 100, 8, 0.01);
  check('shadowOcclusion twin agrees with the volume mirror', near(t2, t1, 1e-15));
  check('transmittance with 0 steps is 1 (self-shadow off)',
    pyroVolumeCubeTransmittance(field, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 100, 0, 0.01) === 1
    && cubeSampleTransmittance(field, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 100, 0, 0.01) === 1);
}

// --- steps / clamps ------------------------------------------------------
{
  check('tier step table is 16/24/32/32',
    PYRO_VOLUME_TIER_STEPS.entry === 16 && PYRO_VOLUME_TIER_STEPS.standard === 24
    && PYRO_VOLUME_TIER_STEPS.high === 32 && PYRO_VOLUME_TIER_STEPS.flagship === 32);
  check('steps: 0 falls back to the tier default',
    resolvePyroVolumeSteps('entry', 0) === 16 && resolvePyroVolumeSteps('standard', 0) === 24
    && resolvePyroVolumeSteps('flagship', 0) === 32);
  check('steps: manual 8..64 wins, out-of-range falls back',
    resolvePyroVolumeSteps('entry', 48) === 48 && resolvePyroVolumeSteps('entry', 8) === 8
    && resolvePyroVolumeSteps('entry', 4) === 16 && resolvePyroVolumeSteps('entry', 128) === 16);
  check('shadow steps clamp to [0, 8]', clampPyroVolumeShadowSteps(-2) === 0 && clampPyroVolumeShadowSteps(3.9) === 3 && clampPyroVolumeShadowSteps(99) === 8);
  check('density clamp: negative/NaN -> 0, cap 8',
    clampPyroVolumeDensity(-1) === 0 && clampPyroVolumeDensity(NaN) === 0 && clampPyroVolumeDensity(99) === 8 && clampPyroVolumeDensity(1.5) === 1.5);
  check('jitter is deterministic and in [0, 1)',
    pyroVolumeJitter(13, 7) === pyroVolumeJitter(13, 7)
    && pyroVolumeJitter(13, 7) >= 0 && pyroVolumeJitter(13, 7) < 1
    && pyroVolumeJitter(14, 7) !== pyroVolumeJitter(13, 7));
}

// --- structural pins ------------------------------------------------------
{
  const frag = readFileSync(join(ROOT, 'components/gpgpuShaderPyroVolume.ts'), 'utf8');
  check('fragment shader embeds the solver sampling chunk', frag.includes('PYRO_GRID_SAMPLING') && frag.includes('pyroSample'));
  check('fragment shader embeds the world mapping chunk', frag.includes('PYRO_GRID_WORLD') && frag.includes('pyroCellOfWorld'));
  check('fragment marches with Beer-Lambert (no analytic sphere density)',
    frag.includes('1.0 - exp(-dens * norm * segLen)') && !frag.includes('exp(-d2 * 4)') && !frag.includes('exp(-d * d'));
  check('fragment has early termination and jitter offset',
    frag.includes('transmittance < 0.02') && frag.includes('pyroVolumeJitter'));
  check('fragment clamps the march by scene depth when bound', frag.includes('uDepthReady') && frag.includes('kaloViewDepthFromBuffer'));
  const mount = readFileSync(join(ROOT, 'components/AppSceneLayerContent.tsx'), 'utf8');
  check("mount is gated on the 'raymarch' key in the scene graph",
    mount.includes("config.gpgpuPyroVolumeRender === 'raymarch'") && mount.includes('PyroVolumeSystem'));
  const sys = readFileSync(join(ROOT, 'components/scenePyroVolumeSystem.tsx'), 'utf8');
  check('system reads the shared pyro feed ref (no solver change)',
    sys.includes('pyroFeedRef') && sys.includes('pyroVolumeActive'));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
