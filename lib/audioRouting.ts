/**
 * Audio routing graph (TD §7 stage 1 pilot, Phase 33).
 *
 * Until now the particle audio wiring was fixed inline in
 * applyParticleAudioUniforms: five analysed levels (bass /
 * treble / pulse / bandA / bandB) were combined into ten
 * inputs through hard-coded mixes (the composites shatter /
 * twist / bend / warp read the already-gained bass / treble /
 * pulse inputs at fixed ratios). This module turns that
 * wiring into data so the Audio tab can offer a graph view
 * next to the classic sliders:
 *
 *   - Registers 0..4 are the analysed levels.
 *   - Registers 5..14 are the ten inputs, in fixed order.
 *     An input's edges may only reference lower registers
 *     (the Motion DAG register discipline), so a cycle can
 *     never be constructed and evaluation is a single
 *     sequential pass.
 *   - Each input's gain stays bound to its existing *Scale
 *     config key, so the panel sliders keep their meaning;
 *     the graph edits which registers feed each input and
 *     at what weight.
 *
 * The graph is stored in the `audioRoutingGraph` config key
 * as JSON; '' means the default graph, which reproduces the
 * legacy fixed wiring exactly (the identity is pinned by
 * scripts/phase33-audio-routing.test.mjs against a reference
 * copy of the legacy formulas). Only the central particle
 * wiring goes through this resolver — the scene systems that
 * read audio*Scale keys directly (burst / screen / camera /
 * hue) are untouched by the graph in this stage.
 */
import type { ParticleConfigAudio } from '../types/configAudio';

export type AudioRoutingSourceId = 'bass' | 'treble' | 'pulse' | 'bandA' | 'bandB';
export type AudioRoutingOutputId =
  | 'bass' | 'treble' | 'pulse' | 'morph' | 'shatter'
  | 'twist' | 'bend' | 'warp' | 'bandA' | 'bandB';

export interface AudioRoutingEdge {
  /** Register index this edge reads from (always lower than the output's own register). */
  from: number;
  weight: number;
}

export interface AudioRoutingGraph {
  edges: Partial<Record<AudioRoutingOutputId, AudioRoutingEdge[]>>;
}

export interface AudioRoutingRegisterInfo {
  register: number;
  kind: 'source' | 'output';
  id: AudioRoutingSourceId | AudioRoutingOutputId;
  label: string;
}

type AudioGainKey = 'audioBeatScale' | 'audioJitterScale' | 'audioPulseScale'
  | 'audioMorphScale' | 'audioShatterScale' | 'audioTwistScale'
  | 'audioBendScale' | 'audioWarpScale';

export interface AudioRoutingOutputInfo {
  id: AudioRoutingOutputId;
  register: number;
  label: string;
  /** Existing config key bound as this input's gain; null = unity gain (bandA / bandB). */
  gainKey: AudioGainKey | null;
}

export const AUDIO_ROUTING_SOURCES: readonly { id: AudioRoutingSourceId; register: number; label: string }[] = [
  { id: 'bass', register: 0, label: 'Bass' },
  { id: 'treble', register: 1, label: 'Treble' },
  { id: 'pulse', register: 2, label: 'Pulse' },
  { id: 'bandA', register: 3, label: 'Band A' },
  { id: 'bandB', register: 4, label: 'Band B' },
];

export const AUDIO_ROUTING_OUTPUTS: readonly AudioRoutingOutputInfo[] = [
  { id: 'bass', register: 5, label: 'Bass In', gainKey: 'audioBeatScale' },
  { id: 'treble', register: 6, label: 'Treble In', gainKey: 'audioJitterScale' },
  { id: 'pulse', register: 7, label: 'Pulse In', gainKey: 'audioPulseScale' },
  { id: 'morph', register: 8, label: 'Morph', gainKey: 'audioMorphScale' },
  { id: 'shatter', register: 9, label: 'Shatter', gainKey: 'audioShatterScale' },
  { id: 'twist', register: 10, label: 'Twist', gainKey: 'audioTwistScale' },
  { id: 'bend', register: 11, label: 'Bend', gainKey: 'audioBendScale' },
  { id: 'warp', register: 12, label: 'Warp', gainKey: 'audioWarpScale' },
  { id: 'bandA', register: 13, label: 'Band A In', gainKey: null },
  { id: 'bandB', register: 14, label: 'Band B In', gainKey: null },
];

export const AUDIO_ROUTING_REGISTERS: readonly AudioRoutingRegisterInfo[] = [
  ...AUDIO_ROUTING_SOURCES.map((s) => ({ register: s.register, kind: 'source' as const, id: s.id, label: s.label })),
  ...AUDIO_ROUTING_OUTPUTS.map((o) => ({ register: o.register, kind: 'output' as const, id: o.id, label: o.label })),
];

export const AUDIO_ROUTING_MAX_EDGES_PER_OUTPUT = 8;
export const AUDIO_ROUTING_WEIGHT_LIMIT = 4;

/** The legacy fixed wiring, as a graph. Edge order matters: the resolver
 *  sums in listed order so the default graph is bit-identical to the
 *  legacy inline formulas. */
