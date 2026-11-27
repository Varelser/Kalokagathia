// Phase 20 stage 1 — fragment restore core + cluster colours.
// Pure-function tests over the real helpers:
//
// (a) resolveFragmentRestore: an exact signature match returns
//     the restore target (collection + decoded assignment);
//     a differing field is rejected as 'signature-mismatch'
//     WITH the differing fields named; broken / empty /
//     structurally invalid payloads are rejected with their
//     own reasons (no silent fallback anywhere)
// (b) assignment-driven fracture: buildFractureCellDataFrom-
//     Assignment and applyVoronoiFractureWithAssignment fed
//     the sites-derived assignment reproduce the sites path
//     BYTE-IDENTICALLY (cell data and transformed cloud),
//     gap 0 stays an identity, malformed assignments are
//     refused without touching the data
// (c) cluster colours: deterministic per id, distinct across
//     ids, in range, and the LUT packs 256 RGBA rows by default
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20fr-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export * from './lib/fragmentCollection.ts';
      export * from './lib/rigidClusterColors.ts';
      export {
        buildFractureCellData, buildFractureCellDataFromAssignment,
        applyVoronoiFracture, applyVoronoiFractureWithAssignment,
      } from './lib/voronoiFracture.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const {
  buildFragmentCollection, serializeFragmentCollection, resolveFragmentRestore,
  buildFractureCellData, buildFractureCellDataFromAssignment,
  applyVoronoiFracture, applyVoronoiFractureWithAssignment,
  clusterColorForIndex, buildClusterColorLut,
  RIGID_CLUSTER_COLOR_COUNT,
} = M;

const eqArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytesEq = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
  .equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

// ── A synthetic cloud + its real sites-derived division ──────
const texSize = 64;
const count = texSize * texSize;
function syntheticCloud() {
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const gx = i % texSize;
    const gz = Math.floor(i / texSize);
    data[i * 4] = (gx / texSize) * 2 - 1;
    data[i * 4 + 1] = Math.sin(gx * 0.11) * 0.3;
    data[i * 4 + 2] = (gz / texSize) * 2 - 1;
    data[i * 4 + 3] = 1;
  }
  return data;
}
const OPTS = { cells: 12, seed: 3, gap: 0.25 };
const SIG = { sourceTarget: 'grid', particleCount: count, cells: 12, fractureSeed: 3, gap: 0.25 };
const baseData = syntheticCloud();
const cellData = buildFractureCellData(baseData, count, OPTS);
check('setup: sites division built', cellData !== null && cellData.bodyCount > 1, `bodyCount=${cellData?.bodyCount}`);
const collection = buildFragmentCollection(cellData, { name: 'restore-me', signature: SIG });
const savedJson = serializeFragmentCollection(collection);
check('setup: collection serialised', typeof savedJson === 'string');

// (a) restore resolution
{
  const res = resolveFragmentRestore(savedJson, { ...SIG });
  check('restore: exact signature match resolves', res.ok === true);
  check('restore: assignment round-trips the division',
    res.ok === true && eqArray(Array.from(res.assignment), Array.from(cellData.assignment)));
  check('restore: collection identity preserved',
    res.ok === true && res.collection.bodyCount === cellData.bodyCount && res.collection.name === 'restore-me');

  const seedDiff = resolveFragmentRestore(savedJson, { ...SIG, fractureSeed: 4 });
  check('restore: seed mismatch rejected with reason',
    seedDiff.ok === false && seedDiff.reason === 'signature-mismatch');
  check('restore: mismatch names the differing field',
    seedDiff.ok === false && eqArray(seedDiff.diffs, ['fractureSeed']), JSON.stringify(seedDiff.diffs));
  const multiDiff = resolveFragmentRestore(savedJson, { ...SIG, sourceTarget: 'obj', cells: 9, gap: 0 });
  check('restore: multiple diffs all named',
    multiDiff.ok === false && eqArray(multiDiff.diffs, ['sourceTarget', 'cells', 'gap']),
    JSON.stringify(multiDiff.diffs));
  check('restore: rejection carries a displayable detail',
    seedDiff.ok === false && typeof seedDiff.detail === 'string' && seedDiff.detail.length > 0);

  const empty = resolveFragmentRestore('', { ...SIG });
  check('restore: empty text rejected as empty', empty.ok === false && empty.reason === 'empty');
  const garbage = resolveFragmentRestore('{oops', { ...SIG });
  check('restore: broken JSON rejected as malformed', garbage.ok === false && garbage.reason === 'malformed');
  const wrongShape = resolveFragmentRestore('{"version":2}', { ...SIG });
  check('restore: invalid collection rejected as malformed',
    wrongShape.ok === false && wrongShape.reason === 'malformed');
  const tampered = JSON.parse(savedJson);
  tampered.cellCounts = tampered.cellCounts.map((v, i) => (i === 0 ? v + 1 : v));
  const tamperedRes = resolveFragmentRestore(JSON.stringify(tampered), { ...SIG });
  check('restore: counts tampered payload rejected as malformed',
    tamperedRes.ok === false && tamperedRes.reason === 'malformed');
}

