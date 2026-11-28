/**
 * Pipeline canvas editing operations (limit plan stage 5,
 * slice S4): the pure functions behind the wiring-canvas
 * editor (components/controlPanelPipelineCanvasSection.tsx).
 * Every operation takes a graph and returns a new graph (or
 * a refusal with a reason); the component holds no editing
 * logic of its own, and every save goes through
 * lib/pipelinePersist.ts — the canvas and the column view
 * are two views of the same core (分岐C).
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐B: a rule-box opens into its fine-grained fragment
 *     (S1's expandRuleBoxNode) and collapses back into one
 *     box (S1's collapseRuleBox). Opening is a VIEW
 *     projection here: the stored core keeps the box, the
 *     editor renders expandPipelineRuleBox's output for the
 *     boxes the user opened. The compiler (S2) compiles the
 *     box form and the expanded form to the same rule, so
 *     the projection never changes meaning.
 *   - 分岐D: a type-mismatched wire is REFUSED, never
 *     silently converted. connectPipelineNodes returns the
 *     type checker's structured proposal; the wire is only
 *     created — with the conversion nodes visibly inserted —
 *     when the user accepts via applyPipelineConversionProposal.
 *   - Node positions are a view preference only (the Motion
 *     DAG editor's discipline): they live in localStorage
 *     under their own key and never enter the config.
 */

import {
  checkPipelineGraphTypes,
  collapseRuleBox,
  expandRuleBoxNode,
  pipelineNodeDefinition,
  pipelinePortType,
  validatePipelineGraph,
  PIPELINE_GRAPH_FORMAT,
  PIPELINE_NODE_DEFINITIONS,
  type PipelineConversionProposal,
  type PipelineGraph,
  type PipelineGraphEdge,
  type PipelineGraphNode,
  type PipelineValueType,
} from './pipelineGraph';
import { PIPELINE_ACTION_NODE_KINDS } from './pipelineCompiler';

// ---------------------------------------------------------------------------
// Id minting (deterministic: base + smallest free suffix)
// ---------------------------------------------------------------------------

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function nodeIdsOf(graph: PipelineGraph): Set<string> {
  return new Set(graph.nodes.map((n) => n.id));
}

function edgeIdsOf(graph: PipelineGraph): Set<string> {
  return new Set(graph.edges.map((e) => e.id));
}

function finish(graph: PipelineGraph): PipelineGraph | null {
  const result = validatePipelineGraph(graph);
  return result.ok ? result.graph : null;
}

// ---------------------------------------------------------------------------
// Palette / node insertion (DESIGN §3.4 案I)
// ---------------------------------------------------------------------------

/** Node kinds offered by the editor palette, in registry order. */
export function pipelinePaletteKinds(): string[] {
  return Object.values(PIPELINE_NODE_DEFINITIONS)
    .filter((def) => def.kind !== 'opaque')
    .map((def) => def.kind);
}

export interface PipelineAddNodeResult {
  graph: PipelineGraph;
  node: PipelineGraphNode;
}

/**
 * Append a node of the given kind. The id is minted from the
 * kind (`kind`, `kind-2`, ...) so repeated inserts stay
 * readable; params are the caller's (the palette passes the
 * kind's editing defaults, e.g. a force-chunk's chunk name).
 * Returns null for an unknown kind or a full graph.
 */
export function addPipelineNode(
  graph: PipelineGraph,
  kind: string,
  options?: { label?: string; params?: Record<string, unknown> },
): PipelineAddNodeResult | null {
  const def = pipelineNodeDefinition(kind);
  if (!def || kind === 'opaque') return null;
  const id = uniqueId(kind, nodeIdsOf(graph));
  const node: PipelineGraphNode = {
    id,
    kind,
    label: options?.label ?? def.label,
    enabled: true,
  };
  if (options?.params !== undefined) node.params = options.params;
  const next = finish({ format: PIPELINE_GRAPH_FORMAT, nodes: [...graph.nodes, node], edges: graph.edges });
  return next ? { graph: next, node: next.nodes[next.nodes.length - 1] } : null;
}

// ---------------------------------------------------------------------------
// Removal / enable toggle
// ---------------------------------------------------------------------------

/**
 * Remove a node, every edge that touches it, and every
 * rule-box child claim on it. Returns null when absent.
 */
export function removePipelineNode(graph: PipelineGraph, nodeId: string): PipelineGraph | null {
  if (!graph.nodes.some((n) => n.id === nodeId)) return null;
  const nodes = graph.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => (n.children?.includes(nodeId)
      ? { ...n, children: n.children.filter((c) => c !== nodeId) }
      : n));
  const edges = graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges });
}

