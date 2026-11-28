/**
 * Pipeline compiler (limit plan stage 5, slice S2): compiles
 * a pipeline-graph-v1 graph (lib/pipelineGraph.ts) into the
 * EXISTING row-list forms — the live rule list
 * (lib/gpgpuParticleRulesLive.ts) and the force-order key
 * (lib/gpgpuForceOrder.ts) — and back. Pure functions only:
 * no UI, no config keys, no execution-path wiring (later
 * slices). The generators, resolvers and signature machinery
 * downstream are the existing ones, untouched.
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐A: the graph is the single internal core; the row
 *     list stays a full editing surface. Both directions are
 *     provided and the round trip graph -> rules -> graph ->
 *     rules is lossless. Elements the compiler cannot
 *     represent are kept as `opaque` nodes (params.rawRule
 *     carried verbatim), never dropped silently — the same
 *     discipline as the grammar's parse-but-unconsumed
 *     actions (STAGE5_DESIGN_MATERIALS.md §5).
 *   - 分岐C: the force column and the canvas are two views
 *     of one data. A linear chain of force-chunk nodes IS
 *     the gpgpuForceOrder key, in both directions; the
 *     default order serialises back to '' (unset).
 *   - §8.5 (P1 extension): Logic nodes compile by lowering
 *     (And -> product, Or -> clamped sum, Not -> 1.0 - x)
 *     via lib/pipelineGraph.ts; the expression engine gains
 *     no operators. An expression node's output reaches a
 *     condition through the EXISTING attribute-dyn channel:
 *     the node writes a named slot, the condition reads the
 *     slot name (see the slot discipline below).
 *
 * Rule-box params shapes accepted (all three exist in the
 * wild and are told apart structurally):
 *   1. entity form — params.rule is a live rule object, or
 *      params itself carries {id, condition, action}
 *      (prototype P1's box; designer-converted boxes carry
 *      the baked entity, whose force-gate / kill / color
 *      subset validates as a live rule unchanged);
 *   2. synthetic form — params {condition, actionKind, ...}
 *      from slice S1's expand/collapse pair, where the
 *      action fields (force / state / groupId / size /
 *      opacity) ride alongside.
 *
 * Slot assignment discipline (decided in this slice,
 * aligned with lib/gpgpuAttributes.ts):
 *   - An expression (or channel-write) node requests an
 *     output name via params.outputSlot (alias slotName).
 *   - Names must match /^[A-Za-z_][A-Za-z0-9_]{0,23}$/
 *     (the attribute name shape: trimmed, 24 chars max).
 *   - Reserved names are REFUSED with reason
 *     'reserved-name': the attribute expression reserved
 *     set mirrored below (x / t / pi / tau / e, the 23
 *     function names, p, the sim vars vel / age / rad, and
 *     den) — exactly the set resolveAttrNameSlot treats as
 *     inert.
 *   - A name that already names an existing slot reuses
 *     that slot — unless it is an ext slot (4..7), which
 *     the dyn channel cannot write: refused with reason
 *     'ext-slot-read-only'.
 *   - A new name takes the lowest unclaimed writable slot
 *     (0..3, the dyn channel's range). Claims are
 *     first-come in document order: a second node asking
 *     for the same new name is refused with
 *     'duplicate-output-name', and when no writable slot
 *     remains the request is refused with 'no-free-slot'.
 *   - Refusals are reported, never silently dropped. The
 *     result also proposes the renamed slot-name list and
 *     the per-slot dyn expressions, so a later slice can
 *     apply the assignment through the existing keys
 *     (gpgpuAttrNames / gpgpuAttrDynExprs) unchanged.
 *
 * Cluster grammar (layer 1 WP10 phase D2): every compile
 * entry point inlines cluster nodes first
 * (expandPipelineGraphClusters in lib/pipelineGraph.ts),
 * so a graph that encapsulates part of itself in a
 * cluster compiles exactly as its hand-expanded
 * equivalent — rules, force order and slot assignments
 * alike. Cluster-free graphs are untouched by the
 * expansion (it returns them as the same object).
 */

