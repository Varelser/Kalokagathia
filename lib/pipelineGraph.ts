/**
 * Pipeline graph core (limit plan stage 5, slice S1): the pure
 * graph model behind the wiring canvas, its node-definition
 * registry and its type checker. Pure functions only — no UI,
 * no config keys, no execution-path wiring (later slices).
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐A: the graph is the single internal core; the row
 *     list stays a full editing surface, both representations
 *     are saved and round-trip without loss.
 *   - 分岐B: hierarchy — a rule row is one `rule-box` node
 *     that expands into fine-grained condition / math / action
 *     nodes and collapses back into the box.
 *   - 分岐D: strict types. The only implicit conversions are
 *     Bool -> Scalar and StateId -> Scalar. Anything else is
 *     never converted silently: the type checker returns a
 *     structured proposal to insert a visible conversion node.
 *
 * Design materials: STAGE5_DESIGN_MATERIALS.md §2 (value
 * types), §3 (node candidates), §8.5 (P1 extension results:
 * Logic nodes are a compiler lowering, not expression-engine
 * operators — And -> product of factors, Or -> clamped sum,
 * Not -> (1.0 - factor); the expression engine gains no
 * && / || operators).
 *
 * Validation discipline mirrors lib/designerBlocks.ts: a
 * stored graph is refused wholesale with a reason string
 * (format mismatch, missing edge endpoint, duplicate id,
 * cycle) instead of being partially applied. Evaluation
 * order is deterministic: topological order, ties broken by
 * document order.
 *
 * Compatibility: designer-blocks-v1 compositions
 * (lib/designerBlocks.ts) convert into this model and back
 * without loss (for the node kinds the designer model has).
 * This module is additive only: nothing in the render, save
 * or rule-evaluation paths reads it yet.
 *
 * Cluster grammar (layer 1 WP10 phase D2, added later):
 * a `cluster` node encapsulates a subgraph (params.graph,
 * a full pipeline-graph-v1 document) behind typed ports
 * declared by the subgraph's `cluster-input` /
 * `cluster-output` boundary nodes. Validation checks the
 * embedded document recursively; the compiler inlines
 * clusters before evaluating. The grammar lives inside
 * the graph document alone — no config key is added —
 * and takes no position on the TD §7 component question.
 */

import { GPGPU_FORCE_CHUNK_NAMES } from './gpgpuForceOrder';
import {
  validateDesignerBlockModel,
  type DesignerBlockModel,
} from './designerBlocks';

// ---------------------------------------------------------------------------
// Value types (DESIGN §2)
// ---------------------------------------------------------------------------

export type PipelineValueType =
  | 'Scalar'
  | 'Vec3'
  | 'Bool'
  | 'StateId'
  | 'Mask'
  | 'Group'
  | 'Display';

export const PIPELINE_VALUE_TYPES: readonly PipelineValueType[] = [
  'Scalar', 'Vec3', 'Bool', 'StateId', 'Mask', 'Group', 'Display',
];

/** The only sanctioned implicit conversions (分岐D). */
export const PIPELINE_IMPLICIT_CONVERSIONS: readonly (readonly [PipelineValueType, PipelineValueType])[] = [
  ['Bool', 'Scalar'],
  ['StateId', 'Scalar'],
];

export function isPipelineImplicitConversion(
  from: PipelineValueType,
  to: PipelineValueType,
): boolean {
  return PIPELINE_IMPLICIT_CONVERSIONS.some(([f, t]) => f === from && t === to);
}

// ---------------------------------------------------------------------------
// Node definition registry (DESIGN §3)
// ---------------------------------------------------------------------------

export interface PipelinePortDef {
  name: string;
  type: PipelineValueType;
  /** When true, many edges may land on this one port. */
  variadic?: boolean;
  /** When false the port may stay unconnected (default true). */
  required?: boolean;
}

export type PipelineNodeCategory =
  | 'source'
  | 'condition'
  | 'math'
  | 'logic'
  | 'conversion'
  | 'action'
  | 'pipeline'
  | 'container';

export interface PipelineNodeDef {
  kind: string;
  category: PipelineNodeCategory;
  label: string;
  inputs: readonly PipelinePortDef[];
  outputs: readonly PipelinePortDef[];
}

const port = (
  name: string,
  type: PipelineValueType,
  extra?: Partial<PipelinePortDef>,
): PipelinePortDef => ({ name, type, ...(extra ?? {}) });

const COND_IN = port('condition', 'Bool', { required: false });
const TARGET_IN = port('target', 'Group', { required: false });
const MASK_OUT = port('mask', 'Mask');

function defineRegistry(defs: PipelineNodeDef[]): Readonly<Record<string, PipelineNodeDef>> {
  const out: Record<string, PipelineNodeDef> = {};
  for (const def of defs) out[def.kind] = def;
  return Object.freeze(out);
}

