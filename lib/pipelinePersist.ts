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
 * Slot assignments (slice S2) are APPLIED by the graph
 * save (layer 1 WP2 phase A — the wiring slice the S2/S3
 * headers deferred to): there is no gpgpuAttrDynExprs
 * key — the dyn channel re-evaluates gpgpuAttrExprs — so
 * a claimed slot is written through the EXISTING keys
 * gpgpuAttrNames / gpgpuAttrExprs, in the same patch as
 * the three owned keys. The discipline:
 *   - Only the graph save applies slots. A row-list core
 *     contains no expression / channel-write output
 *     requests, so the row-list save never produces an
 *     attribute patch.
 *   - No assignments -> no attribute keys in the patch
 *     at all: a graph that writes no channels saves
 *     exactly as before this slice, bit for bit.
 *   - A claimed slot is the graph's: its name and (when
 *     the node carries one) its expression win — the
 *     last-save-wins discipline above, scoped to the
 *     claimed slots. An assignment with an EMPTY
 *     expression claims the name but does not erase a
 *     hand-written expression already on that slot: an
 *     empty expression carries no value, and clearing
 *     would be silent data loss.
 *   - Unclaimed slots are preserved from the current
 *     config untouched (names and expressions alike).
 *   - Rejections apply nothing and stay surfaced on the
 *     save result (slots.rejections, carrying the
 *     compiler's reason codes) — never silently dropped.
 *   - A save never flips the dyn / feedback enable keys:
 *     applying writes names + expressions; whether the
 *     dyn channel runs stays the existing
 *     gpgpuAttrDynEnabled / gpgpuAttrFeedbackEnabled
 *     settings, owned by the attribute surface.
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
import { normalizeAttrExprs } from './gpgpuAttributes';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/** The config keys this slice reads and writes. The first
 *  three are owned (all default ''); the attribute pair is
 *  not owned — it is read as the current slot state and
 *  written only when a graph save applies slot claims. */
export interface PipelineConfigSlice {
  gpgpuPipelineGraph?: string;
  gpgpuParticleRulesLive?: string;
  gpgpuForceOrder?: string;
  gpgpuAttrNames?: string[];
  gpgpuAttrExprs?: string[];
}

/** A complete save: the three owned keys, always written
 *  together. The attribute keys are present ONLY when the
 *  saved graph claimed attribute slots (see the header's
 *  slot discipline); their absence means "untouched". */
export type PipelineConfigPatch = {
  gpgpuPipelineGraph: string;
  gpgpuParticleRulesLive: string;
  gpgpuForceOrder: string;
  gpgpuAttrNames?: string[];
  gpgpuAttrExprs?: string[];
};

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
  /** Slot assignment; when it claims slots, the same
   *  assignment is also applied into the patch's
   *  attribute keys. */
  slots: PipelineSlotAssignmentResult | null;
}

/**
 * The config form of a slot assignment: the proposed
 * slot names, and the current expressions with each
 * claimed slot's expression written over them (an empty
 * assignment expression leaves the slot's existing
 * expression in place — see the header). Returns null
 * when the assignment claimed nothing: no attribute
 * keys enter the patch in that case.
 */
export function pipelineSlotAssignmentAttrPatch(
  slots: PipelineSlotAssignmentResult | null,
  currentExprs?: readonly string[] | unknown,
): { gpgpuAttrNames: string[]; gpgpuAttrExprs: string[] } | null {
  if (slots === null || slots.assignments.length === 0) return null;
  const exprs = normalizeAttrExprs(currentExprs);
  for (const assignment of slots.assignments) {
    if (assignment.expr.trim().length > 0) exprs[assignment.slot] = assignment.expr;
  }
  return {
    gpgpuAttrNames: [...slots.names],
    gpgpuAttrExprs: normalizeAttrExprs(exprs),
  };
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
    attrExprs?: readonly string[] | unknown;
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
  const patch: PipelineConfigPatch = {
    gpgpuPipelineGraph: serializePipelineGraph(valid),
    gpgpuParticleRulesLive: serializeLiveParticleRules(compiled.rules),
    gpgpuForceOrder: compiled.forceOrderKey,
  };
  const attrPatch = pipelineSlotAssignmentAttrPatch(compiled.slots, current?.attrExprs);
  if (attrPatch !== null) {
    patch.gpgpuAttrNames = attrPatch.gpgpuAttrNames;
    patch.gpgpuAttrExprs = attrPatch.gpgpuAttrExprs;
  }
  return {
    ok: true,
    patch,
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
