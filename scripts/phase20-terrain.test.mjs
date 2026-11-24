// Phase 20 stage 0 — terrain dedicated tests.
// First dedicated test file for the terrain modules:
// lib/gpgpuMorphTargets.ts (terrainHeightAt / erosion),
// lib/terrainHeightfield.ts (publication) and
// lib/terrainDerivedMaps.ts (derived bakes). Previously the
// terrain modules had no unit tests importing them directly.
// Real public APIs only, in the identity style of the
// phase17/19 tests (esbuild bundle, PASS/FAIL lines, exit code).
//
// Behaviours pinned (all read off the sources first):
// - terrainHeightAt is deterministic per (point, params, seed),
//   changes with the field seed, stays within ±amplitude for
//   every recipe, and is exactly 0 at amplitude 0
// - resolveTerrainErosion: null identity for absent / zero
//   strengths, budgets clamped (droplets / thermal passes)
// - erodeHeightGridInPlace is deterministic for a fixed RNG
//   seed, differs for another seed, and actually moves heights
// - getErodedTerrainField: null without erosion, a 129x129
//   field with it, whose sampler reproduces the grid nodes
// - derived maps: the 3 kinds, dimensions, flat-grid values
//   (slope 0, normal = +Y encoding, curvature mid), source
//   string round-trip
// - publication: getTerrainHeightfield is null without erosion
//   (and in tunnel mode), wraps the field in world units with
//   it, samples clamped to the domain, normals are unit length
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20t-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        terrainHeightAt, terrainGradientAt, terrainFieldSeedFor,
        resolveTerrainErosion, resolveTerrainErosionMask, buildErosionMaskGrid,
        createTerrainErosionMeasure,
        erodeHeightGridInPlace, getErodedTerrainField,
        sampleErodedField, erosionRngSeedFor,
        TERRAIN_EROSION_GRID_SIZE, TERRAIN_EROSION_MAX_DROPLETS,
        TERRAIN_EROSION_MAX_THERMAL_PASSES, DEFAULT_TERRAIN,
      } from './lib/gpgpuMorphTargets.ts';
      export {
        TERRAIN_DERIVED_KINDS, TERRAIN_DERIVED_SIZE, buildTerrainHeightGrid,
        buildTerrainDerivedMaps, deriveMapsFromHeightGrid,
        terrainDerivedMapBytes, terrainDerivedSource, parseTerrainDerivedSource,
        terrainOptionsFromConfig, getTerrainDerivedMaps,
      } from './lib/terrainDerivedMaps.ts';
      export { getTerrainHeightfield, sampleTerrainHeightfield, terrainHeightfieldNormal } from './lib/terrainHeightfield.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  terrainHeightAt, terrainGradientAt, terrainFieldSeedFor,
  resolveTerrainErosion, resolveTerrainErosionMask, buildErosionMaskGrid,
  createTerrainErosionMeasure,
  erodeHeightGridInPlace, getErodedTerrainField,
  sampleErodedField, erosionRngSeedFor,
  TERRAIN_EROSION_GRID_SIZE, TERRAIN_EROSION_MAX_DROPLETS,
  TERRAIN_EROSION_MAX_THERMAL_PASSES, DEFAULT_TERRAIN,
  TERRAIN_DERIVED_KINDS, TERRAIN_DERIVED_SIZE, buildTerrainHeightGrid,
  buildTerrainDerivedMaps, deriveMapsFromHeightGrid,
  terrainDerivedMapBytes, terrainDerivedSource, parseTerrainDerivedSource,
  terrainOptionsFromConfig, getTerrainDerivedMaps,
  getTerrainHeightfield, sampleTerrainHeightfield, terrainHeightfieldNormal,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const TERRAIN = { amplitude: 0.55, frequency: 1.6, octaves: 4, seed: 0 };
const FIELD_SEED = terrainFieldSeedFor(7, 0);
const POINTS = [[0, 0], [0.3, -0.7], [-0.9, 0.45], [1.0, 1.0], [-1.05, -1.05], [0.123, 0.987]];

