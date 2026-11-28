// Layer 1 WP7 phase E — generalized derived maps.
// The derived-map engine (lib/terrainDerivedMaps.ts) off the
// terrain: `derived:<source>:<kind>` sentinels resolve the
// differential kinds (normal / slope / curvature) from height
// sources the app already authors (the noise field slice, the
// hand-drawn grid, the stored image grid), through the single
// resolution point, with a cache of their own.
//
// Behaviours pinned:
// - grammar round-trip; the erosion-measurement kinds are
//   TERRAIN-ONLY in the grammar (rejected at parse time)
// - the noise height grid is the flipped noise-field slice
// - a drawn ramp grid differentiates to the analytic answer
//   (constant slope, closed-form normal, flat curvature)
// - the terrain path is byte-identical to the pre-phase-E bakes
//   (sha256 pins captured from the tree before this phase)
// - the generalized cache never touches the terrain cache:
//   terrain maps / textures keep object identity across
//   generalized resolves and unrelated config changes
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp7e-bundle-${process.pid}.mjs`);
let failures = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha = (bytes) => createHash('sha256')
  .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');

await build({
  stdin: {
    contents: `
      export {
        TERRAIN_DERIVED_KINDS, TERRAIN_ONLY_DERIVED_KINDS,
        GENERALIZED_DERIVED_KINDS, GENERALIZED_DERIVED_SOURCES, GENERALIZED_DERIVED_SIZE,
        generalizedDerivedSource, parseGeneralizedDerivedSource, isGeneralizedDerivedSource,
        buildGeneralizedHeightGrid, getGeneralizedDerivedMaps, getGeneralizedDerivedTexture,
        buildTerrainDerivedMaps, getTerrainDerivedMaps, terrainDerivedMapBytes,
        terrainOptionsFromConfig, parseTerrainDerivedSource, resolveMapSourceTexture,
      } from './lib/terrainDerivedMaps.ts';
      export { buildNoiseFieldLuma, noiseFieldSettingsFromConfig } from './lib/mapSourceSupply.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  TERRAIN_ONLY_DERIVED_KINDS,
  GENERALIZED_DERIVED_KINDS, GENERALIZED_DERIVED_SOURCES, GENERALIZED_DERIVED_SIZE,
  generalizedDerivedSource, parseGeneralizedDerivedSource, isGeneralizedDerivedSource,
  buildGeneralizedHeightGrid, getGeneralizedDerivedMaps, getGeneralizedDerivedTexture,
  getTerrainDerivedMaps, terrainDerivedMapBytes,
  parseTerrainDerivedSource, resolveMapSourceTexture,
  buildNoiseFieldLuma, noiseFieldSettingsFromConfig,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const config = {
  ...APP_STATE_DEFAULT_GPGPU,
  gpgpuSeed: 7,
  gpgpuMorphTerrainAmplitude: 0.55,
  gpgpuMorphTerrainFrequency: 1.6,
  gpgpuMorphTerrainOctaves: 4,
};

// ── Grammar ───────────────────────────────────────────────────
{
  let roundTrip = true;
  for (const source of GENERALIZED_DERIVED_SOURCES) {
    for (const kind of GENERALIZED_DERIVED_KINDS) {
      const parsed = parseGeneralizedDerivedSource(generalizedDerivedSource(source, kind));
      if (!parsed || parsed.source !== source || parsed.kind !== kind) roundTrip = false;
    }
  }
  check('grammar: derived:<source>:<kind> round-trips for every source × differential kind', roundTrip);
  check('grammar: the differential kinds are exactly normal / slope / curvature',
    GENERALIZED_DERIVED_KINDS.join(',') === 'normal,slope,curvature');
  check('grammar: the terrain-only kinds are exactly the erosion four',
    TERRAIN_ONLY_DERIVED_KINDS.join(',') === 'flow,deposit,erosion,moisture');
  let terrainOnlyRejected = true;
  for (const source of GENERALIZED_DERIVED_SOURCES) {
    for (const kind of TERRAIN_ONLY_DERIVED_KINDS) {
      if (parseGeneralizedDerivedSource(generalizedDerivedSource(source, kind)) !== null) terrainOnlyRejected = false;
      if (isGeneralizedDerivedSource(`derived:${source}:${kind}`)) terrainOnlyRejected = false;
    }
  }
  check('grammar: erosion kinds are rejected for generalized sources (terrain-only)', terrainOnlyRejected);
  check('grammar: unknown source / kind / malformed strings are rejected',
    parseGeneralizedDerivedSource('derived:terrain:slope') === null
    && parseGeneralizedDerivedSource('derived:noise:gradient') === null
    && parseGeneralizedDerivedSource('derived:noise') === null
    && parseGeneralizedDerivedSource('derived::slope') === null
    && parseGeneralizedDerivedSource('') === null);
  check('grammar: the terrain sentinel grammar is untouched',
    parseTerrainDerivedSource('terrain-derived:flow') === 'flow'
    && parseTerrainDerivedSource('terrain-derived:slope') === 'slope'
    && parseGeneralizedDerivedSource('terrain-derived:slope') === null);
}