export function setPipelineNodeEnabled(
  graph: PipelineGraph,
  nodeId: string,
  enabled: boolean,
): PipelineGraph | null {
  if (!graph.nodes.some((n) => n.id === nodeId)) return null;
  const nodes = graph.nodes.map((n) => (n.id === nodeId ? { ...n, enabled } : n));
  return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges: graph.edges });
}

/** Rename a node and / or replace its params (the inspector). */
export function updatePipelineNode(
  graph: PipelineGraph,
  nodeId: string,
  patch: { label?: string; params?: Record<string, unknown> },
): PipelineGraph | null {
  if (!graph.nodes.some((n) => n.id === nodeId)) return null;
  const nodes = graph.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const next = { ...n };
    if (patch.label !== undefined && patch.label.length > 0) next.label = patch.label;
    if (patch.params !== undefined) next.params = patch.params;
    return next;
  });
  return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges: graph.edges });
}

// ---------------------------------------------------------------------------
// Wiring: connect (type-checked) / disconnect
// ---------------------------------------------------------------------------

export type PipelineConnectResult =
  | { ok: true; graph: PipelineGraph; edge: PipelineGraphEdge }
  | {
    ok: false;
    reason: string;
    /** 分岐D: present when a conversion node could fix the wire. */
    proposal?: PipelineConversionProposal;
  };

/**
 * Connect two ports with a data edge. The candidate edge is
 * type-checked BEFORE it is added: same-type and the two
 * sanctioned implicit conversions connect directly; anything
 * else is refused with the checker's proposal attached (the
 * graph is returned unchanged — no silent conversion, no
 * partial wire). Cycles and duplicate wires are refused too.
 */
export function connectPipelineNodes(
  graph: PipelineGraph,
  wire: { from: string; to: string; fromPort?: string; toPort?: string },
): PipelineConnectResult {
  const fromNode = graph.nodes.find((n) => n.id === wire.from);
  const toNode = graph.nodes.find((n) => n.id === wire.to);
  if (!fromNode || !toNode) return { ok: false, reason: 'edge-endpoint-missing' };
  if (wire.from === wire.to) return { ok: false, reason: 'self-loop' };
  if (graph.edges.some((e) => e.from === wire.from && e.to === wire.to
    && e.fromPort === wire.fromPort && e.toPort === wire.toPort)) {
    return { ok: false, reason: 'duplicate-edge' };
  }
  const edge: PipelineGraphEdge = {
    id: uniqueId(`wire:${wire.from}->${wire.to}`, edgeIdsOf(graph)),
    from: wire.from,
    to: wire.to,
    kind: 'data',
  };
  if (wire.fromPort !== undefined) edge.fromPort = wire.fromPort;
  if (wire.toPort !== undefined) edge.toPort = wire.toPort;

  const candidate: PipelineGraph = {
    format: PIPELINE_GRAPH_FORMAT,
    nodes: graph.nodes,
    edges: [...graph.edges, edge],
  };
  const validated = validatePipelineGraph(candidate);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const check = checkPipelineGraphTypes(validated.graph);
  const issue = check.issues.find((i) => i.edgeId === edge.id);
  if (issue && issue.status === 'proposal') {
    return { ok: false, reason: 'type-mismatch', proposal: issue.proposal };
  }
  if (issue && issue.status === 'unknown-port') {
    return { ok: false, reason: 'unknown-port' };
  }
  return { ok: true, graph: validated.graph, edge };
}

export function disconnectPipelineEdge(graph: PipelineGraph, edgeId: string): PipelineGraph | null {
  if (!graph.edges.some((e) => e.id === edgeId)) return null;
  return finish({
    format: PIPELINE_GRAPH_FORMAT,
    nodes: graph.nodes,
    edges: graph.edges.filter((e) => e.id !== edgeId),
  });
}

// ---------------------------------------------------------------------------
// Conversion proposals (分岐D): applied ONLY on user consent
// ---------------------------------------------------------------------------

function portForType(
  kind: string,
  direction: 'input' | 'output',
  type: PipelineValueType,
  fallbackFirst: boolean,
): string | null {
  const def = pipelineNodeDefinition(kind);
  if (!def) return null;
  const ports = direction === 'input' ? def.inputs : def.outputs;
  const match = ports.find((p) => p.type === type);
  if (match) return match.name;
  return fallbackFirst && ports.length > 0 ? ports[0].name : null;
}

