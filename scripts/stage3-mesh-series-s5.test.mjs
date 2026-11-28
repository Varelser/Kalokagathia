// Grammar 2.0 stage 3, slice S5 — the mesh series
// exporter (lib/stateCacheMeshSeries.ts): a state cache
// (the canonical frame sequence) -> one grid-topology
// mesh document (OBJ / STL) per frame, delivered as one
// ZIP. The mesh generation itself is the EXISTING
// single-frame builders in lib/meshExport.ts, which this
// slice does not modify.
// Verified:
//  1. The single-frame behaviour is pinned BYTE-FOR-BYTE:
//     the sha256 constants below were measured from
//     lib/meshExport.ts as it stood BEFORE this slice
//     (which does not touch that file), for the fixture
//     frames used here.
//  2. Every series entry is exactly the document the
//     single-frame builder produces for that frame's
//     stored positions (frame-by-frame equality), in both
//     formats, and the ZIP entries are those documents
//     verbatim under the PRT-style absolute frame names.
//  3. Vertex / face counts follow the grid premise
//     ((texSize-1)^2 quads x 2 triangles when every vertex
//     is finite and no triangle is degenerate), including
//     the invalid-vertex and zero-area skip rules.
//  4. Refusals state their reason: a cache that breaks
//     the grid premise (texSize^2 !== count, a frame
//     buffer that is not count x 3, a frame count that
//     disagrees with the manifest, a sub-2 grid, a foreign
//     format) is never rearranged or resampled, and the
//     edition gate refuses the public edition.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S5.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export { buildObjFromGrid, buildStlFromGrid, countMeshExport } from './lib/meshExport.ts';
      export {
        buildStateCacheMeshSeries, buildStateCacheMeshSeriesZip, validateCacheForMeshSeries,
        meshSeriesFileNameForFrame, MESH_SERIES_ZIP_FILE_NAME,
      } from './lib/stateCacheMeshSeries.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache, buildObjFromGrid, buildStlFromGrid, countMeshExport,
  buildStateCacheMeshSeries, buildStateCacheMeshSeriesZip, validateCacheForMeshSeries,
  meshSeriesFileNameForFrame, MESH_SERIES_ZIP_FILE_NAME,
} = lib;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const TEX = 3;
const COUNT = TEX * TEX;
// Fixture frame f, vertex i (row r, col c): the position
// triplet is (c + f*0.5, r, (r+c)*0.25 + f) — a slanted
// regular grid, so every quad yields two non-degenerate
// triangles. This is the exact fixture the pre-S5 pins
// below were measured on.
const frameTriplets = (f) => {
  const p = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const r = Math.floor(i / TEX);
    const c = i % TEX;
    p[i * 3] = c + f * 0.5;
    p[i * 3 + 1] = r;
    p[i * 3 + 2] = (r + c) * 0.25 + f;
  }
  return p;
};
const frameInput = (f, override) => {
  const triplets = override ?? frameTriplets(f);
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 4] = triplets[i * 3];
    positions[i * 4 + 1] = triplets[i * 3 + 1];
    positions[i * 4 + 2] = triplets[i * 3 + 2];
    positions[i * 4 + 3] = i + f; // age lane (dropped at assembly)
    velocities[i * 4] = f - 1;
    velocities[i * 4 + 1] = 0.25 * i;
    velocities[i * 4 + 2] = 2;
    velocities[i * 4 + 3] = 0;
  }
  return { positions, velocities };
};

const assembled = assembleStateCache({
  fps: 30,
  texSize: TEX,
  startFrame: 10,
  frames: [frameInput(0), frameInput(1), frameInput(2)],
});
check('fixture cache assembles', assembled.ok, assembled.ok ? '' : assembled.error);
const cache = assembled.cache;