import {
  expandPipelineGraphClusters,
  lowerLogicNodeToExpression,
  pipelineForceChunkName,
  validatePipelineGraph,
  PIPELINE_GRAPH_FORMAT,
  type PipelineGraph,
  type PipelineGraphNode,
} from './pipelineGraph';
import {
  validateLiveParticleRule,
  type LiveParticleRule,
  type LiveParticleRuleAction,
} from './gpgpuParticleRulesLive';
import {
  isDefaultGpgpuForceOrder,
  normalizeGpgpuForceOrder,
  serializeGpgpuForceOrder,
} from './gpgpuForceOrder';
import {
  ATTR_SIM_VAR_NAMES,
  normalizeAttrNames,
  normalizeAttrNames2,
  resolveAttrNameSlot,
} from './gpgpuAttributes';
import { DENSITY_VAR_NAME } from './gpgpuDensity';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RULE_ID_FORBIDDEN = /[^A-Za-z0-9._-]/g;

/** Node ids allow ':' (rule:foo); live rule ids do not. */
function sanitizeRuleId(raw: string): string {
  const cleaned = raw.replace(RULE_ID_FORBIDDEN, '-').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'rule';
}

function stripNodePrefix(id: string): string {
  return id.startsWith('rule:') ? id.slice('rule:'.length) : id;
}

function fmtNum(value: number): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// Action construction (node kind + params -> live action)
// ---------------------------------------------------------------------------

export const PIPELINE_ACTION_NODE_KINDS: readonly string[] = [
  'force-gate', 'set-state', 'set-group', 'kill', 'true-kill',
  'fracture', 'display', 'spawn', 'custom-force',
];

