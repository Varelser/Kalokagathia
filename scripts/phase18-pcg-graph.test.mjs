// Phase 18 stage 3 — PCG rule graph for the terrain scatter bake.
// Core identity: the default graph, evaluated through the plan,
// must produce byte-identical bake output to the legacy fixed-order
// path (same RNG consumption order, same weight formulas), for a
// deterministic synthetic terrain. Non-default graphs must change
// the result in the expected direction, and every malformed input
// must fall back to the default graph.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { PCG_DEFAULT_GRAPH, defaultPcgGraph, validatePcgGraph, parsePcgGraphData, resolvePcgGraph, isValidPcgGraphData, isDefaultPcgGraph, serializePcgGraph, evaluatePcgGraph, pcgAcceptance, pcgHeightBandFactor, pcgSlopeFactor } from './lib/pcgGraph.ts';
      export { buildGpgpuMorphTargetDataWithNormals, terrainScatterAcceptance } from './lib/gpgpuMorphTargets.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { PCG_DEFAULT_GRAPH, defaultPcgGraph, validatePcgGraph, parsePcgGraphData, resolvePcgGraph, isValidPcgGraphData, isDefaultPcgGraph, serializePcgGraph, evaluatePcgGraph, pcgAcceptance } = lib;
const { buildGpgpuMorphTargetDataWithNormals, terrainScatterAcceptance } = lib;

const sha = (arr) => createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');
const bakeHash = (b) => `${sha(b.data)}/${sha(b.normalData)}/${createHash('sha256').update(Buffer.from(b.speciesData)).digest('hex')}`;

// --- validation / fallback --------------------------------------
{
  check('default graph has 6 nodes in fixed order', PCG_DEFAULT_GRAPH.map((n) => n.op).join(',') === 'candidates,density,height-band,slope,species,align-normal');
  check('empty data resolves to default graph', JSON.stringify(resolvePcgGraph('')) === JSON.stringify(defaultPcgGraph()));
  check('broken JSON falls back to default', JSON.stringify(resolvePcgGraph('{oops')) === JSON.stringify(defaultPcgGraph()) && !isValidPcgGraphData('{oops'));
  check('unknown kind falls back', resolvePcgGraph(JSON.stringify([{ id: 'x', kind: 'warp', op: 'candidates', enabled: true }])).length === 6 && !isValidPcgGraphData(JSON.stringify([{ id: 'x', kind: 'warp', op: 'candidates', enabled: true }])));
  check('unknown op falls back', parsePcgGraphData(JSON.stringify([{ id: 'x', kind: 'filter', op: 'nope', enabled: true }])) === null);
  check('duplicate id falls back', parsePcgGraphData(JSON.stringify([
    { id: 'a', kind: 'sampler', op: 'candidates', enabled: true },
    { id: 'a', kind: 'filter', op: 'density', enabled: true },
  ])) === null);
  check('forward reference by index rejected', parsePcgGraphData(JSON.stringify([
    { id: 'a', kind: 'filter', op: 'density', enabled: true, input: 1 },
    { id: 'b', kind: 'sampler', op: 'candidates', enabled: true },
  ])) === null);
  check('self reference rejected', parsePcgGraphData(JSON.stringify([
    { id: 'a', kind: 'sampler', op: 'candidates', enabled: true, input: 'a' },
  ])) === null);
  check('forward reference by id rejected', parsePcgGraphData(JSON.stringify([
    { id: 'a', kind: 'filter', op: 'density', enabled: true, input: 'b' },
    { id: 'b', kind: 'sampler', op: 'candidates', enabled: true },
  ])) === null);
  check('preceding references accepted (index and id)', parsePcgGraphData(JSON.stringify([
    { id: 'a', kind: 'sampler', op: 'candidates', enabled: true },
    { id: 'b', kind: 'filter', op: 'density', enabled: true, input: 0 },
    { id: 'c', kind: 'filter', op: 'slope', enabled: true, input: 'b' },
  ]))?.length === 3);
  check('validate rejects non-array / empty', validatePcgGraph('x') === null && validatePcgGraph([]) === null);
  check('isDefault: empty and explicit default JSON', isDefaultPcgGraph('') && isDefaultPcgGraph(JSON.stringify(defaultPcgGraph())));
  check('serialize default == empty string', serializePcgGraph(defaultPcgGraph()) === '');
  const custom = defaultPcgGraph().map((n) => (n.op === 'density' ? { ...n, enabled: false } : n));
  check('serialize custom round-trips', JSON.stringify(parsePcgGraphData(serializePcgGraph(custom))) === JSON.stringify(custom));
  check('invalid graph data in bake falls back (see bake section)', true);
}