// ── terrainHeightAt: determinism / seed / bounds ──────────────
{
  const again = POINTS.map(([x, z]) => terrainHeightAt(x, z, TERRAIN, FIELD_SEED));
  const first = POINTS.map(([x, z]) => terrainHeightAt(x, z, TERRAIN, FIELD_SEED));
  check('height: same seed -> identical heights (deterministic)',
    first.every((h, i) => h === again[i]));
  const otherSeed = terrainFieldSeedFor(7, 5);
  check('height: field-seed mixing is deterministic and seed-sensitive',
    terrainFieldSeedFor(7, 5) === otherSeed && otherSeed !== FIELD_SEED);
  const other = POINTS.map(([x, z]) => terrainHeightAt(x, z, TERRAIN, otherSeed));
  check('height: a different seed changes the field somewhere',
    other.some((h, i) => h !== first[i]));
  for (const kind of ['fbm', 'ridge', 'terrace', 'cellular']) {
    let maxAbs = 0;
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
      const h = terrainHeightAt(-1.05 + i * 0.105, -1.05 + j * 0.105, { ...TERRAIN, kind }, FIELD_SEED);
      maxAbs = Math.max(maxAbs, Math.abs(h));
    }
    check(`height: recipe '${kind}' stays within ±amplitude`, maxAbs <= TERRAIN.amplitude + 1e-9, `maxAbs=${maxAbs}`);
  }
  check('height: amplitude 0 is exactly flat everywhere',
    POINTS.every(([x, z]) => terrainHeightAt(x, z, { ...TERRAIN, amplitude: 0 }, FIELD_SEED) === 0));
  const g = terrainGradientAt(0.25, -0.5, { ...TERRAIN, amplitude: 0 }, FIELD_SEED);
  check('gradient: flat field gradient is exactly 0', g.gx === 0 && g.gz === 0, JSON.stringify(g));
  const g2 = terrainGradientAt(0.25, -0.5, TERRAIN, FIELD_SEED);
  check('gradient: sloped field gradient is finite and non-zero somewhere',
    Number.isFinite(g2.gx) && Number.isFinite(g2.gz) && (g2.gx !== 0 || g2.gz !== 0));
}

// ── Erosion resolution ────────────────────────────────────────
{
  check('erosion: absent options resolve to null', resolveTerrainErosion(undefined) === null && resolveTerrainErosion(null) === null);
  check('erosion: both strengths 0 resolve to null',
    resolveTerrainErosion({ water: 0, droplets: 1, deposit: 0.3, thermal: 0, talus: 0.5, thermalPasses: 24, seed: 0 }) === null);
  const r = resolveTerrainErosion({ water: 2, droplets: 9, deposit: 0.3, thermal: 1, talus: 0.5, thermalPasses: 999, seed: 3 });
  check('erosion: strengths clamped to 1', r !== null && r.water === 1 && r.thermal === 1);
  check('erosion: droplet budget clamped', r !== null && r.dropletCount === TERRAIN_EROSION_MAX_DROPLETS, `count=${r?.dropletCount}`);
  check('erosion: thermal passes clamped', r !== null && r.thermalPasses === TERRAIN_EROSION_MAX_THERMAL_PASSES, `passes=${r?.thermalPasses}`);
}

// ── Erosion on a grid: determinism / seed / effect ────────────
{
  const N = 33;
  const step = 2.1 / (N - 1);
  const baseGrid = () => {
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      heights[j * N + i] = terrainHeightAt(-1.05 + i * step, -1.05 + j * step, TERRAIN, FIELD_SEED);
    }
    return heights;
  };
  const resolved = resolveTerrainErosion({ water: 0.8, droplets: 0.02, deposit: 0.3, thermal: 0.6, talus: 0.5, thermalPasses: 8, seed: 11 });
  const rngSeed = erosionRngSeedFor(FIELD_SEED, resolved.seed);
  const run = (seed) => {
    const heights = baseGrid();
    erodeHeightGridInPlace(heights, N, step, resolved, seed);
    return heights;
  };
  const a = run(rngSeed);
  const b = run(rngSeed);
  check('erosion: same RNG seed -> identical grid (deterministic)',
    a.every((h, i) => h === b[i]));
  const c = run(rngSeed + 1);
  check('erosion: a different RNG seed changes the grid somewhere',
    c.some((h, i) => h !== a[i]));
  const base = baseGrid();
  check('erosion: the sim actually moves heights', a.some((h, i) => h !== base[i]));
  check('erosion: heights stay finite', a.every((h) => Number.isFinite(h)));
}