function actionFromKind(
  kind: string,
  params: Record<string, unknown>,
  groupIdHint?: string,
): LiveParticleRuleAction | null {
  switch (kind) {
    case 'force-gate': {
      const force = typeof params.force === 'string' ? params.force : 'all';
      return { type: 'force-gate', force } as LiveParticleRuleAction;
    }
    case 'custom-force':
      return { type: 'force-gate', force: 'custom' };
    case 'kill':
      return { type: 'kill' };
    case 'true-kill':
      return { type: 'true-kill' };
    case 'fracture':
      return { type: 'fracture' };
    case 'spawn':
      return { type: 'spawn' };
    case 'set-state':
      return {
        type: 'set-state',
        state: typeof params.state === 'number' ? params.state : 0,
      };
    case 'set-group': {
      const id = typeof params.groupId === 'string'
        ? params.groupId
        : typeof params.targetGroupId === 'string'
          ? params.targetGroupId
          : groupIdHint;
      return typeof id === 'string' && id.length > 0 ? { type: 'set-group', id } : null;
    }
    case 'display':
      return {
        type: 'display',
        size: typeof params.size === 'number' ? params.size : 1,
        opacity: typeof params.opacity === 'number' ? params.opacity : 1,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Condition synthesis (fine-grained nodes -> condition text)
// ---------------------------------------------------------------------------

const CONDITION_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'expression', 'compare', 'band', 'state-is', 'group-is', 'prev',
  'logic-and', 'logic-or', 'logic-not', 'logic-xor',
  'math-add', 'math-sub', 'math-mul', 'math-div', 'math-mod', 'math-pow',
  'math-neg', 'math-func', 'math-min', 'math-max', 'math-clamp',
  'math-lerp', 'math-smoothstep', 'math-ternary',
  'map-range', 'quantize', 'saturate', 'channel-read', 'slot-read',
]);

function incomingEdges(graph: PipelineGraph, nodeId: string): PipelineGraph['edges'] {
  return graph.edges.filter((e) => e.to === nodeId);
}

function groupIdOfNode(node: PipelineGraphNode): string {
  if (isRecord(node.params) && typeof node.params.id === 'string') return node.params.id;
  return node.id.startsWith('group:') ? node.id.slice('group:'.length) : node.id;
}

/**
 * Synthesise the condition expression text a condition-side
 * node stands for, or null when the node carries nothing
 * synthesisable. Logic nodes recurse into their wired
 * inputs (in edge document order) and lower through the
 * S1 lowering, so the result is the grammar's native form.
 */
export function synthesizePipelineCondition(
  graph: PipelineGraph,
  nodeId: string,
  seen: ReadonlySet<string> = new Set(),
): string | null {
  if (seen.has(nodeId)) return null;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const params = node.params ?? {};
  const nextSeen = new Set(seen).add(nodeId);

  if (node.kind.startsWith('logic-')) {
    const inputs: string[] = [];
    for (const edge of incomingEdges(graph, nodeId)) {
      const source = graph.nodes.find((n) => n.id === edge.from);
      if (!source || !CONDITION_SOURCE_KINDS.has(source.kind)) continue;
      const text = synthesizePipelineCondition(graph, source.id, nextSeen);
      if (text !== null) inputs.push(text);
    }
    if (inputs.length === 0) return null;
    return lowerLogicNodeToExpression(node.kind, inputs);
  }

  if (typeof params.expr === 'string') return params.expr;

  switch (node.kind) {
    case 'compare': {
      const left = typeof params.left === 'string' ? params.left
        : typeof params.a === 'string' ? params.a
        : typeof params.a === 'number' ? fmtNum(params.a) : null;
      const right = typeof params.right === 'string' ? params.right
        : typeof params.b === 'string' ? params.b
        : typeof params.b === 'number' ? fmtNum(params.b) : null;
      const op = typeof params.op === 'string' ? params.op
        : typeof params.operator === 'string' ? params.operator : '>';
      if (left === null || right === null) return null;
      return `${left} ${op} ${right}`;
    }
    case 'band': {
      const variable = typeof params.variable === 'string' ? params.variable
        : typeof params.var === 'string' ? params.var : 'age';
      const low = typeof params.low === 'number' ? params.low : 0;
      const high = typeof params.high === 'number' ? params.high : 1;
      return `(${variable} >= ${fmtNum(low)}) * (${variable} <= ${fmtNum(high)})`;
    }
    case 'state-is': {
      const state = typeof params.state === 'number' ? params.state : 0;
      return `state == ${fmtNum(state)}`;
    }
    default:
      return null;
  }
}

/** The wired condition text for an action node ('' = always true). */
function conditionForAction(graph: PipelineGraph, actionNode: PipelineGraphNode): string {
  const params = actionNode.params ?? {};
  if (typeof params.condition === 'string') return params.condition;
  const candidates = incomingEdges(graph, actionNode.id)
    .filter((e) => e.toPort === 'condition' || e.toPort === undefined);
  // Prefer a logic node (it aggregates the others); otherwise
  // the first synthesisable source in edge document order.
  const ordered = [
    ...candidates.filter((e) => graph.nodes.find((n) => n.id === e.from)?.kind.startsWith('logic-')),
    ...candidates.filter((e) => !graph.nodes.find((n) => n.id === e.from)?.kind.startsWith('logic-')),
  ];
  for (const edge of ordered) {
    const source = graph.nodes.find((n) => n.id === edge.from);
    if (!source || !CONDITION_SOURCE_KINDS.has(source.kind)) continue;
    const text = synthesizePipelineCondition(graph, source.id);
    if (text !== null) return text;
  }
  return '';
}

/** The target for an action node: params, else a wired group, else all. */
function targetForAction(
  graph: PipelineGraph,
  actionNode: PipelineGraphNode,
): LiveParticleRule['target'] {
  const params = actionNode.params ?? {};
  if (isRecord(params.target)) {
    return params.target as LiveParticleRule['target'];
  }
  for (const edge of incomingEdges(graph, actionNode.id)) {
    const source = graph.nodes.find((n) => n.id === edge.from);
    if (source && source.kind === 'group-def') {
      return { type: 'group', id: groupIdOfNode(source) };
    }
  }
  return { type: 'all' };
}

function wiredGroupId(graph: PipelineGraph, node: PipelineGraphNode): string | undefined {
  for (const edge of incomingEdges(graph, node.id)) {
    const source = graph.nodes.find((n) => n.id === edge.from);
    if (source && source.kind === 'group-def') return groupIdOfNode(source);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Graph -> live rules
// ---------------------------------------------------------------------------

export interface PipelineCompileIssue {
  nodeId: string;
  reason: string;
}

export interface PipelineRuleCompileResult {
  rules: LiveParticleRule[];
  /** Node ids whose content is preserved as opaque instead of compiled. */
  opaqueNodeIds: string[];
  issues: PipelineCompileIssue[];
  /** S5: the producing node id for each entry of `rules`
   *  (parallel array), so route analyses can attribute a
   *  compiled rule back to its graph node. */
  ruleNodeIds: string[];
  /** S5 (分岐E): ids of compiled rules whose producing node
   *  carries the same-evaluation designation
   *  (params.crossImmediate / params.timing 'immediate').
   *  The row-list form cannot carry the designation; it
   *  lives in the graph params and surfaces here. */
  immediateRuleIds: string[];
}

/**
 * The same-evaluation (2-phase) designation of a node
 * (分岐E): params.crossImmediate === true, or the explicit
 * params.timing === 'immediate'. Anything else — including
 * an absent param — is the default snapshot timing.
 */
export function pipelineNodeCrossImmediate(node: PipelineGraphNode): boolean {
  const params = node.params ?? {};
  return params.crossImmediate === true || params.timing === 'immediate';
}

function ruleFromEntity(
  raw: unknown,
  enabledOverride: boolean,
): LiveParticleRule | null {
  const rule = validateLiveParticleRule(raw);
  if (!rule) return null;
  return enabledOverride === false ? { ...rule, enabled: false } : rule;
}

function compileRuleBox(node: PipelineGraphNode, issues: PipelineCompileIssue[]): LiveParticleRule | null {
  const params = node.params ?? {};
  // Entity form 1: params.rule carries the rule verbatim.
  if (isRecord(params.rule)) {
    const rule = ruleFromEntity(params.rule, node.enabled);
    if (rule) return rule;
    issues.push({ nodeId: node.id, reason: 'invalid-rule-entity' });
    return null;
  }
  // Entity form 2: params itself is the rule.
  if (isRecord(params.action) && typeof params.condition === 'string') {
    const entity = { ...params, id: typeof params.id === 'string' ? params.id : sanitizeRuleId(stripNodePrefix(node.id)) };
    const rule = ruleFromEntity(entity, node.enabled);
    if (rule) return rule;
    issues.push({ nodeId: node.id, reason: 'invalid-rule-entity' });
    return null;
  }
  // Synthetic form (S1 expand/collapse): condition + actionKind.
  const actionKind = typeof params.actionKind === 'string' ? params.actionKind : 'force-gate';
  const action = actionFromKind(actionKind, params);
  if (!action) {
    issues.push({ nodeId: node.id, reason: 'unknown-action-kind' });
    return null;
  }
  const candidate = {
    id: typeof params.ruleId === 'string' ? params.ruleId : sanitizeRuleId(stripNodePrefix(node.id)),
    ...(typeof params.name === 'string' ? { name: params.name } : {}),
    enabled: node.enabled,
    target: isRecord(params.target) ? params.target : { type: 'all' },
    condition: typeof params.condition === 'string' ? params.condition : '',
    action,
  };
  const rule = validateLiveParticleRule(candidate);
  if (!rule) issues.push({ nodeId: node.id, reason: 'invalid-compiled-rule' });
  return rule;
}

function compileActionNode(
  graph: PipelineGraph,
  node: PipelineGraphNode,
  issues: PipelineCompileIssue[],
): LiveParticleRule | null {
  const params = node.params ?? {};
  const action = actionFromKind(node.kind, params, wiredGroupId(graph, node));
  if (!action) {
    issues.push({ nodeId: node.id, reason: 'action-not-compilable' });
    return null;
  }
  const candidate = {
    id: typeof params.ruleId === 'string' ? params.ruleId : sanitizeRuleId(node.id),
    ...(typeof params.name === 'string' ? { name: params.name } : {}),
    enabled: node.enabled,
    target: targetForAction(graph, node),
    condition: conditionForAction(graph, node),
    action,
  };
  const rule = validateLiveParticleRule(candidate);
  if (!rule) issues.push({ nodeId: node.id, reason: 'invalid-compiled-rule' });
  return rule;
}

function compileOpaqueNode(node: PipelineGraphNode, issues: PipelineCompileIssue[]): LiveParticleRule | null {
  const params = node.params ?? {};
  const raw = isRecord(params.rawRule) ? params.rawRule
    : isRecord(params.rule) ? params.rule : null;
  if (!raw) {
    issues.push({ nodeId: node.id, reason: 'opaque-without-payload' });
    return null;
  }
  const rule = ruleFromEntity(raw, node.enabled);
  if (!rule) issues.push({ nodeId: node.id, reason: 'invalid-opaque-payload' });
  return rule;
}

/**
 * Compile the rule side of a graph into the live rule list,
 * in document order (= evaluation order). Nodes that cannot
 * compile are reported and their ids returned as opaque —
 * the caller keeps the graph nodes themselves, so nothing
 * is lost; this function never invents or drops silently.
 */
export function compilePipelineGraphToLiveRules(graph: PipelineGraph): PipelineRuleCompileResult {
  // Cluster grammar (WP10 D2): clusters are inlined
  // before anything is compiled, so the rules below are
  // the expansion's rules — a cluster graph and its
  // hand-expanded equivalent compile identically.
  graph = expandPipelineGraphClusters(graph);
  const rules: LiveParticleRule[] = [];
  const opaqueNodeIds: string[] = [];
  const issues: PipelineCompileIssue[] = [];
  const ruleNodeIds: string[] = [];
  const immediateRuleIds: string[] = [];
  const seenIds = new Set<string>();
  const noteRule = (node: PipelineGraphNode, rule: LiveParticleRule) => {
    ruleNodeIds.push(node.id);
    if (pipelineNodeCrossImmediate(node)) immediateRuleIds.push(rule.id);
  };
  const push = (node: PipelineGraphNode, rule: LiveParticleRule | null) => {
    if (!rule) {
      opaqueNodeIds.push(node.id);
      return;
    }
    if (seenIds.has(rule.id)) {
      issues.push({ nodeId: node.id, reason: 'duplicate-rule-id' });
      opaqueNodeIds.push(node.id);
      return;
    }
    seenIds.add(rule.id);
    rules.push(rule);
    noteRule(node, rule);
  };

  for (const node of graph.nodes) {
    if (node.kind === 'rule-box') {
      push(node, compileRuleBox(node, issues));
    } else if (node.kind === 'opaque') {
      // An opaque node's payload IS a rule: it compiles back
      // verbatim, and is not itself counted as opaque output.
      const rule = compileOpaqueNode(node, issues);
      if (rule && !seenIds.has(rule.id)) {
        seenIds.add(rule.id);
        rules.push(rule);
        noteRule(node, rule);
      } else {
        if (rule) issues.push({ nodeId: node.id, reason: 'duplicate-rule-id' });
        opaqueNodeIds.push(node.id);
      }
    } else if (PIPELINE_ACTION_NODE_KINDS.includes(node.kind)) {
      // An action node that is a rule-box child is compiled
      // through its box, not on its own.
      const claimed = graph.nodes.some(
        (n) => n.kind === 'rule-box' && (n.children ?? []).includes(node.id),
      );
      if (claimed) continue;
      // Likewise an action node produced by S1 expansion is
      // recognised by its :action suffix paired with :cond.
      if (node.id.endsWith(':action')
        && graph.nodes.some((n) => n.id === `${node.id.slice(0, -':action'.length)}:cond`)) {
        // It still compiles standalone (its box is gone once
        // expanded); fall through and compile it directly.
      }
      push(node, compileActionNode(graph, node, issues));
    }
  }
  // S5: a group-aggregate node wired into a rule's condition
  // has NO live supply — the REP condition variables are
  // per-particle only and group aggregates are out of scope
  // there (see lib/pipelineCross.ts for the twin-level
  // aggregates that DO exist). Report it with a reason
  // instead of letting the wire be silently ignored.
  for (const node of graph.nodes) {
    if (node.kind !== 'group-aggregate') continue;
    const wired = graph.edges.some((e) => e.from === node.id
      && graph.nodes.some((n) => n.id === e.to
        && (n.kind === 'rule-box' || PIPELINE_ACTION_NODE_KINDS.includes(n.kind))));
    if (wired) {
      issues.push({ nodeId: node.id, reason: 'group-aggregate-twin-only' });
    }
  }
  return { rules, opaqueNodeIds, issues, ruleNodeIds, immediateRuleIds };
}

// ---------------------------------------------------------------------------
// Live rules -> graph (the inverse; 分岐A round trip)
// ---------------------------------------------------------------------------

/**
 * Represent a live rule list as a pipeline graph: one
 * rule-box per rule carrying the rule verbatim (entity
 * form), chained by sequence edges in list order. A rule
 * whose action the box form cannot name (color — parsed
 * but unconsumed by the REP) becomes an opaque node
 * carrying the rule verbatim instead.
 */
export function liveRulesToPipelineGraph(rules: readonly LiveParticleRule[]): PipelineGraph {
  const nodes: PipelineGraphNode[] = [];
  const edges: PipelineGraph['edges'] = [];
  let previousId: string | null = null;
  rules.forEach((rule, index) => {
    const nodeId = `rule:${rule.id}`;
    const opaque = rule.action.type === 'color';
    const node: PipelineGraphNode = {
      id: nodeId,
      kind: opaque ? 'opaque' : 'rule-box',
      label: typeof rule.name === 'string' && rule.name.length > 0 ? rule.name : rule.id,
      enabled: rule.enabled,
      params: opaque ? { rawRule: { ...rule } } : { rule: { ...rule } },
    };
    nodes.push(node);
    if (previousId !== null) {
      edges.push({ id: `seq-${index}`, from: previousId, to: nodeId, kind: 'sequence' });
    }
    previousId = nodeId;
  });
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

// ---------------------------------------------------------------------------
// Force-order column <-> linear graph (分岐C)
// ---------------------------------------------------------------------------

/**
 * The force-order key a graph's force-chunk chain stands
 * for. Chunk nodes contribute in document order; unknown
 * chunk names are skipped (the order module's own
 * discipline drops them too) and missing chunks are
 * appended in default order by the normaliser, so the
 * result is always a full permutation — and '' when the
 * chain denotes the default order or there is no chain.
 */
export function pipelineGraphToForceOrderKey(graph: PipelineGraph): string {
  graph = expandPipelineGraphClusters(graph);
  const names: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'force-chunk' || !node.enabled) continue;
    const name = pipelineForceChunkName(node);
    if (name !== null && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return '';
  return serializeGpgpuForceOrder(names);
}

/** The linear force-chunk graph an order key stands for. */
export function forceOrderKeyToPipelineGraph(order?: string | readonly string[] | null): PipelineGraph {
  const names = normalizeGpgpuForceOrder(order ?? '');
  const nodes: PipelineGraphNode[] = names.map((name) => ({
    id: `chunk:${name}`,
    kind: 'force-chunk',
    label: name,
    enabled: true,
    params: { chunk: name },
  }));
  const edges: PipelineGraph['edges'] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ id: `seq-${i}`, from: nodes[i - 1].id, to: nodes[i].id, kind: 'sequence' });
  }
  return { format: PIPELINE_GRAPH_FORMAT, nodes, edges };
}

// ---------------------------------------------------------------------------
// Expression output slot assignment (the supply channel)
// ---------------------------------------------------------------------------

/** Mirror of ATTR_EXPR_RESERVED_NAMES in lib/gpgpuAttributes.ts. */
export const PIPELINE_SLOT_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'x', 't', 'pi', 'tau', 'e',
  'abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'pow', 'exp', 'log', 'floor', 'ceil', 'round', 'sign',
  'fract', 'mod', 'min', 'max', 'clamp', 'lerp', 'smoothstep',
  'p',
  ...ATTR_SIM_VAR_NAMES,
  DENSITY_VAR_NAME,
]);

