// Phase 40 — hand-drawn erosion mask (Round 83 gap 1, design
// R83-01 by #2). Pins the design's acceptance lines A1-A5 at
// lib level:
// - A1: mode 'drawn' with an empty / absent grid resolves to
//   no mask; the eroded field is byte-identical to mode 'off'
// - A2: the resolved mask differs from the neutral mask only
//   inside the painted footprint
// - A3: changing the grid changes the eroded field; restoring
//   the grid restores the exact bytes (cache identity)
// - A4: a config JSON round-trip (the preset path) preserves
//   the grid and the field bytes
// - A5: the 'hand-drawn:mask' sentinel texture carries the
//   same values as the resolved mask grid
// Real public APIs only (esbuild bundle, PASS/FAIL, exit code).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p40-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const hashOf = (arr) => createHash('sha256').update(Buffer.from(arr.buffer ?? arr)).digest('hex');

await build({
  stdin: {
    contents: `
      export {
        resolveTerrainErosionMask, buildErosionMaskGrid, getErodedTerrainField,
        TERRAIN_EROSION_GRID_SIZE,
      } from './lib/gpgpuMorphTargets.ts';
      export {
        HAND_DRAWN_MASK_SOURCE, handDrawnMaskBytes, getHandDrawnMaskTexture,
        resolveMapSourceTexture, terrainOptionsFromConfig,
      } from './lib/terrainDerivedMaps.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveTerrainErosionMask, buildErosionMaskGrid, getErodedTerrainField,
  TERRAIN_EROSION_GRID_SIZE: N,
  HAND_DRAWN_MASK_SOURCE, handDrawnMaskBytes, getHandDrawnMaskTexture,
  resolveMapSourceTexture, terrainOptionsFromConfig,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const SIZE = N * N;
// A painted block: rows/cols 40..60 at full value.
const painted = new Array(SIZE).fill(0);
for (let j = 40; j <= 60; j++) for (let i = 40; i <= 60; i++) painted[j * N + i] = 1;
const painted2 = painted.slice();
painted2[80 * N + 90] = 0.7;

const erosionBase = { water: 0.6, droplets: 0.5, deposit: 0.3, thermal: 0.4, talus: 0.5, thermalPasses: 8, seed: 3 };
const terrainWith = (mask) => ({
  amplitude: 0.55, frequency: 1.6, octaves: 4, seed: 0,
  erosion: { ...erosionBase, mask },
});
const FIELD_SEED = 1234;

// ── default key ─────────────────────────────────────────────
check('default: drawn grid key exists and is empty',
  Array.isArray(APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskDrawnGrid)
  && APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskDrawnGrid.length === 0);

// ── A1: empty drawn == no mask == off bytes ─────────────────
{
  const resolvedEmpty = resolveTerrainErosionMask({ mask: { mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: [] } });
  check('A1: drawn with empty grid resolves to null mask', resolvedEmpty === null,
    JSON.stringify(resolvedEmpty));
  const off = getErodedTerrainField(terrainWith({ mode: 'off', strength: 1, invert: false, low: 0, high: 1 }), FIELD_SEED);
  const drawnEmpty = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: [] }), FIELD_SEED);
  check('A1: drawn-empty field is byte-identical to off',
    off && drawnEmpty && hashOf(off.heights) === hashOf(drawnEmpty.heights));
  const drawnAbsent = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1 }), FIELD_SEED);
  check('A1: drawn with absent grid is byte-identical to off',
    off && drawnAbsent && hashOf(off.heights) === hashOf(drawnAbsent.heights));
}

// ── A2: mask footprint ──────────────────────────────────────
{
  const heights = new Float32Array(SIZE).fill(0.5);
  const resolved = resolveTerrainErosionMask({ mask: { mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: painted } });
  check('A2: drawn mask resolves (mode folds to image path)', resolved !== null && resolved.mode === 'image',
    JSON.stringify(resolved));
  const grid = buildErosionMaskGrid(heights, N, 2.1 / (N - 1), resolved);
  let outsideDiff = 0;
  let insideDiff = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = grid[j * N + i];
    const inside = i >= 40 && i <= 60 && j >= 40 && j <= 60;
    if (inside) { if (Math.abs(v - 1) > 1e-6) insideDiff += 1; }
    else if (Math.abs(v - 0) > 1e-6) outsideDiff += 1;
  }
  check('A2: mask is 1 inside the footprint', insideDiff === 0, `insideDiff=${insideDiff}`);
  check('A2: mask is 0 outside the footprint', outsideDiff === 0, `outsideDiff=${outsideDiff}`);
  const fieldDrawn = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: painted }), FIELD_SEED);
  const fieldOff = getErodedTerrainField(terrainWith({ mode: 'off', strength: 1, invert: false, low: 0, high: 1 }), FIELD_SEED);
  check('A2: painted mask changes the eroded field',
    fieldDrawn && fieldOff && hashOf(fieldDrawn.heights) !== hashOf(fieldOff.heights));
}

// ── A3: grid change -> field change -> restore -> same bytes ─
{
  const a = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: painted }), FIELD_SEED);
  const b = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: painted2 }), FIELD_SEED);
  const a2 = getErodedTerrainField(terrainWith({ mode: 'drawn', strength: 1, invert: false, low: 0, high: 1, drawnGrid: painted.slice() }), FIELD_SEED);
  check('A3: a one-cell grid change changes the field',
    a && b && hashOf(a.heights) !== hashOf(b.heights));
  check('A3: restoring the grid restores the exact field bytes',
    a && a2 && hashOf(a.heights) === hashOf(a2.heights));
}

// ── A4: config JSON round-trip (preset path) ────────────────
{
  const cfg = {
    ...APP_STATE_DEFAULT_GPGPU,
    gpgpuMorphTerrainErosionMaskMode: 'drawn',
    gpgpuMorphTerrainErosionMaskDrawnGrid: painted,
    gpgpuMorphTerrainErosionWater: erosionBase.water,
    gpgpuMorphTerrainErosionDroplets: erosionBase.droplets,
    gpgpuMorphTerrainErosionDeposit: erosionBase.deposit,
    gpgpuMorphTerrainErosionThermal: erosionBase.thermal,
    gpgpuMorphTerrainErosionTalus: erosionBase.talus,
    gpgpuMorphTerrainErosionThermalPasses: erosionBase.thermalPasses,
    gpgpuMorphTerrainErosionSeed: erosionBase.seed,
  };
  const roundTripped = JSON.parse(JSON.stringify(cfg));
  check('A4: grid survives the JSON round-trip',
    JSON.stringify(roundTripped.gpgpuMorphTerrainErosionMaskDrawnGrid) === JSON.stringify(painted));
  const t1 = terrainOptionsFromConfig(cfg);
  const t2 = terrainOptionsFromConfig(roundTripped);
  const f1 = getErodedTerrainField(t1, FIELD_SEED);
  const f2 = getErodedTerrainField(t2, FIELD_SEED);
  check('A4: round-tripped config bakes the identical field',
    f1 && f2 && hashOf(f1.heights) === hashOf(f2.heights));
  check('A4: config assembly carries the drawn grid into the mask options',
    t1.erosion?.mask?.drawnGrid === cfg.gpgpuMorphTerrainErosionMaskDrawnGrid
    || (Array.isArray(t1.erosion?.mask?.drawnGrid) && t1.erosion.mask.drawnGrid.length === SIZE));
}

// ── A5: sentinel texture == resolved mask values ────────────
{
  check('A5: sentinel constant is hand-drawn:mask', HAND_DRAWN_MASK_SOURCE === 'hand-drawn:mask');
  const built = handDrawnMaskBytes(painted);
  check('A5: bytes build at the grid side', built !== null && built.size === N);
  let bytesOk = true;
  for (let i = 0; i < SIZE; i++) {
    if (built.bytes[i * 4] !== Math.round(painted[i] * 255)) { bytesOk = false; break; }
  }
  check('A5: sentinel bytes equal the grid values', bytesOk);
  const cfg = { ...APP_STATE_DEFAULT_GPGPU, gpgpuMorphTerrainErosionMaskDrawnGrid: painted };
  const state = resolveMapSourceTexture(HAND_DRAWN_MASK_SOURCE, cfg);
  check('A5: sentinel resolves ready with a texture', state.ready === true && state.texture !== null);
  const data = state.texture?.image?.data;
  check('A5: texture data equals the sentinel bytes',
    !!data && data.length === built.bytes.length && data.every((v, i) => v === built.bytes[i]));
  const empty = resolveMapSourceTexture(HAND_DRAWN_MASK_SOURCE, { ...APP_STATE_DEFAULT_GPGPU });
  check('A5: empty grid resolves not-ready (no mask)', empty.ready === false && empty.texture === null);
  const direct = getHandDrawnMaskTexture(cfg);
  check('A5: direct getter agrees', direct.ready === true && direct.texture === state.texture);
  check('A5: invalid grid yields null bytes', handDrawnMaskBytes([1, 2, 3]) === null && handDrawnMaskBytes([]) === null);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
