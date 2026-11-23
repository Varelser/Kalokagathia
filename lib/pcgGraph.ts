// Phase 18 stage 3 — PCG rule graph for the terrain scatter bake.
//
// The scatter grammar (Phase AI/AX, lib/gpgpuMorphTargets.ts) was a
// fixed-order pipeline: candidate sampling with acceptance
// resampling (sampler), acceptance factors from density / height
// band / slope (filters), then species zoning and companion-normal
// finishing (transformers). This module opens that fixed order as
// a node list WITHOUT building new parts: the default graph is
// exactly the historical pipeline, and the bake only consults the
// evaluator while the gpgpuPcgGraphEnabled key is on and the
// scatter grammar itself is active. With the graph key at its
// default ('' = default graph, graph disabled) the bake runs the
// legacy code path verbatim.
//
// Wiring follows the Motion DAG register discipline: a node may
// reference only EARLIER nodes (its `input` is an index or id of a
// preceding node), so cycles are structurally impossible — and any
// input that tries (forward / self / unknown reference, unknown
// kind or op, duplicate id, malformed JSON) invalidates the whole
// graph and safely falls back to the default graph.

export type PcgNodeKind = 'sampler' | 'filter' | 'transformer';

export interface PcgNodeParams {
  /** Sampler: resampling attempts per particle (1..10). */
  attempts?: number;
  /** Filter / align transformer: factor strength 0..1 (1 = full). */
  strength?: number;
}

export interface PcgNode {
  id: string;
  kind: PcgNodeKind;
  op: string;
  enabled: boolean;
  /** Preceding-register reference: index or id of an earlier node. */
  input?: number | string | null;
  params?: PcgNodeParams;
}

export const PCG_NODE_OPS: Record<PcgNodeKind, readonly string[]> = {
  sampler: ['candidates'],
  filter: ['density', 'height-band', 'slope'],
  transformer: ['species', 'align-normal'],
};

export const PCG_GRAPH_MAX_NODES = 16;
export const PCG_GRAPH_MAX_CHARS = 100_000;

const NODE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The default graph: the historical fixed order, verbatim. */
export const PCG_DEFAULT_GRAPH: readonly PcgNode[] = [
  { id: 'sampler', kind: 'sampler', op: 'candidates', enabled: true },
  { id: 'density', kind: 'filter', op: 'density', enabled: true, input: 'sampler' },
  { id: 'height-band', kind: 'filter', op: 'height-band', enabled: true, input: 'density' },
  { id: 'slope', kind: 'filter', op: 'slope', enabled: true, input: 'height-band' },
  { id: 'species', kind: 'transformer', op: 'species', enabled: true, input: 'slope' },
  { id: 'align-normal', kind: 'transformer', op: 'align-normal', enabled: true, input: 'species' },
];

export function defaultPcgGraph(): PcgNode[] {
  return PCG_DEFAULT_GRAPH.map((n) => ({ ...n }));
}

function clamp01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

function parseParams(raw: unknown): PcgNodeParams | null {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const out: PcgNodeParams = {};
  if (p.attempts !== undefined) {
    if (typeof p.attempts !== 'number' || !Number.isFinite(p.attempts)) return null;
    out.attempts = Math.max(1, Math.min(10, Math.floor(p.attempts)));
  }
  if (p.strength !== undefined) {
    if (typeof p.strength !== 'number' || !Number.isFinite(p.strength)) return null;
    out.strength = clamp01(p.strength, 1);
  }
  return out;
}

/**
 * Validate an untrusted node list. Returns the normalised nodes,
 * or null when ANY node is malformed (unknown kind/op, duplicate
 * id, or a reference that is not strictly preceding) — the whole
 * graph falls back, never a partial repair, so a corrupted payload
 * cannot silently change the bake's meaning.
 */
export function validatePcgGraph(raw: unknown): PcgNode[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > PCG_GRAPH_MAX_NODES) return null;
  const out: PcgNode[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== 'string' || !NODE_ID_RE.test(n.id) || seenIds.has(n.id)) return null;
    if (n.kind !== 'sampler' && n.kind !== 'filter' && n.kind !== 'transformer') return null;
    const kind = n.kind as PcgNodeKind;
    if (typeof n.op !== 'string' || !PCG_NODE_OPS[kind].includes(n.op)) return null;
    if (n.enabled !== undefined && typeof n.enabled !== 'boolean') return null;
    // Preceding-register reference only: an integer index < i, or
    // the id of a node already accepted (all of which precede i).
    let input: number | string | null | undefined;
    if (n.input !== undefined && n.input !== null) {
      if (typeof n.input === 'number') {
        if (!Number.isInteger(n.input) || n.input < 0 || n.input >= i) return null;
        input = n.input;
      } else if (typeof n.input === 'string') {
        if (!seenIds.has(n.input)) return null;
        input = n.input;
      } else {
        return null;
      }
    }
    const params = parseParams(n.params);
    if (params === null) return null;
    seenIds.add(n.id);
    const node: PcgNode = { id: n.id, kind, op: n.op, enabled: n.enabled !== false };
    if (input !== undefined) node.input = input;
    if (Object.keys(params).length > 0) node.params = params;
    out.push(node);
  }
  return out;
}

