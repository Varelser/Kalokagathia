// Phase 23 — PCG graph editor add / remove operations.
// The editor UI (components/controlPanelPcgGraphEditor.tsx) reshapes
// the node list only through the pure transforms in lib/pcgGraph.ts
// (addPcgNode / removePcgNode / createPcgNode / nextPcgNodeId).
// This test pins their contract: every edit result passes
// validatePcgGraph, references never dangle after a removal, the
// node-count cap / floor are enforced by refusal (null), and the
// default graph is untouched (serialize(default) stays '').
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p23pcg-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { PCG_DEFAULT_GRAPH, PCG_GRAPH_MAX_NODES, defaultPcgGraph, validatePcgGraph, parsePcgGraphData, resolvePcgGraph, isDefaultPcgGraph, serializePcgGraph, nextPcgNodeId, createPcgNode, addPcgNode, removePcgNode } from './lib/pcgGraph.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  PCG_DEFAULT_GRAPH, PCG_GRAPH_MAX_NODES, defaultPcgGraph, validatePcgGraph,
  parsePcgGraphData, resolvePcgGraph, isDefaultPcgGraph, serializePcgGraph,
  nextPcgNodeId, createPcgNode, addPcgNode, removePcgNode,
} = lib;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- id allocation -------------------------------------------------
{
  check('next id: fresh op uses the op name, taken op gets a suffix', nextPcgNodeId([], 'density') === 'density' && nextPcgNodeId(defaultPcgGraph(), 'density') === 'density-2');
  check('next id: suffix increments past taken ids', nextPcgNodeId([...defaultPcgGraph(), { id: 'density-2', kind: 'filter', op: 'density', enabled: true }], 'density') === 'density-3');
}

// --- add -----------------------------------------------------------
{
  const base = defaultPcgGraph();
  const added = addPcgNode(base, 'filter', 'density');
  check('add: returns a list one node longer', added !== null && added.length === base.length + 1);
  check('add: result passes validatePcgGraph', added !== null && eq(validatePcgGraph(added), added));
  check('add: appended at the end with a unique id', added !== null && added[added.length - 1].op === 'density' && added[added.length - 1].id === 'density-2');
  check('add: new node input is the previous last node', added !== null && added[added.length - 1].input === base[base.length - 1].id);
  check('add: new node is enabled', added !== null && added[added.length - 1].enabled === true);
  check('add: original list is not mutated', base.length === 6 && eq(base, defaultPcgGraph()));
  check('add: serialised form resolves back to the same graph', added !== null && eq(resolvePcgGraph(serializePcgGraph(added)), added));

  const first = addPcgNode([], 'sampler', 'candidates');
  check('add: first node on an empty list has no input', first !== null && first.length === 1 && first[0].input === undefined && eq(validatePcgGraph(first), first));

  check('add: every kind/op combination in PCG_NODE_OPS is accepted', [
    ['sampler', 'candidates'],
    ['filter', 'density'], ['filter', 'height-band'], ['filter', 'slope'],
    ['transformer', 'species'], ['transformer', 'align-normal'],
  ].every(([kind, op]) => addPcgNode(defaultPcgGraph(), kind, op) !== null));
  check('add: unknown op for the kind is refused', addPcgNode(base, 'filter', 'candidates') === null && addPcgNode(base, 'sampler', 'density') === null);
  check('add: unknown kind is refused', createPcgNode(base, 'warp', 'density') === null && addPcgNode(base, 'warp', 'density') === null);

  // Cap: fill up to PCG_GRAPH_MAX_NODES, then the next add is refused.
  let full = defaultPcgGraph();
  while (full.length < PCG_GRAPH_MAX_NODES) {
    const next = addPcgNode(full, 'filter', 'slope');
    if (!next) break;
    full = next;
  }
  check(`add: list can be filled to the cap (${PCG_GRAPH_MAX_NODES}) and stays valid`, full.length === PCG_GRAPH_MAX_NODES && eq(validatePcgGraph(full), full));
  check('add: at the cap the edit is refused (null)', addPcgNode(full, 'filter', 'slope') === null);
}

// --- remove --------------------------------------------------------
{
  const base = defaultPcgGraph();
  const removed = removePcgNode(base, 'density');
  check('remove: returns a list one node shorter', removed !== null && removed.length === base.length - 1 && !removed.some((n) => n.id === 'density'));
  check('remove: result passes validatePcgGraph (no dangling reference)', removed !== null && eq(validatePcgGraph(removed), removed));
  check('remove: serialised form resolves back, not a default fallback', removed !== null && eq(resolvePcgGraph(serializePcgGraph(removed)), removed));
  check('remove: following node is re-pointed at its new predecessor', removed !== null && removed.find((n) => n.id === 'height-band')?.input === 'sampler');
  check('remove: inputs form the preceding chain', removed !== null && removed.every((n, i) => (i === 0 ? n.input === undefined : n.input === removed[i - 1].id)));
  check('remove: by index matches remove by id', eq(removePcgNode(base, 1), removed));
  check('remove: original list is not mutated', eq(base, defaultPcgGraph()));

  const headRemoved = removePcgNode(base, 0);
  check('remove: removing the head clears the new head input', headRemoved !== null && headRemoved[0].id === 'density' && headRemoved[0].input === undefined && eq(validatePcgGraph(headRemoved), headRemoved));

  const tailRemoved = removePcgNode(base, base.length - 1);
  check('remove: removing the tail keeps the rest identical', tailRemoved !== null && eq(tailRemoved, base.slice(0, -1)));

  check('remove: unknown id / out-of-range index is refused', removePcgNode(base, 'nope') === null && removePcgNode(base, 99) === null && removePcgNode(base, -1) === null);
  const single = addPcgNode([], 'sampler', 'candidates');
  check('remove: the last remaining node cannot be removed (no empty graph)', single !== null && removePcgNode(single, 0) === null && removePcgNode([], 0) === null);
}

// --- add + remove round trip / default identity --------------------
{
  const added = addPcgNode(defaultPcgGraph(), 'transformer', 'species');
  const back = added && removePcgNode(added, added.length - 1);
  check('round trip: add then remove the added node restores the default graph', back !== null && eq(back, defaultPcgGraph()));
  check('round trip: restored default serialises to the empty key', back !== null && serializePcgGraph(back) === '');
  check('default graph itself is unchanged', PCG_DEFAULT_GRAPH.length === 6 && isDefaultPcgGraph('') && serializePcgGraph(defaultPcgGraph()) === '' && eq(parsePcgGraphData(JSON.stringify(defaultPcgGraph())), defaultPcgGraph()));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