/* ---- 1. single-frame output pinned byte-for-byte (pre-S5) ---- */
// Measured from lib/meshExport.ts before this slice; the
// slice does not modify that file, so these pins are the
// "single-frame export is unchanged" contract.
const PRE_S5_OBJ_SHA256 = [
  '028c17f1c5f4f3d4b34a54bdb541698be5046afa2c9afdc089daefaf0201bd8e',
  '2981a7d872931115851223db5490d2db2fda8f6f148a782e8542d99c5be62053',
  'aaec344da02856a68ec7cb43119cd434aca5b11db20eae8d8329e78b3b54c000',
];
const PRE_S5_STL_SHA256 = [
  '89ae7165a1eb16f02f335c106f2da5ed9193ab8f3a5160e1fb37ef3d9fa2f865',
  '27e605ab09f5d97477148ad5072192bc45e601c65e6b7cb78bf05d3c0ca419f0',
  '86f403ec3d29601b0bd6efee944f69f4f68f827b6eff6e60b2147e402e11eb43',
];
for (let f = 0; f < 3; f++) {
  check(
    `single-frame OBJ frame ${f} matches the pre-S5 pin`,
    sha256(buildObjFromGrid(cache.positions[f], TEX, TEX)) === PRE_S5_OBJ_SHA256[f],
  );
  check(
    `single-frame STL frame ${f} matches the pre-S5 pin`,
    sha256(buildStlFromGrid(cache.positions[f], TEX, TEX)) === PRE_S5_STL_SHA256[f],
  );
  // The cache stores exactly the fixture triplets (the
  // readback w lane is dropped at assembly).
  check(
    `cache frame ${f} positions are the fixture triplets`,
    Buffer.from(cache.positions[f].buffer).equals(Buffer.from(frameTriplets(f).buffer)),
  );
}

/* ---- 2. series entries equal the single-frame documents ---- */
const series = buildStateCacheMeshSeries(cache, 'obj');
check('OBJ series builds', series.ok, series.ok ? '' : series.error);
if (series.ok) {
  check('OBJ series has one file per frame', series.files.length === 3);
  for (let f = 0; f < 3; f++) {
    const file = series.files[f];
    check(
      `series frame ${f} equals the single-frame OBJ`,
      file.contents === buildObjFromGrid(cache.positions[f], TEX, TEX),
    );
    check(
      `series frame ${f} is named by absolute frame number`,
      file.fileName === `monosphere-mesh-${String(10 + f).padStart(4, '0')}.obj` && file.frameNumber === 10 + f,
      file.fileName,
    );
    check(
      `series frame ${f} stats follow the grid premise`,
      file.stats.gridVertices === COUNT && file.stats.vertices === COUNT && file.stats.faces === (TEX - 1) * (TEX - 1) * 2,
      JSON.stringify(file.stats),
    );
  }
}
const seriesStl = buildStateCacheMeshSeries(cache, 'stl');
check('STL series builds', seriesStl.ok, seriesStl.ok ? '' : seriesStl.error);
if (seriesStl.ok) {
  for (let f = 0; f < 3; f++) {
    check(
      `STL series frame ${f} equals the single-frame STL`,
      seriesStl.files[f].contents === buildStlFromGrid(cache.positions[f], TEX, TEX),
    );
    check(
      `STL series frame ${f} name carries the .stl extension`,
      seriesStl.files[f].fileName === `monosphere-mesh-${String(10 + f).padStart(4, '0')}.stl`,
      seriesStl.files[f].fileName,
    );
  }
}
check(
  'file-name helper matches the series names',
  meshSeriesFileNameForFrame(cache, 1, 'obj') === 'monosphere-mesh-0011.obj',
);

/* ---- 3. skip rules inside a series frame ---- */
// Centre vertex invalid (NaN): of the 8 triangles, only
// the two that avoid the centre survive — (1,2,5) in quad
// (0,1) and (3,7,6) in quad (1,0); quads (0,0) and (1,1)
// lose both of theirs to the centre corner.
const nanTriplets = frameTriplets(0);
nanTriplets[4 * 3] = Number.NaN;
const nanAssembled = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0, nanTriplets)] });
check('NaN fixture cache assembles', nanAssembled.ok, nanAssembled.ok ? '' : nanAssembled.error);
if (nanAssembled.ok) {
  const nanSeries = buildStateCacheMeshSeries(nanAssembled.cache, 'obj');
  check('NaN series builds', nanSeries.ok, nanSeries.ok ? '' : nanSeries.error);
  if (nanSeries.ok) {
    check(
      'NaN centre drops to 2 faces / 8 finite vertices',
      nanSeries.files[0].stats.faces === 2 && nanSeries.files[0].stats.vertices === 8,
      JSON.stringify(nanSeries.files[0].stats),
    );
    check(
      'NaN series frame equals its single-frame export',
      nanSeries.files[0].contents === buildObjFromGrid(nanAssembled.cache.positions[0], TEX, TEX),
    );
  }
}
// Collinear frame: every triangle is zero-area, so the
// document is the header only — same as single-frame.
const lineTriplets = new Float32Array(COUNT * 3);
for (let i = 0; i < COUNT; i++) {
  lineTriplets[i * 3] = i;
  lineTriplets[i * 3 + 1] = i * 2;
  lineTriplets[i * 3 + 2] = 0;
}
const lineAssembled = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0, lineTriplets)] });
if (lineAssembled.ok) {
  const lineSeries = buildStateCacheMeshSeries(lineAssembled.cache, 'obj');
  check(
    'collinear frame yields 0 faces, header only',
    lineSeries.ok && lineSeries.files[0].stats.faces === 0
      && lineSeries.files[0].contents === buildObjFromGrid(lineAssembled.cache.positions[0], TEX, TEX)
      && !lineSeries.files[0].contents.includes('\nv '),
    lineSeries.ok ? '' : lineSeries.error,
  );
} else {
  check('collinear fixture cache assembles', false, lineAssembled.error);
}

