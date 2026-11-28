// B3-2 slice 2 verification (LAYER3_B3_2_SLICE2_RUNBOOK.md, V-5..V-7).
// Run: node scripts/verify-b3-2-pyro.mjs
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const L3 = '/home/hatch/workspace/kalokagathia-pro';
const BUNDLE = join(ROOT, 'scripts', '.b3-2p-bundle.mjs');
await build({
  stdin: {
    contents: `
      export { parseGridPackageManifest, pyroSeedFromGridPackage } from './lib/stateCacheGridPackage.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
const loadPkg = (dir) => {
  const parsed = lib.parseGridPackageManifest(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  if (!parsed.ok) throw new Error(parsed.error);
  const m = parsed.value;
  const files = {};
  for (const name of Object.values(m.frames[0].files)) {
    files[name] = readFileSync(join(dir, name));
  }
  // load every frame's files (frame 0 is enough for these scenes, but
  // keep the map complete for the frames the scenes touch)
  for (const f of m.frames) {
    for (const name of Object.values(f.files)) {
      if (!files[name]) files[name] = readFileSync(join(dir, name));
    }
  }
  return { m, files };
};

// ---- V-5: resampling exactness on a linear ramp ----------------------------
{
  const res = 24, vs = 0.1, origin = -1.2;
  const ramp = (x, y, z) => 0.3 + 0.1 * x + 0.2 * y + 0.05 * z; // in index coords
  const values = new Float32Array(res * res * res);
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    values[x + res * (y + res * z)] = ramp(x, y, z);
  }
  const manifest = {
    format: 'grid-package-v1',
    box: { indexMin: [0, 0, 0], dims: [res, res, res] },
    transform: { voxelSize: [vs, vs, vs], indexOriginWorld: [origin, origin, origin] },
    grids: [{ name: 'density', valueType: 'float' }],
    unmappedGrids: [],
    frames: [{ index: 0, files: { density: 'f0000_density.f32' } }],
  };
  const parsed = lib.parseGridPackageManifest(manifest);
  check('V-5 synthetic manifest parses', parsed.ok);
  const files = { 'f0000_density.f32': new Uint8Array(values.buffer) };
  const n = 32, halfExtent = 1.2, cellWorld = (2 * halfExtent) / n;
  const seed = lib.pyroSeedFromGridPackage(parsed.value, 0, files,
    { resolution: n, halfExtent, temperatureScale: 300 });
  check('V-5 seed constructs', seed.ok, seed.ok ? '' : seed.error);
  if (seed.ok) {
    let worst = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const w = [
        -halfExtent + (x + 0.5) * cellWorld,
        -halfExtent + (y + 0.5) * cellWorld,
        -halfExtent + (z + 0.5) * cellWorld,
      ];
      const idx = w.map((c) => (c - origin) / vs);
      // trilinear of a linear field is exact inside the box; cells whose
      // centre falls outside the package box are excluded (zero padding
      // applies there by design)
      if (idx.some((v) => v < 0 || v > res - 1)) continue;
      const expected = ramp(idx[0], idx[1], idx[2]);
      worst = Math.max(worst, Math.abs(seed.value.density[x + n * (y + n * z)] - expected));
    }
    check('V-5 trilinear exact on linear ramp', worst <= 1e-5, `worst=${worst}`);
    check('V-5 absent grids reported',
      seed.value.report.gridsAbsent.includes('temperature') &&
      seed.value.report.gridsAbsent.includes('fuel') &&
      seed.value.report.gridsAbsent.includes('velocity'),
      JSON.stringify(seed.value.report.gridsAbsent));
  }
}

// ---- V-6 + V-7: ext fixture (temperature peak 900, constant vel) -----------
{
  const { m, files } = loadPkg(join(L3, 'layer3-b3-2/pkg-ext'));
  const s300 = lib.pyroSeedFromGridPackage(m, 0, files,
    { resolution: 32, halfExtent: 1.2, temperatureScale: 300 });
  check('V-6 seed (scale 300) constructs', s300.ok, s300.ok ? '' : s300.error);
  if (s300.ok) {
    let peak = 0;
    for (const t of s300.value.temperature) peak = Math.max(peak, t);
    // Node peak is 900/300 = 3.0; trilinear resampling of the curved
    // blob attenuates the peak (measured 2.836), so the line is a band.
    // The substantive claims: no clamping at this scale, peak in band.
    check('V-6 temperature peak ~3.0, no clamp',
      peak >= 2.7 && peak <= 3.0 && s300.value.report.clampedTemperatureCells === 0,
      `peak=${peak} clamped=${s300.value.report.clampedTemperatureCells}`);
    check('V-6 fuel absent -> zero field + reported',
      s300.value.report.gridsAbsent.includes('fuel') &&
      s300.value.fuel.every((v) => v === 0));
  }
  const s100 = lib.pyroSeedFromGridPackage(m, 0, files,
    { resolution: 32, halfExtent: 1.2, temperatureScale: 100 });
  check('V-6 seed (scale 100) constructs', s100.ok, s100.ok ? '' : s100.error);
  if (s100.ok) {
    let peak = 0;
    for (const t of s100.value.temperature) peak = Math.max(peak, t);
    check('V-6 temperature clamped at 4.0 and counted',
      peak === 4.0 && s100.value.report.clampedTemperatureCells > 0,
      `peak=${peak} clamped=${s100.value.report.clampedTemperatureCells}`);
  }
  if (s300.ok && s300.value.velocity) {
    const cellWorld = (2 * 1.2) / 32; // 0.075
    const expect = [0.5 / cellWorld, -0.25 / cellWorld, 1.0 / cellWorld];
    const got = [
      s300.value.velocity.x[16 + 32 * (16 + 32 * 16)],
      s300.value.velocity.y[16 + 32 * (16 + 32 * 16)],
      s300.value.velocity.z[16 + 32 * (16 + 32 * 16)],
    ];
    const err = Math.max(...got.map((g, i) => Math.abs(g - expect[i])));
    check('V-7 velocity converted to cells/s', err <= 1e-3,
      `got=${got.map((g) => g.toFixed(3)).join(',')} expect=${expect.map((g) => g.toFixed(3)).join(',')}`);
  } else {
    check('V-7 velocity present', false, 'velocity missing from seed');
  }
}

console.log(failures === 0 ? 'B3-2 PYRO VERIFY: ALL PASS' : `B3-2 PYRO VERIFY: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
