/**
 * Pipeline persistence (limit plan stage 5, slice S3): the
 * save / load wiring for the pipeline graph — the two
 * representations of one core.
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐A: the graph model is the single internal core;
 *     the row list stays a FULL editing surface, not a
 *     read-only view. A save always writes BOTH
 *     representations, so the round trip
 *     load -> edit -> save -> reload loses nothing.
 *   - 分岐C: the force column and the canvas are two views
 *     of one data, so the force order is part of the same
 *     save, not a separate one.
 *
 * Where the graph lives — a config key, decided in this
 * slice: `gpgpuPipelineGraph` (JSON string, default '').
 * The alternatives were (a) this key and (b) a Designer-style
 * independent localStorage area (lib/designerBlocks.ts).
 * (a) wins because of how the rest of the app carries a
 * configuration: preset records hold a whole config object,
 * and share links carry an inline config snapshot
 * (lib/shareLink.ts, {name, config}), so a config key rides
 * presets and links automatically. The Designer chose
 * localStorage precisely because a composition there is a
 * PARTIAL key set (rules + groups) that must not enter
 * preset records; the pipeline graph is the opposite case —
 * it is the core the row-list representation in the config
 * is compiled from, so leaving it out of the config would
 * make every preset / link silently degrade the graph to
 * its compiled row list. Default '' = no graph = the legacy
 * behaviour, bit for bit (no execution path reads this
 * module in this slice; the wiring is save/load only).
 *
 * The single-core discipline (no silent merging):
 *   - Each editing surface saves through its own function
 *     here, and a save rewrites ALL THREE keys atomically
 *     (graph + live rules + force order). The surface that
 *     saved last is the core; the other representation is
 *     regenerated from it, never merged with it.
 *   - savePipelineGraphToConfig: the graph is the core.
 *     The row-list keys are its compiled form
 *     (lib/pipelineCompiler.ts).
 *   - savePipelineRowListToConfig: the row list (live rules
 *     text + force-order key) is the core. The graph key is
 *     rebuilt from it by the inverse conversion. Content
 *     only the graph can express (fine-grained wiring
 *     beyond the compiled rules) is replaced, not merged —
 *     that is what "last save wins" means, stated openly.
 *   - loadPipelineCore never merges either: a present graph
 *     key is the core; without one, the core is
 *     reconstructed from the row-list keys (the migration
 *     path for every configuration written before this
 *     slice, and for row-list-only saves).
 *   - checkPipelineConfigConsistency is the diagnostic for
 *     the one case the discipline cannot see: a config whose
 *     row-list keys were edited OUTSIDE these save functions
 *     (e.g. the pre-existing row-list UI writing its key
 *     directly) after a graph save. It reports the
 *     divergence; adopting those edits is an explicit call
 *     to savePipelineRowListToConfig, never a silent
 *     load-time merge.
 *
 * Empty means unset: saving an empty graph (no nodes), or
 * an empty row list, produces '' for all three keys — the
 * exact unset configuration (the M1 control of the stage-5
 * gate draft). A graph with nodes that compiles to no rules
 * is NOT empty: its graph key is kept verbatim.
 *
 * Slot assignments (slice S2) are surfaced in the graph
 * save result but NOT written to config here: there is no
 * gpgpuAttrDynExprs key — the dyn channel re-evaluates
 * gpgpuAttrExprs, and writing those expressions plus
 * enabling the dyn pass is execution wiring, which is a
 * later slice's scope. This module never touches the
 * attribute keys.
 */

import {
  parsePipelineGraph,
  serializePipelineGraph,
  validatePipelineGraph,
  PIPELINE_GRAPH_FORMAT,
  type PipelineGraph,
} from './pipelineGraph';
import {
  compilePipelineGraph,
  forceOrderKeyToPipelineGraph,
  liveRulesToPipelineGraph,
  type PipelineCompileIssue,
  type PipelineSlotAssignmentResult,
} from './pipelineCompiler';
import {
  parseLiveParticleRules,
  serializeLiveParticleRules,
} from './gpgpuParticleRulesLive';
import {
  isDefaultGpgpuForceOrder,
  serializeGpgpuForceOrder,
} from './gpgpuForceOrder';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/** The config keys this slice owns. All default ''. */
export interface PipelineConfigSlice {
  gpgpuPipelineGraph?: string;
  gpgpuParticleRulesLive?: string;
  gpgpuForceOrder?: string;
}

/** A complete save: all three keys, always written together. */
export type PipelineConfigPatch = Required<PipelineConfigSlice>;