/** Parse the serialised key; null for empty / malformed / invalid. */
export function parsePcgGraphData(data: string | null | undefined): PcgNode[] | null {
  if (!data || typeof data !== 'string' || data.length > PCG_GRAPH_MAX_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return validatePcgGraph(raw);
}

/** Resolve the key to a usable graph: default on empty/invalid. */
export function resolvePcgGraph(data: string | null | undefined): PcgNode[] {
  return parsePcgGraphData(data) ?? defaultPcgGraph();
}

/** True when the data is a present, valid graph payload. */
export function isValidPcgGraphData(data: string | null | undefined): boolean {
  return parsePcgGraphData(data) !== null;
}

function nodesEqual(a: readonly PcgNode[], b: readonly PcgNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when the input denotes the default graph (incl. ''/unset). */
export function isDefaultPcgGraph(input: string | readonly PcgNode[] | null | undefined): boolean {
  if (input == null) return true;
  if (typeof input === 'string') {
    if (input.trim() === '') return true;
    const nodes = parsePcgGraphData(input);
    return nodes !== null && nodesEqual(nodes, PCG_DEFAULT_GRAPH);
  }
  return nodesEqual(input, PCG_DEFAULT_GRAPH);
}

/** Serialise back to the key form ('' when the graph is default). */
export function serializePcgGraph(nodes: readonly PcgNode[] | null | undefined): string {
  if (!nodes) return '';
  const valid = validatePcgGraph(nodes);
  if (!valid || nodesEqual(valid, PCG_DEFAULT_GRAPH)) return '';
  const text = JSON.stringify(valid);
  return text.length <= PCG_GRAPH_MAX_CHARS ? text : '';
}

// ---------------------------------------------------------------------------
// Evaluation: node list -> the plan the scatter bake consumes.

export interface PcgPlan {
  /** Enabled nodes in graph order (the execution steps). */
  steps: PcgNode[];
  samplerEnabled: boolean;
  /** Resampling attempts from the sampler node (default 5). */
  attempts: number;
  /** Enabled filter ops, in graph order. */
  filterOps: string[];
  /** Enabled transformer ops, in graph order. */
  transformerOps: string[];
}

export function evaluatePcgGraph(nodes: readonly PcgNode[]): PcgPlan {
  const steps = nodes.filter((n) => n.enabled);
  const sampler = steps.find((n) => n.kind === 'sampler');
  return {
    steps,
    samplerEnabled: !!sampler,
    attempts: sampler?.params?.attempts ?? 5,
    filterOps: steps.filter((n) => n.kind === 'filter').map((n) => n.op),
    transformerOps: steps.filter((n) => n.kind === 'transformer').map((n) => n.op),
  };
}

/** Strength of one enabled step (1 when unset). */
export function pcgStepStrength(plan: PcgPlan, op: string): number {
  const step = plan.steps.find((n) => n.op === op);
  return step?.params?.strength ?? 1;
}

function applyStrength(factor: number, strength: number): number {
  if (strength >= 1) return factor;
  if (strength <= 0) return 1;
  return 1 + (factor - 1) * strength;
}

/** Height-band factor of the legacy acceptance (skirt 0.05). */
export function pcgHeightBandFactor(heightMin: number, heightMax: number, t: number): number {
  const skirt = 0.05;
  if (t < heightMin) return clamp01((t - (heightMin - skirt)) / skirt, 0);
  if (t > heightMax) return clamp01(((heightMax + skirt) - t) / skirt, 0);
  return 1;
}

/** Slope factor of the legacy acceptance (falloff 0.15). */
export function pcgSlopeFactor(slopeMax: number, slopeNorm: number): number {
  if (slopeMax >= 1) return 1;
  return slopeNorm <= slopeMax ? 1 : clamp01(1 - (slopeNorm - slopeMax) / 0.15, 0);
}

export interface PcgScatterFactors {
  density: number;
  heightMin: number;
  heightMax: number;
  slopeMax: number;
}

/**
 * Acceptance probability under a plan: the enabled filter nodes
 * multiply their factors in graph order. For the default graph
 * this is exactly the legacy product density × band × slope, in
 * the same operation order (the accumulator starts at 1 and
 * 1 × density is exact), so the default plan is bit-identical.
 */
export function pcgAcceptance(
  plan: PcgPlan,
  scatter: PcgScatterFactors,
  t: number,
  slopeNorm: number,
): number {
  let p = 1;
  for (const step of plan.steps) {
    if (step.kind !== 'filter') continue;
    const strength = step.params?.strength ?? 1;
    if (step.op === 'density') p *= applyStrength(clamp01(scatter.density, 1), strength);
    else if (step.op === 'height-band') p *= applyStrength(pcgHeightBandFactor(scatter.heightMin, scatter.heightMax, t), strength);
    else if (step.op === 'slope') p *= applyStrength(pcgSlopeFactor(scatter.slopeMax, slopeNorm), strength);
  }
  return p;
}