/**
 * Insert the proposal's conversion nodes into the refused
 * wire: the original edge is replaced by
 * from -> conv1 -> ... -> convN -> to, each new node a
 * visible, ordinary graph node. Returns null when the
 * proposal names no conversion node, its edge is gone, or
 * the rewired graph would not validate / type-check.
 */
export function applyPipelineConversionProposal(
  graph: PipelineGraph,
  proposal: PipelineConversionProposal,
): PipelineGraph | null {
  if (proposal.insertNodeKinds.length === 0) return null;
  const original = graph.edges.find((e) => e.id === proposal.edgeId);
  if (!original) return null;
  const fromNode = graph.nodes.find((n) => n.id === original.from);
  const toNode = graph.nodes.find((n) => n.id === original.to);
  if (!fromNode || !toNode) return null;

  const takenNodes = nodeIdsOf(graph);
  const takenEdges = edgeIdsOf(graph);
  const newNodes: PipelineGraphNode[] = [];
  const chainIds: string[] = [];
  for (const kind of proposal.insertNodeKinds) {
    const def = pipelineNodeDefinition(kind);
    if (!def) return null;
    // Node ids must match the graph's id alphabet, which the
    // edge id (wire:from->to) does not — sanitise the base.
    const safeBase = original.id.replace(/[^A-Za-z0-9:._-]/g, '-');
    const id = uniqueId(`${safeBase}:conv-${kind}`, takenNodes);
    takenNodes.add(id);
    chainIds.push(id);
    newNodes.push({ id, kind, label: def.label, enabled: true });
  }

  const newEdges: PipelineGraphEdge[] = [];
  let currentType: PipelineValueType = proposal.fromType;
  let prevId = original.from;
  let prevPort = original.fromPort;
  for (let i = 0; i < chainIds.length; i++) {
    const kind = proposal.insertNodeKinds[i];
    const isLast = i === chainIds.length - 1;
    const inPort = portForType(kind, 'input', currentType, true);
    if (!inPort) return null;
    // The output type this step must produce: the target
    // type for the last step, otherwise a type the next
    // step can consume.
    let outType: PipelineValueType | null = null;
    if (isLast) {
      outType = proposal.toType;
    } else {
      const nextDef = pipelineNodeDefinition(proposal.insertNodeKinds[i + 1]);
      const def = pipelineNodeDefinition(kind);
      if (!nextDef || !def) return null;
      const nextInputTypes = new Set(nextDef.inputs.map((p) => p.type));
      outType = def.outputs.find((p) => nextInputTypes.has(p.type))?.type ?? null;
      if (outType === null) return null;
    }
    const outPort = portForType(kind, 'output', outType, false);
    if (!outPort) return null;
    const edge: PipelineGraphEdge = {
      id: uniqueId(`wire:${prevId}->${chainIds[i]}`, takenEdges),
      from: prevId, to: chainIds[i], kind: 'data',
    };
    takenEdges.add(edge.id);
    if (prevPort !== undefined) edge.fromPort = prevPort;
    edge.toPort = inPort;
    newEdges.push(edge);
    prevId = chainIds[i];
    prevPort = outPort;
    currentType = outType;
  }
  const finalEdge: PipelineGraphEdge = {
    id: uniqueId(`wire:${prevId}->${original.to}`, takenEdges),
    from: prevId, to: original.to, kind: 'data',
  };
  if (prevPort !== undefined) finalEdge.fromPort = prevPort;
  if (original.toPort !== undefined) finalEdge.toPort = original.toPort;
  newEdges.push(finalEdge);

  const candidate: PipelineGraph = {
    format: PIPELINE_GRAPH_FORMAT,
    nodes: [...graph.nodes, ...newNodes],
    edges: [...graph.edges.filter((e) => e.id !== original.id), ...newEdges],
  };
  const validated = validatePipelineGraph(candidate);
  if (!validated.ok) return null;
  const check = checkPipelineGraphTypes(validated.graph);
  const chainEdgeIds = new Set(newEdges.map((e) => e.id));
  const bad = check.issues.some(
    (i) => chainEdgeIds.has(i.edgeId) && (i.status === 'proposal' || i.status === 'unknown-port'),
  );
  return bad ? null : validated.graph;
}

/**
 * Apply a proposal for a wire that was refused (and therefore
 * never added): rebuild the candidate edge under the
 * proposal's id, validate it, then insert the chain. This is
 * the editor's accept path — it runs only on user consent.
 */