// ── Noise source: grid = the flipped noise-field slice ───────
{
  const grid = buildGeneralizedHeightGrid('noise', config);
  check('noise grid: exists at the generalized size', !!grid && grid.size === GENERALIZED_DERIVED_SIZE);
  const luma = buildNoiseFieldLuma(noiseFieldSettingsFromConfig(config), GENERALIZED_DERIVED_SIZE);
  const n = GENERALIZED_DERIVED_SIZE;
  let flipped = !!grid;
  if (grid) {
    for (let j = 0; j < n && flipped; j++) {
      for (let i = 0; i < n; i++) {
        if (grid.heights[j * n + i] !== luma[(n - 1 - j) * n + i]) { flipped = false; break; }
      }
    }
  }
  check('noise grid: heights are the noise-field slice flipped into derived row order', flipped);
  check('noise grid: step spans the slice extent', !!grid && Math.abs(grid.step * (n - 1) - grid.extent * 2) < 1e-9);
  const maps = getGeneralizedDerivedMaps('noise', config);
  check('noise maps: resolve', !!maps && maps.size === n);
  const state = getGeneralizedDerivedTexture('noise', 'slope', config);
  check('noise texture: ready and byte-equal to the maps bake',
    state.ready && !!state.texture
    && Buffer.from(state.texture.image.data).equals(Buffer.from(terrainDerivedMapBytes(maps, 'slope'))));
  const viaResolver = resolveMapSourceTexture('derived:noise:slope', config);
  check('noise texture: the single resolution point returns the same texture',
    viaResolver.ready && viaResolver.texture === state.texture);
}

// ── Drawn source: an analytic ramp differentiates exactly ────
{
  const side = 9;
  const ramp = [];
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) ramp.push(i / (side - 1));
  const drawnConfig = { ...config, gpgpuMorphTerrainErosionMaskDrawnGrid: ramp };
  const grid = buildGeneralizedHeightGrid('drawn', drawnConfig);
  check('drawn grid: the stored grid at its own side, step over the normalised box',
    !!grid && grid.size === side && Math.abs(grid.step - 2 / (side - 1)) < 1e-12
    && grid.heights.every((h, i) => h === ramp[i]));
  const maps = getGeneralizedDerivedMaps('drawn', drawnConfig);
  check('drawn maps: resolve', !!maps && maps.size === side);
  const slope = terrainDerivedMapBytes(maps, 'slope');
  let slopeAllMax = true;
  for (let k = 0; k < side * side; k++) if (slope[k * 4] !== 255) slopeAllMax = false;
  check('drawn ramp: slope is the constant gradient, normalised to white everywhere', slopeAllMax);
  // Closed form: dx = (1/(side-1)) / step = 0.5, dz = 0.
  const invLen = 1 / Math.sqrt(0.5 * 0.5 + 1);
  const toByte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const expectR = toByte(-0.5 * invLen * 0.5 + 0.5);
  const expectG = toByte(invLen * 0.5 + 0.5);
  const normal = terrainDerivedMapBytes(maps, 'normal');
  const c = (4 * side + 4) * 4; // centre cell (4, 4)
  check('drawn ramp: centre normal matches the closed form (±1)',
    Math.abs(normal[c] - expectR) <= 1 && Math.abs(normal[c + 1] - expectG) <= 1 && normal[c + 2] === 128,
    `got ${normal[c]},${normal[c + 1]},${normal[c + 2]} want ~${expectR},${expectG},128`);
  const curvature = terrainDerivedMapBytes(maps, 'curvature');
  let interiorFlat = true;
  for (let j = 1; j < side - 1; j++) {
    for (let i = 1; i < side - 1; i++) {
      if (curvature[(j * side + i) * 4] !== 128) interiorFlat = false;
    }
  }
  check('drawn ramp: interior curvature is the flat mid-grey (laplacian of a plane is 0)', interiorFlat);
  const state = resolveMapSourceTexture('derived:drawn:normal', drawnConfig);
  check('drawn texture: resolves through the single point', state.ready && !!state.texture);
}

// ── Image source: a flat stored grid ──────────────────────────
{
  const side = 5;
  const flat = new Array(side * side).fill(0.5);
  const imageConfig = { ...config, gpgpuMorphTerrainErosionMaskImageGrid: flat };
  const maps = getGeneralizedDerivedMaps('image', imageConfig);
  check('image maps: resolve from the stored image grid', !!maps && maps.size === side);
  const normal = terrainDerivedMapBytes(maps, 'normal');
  const c = (2 * side + 2) * 4;
  check('image flat: centre normal is the +Y encoding (128, 255, 128)',
    normal[c] === 128 && normal[c + 1] === 255 && normal[c + 2] === 128,
    `got ${normal[c]},${normal[c + 1]},${normal[c + 2]}`);
  const slope = terrainDerivedMapBytes(maps, 'slope');
  check('image flat: slope is black everywhere', slope.every((v, i) => i % 4 === 3 ? v === 255 : v === 0));
}

