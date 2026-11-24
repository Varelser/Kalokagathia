// Phase 30 — terrain (B), OBJ deformation (C), and vertical
// text corrections (D).
//
// B-1: tunnel erosion wraps in x — the plane path stays
//   byte-identical (wrapX off / omitted), the wrapped bake
//   keeps the seam columns together on a periodic field, and
//   the tiled base height is exactly periodic.
// B-2: the image erosion mask — resolve validates the grid
//   (invalid → no mask), the all-0 grid suppresses erosion
//   everywhere, the all-1 grid reproduces the unmasked bake,
//   and the cache key tracks the grid content.
// C: the OBJ deform hook — 'off' builds no hook; each mode
//   injects its signature math and registers the uniforms;
//   the injection is deterministic.
// D: the vertical-text fit — overflowing starter metrics
//   shrink to fit (identity for fitting content), ruby raises
//   the column gap, fitted placements stay inside the usable
//   box for both BP starters, and the run squeeze follows the
//   fixed advance model.
import { unlinkSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; } else { failed++; console.log('FAIL:', name); }
}

const entry = join(here, '.phase30-tot-entry.ts');
const outFile = join(here, '.phase30-tot-bundle.mjs');
writeFileSync(entry, `
export {
  getErodedTerrainField, resolveTerrainErosionMask, erosionMaskImageGridHash,
  tiledTerrainHeightAt, terrainHeightAt,
} from '../lib/gpgpuMorphTargets.ts';
export {
  buildObjDeformOnBeforeCompile, createObjDeformUniforms,
  objDeformBeginVertex, objDeformBeginNormal,
} from '../lib/objMeshDeform.ts';
export {
  fitVerticalTextMetrics, tatechuyokoModelAdvance, tatechuyokoRunSqueeze,
  verticalGlyphPlacements, RUBY_MIN_COLUMN_GAP,
} from '../lib/textColumnLayout.ts';
`);
await build({
  entryPoints: [entry], bundle: true, outfile: outFile, format: 'esm', platform: 'node',
  define: { '__LIBRARY_SCOPE__': '"private"' },
});
const M = await import(pathToFileURL(outFile).href);
unlinkSync(entry); unlinkSync(outFile);

// ---- B-1: tunnel wrap ----------------------------------------
const FIELD_SEED = 1234;
const terrainBase = { amplitude: 1, frequency: 2, octaves: 2, seed: 3 };
const erosionBase = { water: 0.8, droplets: 1, deposit: 0.3, thermal: 0.2, talus: 0.5, thermalPasses: 2, seed: 7 };
const planeA = M.getErodedTerrainField({ ...terrainBase, erosion: { ...erosionBase } }, FIELD_SEED);
const planeB = M.getErodedTerrainField({ ...terrainBase, erosion: { ...erosionBase, wrapX: false } }, FIELD_SEED);
check('B1: wrapX omitted vs false is byte-identical (plane identity)',
  planeA !== null && planeB !== null
  && planeA.heights.length === planeB.heights.length
  && planeA.heights.every((v, i) => v === planeB.heights[i]));
const wrapped = M.getErodedTerrainField({ ...terrainBase, erosion: { ...erosionBase, wrapX: true } }, FIELD_SEED);
const GN = wrapped.size;
let seamPlane = 0;
let seamWrapped = 0;
for (let j = 0; j < GN; j++) {
  seamPlane = Math.max(seamPlane, Math.abs(planeA.heights[j * GN] - planeA.heights[j * GN + GN - 1]));
  seamWrapped = Math.max(seamWrapped, Math.abs(wrapped.heights[j * GN] - wrapped.heights[j * GN + GN - 1]));
}
check('B1: wrapped erosion keeps the seam columns together (and far tighter than plane)',
  seamWrapped < 0.02 && seamWrapped < seamPlane * 0.25);
check('B1: the wrapped field actually eroded (differs from the analytic base)',
  wrapped.heights.some((v, i) => {
    const fx = -1.05 + (i % GN) * (2.1 / (GN - 1));
    const fz = -1.05 + Math.floor(i / GN) * (2.1 / (GN - 1));
    return Math.abs(v - M.tiledTerrainHeightAt(fx, fz, terrainBase, FIELD_SEED)) > 1e-4;
  }));
check('B1: tiledTerrainHeightAt is exactly periodic over the tunnel extent',
  Math.abs(M.tiledTerrainHeightAt(-1.05, 0.3, terrainBase, FIELD_SEED) - M.tiledTerrainHeightAt(1.05, 0.3, terrainBase, FIELD_SEED)) < 1e-9
  && Math.abs(M.tiledTerrainHeightAt(-1.05, -0.7, terrainBase, FIELD_SEED) - M.tiledTerrainHeightAt(1.05, -0.7, terrainBase, FIELD_SEED)) < 1e-9);

// ---- B-2: image mask ------------------------------------------
const grid129 = (v) => new Array(129 * 129).fill(v);
check('B2: a valid image grid resolves with its field',
  (() => {
    const r = M.resolveTerrainErosionMask({ mask: { mode: 'image', strength: 1, invert: false, low: 0, high: 1, imageGrid: grid129(0.5) } });
    return r !== null && r.mode === 'image' && r.imageSize === 129 && r.imageGrid.length === 129 * 129;
  })());
check('B2: image mode without a valid grid resolves to no mask',
  M.resolveTerrainErosionMask({ mask: { mode: 'image', strength: 1, invert: false, low: 0, high: 1 } }) === null
  && M.resolveTerrainErosionMask({ mask: { mode: 'image', strength: 1, invert: false, low: 0, high: 1, imageGrid: [1, 2, 3] } }) === null);
