// Limit plan stage 4, slice S1 — per-zone OBJ sources for the
// foliage-split geometry path. Design: kalokagathia-pro/
// STAGE4_DESIGN_MATERIALS.md §1 (zone別モデル) and
// STAGE4_PREP_INVENTORY.md §1.3 (不足分 2: モデルは1場面1
// OBJソース).
//
// What is pinned here (node side):
//  (a) Fallback at rest: the three new keys
//      (gpgpuGeomSpecies{2,3,4}ObjSource) default to '', and
//      while empty every species zone resolves to exactly the
//      single gpgpuMorphObjSource string — the same document
//      the legacy build read.
//  (b) Zone override: a non-empty zone source is used by that
//      zone only; the built base-geometry data
//      (buildObjGeomBaseData over the resolved source) differs
//      for that zone and matches the single source for the
//      others. Zone 0 always reads the single source, even
//      when zone keys are set.
//  (c) Byte-identity at defaults: the base-geometry data built
//      from each zone's resolved source is byte-identical
//      (hash over positions / normals / indices) to the data
//      built from the single source, for every zone — the
//      stage-wide invariant (未設定時は従来と同一) for this
//      slice. The zone-0 single-mesh path is additionally
//      pinned by source text to keep reading
//      config.gpgpuMorphObjSource directly.
//  A whitespace-only zone source carries no model (the same
//  emptiness buildObjGeomBaseData applies) and falls back.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4s1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { resolveSpeciesGeomMode, resolveSpeciesObjSource } from './components/useGpgpuMeshAssets.ts';
      export { buildObjGeomBaseData } from './lib/objMesh.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const { resolveSpeciesObjSource, buildObjGeomBaseData, DEFAULT_CONFIG, APP_STATE_DEFAULT_GPGPU } = m;

  // Two small, distinct OBJ documents: a tetrahedron (4
  // triangles) and an octahedron (8 triangles).
  const TETRA = [
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 0 0 1',
    'f 1 2 3', 'f 1 4 2', 'f 1 3 4', 'f 2 4 3',
  ].join('\n');
  const OCTA = [
    'v 1 0 0', 'v -1 0 0', 'v 0 1 0', 'v 0 -1 0', 'v 0 0 1', 'v 0 0 -1',
    'f 1 3 5', 'f 3 2 5', 'f 2 4 5', 'f 4 1 5',
    'f 3 1 6', 'f 2 3 6', 'f 4 2 6', 'f 1 4 6',
  ].join('\n');

  const dataHash = (d) => {
    if (!d) return 'null';
    const h = createHash('sha256');
    h.update(Buffer.from(d.positions.buffer, d.positions.byteOffset, d.positions.byteLength));
    h.update(Buffer.from(d.normals.buffer, d.normals.byteOffset, d.normals.byteLength));
    h.update(Buffer.from(d.indices.buffer, d.indices.byteOffset, d.indices.byteLength));
    return h.digest('hex');
  };
  const cfg = (patch) => ({ ...DEFAULT_CONFIG, ...patch });

  // --- defaults carry the new keys, empty ----------------------
  check('defaults: gpgpu defaults carry the three zone OBJ sources as empty strings',
    APP_STATE_DEFAULT_GPGPU.gpgpuGeomSpecies2ObjSource === ''
      && APP_STATE_DEFAULT_GPGPU.gpgpuGeomSpecies3ObjSource === ''
      && APP_STATE_DEFAULT_GPGPU.gpgpuGeomSpecies4ObjSource === '');
  check('defaults: full default config resolves the three keys to empty strings',
    DEFAULT_CONFIG.gpgpuGeomSpecies2ObjSource === ''
      && DEFAULT_CONFIG.gpgpuGeomSpecies3ObjSource === ''
      && DEFAULT_CONFIG.gpgpuGeomSpecies4ObjSource === '');

  // --- (a) fallback at rest ------------------------------------
  const rest = cfg({ gpgpuMorphObjSource: TETRA });
  for (let z = 0; z < 4; z++) {
    check(`(a) zone ${z} at defaults resolves to the single source (strict identity)`,
      resolveSpeciesObjSource(rest, z) === TETRA);
  }
  const restEmpty = cfg({});
  for (let z = 0; z < 4; z++) {
    check(`(a) zone ${z} with empty single source resolves to ''`,
      resolveSpeciesObjSource(restEmpty, z) === '');
  }

  // --- (c) byte-identity of the built data at defaults ---------
  const singleHash = dataHash(buildObjGeomBaseData(TETRA));
  check('(c) fixture: the single source builds usable base data', singleHash !== 'null');
  for (let z = 0; z < 4; z++) {
    check(`(c) zone ${z} built data at defaults is byte-identical to the single-source build`,
      dataHash(buildObjGeomBaseData(resolveSpeciesObjSource(rest, z))) === singleHash);
  }

  // --- (b) zone override ---------------------------------------
  const overridden = cfg({
    gpgpuMorphObjSource: TETRA,
    gpgpuGeomSpecies2ObjSource: OCTA,
  });
  check('(b) zone 1 resolves to its own source', resolveSpeciesObjSource(overridden, 1) === OCTA);
  check('(b) zone 0 still resolves to the single source', resolveSpeciesObjSource(overridden, 0) === TETRA);
  check('(b) zone 2 still resolves to the single source', resolveSpeciesObjSource(overridden, 2) === TETRA);
  check('(b) zone 3 still resolves to the single source', resolveSpeciesObjSource(overridden, 3) === TETRA);
  const zone1Data = buildObjGeomBaseData(resolveSpeciesObjSource(overridden, 1));
  const zone2Data = buildObjGeomBaseData(resolveSpeciesObjSource(overridden, 2));
  check('(b) zone 1 builds the octahedron (8 triangles)', zone1Data !== null && zone1Data.triangleCount === 8,
    zone1Data ? String(zone1Data.triangleCount) : 'null');
  check('(b) zone 2 builds the tetrahedron (4 triangles)', zone2Data !== null && zone2Data.triangleCount === 4,
    zone2Data ? String(zone2Data.triangleCount) : 'null');
  check('(b) zone 1 built data differs from the single-source build',
    dataHash(zone1Data) !== singleHash && dataHash(zone2Data) === singleHash);

  const overridden4 = cfg({
    gpgpuMorphObjSource: TETRA,
    gpgpuGeomSpecies4ObjSource: OCTA,
  });
  check('(b) species-4 override touches zone 3 only',
    resolveSpeciesObjSource(overridden4, 3) === OCTA
      && resolveSpeciesObjSource(overridden4, 1) === TETRA
      && resolveSpeciesObjSource(overridden4, 2) === TETRA
      && resolveSpeciesObjSource(overridden4, 0) === TETRA);

  // --- whitespace-only zone source falls back ------------------
  const whitespace = cfg({
    gpgpuMorphObjSource: TETRA,
    gpgpuGeomSpecies3ObjSource: '  \n ',
  });
  check('whitespace-only zone source falls back to the single source',
    resolveSpeciesObjSource(whitespace, 2) === TETRA);

  // --- source pins on the wiring --------------------------------
  const meshAssets = readFileSync(join(ROOT, 'components', 'useGpgpuMeshAssets.ts'), 'utf8');
  check('wiring: species split builds each zone from its resolved source',
    meshAssets.includes('buildGeomBaseGeometry(mode as GeomBaseMode, resolveSpeciesObjSource(config, k))'));
  check('wiring: zone-0 single mesh still reads the single source directly',
    meshAssets.includes('buildGeomBaseGeometry(config.gpgpuGeomMode as GeomBaseMode, config.gpgpuMorphObjSource)'));
  check('wiring: species split rebuild deps include the three zone sources',
    meshAssets.includes('config.gpgpuGeomSpecies2ObjSource, config.gpgpuGeomSpecies3ObjSource, config.gpgpuGeomSpecies4ObjSource'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
