// B3-2 verification (LAYER3_B3_2_RUNBOOK.md, scenes V-1..V-4).
// Run: node scripts/verify-b3-2.mjs
// Packages live in kalokagathia-pro/layer3-b3-2/pkg-* (built by the
// pyopenvdb helper on the iMac); originals for V-1 in layer3-b3/work/grids.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const L3 = '/home/hatch/workspace/kalokagathia-pro';
const BUNDLE = join(ROOT, 'scripts', '.b3-2-bundle.mjs');
await build({
  stdin: {
    contents: `
      export { parseGridPackageManifest, gridPackageReport, densityFieldFromGridPackage } from './lib/stateCacheGridPackage.ts';
      export { extractIsosurface } from './lib/stateCacheSkinning.ts';
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
  const manifest = lib.parseGridPackageManifest(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  if (!manifest.ok) throw new Error(manifest.error);
  return manifest.value;
};
const frameBytes = (dir, manifest, frameIndex, grid) => {
  const frame = manifest.frames.find((f) => f.index === frameIndex);
  return readFileSync(join(dir, frame.files[grid]));
};

// ---- V-1: round trip over B3-1's 24 density VDBs --------------------------
{
  const dir = join(L3, 'layer3-b3-2/pkg-b31');
  const m = loadPkg(dir);
  let maxErr = 0;
  for (let f = 0; f < 24; f++) {
    const field = lib.densityFieldFromGridPackage(m, f, frameBytes(dir, m, f, 'density'));
    if (!field.ok) { check(`V-1 frame ${f} construct`, false, field.error); continue; }
    const orig = new Float32Array(
      readFileSync(join(L3, `layer3-b3/work/grids/density_${String(f).padStart(4, '0')}.f32`)).buffer);
    for (let i = 0; i < orig.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(field.value.values[i] - orig[i]));
    }
    if (f === 0) {
      // The B3-1 writer put the DensityField node spacing (2*extent/(res-1)
      // = 0.129032...) into the VDB transform; the package carries it
      // explicitly, so the field must adopt the manifest value verbatim.
      check('V-1 field shape', field.value.resolution === 32 &&
        field.value.extent === 2.0 && field.value.spacing === m.transform.voxelSize[0],
        `res=${field.value.resolution} extent=${field.value.extent} spacing=${field.value.spacing}`);
    }
    if (f === 12) {
      const mesh = lib.extractIsosurface(field.value, 0.4);
      check('V-1 isosurface non-empty (frame 12)', mesh.faces.length > 0,
        `verts=${mesh.vertices.length / 3} faces=${mesh.faces.length / 3}`);
    }
  }
  check('V-1 round trip max error', maxErr === 0, `maxErr=${maxErr}`);
}

// ---- V-3: transform honesty ------------------------------------------------
{
  const dir = join(L3, 'layer3-b3-2/pkg-b31');
  const m = loadPkg(dir);
  const field = lib.densityFieldFromGridPackage(m, 0, frameBytes(dir, m, 0, 'density'));
  let worst = 0;
  for (let i = 0; i < m.box.dims[0]; i++) {
    const nodeWorld = -field.value.extent + i * field.value.spacing;
    const vdbWorld = m.transform.indexOriginWorld[0] +
      m.transform.voxelSize[0] * (m.box.indexMin[0] + i);
    worst = Math.max(worst, Math.abs(nodeWorld - vdbWorld));
  }
  check('V-3 node world == VDB world (all nodes)', worst === 0, `worst=${worst}`);

  const badDir = join(L3, 'layer3-b3-2/pkg-bad');
  const bm = loadPkg(badDir);
  const refused = lib.densityFieldFromGridPackage(bm, 0, frameBytes(badDir, bm, 0, 'density'));
  check('V-3 asymmetric origin refused visibly', !refused.ok,
    refused.ok ? '' : refused.error.slice(0, 60));

  const skewed = JSON.parse(JSON.stringify(m));
  skewed.transform.voxelSize = [0.125, 0.25, 0.125];
  const sm = lib.parseGridPackageManifest(skewed);
  const refused2 = sm.ok &&
    !lib.densityFieldFromGridPackage(sm.value, 0, frameBytes(dir, m, 0, 'density')).ok;
  check('V-3 non-uniform voxel size refused visibly', !!refused2);
}

// ---- V-2 + V-4: externally authored multi-grid package ---------------------
{
  const dir = join(L3, 'layer3-b3-2/pkg-ext');
  const m = loadPkg(dir);
  check('V-2 frame count', m.frames.length === 3, `frames=${m.frames.length}`);
  const field = lib.densityFieldFromGridPackage(m, 0, frameBytes(dir, m, 0, 'density'));
  check('V-2 field construct', field.ok, field.ok ? '' : field.error);
  if (field.ok) {
    check('V-2 field transform', field.value.extent === 1.2 && field.value.spacing === 0.1,
      `extent=${field.value.extent} spacing=${field.value.spacing}`);
    const mesh = lib.extractIsosurface(field.value, 0.4);
    check('V-2 isosurface non-empty', mesh.faces.length > 0,
      `verts=${mesh.vertices.length / 3} faces=${mesh.faces.length / 3}`);
  }
  const report = lib.gridPackageReport(m);
  check('V-4 unmapped grid reported', report.unmappedGrids.includes('color'),
    `unmapped=${JSON.stringify(report.unmappedGrids)}`);
  check('V-4 known grids reported',
    report.knownGrids.includes('density') && report.knownGrids.includes('temperature'),
    `known=${JSON.stringify(report.knownGrids)}`);
}

console.log(failures === 0 ? 'B3-2 VERIFY: ALL PASS' : `B3-2 VERIFY: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