export const PIPELINE_NODE_DEFINITIONS: Readonly<Record<string, PipelineNodeDef>> =
  defineRegistry([
    // -- sources -------------------------------------------------------------
    { kind: 'pool-source', category: 'source', label: 'Particle Pool', inputs: [], outputs: [port('group', 'Group')] },
    { kind: 'group-def', category: 'source', label: 'Group', inputs: [], outputs: [port('group', 'Group')] },
    { kind: 'constant', category: 'source', label: 'Constant', inputs: [], outputs: [port('value', 'Scalar')] },
    {
      kind: 'sim-var', category: 'source', label: 'Sim Variable',
      inputs: [], outputs: [port('value', 'Scalar'), port('vec', 'Vec3')],
    },
    { kind: 'slot-read', category: 'source', label: 'Slot Read', inputs: [], outputs: [port('value', 'Scalar')] },
    {
      kind: 'hit', category: 'source', label: 'Contact',
      inputs: [], outputs: [port('hit', 'Bool'), port('hits', 'Scalar')],
    },
    // -- container (分岐B) -----------------------------------------------------
    {
      kind: 'rule-box', category: 'container', label: 'Rule',
      inputs: [TARGET_IN, COND_IN], outputs: [MASK_OUT],
    },
    // -- conditions ------------------------------------------------------------
    {
      kind: 'expression', category: 'condition', label: 'Expression',
      inputs: [port('in', 'Scalar', { variadic: true, required: false })],
      outputs: [port('value', 'Scalar'), port('bool', 'Bool')],
    },
    {
      kind: 'compare', category: 'condition', label: 'Compare',
      inputs: [port('a', 'Scalar'), port('b', 'Scalar')], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'band', category: 'condition', label: 'Band',
      inputs: [port('value', 'Scalar')], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'state-is', category: 'condition', label: 'State Is',
      inputs: [port('state', 'StateId')], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'group-is', category: 'condition', label: 'Group Is',
      inputs: [port('group', 'Group')], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'group-aggregate', category: 'condition', label: 'Group Aggregate',
      inputs: [port('group', 'Group')],
      outputs: [port('value', 'Scalar'), port('centroid', 'Vec3')],
    },
    {
      kind: 'prev', category: 'condition', label: 'Previous Value',
      inputs: [port('value', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    // -- logic (lowered by the compiler, DESIGN §8.5) -------------------------
    {
      kind: 'logic-and', category: 'logic', label: 'And',
      inputs: [port('in', 'Bool', { variadic: true })], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'logic-or', category: 'logic', label: 'Or',
      inputs: [port('in', 'Bool', { variadic: true })], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'logic-not', category: 'logic', label: 'Not',
      inputs: [port('in', 'Bool')], outputs: [port('result', 'Bool')],
    },
    {
      kind: 'logic-xor', category: 'logic', label: 'Xor',
      inputs: [port('a', 'Bool'), port('b', 'Bool')], outputs: [port('result', 'Bool')],
    },
    // -- math -------------------------------------------------------------------
    ...(['add', 'sub', 'mul', 'div', 'mod', 'pow'] as const).map((op): PipelineNodeDef => ({
      kind: `math-${op}`, category: 'math', label: `Math ${op}`,
      inputs: [port('a', 'Scalar'), port('b', 'Scalar')], outputs: [port('value', 'Scalar')],
    })),
    {
      kind: 'math-neg', category: 'math', label: 'Math neg',
      inputs: [port('a', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'math-func', category: 'math', label: 'Math Function',
      inputs: [port('a', 'Scalar'), port('b', 'Scalar', { required: false })],
      outputs: [port('value', 'Scalar')],
    },
    ...(['min', 'max'] as const).map((op): PipelineNodeDef => ({
      kind: `math-${op}`, category: 'math', label: `Math ${op}`,
      inputs: [port('a', 'Scalar'), port('b', 'Scalar')], outputs: [port('value', 'Scalar')],
    })),
    {
      kind: 'math-clamp', category: 'math', label: 'Math clamp',
      inputs: [port('value', 'Scalar'), port('low', 'Scalar'), port('high', 'Scalar')],
      outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'math-lerp', category: 'math', label: 'Math lerp',
      inputs: [port('a', 'Scalar'), port('b', 'Scalar'), port('t', 'Scalar')],
      outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'math-smoothstep', category: 'math', label: 'Math smoothstep',
      inputs: [port('edge0', 'Scalar'), port('edge1', 'Scalar'), port('x', 'Scalar')],
      outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'math-ternary', category: 'math', label: 'Ternary',
      inputs: [port('condition', 'Bool'), port('a', 'Scalar'), port('b', 'Scalar')],
      outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'map-range', category: 'math', label: 'Map Range',
      inputs: [port('value', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'quantize', category: 'math', label: 'Quantize',
      inputs: [port('value', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'saturate', category: 'math', label: 'Saturate',
      inputs: [port('value', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'channel-read', category: 'math', label: 'Channel Read',
      inputs: [], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'channel-write', category: 'math', label: 'Channel Write',
      inputs: [port('value', 'Scalar')], outputs: [port('value', 'Scalar')],
    },
    // -- conversions (explicit, visible nodes — 分岐D) -------------------------
    {
      kind: 'vec-length', category: 'conversion', label: 'Length',
      inputs: [port('vec', 'Vec3')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'vec-normalize', category: 'conversion', label: 'Normalize',
      inputs: [port('vec', 'Vec3')], outputs: [port('vec', 'Vec3')],
    },
    {
      kind: 'vec-split', category: 'conversion', label: 'Split Vec3',
      inputs: [port('vec', 'Vec3')],
      outputs: [port('x', 'Scalar'), port('y', 'Scalar'), port('z', 'Scalar')],
    },
    {
      kind: 'vec-make', category: 'conversion', label: 'Make Vec3',
      inputs: [port('x', 'Scalar'), port('y', 'Scalar'), port('z', 'Scalar')],
      outputs: [port('vec', 'Vec3')],
    },
    {
      kind: 'vec-dot', category: 'conversion', label: 'Dot',
      inputs: [port('a', 'Vec3'), port('b', 'Vec3')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'vec-cross', category: 'conversion', label: 'Cross',
      inputs: [port('a', 'Vec3'), port('b', 'Vec3')], outputs: [port('vec', 'Vec3')],
    },
    {
      kind: 'bool-to-scalar', category: 'conversion', label: 'Bool to Scalar',
      inputs: [port('value', 'Bool')], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'state-to-scalar', category: 'conversion', label: 'StateId to Scalar',
      inputs: [port('value', 'StateId')], outputs: [port('value', 'Scalar')],
    },
    // -- actions ------------------------------------------------------------------
    {
      kind: 'force-gate', category: 'action', label: 'Force Gate',
      inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT],
    },
    {
      kind: 'set-state', category: 'action', label: 'Set State',
      inputs: [COND_IN, TARGET_IN, port('state', 'StateId', { required: false })],
      outputs: [MASK_OUT],
    },
    {
      kind: 'set-group', category: 'action', label: 'Set Group',
      inputs: [COND_IN, port('group', 'Group', { required: false })], outputs: [MASK_OUT],
    },
    { kind: 'kill', category: 'action', label: 'Kill', inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT] },
    { kind: 'true-kill', category: 'action', label: 'True Kill', inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT] },
    { kind: 'fracture', category: 'action', label: 'Fracture', inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT] },
    { kind: 'spawn', category: 'action', label: 'Spawn', inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT] },
    { kind: 'custom-force', category: 'action', label: 'Custom Force', inputs: [COND_IN, TARGET_IN], outputs: [MASK_OUT] },
    {
      kind: 'display', category: 'action', label: 'Display',
      inputs: [COND_IN, TARGET_IN, port('size', 'Scalar', { required: false })],
      outputs: [port('display', 'Display')],
    },
    // -- pipeline operators -------------------------------------------------------
    {
      kind: 'force-chunk', category: 'pipeline', label: 'Force Chunk',
      inputs: [port('velocity', 'Vec3')], outputs: [port('velocity', 'Vec3')],
    },
    // -- opaque (stage 5 slice S2) ------------------------------------------------
    // A kept-but-uncompiled element: the compiler carries it
    // verbatim (params.rawRule) instead of dropping it, the
    // same discipline as the grammar's parse-but-unconsumed
    // actions. No ports: nothing may wire through it.
    { kind: 'opaque', category: 'container', label: 'Opaque', inputs: [], outputs: [] },
    // -- cluster (layer 1 WP10 phase D2: cluster grammar) -------------------------
    // An encapsulation node (the GH cluster / node-group
    // shape): the subgraph rides verbatim in params.graph
    // (a pipeline-graph-v1 document) and the node's typed
    // ports are the subgraph's boundary nodes, so the port
    // list is dynamic and this registry entry declares
    // none — effective ports resolve through
    // pipelineNodePorts. The compiler inlines clusters
    // before evaluating (expandPipelineGraphClusters).
    // The grammar lives inside the graph document alone:
    // no config key is added. This is layer-1 grammar
    // only; it takes no position on the TD §7 component
    // question (a separate, still-open decision).
    { kind: 'cluster', category: 'container', label: 'Cluster', inputs: [], outputs: [] },
    // Boundary nodes of a cluster subgraph. Each declares
    // one cluster port through params {name, type}; the
    // single `value` port below is the registry-side shape
    // only — its effective type is the declared params
    // type (see pipelineNodePorts).
    {
      kind: 'cluster-input', category: 'source', label: 'Cluster Input',
      inputs: [], outputs: [port('value', 'Scalar')],
    },
    {
      kind: 'cluster-output', category: 'pipeline', label: 'Cluster Output',
      inputs: [port('value', 'Scalar')], outputs: [],
    },
  ]);

export function pipelineNodeDefinition(kind: string): PipelineNodeDef | null {
  return PIPELINE_NODE_DEFINITIONS[kind] ?? null;
}

export function pipelinePortType(
  kind: string,
  direction: 'input' | 'output',
  portName: string,
): PipelineValueType | null {
  const def = pipelineNodeDefinition(kind);
  if (!def) return null;
  const ports = direction === 'input' ? def.inputs : def.outputs;
  return ports.find((p) => p.name === portName)?.type ?? null;
}

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

export const PIPELINE_GRAPH_FORMAT = 'pipeline-graph-v1';
export const PIPELINE_GRAPH_MAX_NODES = 256;
export const PIPELINE_GRAPH_MAX_EDGES = 1024;

export type PipelineEdgeKind = 'flow' | 'data' | 'sequence' | 'reference' | 'composite';

export interface PipelineGraphNode {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  params?: Record<string, unknown>;
  /** Fine-grained node ids contained in a rule-box (分岐B). */
  children?: string[];
  /** Kept-but-never-matching reference, as in designer blocks. */
  dangling?: boolean;
}

export interface PipelineGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: PipelineEdgeKind;
  fromPort?: string;
  toPort?: string;
}

export interface PipelineGraph {
  format: typeof PIPELINE_GRAPH_FORMAT;
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
}

const NODE_ID_RE = /^[A-Za-z0-9:._-]{1,96}$/;
const EDGE_KINDS: readonly string[] = ['flow', 'data', 'sequence', 'reference', 'composite'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Validation (refuse wholesale, with a reason)
// ---------------------------------------------------------------------------

export type PipelineGraphValidation =
  | { ok: true; graph: PipelineGraph }
  | { ok: false; reason: string };

function validateNode(raw: unknown): PipelineGraphNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !NODE_ID_RE.test(raw.id)) return null;
  if (typeof raw.kind !== 'string' || !PIPELINE_NODE_DEFINITIONS[raw.kind]) return null;
  if (typeof raw.label !== 'string' || raw.label.length === 0 || raw.label.length > 120) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (raw.params !== undefined && !isRecord(raw.params)) return null;
  if (raw.dangling !== undefined && typeof raw.dangling !== 'boolean') return null;
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children)) return null;
    if (!raw.children.every((c) => typeof c === 'string' && NODE_ID_RE.test(c))) return null;
  }
  // Cluster family shapes (WP10 D2): a boundary node must
  // declare its port (name + value type) in params, and a
  // cluster node must carry an embedded graph document
  // (validated recursively by validatePipelineGraph).
  if (raw.kind === 'cluster-input' || raw.kind === 'cluster-output') {
    if (!isRecord(raw.params)) return null;
    if (typeof raw.params.name !== 'string' || !CLUSTER_PORT_NAME_RE.test(raw.params.name)) {
      return null;
    }
    if (typeof raw.params.type !== 'string'
      || !(PIPELINE_VALUE_TYPES as readonly string[]).includes(raw.params.type)) {
      return null;
    }
  }
  if (raw.kind === 'cluster') {
    if (!isRecord(raw.params) || !isRecord(raw.params.graph)) return null;
  }
  const node: PipelineGraphNode = {
    id: raw.id,
    kind: raw.kind,
    label: raw.label,
    enabled: raw.enabled === undefined ? true : raw.enabled,
  };
  if (raw.params !== undefined) node.params = raw.params;
  if (raw.children !== undefined) node.children = [...(raw.children as string[])];
  if (raw.dangling === true) node.dangling = true;
  return node;
}

export function validatePipelineGraph(raw: unknown): PipelineGraphValidation {
  return validateGraphAtDepth(raw, 0);
}

function validateGraphAtDepth(raw: unknown, depth: number): PipelineGraphValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'not-an-object' };
  if (raw.format !== PIPELINE_GRAPH_FORMAT) return { ok: false, reason: 'format-mismatch' };
  if (!Array.isArray(raw.nodes)) return { ok: false, reason: 'nodes-not-array' };
  if (!Array.isArray(raw.edges)) return { ok: false, reason: 'edges-not-array' };
  if (raw.nodes.length > PIPELINE_GRAPH_MAX_NODES) return { ok: false, reason: 'too-many-nodes' };
  if (raw.edges.length > PIPELINE_GRAPH_MAX_EDGES) return { ok: false, reason: 'too-many-edges' };

  const nodes: PipelineGraphNode[] = [];
  const nodeIds = new Set<string>();
  for (const rawNode of raw.nodes) {
    const node = validateNode(rawNode);
    if (!node) return { ok: false, reason: 'invalid-node' };
    if (nodeIds.has(node.id)) return { ok: false, reason: 'duplicate-node-id' };
    nodeIds.add(node.id);
    nodes.push(node);
  }

  // Rule-box children must exist, be unique across boxes and
  // never contain the box itself (分岐B hierarchy discipline).
  const claimedChildren = new Set<string>();
  for (const node of nodes) {
    if (!node.children) continue;
    for (const childId of node.children) {
      if (childId === node.id) return { ok: false, reason: 'child-self-reference' };
      if (!nodeIds.has(childId)) return { ok: false, reason: 'child-node-missing' };
      if (claimedChildren.has(childId)) return { ok: false, reason: 'child-claimed-twice' };
      claimedChildren.add(childId);
    }
  }

  const edges: PipelineGraphEdge[] = [];
  const edgeIds = new Set<string>();
  for (const rawEdge of raw.edges) {
    if (!isRecord(rawEdge)) return { ok: false, reason: 'invalid-edge' };
    if (typeof rawEdge.id !== 'string' || rawEdge.id.length === 0 || rawEdge.id.length > 96) {
      return { ok: false, reason: 'invalid-edge' };
    }
    if (edgeIds.has(rawEdge.id)) return { ok: false, reason: 'duplicate-edge-id' };
    if (typeof rawEdge.kind !== 'string' || !EDGE_KINDS.includes(rawEdge.kind)) {
      return { ok: false, reason: 'invalid-edge' };
    }
    if (typeof rawEdge.from !== 'string' || typeof rawEdge.to !== 'string'
      || !nodeIds.has(rawEdge.from) || !nodeIds.has(rawEdge.to)) {
      return { ok: false, reason: 'edge-endpoint-missing' };
    }
    if (rawEdge.fromPort !== undefined && typeof rawEdge.fromPort !== 'string') {
      return { ok: false, reason: 'invalid-edge' };
    }
    if (rawEdge.toPort !== undefined && typeof rawEdge.toPort !== 'string') {
      return { ok: false, reason: 'invalid-edge' };
    }
    edgeIds.add(rawEdge.id);
    const edge: PipelineGraphEdge = {
      id: rawEdge.id,
      from: rawEdge.from,
      to: rawEdge.to,
      kind: rawEdge.kind as PipelineEdgeKind,
    };
    if (rawEdge.fromPort !== undefined) edge.fromPort = rawEdge.fromPort;
    if (rawEdge.toPort !== undefined) edge.toPort = rawEdge.toPort;
    edges.push(edge);
  }

  // Cluster discipline (WP10 D2): the embedded graph must
  // itself validate (recursively, nesting depth-capped),
  // its boundary port names must be unique per direction,
  // and the ids the compiler's inline expansion will mint
  // (`<clusterId>:<innerId>`) must not collide with ids
  // already present at this level.
  for (const node of nodes) {
    if (node.kind !== 'cluster') continue;
    if (depth >= PIPELINE_CLUSTER_MAX_DEPTH) {
      return { ok: false, reason: 'cluster-too-deep' };
    }
    const embedded = validateGraphAtDepth(
      (node.params as Record<string, unknown>).graph,
      depth + 1,
    );
    if (!embedded.ok) {
      return { ok: false, reason: `invalid-cluster-graph:${embedded.reason}` };
    }
    const seenIn = new Set<string>();
    const seenOut = new Set<string>();
    for (const inner of embedded.graph.nodes) {
      const bp = pipelineClusterBoundaryPort(inner);
      if (bp) {
        const seen = inner.kind === 'cluster-input' ? seenIn : seenOut;
        if (seen.has(bp.name)) return { ok: false, reason: 'cluster-port-duplicate' };
        seen.add(bp.name);
      }
      if (nodeIds.has(`${node.id}:${inner.id}`)) {
        return { ok: false, reason: 'cluster-id-collision' };
      }
    }
    for (const innerEdge of embedded.graph.edges) {
      if (edgeIds.has(`${node.id}:${innerEdge.id}`)) {
        return { ok: false, reason: 'cluster-id-collision' };
      }
    }
  }

  const graph: PipelineGraph = { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
  if (topologicalOrderPipelineGraph(graph) === null) {
    return { ok: false, reason: 'cycle-detected' };
  }
  return { ok: true, graph };
}

export function serializePipelineGraph(graph: PipelineGraph): string {
  const result = validatePipelineGraph(graph);
  if (!result.ok) {
    throw new Error(`pipeline graph: cannot serialise invalid graph (${result.reason})`);
  }
  return JSON.stringify(result.graph);
}

export function parsePipelineGraph(text: string | null | undefined): PipelineGraph | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = validatePipelineGraph(parsed);
  return result.ok ? result.graph : null;
}

// ---------------------------------------------------------------------------
// Evaluation order: topological, document order breaks ties
// ---------------------------------------------------------------------------

/**
 * Deterministic evaluation order. Repeatedly emits the
 * earliest node in document order whose predecessors have all
 * been emitted, so the result depends only on the graph
 * document itself. Returns null on a cycle.
 */
export function topologicalOrderPipelineGraph(graph: PipelineGraph): string[] | null {
  const ids = graph.nodes.map((n) => n.id);
  const predecessors = new Map<string, Set<string>>();
  for (const id of ids) predecessors.set(id, new Set());
  for (const edge of graph.edges) {
    if (edge.from === edge.to) return null;
    predecessors.get(edge.to)?.add(edge.from);
  }
  const emitted = new Set<string>();
  const order: string[] = [];
  while (order.length < ids.length) {
    const next = ids.find(
      (id) => !emitted.has(id)
        && [...(predecessors.get(id) ?? [])].every((p) => emitted.has(p)),
    );
    if (next === undefined) return null;
    emitted.add(next);
    order.push(next);
  }
  return order;
}

// ---------------------------------------------------------------------------
// Type checker (分岐D): never convert silently — propose a node
// ---------------------------------------------------------------------------

export interface PipelineConversionProposal {
  edgeId: string;
  fromType: PipelineValueType;
  toType: PipelineValueType;
  /** Node kinds to insert, in wire order; empty when none is known. */
  insertNodeKinds: string[];
  reason: string;
}

export type PipelineTypeIssueStatus = 'ok' | 'implicit' | 'proposal' | 'unknown-port';

export interface PipelineTypeIssue {
  edgeId: string;
  status: PipelineTypeIssueStatus;
  fromType: PipelineValueType | null;
  toType: PipelineValueType | null;
  proposal?: PipelineConversionProposal;
}

export interface PipelineTypeCheck {
  ok: boolean;
  issues: PipelineTypeIssue[];
  proposals: PipelineConversionProposal[];
}

const CONVERSION_PROPOSALS: Readonly<Record<string, { kinds: string[]; reason: string }>> = {
  'Vec3->Scalar': { kinds: ['vec-length'], reason: 'Vec3 has no scalar value; insert a Length node' },
  'Vec3->Bool': { kinds: ['vec-length', 'compare'], reason: 'Reduce Vec3 with Length, then Compare to a threshold' },
  'Scalar->Vec3': { kinds: ['vec-make'], reason: 'Broadcast a Scalar into a Vec3 with a Make Vec3 node' },
  'Scalar->Bool': { kinds: ['compare'], reason: 'Compare the Scalar against a threshold to get a Bool' },
  'Bool->Vec3': { kinds: ['bool-to-scalar', 'vec-make'], reason: 'Convert Bool to Scalar explicitly, then Make Vec3' },
  'StateId->Bool': { kinds: ['state-is'], reason: 'Test a StateId with a State Is node' },
  'Group->Scalar': { kinds: ['group-aggregate'], reason: 'Aggregate the Group to a Scalar first' },
  'Group->Bool': { kinds: ['group-is'], reason: 'Test Group membership with a Group Is node' },
};

function defaultPortOf(
  node: PipelineGraphNode,
  direction: 'input' | 'output',
): string | null {
  const ports = pipelineNodePorts(node, direction);
  return ports.length > 0 ? ports[0].name : null;
}

/**
 * Check every data edge whose ports resolve. Flow / sequence
 * edges carry ordering only and are skipped. An edge whose
 * types differ is NOT rewritten: the result carries a
 * structured insertion proposal for the editor to show.
 */
export function checkPipelineGraphTypes(graph: PipelineGraph): PipelineTypeCheck {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const issues: PipelineTypeIssue[] = [];
  const proposals: PipelineConversionProposal[] = [];
  let ok = true;

  for (const edge of graph.edges) {
    if (edge.kind !== 'data') continue;
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!fromNode || !toNode) continue; // validation refuses these earlier
    const fromPort = edge.fromPort ?? defaultPortOf(fromNode, 'output');
    const toPort = edge.toPort ?? defaultPortOf(toNode, 'input');
    const fromType = fromPort ? pipelineNodePortType(fromNode, 'output', fromPort) : null;
    const toType = toPort ? pipelineNodePortType(toNode, 'input', toPort) : null;
    if (fromType === null || toType === null) {
      ok = false;
      issues.push({ edgeId: edge.id, status: 'unknown-port', fromType, toType });
      continue;
    }
    if (fromType === toType) {
      issues.push({ edgeId: edge.id, status: 'ok', fromType, toType });
      continue;
    }
    if (isPipelineImplicitConversion(fromType, toType)) {
      issues.push({ edgeId: edge.id, status: 'implicit', fromType, toType });
      continue;
    }
    const known = CONVERSION_PROPOSALS[`${fromType}->${toType}`];
    const proposal: PipelineConversionProposal = {
      edgeId: edge.id,
      fromType,
      toType,
      insertNodeKinds: known ? [...known.kinds] : [],
      reason: known
        ? known.reason
        : `No known conversion node from ${fromType} to ${toType}; rewire or add one explicitly`,
    };
    ok = false;
    proposals.push(proposal);
    issues.push({ edgeId: edge.id, status: 'proposal', fromType, toType, proposal });
  }
  return { ok, issues, proposals };
}