// ── Eroded field ──────────────────────────────────────────────
{
  check('eroded field: null while erosion is off', getErodedTerrainField(TERRAIN, FIELD_SEED) === null);
  const eroding = {
    ...TERRAIN,
    erosion: { water: 0.8, droplets: 0.05, deposit: 0.3, thermal: 0.4, talus: 0.5, thermalPasses: 12, seed: 2 },
  };
  const field = getErodedTerrainField(eroding, FIELD_SEED);
  check('eroded field: built while erosion is on', field !== null);
  check('eroded field: grid is the erosion grid size',
    field !== null && field.size === TERRAIN_EROSION_GRID_SIZE && field.heights.length === TERRAIN_EROSION_GRID_SIZE ** 2,
    `size=${field?.size}`);
  // The sampler reproduces grid nodes exactly.
  const nodeOk = field !== null && [0, 40, 128].every((i) => [0, 77, 128].every((j) =>
    near(sampleErodedField(field, -field.extent + i * field.step, -field.extent + j * field.step),
      field.heights[j * field.size + i], 1e-6)));
  check('eroded field: sampler reproduces grid nodes', nodeOk);
  const maxDiff = field === null ? 0 : Math.max(...Array.from({ length: 441 }, (_, k) => {
    const i = k % 21; const j = Math.floor(k / 21);
    const x = -1.05 + i * 0.105; const z = -1.05 + j * 0.105;
    return Math.abs(sampleErodedField(field, x, z) - terrainHeightAt(x, z, eroding, FIELD_SEED));
  }));
  check('eroded field: erosion moved the sampled surface', maxDiff > 1e-4, `maxDiff=${maxDiff}`);
}

// ── Derived maps ──────────────────────────────────────────────
{
  check('derived: kinds are normal/slope/curvature + flow/deposit/erosion/moisture',
    TERRAIN_DERIVED_KINDS.length === 7 && TERRAIN_DERIVED_KINDS[0] === 'normal'
    && TERRAIN_DERIVED_KINDS[1] === 'slope' && TERRAIN_DERIVED_KINDS[2] === 'curvature'
    && TERRAIN_DERIVED_KINDS[3] === 'flow' && TERRAIN_DERIVED_KINDS[4] === 'deposit'
    && TERRAIN_DERIVED_KINDS[5] === 'erosion' && TERRAIN_DERIVED_KINDS[6] === 'moisture');
  check('derived: default size is the mesh grid + 1', TERRAIN_DERIVED_SIZE === 129, `size=${TERRAIN_DERIVED_SIZE}`);
  const maps = buildTerrainDerivedMaps(TERRAIN, 7, 17);
  check('derived: map dimensions follow the requested size',
    maps.size === 17 && maps.normal.length === 17 * 17 * 4 && maps.slope.length === 17 * 17 * 4
    && maps.curvature.length === 17 * 17 * 4 && maps.gradient.length === 17 * 17 * 4 && maps.collider.length === 17 * 17 * 4);
  check('derived: map bytes select the right bake',
    terrainDerivedMapBytes(maps, 'normal') === maps.normal
    && terrainDerivedMapBytes(maps, 'slope') === maps.slope
    && terrainDerivedMapBytes(maps, 'curvature') === maps.curvature);
  check('derived: alpha is opaque everywhere',
    [maps.normal, maps.slope, maps.curvature].every((arr) => {
      for (let i = 3; i < arr.length; i += 4) if (arr[i] !== 255) return false;
      return true;
    }));

  const flat = deriveMapsFromHeightGrid(new Float32Array(9 * 9), 9, 0.2625);
  check('derived: flat grid has zero gradient and curvature',
    flat.maxGradient === 0 && flat.maxAbsCurvature === 0 && flat.maxAbsHeight === 0);
  check('derived: flat slope map is all zero',
    Array.from(flat.slope).every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)));
  check('derived: flat normal map encodes +Y',
    flat.normal[0] === 128 && flat.normal[1] === 255 && flat.normal[2] === 128 && flat.normal[3] === 255,
    `normal0=${Array.from(flat.normal.slice(0, 4))}`);
  check('derived: flat curvature map is the mid value',
    flat.curvature[0] === 128 && flat.curvature[1] === 128 && flat.curvature[2] === 128);

  check('derived: source string round-trips',
    terrainDerivedSource('slope') === 'terrain-derived:slope'
    && parseTerrainDerivedSource('terrain-derived:slope') === 'slope'
    && parseTerrainDerivedSource('terrain-derived:bogus') === null
    && parseTerrainDerivedSource('something-else') === null);

  const grid = buildTerrainHeightGrid(TERRAIN, 7, 17);
  check('height grid: dimensions and step',
    grid.size === 17 && grid.heights.length === 17 * 17 && near(grid.step, 2.1 / 16, 1e-9), `step=${grid.step}`);
  check('height grid: corners match terrainHeightAt',
    near(grid.heights[0], terrainHeightAt(-grid.extent, -grid.extent, TERRAIN, FIELD_SEED), 1e-6));
}

