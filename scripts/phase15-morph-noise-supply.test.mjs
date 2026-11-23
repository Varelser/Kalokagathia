// Phase 15 (TD §1) tests: noise-field supply for the morph bake.
// Plain Node + esbuild bundle, same style as scripts/kcb1_test.mjs.
// Run: node scripts/phase15-morph-noise-supply.test.mjs

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-morph-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

await build({
  stdin: {
    contents: `
      export { buildMorphBakeData } from './components/useGpgpuRuntime.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { getNoiseFieldLuma } from './lib/mapSourceSupply.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const { buildMorphBakeData, DEFAULT_CONFIG, getNoiseFieldLuma } = m;

  // A snapshot map with a hard left/right split (left lit, right dark).
  const W = 8, H = 8;
  const snap = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) snap[y * W + x] = x < W / 2 ? 1 : 0;

  const base = {
    ...DEFAULT_CONFIG,
    gpgpuMorphEnabled: true,
    gpgpuMorphTarget: 'image',
    layer2MediaLumaMap: snap,
    layer2MediaMapWidth: W,
    layer2MediaMapHeight: H,
    gpgpuNoiseMapScale: 0.02,
    gpgpuNoiseMapKind: 'perlin',
    gpgpuNoiseMapOctaves: 2,
  };
  const TEX = 16;

  const off1 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: false }, TEX);
  const off2 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: false }, TEX);
  check('off: bake produced', !!off1 && off1.data.length === TEX * TEX * 4);
  let offSame = true;
  for (let i = 0; i < off1.data.length; i++) if (off1.data[i] !== off2.data[i]) { offSame = false; break; }
  check('off: deterministic (two bakes byte-identical)', offSame);

  const on1 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: true }, TEX);
  const on2 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: true }, TEX);
  check('on: bake produced', !!on1 && on1.data.length === TEX * TEX * 4);
  let onSame = true;
  for (let i = 0; i < on1.data.length; i++) if (on1.data[i] !== on2.data[i]) { onSame = false; break; }
  check('on: deterministic (two bakes byte-identical)', onSame);

  let diff = 0;
  for (let i = 0; i < off1.data.length; i++) if (off1.data[i] !== on1.data[i]) diff++;
  check('on != off: the field actually supplies the bake', diff > off1.data.length * 0.3, `diff entries ${diff}/${off1.data.length}`);

  // The supplied map is exactly the BJ supply raster at 128.
  const luma = getNoiseFieldLuma({ ...base, gpgpuMorphNoiseMapEnabled: true }, 128);
  check('supply: noise luma is 128x128', luma.length === 128 * 128);
  let mn = 1, mx = 0;
  for (let i = 0; i < luma.length; i++) { if (luma[i] < mn) mn = luma[i]; if (luma[i] > mx) mx = luma[i]; }
  check('supply: field has real variation (not a flat slice)', mx - mn > 0.2, `range ${mn.toFixed(3)}..${mx.toFixed(3)}`);

  // Changing the field kind changes the bake (the supply is live, not cached-flat).
  const onRidge = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: true, gpgpuNoiseMapKind: 'ridge' }, TEX);
  let diffKind = 0;
  for (let i = 0; i < on1.data.length; i++) if (on1.data[i] !== onRidge.data[i]) diffKind++;
  check('on: field kind changes the bake', diffKind > on1.data.length * 0.1, `diff entries ${diffKind}/${on1.data.length}`);

  // ---- supply time (TD §1 stage 2): the slice can be taken evolved ----
  const lumaT0 = getNoiseFieldLuma({ ...base, gpgpuNoiseMapEvolve: 1.5, gpgpuNoiseFieldSupplyTime: 0 }, 128);
  const lumaT8 = getNoiseFieldLuma({ ...base, gpgpuNoiseMapEvolve: 1.5, gpgpuNoiseFieldSupplyTime: 8 }, 128);
  let diffT = 0;
  for (let i = 0; i < lumaT0.length; i++) if (lumaT0[i] !== lumaT8[i]) diffT++;
  check('supply time: evolved slice differs from time-0 slice', diffT > lumaT0.length * 0.5, `diff cells ${diffT}/${lumaT0.length}`);
  // With evolve 0 the offset is zero at any time: slice unchanged.
  const lumaE0T8 = getNoiseFieldLuma({ ...base, gpgpuNoiseMapEvolve: 0, gpgpuNoiseFieldSupplyTime: 8 }, 128);
  const lumaBase = getNoiseFieldLuma({ ...base }, 128);
  let diffE0 = 0;
  for (let i = 0; i < lumaBase.length; i++) if (lumaBase[i] !== lumaE0T8[i]) diffE0++;
  check('supply time: evolve 0 keeps the legacy slice at any supply time', diffE0 === 0, `diff cells ${diffE0}`);
  // And the morph bake follows the evolved slice.
  const onT8 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: true, gpgpuNoiseMapEvolve: 1.5, gpgpuNoiseFieldSupplyTime: 8 }, TEX);
  const onT0 = buildMorphBakeData({ ...base, gpgpuMorphNoiseMapEnabled: true, gpgpuNoiseMapEvolve: 1.5, gpgpuNoiseFieldSupplyTime: 0 }, TEX);
  let diffBakeT = 0;
  for (let i = 0; i < onT0.data.length; i++) if (onT0.data[i] !== onT8.data[i]) diffBakeT++;
  check('supply time: morph bake follows the evolved slice', diffBakeT > onT0.data.length * 0.1, `diff entries ${diffBakeT}/${onT0.data.length}`);

  // Regression guard (Phase 15 gate fix, 2026-11-23): the primary
  // WebGL morph-texture effect in useGpgpuRuntime has its OWN
  // mediaMap logic and originally had no noise branch — the gate's
  // OFF/ON captures came back pixel-identical while the shared
  // builder was correct. The effect must carry the branch and the
  // rebake deps must include the flag + field signature.
  const { readFileSync } = await import('node:fs');
  const runtimeSrc = readFileSync(new URL('../components/useGpgpuRuntime.ts', import.meta.url), 'utf8');
  check('primary WebGL morph effect carries the noise branch', runtimeSrc.includes("morphTarget === 'image' && morphNoiseMapEnabled"));
  check('rebake deps include flag + noise signature', runtimeSrc.includes('morphNoiseSignature,'));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  const { rmSync } = await import('node:fs');
  try { rmSync(BUNDLE); } catch { /* already gone */ }
}