// ---------------------------------------------------------------------------
// Logic lowering (DESIGN §8.5): compiler lowering, no new
// expression operators. Leaves are parenthesised factors.
// ---------------------------------------------------------------------------

export type PipelineLogicTree =
  | { logic: 'leaf'; expr: string }
  | { logic: 'and' | 'or'; args: PipelineLogicTree[] }
  | { logic: 'not'; arg: PipelineLogicTree }
  | { logic: 'xor'; args: readonly [PipelineLogicTree, PipelineLogicTree] };

export function lowerLogicTreeToExpression(tree: PipelineLogicTree): string {
  switch (tree.logic) {
    case 'leaf':
      return `(${tree.expr})`;
    case 'and':
      return tree.args.map(lowerLogicTreeToExpression).join(' * ');
    case 'or':
      return `clamp(${tree.args.map(lowerLogicTreeToExpression).join(' + ')}, 0.0, 1.0)`;
    case 'not':
      return `(1.0 - ${lowerLogicTreeToExpression(tree.arg)})`;
    case 'xor': {
      const a = lowerLogicTreeToExpression(tree.args[0]);
      const b = lowerLogicTreeToExpression(tree.args[1]);
      return `((${a} * (1.0 - ${b})) + ((1.0 - ${a}) * ${b}))`;
    }
  }
}