// --- evaluator ---------------------------------------------------
{
  const plan = evaluatePcgGraph(defaultPcgGraph());
  check('default plan: sampler on, attempts 5', plan.samplerEnabled && plan.attempts === 5);
  check('default plan filter order', plan.filterOps.join(',') === 'density,height-band,slope');
  check('default plan transformer order', plan.transformerOps.join(',') === 'species,align-normal');
  const scatter = { density: 0.6, heightMin: 0.2, heightMax: 0.8, slopeMax: 0.5, alignNormal: 1, species: 2, scaleRandom: 0, rotRandom: 0, bend: 0 };
  let accMatch = true;
  for (const t of [0, 0.1, 0.19, 0.2, 0.5, 0.8, 0.84, 1]) {
    for (const s of [0, 0.4, 0.5, 0.6, 1]) {
      if (pcgAcceptance(plan, scatter, t, s) !== terrainScatterAcceptance(scatter, t, s)) accMatch = false;
    }
  }
  check('default plan acceptance === legacy acceptance (bitwise, 40 cases)', accMatch);
  const noDensity = evaluatePcgGraph(defaultPcgGraph().map((n) => (n.op === 'density' ? { ...n, enabled: false } : n)));
  check('density disabled removes its factor', pcgAcceptance(noDensity, scatter, 0.5, 0) === 1, String(pcgAcceptance(noDensity, scatter, 0.5, 0)));
}

// --- bake identity + effects -------------------------------------
{
  const terrain = { amplitude: 30, frequency: 1.5, octaves: 3, seed: 7 };
  const scatterBase = {
    density: 0.55, heightMin: 0.25, heightMax: 0.85, slopeMax: 0.7,
    alignNormal: 1, species: 3, scaleRandom: 0.3, rotRandom: 0.2, bend: 0.25,
  };
  const bakeOpts = (scatter) => ({ texSize: 16, target: 'terrain', worldScale: 1, jitter: 0, seed: 3, terrain, scatter });
  const legacy = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase }));
  const legacyHash = bakeHash(legacy);
  console.log(`  legacy bake hash: ${legacyHash}`);

  const viaDefaultEmpty = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: '' }));
  check('graph ON + default graph (empty) == legacy bake (byte sha256)', bakeHash(viaDefaultEmpty) === legacyHash, bakeHash(viaDefaultEmpty));
  const viaDefaultJson = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: JSON.stringify(defaultPcgGraph()) }));
  check('graph ON + explicit default JSON == legacy bake', bakeHash(viaDefaultJson) === legacyHash);
  const viaBroken = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: '[{"id":"x","kind":"filter","op":"density","enabled":true,"input":5}]' }));
  check('graph ON + invalid data falls back to default == legacy bake', bakeHash(viaBroken) === legacyHash);
  const graphOff = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: false, pcgGraphData: serializePcgGraph(defaultPcgGraph().map((n) => (n.op === 'density' ? { ...n, enabled: false } : n))) }));
  check('graph OFF ignores custom data == legacy bake', bakeHash(graphOff) === legacyHash);

  // Disabling the density filter raises acceptance: with density
  // 0.55 the placed points must change.
  const noDensityData = serializePcgGraph(defaultPcgGraph().map((n) => (n.op === 'density' ? { ...n, enabled: false } : n)));
  const noDensity = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: noDensityData }));
  check('density node disabled changes bake', bakeHash(noDensity) !== legacyHash);

  // Disabling align-normal zeroes the companion normals but keeps
  // the placed positions and species zones.
  const noAlignData = serializePcgGraph(defaultPcgGraph().map((n) => (n.op === 'align-normal' ? { ...n, enabled: false } : n)));
  const noAlign = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: noAlignData }));
  check('align-normal disabled: normals all zero', noAlign.normalData.every((v) => v === 0));
  check('align-normal disabled: positions unchanged', sha(noAlign.data) === sha(legacy.data));
  check('align-normal disabled: species unchanged', sha(noAlign.speciesData) === sha(legacy.speciesData));

  // Reorder with register semantics: align-normal BEFORE species
  // reads the class register before species sets it (class 1), so
  // normals change while positions/species stay put.
  const def = defaultPcgGraph();
  const reordered = [def[0], def[1], def[2], def[3], def[5], def[4]].map((n, i, a) => (i === 0 ? { ...n, input: undefined } : { ...n, input: a[i - 1].id }));
  const swapped = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: serializePcgGraph(reordered) }));
  check('reorder species/align: plan order swapped', evaluatePcgGraph(reordered).transformerOps.join(',') === 'align-normal,species');
  check('reorder species/align: normals change', sha(swapped.normalData) !== sha(legacy.normalData));
  check('reorder species/align: positions unchanged', sha(swapped.data) === sha(legacy.data));
  check('reorder species/align: species channel unchanged', sha(swapped.speciesData) === sha(legacy.speciesData));

  // Sampler disabled: own-cell placement only — positions differ
  // from the resampled legacy bake.
  const noSamplerData = serializePcgGraph(defaultPcgGraph().map((n) => (n.op === 'candidates' ? { ...n, enabled: false } : n)));
  const noSampler = buildGpgpuMorphTargetDataWithNormals(bakeOpts({ ...scatterBase, pcgGraphEnabled: true, pcgGraphData: noSamplerData }));
  check('sampler disabled changes positions', sha(noSampler.data) !== sha(legacy.data));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