const UNSET_PATCH: PipelineConfigPatch = {
  gpgpuPipelineGraph: '',
  gpgpuParticleRulesLive: '',
  gpgpuForceOrder: '',
};

export const EMPTY_PIPELINE_GRAPH: PipelineGraph = {
  format: PIPELINE_GRAPH_FORMAT,
  nodes: [],
  edges: [],
};

export function isEmptyPipelineGraph(graph: PipelineGraph): boolean {
  return graph.nodes.length === 0;
}

/** Pure merge of a save patch into a config object. */
export function applyPipelineConfigPatch<T extends PipelineConfigSlice>(
  config: T,
  patch: PipelineConfigPatch,
): T & PipelineConfigPatch {
  return { ...config, ...patch };
}

// ---------------------------------------------------------------------------
// Reconstruction: row list -> graph core (migration / row-list saves)
// ---------------------------------------------------------------------------

/**
 * Rebuild a graph core from the row-list representation:
 * live rules become rule-boxes (slice S2's inverse), and a
 * non-default force order becomes its linear chunk chain.
 * A default order ('' included) contributes NO chain —
 * absence of a chain is how a graph denotes the default
 * order (pipelineGraphToForceOrderKey agrees).
 */
export function pipelineGraphFromRowList(
  liveRulesText?: string | null,
  forceOrderKey?: string | null,
): PipelineGraph {
  const rulesGraph = liveRulesToPipelineGraph(parseLiveParticleRules(liveRulesText ?? ''));
  if (isDefaultGpgpuForceOrder(forceOrderKey ?? '')) return rulesGraph;
  const forceGraph = forceOrderKeyToPipelineGraph(forceOrderKey ?? '');
  return {
    format: PIPELINE_GRAPH_FORMAT,
    nodes: [...rulesGraph.nodes, ...forceGraph.nodes],
    // Both halves mint `seq-<n>` edge ids; prefix the force
    // half's so the merged graph still validates.
    edges: [
      ...rulesGraph.edges,
      ...forceGraph.edges.map((edge) => ({ ...edge, id: `force-${edge.id}` })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Save: graph is the core
// ---------------------------------------------------------------------------

export interface PipelineGraphSaveResult {
  ok: boolean;
  /** Refusal reason when ok is false (no patch is produced). */
  reason?: string;
  patch: PipelineConfigPatch | null;
  issues: PipelineCompileIssue[];
  opaqueNodeIds: string[];
  /** Slot assignment for the wiring slice; not applied here. */
  slots: PipelineSlotAssignmentResult | null;
}

/**
 * The graph-side save (分岐A): writes the graph key and the
 * compiled row-list keys in one patch. An invalid graph is
 * refused wholesale with a reason — a partial save that
 * rewrote the row list from a broken graph would lose data.
 * An empty graph saves as the unset configuration.
 */
export function savePipelineGraphToConfig(
  graph: PipelineGraph,
  current?: {
    attrNames?: readonly string[] | unknown;
    attrNames2?: readonly string[] | unknown;
  },
): PipelineGraphSaveResult {
  const validated = validatePipelineGraph(graph);
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason,
      patch: null,
      issues: [],
      opaqueNodeIds: [],
      slots: null,
    };
  }
  const valid = validated.graph;
  if (isEmptyPipelineGraph(valid)) {
    return {
      ok: true,
      patch: { ...UNSET_PATCH },
      issues: [],
      opaqueNodeIds: [],
      slots: null,
    };
  }
  const compiled = compilePipelineGraph(valid, current);
  return {
    ok: true,
    patch: {
      gpgpuPipelineGraph: serializePipelineGraph(valid),
      gpgpuParticleRulesLive: serializeLiveParticleRules(compiled.rules),
      gpgpuForceOrder: compiled.forceOrderKey,
    },
    issues: compiled.issues,
    opaqueNodeIds: compiled.opaqueNodeIds,
    slots: compiled.slots,
  };
}

// ---------------------------------------------------------------------------
// Save: row list is the core
// ---------------------------------------------------------------------------

export interface PipelineRowListSaveResult {
  patch: PipelineConfigPatch;
  /** The rebuilt graph core (EMPTY_PIPELINE_GRAPH when unset). */
  graph: PipelineGraph;
}

/**
 * The row-list-side save (分岐A: the row list is a full
 * editing surface): the edited row list becomes the core,
 * the graph key is rebuilt from it, and the row-list keys
 * are written back in their canonical serialised form. An
 * empty row list saves as the unset configuration.
 */
export function savePipelineRowListToConfig(
  liveRulesText?: string | null,
  forceOrderKey?: string | null,
): PipelineRowListSaveResult {
  const graph = pipelineGraphFromRowList(liveRulesText, forceOrderKey);
  if (isEmptyPipelineGraph(graph)) {
    return { patch: { ...UNSET_PATCH }, graph };
  }
  return {
    patch: {
      gpgpuPipelineGraph: serializePipelineGraph(graph),
      gpgpuParticleRulesLive: serializeLiveParticleRules(parseLiveParticleRules(liveRulesText ?? '')),
      gpgpuForceOrder: serializeGpgpuForceOrder(forceOrderKey ?? ''),
    },
    graph,
  };
}

// ---------------------------------------------------------------------------
// Load: one core, never a merge
// ---------------------------------------------------------------------------

export type PipelineCoreSource = 'graph' | 'rowlist' | 'empty' | 'invalid-graph';

export interface PipelineLoadResult {
  graph: PipelineGraph;
  source: PipelineCoreSource;
  /** Refusal reason when source is 'invalid-graph'. */
  reason?: string;
}

/**
 * Load the core from a config. A present graph key is the
 * core (an invalid one is reported, not silently replaced
 * by the row list — the caller decides). Without a graph
 * key the core is reconstructed from the row-list keys:
 * source 'rowlist', or 'empty' when nothing is set at all.
 */
export function loadPipelineCore(config: PipelineConfigSlice): PipelineLoadResult {
  const graphText = typeof config.gpgpuPipelineGraph === 'string'
    ? config.gpgpuPipelineGraph
    : '';
  if (graphText.length > 0) {
    const graph = parsePipelineGraph(graphText);
    if (graph !== null) return { graph, source: 'graph' };
    let reason = 'unparseable';
    try {
      const validated = validatePipelineGraph(JSON.parse(graphText));
      if (!validated.ok) reason = validated.reason;
    } catch {
      reason = 'invalid-json';
    }
    return { graph: EMPTY_PIPELINE_GRAPH, source: 'invalid-graph', reason };
  }
  const graph = pipelineGraphFromRowList(
    config.gpgpuParticleRulesLive,
    config.gpgpuForceOrder,
  );
  return isEmptyPipelineGraph(graph)
    ? { graph, source: 'empty' }
    : { graph, source: 'rowlist' };
}

// ---------------------------------------------------------------------------
// Consistency diagnostic (no silent adoption)
// ---------------------------------------------------------------------------

export interface PipelineConsistencyResult {
  /** True when there is no graph key, or the row-list keys
   *  are exactly what the stored graph compiles to. */
  consistent: boolean;
  graphPresent: boolean;
  expectedLiveRules: string;
  actualLiveRules: string;
  expectedForceOrder: string;
  actualForceOrder: string;
}

/**
 * Compare a config's row-list keys against what its stored
 * graph compiles to. Divergence means the row list was
 * edited outside savePipelineGraphToConfig after the graph
 * was saved; adopting that edit is savePipelineRowListToConfig's
 * explicit job, not this diagnostic's.
 */
export function checkPipelineConfigConsistency(
  config: PipelineConfigSlice,
  current?: {
    attrNames?: readonly string[] | unknown;
    attrNames2?: readonly string[] | unknown;
  },
): PipelineConsistencyResult {
  const actualLiveRules = serializeLiveParticleRules(
    parseLiveParticleRules(config.gpgpuParticleRulesLive ?? ''),
  );
  const actualForceOrder = serializeGpgpuForceOrder(config.gpgpuForceOrder ?? '');
  const graphText = typeof config.gpgpuPipelineGraph === 'string'
    ? config.gpgpuPipelineGraph
    : '';
  if (graphText.length === 0) {
    return {
      consistent: true,
      graphPresent: false,
      expectedLiveRules: actualLiveRules,
      actualLiveRules,
      expectedForceOrder: actualForceOrder,
      actualForceOrder,
    };
  }
  const graph = parsePipelineGraph(graphText);
  if (graph === null) {
    return {
      consistent: false,
      graphPresent: true,
      expectedLiveRules: '',
      actualLiveRules,
      expectedForceOrder: '',
      actualForceOrder,
    };
  }
  const compiled = compilePipelineGraph(graph, current);
  const expectedLiveRules = serializeLiveParticleRules(compiled.rules);
  return {
    consistent: expectedLiveRules === actualLiveRules
      && compiled.forceOrderKey === actualForceOrder,
    graphPresent: true,
    expectedLiveRules,
    actualLiveRules,
    expectedForceOrder: compiled.forceOrderKey,
    actualForceOrder,
  };
}