const unmasked = M.getErodedTerrainField({ ...terrainBase, erosion: { ...erosionBase, seed: 11 } }, FIELD_SEED);
const maskAllOne = M.getErodedTerrainField({
  ...terrainBase,
  erosion: { ...erosionBase, seed: 11, mask: { mode: 'image', strength: 1, invert: false, low: 0, high: 1, imageGrid: grid129(1) } },
}, FIELD_SEED);
check('B2: an all-1 image mask (band 0..1, strength 1) reproduces the unmasked bake',
  maskAllOne.heights.every((v, i) => Math.abs(v - unmasked.heights[i]) < 1e-6));
const maskAllZero = M.getErodedTerrainField({
  ...terrainBase,
  erosion: { ...erosionBase, seed: 11, mask: { mode: 'image', strength: 1, invert: false, low: 0.2, high: 0.8, imageGrid: grid129(0) } },
}, FIELD_SEED);
check('B2: an all-0 image mask outside the band suppresses erosion everywhere',
  maskAllZero.heights.every((v, i) => {
    const fx = -1.05 + (i % GN) * (2.1 / (GN - 1));
    const fz = -1.05 + Math.floor(i / GN) * (2.1 / (GN - 1));
    return Math.abs(v - M.terrainHeightAt(fx, fz, terrainBase, FIELD_SEED)) < 1e-6;
  }));
check('B2: the grid content hash separates different grids and matches equal ones',
  M.erosionMaskImageGridHash(grid129(0)) !== M.erosionMaskImageGridHash(grid129(1))
  && M.erosionMaskImageGridHash(grid129(0.5)) === M.erosionMaskImageGridHash(grid129(0.5))
  && M.erosionMaskImageGridHash([]) === 'noimg');

// ---- C: OBJ deformation ---------------------------------------
check('C: mode off builds no hook (stock material untouched)',
  M.buildObjDeformOnBeforeCompile('off', M.createObjDeformUniforms()) === null);
const fakeShader = () => ({
  uniforms: {},
  vertexShader: '#include <common>\nvoid main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
});
for (const [mode, needle] of [['wave', 'kaloWave'], ['twist', 'kaloTwistA'], ['bend', '0.3 * uObjDeformAmount']]) {
  const hook = M.buildObjDeformOnBeforeCompile(mode, M.createObjDeformUniforms());
  const shader = fakeShader();
  hook(shader);
  check(`C: ${mode} injects its math and registers the uniforms`,
    shader.vertexShader.includes(needle)
    && shader.vertexShader.includes('uniform float uObjDeformTime;')
    && shader.uniforms.uObjDeformAmount !== undefined
    && shader.uniforms.uObjDeformSpeed !== undefined);
  const shader2 = fakeShader();
  M.buildObjDeformOnBeforeCompile(mode, M.createObjDeformUniforms())(shader2);
  check(`C: ${mode} injection is deterministic`, shader.vertexShader === shader2.vertexShader);
}
check('C: wave leaves normals alone; twist and bend rotate them',
  M.objDeformBeginNormal('wave') === ''
  && M.objDeformBeginNormal('twist').includes('objectNormal.xz')
  && M.objDeformBeginNormal('bend').includes('objectNormal.xy'));

// ---- D: vertical text fit --------------------------------------
const starterMetrics = { width: 128, height: 128, padding: 0.1, pxSize: 32, columnGap: 0.4, letterSpacing: 0.1 };
const fittedTate = M.fitVerticalTextMetrics('西暦2026年、星は巡る', 5, starterMetrics, { tatechuyoko: true });
check('D: the overflowing starter column shrinks to the usable height exactly',
  Math.abs(fittedTate.pxSize - 32 * (102.4 / 172.8)) < 1e-9);
check('D: fitting content returns the identical metrics object',
  M.fitVerticalTextMetrics('あ', 5, starterMetrics, {}) === starterMetrics);
const fittedRuby = M.fitVerticalTextMetrics('｜星屑《ほしくず》の海、｜時空《じくう》の彼方', 5, starterMetrics, { ruby: true });
check('D: ruby raises the column gap to the clearance minimum',
  fittedRuby.columnGap === M.RUBY_MIN_COLUMN_GAP
  && M.fitVerticalTextMetrics('あ', 5, starterMetrics, {}).columnGap === 0.4);
for (const [text, adj, fitted] of [
  ['西暦2026年、星は巡る', { tatechuyoko: true }, fittedTate],
  ['｜星屑《ほしくず》の海、｜時空《じくう》の彼方', { ruby: true }, fittedRuby],
]) {
  const placements = M.verticalGlyphPlacements(text, 5, fitted, adj);
  check(`D: fitted placements stay inside the usable box (${adj.ruby ? 'ruby' : 'tate'} starter)`,
    placements.every((p) => {
      const half = fitted.pxSize * (p.ruby ? 0.25 : 0.5);
      return p.y - half >= 128 * 0.1 - 1e-6
        && p.y + half <= 128 * 0.9 + 1e-6
        && p.x - half >= -1e-6 && p.x + half <= 128 + 1e-6;
    }));
}
check('D: the advance model classes (digit/point 0.56, capital 0.75, lowercase 0.58)',
  M.tatechuyokoModelAdvance('2') === 0.56 && M.tatechuyokoModelAdvance('.') === 0.56
  && M.tatechuyokoModelAdvance('W') === 0.75 && M.tatechuyokoModelAdvance('a') === 0.58);
check('D: run squeeze values (2026 → 1/2.24, AB → 1/1.5, 20 → 1/1.12)',
  M.tatechuyokoRunSqueeze('2026') === 1 / 2.24
  && M.tatechuyokoRunSqueeze('AB') === 1 / 1.5
  && M.tatechuyokoRunSqueeze('20') === 1 / 1.12);

console.log(`phase30-terrain-obj-text: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
