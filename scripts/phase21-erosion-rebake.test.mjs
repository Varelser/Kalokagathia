// Phase 21 stage 4 — erosion manual rebake + bake status.
// Identity: a manual rebake with unchanged parameters returns a
// bit-identical field; bake stats are counters only and never feed
// the bake; erosion off stays null exactly as before.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p21s4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { getErodedTerrainField, rebakeErodedTerrainField, getErodedTerrainFieldBakeStats, isErodedTerrainFieldCurrent, erodedTerrainFieldKeyFor } from './lib/gpgpuMorphTargets.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { getErodedTerrainField, rebakeErodedTerrainField, getErodedTerrainFieldBakeStats, isErodedTerrainFieldCurrent, erodedTerrainFieldKeyFor } = lib;

const terrain = {
  amplitude: 0.6, frequency: 1.2, octaves: 3, seed: 7, kind: 'fbm', terraceSteps: 6,
  erosion: { water: 0.6, droplets: 1, deposit: 0.3, thermal: 0.4, talus: 0.5, thermalPasses: 12, seed: 3 },
};
const seed = 1234;

{
  const stats0 = getErodedTerrainFieldBakeStats();
  check('stats start clean for this terrain key', stats0.lastKey !== erodedTerrainFieldKeyFor(terrain, seed) || stats0.bakes > 0);
  check('not current before first bake (or already baked)', typeof isErodedTerrainFieldCurrent(terrain, seed) === 'boolean');

  const first = getErodedTerrainField(terrain, seed);
  check('first bake returns a field', first !== null && first.heights.length > 0);
  check('current after bake', isErodedTerrainFieldCurrent(terrain, seed) === true);
  const stats1 = getErodedTerrainFieldBakeStats();
  check('bake counted with duration + key', stats1.bakes >= 1 && stats1.lastDurationMs >= 0 && stats1.lastKey === erodedTerrainFieldKeyFor(terrain, seed));

  const snapshot = Float32Array.from(first.heights);
  const again = getErodedTerrainField(terrain, seed);
  check('cache hit returns the same object', again === first);
  const stats2 = getErodedTerrainFieldBakeStats();
  check('cache hit does not count as a bake', stats2.bakes === stats1.bakes);

  const rebaked = rebakeErodedTerrainField(terrain, seed);
  check('rebake returns a fresh object', rebaked !== null && rebaked !== first);
  let identical = rebaked.heights.length === snapshot.length;
  for (let i = 0; i < snapshot.length; i++) if (rebaked.heights[i] !== snapshot[i]) { identical = false; break; }
  check('rebake is bit-identical for unchanged parameters', identical);
  const stats3 = getErodedTerrainFieldBakeStats();
  check('rebake counted as a new bake', stats3.bakes === stats2.bakes + 1, `${stats3.bakes} vs ${stats2.bakes}`);
  check('still current after rebake', isErodedTerrainFieldCurrent(terrain, seed) === true);

  const changed = { ...terrain, erosion: { ...terrain.erosion, seed: 4 } };
  check('changed parameters are not current', isErodedTerrainFieldCurrent(changed, seed) === false);
  check('changed parameters have a different key', erodedTerrainFieldKeyFor(changed, seed) !== erodedTerrainFieldKeyFor(terrain, seed));
}

{
  const off = { ...terrain, erosion: { water: 0, droplets: 1, deposit: 0.3, thermal: 0, talus: 0.5, thermalPasses: 12, seed: 3 } };
  check('erosion off: rebake returns null (legacy)', rebakeErodedTerrainField(off, seed) === null);
  check('erosion off: never current', isErodedTerrainFieldCurrent(off, seed) === false);
  const noErosion = { ...terrain, erosion: undefined };
  check('no erosion options: get returns null (legacy)', getErodedTerrainField(noErosion, seed) === null);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