const SLOT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
/** The dyn channel writes slots 0..3 (ATTR_SLOT_COUNT). */
export const PIPELINE_SLOT_WRITABLE_SLOTS = 4;

export interface PipelineSlotAssignment {
  nodeId: string;
  name: string;
  slot: number;
  /** 'existing' = the name already named this slot. */
  source: 'existing' | 'assigned';
  expr: string;
}

export interface PipelineSlotRejection {
  nodeId: string;
  name: string;
  reason: 'invalid-name' | 'reserved-name' | 'ext-slot-read-only' | 'duplicate-output-name' | 'no-free-slot';
}

export interface PipelineSlotAssignmentResult {
  assignments: PipelineSlotAssignment[];
  rejections: PipelineSlotRejection[];
  /** Proposed slot names (first set) after assignment. */
  names: string[];
  names2: string[];
  /** Per-slot dyn expressions for slots 0..3 ('' = none). */
  dynExprs: string[];
}

function requestedOutputName(node: PipelineGraphNode): string | null {
  const params = node.params ?? {};
  const raw = typeof params.outputSlot === 'string' ? params.outputSlot
    : typeof params.slotName === 'string' ? params.slotName : null;
  return raw === null ? null : raw.trim();
}

/**
 * Assign output slots to the graph's expression /
 * channel-write nodes that request one, under the
 * discipline in this module's header. Pure: the existing
 * attribute names are inputs, the proposed names and dyn
 * expressions are outputs for a later slice to apply.
 */