/** The same lowering for one logic node's already-lowered inputs. */
export function lowerLogicNodeToExpression(
  kind: string,
  inputExprs: readonly string[],
): string | null {
  const leaf = (expr: string): PipelineLogicTree => ({ logic: 'leaf', expr });
  switch (kind) {
    case 'logic-and':
      return lowerLogicTreeToExpression({ logic: 'and', args: inputExprs.map(leaf) });
    case 'logic-or':
      return lowerLogicTreeToExpression({ logic: 'or', args: inputExprs.map(leaf) });
    case 'logic-not':
      return inputExprs.length === 1
        ? lowerLogicTreeToExpression({ logic: 'not', arg: leaf(inputExprs[0]) })
        : null;
    case 'logic-xor':
      return inputExprs.length === 2
        ? lowerLogicTreeToExpression({
          logic: 'xor',
          args: [leaf(inputExprs[0]), leaf(inputExprs[1])],
        })
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rule-box expansion / collapse (分岐B)
// ---------------------------------------------------------------------------

const RULE_BOX_ACTION_KINDS: readonly string[] = [
  'force-gate', 'set-state', 'set-group', 'kill', 'true-kill',
  'fracture', 'display', 'spawn', 'custom-force',
];

/**
 * Expand one rule-box node into its fine-grained fragment:
 * an Expression node holding the box's condition text and an
 * action node of the box's action kind, wired condition ->
 * action. The box's remaining params travel on the action
 * node so collapse can rebuild the box exactly.
 */
export function expandRuleBoxNode(node: PipelineGraphNode): {
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
} | null {
  if (node.kind !== 'rule-box') return null;
  const params = node.params ?? {};
  const condition = typeof params.condition === 'string' ? params.condition : '';
  const actionKind = typeof params.actionKind === 'string'
    && RULE_BOX_ACTION_KINDS.includes(params.actionKind)
    ? params.actionKind
    : 'force-gate';
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'condition' && key !== 'actionKind') rest[key] = value;
  }
  const condId = `${node.id}:cond`;
  const actionId = `${node.id}:action`;
  const condDef = PIPELINE_NODE_DEFINITIONS.expression;
  return {
    nodes: [
      {
        id: condId, kind: 'expression', label: condDef.label,
        enabled: node.enabled, params: { expr: condition },
      },
      {
        id: actionId, kind: actionKind, label: node.label,
        enabled: node.enabled, params: rest,
      },
    ],
    edges: [{
      id: `${node.id}:cond-edge`, from: condId, to: actionId,
      kind: 'data', fromPort: 'bool', toPort: 'condition',
    }],
  };
}