/* ---- 4. ZIP packaging ---- */
check('ZIP file name is the fixed series name', MESH_SERIES_ZIP_FILE_NAME === 'monosphere-mesh-series.zip');
const zipped = await buildStateCacheMeshSeriesZip(cache, { format: 'obj' });
check('ZIP builds for the full edition', zipped.ok, zipped.ok ? '' : zipped.error);
if (zipped.ok) {
  check(
    'ZIP totals follow the grid premise',
    zipped.fileCount === 3 && zipped.totalVertices === 3 * COUNT && zipped.totalFaces === 3 * (TEX - 1) * (TEX - 1) * 2,
    JSON.stringify({ fileCount: zipped.fileCount, totalVertices: zipped.totalVertices, totalFaces: zipped.totalFaces }),
  );
  const archive = await JSZip.loadAsync(zipped.buffer);
  const names = Object.keys(archive.files).sort();
  check(
    'ZIP entries are the absolute-frame OBJ names',
    JSON.stringify(names) === JSON.stringify(['monosphere-mesh-0010.obj', 'monosphere-mesh-0011.obj', 'monosphere-mesh-0012.obj']),
    names.join(','),
  );
  for (let f = 0; f < 3; f++) {
    const text = await archive.file(`monosphere-mesh-${String(10 + f).padStart(4, '0')}.obj`).async('string');
    check(`ZIP entry frame ${f} is the series document verbatim`, text === series.files[f].contents);
  }
}

/* ---- 5. refusals ---- */
const baseManifest = {
  format: 'statecache-manifest-v1', version: 1, fps: 30, count: COUNT, texSize: TEX,
  frameCount: 1, startFrame: 0, loop: true, interpolation: 'linear',
  coordinates: { up: 'y', unit: 'm' }, attributes: [], frameHashes: ['00000000'],
};
const fakeCache = (manifestPatch, positions) => ({
  manifest: { ...baseManifest, ...manifestPatch },
  positions,
  velocities: [new Float32Array(COUNT * 3)],
  attrFrames: [],
});
const expectRefusal = (name, candidate, pattern) => {
  const result = buildStateCacheMeshSeries(candidate, 'obj');
  check(name, !result.ok && pattern.test(result.ok ? '' : result.error), result.ok ? 'unexpectedly ok' : result.error);
};
expectRefusal(
  'count that is not texSize^2 is refused (no rearrangement)',
  fakeCache({ count: COUNT + 1 }, [new Float32Array((COUNT + 1) * 3)]),
  /グリッド前提/,
);
expectRefusal(
  'frame buffer that is not count x 3 is refused',
  fakeCache({}, [new Float32Array(10)]),
  /位置バッファ長/,
);
expectRefusal(
  'frame count that disagrees with the manifest is refused',
  fakeCache({ frameCount: 2 }, [new Float32Array(COUNT * 3)]),
  /frameCount/,
);
expectRefusal(
  'a sub-2 grid is refused',
  fakeCache({ count: 1, texSize: 1 }, [new Float32Array(3)]),
  /面を張れません/,
);
expectRefusal(
  'a foreign format is refused',
  fakeCache({ format: 'something-else' }, [new Float32Array(COUNT * 3)]),
  /正本形式/,
);
check(
  'the valid fixture passes validation',
  validateCacheForMeshSeries(cache).ok,
);

/* ---- 6. edition gate ---- */
const gated = await buildStateCacheMeshSeriesZip(cache, { format: 'obj', edition: 'public' });
check(
  'public edition is refused at the ZIP entry point',
  !gated.ok && /公開版/.test(gated.ok ? '' : gated.error),
  gated.ok ? 'unexpectedly ok' : gated.error,
);
const gatedFull = await buildStateCacheMeshSeriesZip(cache, { format: 'obj', edition: 'full' });
check('a non-public edition is allowed', gatedFull.ok, gatedFull.ok ? '' : gatedFull.error);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