export function assignPipelineExpressionSlots(
  graph: PipelineGraph,
  namesInput?: readonly string[] | unknown,
  names2Input?: readonly string[] | unknown,
): PipelineSlotAssignmentResult {
  graph = expandPipelineGraphClusters(graph);
  const names = normalizeAttrNames(namesInput ?? undefined);
  const names2 = normalizeAttrNames2(names2Input ?? undefined);
  const assignments: PipelineSlotAssignment[] = [];
  const rejections: PipelineSlotRejection[] = [];
  const claimed = new Map<string, number>(); // lower name -> slot
  const usedSlots = new Set<number>();
  const dynExprs: string[] = ['', '', '', ''];
  const proposedNames = [...names];

  for (const node of graph.nodes) {
    if (!node.enabled) continue;
    if (node.kind !== 'expression' && node.kind !== 'channel-write') continue;
    const name = requestedOutputName(node);
    if (name === null || name.length === 0) continue;
    const lower = name.toLowerCase();
    const expr = typeof node.params?.expr === 'string' ? node.params.expr : '';

    if (!SLOT_NAME_RE.test(name)) {
      rejections.push({ nodeId: node.id, name, reason: 'invalid-name' });
      continue;
    }
    if (PIPELINE_SLOT_RESERVED_NAMES.has(lower)) {
      rejections.push({ nodeId: node.id, name, reason: 'reserved-name' });
      continue;
    }
    if (claimed.has(lower)) {
      rejections.push({ nodeId: node.id, name, reason: 'duplicate-output-name' });
      continue;
    }
    const existing = resolveAttrNameSlot(name, names, names2);
    if (existing >= PIPELINE_SLOT_WRITABLE_SLOTS) {
      rejections.push({ nodeId: node.id, name, reason: 'ext-slot-read-only' });
      continue;
    }
    if (existing >= 0) {
      claimed.set(lower, existing);
      usedSlots.add(existing);
      assignments.push({ nodeId: node.id, name, slot: existing, source: 'existing', expr });
      if (dynExprs[existing] === '') dynExprs[existing] = expr;
      continue;
    }
    let slot = -1;
    for (let s = 0; s < PIPELINE_SLOT_WRITABLE_SLOTS; s++) {
      if (!usedSlots.has(s)) { slot = s; break; }
    }
    if (slot < 0) {
      rejections.push({ nodeId: node.id, name, reason: 'no-free-slot' });
      continue;
    }
    claimed.set(lower, slot);
    usedSlots.add(slot);
    proposedNames[slot] = name;
    dynExprs[slot] = expr;
    assignments.push({ nodeId: node.id, name, slot, source: 'assigned', expr });
  }

  return { assignments, rejections, names: proposedNames, names2, dynExprs };
}

// ---------------------------------------------------------------------------
// Whole-graph compile
// ---------------------------------------------------------------------------

export interface PipelineGraphCompileResult extends PipelineRuleCompileResult {
  /** The gpgpuForceOrder key form ('' = default / unset). */
  forceOrderKey: string;
  slots: PipelineSlotAssignmentResult;
}

export function compilePipelineGraph(
  graph: PipelineGraph,
  options?: {
    attrNames?: readonly string[] | unknown;
    attrNames2?: readonly string[] | unknown;
  },
): PipelineGraphCompileResult {
  const validated = validatePipelineGraph(graph);
  const valid = validated.ok ? validated.graph : graph;
  const rulesResult = compilePipelineGraphToLiveRules(valid);
  return {
    ...rulesResult,
    forceOrderKey: pipelineGraphToForceOrderKey(valid),
    slots: assignPipelineExpressionSlots(valid, options?.attrNames, options?.attrNames2),
  };
}

export { isDefaultGpgpuForceOrder };