export function applyPipelineConversionForWire(
  graph: PipelineGraph,
  wire: { from: string; to: string; fromPort?: string; toPort?: string },
  proposal: PipelineConversionProposal,
): PipelineGraph | null {
  const raw: PipelineGraphEdge = {
    id: proposal.edgeId, from: wire.from, to: wire.to, kind: 'data',
  };
  if (wire.fromPort !== undefined) raw.fromPort = wire.fromPort;
  if (wire.toPort !== undefined) raw.toPort = wire.toPort;
  const candidate = validatePipelineGraph({
    format: PIPELINE_GRAPH_FORMAT,
    nodes: graph.nodes,
    edges: [...graph.edges, raw],
  });
  if (!candidate.ok) return null;
  return applyPipelineConversionProposal(candidate.graph, proposal);
}

// ---------------------------------------------------------------------------
// Rule-box open / close (分岐B, view projection over S1)
// ---------------------------------------------------------------------------

/**
 * Expand ONE rule-box in place (S1's expandRuleBoxNode plus
 * the edge rewiring of expandPipelineGraph, scoped to this
 * box). Other boxes stay closed. Null when not a rule-box.
 */
export function expandPipelineRuleBox(graph: PipelineGraph, boxId: string): PipelineGraph | null {
  const box = graph.nodes.find((n) => n.id === boxId);
  if (!box || box.kind !== 'rule-box') return null;
  const fragment = expandRuleBoxNode(box);
  if (!fragment) return null;
  const actionId = `${boxId}:action`;
  const nodes: PipelineGraphNode[] = [];
  for (const node of graph.nodes) {
    if (node.id === boxId) nodes.push(...fragment.nodes);
    else nodes.push(node);
  }
  const edges = [
    ...graph.edges.map((e) => ({
      ...e,
      from: e.from === boxId ? actionId : e.from,
      to: e.to === boxId ? actionId : e.to,
    })),
    ...fragment.edges,
  ];
  return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges });
}

/** Collapse one opened box back (S1's collapseRuleBox). */
export function collapsePipelineRuleBox(graph: PipelineGraph, boxId: string): PipelineGraph | null {
  return collapseRuleBox(graph, boxId);
}

/**
 * The editor's view projection: the core with exactly the
 * listed boxes opened. Unopenable ids are ignored.
 */
export function projectPipelineCanvas(
  graph: PipelineGraph,
  openBoxIds: readonly string[],
): PipelineGraph {
  let view = graph;
  for (const boxId of openBoxIds) {
    view = expandPipelineRuleBox(view, boxId) ?? view;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Column view (分岐C): rule rows + force-chunk rows, one data
// ---------------------------------------------------------------------------

export interface PipelineColumnRows {
  /** Rule rows: rule-boxes and action nodes, document order. */
  rules: PipelineGraphNode[];
  /** Force rows: force-chunk nodes, chain order. */
  forces: PipelineGraphNode[];
}

function forceChainOrder(graph: PipelineGraph): PipelineGraphNode[] {
  const chunks = graph.nodes.filter((n) => n.kind === 'force-chunk');
  const byId = new Map(chunks.map((n) => [n.id, n]));
  const next = new Map<string, string>();
  const hasIncoming = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'sequence') continue;
    if (byId.has(edge.from) && byId.has(edge.to)) {
      next.set(edge.from, edge.to);
      hasIncoming.add(edge.to);
    }
  }
  const ordered: PipelineGraphNode[] = [];
  const seen = new Set<string>();
  for (const head of chunks) {
    if (hasIncoming.has(head.id) || seen.has(head.id)) continue;
    let current: PipelineGraphNode | undefined = head;
    while (current && !seen.has(current.id)) {
      ordered.push(current);
      seen.add(current.id);
      const nextId = next.get(current.id);
      current = nextId ? byId.get(nextId) : undefined;
    }
  }
  // Anything the chains did not reach keeps document order.
  for (const node of chunks) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}

export function pipelineColumnRows(graph: PipelineGraph): PipelineColumnRows {
  return {
    rules: graph.nodes.filter(
      (n) => n.kind === 'rule-box' || PIPELINE_ACTION_NODE_KINDS.includes(n.kind),
    ),
    forces: forceChainOrder(graph),
  };
}

function columnGroupOf(node: PipelineGraphNode): 'rules' | 'forces' | null {
  if (node.kind === 'force-chunk') return 'forces';
  if (node.kind === 'rule-box' || PIPELINE_ACTION_NODE_KINDS.includes(node.kind)) return 'rules';
  return null;
}

/**
 * Move a node one step within its column (the column view's
 * up / down buttons). For force rows the sequence chain is
 * rebuilt in the new order, so the compiled force-order key
 * follows the column edit (分岐C: one data, two views). For
 * rule rows the document order itself is the evaluation
 * order. Returns null when the move is impossible.
 */