/**
 * Expand every rule-box in a graph. Edges that touched the
 * box are rewired to its action node (the box's Mask output
 * and its condition / target inputs all live there once the
 * condition is an explicit node feeding it).
 */
export function expandPipelineGraph(graph: PipelineGraph): PipelineGraph {
  const nodes: PipelineGraphNode[] = [];
  const edges: PipelineGraphEdge[] = [];
  const actionIdOf = new Map<string, string>();
  for (const node of graph.nodes) {
    const fragment = expandRuleBoxNode(node);
    if (!fragment) {
      nodes.push(node);
      continue;
    }
    actionIdOf.set(node.id, `${node.id}:action`);
    nodes.push(...fragment.nodes);
    edges.push(...fragment.edges);
  }
  for (const edge of graph.edges) {
    edges.push({
      ...edge,
      from: actionIdOf.get(edge.from) ?? edge.from,
      to: actionIdOf.get(edge.to) ?? edge.to,
    });
  }
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

/**
 * Inverse of expandPipelineGraph for one box: rebuilds the
 * rule-box from its `:cond` / `:action` fragment nodes.
 * Returns null when the fragment is not present.
 */
export function collapseRuleBox(
  graph: PipelineGraph,
  boxId: string,
): PipelineGraph | null {
  const condId = `${boxId}:cond`;
  const actionId = `${boxId}:action`;
  const cond = graph.nodes.find((n) => n.id === condId && n.kind === 'expression');
  const action = graph.nodes.find(
    (n) => n.id === actionId && RULE_BOX_ACTION_KINDS.includes(n.kind),
  );
  if (!cond || !action) return null;
  const params: Record<string, unknown> = { ...(action.params ?? {}) };
  params.condition = typeof cond.params?.expr === 'string' ? cond.params.expr : '';
  params.actionKind = action.kind;
  const box: PipelineGraphNode = {
    id: boxId, kind: 'rule-box', label: action.label, enabled: action.enabled,
    params,
  };
  const nodes = graph.nodes
    .filter((n) => n.id !== condId && n.id !== actionId)
    .map((n) => n); // keep document order of the survivors
  // The box takes the fragment's place (position of :cond).
  const condIndex = graph.nodes.findIndex((n) => n.id === condId);
  const insertAt = nodes.filter(
    (_, i) => graph.nodes.indexOf(nodes[i]) < condIndex,
  ).length;
  nodes.splice(insertAt, 0, box);
  const edges = graph.edges
    .filter((e) => !(e.from === condId && e.to === actionId))
    .map((e) => ({
      ...e,
      from: e.from === actionId ? boxId : e.from,
      to: e.to === actionId ? boxId : e.to,
    }));
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

// ---------------------------------------------------------------------------
// Cluster grammar (layer 1 WP10 phase D2)
// ---------------------------------------------------------------------------

/** Maximum cluster nesting depth a stored document may use. */
export const PIPELINE_CLUSTER_MAX_DEPTH = 8;

const CLUSTER_PORT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface PipelineClusterBoundary {
  name: string;
  type: PipelineValueType;
}

/**
 * The boundary declaration a cluster-input / cluster-output
 * node carries in its params ({name, type}), or null when
 * the node is not a boundary node or its declaration is
 * malformed.
 */
export function pipelineClusterBoundaryPort(
  node: PipelineGraphNode,
): PipelineClusterBoundary | null {
  if (node.kind !== 'cluster-input' && node.kind !== 'cluster-output') return null;
  const params = node.params ?? {};
  if (typeof params.name !== 'string' || !CLUSTER_PORT_NAME_RE.test(params.name)) {
    return null;
  }
  if (typeof params.type !== 'string'
    || !(PIPELINE_VALUE_TYPES as readonly string[]).includes(params.type)) {
    return null;
  }
  return { name: params.name, type: params.type as PipelineValueType };
}

/**
 * The validated subgraph a cluster node embeds in
 * params.graph, or null when the node is not a cluster or
 * the embedded document does not validate.
 */
export function pipelineClusterEmbeddedGraph(
  node: PipelineGraphNode,
): PipelineGraph | null {
  if (node.kind !== 'cluster') return null;
  const raw = node.params?.graph;
  if (!isRecord(raw)) return null;
  const result = validatePipelineGraph(raw);
  return result.ok ? result.graph : null;
}

/**
 * The ports a subgraph declares through its boundary
 * nodes, in document order: cluster-input nodes are the
 * subgraph's inputs, cluster-output nodes its outputs.
 */
export function pipelineClusterPorts(graph: PipelineGraph): {
  inputs: PipelinePortDef[];
  outputs: PipelinePortDef[];
} {
  const inputs: PipelinePortDef[] = [];
  const outputs: PipelinePortDef[] = [];
  for (const node of graph.nodes) {
    const bp = pipelineClusterBoundaryPort(node);
    if (!bp) continue;
    if (node.kind === 'cluster-input') inputs.push({ name: bp.name, type: bp.type });
    else outputs.push({ name: bp.name, type: bp.type });
  }
  return { inputs, outputs };
}

/**
 * The effective ports of one node instance. Every kind
 * outside the cluster family resolves through the static
 * registry; a cluster's ports are its subgraph's boundary
 * declarations, and a boundary node's single `value` port
 * takes the type the node itself declares in params.type.
 */
export function pipelineNodePorts(
  node: PipelineGraphNode,
  direction: 'input' | 'output',
): readonly PipelinePortDef[] {
  if (node.kind === 'cluster') {
    const embedded = pipelineClusterEmbeddedGraph(node);
    if (!embedded) return [];
    const ports = pipelineClusterPorts(embedded);
    return direction === 'input' ? ports.inputs : ports.outputs;
  }
  if (node.kind === 'cluster-input' && direction === 'output') {
    const bp = pipelineClusterBoundaryPort(node);
    return [{ name: 'value', type: bp ? bp.type : 'Scalar' }];
  }
  if (node.kind === 'cluster-output' && direction === 'input') {
    const bp = pipelineClusterBoundaryPort(node);
    return [{ name: 'value', type: bp ? bp.type : 'Scalar' }];
  }
  const def = pipelineNodeDefinition(node.kind);
  if (!def) return [];
  return direction === 'input' ? def.inputs : def.outputs;
}

/** The effective type of one port of one node instance. */
export function pipelineNodePortType(
  node: PipelineGraphNode,
  direction: 'input' | 'output',
  portName: string,
): PipelineValueType | null {
  return pipelineNodePorts(node, direction).find((p) => p.name === portName)?.type ?? null;
}

// ---------------------------------------------------------------------------
// Cluster inline expansion (layer 1 WP10 phase D2)
// ---------------------------------------------------------------------------

interface ClusterFlattenInfo {
  embedded: PipelineGraph;
  /** Boundary port name -> boundary node id, per direction. */
  inBoundary: Map<string, string>;
  outBoundary: Map<string, string>;
}

/**
 * One flattening pass: every expandable cluster node is
 * replaced, in place, by its subgraph's nodes and edges
 * (ids prefixed `<clusterId>:`; the cluster's enabled flag
 * ANDs into every expanded node). Edges that named a
 * cluster port are rewired onto the corresponding boundary
 * node (port `value`); edges that touched a cluster
 * without naming a port, or named a port the subgraph
 * does not declare, are dropped — ordering-only wires
 * carry no compile semantics, and an undeclared port is
 * surfaced by the type checker as unknown-port. Returns
 * the SAME object when the graph holds no expandable
 * cluster.
 */
function flattenPipelineGraphClustersOnce(graph: PipelineGraph): PipelineGraph {
  const infos = new Map<string, ClusterFlattenInfo>();
  for (const node of graph.nodes) {
    if (node.kind !== 'cluster') continue;
    const embedded = pipelineClusterEmbeddedGraph(node);
    if (!embedded) continue;
    const inBoundary = new Map<string, string>();
    const outBoundary = new Map<string, string>();
    for (const inner of embedded.nodes) {
      const bp = pipelineClusterBoundaryPort(inner);
      if (!bp) continue;
      if (inner.kind === 'cluster-input' && !inBoundary.has(bp.name)) {
        inBoundary.set(bp.name, inner.id);
      }
      if (inner.kind === 'cluster-output' && !outBoundary.has(bp.name)) {
        outBoundary.set(bp.name, inner.id);
      }
    }
    infos.set(node.id, { embedded, inBoundary, outBoundary });
  }
  if (infos.size === 0) return graph;

  const nodes: PipelineGraphNode[] = [];
  const edges: PipelineGraphEdge[] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();
  const pushNode = (n: PipelineGraphNode) => {
    if (seenNodeIds.has(n.id)) {
      throw new Error(`pipeline graph: cluster expansion id collision (${n.id})`);
    }
    seenNodeIds.add(n.id);
    nodes.push(n);
  };
  const pushEdge = (e: PipelineGraphEdge) => {
    if (seenEdgeIds.has(e.id)) {
      throw new Error(`pipeline graph: cluster expansion id collision (${e.id})`);
    }
    seenEdgeIds.add(e.id);
    edges.push(e);
  };
  const prefixed = (clusterId: string, innerId: string) => `${clusterId}:${innerId}`;

  for (const node of graph.nodes) {
    const info = infos.get(node.id);
    if (!info) {
      pushNode(node);
      continue;
    }
    for (const innerNode of info.embedded.nodes) {
      const copy: PipelineGraphNode = {
        ...innerNode,
        id: prefixed(node.id, innerNode.id),
        enabled: innerNode.enabled && node.enabled,
      };
      if (innerNode.children) {
        copy.children = innerNode.children.map((c) => prefixed(node.id, c));
      }
      pushNode(copy);
    }
  }
  for (const edge of graph.edges) {
    let { from, to, fromPort, toPort } = edge;
    if (infos.has(from)) {
      const boundary = fromPort !== undefined
        ? infos.get(from)?.outBoundary.get(fromPort)
        : undefined;
      if (boundary === undefined) continue;
      from = prefixed(from, boundary);
      fromPort = 'value';
    }
    if (infos.has(to)) {
      const boundary = toPort !== undefined
        ? infos.get(to)?.inBoundary.get(toPort)
        : undefined;
      if (boundary === undefined) continue;
      to = prefixed(to, boundary);
      toPort = 'value';
    }
    const copy: PipelineGraphEdge = { ...edge, from, to };
    if (fromPort === undefined) delete copy.fromPort;
    else copy.fromPort = fromPort;
    if (toPort === undefined) delete copy.toPort;
    else copy.toPort = toPort;
    pushEdge(copy);
  }
  for (const node of graph.nodes) {
    const info = infos.get(node.id);
    if (!info) continue;
    for (const innerEdge of info.embedded.edges) {
      pushEdge({
        ...innerEdge,
        id: prefixed(node.id, innerEdge.id),
        from: prefixed(node.id, innerEdge.from),
        to: prefixed(node.id, innerEdge.to),
      });
    }
  }
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

/**
 * Splice every boundary node out of a flattened graph:
 * each boundary node is replaced by the cartesian product
 * of its incoming and outgoing wires (the composed wire
 * keeps the outgoing segment's kind, the incoming
 * segment's source port and the outgoing segment's target
 * port). A boundary wire with no counterpart on the other
 * side is dropped with its node — the value simply never
 * arrives, the same shape as an unwired optional input
 * elsewhere in the grammar. Boundary nodes are processed
 * in document order and composed wires take the position
 * of the earliest removed wire, so the result depends
 * only on the document.
 */
function splicePipelineGraphBoundaryNodes(graph: PipelineGraph): PipelineGraph {
  const isBoundary = (n: PipelineGraphNode) =>
    n.kind === 'cluster-input' || n.kind === 'cluster-output';
  let nodes = graph.nodes;
  let edges = graph.edges;
  for (const boundary of graph.nodes.filter(isBoundary)) {
    const incoming = edges.filter((e) => e.to === boundary.id);
    const outgoing = edges.filter((e) => e.from === boundary.id);
    const composed: PipelineGraphEdge[] = [];
    for (const inw of incoming) {
      for (const outw of outgoing) {
        const edge: PipelineGraphEdge = {
          id: `${inw.id}~${outw.id}`,
          from: inw.from,
          to: outw.to,
          kind: outw.kind,
        };
        if (inw.fromPort !== undefined) edge.fromPort = inw.fromPort;
        if (outw.toPort !== undefined) edge.toPort = outw.toPort;
        composed.push(edge);
      }
    }
    const next: PipelineGraphEdge[] = [];
    let inserted = false;
    for (const edge of edges) {
      if (edge.to === boundary.id || edge.from === boundary.id) {
        if (!inserted) {
          next.push(...composed);
          inserted = true;
        }
        continue;
      }
      next.push(edge);
    }
    edges = next;
    nodes = nodes.filter((n) => n.id !== boundary.id);
  }
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

/**
 * Inline every cluster in a graph: flattening passes
 * replace clusters by their contents (nested clusters
 * surface one level per pass, so the loop is bounded by
 * the nesting depth), then boundary nodes are spliced
 * out, composing the wires that crossed each boundary —
 * including cluster-to-cluster wires and pass-through
 * wires inside a subgraph. The expanded graph is what
 * the compiler evaluates, so a cluster graph and the
 * hand-written graph its expansion produces compile to
 * the same rules, force order and slot assignments.
 * A graph without an expandable cluster is returned as
 * the SAME object, so cluster-free documents keep their
 * exact compile results. A cluster whose embedded graph
 * does not validate is kept verbatim (validation refuses
 * such documents at load; a kept cluster compiles to
 * nothing, like other unrepresentable content — it is
 * never silently rewritten).
 */
export function expandPipelineGraphClusters(graph: PipelineGraph): PipelineGraph {
  let current = graph;
  let flattened = false;
  for (;;) {
    const next = flattenPipelineGraphClustersOnce(current);
    if (next === current) break;
    flattened = true;
    current = next;
  }
  if (!flattened) return graph;
  return splicePipelineGraphBoundaryNodes(current);
}

// ---------------------------------------------------------------------------
// Force-chunk operators
// ---------------------------------------------------------------------------

/** True when a force-chunk node's chunk param names a real chunk. */
export function pipelineForceChunkName(node: PipelineGraphNode): string | null {
  if (node.kind !== 'force-chunk') return null;
  const chunk = node.params?.chunk;
  if (typeof chunk !== 'string') return null;
  return (GPGPU_FORCE_CHUNK_NAMES as readonly string[]).includes(chunk) ? chunk : null;
}

// ---------------------------------------------------------------------------
// designer-blocks-v1 compatibility
// ---------------------------------------------------------------------------

const DESIGNER_TO_PIPELINE_KIND: Readonly<Record<string, string>> = {
  source: 'pool-source',
  group: 'group-def',
  rule: 'rule-box',
};
const PIPELINE_TO_DESIGNER_KIND: Readonly<Record<string, string>> = {
  'pool-source': 'source',
  'group-def': 'group',
  'rule-box': 'rule',
};

/**
 * Read a designer-blocks-v1 composition as a pipeline graph.
 * Node params (the serialised rule / group entities), labels,
 * enabled flags, dangling marks and edge kinds are carried
 * verbatim, so the conversion back is lossless.
 */
export function pipelineGraphFromDesignerBlocks(
  raw: unknown,
): PipelineGraphValidation {
  const validated = validateDesignerBlockModel(raw);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const model = validated.model;
  const graph: PipelineGraph = {
    format: PIPELINE_GRAPH_FORMAT,
    nodes: model.nodes.map((node) => {
      const out: PipelineGraphNode = {
        id: node.id,
        kind: DESIGNER_TO_PIPELINE_KIND[node.kind],
        label: node.label,
        enabled: node.enabled,
      };
      if (node.params !== undefined) out.params = node.params;
      if (node.dangling === true) out.dangling = true;
      return out;
    }),
    edges: model.edges.map((edge) => ({
      id: edge.id, from: edge.from, to: edge.to, kind: edge.kind,
    })),
  };
  return validatePipelineGraph(graph);
}

/**
 * Convert back to designer-blocks-v1. Only graphs whose nodes
 * are all designer kinds convert; anything else returns null
 * (the designer model has no place to keep those nodes, and
 * dropping them silently would lose data).
 */
export function designerBlocksFromPipelineGraph(
  graph: PipelineGraph,
): DesignerBlockModel | null {
  const nodes: DesignerBlockModel['nodes'] = [];
  for (const node of graph.nodes) {
    const kind = PIPELINE_TO_DESIGNER_KIND[node.kind];
    if (!kind) return null;
    const out: DesignerBlockModel['nodes'][number] = {
      id: node.id,
      kind: kind as DesignerBlockModel['nodes'][number]['kind'],
      label: node.label,
      enabled: node.enabled,
    };
    if (node.params !== undefined) out.params = node.params;
    if (node.dangling === true) out.dangling = true;
    nodes.push(out);
  }
  const edges: DesignerBlockModel['edges'] = [];
  for (const edge of graph.edges) {
    if (edge.fromPort !== undefined || edge.toPort !== undefined) return null;
    if (!['flow', 'sequence', 'reference', 'composite'].includes(edge.kind)) return null;
    edges.push({
      id: edge.id, from: edge.from, to: edge.to,
      kind: edge.kind as DesignerBlockModel['edges'][number]['kind'],
    });
  }
  const result = validateDesignerBlockModel({
    format: 'designer-blocks-v1', nodes, edges,
  });
  return result.ok ? result.model : null;
}