export function defaultAudioRoutingGraph(): AudioRoutingGraph {
  return {
    edges: {
      bass: [{ from: 0, weight: 1 }],
      treble: [{ from: 1, weight: 1 }],
      pulse: [{ from: 2, weight: 1 }],
      morph: [{ from: 2, weight: 1 }],
      shatter: [{ from: 6, weight: 0.75 }, { from: 7, weight: 0.35 }],
      twist: [{ from: 5, weight: 0.6 }, { from: 7, weight: 0.9 }],
      bend: [{ from: 6, weight: 0.55 }, { from: 7, weight: 0.7 }],
      warp: [{ from: 5, weight: 0.35 }, { from: 6, weight: 0.35 }, { from: 7, weight: 1 }],
      bandA: [{ from: 3, weight: 1 }],
      bandB: [{ from: 4, weight: 1 }],
    },
  };
}

function canonicalEdges(graph: AudioRoutingGraph): string {
  const parts: string[] = [];
  for (const output of AUDIO_ROUTING_OUTPUTS) {
    const list = graph.edges[output.id] ?? [];
    parts.push(`${output.id}:${list.map((e) => `${e.from}@${e.weight}`).join(',')}`);
  }
  return parts.join('|');
}

export function isDefaultAudioRoutingGraph(graph: AudioRoutingGraph): boolean {
  return canonicalEdges(graph) === canonicalEdges(defaultAudioRoutingGraph());
}

/**
 * Parse the stored JSON into a validated graph. Anything
 * structurally wrong falls back to the default graph as a
 * whole; individually invalid edges (unknown output,
 * self/forward reference, duplicate source, non-finite or
 * out-of-range weight) are dropped.
 */
export function parseAudioRoutingGraph(text: string | undefined | null): AudioRoutingGraph {
  if (!text) return defaultAudioRoutingGraph();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultAudioRoutingGraph();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultAudioRoutingGraph();
  const rawEdges = (raw as { edges?: unknown }).edges;
  if (!rawEdges || typeof rawEdges !== 'object' || Array.isArray(rawEdges)) return defaultAudioRoutingGraph();
  const edges: AudioRoutingGraph['edges'] = {};
  for (const output of AUDIO_ROUTING_OUTPUTS) {
    const list = (rawEdges as Record<string, unknown>)[output.id];
    if (list === undefined) continue;
    if (!Array.isArray(list)) continue;
    const seen = new Set<number>();
    const valid: AudioRoutingEdge[] = [];
    for (const item of list) {
      if (valid.length >= AUDIO_ROUTING_MAX_EDGES_PER_OUTPUT) break;
      if (!item || typeof item !== 'object') continue;
      const from = (item as { from?: unknown }).from;
      const weight = (item as { weight?: unknown }).weight;
      if (typeof from !== 'number' || !Number.isInteger(from)) continue;
      if (from < 0 || from >= output.register) continue;
      if (seen.has(from)) continue;
      if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
      seen.add(from);
      valid.push({ from, weight: Math.max(-AUDIO_ROUTING_WEIGHT_LIMIT, Math.min(AUDIO_ROUTING_WEIGHT_LIMIT, weight)) });
    }
    edges[output.id] = valid;
  }
  return { edges };
}

/** Serialise for storage; the default graph stores as '' (PCG precedent). */
export function serializeAudioRoutingGraph(graph: AudioRoutingGraph): string {
  if (isDefaultAudioRoutingGraph(graph)) return '';
  const edges: Record<string, AudioRoutingEdge[]> = {};
  for (const output of AUDIO_ROUTING_OUTPUTS) {
    const list = graph.edges[output.id];
    if (list && list.length > 0) edges[output.id] = list.map((e) => ({ from: e.from, weight: e.weight }));
  }
  return JSON.stringify({ edges });
}

export interface AudioRoutingLevels {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
}

export type AudioRoutingInputs = Record<AudioRoutingOutputId, number>;

/**
 * Evaluate the graph for one frame: a single sequential pass
 * over the outputs in register order. With the default graph
 * the result is bit-identical to the legacy inline formulas
 * in applyParticleAudioUniforms (the ×1 edges and the edge
 * order keep the floating-point operation order unchanged).
 */
export function resolveAudioRoutingInputs(
  graph: AudioRoutingGraph,
  levels: AudioRoutingLevels,
  config: ParticleConfigAudio,
): AudioRoutingInputs {
  const registers = new Array<number>(15).fill(0);
  registers[0] = levels.bass;
  registers[1] = levels.treble;
  registers[2] = levels.pulse;
  registers[3] = levels.bandA;
  registers[4] = levels.bandB;
  const inputs = {} as AudioRoutingInputs;
  for (const output of AUDIO_ROUTING_OUTPUTS) {
    let sum = 0;
    for (const edge of graph.edges[output.id] ?? []) {
      sum += registers[edge.from] * edge.weight;
    }
    const value = output.gainKey ? sum * config[output.gainKey] : sum;
    registers[output.register] = value;
    inputs[output.id] = value;
  }
  return inputs;
}

let cachedText: string | null = null;
let cachedGraph: AudioRoutingGraph | null = null;

/** Parse with a single-entry memo, for the per-frame runtime path. */
export function resolveAudioRoutingGraph(text: string | undefined | null): AudioRoutingGraph {
  const key = text ?? '';
  if (cachedGraph !== null && cachedText === key) return cachedGraph;
  cachedText = key;
  cachedGraph = parseAudioRoutingGraph(key);
  return cachedGraph;
}