export function movePipelineColumnRow(
  graph: PipelineGraph,
  nodeId: string,
  delta: -1 | 1,
): PipelineGraph | null {
  const rows = pipelineColumnRows(graph);
  const group = graph.nodes.find((n) => n.id === nodeId);
  if (!group) return null;
  const groupName = columnGroupOf(group);
  if (!groupName) return null;
  const list = groupName === 'rules' ? rows.rules : rows.forces;
  const index = list.findIndex((n) => n.id === nodeId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return null;
  const reordered = [...list];
  const [item] = reordered.splice(index, 1);
  reordered.splice(target, 0, item);

  if (groupName === 'rules') {
    const ruleIds = new Set(list.map((n) => n.id));
    let cursor = 0;
    const nodes = graph.nodes.map((n) => (ruleIds.has(n.id) ? reordered[cursor++] : n));
    return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges: graph.edges });
  }
  // Forces: place the chunk nodes in the new order and
  // rebuild their sequence chain to match.
  const chunkIds = new Set(list.map((n) => n.id));
  let cursor = 0;
  const nodes = graph.nodes.map((n) => (chunkIds.has(n.id) ? reordered[cursor++] : n));
  const isChainEdge = (e: PipelineGraphEdge) => e.kind === 'sequence'
    && chunkIds.has(e.from) && chunkIds.has(e.to);
  const edges = graph.edges.filter((e) => !isChainEdge(e));
  const taken = edgeIdsOf({ ...graph, edges });
  for (let i = 1; i < reordered.length; i++) {
    const id = uniqueId(`seq-${i}`, taken);
    taken.add(id);
    edges.push({ id, from: reordered[i - 1].id, to: reordered[i].id, kind: 'sequence' });
  }
  return finish({ format: PIPELINE_GRAPH_FORMAT, nodes, edges });
}

// ---------------------------------------------------------------------------
// Node positions: view preference only, never the config
// ---------------------------------------------------------------------------

export const PIPELINE_CANVAS_LAYOUT_STORAGE_KEY = 'monosphere-pipeline-canvas-layout-v1';

export type PipelineCanvasLayout = Record<string, { x: number; y: number }>;

export interface PipelineCanvasLayoutStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultPipelineCanvasLayoutStorage(): PipelineCanvasLayoutStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Deterministic fallback layout: category columns, stacked. */
export function layoutPipelineCanvasNodes(
  graph: PipelineGraph,
  saved?: PipelineCanvasLayout,
): PipelineCanvasLayout {
  const columnOf = (node: PipelineGraphNode): number => {
    const def = pipelineNodeDefinition(node.kind);
    switch (def?.category) {
      case 'source': return 0;
      case 'condition': case 'logic': return 1;
      case 'math': case 'conversion': return 2;
      case 'action': case 'container': return 3;
      case 'pipeline': return 4;
      default: return 2;
    }
  };
  const rowsInColumn = new Map<number, number>();
  const layout: PipelineCanvasLayout = {};
  for (const node of graph.nodes) {
    const kept = saved?.[node.id];
    if (kept && Number.isFinite(kept.x) && Number.isFinite(kept.y)) {
      layout[node.id] = { x: kept.x, y: kept.y };
      continue;
    }
    const column = columnOf(node);
    const row = rowsInColumn.get(column) ?? 0;
    rowsInColumn.set(column, row + 1);
    layout[node.id] = { x: 12 + column * 208, y: 12 + row * 118 };
  }
  return layout;
}

export function loadPipelineCanvasLayout(
  storage: PipelineCanvasLayoutStorageLike,
): PipelineCanvasLayout {
  try {
    const raw = storage.getItem(PIPELINE_CANVAS_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const layout: PipelineCanvasLayout = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null
        && Number.isFinite((value as { x?: unknown }).x)
        && Number.isFinite((value as { y?: unknown }).y)) {
        layout[id] = { x: (value as { x: number }).x, y: (value as { y: number }).y };
      }
    }
    return layout;
  } catch {
    return {};
  }
}

export function persistPipelineCanvasLayout(
  storage: PipelineCanvasLayoutStorageLike,
  layout: PipelineCanvasLayout,
): boolean {
  try {
    storage.setItem(PIPELINE_CANVAS_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/** Re-exported for the editor: the port type of a node kind. */
export function pipelineCanvasPortType(
  kind: string,
  direction: 'input' | 'output',
  portName: string,
): PipelineValueType | null {
  return pipelinePortType(kind, direction, portName);
}
