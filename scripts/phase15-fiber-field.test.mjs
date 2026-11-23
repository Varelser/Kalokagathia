// Phase 15 (Houdini §11) tests: fiber root sources + groom field.
// Generator level: 'uniform' is byte-identical to the Phase AL
// path; field modes are position functions (deterministic, no
// rng consumption — same roots); align 0 skips the field.
// Supply level: the emit cloud feeds the generator, and the
// terrain bake override yields a bake while morph is disabled.
// Run: node scripts/phase15-fiber-field.test.mjs

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-fiber-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const differs = (a, b) => a.length === b.length && a.some((v, i) => v !== b[i]);

await build({
  stdin: {
    contents: `
      export { buildMorphFiberStrands } from './lib/morphFiber.ts';
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { buildMorphBakeData } from './components/useGpgpuRuntime.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const { buildMorphFiberStrands, buildGpgpuInitialData, buildMorphBakeData, DEFAULT_CONFIG } =
    await import(pathToFileURL(BUNDLE).href);

  // Deterministic sphere cloud fixture.
  const N = 512;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const y = -1 + (2 * (i % 16)) / 15;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pts[i * 3] = Math.cos(t) * r * 10;
    pts[i * 3 + 1] = y * 10;
    pts[i * 3 + 2] = Math.sin(t) * r * 10;
  }
  const base = { count: 200, length: 2, curl: 0.4, seed: 42 };

  const legacy = buildMorphFiberStrands(pts, null, N, { ...base, groom: [1, 0, 0], groomAlign: 0.8 });
  const uniform = buildMorphFiberStrands(pts, null, N, { ...base, groom: [1, 0, 0], groomAlign: 0.8, groomField: 'uniform' });
  check("groomField 'uniform' is byte-identical to the Phase AL path", eq(legacy.positions, uniform.positions));

  const noGroom = buildMorphFiberStrands(pts, null, N, { ...base });
  const fieldZeroAlign = buildMorphFiberStrands(pts, null, N, { ...base, groomAlign: 0, groomField: 'radial' });
  check('field with align 0 is identical to no grooming', eq(noGroom.positions, fieldZeroAlign.positions));

  // Explicit +Y normals: with null normals the generator's own
  // radial fallback would make radial grooming an identity.
  const upNormals = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) upNormals[i * 3 + 1] = 1;
  const noGroomUp = buildMorphFiberStrands(pts, upNormals, N, { ...base });
  const radial = buildMorphFiberStrands(pts, upNormals, N, { ...base, groomAlign: 1, groomField: 'radial' });
  check('radial field grooms without a global vector', differs(noGroomUp.positions, radial.positions));
  const radial2 = buildMorphFiberStrands(pts, upNormals, N, { ...base, groomAlign: 1, groomField: 'radial' });
  check('radial field is deterministic', eq(radial.positions, radial2.positions));
  check('field keeps the same strand count (no rng shift)', radial.strandCount === noGroom.strandCount,
    `${radial.strandCount} vs ${noGroom.strandCount}`);

  const swirl = buildMorphFiberStrands(pts, upNormals, N, { ...base, groomAlign: 1, groomField: 'swirl' });
  check('swirl field differs from radial', differs(radial.positions, swirl.positions));
  const noise = buildMorphFiberStrands(pts, upNormals, N, { ...base, groomAlign: 1, groomField: 'noise', groomFieldScale: 0.5 });
  check('noise field differs from radial', differs(radial.positions, noise.positions));

  // Emit supply: spawn cloud points feed the generator.
  const init = buildGpgpuInitialData(32, 25, 'sphere', 7);
  const n32 = 32 * 32;
  const emitPts = new Float32Array(n32 * 3);
  for (let i = 0; i < n32; i++) {
    emitPts[i * 3] = init.posData[i * 4];
    emitPts[i * 3 + 1] = init.posData[i * 4 + 1];
    emitPts[i * 3 + 2] = init.posData[i * 4 + 2];
  }
  const emitStrands = buildMorphFiberStrands(emitPts, null, n32, { count: 300, length: 2, curl: 0.4, seed: 7 });
  check('emit cloud roots strands', emitStrands.strandCount === 300, `got ${emitStrands.strandCount}`);

  // Terrain supply: morph disabled in the base config; the
  // component's override (enabled + terrain target) yields a bake.
  check('bake is null while morph is disabled', buildMorphBakeData(DEFAULT_CONFIG, 96) === null);
  const terrainBake = buildMorphBakeData({ ...DEFAULT_CONFIG, gpgpuMorphEnabled: true, gpgpuMorphTarget: 'terrain' }, 96);
  check('terrain override yields a bake', terrainBake !== null && terrainBake.data.length === 96 * 96 * 4);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