// ── Published heightfield (world units) ───────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  check('publication: null while erosion is off (defaults)',
    base.gpgpuMorphTerrainErosionWater === 0 && base.gpgpuMorphTerrainErosionThermal === 0
      ? getTerrainHeightfield(base) === null
      : 'defaults have erosion on — premise broken');
  const erodingConfig = {
    ...base,
    gpgpuMorphTerrainErosionWater: 0.8,
    gpgpuMorphTerrainErosionDroplets: 0.05,
    gpgpuMorphTerrainErosionThermal: 0.4,
  };
  const field = getTerrainHeightfield(erodingConfig);
  check('publication: field published while erosion is on', field !== null);
  const expectedScale = erodingConfig.gpgpuMorphScale * erodingConfig.gpgpuBounceRadius * 0.48;
  check('publication: world units (extent and scale)',
    field !== null && near(field.worldScale, expectedScale, 1e-9) && near(field.extent, 1.05 * expectedScale, 1e-6),
    `scale=${field?.worldScale} expected=${expectedScale}`);
  check('publication: grid shape carried over',
    field !== null && field.size === TERRAIN_EROSION_GRID_SIZE && field.heights.length === TERRAIN_EROSION_GRID_SIZE ** 2);
  check('publication: sampling clamps to the domain edge',
    field !== null && near(
      sampleTerrainHeightfield(field, field.extent * 10, 0),
      sampleTerrainHeightfield(field, field.extent, 0), 1e-6));
  const n = field === null ? [0, 0, 0] : terrainHeightfieldNormal(field, 0.2, -0.3);
  check('publication: normals are unit length',
    near(Math.hypot(n[0], n[1], n[2]), 1, 1e-6), `|n|=${Math.hypot(n[0], n[1], n[2])}`);
  check('publication: tunnel mode strips the field',
    getTerrainHeightfield({ ...erodingConfig, gpgpuTerrainMeshTunnel: true }) === null);
  check('defaults: DEFAULT_TERRAIN is the documented fbm base',
    DEFAULT_TERRAIN.amplitude === 0.55 && DEFAULT_TERRAIN.frequency === 1.6 && DEFAULT_TERRAIN.octaves === 4);
}