// ── Missing material resolves to not-ready ────────────────────
{
  const emptyConfig = { ...config, gpgpuMorphTerrainErosionMaskDrawnGrid: [], gpgpuMorphTerrainErosionMaskImageGrid: [] };
  check('missing material: no maps for an absent grid',
    getGeneralizedDerivedMaps('drawn', emptyConfig) === null
    && getGeneralizedDerivedMaps('image', emptyConfig) === null);
  const state = resolveMapSourceTexture('derived:drawn:slope', emptyConfig);
  check('missing material: the resolver answers not-ready (no texture)', !state.ready && state.texture === null);
  const fallthrough = resolveMapSourceTexture('derived:noise:flow', config);
  check('terrain-only kind via resolver: not served as a generalized map', !fallthrough.ready && fallthrough.texture === null);
}

// ── Terrain path: byte-identical pins (pre-phase-E capture) ──
{
  const TERRAIN_HASHES = {
    normal: 'b54686cfa90cfd2b53cb698887e6c6f08b77f2f32cf80bde2ae89c2483b6d880',
    slope: '35789e91eb0bf8d9d94ef6a9a86d2af921892d66bdbce287b8daacd8d274d513',
    curvature: '637ca984acb25063bec89bd7f429155d836a5d2b05e33c33a5051fdc4b0fd5c7',
    flow: '6cb5625ee6b91aedfebaa8d012a71894eb2a53eec2d36b6fcba5db28dfe754a5',
    deposit: '6cb5625ee6b91aedfebaa8d012a71894eb2a53eec2d36b6fcba5db28dfe754a5',
    erosion: '6cb5625ee6b91aedfebaa8d012a71894eb2a53eec2d36b6fcba5db28dfe754a5',
    moisture: '6cb5625ee6b91aedfebaa8d012a71894eb2a53eec2d36b6fcba5db28dfe754a5',
  };
  const maps = getTerrainDerivedMaps(config);
  let allMatch = true;
  for (const [kind, hash] of Object.entries(TERRAIN_HASHES)) {
    if (sha(terrainDerivedMapBytes(maps, kind)) !== hash) allMatch = false;
  }
  check('terrain pins: all seven bakes are byte-identical to the pre-phase-E capture', allMatch);
  const state = resolveMapSourceTexture('terrain-derived:slope', config);
  check('terrain pins: the resolved slope texture is byte-identical too',
    state.ready && !!state.texture && sha(state.texture.image.data) === TERRAIN_HASHES.slope);
}

// ── Cache separation: generalized work never touches terrain ──
{
  const terrainMaps1 = getTerrainDerivedMaps(config);
  const terrainTex1 = resolveMapSourceTexture('terrain-derived:slope', config).texture;
  const noiseMaps1 = getGeneralizedDerivedMaps('noise', config);
  const side = 9;
  const ramp = [];
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) ramp.push(i / (side - 1));
  const drawnConfig = { ...config, gpgpuMorphTerrainErosionMaskDrawnGrid: ramp };
  const drawnMaps1 = getGeneralizedDerivedMaps('drawn', drawnConfig);
  check('cache: terrain maps keep identity across generalized resolves',
    getTerrainDerivedMaps(config) === terrainMaps1);
  check('cache: terrain texture keeps identity across generalized resolves',
    resolveMapSourceTexture('terrain-derived:slope', config).texture === terrainTex1);
  const noiseConfig2 = { ...config, gpgpuNoiseMapScale: (config.gpgpuNoiseMapScale ?? 0.01) * 2 + 0.005 };
  const noiseMaps2 = getGeneralizedDerivedMaps('noise', noiseConfig2);
  check('cache: a noise definition change rebuilds only the noise entry',
    !!noiseMaps2 && noiseMaps2 !== noiseMaps1
    && getGeneralizedDerivedMaps('drawn', drawnConfig) === drawnMaps1
    && getTerrainDerivedMaps(noiseConfig2) === terrainMaps1);
  const drawnConfig2 = { ...drawnConfig, gpgpuMorphTerrainErosionMaskDrawnGrid: ramp.map((v) => 1 - v) };
  const drawnMaps2 = getGeneralizedDerivedMaps('drawn', drawnConfig2);
  check('cache: a drawn grid change rebuilds only the drawn entry',
    !!drawnMaps2 && drawnMaps2 !== drawnMaps1
    && getGeneralizedDerivedMaps('noise', noiseConfig2) === noiseMaps2
    && getTerrainDerivedMaps(config) === terrainMaps1);
  check('cache: generalized maps are not the terrain maps object', noiseMaps1 !== terrainMaps1);
}

console.log(`layer1-wp7-derived-maps: ${total - failures}/${total} checks passed`);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
