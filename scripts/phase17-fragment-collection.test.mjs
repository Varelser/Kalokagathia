// Phase 17 stage 4 — fragment collections (the asset form of a
// fracture division). Pure-function tests over the real helpers
// of lib/fragmentCollection.ts and the real cell-data builder of
// lib/voronoiFracture.ts:
//
// (a) build -> serialize -> parse -> decode: the assignment
//     round-trips exactly, on a synthetic cell table AND on a
//     real buildFractureCellData division of a 256x256 cloud
// (b) clusters are the bond graph's connected components: two
//     bonded groups + one isolated body, via explicit bonds and
//     via the derived glue rule (the rigid solver's adjacency)
// (c) signature matching: identical conditions match, a changed
//     seed / cells / target / gap is detected field by field
// (d) malformed payloads are refused (truncated assignment,
//     counts that disagree with the assignment, a cluster table
//     that does not partition the bodies)
// (e) compression sizes are measured for a full-size division
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17fc-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export * from './lib/fragmentCollection.ts';
      export { buildFractureCellData } from './lib/voronoiFracture.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const {
  buildFragmentCollection, serializeFragmentCollection, parseFragmentCollection,
  decodeCollectionAssignment, deriveGlueBonds, deriveFragmentClusters,
  fragmentSignatureMatches, fragmentSignatureDiffs, encodeAssignmentRle, decodeAssignmentRle,
  buildFractureCellData,
} = M;

const eqArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── Synthetic cell table: 6 bodies ────────────────────────────
// Bodies 0-2 near each other (one glue cluster), 3-4 near each
// other (a second cluster), 5 far away (isolated).
function syntheticCellData() {
  const cellCounts = [10, 20, 30, 5, 7, 3];
  const assignment = new Int32Array(75);
  let p = 0;
  cellCounts.forEach((count, body) => { for (let k = 0; k < count; k++) assignment[p++] = body; });
  return {
    assignment,
    localOffsets: new Float32Array(75 * 3),
    centroids: Float32Array.from([0, 0, 0, 0.5, 0, 0, 1.0, 0, 0, 10, 0, 0, 10.4, 0, 0, 30, 0, 0]),
    radii: Float32Array.from([0.4, 0.4, 0.4, 0.3, 0.3, 0.2]),
    coreRadii: Float32Array.from([0.4, 0.4, 0.4, 0.3, 0.3, 0.2]),
    cellCounts: Int32Array.from(cellCounts),
    bodyCount: 6,
  };
}
const SIG = { sourceTarget: 'sphere', particleCount: 75, cells: 6, fractureSeed: 7, gap: 0.25 };

// (b1) clusters from explicit bonds
{
  const clusters = deriveFragmentClusters(6, [10, 20, 30, 5, 7, 3], [[0, 1], [1, 2], [3, 4]]);
  check('clusters: 3 components', clusters.length === 3, `got ${clusters.length}`);
  check('clusters: A = {0,1,2} / 60 points', eqArray(clusters[0].bodies, [0, 1, 2]) && clusters[0].particleCount === 60);
  check('clusters: B = {3,4} / 12 points', eqArray(clusters[1].bodies, [3, 4]) && clusters[1].particleCount === 12);
  check('clusters: isolated {5} / 3 points', eqArray(clusters[2].bodies, [5]) && clusters[2].particleCount === 3);
}

// (b2) the derived glue rule finds the same grouping
{
  const bonds = deriveGlueBonds(syntheticCellData());
  const pairs = bonds.map(([a, b]) => `${a}-${b}`).sort();
  check('glue bonds: exactly the near pairs', eqArray(pairs, ['0-1', '0-2', '1-2', '3-4']), pairs.join(','));
  const clusters = deriveFragmentClusters(6, [10, 20, 30, 5, 7, 3], bonds);
  check('glue clusters: same 3 components', clusters.length === 3 && eqArray(clusters[0].bodies, [0, 1, 2]) && eqArray(clusters[2].bodies, [5]));
}