// ── Erosion mask resolution (Phase 20 stage 3) ───────────────
{
  check('mask: absent / off resolves to null',
    resolveTerrainErosionMask(undefined) === null
    && resolveTerrainErosionMask({ water: 1, droplets: 1, deposit: 0.3, thermal: 0, talus: 0.5, thermalPasses: 24, seed: 0 }) === null
    && resolveTerrainErosionMask({ mask: { mode: 'off', strength: 1, invert: false, low: 0, high: 1 } }) === null);
  const m = resolveTerrainErosionMask({ mask: { mode: 'height', strength: 2, invert: 1, low: -1, high: 9 } });
  check('mask: fields clamped, invert coerced',
    m !== null && m.mode === 'height' && m.strength === 1 && m.invert === true && m.low === 0 && m.high === 1,
    JSON.stringify(m));
  check('mask: erosion resolution carries the mask',
    resolveTerrainErosion({ water: 0.5, droplets: 1, deposit: 0.3, thermal: 0, talus: 0.5, thermalPasses: 24, seed: 0, mask: { mode: 'slope', strength: 1, invert: false, low: 0.2, high: 0.8 } })?.mask?.mode === 'slope'
    && resolveTerrainErosion({ water: 0.5, droplets: 1, deposit: 0.3, thermal: 0, talus: 0.5, thermalPasses: 24, seed: 0 })?.mask === null);
  check('mask: defaults are off in the app state',
    APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskMode === 'off'
    && APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskStrength === 1
    && APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskInvert === false
    && APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskLow === 0
    && APP_STATE_DEFAULT_GPGPU.gpgpuMorphTerrainErosionMaskHigh === 1);
}

// ── Erosion mask grid: window / invert / strength ────────────
{
  // A ramp field: normalised height rises linearly with i.
  const N = 17;
  const step = 2.1 / (N - 1);
  const ramp = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) ramp[j * N + i] = i / (N - 1);
  const at = (grid, i, j = 8) => grid[j * N + i];
  const stepMask = buildErosionMaskGrid(ramp, N, step, { mode: 'height', strength: 1, invert: false, low: 0.5, high: 0.5 });
  check('mask grid: step window is 0 below and 1 above the band edge',
    at(stepMask, 0) === 0 && at(stepMask, 7) === 0 && at(stepMask, 8) === 1 && at(stepMask, 16) === 1,
    `left=${at(stepMask, 0)} mid=${at(stepMask, 8)} right=${at(stepMask, 16)}`);
  const inv = buildErosionMaskGrid(ramp, N, step, { mode: 'height', strength: 1, invert: true, low: 0.5, high: 0.5 });
  check('mask grid: invert flips the window',
    at(inv, 0) === 1 && at(inv, 16) === 0);
  const soft = buildErosionMaskGrid(ramp, N, step, { mode: 'height', strength: 0.5, invert: false, low: 0.25, high: 0.75 });
  check('mask grid: strength blends toward 1 and the window is smooth',
    at(soft, 0) === 0.5 && at(soft, 16) === 1 && at(soft, 8) === 0.75,
    `left=${at(soft, 0)} mid=${at(soft, 8)} right=${at(soft, 16)}`);
  const zero = buildErosionMaskGrid(ramp, N, step, { mode: 'slope', strength: 0, invert: false, low: 0.3, high: 0.6 });
  check('mask grid: strength 0 is uniformly 1 (identity)',
    zero.every((v) => v === 1));
  const slopeMask = buildErosionMaskGrid(ramp, N, step, { mode: 'slope', strength: 1, invert: false, low: 0.5, high: 0.5 });
  check('mask grid: slope mode reads the gradient (ramp slope is uniform and max-normalised)',
    slopeMask.every((v) => v === 1));
  const curvMask = buildErosionMaskGrid(ramp, N, step, { mode: 'curvature', strength: 1, invert: false, low: 0.4, high: 0.6 });
  check('mask grid: curvature mode is deterministic and within 0..1',
    curvMask.every((v) => v >= 0 && v <= 1)
    && buildErosionMaskGrid(ramp, N, step, { mode: 'curvature', strength: 1, invert: false, low: 0.4, high: 0.6 }).every((v, i) => v === curvMask[i]));
}

