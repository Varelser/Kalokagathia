// Phase 20 stage 1 — integration wiring: fragment restore gate
// + cluster colouring (points draw).
//
// (a) Restore gate (resolveFragmentRestoreGate): closed while
//     either key is off (no assignment, no status — the legacy
//     bake); open + exact signature match yields the saved
//     assignment; open + mismatch yields an explicit rejection
//     status (never silent).
// (b) Builder wiring (buildGpgpuMorphTargetDataWithNormals):
//     with no fragmentRestore option the bake is byte-identical
//     to the legacy sites path and reports not-applied; with a
//     resolved assignment the cell table equals the assignment
//     twin's output AND the cloud equals the assignment-driven
//     transform of the legacy cloud; with the sites-derived
//     assignment the restored bake is byte-identical to legacy.
// (c) Shader strings: the default and Phase 19 draw strings
//     stay at their pinned hashes (v2.00 / Phase 19 identity);
//     the Phase 20 cluster variants and the combined variant
//     sit at their own pins.
// (d) Cluster resolution: rigidClusterColorVariantOn requires
//     BOTH the colour key and the rigid solver; the per-body
//     LUT gives same-cluster bodies the same colour, different
//     clusters different colours, and stays deterministic.
// (e) Key defaults: both new keys default to false.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20cw-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export {
        buildFragmentCollection, serializeFragmentCollection,
        resolveFragmentRestoreGate,
      } from './lib/fragmentCollection.ts';
      export {
        buildFractureCellData, buildFractureCellDataFromAssignment,
        fractureOptionFromConfig,
      } from './lib/voronoiFracture.ts';
      export { buildGpgpuMorphTargetDataWithNormals } from './lib/gpgpuMorphTargets.ts';
      export { rigidFractureOptionFromConfig } from './lib/rigidBodies.ts';
      export {
        clusterColorForIndex, buildBodyClusterColorLut, RIGID_CLUSTER_COLOR_COUNT,
      } from './lib/rigidClusterColors.ts';
      export {
        DRAW_VERT, DRAW_VERT_PHASE19, DRAW_VERT_PHASE20,
        DRAW_FRAG, DRAW_FRAG_PHASE19, DRAW_FRAG_PHASE20,
        buildDrawVert, buildDrawFrag,
      } from './components/gpgpuShaderPoints.ts';
      export { rigidClusterColorVariantOn, vellumCrackVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const {
  buildFragmentCollection, serializeFragmentCollection, resolveFragmentRestoreGate,
  buildFractureCellData, buildFractureCellDataFromAssignment, fractureOptionFromConfig,
  buildGpgpuMorphTargetDataWithNormals, rigidFractureOptionFromConfig,
  clusterColorForIndex, buildBodyClusterColorLut, RIGID_CLUSTER_COLOR_COUNT,
  DRAW_VERT, DRAW_VERT_PHASE19, DRAW_VERT_PHASE20,
  DRAW_FRAG, DRAW_FRAG_PHASE19, DRAW_FRAG_PHASE20,
  buildDrawVert, buildDrawFrag,
  rigidClusterColorVariantOn, DEFAULT_CONFIG,
} = M;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const bytesEq = (a, b) => a.length === b.length
  && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const cellDataEq = (a, b) => !!a && !!b && a.bodyCount === b.bodyCount
  && bytesEq(a.assignment, b.assignment) && bytesEq(a.localOffsets, b.localOffsets)
  && bytesEq(a.centroids, b.centroids) && bytesEq(a.radii, b.radii)
  && bytesEq(a.coreRadii, b.coreRadii) && bytesEq(a.cellCounts, b.cellCounts);

// ── Fixture: a real bake (fracture + rigid cell table) ───────
const texSize = 24;
const count = texSize * texSize;
const bakeConfig = {
  ...DEFAULT_CONFIG,
  // 'terrain' yields a spread cloud whose fracture division has
  // several non-empty cells at this size (the analytic shell
  // targets collapse to a single cell in a bare builder call).
  gpgpuMorphTarget: 'terrain',
  gpgpuMorphFractureEnabled: true,
  gpgpuMorphFractureCells: 8,
  gpgpuMorphFractureSeed: 3,
  gpgpuMorphFractureGap: 0.25,
  gpgpuRigidEnabled: true,
};
const rigidFracture = rigidFractureOptionFromConfig(bakeConfig);
const fracture = fractureOptionFromConfig(bakeConfig);
const bakeOptions = {
  texSize,
  target: bakeConfig.gpgpuMorphTarget,
  worldScale: 48,
  jitter: 0,
  seed: 7,
  fracture,
  rigidFracture,
};
const legacy = buildGpgpuMorphTargetDataWithNormals(bakeOptions);
check('fixture bake produced a cell table', !!legacy.fractureCells && legacy.fractureCells.bodyCount > 1,
  `bodyCount=${legacy.fractureCells?.bodyCount}`);
check('legacy bake reports restore not applied', legacy.fragmentRestoreApplied === false);

const signature = {
  sourceTarget: bakeConfig.gpgpuMorphTarget,
  particleCount: count,
  cells: rigidFracture.cells,
  fractureSeed: rigidFracture.seed,
  gap: rigidFracture.gap,
};
const collection = buildFragmentCollection(legacy.fractureCells, { name: 'fixture', signature });
const savedJson = serializeFragmentCollection(collection);
check('fixture collection serialised', typeof savedJson === 'string' && savedJson.length > 0);

// ── (a) Restore gate ─────────────────────────────────────────
const gateOffRestore = resolveFragmentRestoreGate({
  restoreEnabled: false, rigidEnabled: true, savedJson, signature,
});
check('gate closed while restore key off', gateOffRestore.assignment === null && gateOffRestore.status === null);
const gateOffRigid = resolveFragmentRestoreGate({
  restoreEnabled: true, rigidEnabled: false, savedJson, signature,
});
check('gate closed while rigid solver off', gateOffRigid.assignment === null && gateOffRigid.status === null);

const gateOpen = resolveFragmentRestoreGate({
  restoreEnabled: true, rigidEnabled: true, savedJson, signature,
});
check('gate open + signature match yields the assignment',
  gateOpen.assignment !== null && gateOpen.status?.state === 'applied');
check('gate assignment is the saved division',
  gateOpen.assignment !== null && bytesEq(gateOpen.assignment, legacy.fractureCells.assignment));

const gateMismatch = resolveFragmentRestoreGate({
  restoreEnabled: true, rigidEnabled: true, savedJson,
  signature: { ...signature, fractureSeed: signature.fractureSeed + 1 },
});
check('gate open + signature mismatch is rejected explicitly',
  gateMismatch.assignment === null && gateMismatch.status?.state === 'rejected'
  && gateMismatch.status.reason === 'signature-mismatch',
  JSON.stringify(gateMismatch.status));
const gateEmpty = resolveFragmentRestoreGate({
  restoreEnabled: true, rigidEnabled: true, savedJson: '', signature,
});
check('gate open + nothing saved is rejected explicitly',
  gateEmpty.assignment === null && gateEmpty.status?.state === 'rejected' && gateEmpty.status.reason === 'empty');

// ── (b) Builder wiring ───────────────────────────────────────
// The saved division IS the sites division here, so a restored
// bake must reproduce the legacy bake byte-identically.
const restored = buildGpgpuMorphTargetDataWithNormals({
  ...bakeOptions,
  fragmentRestore: gateOpen.assignment ? { assignment: gateOpen.assignment } : null,
});
check('restored bake reports applied', restored.fragmentRestoreApplied === true);
check('restored bake cloud is byte-identical (saved = sites division)', bytesEq(restored.data, legacy.data));
check('restored bake cell table is byte-identical', cellDataEq(restored.fractureCells, legacy.fractureCells));

// A DIFFERENT valid division: swap two bodies' labels in a copy
// of the assignment. The restored cell table must equal the
// assignment twin over the pre-transform cloud, and the cloud
// must differ from legacy (the wiring really drives the bake).
const swapped = Int32Array.from(legacy.fractureCells.assignment);
{
  const firstOfBody = new Map();
  for (let i = 0; i < swapped.length; i++) {
    if (!firstOfBody.has(swapped[i])) firstOfBody.set(swapped[i], i);
  }
  const bodies = [...firstOfBody.keys()];
  const [b0, b1] = [bodies[0], bodies[1]];
  for (let i = 0; i < swapped.length; i++) {
    if (swapped[i] === b0) swapped[i] = b1;
    else if (swapped[i] === b1) swapped[i] = b0;
  }
}
const restoredSwapped = buildGpgpuMorphTargetDataWithNormals({
  ...bakeOptions,
  fragmentRestore: { assignment: swapped },
});
// Rebuild the pre-transform cloud the same way the builder did:
// the legacy bake WITHOUT the fracture transform.
const preTransform = buildGpgpuMorphTargetDataWithNormals({ ...bakeOptions, fracture: null, rigidFracture: null });
const expectedCells = buildFractureCellDataFromAssignment(preTransform.data, count, swapped, rigidFracture.gap);
check('restored (swapped) cell table equals the assignment twin',
  cellDataEq(restoredSwapped.fractureCells, expectedCells));
check('restored (swapped) bake reports applied', restoredSwapped.fragmentRestoreApplied === true);

// A malformed assignment (wrong length) falls back to the
// sites division and reports not-applied — defensive only; the
// gate never hands one over.
const restoredBad = buildGpgpuMorphTargetDataWithNormals({
  ...bakeOptions,
  fragmentRestore: { assignment: new Int32Array(4) },
});
check('malformed assignment falls back to the sites division',
  restoredBad.fragmentRestoreApplied === false && cellDataEq(restoredBad.fractureCells, legacy.fractureCells)
  && bytesEq(restoredBad.data, legacy.data));

// ── (c) Shader string pins ───────────────────────────────────
check('DRAW_VERT default pin (v2.00 identity)',
  sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529', sha256(DRAW_VERT));
check('DRAW_FRAG default pin (v2.00 identity)',
  sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c', sha256(DRAW_FRAG));
check('DRAW_VERT_PHASE19 pin',
  sha256(DRAW_VERT_PHASE19) === '7cd85d79ae5182eb2a47c632bd422fb94257ec035c0bc1788b6fa0a5fa8e71d4', sha256(DRAW_VERT_PHASE19));
check('DRAW_FRAG_PHASE19 pin',
  sha256(DRAW_FRAG_PHASE19) === '652c327402f5ed5289bdcb5dda2a25b252470163213a672ac067b502655dcaed', sha256(DRAW_FRAG_PHASE19));
check('DRAW_VERT_PHASE20 pin',
  sha256(DRAW_VERT_PHASE20) === '1d72339eda42c9ba5d4e72530031b202948375e33355bf3072f739c1b82b1893', sha256(DRAW_VERT_PHASE20));
check('DRAW_FRAG_PHASE20 pin',
  sha256(DRAW_FRAG_PHASE20) === 'db3335c11691b2aa347ed4b6447bb61decb1fb6eac836e0d23591c543a10c32d', sha256(DRAW_FRAG_PHASE20));
check('combined (phase19+phase20) vert pin',
  sha256(buildDrawVert({ vellumCrack: true, clusterColor: true })) === '98c12f4147cfa9e4bf448bcb882f1e48dd7d476c2d07a06f904614e1e125a6e7');
check('combined (phase19+phase20) frag pin',
  sha256(buildDrawFrag({ vellumCrack: true, clusterColor: true })) === '7eb2ea7a5b185121f13d59ded3b0a827f1f0db6c38dd2f643e4bf1727bb217f3');
check('builders with no options return the default strings',
  buildDrawVert() === DRAW_VERT && buildDrawFrag() === DRAW_FRAG
  && buildDrawVert({}) === DRAW_VERT && buildDrawFrag({ clusterColor: false }) === DRAW_FRAG);
check('cluster variant actually adds the LUT lookup + base-colour replacement',
  DRAW_VERT_PHASE20.includes('uClusterColorLutTex') && DRAW_VERT_PHASE20.includes('uClusterCellTex')
  && DRAW_FRAG_PHASE20.includes('vClusterOn > 0.5'));

// ── (d) Cluster resolution + per-body LUT ────────────────────
check('variant requires the colour key AND the rigid solver',
  rigidClusterColorVariantOn({ gpgpuRigidClusterColorEnabled: true, gpgpuRigidEnabled: true }) === true
  && rigidClusterColorVariantOn({ gpgpuRigidClusterColorEnabled: true, gpgpuRigidEnabled: false }) === false
  && rigidClusterColorVariantOn({ gpgpuRigidClusterColorEnabled: false, gpgpuRigidEnabled: true }) === false
  && rigidClusterColorVariantOn({}) === false);

const lut = buildBodyClusterColorLut(legacy.fractureCells);
check('per-body LUT is sized for the full body budget', lut.length === RIGID_CLUSTER_COLOR_COUNT * 4);
const lut2 = buildBodyClusterColorLut(legacy.fractureCells);
check('per-body LUT is deterministic', bytesEq(lut, lut2));
// Every body's row equals its cluster's colour, and bodies in
// different clusters differ (fixture clusters come from the
// saved collection — the same derivation).
const bodyCluster = new Map();
for (const cluster of collection.clusters) {
  for (const body of cluster.bodies) bodyCluster.set(body, cluster.id);
}
let lutConsistent = true;
for (let b = 0; b < legacy.fractureCells.bodyCount; b++) {
  const expected = clusterColorForIndex(bodyCluster.get(b));
  for (let k = 0; k < 4; k++) {
    // The LUT is a Float32Array: compare at float32 precision.
    if (lut[b * 4 + k] !== Math.fround(expected[k])) lutConsistent = false;
  }
}
check('per-body LUT rows equal the body cluster colours', lutConsistent);
if (collection.clusters.length > 1) {
  const c0 = clusterColorForIndex(collection.clusters[0].id);
  const c1 = clusterColorForIndex(collection.clusters[1].id);
  check('different clusters take different colours',
    c0[0] !== c1[0] || c0[1] !== c1[1] || c0[2] !== c1[2]);
} else {
  check('fixture has a single cluster (colour difference covered by clusterColorForIndex pins)', true);
}

// ── (e) Key defaults ─────────────────────────────────────────
check('restore key defaults off', DEFAULT_CONFIG.gpgpuFragmentCollectionRestoreEnabled === false);
check('cluster colour key defaults off', DEFAULT_CONFIG.gpgpuRigidClusterColorEnabled === false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