// (b) assignment-driven fracture == sites path, byte for byte
{
  const restored = buildFractureCellDataFromAssignment(baseData, count, cellData.assignment, OPTS.gap);
  check('celldata-from-assignment: built', restored !== null);
  check('celldata-from-assignment: bodyCount identical', restored?.bodyCount === cellData.bodyCount);
  check('celldata-from-assignment: assignment identical',
    !!restored && eqArray(Array.from(restored.assignment), Array.from(cellData.assignment)));
  check('celldata-from-assignment: cellCounts identical',
    !!restored && eqArray(Array.from(restored.cellCounts), Array.from(cellData.cellCounts)));
  check('celldata-from-assignment: centroids byte-identical',
    !!restored && bytesEq(restored.centroids, cellData.centroids));
  check('celldata-from-assignment: localOffsets byte-identical',
    !!restored && bytesEq(restored.localOffsets, cellData.localOffsets));
  check('celldata-from-assignment: radii byte-identical',
    !!restored && bytesEq(restored.radii, cellData.radii) && bytesEq(restored.coreRadii, cellData.coreRadii));

  const cloudA = syntheticCloud();
  const cloudB = syntheticCloud();
  const ra = applyVoronoiFracture(cloudA, count, OPTS);
  const rb = applyVoronoiFractureWithAssignment(cloudB, count, cellData.assignment, OPTS.gap);
  check('apply-with-assignment: non-empty count = bodyCount',
    rb.nonEmptyCells === cellData.bodyCount && ra.nonEmptyCells === cellData.bodyCount,
    `sites=${ra.nonEmptyCells} given=${rb.nonEmptyCells} bodies=${cellData.bodyCount}`);
  check('apply-with-assignment: transformed cloud byte-identical', bytesEq(cloudA, cloudB));

  const cloudC = syntheticCloud();
  const before = Float32Array.from(cloudC);
  const rc = applyVoronoiFractureWithAssignment(cloudC, count, cellData.assignment, 0);
  check('apply-with-assignment: gap 0 is an identity',
    rc.nonEmptyCells === cellData.bodyCount && bytesEq(cloudC, before));

  const cloudD = syntheticCloud();
  const rd = applyVoronoiFractureWithAssignment(cloudD, count, new Int32Array(10), OPTS.gap);
  check('apply-with-assignment: wrong-length assignment refused, data untouched',
    rd.cells === 0 && rd.nonEmptyCells === 0 && bytesEq(cloudD, before));
  check('celldata-from-assignment: wrong-length assignment refused',
    buildFractureCellDataFromAssignment(baseData, count, new Int32Array(3), OPTS.gap) === null);
  const gappy = Int32Array.from(cellData.assignment);
  gappy[0] = cellData.bodyCount + 5; // leaves a hole in the index span AND a body empty
  check('celldata-from-assignment: non-compacted assignment refused',
    buildFractureCellDataFromAssignment(baseData, count, gappy, OPTS.gap) === null);
  const negative = Int32Array.from(cellData.assignment);
  negative[0] = -1;
  check('celldata-from-assignment: negative index refused',
    buildFractureCellDataFromAssignment(baseData, count, negative, OPTS.gap) === null);
}

// (c) cluster colours
{
  const c0 = clusterColorForIndex(0);
  check('colour: deterministic across calls', eqArray(clusterColorForIndex(0), c0)
    && eqArray(clusterColorForIndex(7), clusterColorForIndex(7)));
  check('colour: components in 0..1 with alpha 1',
    c0.every((v) => v >= 0 && v <= 1) && c0[3] === 1);
  const seen = new Set();
  let distinct = true;
  for (let i = 0; i < 16; i++) {
    const key = clusterColorForIndex(i).join(',');
    if (seen.has(key)) distinct = false;
    seen.add(key);
  }
  check('colour: first 16 ids all distinct', distinct);
  check('colour: stable regardless of neighbourhood (id 3 unaffected by count)',
    eqArray(clusterColorForIndex(3).map(Math.fround), Array.from(buildClusterColorLut(4).slice(12, 16))));
  check('colour: invalid id falls back to a fixed neutral',
    eqArray(clusterColorForIndex(-1), clusterColorForIndex(-1))
    && eqArray(clusterColorForIndex(-1), [0.5, 0.5, 0.5, 1]));

  const lut = buildClusterColorLut();
  check('lut: default is 256 RGBA rows', lut.length === RIGID_CLUSTER_COLOR_COUNT * 4 && lut.length === 1024,
    `len=${lut.length}`);
  let rowsMatch = true;
  for (let i = 0; i < RIGID_CLUSTER_COLOR_COUNT; i++) {
    if (!eqArray(Array.from(lut.slice(i * 4, i * 4 + 4)), clusterColorForIndex(i).map(Math.fround))) rowsMatch = false;
  }
  check('lut: every row equals clusterColorForIndex', rowsMatch);
  check('lut: explicit count honoured and clamped',
    buildClusterColorLut(4).length === 16 && buildClusterColorLut(1000).length === 1024
    && buildClusterColorLut(0).length === 0);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