// ── Masked erosion: identity + effect ────────────────────────
{
  const N = 33;
  const step = 2.1 / (N - 1);
  const baseGrid = () => {
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      heights[j * N + i] = terrainHeightAt(-1.05 + i * step, -1.05 + j * step, TERRAIN, FIELD_SEED);
    }
    return heights;
  };
  const opts = { water: 0.8, droplets: 0.05, deposit: 0.3, thermal: 0.6, talus: 0.5, thermalPasses: 8, seed: 11 };
  const plain = resolveTerrainErosion(opts);
  const rngSeed = erosionRngSeedFor(FIELD_SEED, plain.seed);
  const runPlain = () => { const h = baseGrid(); erodeHeightGridInPlace(h, N, step, plain, rngSeed); return h; };
  const reference = runPlain();

  const offMask = resolveTerrainErosion({ ...opts, mask: { mode: 'off', strength: 1, invert: false, low: 0, high: 1 } });
  const runOff = () => { const h = baseGrid(); erodeHeightGridInPlace(h, N, step, offMask, rngSeed); return h; };
  check('masked erosion: mask mode off is bit-identical to no mask',
    runOff().every((h, i) => h === reference[i]));

  const fullMask = resolveTerrainErosion({ ...opts, mask: { mode: 'height', strength: 0, invert: false, low: 0.2, high: 0.8 } });
  const runFull = () => { const h = baseGrid(); erodeHeightGridInPlace(h, N, step, fullMask, rngSeed); return h; };
  check('masked erosion: a uniform-1 mask (strength 0) is bit-identical',
    runFull().every((h, i) => h === reference[i]));

  // Height band split: the base field's normalised height below
  // 0.5 stays untouched, above it erodes. Build the check from
  // the mask grid itself (0 cells must not move, 1 cells must).
  const halfMask = resolveTerrainErosion({ ...opts, water: 0.9, droplets: 0.2, thermal: 0, mask: { mode: 'height', strength: 1, invert: false, low: 0.5, high: 0.5 } });
  const grid0 = baseGrid();
  const maskGrid = buildErosionMaskGrid(grid0, N, step, halfMask.mask);
  const masked = baseGrid();
  erodeHeightGridInPlace(masked, N, step, halfMask, rngSeed);
  const base = baseGrid();
  // An exchange spreads over the 2x2 footprint of the droplet
  // position and is scaled by the bilinear mask there, so a
  // cell can only move when some cell within Chebyshev
  // distance 2 has mask > 0. Cells deeper inside the mask-0
  // region than that must be untouched, exactly.
  const deepZero = (k) => {
    const i = k % N;
    const j = Math.floor(k / N);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      if (maskGrid[jj * N + ii] !== 0) return false;
    }
    return true;
  };
  let deepZeroCount = 0;
  let zeroMoved = 0;
  let oneMoved = 0;
  for (let k = 0; k < N * N; k++) {
    if (deepZero(k)) {
      deepZeroCount += 1;
      if (masked[k] !== base[k]) zeroMoved += 1;
    }
    if (maskGrid[k] === 1 && masked[k] !== base[k]) oneMoved += 1;
  }
  check('masked erosion: deep mask-0 cells are untouched by droplets',
    deepZeroCount > 0 && zeroMoved === 0, `cells=${deepZeroCount} moved=${zeroMoved}`);
  check('masked erosion: mask-1 cells do erode', oneMoved > 0, `moved=${oneMoved}`);

  // Thermal with a height mask: transfers across the mask-0
  // region must not move heights there either.
  const thermalMask = resolveTerrainErosion({ ...opts, water: 0, thermal: 0.9, thermalPasses: 12, mask: { mode: 'height', strength: 1, invert: false, low: 0.5, high: 0.5 } });
  const tGrid0 = baseGrid();
  const tMask = buildErosionMaskGrid(tGrid0, N, step, thermalMask.mask);
  const tMasked = baseGrid();
  erodeHeightGridInPlace(tMasked, N, step, thermalMask, rngSeed);
  let tZeroMoved = 0;
  let tQualifying = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    // Cells whose whole neighbourhood is mask 0 cannot move:
    // every transfer touching them is scaled by a 0 average.
    const neighbours = [k, i > 0 ? k - 1 : k, i < N - 1 ? k + 1 : k, j > 0 ? k - N : k, j < N - 1 ? k + N : k];
    if (neighbours.every((x) => tMask[x] === 0)) {
      tQualifying += 1;
      if (tMasked[k] !== tGrid0[k]) tZeroMoved += 1;
    }
  }
  check('masked erosion: mask-0 neighbourhoods are untouched by thermal',
    tQualifying > 0 && tZeroMoved === 0, `cells=${tQualifying} moved=${tZeroMoved}`);
}