// (a1) round trip on the synthetic table
{
  const cellData = syntheticCellData();
  const collection = buildFragmentCollection(cellData, { name: 'test', signature: SIG });
  const text = serializeFragmentCollection(collection);
  check('serialize: non-null', typeof text === 'string');
  const parsed = parseFragmentCollection(text);
  check('parse: ok', parsed !== null);
  const decoded = parsed && decodeCollectionAssignment(parsed);
  check('round trip: assignment exact', !!decoded && eqArray(Array.from(decoded), Array.from(cellData.assignment)));
  check('round trip: clusters preserved', !!parsed && parsed.clusters.length === 3 && parsed.bodyCount === 6);
}

// codec edge cases
{
  check('codec: empty assignment', decodeAssignmentRle(encodeAssignmentRle(new Int32Array(0)), 0)?.length === 0);
  check('codec: wrong length refused', decodeAssignmentRle(encodeAssignmentRle(Int32Array.from([1, 1, 2])), 4) === null);
  check('codec: garbage refused', decodeAssignmentRle('!!!not-base64!!!', 0) === null);
}

// (c) signature matching
{
  check('signature: identical matches', fragmentSignatureMatches(SIG, { ...SIG }));
  check('signature: seed change detected', eqArray(fragmentSignatureDiffs(SIG, { ...SIG, fractureSeed: 8 }), ['fractureSeed']));
  check('signature: target+cells detected', eqArray(fragmentSignatureDiffs(SIG, { ...SIG, sourceTarget: 'obj', cells: 9 }), ['sourceTarget', 'cells']));
  check('signature: gap change detected', eqArray(fragmentSignatureDiffs(SIG, { ...SIG, gap: 0 }), ['gap']));
}

// (d) malformed payloads
{
  const good = JSON.parse(serializeFragmentCollection(buildFragmentCollection(syntheticCellData(), { name: 't', signature: SIG })));
  const truncated = { ...good, assignmentRleB64: encodeAssignmentRle(Int32Array.from([0, 0, 1])) };
  check('parse: truncated assignment refused', parseFragmentCollection(JSON.stringify(truncated)) === null);
  const badCounts = { ...good, cellCounts: [11, 20, 30, 5, 7, 2] };
  check('parse: counts disagreeing with assignment refused', parseFragmentCollection(JSON.stringify(badCounts)) === null);
  const badClusters = JSON.parse(JSON.stringify(good));
  badClusters.clusters = badClusters.clusters.slice(0, 2);
  check('parse: non-partitioning clusters refused', parseFragmentCollection(JSON.stringify(badClusters)) === null);
  check('parse: empty string -> null', parseFragmentCollection('') === null);
  check('parse: garbage -> null', parseFragmentCollection('{oops') === null);
}

// (a2)+(e) a real division at full texture size
{
  const texSize = 256;
  const count = texSize * texSize;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const gx = i % texSize;
    const gz = Math.floor(i / texSize);
    data[i * 4] = (gx / texSize) * 2 - 1;
    data[i * 4 + 1] = Math.sin(gx * 0.11) * 0.3;
    data[i * 4 + 2] = (gz / texSize) * 2 - 1;
    data[i * 4 + 3] = 1;
  }
  const cellData = buildFractureCellData(data, count, { cells: 64, seed: 1, gap: 0.25 });
  check('real division: cell data built', cellData !== null && cellData.bodyCount > 0, `bodyCount=${cellData?.bodyCount}`);
  const sig = { sourceTarget: 'grid', particleCount: count, cells: 64, fractureSeed: 1, gap: 0.25 };
  const collection = buildFragmentCollection(cellData, { name: 'real', signature: sig });
  const text = serializeFragmentCollection(collection);
  const parsed = text && parseFragmentCollection(text);
  const decoded = parsed && decodeCollectionAssignment(parsed);
  check('real division: round trip exact', !!decoded && eqArray(Array.from(decoded), Array.from(cellData.assignment)));
  const totalPoints = collection.clusters.reduce((s, c) => s + c.particleCount, 0);
  check('real division: cluster totals = particle count', totalPoints === count, `${totalPoints} vs ${count}`);
  console.log(`INFO  real division: bodies=${collection.bodyCount} clusters=${collection.clusters.length} jsonChars=${text.length} rleB64Chars=${collection.assignmentRleB64.length} (raw assignment would be ${count} bytes as Uint8 / ${count * 4} as Uint32)`);
  check('real division: serialised size sane', text.length < count, `${text.length} chars for ${count} particles`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