// ── Erosion measurement (段B): non-interference + maps ───────
{
  const N = 33;
  const step = 2.1 / (N - 1);
  const baseGrid = () => {
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      heights[j * N + i] = terrainHeightAt(-1.05 + i * step, -1.05 + j * step, TERRAIN, FIELD_SEED);
    }
    return heights;
  };
  const resolved = resolveTerrainErosion({ water: 0.85, droplets: 0.1, deposit: 0.3, thermal: 0.5, talus: 0.5, thermalPasses: 6, seed: 5 });
  const rngSeed = erosionRngSeedFor(FIELD_SEED, resolved.seed);
  const plainRun = baseGrid();
  erodeHeightGridInPlace(plainRun, N, step, resolved, rngSeed);
  const measure = createTerrainErosionMeasure(N);
  const measuredRun = baseGrid();
  erodeHeightGridInPlace(measuredRun, N, step, resolved, rngSeed, measure);
  check('measure: attaching a measure leaves the height grid bit-identical',
    measuredRun.every((h, i) => h === plainRun[i]));
  check('measure: flow is non-negative and accumulates somewhere',
    measure.flow.every((v) => v >= 0) && measure.flow.some((v) => v > 0));
  check('measure: deposit and erosion totals are non-negative and non-trivial',
    measure.depositTotal.every((v) => v >= 0) && measure.erosionTotal.every((v) => v >= 0)
    && (measure.depositTotal.some((v) => v > 0) || measure.erosionTotal.some((v) => v > 0)));

  const maps = deriveMapsFromHeightGrid(measuredRun, N, step, measure);
  for (const kind of ['flow', 'deposit', 'erosion', 'moisture']) {
    const bytes = terrainDerivedMapBytes(maps, kind);
    check(`measure maps: '${kind}' bake has the grid byte length and opaque alpha`,
      bytes.length === N * N * 4 && Array.from(bytes).every((v, i) => (i % 4 === 3 ? v === 255 : true)));
  }
  check('measure maps: flow bake is non-trivial while erosion runs',
    Array.from(terrainDerivedMapBytes(maps, 'flow')).some((v, i) => i % 4 !== 3 && v > 0));
  check('measure maps: bytes select the right bake',
    terrainDerivedMapBytes(maps, 'flow') === maps.flow
    && terrainDerivedMapBytes(maps, 'deposit') === maps.deposit
    && terrainDerivedMapBytes(maps, 'erosion') === maps.erosion
    && terrainDerivedMapBytes(maps, 'moisture') === maps.moisture);

  const noMeasure = deriveMapsFromHeightGrid(measuredRun, N, step);
  check('measure maps: no measure -> new kinds are all zero',
    ['flow', 'deposit', 'erosion', 'moisture'].every((kind) =>
      Array.from(terrainDerivedMapBytes(noMeasure, kind)).every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))));

  // Erosion inactive: buildTerrainDerivedMaps over a plain
  // terrain produces zeroed new kinds, and the sentinels parse.
  const offMaps = buildTerrainDerivedMaps(TERRAIN, 7, 17);
  check('measure maps: erosion off -> new kinds are all zero',
    ['flow', 'deposit', 'erosion', 'moisture'].every((kind) =>
      Array.from(terrainDerivedMapBytes(offMaps, kind)).every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))));
  check('measure maps: new sentinels round-trip and bogus kinds fail',
    terrainDerivedSource('flow') === 'terrain-derived:flow'
    && parseTerrainDerivedSource('terrain-derived:flow') === 'flow'
    && parseTerrainDerivedSource('terrain-derived:deposit') === 'deposit'
    && parseTerrainDerivedSource('terrain-derived:erosion') === 'erosion'
    && parseTerrainDerivedSource('terrain-derived:moisture') === 'moisture'
    && parseTerrainDerivedSource('terrain-derived:wetness') === null);

  // Eroding terrain: the full pipeline is deterministic and the
  // flow bake carries signal.
  const erodingTerrain = {
    ...TERRAIN,
    erosion: { water: 0.8, droplets: 0.05, deposit: 0.3, thermal: 0.4, talus: 0.5, thermalPasses: 10, seed: 3 },
  };
  const m1 = buildTerrainDerivedMaps(erodingTerrain, 7, 17);
  const m2 = buildTerrainDerivedMaps(erodingTerrain, 7, 17);
  check('measure maps: eroding pipeline is deterministic',
    Array.from(terrainDerivedMapBytes(m1, 'flow')).every((v, i) => v === terrainDerivedMapBytes(m2, 'flow')[i])
    && Array.from(terrainDerivedMapBytes(m1, 'moisture')).every((v, i) => v === terrainDerivedMapBytes(m2, 'moisture')[i]));
  check('measure maps: eroding pipeline flow bake is non-trivial',
    Array.from(terrainDerivedMapBytes(m1, 'flow')).some((v, i) => i % 4 !== 3 && v > 0));

  // The height grid carries its measure only while eroding.
  check('measure: height grid carries the measure while eroding, null while off',
    buildTerrainHeightGrid(erodingTerrain, 7, 17).erosionMeasure !== null
    && buildTerrainHeightGrid(TERRAIN, 7, 17).erosionMeasure === null);
}

// ── Cache keys include the mask (fields + derived maps) ──────
{
  const eroding = {
    ...TERRAIN,
    erosion: { water: 0.8, droplets: 0.05, deposit: 0.3, thermal: 0.4, talus: 0.5, thermalPasses: 12, seed: 2 },
  };
  const noMaskField = getErodedTerrainField(eroding, FIELD_SEED);
  const maskedTerrain = {
    ...eroding,
    erosion: { ...eroding.erosion, mask: { mode: 'height', strength: 1, invert: false, low: 0.5, high: 0.5 } },
  };
  const maskedField = getErodedTerrainField(maskedTerrain, FIELD_SEED);
  check('cache: masked field is a different bake than the unmasked field',
    noMaskField !== null && maskedField !== null && maskedField !== noMaskField
    && maskedField.heights.some((h, i) => h !== noMaskField.heights[i]));
  const maskedAgain = getErodedTerrainField(maskedTerrain, FIELD_SEED);
  check('cache: same mask params hit the field cache (same object)',
    maskedAgain === maskedField);

  const cfgBase = {
    ...APP_STATE_DEFAULT_GPGPU,
    gpgpuMorphTerrainErosionWater: 0.8,
    gpgpuMorphTerrainErosionDroplets: 0.05,
    gpgpuMorphTerrainErosionThermal: 0.4,
  };
  const mapsA = getTerrainDerivedMaps(cfgBase);
  check('cache: derived maps are cached per config (same object)',
    getTerrainDerivedMaps(cfgBase) === mapsA);
  const cfgMasked = { ...cfgBase, gpgpuMorphTerrainErosionMaskMode: 'height', gpgpuMorphTerrainErosionMaskLow: 0.5, gpgpuMorphTerrainErosionMaskHigh: 0.5 };
  const mapsB = getTerrainDerivedMaps(cfgMasked);
  check('cache: changing only mask params misses the derived-maps cache',
    mapsB !== mapsA);
  check('cache: terrainOptionsFromConfig carries the mask',
    terrainOptionsFromConfig(cfgMasked).erosion?.mask?.mode === 'height'
    && terrainOptionsFromConfig(cfgMasked).erosion?.mask?.low === 0.5
    && terrainOptionsFromConfig(cfgBase).erosion?.mask?.mode === 'off');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
